import { storage } from "./storage";
import type { TxDb } from "./storage";
import { applyWithholding, getOrCreateReserve, isReserveEligibleRole } from "./reserves/reserveService";
import { db } from "./db";
import { reserveTransactions } from "@shared/schema";
import { eq, sql, and, isNull } from "drizzle-orm";

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
  const stubNumber = `PS-${payRunId.substring(0, 8).toUpperCase()}-${String(stubSeq).padStart(4, "0")}`;

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
  for (const cb of userChargebacks) {
    chargebackTotalCents += Math.round(parseFloat(cb.amount || "0") * 100);
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

  if (isReserveEligibleRole(user.role)) {
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
  const totalDeductions = chargebackTotalCents + deductionTotalCents + advanceTotalCents + totalReserveWithheldCents;
  const netPayCents = grossTotal - totalDeductions;

  let reserveBalanceAfterStr: string | undefined;
  if (totalReserveWithheldCents > 0) {
    try {
      const reserve = await getOrCreateReserve(userId, txDb);
      reserveBalanceAfterStr = (reserve.currentBalanceCents / 100).toFixed(2);
    } catch {}
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
    repEmail: "",
    stubNumber,
    totalOrders,
    totalConnects,
    totalMobileLines,
    isViewableByRep: false,
    companyName: "Iron Crest",
    reserveWithheldTotal: (totalReserveWithheldCents / 100).toFixed(2),
    reserveBalanceAfter: reserveBalanceAfterStr,
    ytdGross: "0",
    ytdDeductions: "0",
    ytdNetPay: "0",
  }, txDb);

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
  const stubNumber = `PS-${payRunId.substring(0, 8).toUpperCase()}-${String(stubSeq).padStart(4, "0")}`;

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
  let chargebackTotalCents = 0;
  for (const cb of chargebacksByRun) {
    const cbOrder = userOrders.find(o => o.id === cb.salesOrderId);
    if (cbOrder) {
      chargebackTotalCents += Math.round(parseFloat(cb.amount || "0") * 100);
    }
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

  if (isReserveEligibleRole(user.role)) {
    for (const order of userOrders) {
      const orderNetCents = Math.round(parseFloat(order.commissionAmount || "0") * 100);
      if (orderNetCents <= 0) continue;

      const withholdingResult = await applyWithholding(userId, order.id, "PENDING", orderNetCents, txDb);

      if (withholdingResult.withheldCents > 0) {
        totalReserveWithheldCents2 += withholdingResult.withheldCents;
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
  const totalDeductionsCalc = chargebackTotalCents + deductionTotalCents + advanceTotalCents + totalReserveWithheldCents2;
  const netPayCents = grossTotal - totalDeductionsCalc;

  let reserveBalanceAfterStr2: string | undefined;
  if (totalReserveWithheldCents2 > 0) {
    try {
      const reserve = await getOrCreateReserve(userId, txDb);
      reserveBalanceAfterStr2 = (reserve.currentBalanceCents / 100).toFixed(2);
    } catch {}
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
    repEmail: "",
    stubNumber,
    totalOrders,
    totalConnects,
    totalMobileLines,
    isViewableByRep: false,
    companyName: "Iron Crest",
    reserveWithheldTotal: (totalReserveWithheldCents2 / 100).toFixed(2),
    reserveBalanceAfter: reserveBalanceAfterStr2,
    ytdGross: "0",
    ytdDeductions: "0",
    ytdNetPay: "0",
  }, txDb);

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
