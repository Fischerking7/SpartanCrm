import { storage } from "./storage";
import type { TxDb } from "./storage";
import { applyWithholding, getOrCreateReserve, isReserveEligibleRole } from "./reserves/reserveService";
import { db } from "./db";
import { reserveTransactions, payStatements } from "@shared/schema";
import { eq, sql, and, isNull } from "drizzle-orm";

async function computeYtd(userId: string, periodEnd: string, excludeStatementId?: string, txDb?: TxDb) {
  const d = txDb ?? db;
  const year = periodEnd.substring(0, 4);
  const yearStart = `${year}-01-01`;
  const conditions = [
    eq(payStatements.userId, userId),
    sql`${payStatements.periodEnd} >= ${yearStart}`,
    sql`${payStatements.periodEnd} < ${periodEnd}`,
  ];
  if (excludeStatementId) {
    conditions.push(sql`${payStatements.id} != ${excludeStatementId}`);
  }
  const priorStubs = await d.select().from(payStatements).where(and(...conditions));
  let ytdGrossCents = 0;
  let ytdDeductionsCents = 0;
  let ytdNetCents = 0;
  for (const s of priorStubs) {
    ytdGrossCents += Math.round(parseFloat(s.grossCommission || "0") * 100)
      + Math.round(parseFloat(s.overrideEarningsTotal || "0") * 100)
      + Math.round(parseFloat(s.bonusesTotal || "0") * 100)
      + Math.round(parseFloat(s.incentivesTotal || "0") * 100);
    ytdDeductionsCents += Math.round(parseFloat(s.chargebacksTotal || "0") * 100)
      + Math.round(parseFloat(s.deductionsTotal || "0") * 100)
      + Math.round(parseFloat(s.advancesApplied || "0") * 100);
    ytdNetCents += Math.round(parseFloat(s.netPay || "0") * 100);
  }
  return { ytdGrossCents, ytdDeductionsCents, ytdNetCents };
}

function buildStubNumber(periodEnd: string, userRepId: string, seq: number): string {
  const d = new Date(periodEnd + "T00:00:00Z");
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `STUB-${ym}-${userRepId}-${String(seq).padStart(4, "0")}`;
}

interface PayStubResult {
  payStatementId: string;
  userId: string;
  stubNumber: string;
  grossCommission: string;
  overrideEarningsTotal: string;
  bonusesTotal: string;
  chargebacksTotal: string;
  deductionsTotal: string;
  advancesApplied: string;
  netPay: string;
  totalOrders: number;
  totalConnects: number;
  totalMobileLines: number;
  lineItems: number;
}

interface ReserveWithholdingPerOrder {
  orderId: string;
  withheldCents: number;
  capReached: boolean;
}

export async function generatePayStub(
  payRunId: string,
  userId: string,
  periodStart: string,
  periodEnd: string,
  txDb?: TxDb
): Promise<PayStubResult> {
  const user = await storage.getUserById(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const stubSeq = await storage.getNextStubSequence(payRunId, txDb);
  const stubNumber = buildStubNumber(periodEnd, user.repId, stubSeq);

  const readyOrders = await storage.getPayrollReadyOrdersForUser(userId, periodStart, periodEnd);

  let grossCommissionCents = 0;
  let totalOrders = 0;
  let totalConnects = 0;
  let totalMobileLines = 0;

  for (const { order, client, provider, service } of readyOrders) {
    const commAmount = order.commissionAmount ? parseFloat(order.commissionAmount) : 0;
    grossCommissionCents += Math.round(commAmount * 100);
    totalOrders++;
    if (order.jobStatus === "COMPLETED") totalConnects++;
    if (order.mobileLinesQty) totalMobileLines += order.mobileLinesQty;
  }

  const overrideEarnings = await storage.getApprovedOverrideEarningsForUser(userId, periodStart, periodEnd);
  let overrideTotalCents = 0;
  for (const oe of overrideEarnings) {
    overrideTotalCents += oe.amountCents || 0;
  }

  const pendingBonuses = await storage.getPendingBonusesForPayRun(periodEnd);
  const userBonuses = pendingBonuses.filter(b => b.user.id === userId);
  let bonusTotalCents = 0;
  for (const { bonus } of userBonuses) {
    bonusTotalCents += Math.round(parseFloat(bonus.amount) * 100);
  }

  const chargebacks = await storage.getChargebacksByPayRun(payRunId);
  const userOrderIds = readyOrders.map(r => r.order.id);
  const userChargebacks = chargebacks.filter(c => c.salesOrderId && userOrderIds.includes(c.salesOrderId));
  let chargebackTotalCents = 0;
  let chargebackNetPayImpactCents = 0;
  for (const cb of userChargebacks) {
    const cbAmount = Math.round(parseFloat(cb.amount || "0") * 100);
    const reserveOffset = cb.reserveOffsetCents || 0;
    chargebackTotalCents += cbAmount;
    chargebackNetPayImpactCents += Math.max(0, cbAmount - reserveOffset);
  }

  const deductions = await storage.getActiveUserDeductions(userId);
  let deductionTotalCents = 0;
  for (const d of deductions) {
    if (d.amount) deductionTotalCents += Math.round(parseFloat(d.amount) * 100);
  }

  const advances = await storage.getActiveAdvancesForUser(userId);
  let advanceTotalCents = 0;
  for (const a of advances) {
    if (a.remainingBalance && parseFloat(a.remainingBalance) > 0) {
      advanceTotalCents += Math.round(parseFloat(a.remainingBalance) * 100);
    }
  }

  let totalReserveWithheldCents = 0;
  const reserveLineItems: Array<{ category: string; description: string; salesOrderId?: string; invoiceNumber?: string; amount: string }> = [];
  const reservePerOrder: ReserveWithholdingPerOrder[] = [];
  let reservePreviousBalanceCents: number | null = null;

  if (isReserveEligibleRole(user.role)) {
    try {
      const reserveBefore = await getOrCreateReserve(userId, txDb);
      reservePreviousBalanceCents = reserveBefore.currentBalanceCents;
    } catch {}

    for (const { order } of readyOrders) {
      const orderNetCents = Math.round(
        (parseFloat(order.commissionAmount || "0")) * 100
      );
      if (orderNetCents <= 0) continue;

      const withholdingResult = await applyWithholding(
        userId,
        order.id,
        "PENDING",
        orderNetCents,
        txDb
      );

      if (withholdingResult.withheldCents > 0) {
        totalReserveWithheldCents += withholdingResult.withheldCents;
        reservePerOrder.push({
          orderId: order.id,
          withheldCents: withholdingResult.withheldCents,
          capReached: withholdingResult.capReached,
        });
        reserveLineItems.push({
          category: "Reserve Withholding",
          description: `15% reserve hold — ${order.invoiceNumber || order.id}`,
          salesOrderId: order.id,
          invoiceNumber: order.invoiceNumber || undefined,
          amount: `-${(withholdingResult.withheldCents / 100).toFixed(2)}`,
        });

        if (withholdingResult.capReached) {
          reserveLineItems.push({
            category: "Reserve Withholding",
            description: "Rolling reserve cap of $2,500 reached. Withholding paused.",
            amount: "0.00",
          });
        }
      }
    }
  }

  const grossTotal = grossCommissionCents + overrideTotalCents + bonusTotalCents;
  const totalDeductions = chargebackNetPayImpactCents + deductionTotalCents + advanceTotalCents + totalReserveWithheldCents;
  const netPayCents = grossTotal - totalDeductions;

  let reserveBalanceAfterStr: string | undefined;
  let reserveCapStr: string | undefined;
  let reserveStatusStr: string | undefined;
  let reserveChargebacksOffsetCents = 0;
  if (isReserveEligibleRole(user.role)) {
    try {
      const reserve = await getOrCreateReserve(userId, txDb);
      reserveBalanceAfterStr = (reserve.currentBalanceCents / 100).toFixed(2);
      reserveCapStr = (reserve.capCents / 100).toFixed(2);
      reserveStatusStr = reserve.status === "AT_CAP" ? "AT CAP — Withholding Paused"
        : reserve.status === "HELD" ? "HELD — Pending Maturity Release"
        : reserve.status === "DEFICIT" ? "DEFICIT — Withholding Resumed"
        : `ACTIVE — Withholding ${reserve.withholdingPercent}%`;
    } catch {}

    for (const cb of userChargebacks) {
      reserveChargebacksOffsetCents += cb.reserveOffsetCents || 0;
    }
  }

  const statement = await storage.createPayStatement({
    payRunId,
    userId,
    periodStart,
    periodEnd,
    grossCommission: (grossCommissionCents / 100).toFixed(2),
    overrideEarningsTotal: (overrideTotalCents / 100).toFixed(2),
    bonusesTotal: (bonusTotalCents / 100).toFixed(2),
    incentivesTotal: "0",
    chargebacksTotal: (chargebackTotalCents / 100).toFixed(2),
    adjustmentsTotal: "0",
    deductionsTotal: (deductionTotalCents / 100).toFixed(2),
    advancesApplied: (advanceTotalCents / 100).toFixed(2),
    taxWithheld: "0",
    netPay: (netPayCents / 100).toFixed(2),
    repName: user.name || "",
    repId: user.id,
    repRole: user.role,
    repEmail: user.email || "",
    stubNumber,
    totalOrders,
    totalConnects,
    totalMobileLines,
    isViewableByRep: false,
    companyName: "Iron Crest",
    reserveWithheldTotal: (totalReserveWithheldCents / 100).toFixed(2),
    reserveBalanceAfter: reserveBalanceAfterStr,
    reservePreviousBalance: reservePreviousBalanceCents !== null ? (reservePreviousBalanceCents / 100).toFixed(2) : undefined,
    reserveChargebacksOffset: reserveChargebacksOffsetCents > 0 ? (reserveChargebacksOffsetCents / 100).toFixed(2) : "0",
    reserveCapAmount: reserveCapStr,
    reserveStatusLabel: reserveStatusStr,
  }, txDb);

  const ytd = await computeYtd(userId, periodEnd, statement.id, txDb);
  const currentGross = grossCommissionCents + overrideTotalCents + bonusTotalCents;
  const currentDeductions = chargebackTotalCents + deductionTotalCents + advanceTotalCents;
  await storage.updatePayStatement(statement.id, {
    ytdGross: ((ytd.ytdGrossCents + currentGross) / 100).toFixed(2),
    ytdDeductions: ((ytd.ytdDeductionsCents + currentDeductions) / 100).toFixed(2),
    ytdNetPay: ((ytd.ytdNetCents + netPayCents) / 100).toFixed(2),
  } as any, txDb);

  if (totalReserveWithheldCents > 0) {
    const d = txDb ?? db;
    await d
      .update(reserveTransactions)
      .set({ payStatementId: statement.id })
      .where(and(
        eq(reserveTransactions.userId, userId),
        eq(reserveTransactions.transactionType, "WITHHOLDING"),
        isNull(reserveTransactions.payStatementId)
      ));
  }

  let lineItemCount = 0;

  for (const { order, client, provider, service } of readyOrders) {
    const commAmount = order.commissionAmount ? parseFloat(order.commissionAmount) : 0;
    const commCents = Math.round(commAmount * 100);
    const withheldForThisOrder = reservePerOrder.find(r => r.orderId === order.id)?.withheldCents || 0;
    const netForOrder = (commCents - withheldForThisOrder) / 100;

    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: "COMMISSION",
      description: `Commission - ${order.invoiceNumber || "Order"}`,
      sourceType: "SALES_ORDER",
      sourceId: order.id,
      salesOrderId: order.id,
      invoiceNumber: order.invoiceNumber || undefined,
      customerName: client?.name || undefined,
      dateSold: order.saleDate || undefined,
      serviceDescription: service?.name || undefined,
      providerName: provider?.name || undefined,
      installDate: order.installDate || undefined,
      repRoleAtSale: order.repRoleAtSale || undefined,
      amount: commAmount.toFixed(2),
      netAmount: netForOrder.toFixed(2),
      reserveWithheldForOrder: withheldForThisOrder > 0 ? (withheldForThisOrder / 100).toFixed(2) : undefined,
    }, txDb);
    lineItemCount++;
  }

  for (const rli of reserveLineItems) {
    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: rli.category,
      description: rli.description,
      sourceType: "RESERVE_WITHHOLDING",
      salesOrderId: rli.salesOrderId,
      invoiceNumber: rli.invoiceNumber,
      amount: rli.amount,
    }, txDb);
    lineItemCount++;
  }

  for (const oe of overrideEarnings) {
    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: "OVERRIDE",
      description: `${oe.overrideType} Override`,
      sourceType: "OVERRIDE_EARNING",
      sourceId: oe.id,
      amount: ((oe.amountCents || 0) / 100).toFixed(2),
    }, txDb);
    lineItemCount++;
  }

  for (const { bonus } of userBonuses) {
    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: "BONUS",
      description: bonus.description || "Bonus",
      sourceType: "BONUS",
      sourceId: bonus.id,
      amount: parseFloat(bonus.amount).toFixed(2),
    }, txDb);
    lineItemCount++;
    await storage.linkBonusToPayRun(bonus.id, payRunId);
  }

  for (const cb of userChargebacks) {
    const cbAmountCents = Math.round(parseFloat(cb.amount || "0") * 100);
    const fromReserveCents = Math.min(cb.reserveOffsetCents || 0, cbAmountCents);
    const fromNetPayCents = Math.max(0, cbAmountCents - fromReserveCents);
    const isSplit = fromReserveCents > 0 && fromNetPayCents > 0;
    const cbLabel = cb.invoiceNumber || cb.salesOrderId || "Order";

    if (isSplit) {
      await storage.createPayStatementLineItemFull({
        payStatementId: statement.id,
        category: "CHARGEBACK",
        description: `Chargeback — ${cbLabel} (Deducted from Reserve)`,
        sourceType: "CHARGEBACK",
        sourceId: cb.id,
        salesOrderId: cb.salesOrderId || undefined,
        invoiceNumber: cb.invoiceNumber || undefined,
        amount: `-${(fromReserveCents / 100).toFixed(2)}`,
        chargebackSource: "FROM_RESERVE",
        chargebackFromReserveCents: fromReserveCents,
        chargebackFromNetPayCents: 0,
      }, txDb);
      lineItemCount++;

      await storage.createPayStatementLineItemFull({
        payStatementId: statement.id,
        category: "CHARGEBACK",
        description: `Chargeback — ${cbLabel} (Deducted from Net Pay)`,
        sourceType: "CHARGEBACK",
        sourceId: cb.id,
        salesOrderId: cb.salesOrderId || undefined,
        invoiceNumber: cb.invoiceNumber || undefined,
        amount: `-${(fromNetPayCents / 100).toFixed(2)}`,
        chargebackSource: "FROM_NET_PAY",
        chargebackFromReserveCents: 0,
        chargebackFromNetPayCents: fromNetPayCents,
      }, txDb);
      lineItemCount++;
    } else {
      const chargebackSource = fromReserveCents > 0 ? "FROM_RESERVE" : "FROM_NET_PAY";
      const sourceLabel = fromReserveCents > 0 ? "Deducted from Reserve" : "Deducted from Net Pay";
      await storage.createPayStatementLineItemFull({
        payStatementId: statement.id,
        category: "CHARGEBACK",
        description: `Chargeback — ${cbLabel} (${sourceLabel})`,
        sourceType: "CHARGEBACK",
        sourceId: cb.id,
        salesOrderId: cb.salesOrderId || undefined,
        invoiceNumber: cb.invoiceNumber || undefined,
        amount: `-${(cbAmountCents / 100).toFixed(2)}`,
        chargebackSource,
        chargebackFromReserveCents: fromReserveCents,
        chargebackFromNetPayCents: fromNetPayCents,
      }, txDb);
      lineItemCount++;
    }
  }

  for (const d of deductions) {
    if (d.amount && parseFloat(d.amount) > 0) {
      await storage.createPayStatementDeduction({
        payStatementId: statement.id,
        userDeductionId: d.id,
        deductionTypeName: d.deductionTypeName || "Deduction",
        amount: parseFloat(d.amount).toFixed(2),
      });
    }
  }

  for (const a of advances) {
    if (a.remainingBalance && parseFloat(a.remainingBalance) > 0) {
      await storage.createAdvanceRepayment({
        advanceId: a.id,
        payStatementId: statement.id,
        amountApplied: parseFloat(a.remainingBalance).toFixed(2),
      });
    }
  }

  return {
    payStatementId: statement.id,
    userId,
    stubNumber,
    grossCommission: (grossCommissionCents / 100).toFixed(2),
    overrideEarningsTotal: (overrideTotalCents / 100).toFixed(2),
    bonusesTotal: (bonusTotalCents / 100).toFixed(2),
    chargebacksTotal: (chargebackTotalCents / 100).toFixed(2),
    deductionsTotal: (deductionTotalCents / 100).toFixed(2),
    advancesApplied: (advanceTotalCents / 100).toFixed(2),
    netPay: (netPayCents / 100).toFixed(2),
    totalOrders,
    totalConnects,
    totalMobileLines,
    lineItems: lineItemCount,
  };
}

export async function generatePayStubsForPayRun(
  payRunId: string,
  periodStart: string,
  periodEnd: string,
  txDb?: TxDb
): Promise<PayStubResult[]> {
  const payRunOrders = await storage.getOrdersByPayRunId(payRunId);
  const userIds = [...new Set(payRunOrders.map(o => o.userId))];

  const results: PayStubResult[] = [];
  for (const userId of userIds) {
    try {
      const result = await generatePayStubFromPayRun(payRunId, userId, periodStart, periodEnd, txDb);
      results.push(result);
    } catch (error) {
      console.error(`Failed to generate pay stub for user ${userId}:`, error);
    }
  }

  return results;
}

async function generatePayStubFromPayRun(
  payRunId: string,
  userId: string,
  periodStart: string,
  periodEnd: string,
  txDb?: TxDb
): Promise<PayStubResult> {
  const user = await storage.getUserById(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const stubSeq = await storage.getNextStubSequence(payRunId, txDb);
  const stubNumber = buildStubNumber(periodEnd, user.repId, stubSeq);

  const allPayRunOrders = await storage.getOrdersByPayRunId(payRunId);
  const userOrders = allPayRunOrders.filter(o => o.userId === userId);

  let grossCommissionCents = 0;
  let totalOrders = 0;
  let totalConnects = 0;
  let totalMobileLines = 0;

  for (const order of userOrders) {
    const commAmount = order.commissionAmount ? parseFloat(order.commissionAmount) : 0;
    grossCommissionCents += Math.round(commAmount * 100);
    totalOrders++;
    if (order.jobStatus === "COMPLETED") totalConnects++;
    if (order.mobileLinesQty) totalMobileLines += order.mobileLinesQty;
  }

  const overrideEarnings = await storage.getApprovedOverrideEarningsForUser(userId, periodStart, periodEnd);
  let overrideTotalCents = 0;
  for (const oe of overrideEarnings) {
    overrideTotalCents += oe.amountCents || 0;
  }

  const pendingBonuses = await storage.getPendingBonusesForPayRun(periodEnd);
  const userBonuses = pendingBonuses.filter(b => b.user.id === userId);
  let bonusTotalCents = 0;
  for (const { bonus } of userBonuses) {
    bonusTotalCents += Math.round(parseFloat(bonus.amount) * 100);
  }

  const chargebacksByRun = await storage.getChargebacksByPayRun(payRunId);
  const userChargebacks = chargebacksByRun.filter(c => {
    const cbOrder = userOrders.find(o => o.id === c.salesOrderId);
    return !!cbOrder;
  });
  let chargebackTotalCents = 0;
  let chargebackNetPayImpactCents2 = 0;
  for (const cb of userChargebacks) {
    const cbAmount = Math.round(parseFloat(cb.amount || "0") * 100);
    const reserveOffset = cb.reserveOffsetCents || 0;
    chargebackTotalCents += cbAmount;
    chargebackNetPayImpactCents2 += Math.max(0, cbAmount - reserveOffset);
  }

  const deductions = await storage.getActiveUserDeductions(userId);
  let deductionTotalCents = 0;
  for (const d of deductions) {
    if (d.amount) deductionTotalCents += Math.round(parseFloat(d.amount) * 100);
  }

  const advances = await storage.getActiveAdvancesForUser(userId);
  let advanceTotalCents = 0;
  for (const a of advances) {
    if (a.remainingBalance && parseFloat(a.remainingBalance) > 0) {
      advanceTotalCents += Math.round(parseFloat(a.remainingBalance) * 100);
    }
  }

  let totalReserveWithheldCents2 = 0;
  const reserveLineItems2: Array<{ category: string; description: string; salesOrderId?: string; invoiceNumber?: string; amount: string }> = [];
  const reservePerOrder2: ReserveWithholdingPerOrder[] = [];
  let reservePreviousBalanceCents2: number | null = null;

  if (isReserveEligibleRole(user.role)) {
    try {
      const reserveBefore = await getOrCreateReserve(userId, txDb);
      reservePreviousBalanceCents2 = reserveBefore.currentBalanceCents;
    } catch {}

    for (const order of userOrders) {
      const orderNetCents = Math.round(parseFloat(order.commissionAmount || "0") * 100);
      if (orderNetCents <= 0) continue;

      const withholdingResult = await applyWithholding(userId, order.id, "PENDING", orderNetCents, txDb);

      if (withholdingResult.withheldCents > 0) {
        totalReserveWithheldCents2 += withholdingResult.withheldCents;
        reservePerOrder2.push({
          orderId: order.id,
          withheldCents: withholdingResult.withheldCents,
          capReached: withholdingResult.capReached,
        });
        reserveLineItems2.push({
          category: "Reserve Withholding",
          description: `15% reserve hold — ${order.invoiceNumber || order.id}`,
          salesOrderId: order.id,
          invoiceNumber: order.invoiceNumber || undefined,
          amount: `-${(withholdingResult.withheldCents / 100).toFixed(2)}`,
        });
        if (withholdingResult.capReached) {
          reserveLineItems2.push({
            category: "Reserve Withholding",
            description: "Rolling reserve cap of $2,500 reached. Withholding paused.",
            amount: "0.00",
          });
        }
      }
    }
  }

  const grossTotal = grossCommissionCents + overrideTotalCents + bonusTotalCents;
  const totalDeductionsCalc = chargebackNetPayImpactCents2 + deductionTotalCents + advanceTotalCents + totalReserveWithheldCents2;
  const netPayCents = grossTotal - totalDeductionsCalc;

  let reserveBalanceAfterStr2: string | undefined;
  let reserveCapStr2: string | undefined;
  let reserveStatusStr2: string | undefined;
  let reserveChargebacksOffsetCents2 = 0;
  if (isReserveEligibleRole(user.role)) {
    try {
      const reserve = await getOrCreateReserve(userId, txDb);
      reserveBalanceAfterStr2 = (reserve.currentBalanceCents / 100).toFixed(2);
      reserveCapStr2 = (reserve.capCents / 100).toFixed(2);
      reserveStatusStr2 = reserve.status === "AT_CAP" ? "AT CAP — Withholding Paused"
        : reserve.status === "HELD" ? "HELD — Pending Maturity Release"
        : reserve.status === "DEFICIT" ? "DEFICIT — Withholding Resumed"
        : `ACTIVE — Withholding ${reserve.withholdingPercent}%`;
    } catch {}

    for (const cb of userChargebacks) {
      reserveChargebacksOffsetCents2 += cb.reserveOffsetCents || 0;
    }
  }

  const statement = await storage.createPayStatement({
    payRunId,
    userId,
    periodStart,
    periodEnd,
    grossCommission: (grossCommissionCents / 100).toFixed(2),
    overrideEarningsTotal: (overrideTotalCents / 100).toFixed(2),
    bonusesTotal: (bonusTotalCents / 100).toFixed(2),
    incentivesTotal: "0",
    chargebacksTotal: (chargebackTotalCents / 100).toFixed(2),
    adjustmentsTotal: "0",
    deductionsTotal: (deductionTotalCents / 100).toFixed(2),
    advancesApplied: (advanceTotalCents / 100).toFixed(2),
    taxWithheld: "0",
    netPay: (netPayCents / 100).toFixed(2),
    repName: user.name || "",
    repId: user.id,
    repRole: user.role,
    repEmail: user.email || "",
    stubNumber,
    totalOrders,
    totalConnects,
    totalMobileLines,
    isViewableByRep: false,
    companyName: "Iron Crest",
    reserveWithheldTotal: (totalReserveWithheldCents2 / 100).toFixed(2),
    reserveBalanceAfter: reserveBalanceAfterStr2,
    reservePreviousBalance: reservePreviousBalanceCents2 !== null ? (reservePreviousBalanceCents2 / 100).toFixed(2) : undefined,
    reserveChargebacksOffset: reserveChargebacksOffsetCents2 > 0 ? (reserveChargebacksOffsetCents2 / 100).toFixed(2) : "0",
    reserveCapAmount: reserveCapStr2,
    reserveStatusLabel: reserveStatusStr2,
  }, txDb);

  const ytd2 = await computeYtd(userId, periodEnd, statement.id, txDb);
  const currentGross2 = grossCommissionCents + overrideTotalCents + bonusTotalCents;
  const currentDeductions2 = chargebackTotalCents + deductionTotalCents + advanceTotalCents;
  await storage.updatePayStatement(statement.id, {
    ytdGross: ((ytd2.ytdGrossCents + currentGross2) / 100).toFixed(2),
    ytdDeductions: ((ytd2.ytdDeductionsCents + currentDeductions2) / 100).toFixed(2),
    ytdNetPay: ((ytd2.ytdNetCents + netPayCents) / 100).toFixed(2),
  } as any, txDb);

  if (totalReserveWithheldCents2 > 0) {
    const d2 = txDb ?? db;
    await d2
      .update(reserveTransactions)
      .set({ payStatementId: statement.id })
      .where(and(
        eq(reserveTransactions.userId, userId),
        eq(reserveTransactions.transactionType, "WITHHOLDING"),
        isNull(reserveTransactions.payStatementId)
      ));
  }

  let lineItemCount = 0;

  for (const order of userOrders) {
    const commAmount = order.commissionAmount ? parseFloat(order.commissionAmount) : 0;
    const commCents = Math.round(commAmount * 100);
    const withheldForThisOrder = reservePerOrder2.find(r => r.orderId === order.id)?.withheldCents || 0;
    const netForOrder = (commCents - withheldForThisOrder) / 100;

    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: "COMMISSION",
      description: `Commission - ${order.invoiceNumber || "Order"}`,
      sourceType: "SALES_ORDER",
      sourceId: order.id,
      salesOrderId: order.id,
      invoiceNumber: order.invoiceNumber || undefined,
      customerName: order.customerName || undefined,
      dateSold: order.saleDate || undefined,
      installDate: order.installDate || undefined,
      repRoleAtSale: order.repRoleAtSale || undefined,
      amount: commAmount.toFixed(2),
      netAmount: netForOrder.toFixed(2),
      reserveWithheldForOrder: withheldForThisOrder > 0 ? (withheldForThisOrder / 100).toFixed(2) : undefined,
    }, txDb);
    lineItemCount++;
  }

  for (const rli of reserveLineItems2) {
    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: rli.category,
      description: rli.description,
      sourceType: "RESERVE_WITHHOLDING",
      salesOrderId: rli.salesOrderId,
      invoiceNumber: rli.invoiceNumber,
      amount: rli.amount,
    }, txDb);
    lineItemCount++;
  }

  for (const oe of overrideEarnings) {
    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: "OVERRIDE",
      description: `${oe.overrideType} Override`,
      sourceType: "OVERRIDE_EARNING",
      sourceId: oe.id,
      amount: ((oe.amountCents || 0) / 100).toFixed(2),
    }, txDb);
    lineItemCount++;
  }

  for (const { bonus } of userBonuses) {
    await storage.createPayStatementLineItemFull({
      payStatementId: statement.id,
      category: "BONUS",
      description: bonus.description || "Bonus",
      sourceType: "BONUS",
      sourceId: bonus.id,
      amount: parseFloat(bonus.amount).toFixed(2),
    }, txDb);
    lineItemCount++;
    await storage.linkBonusToPayRun(bonus.id, payRunId);
  }

  for (const cb of userChargebacks) {
    const cbAmountCents = Math.round(parseFloat(cb.amount || "0") * 100);
    const fromReserveCents = Math.min(cb.reserveOffsetCents || 0, cbAmountCents);
    const fromNetPayCents = Math.max(0, cbAmountCents - fromReserveCents);
    const isSplit = fromReserveCents > 0 && fromNetPayCents > 0;
    const cbLabel = cb.invoiceNumber || cb.salesOrderId || "Order";

    if (isSplit) {
      await storage.createPayStatementLineItemFull({
        payStatementId: statement.id,
        category: "CHARGEBACK",
        description: `Chargeback — ${cbLabel} (Deducted from Reserve)`,
        sourceType: "CHARGEBACK",
        sourceId: cb.id,
        salesOrderId: cb.salesOrderId || undefined,
        invoiceNumber: cb.invoiceNumber || undefined,
        amount: `-${(fromReserveCents / 100).toFixed(2)}`,
        chargebackSource: "FROM_RESERVE",
        chargebackFromReserveCents: fromReserveCents,
        chargebackFromNetPayCents: 0,
      }, txDb);
      lineItemCount++;

      await storage.createPayStatementLineItemFull({
        payStatementId: statement.id,
        category: "CHARGEBACK",
        description: `Chargeback — ${cbLabel} (Deducted from Net Pay)`,
        sourceType: "CHARGEBACK",
        sourceId: cb.id,
        salesOrderId: cb.salesOrderId || undefined,
        invoiceNumber: cb.invoiceNumber || undefined,
        amount: `-${(fromNetPayCents / 100).toFixed(2)}`,
        chargebackSource: "FROM_NET_PAY",
        chargebackFromReserveCents: 0,
        chargebackFromNetPayCents: fromNetPayCents,
      }, txDb);
      lineItemCount++;
    } else {
      const chargebackSource = fromReserveCents > 0 ? "FROM_RESERVE" : "FROM_NET_PAY";
      const sourceLabel = fromReserveCents > 0 ? "Deducted from Reserve" : "Deducted from Net Pay";
      await storage.createPayStatementLineItemFull({
        payStatementId: statement.id,
        category: "CHARGEBACK",
        description: `Chargeback — ${cbLabel} (${sourceLabel})`,
        sourceType: "CHARGEBACK",
        sourceId: cb.id,
        salesOrderId: cb.salesOrderId || undefined,
        invoiceNumber: cb.invoiceNumber || undefined,
        amount: `-${(cbAmountCents / 100).toFixed(2)}`,
        chargebackSource,
        chargebackFromReserveCents: fromReserveCents,
        chargebackFromNetPayCents: fromNetPayCents,
      }, txDb);
      lineItemCount++;
    }
  }

  for (const d of deductions) {
    if (d.amount && parseFloat(d.amount) > 0) {
      await storage.createPayStatementDeduction({
        payStatementId: statement.id,
        userDeductionId: d.id,
        deductionTypeName: d.deductionTypeName || "Deduction",
        amount: parseFloat(d.amount).toFixed(2),
      });
    }
  }

  for (const a of advances) {
    if (a.remainingBalance && parseFloat(a.remainingBalance) > 0) {
      await storage.createAdvanceRepayment({
        advanceId: a.id,
        payStatementId: statement.id,
        amountApplied: parseFloat(a.remainingBalance).toFixed(2),
      });
    }
  }

  return {
    payStatementId: statement.id,
    userId,
    stubNumber,
    grossCommission: (grossCommissionCents / 100).toFixed(2),
    overrideEarningsTotal: (overrideTotalCents / 100).toFixed(2),
    bonusesTotal: (bonusTotalCents / 100).toFixed(2),
    chargebacksTotal: (chargebackTotalCents / 100).toFixed(2),
    deductionsTotal: (deductionTotalCents / 100).toFixed(2),
    advancesApplied: (advanceTotalCents / 100).toFixed(2),
    netPay: (netPayCents / 100).toFixed(2),
    totalOrders,
    totalConnects,
    totalMobileLines,
    lineItems: lineItemCount,
  };
}
