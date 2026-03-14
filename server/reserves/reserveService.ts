/**
 * Rolling Reserve Service
 * Implements the Iron Crest Chargebacks & Rolling Reserve Policy.
 *
 * IMPORTANT: The rolling reserve is NOT wages. It is a conditional holdback
 * against future liabilities per the Independent Contractor Agreement.
 * Never refer to reserve funds as "earned" — always use "held" or "withheld".
 *
 * All monetary values are stored as INTEGER cents.
 * Reserve transactions are append-only — never update or delete a transaction record.
 */

import { eq, and, lte, isNotNull, sql, desc, inArray } from "drizzle-orm";
import { db } from "../db";
import type { TxDb } from "../storage";
import {
  rollingReserves,
  reserveTransactions,
  salesOrders,
  chargebacks,
  users,
  auditLogs,
  type RollingReserve,
} from "@shared/schema";
import { calculateMaturityDate, isOrderMature } from "./maturityService";

const RESERVE_ROLES = ["REP", "LEAD", "MANAGER"];

/**
 * FUNCTION 1: getOrCreateReserve
 * Per Policy Section 1 — Rolling Reserve Requirement:
 * Iron Crest maintains a rolling reserve account for each independent sales representative.
 * Default: 15% withholding, $2,500 cap.
 */
export async function getOrCreateReserve(
  userId: string,
  txDb?: TxDb
): Promise<RollingReserve> {
  const d = txDb ?? db;

  const [existing] = await d
    .select()
    .from(rollingReserves)
    .where(eq(rollingReserves.userId, userId));

  if (existing) return existing;

  const [created] = await d
    .insert(rollingReserves)
    .values({ userId })
    .returning();

  await d
    .update(users)
    .set({ hasActiveReserve: true, reserveStatus: "ACTIVE" })
    .where(eq(users.id, userId));

  return created;
}

/**
 * FUNCTION 2: calculateWithholding
 * Per Policy Section 1: 15% of all commissions otherwise payable until reserve reaches $2,500.
 * Per Policy Section 3: If chargebacks reduce the reserve below $2,500, withholding resumes.
 * The rolling reserve is NOT wages — it is a conditional holdback.
 */
export function calculateWithholding(
  netCommissionCents: number,
  reserve: RollingReserve
): number {
  if (reserve.status === "AT_CAP") return 0;
  if (reserve.status === "HELD") return 0;
  if (reserve.status === "RELEASED") return 0;

  const withholdingPercent = parseFloat(reserve.withholdingPercent) / 100;
  const rawWithholding = Math.floor(netCommissionCents * withholdingPercent);

  const remainingToCapCents = reserve.capCents - reserve.currentBalanceCents;

  return Math.min(rawWithholding, Math.max(0, remainingToCapCents));
}

/**
 * FUNCTION 3: applyWithholding
 * Per Policy Section 1: Iron Crest will withhold 15% of all commissions.
 * Per Policy Section 3: Replenishment of Rolling Reserve after chargebacks.
 * Called during pay stub generation for each order.
 * The rolling reserve is NOT wages — it is a conditional holdback.
 */
export async function applyWithholding(
  userId: string,
  salesOrderId: string,
  payStatementId: string,
  netCommissionCents: number,
  txDb?: TxDb
): Promise<{
  withheldCents: number;
  newBalance: number;
  newStatus: string;
  capReached: boolean;
}> {
  const d = txDb ?? db;

  const reserve = await getOrCreateReserve(userId, d);

  if (["AT_CAP", "HELD", "RELEASED"].includes(reserve.status)) {
    return {
      withheldCents: 0,
      newBalance: reserve.currentBalanceCents,
      newStatus: reserve.status,
      capReached: false,
    };
  }

  const withheldCents = calculateWithholding(netCommissionCents, reserve);
  if (withheldCents <= 0) {
    return {
      withheldCents: 0,
      newBalance: reserve.currentBalanceCents,
      newStatus: reserve.status,
      capReached: false,
    };
  }

  const newBalance = reserve.currentBalanceCents + withheldCents;
  const capReached = newBalance >= reserve.capCents;
  const newStatus = capReached ? "AT_CAP" : reserve.status === "DEFICIT" ? "ACTIVE" : reserve.status;

  const [order] = await d
    .select({ invoiceNumber: salesOrders.invoiceNumber })
    .from(salesOrders)
    .where(eq(salesOrders.id, salesOrderId));

  const invoiceNum = order?.invoiceNumber ?? salesOrderId;

  await d.insert(reserveTransactions).values({
    reserveId: reserve.id,
    userId,
    transactionType: "WITHHOLDING",
    amountCents: withheldCents,
    isCredit: true,
    balanceAfterCents: newBalance,
    salesOrderId,
    payStatementId: payStatementId === "PENDING" ? null : payStatementId,
    description: `15% withholding from order ${invoiceNum} commission of $${(netCommissionCents / 100).toFixed(2)}`,
  });

  await d
    .update(rollingReserves)
    .set({
      currentBalanceCents: newBalance,
      totalWithheldCents: sql`"total_withheld_cents" + ${withheldCents}`,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(rollingReserves.id, reserve.id));

  await d
    .update(salesOrders)
    .set({
      reserveWithheldCents: withheldCents,
      reserveWithholdingApplied: true,
    })
    .where(eq(salesOrders.id, salesOrderId));

  if (capReached) {
    await d.insert(reserveTransactions).values({
      reserveId: reserve.id,
      userId,
      transactionType: "CAP_REACHED",
      amountCents: 0,
      isCredit: true,
      balanceAfterCents: newBalance,
      description: `Rolling reserve cap of $${(reserve.capCents / 100).toFixed(2)} reached. Withholding paused.`,
    });
  }

  await d
    .update(users)
    .set({ reserveStatus: newStatus })
    .where(eq(users.id, userId));

  await d.insert(auditLogs).values({
    action: "RESERVE_WITHHOLDING_APPLIED",
    tableName: "reserve_transactions",
    recordId: salesOrderId,
    afterJson: JSON.stringify({ withheldCents, newBalance, newStatus, capReached }),
    userId,
  });

  return { withheldCents, newBalance, newStatus, capReached };
}

/**
 * FUNCTION 4: applyChargebackToReserve
 * Per Policy Section 2: Chargebacks are deducted directly from the rolling reserve.
 * Per Policy Section 3: If chargebacks reduce reserve below $2,500, withholding resumes.
 * Per Policy Section 8: Setoff rights — Iron Crest may set off chargebacks against the reserve.
 * The rolling reserve is NOT wages — it is a conditional holdback.
 */
export async function applyChargebackToReserve(
  userId: string,
  chargebackId: string,
  salesOrderId: string,
  chargebackAmountCents: number,
  chargebackType: "VOLUNTARY_CANCELLATION" | "NON_PAY_DISCONNECT",
  providerName: string,
  txDb?: TxDb
): Promise<{
  deductedFromReserveCents: number;
  remainingChargebackCents: number;
  newReserveBalance: number;
  reserveDeficit: boolean;
}> {
  const d = txDb ?? db;

  const reserve = await getOrCreateReserve(userId, d);

  const fromReserve = Math.min(chargebackAmountCents, reserve.currentBalanceCents);
  const remaining = chargebackAmountCents - fromReserve;

  const newBalance = reserve.currentBalanceCents - fromReserve;

  if (fromReserve > 0) {
    await d.insert(reserveTransactions).values({
      reserveId: reserve.id,
      userId,
      transactionType: "CHARGEBACK_DEDUCTION",
      amountCents: fromReserve,
      isCredit: false,
      balanceAfterCents: newBalance,
      chargebackId,
      salesOrderId,
      description: `Chargeback deduction: ${providerName} ${chargebackType.replace(/_/g, " ").toLowerCase()} — $${(chargebackAmountCents / 100).toFixed(2)}`,
    });
  }

  let newStatus = reserve.status;

  if (newBalance < reserve.capCents && reserve.status === "AT_CAP") {
    newStatus = "ACTIVE";
    await d.insert(reserveTransactions).values({
      reserveId: reserve.id,
      userId,
      transactionType: "REPLENISHMENT",
      amountCents: 0,
      isCredit: true,
      balanceAfterCents: newBalance,
      description: `Reserve dropped below cap due to chargeback. Withholding of ${reserve.withholdingPercent}% resumed.`,
    });
  }

  if (remaining > 0) {
    newStatus = "DEFICIT";
  }

  await d
    .update(rollingReserves)
    .set({
      currentBalanceCents: newBalance,
      totalChargebacksCents: sql`"total_chargebacks_cents" + ${chargebackAmountCents}`,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(rollingReserves.id, reserve.id));

  await d
    .update(users)
    .set({ reserveStatus: newStatus })
    .where(eq(users.id, userId));

  const [order] = await d
    .select({ dateSold: salesOrders.dateSold })
    .from(salesOrders)
    .where(eq(salesOrders.id, salesOrderId));

  if (order?.dateSold) {
    const maturityDate = calculateMaturityDate(order.dateSold, providerName, chargebackType);
    await d
      .update(salesOrders)
      .set({
        carrierMaturityType: chargebackType,
        maturityExpiresAt: maturityDate,
      })
      .where(eq(salesOrders.id, salesOrderId));
  }

  await d.insert(auditLogs).values({
    action: "RESERVE_CHARGEBACK_APPLIED",
    tableName: "reserve_transactions",
    recordId: chargebackId,
    afterJson: JSON.stringify({
      chargebackAmountCents,
      deductedFromReserveCents: fromReserve,
      remainingChargebackCents: remaining,
      newBalance,
      newStatus,
    }),
    userId,
  });

  return {
    deductedFromReserveCents: fromReserve,
    remainingChargebackCents: remaining,
    newReserveBalance: newBalance,
    reserveDeficit: remaining > 0,
  };
}

/**
 * FUNCTION 5: applyEquipmentRecovery
 * Per Policy Section 6: Company-Issued Equipment (iPad).
 * If the iPad is not returned or is returned damaged, the full replacement
 * cost ($500) shall be deducted from the rolling reserve.
 * The rolling reserve is NOT wages — it is a conditional holdback.
 */
export async function applyEquipmentRecovery(
  userId: string,
  equipmentType: "IPAD",
  amountCents: number,
  appliedByUserId: string,
  reason: string,
  txDb?: TxDb
): Promise<void> {
  const d = txDb ?? db;

  const reserve = await getOrCreateReserve(userId, d);

  const deducted = Math.min(amountCents, reserve.currentBalanceCents);
  const newBalance = reserve.currentBalanceCents - deducted;
  const remaining = amountCents - deducted;

  await d.insert(reserveTransactions).values({
    reserveId: reserve.id,
    userId,
    transactionType: "EQUIPMENT_RECOVERY",
    amountCents: amountCents,
    isCredit: false,
    balanceAfterCents: newBalance,
    processedByUserId: appliedByUserId,
    description: `${equipmentType} equipment recovery — ${reason}`,
  });

  let newStatus = reserve.status;
  if (remaining > 0 && newStatus !== "HELD") {
    newStatus = "DEFICIT";
  }

  await d
    .update(rollingReserves)
    .set({
      currentBalanceCents: newBalance,
      totalEquipmentRecoveryCents: sql`"total_equipment_recovery_cents" + ${amountCents}`,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(rollingReserves.id, reserve.id));

  await d
    .update(users)
    .set({ reserveStatus: newStatus })
    .where(eq(users.id, userId));

  const [rep] = await d
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId));

  await d.insert(auditLogs).values({
    action: "RESERVE_EQUIPMENT_RECOVERY",
    tableName: "reserve_transactions",
    recordId: userId,
    afterJson: JSON.stringify({
      equipmentType,
      amountCents,
      deducted,
      remaining,
      newBalance,
      repName: rep?.name,
    }),
    userId: appliedByUserId,
  });
}

/**
 * FUNCTION 6: handleRepSeparation
 * Per Policy Section 7: Upon resignation or termination, Iron Crest will retain
 * the rolling reserve through the full applicable chargeback maturity period(s).
 * No early release is required.
 * The rolling reserve is NOT wages — it is a conditional holdback.
 */
export async function handleRepSeparation(
  userId: string,
  separationType: "VOLUNTARY" | "TERMINATED",
  appliedByUserId: string,
  txDb?: TxDb
): Promise<{
  reserveBalance: number;
  earliestReleaseDate: Date;
  ipadRecoveryApplied: boolean;
}> {
  const d = txDb ?? db;

  const reserve = await getOrCreateReserve(userId, d);

  const immatureOrders = await d
    .select({
      dateSold: salesOrders.dateSold,
      maturityExpiresAt: salesOrders.maturityExpiresAt,
    })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.createdByUserId, userId),
        eq(salesOrders.status, "APPROVED")
      )
    );

  let earliestReleaseDate = new Date();
  earliestReleaseDate.setDate(earliestReleaseDate.getDate() + 180);

  for (const order of immatureOrders) {
    if (order.maturityExpiresAt && order.maturityExpiresAt > earliestReleaseDate) {
      earliestReleaseDate = new Date(order.maturityExpiresAt);
    }
    if (order.dateSold) {
      const voluntaryDate = calculateMaturityDate(order.dateSold, "optimum", "VOLUNTARY_CANCELLATION");
      const nonPayDate = calculateMaturityDate(order.dateSold, "optimum", "NON_PAY_DISCONNECT");
      const latest = voluntaryDate > nonPayDate ? voluntaryDate : nonPayDate;
      if (latest > earliestReleaseDate) {
        earliestReleaseDate = latest;
      }
    }
  }

  await d
    .update(rollingReserves)
    .set({
      status: "HELD",
      separatedAt: new Date(),
      separationType,
      earliestReleaseAt: earliestReleaseDate,
      updatedAt: new Date(),
    })
    .where(eq(rollingReserves.id, reserve.id));

  const [user] = await d
    .select({
      name: users.name,
      ipadIssued: users.ipadIssued,
      ipadReturnedAt: users.ipadReturnedAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  let ipadRecoveryApplied = false;

  if (user?.ipadIssued && !user.ipadReturnedAt) {
    await applyEquipmentRecovery(
      userId,
      "IPAD",
      50000,
      appliedByUserId,
      "iPad not returned at separation",
      d
    );
    ipadRecoveryApplied = true;
  }

  const [updatedReserve] = await d
    .select({ currentBalanceCents: rollingReserves.currentBalanceCents })
    .from(rollingReserves)
    .where(eq(rollingReserves.id, reserve.id));

  const currentBalance = updatedReserve?.currentBalanceCents ?? reserve.currentBalanceCents;

  const formattedDate = earliestReleaseDate.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  await d.insert(reserveTransactions).values({
    reserveId: reserve.id,
    userId,
    transactionType: "CAP_REACHED",
    amountCents: 0,
    isCredit: true,
    balanceAfterCents: currentBalance,
    description: `Reserve held pending maturity period expiry. Earliest release: ${formattedDate}. No early release per policy.`,
  });

  await d
    .update(users)
    .set({ reserveStatus: "HELD" })
    .where(eq(users.id, userId));

  await d.insert(auditLogs).values({
    action: "RESERVE_HELD_SEPARATION",
    tableName: "rolling_reserves",
    recordId: reserve.id,
    afterJson: JSON.stringify({
      separationType,
      reserveBalance: currentBalance,
      earliestReleaseDate: earliestReleaseDate.toISOString(),
      ipadRecoveryApplied,
      repName: user?.name,
    }),
    userId: appliedByUserId,
  });

  return {
    reserveBalance: currentBalance,
    earliestReleaseDate,
    ipadRecoveryApplied,
  };
}

/**
 * FUNCTION 7: checkAndReleaseMaturedReserves
 * Per Policy Section 7: If no chargebacks occur, remaining reserve funds
 * will be released after maturity. No early release is required.
 * Called by the daily scheduler.
 * The rolling reserve is NOT wages — it is a conditional holdback.
 */
export async function checkAndReleaseMaturedReserves(): Promise<{
  released: number;
  totalReleasedCents: number;
}> {
  const now = new Date();

  const heldReserves = await db
    .select()
    .from(rollingReserves)
    .where(
      and(
        eq(rollingReserves.status, "HELD"),
        lte(rollingReserves.earliestReleaseAt, now),
        isNotNull(rollingReserves.separatedAt)
      )
    );

  let released = 0;
  let totalReleasedCents = 0;

  for (const reserve of heldReserves) {
    const pendingChargebacks = await db
      .select({ id: chargebacks.id })
      .from(chargebacks)
      .innerJoin(salesOrders, eq(chargebacks.salesOrderId, salesOrders.id))
      .where(
        and(
          eq(salesOrders.createdByUserId, reserve.userId),
          eq(chargebacks.status, "PENDING")
        )
      )
      .limit(1);

    if (pendingChargebacks.length > 0) continue;

    const immatureOrders = await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.createdByUserId, reserve.userId),
          eq(salesOrders.status, "APPROVED"),
          sql`"maturity_expires_at" IS NOT NULL AND "maturity_expires_at" > NOW()`
        )
      )
      .limit(1);

    if (immatureOrders.length > 0) continue;

    if (reserve.currentBalanceCents <= 0) {
      await db
        .update(rollingReserves)
        .set({ status: "RELEASED", updatedAt: new Date() })
        .where(eq(rollingReserves.id, reserve.id));

      await db
        .update(users)
        .set({ reserveStatus: "RELEASED" })
        .where(eq(users.id, reserve.userId));
      continue;
    }

    const releaseAmount = reserve.currentBalanceCents;

    await db.insert(reserveTransactions).values({
      reserveId: reserve.id,
      userId: reserve.userId,
      transactionType: "RELEASE",
      amountCents: releaseAmount,
      isCredit: false,
      balanceAfterCents: 0,
      description: "Reserve released after maturity period. No outstanding chargebacks.",
    });

    await db
      .update(rollingReserves)
      .set({
        status: "RELEASED",
        currentBalanceCents: 0,
        totalReleasedCents: sql`"total_released_cents" + ${releaseAmount}`,
        updatedAt: new Date(),
      })
      .where(eq(rollingReserves.id, reserve.id));

    await db
      .update(users)
      .set({ reserveStatus: "RELEASED" })
      .where(eq(users.id, reserve.userId));

    const [rep] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, reserve.userId));

    await db.insert(auditLogs).values({
      action: "RESERVE_RELEASED",
      tableName: "rolling_reserves",
      recordId: reserve.id,
      afterJson: JSON.stringify({
        releaseAmount,
        repName: rep?.name,
      }),
    });

    released++;
    totalReleasedCents += releaseAmount;
  }

  return { released, totalReleasedCents };
}

/**
 * Helper: Check if a user has a reserve-eligible role.
 * Per Policy Section 1: Rolling reserve applies to REP, LEAD, MANAGER roles.
 */
export function isReserveEligibleRole(role: string): boolean {
  return RESERVE_ROLES.includes(role);
}
