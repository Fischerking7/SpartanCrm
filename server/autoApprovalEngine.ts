import { db } from "./db";
import { salesOrders, chargebacks, arExpectations, orderExceptions, commissionDisputes } from "@shared/schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import { storage } from "./storage";

export interface AutoApprovalResult {
  eligible: boolean;
  confidence: number;
  reasons: string[];
  blockers: string[];
}

export interface AutoApprovalConfig {
  confidenceThreshold: number;
  maxCommissionCents: number;
  chargebackRiskMax: number;
  enabled: boolean;
}

const SETTING_DEFAULTS: Record<string, string> = {
  auto_approval_confidence_threshold: "80",
  auto_approval_max_commission_cents: "0",
  auto_approval_chargeback_risk_max: "85",
  auto_approval_enabled: "true",
};

async function getSetting(key: string): Promise<string> {
  const setting = await storage.getSystemSettingByKey(key);
  return setting?.value ?? SETTING_DEFAULTS[key] ?? "";
}

export async function loadAutoApprovalConfig(): Promise<AutoApprovalConfig> {
  const [confidenceStr, maxCommissionStr, riskMaxStr, enabledStr] = await Promise.all([
    getSetting("auto_approval_confidence_threshold"),
    getSetting("auto_approval_max_commission_cents"),
    getSetting("auto_approval_chargeback_risk_max"),
    getSetting("auto_approval_enabled"),
  ]);

  const parsedConfidence = parseInt(confidenceStr, 10);
  const parsedMaxCommission = parseInt(maxCommissionStr, 10);
  const parsedRiskMax = parseInt(riskMaxStr, 10);

  return {
    confidenceThreshold: Number.isNaN(parsedConfidence) ? 80 : parsedConfidence,
    maxCommissionCents: Number.isNaN(parsedMaxCommission) ? 0 : parsedMaxCommission,
    chargebackRiskMax: Number.isNaN(parsedRiskMax) ? 85 : parsedRiskMax,
    enabled: enabledStr !== "false",
  };
}

export async function evaluateOrderForAutoApproval(
  orderId: string,
  config?: AutoApprovalConfig
): Promise<AutoApprovalResult> {
  const order = await db.query.salesOrders.findFirst({ where: eq(salesOrders.id, orderId) });
  if (!order) {
    return { eligible: false, confidence: 0, reasons: [], blockers: ["Order not found"] };
  }

  const cfg = config ?? (await loadAutoApprovalConfig());

  const blockers: string[] = [];
  const reasons: string[] = [];

  // Hard criteria checks
  if (order.jobStatus !== "COMPLETED") {
    blockers.push("Job status is not COMPLETED");
  }

  if (order.approvalStatus !== "UNAPPROVED") {
    blockers.push(`Order approval status is ${order.approvalStatus} (must be UNAPPROVED)`);
  }

  if (!order.appliedRateCardId) {
    blockers.push("No valid rate card applied");
  }

  const baseCommission = parseFloat(order.baseCommissionEarned || "0");
  if (baseCommission <= 0) {
    blockers.push("Base commission earned is not greater than zero");
  }

  // Enforce max commission ceiling if configured
  if (cfg.maxCommissionCents > 0) {
    const baseCommissionCents = Math.round(baseCommission * 100);
    if (baseCommissionCents > cfg.maxCommissionCents) {
      blockers.push(
        `Base commission ($${baseCommission.toFixed(2)}) exceeds maximum allowed ($${(cfg.maxCommissionCents / 100).toFixed(2)})`
      );
    }
  }

  if ((order.ironCrestProfitCents ?? 0) < 0) {
    blockers.push("IronCrest profit is negative");
  }

  // Check for open commission disputes
  const openDispute = await db.query.commissionDisputes.findFirst({
    where: and(eq(commissionDisputes.salesOrderId, orderId), isNull(commissionDisputes.resolvedAt)),
  });
  if (openDispute) {
    blockers.push("Order has an open commission dispute");
  }

  // Check for pending chargebacks directly tied to this order (not yet applied to a pay run)
  const pendingChargeback = await db.query.chargebacks.findFirst({
    where: and(eq(chargebacks.salesOrderId, orderId), isNull(chargebacks.payRunId)),
  });
  if (pendingChargeback) {
    blockers.push("Order has a pending chargeback not yet applied to a pay run");
  }

  // Check for open order exceptions / flags
  const openException = await db.query.orderExceptions.findFirst({
    where: and(eq(orderExceptions.salesOrderId, orderId), isNull(orderExceptions.resolvedAt)),
  });
  if (openException) {
    blockers.push(`Order is flagged: ${openException.reason}`);
  }

  // Check payroll hold
  if (order.isPayrollHeld) {
    blockers.push("Order is held for payroll");
  }

  // Check AR status — must not be WRITTEN_OFF
  const arExpectation = await db.query.arExpectations.findFirst({
    where: eq(arExpectations.orderId, orderId),
  });
  if (arExpectation?.status === "WRITTEN_OFF") {
    blockers.push("AR expectation is written off");
  }

  // Customer name must not be blank
  if (!order.customerName || order.customerName.trim() === "") {
    blockers.push("Customer name is blank");
  }

  // dateSold must be within 180 days
  if (order.dateSold) {
    const soldDate = new Date(order.dateSold);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);
    if (soldDate < cutoff) {
      blockers.push("Date sold is more than 180 days ago");
    }
  } else {
    blockers.push("Date sold is missing");
  }

  // Confidence scoring — starts at 100, deductions applied
  let confidence = 100;

  // Deduct for missing AR (-15)
  if (!arExpectation) {
    confidence -= 15;
    reasons.push("No AR expectation linked (-15 confidence)");
  }

  // Deduct for recent chargeback on rep (-10)
  if (order.repId) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysStr = thirtyDaysAgo.toISOString().split("T")[0];
    const recentCb = await db.select({ count: sql<number>`count(*)` })
      .from(chargebacks)
      .where(sql`"rep_id" = ${order.repId} AND "chargeback_date" >= ${thirtyDaysStr}::date`);
    if (Number(recentCb[0]?.count || 0) > 0) {
      confidence -= 10;
      reasons.push("Rep has a chargeback in the last 30 days (-10 confidence)");
    }
  }

  // Deduct if commission > 2x rep average (-20)
  if (order.repId && baseCommission > 0) {
    const repAvg = await db.select({
      avg: sql<string>`COALESCE(AVG(CAST("base_commission_earned" AS DECIMAL)), 0)`,
    }).from(salesOrders).where(
      and(eq(salesOrders.repId, order.repId), sql`"base_commission_earned"::decimal > 0`)
    );
    const avgValue = parseFloat(repAvg[0]?.avg || "0");
    if (avgValue > 0 && baseCommission > avgValue * 2) {
      confidence -= 20;
      reasons.push(
        `Commission ($${baseCommission.toFixed(2)}) is more than 2x rep average ($${avgValue.toFixed(2)}) (-20 confidence)`
      );
    }
  }

  // Deduct for weekend dateSold (-5)
  if (order.dateSold) {
    const dateSoldDate = new Date(order.dateSold);
    const dayOfWeek = dateSoldDate.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      confidence -= 5;
      reasons.push("Date sold is on a weekend (-5 confidence)");
    }
  }

  // Deduct for no installDate (-10)
  if (!order.installDate) {
    confidence -= 10;
    reasons.push("No install date set (-10 confidence)");
  }

  // Clamp confidence to [0, 100]
  confidence = Math.max(0, Math.min(100, confidence));

  const eligible = blockers.length === 0;

  return { eligible, confidence, reasons, blockers };
}
