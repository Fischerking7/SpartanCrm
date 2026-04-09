import { db } from "./db";
import { salesOrders, chargebacks } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";
import { getSimplifiedOrderStatus } from "../shared/order-status";

const DISPUTED_CHARGEBACK_TYPES = new Set(["DISPUTED", "IN_DISPUTE", "DISPUTE"]);

/**
 * A chargeback is considered "active/unresolved" if it has not yet been processed
 * through a pay run (payRunId IS NULL means it hasn't been applied/deducted yet).
 */
function isActiveChargeback(cb: { payRunId: string | null }): boolean {
  return cb.payRunId === null;
}

export async function computeAndPersistSimplifiedStatus(orderId: string): Promise<void> {
  const [order] = await db.select({
    id: salesOrders.id,
    jobStatus: salesOrders.jobStatus,
    approvalStatus: salesOrders.approvalStatus,
    paymentStatus: salesOrders.paymentStatus,
    payrollReadyAt: salesOrders.payrollReadyAt,
  }).from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);

  if (!order) return;

  const orderChargebacks = await db.select({
    id: chargebacks.id,
    chargebackType: chargebacks.chargebackType,
    payRunId: chargebacks.payRunId,
  }).from(chargebacks).where(eq(chargebacks.salesOrderId, orderId));

  const activeChargebacks = orderChargebacks.filter(isActiveChargeback);
  const hasActiveChargeback = activeChargebacks.length > 0;
  const hasDisputedChargeback = activeChargebacks.some(
    cb => cb.chargebackType && DISPUTED_CHARGEBACK_TYPES.has(cb.chargebackType.toUpperCase())
  );

  const status = getSimplifiedOrderStatus({
    jobStatus: order.jobStatus,
    approvalStatus: order.approvalStatus,
    paymentStatus: order.paymentStatus,
    payrollReadyAt: order.payrollReadyAt,
    hasActiveChargeback,
    hasDisputedChargeback,
  });

  await db.update(salesOrders).set({
    simplifiedStatus: status,
    hasActiveChargeback,
    hasDisputedChargeback,
    updatedAt: new Date(),
  }).where(eq(salesOrders.id, orderId));
}

export async function computeAndPersistSimplifiedStatusForRep(repId: string): Promise<void> {
  const orders = await db.select({
    id: salesOrders.id,
    jobStatus: salesOrders.jobStatus,
    approvalStatus: salesOrders.approvalStatus,
    paymentStatus: salesOrders.paymentStatus,
    payrollReadyAt: salesOrders.payrollReadyAt,
  }).from(salesOrders).where(eq(salesOrders.repId, repId));

  const repChargebacks = await db.select({
    salesOrderId: chargebacks.salesOrderId,
    chargebackType: chargebacks.chargebackType,
    payRunId: chargebacks.payRunId,
  }).from(chargebacks).where(eq(chargebacks.repId, repId));

  const chargebacksByOrder = new Map<string, typeof repChargebacks>();
  for (const cb of repChargebacks) {
    if (!cb.salesOrderId) continue;
    if (!chargebacksByOrder.has(cb.salesOrderId)) chargebacksByOrder.set(cb.salesOrderId, []);
    chargebacksByOrder.get(cb.salesOrderId)!.push(cb);
  }

  for (const order of orders) {
    const orderCbs = chargebacksByOrder.get(order.id) || [];
    const activeOrderCbs = orderCbs.filter(isActiveChargeback);
    const hasActiveChargeback = activeOrderCbs.length > 0;
    const hasDisputedChargeback = activeOrderCbs.some(
      cb => cb.chargebackType && DISPUTED_CHARGEBACK_TYPES.has(cb.chargebackType.toUpperCase())
    );

    const status = getSimplifiedOrderStatus({
      jobStatus: order.jobStatus,
      approvalStatus: order.approvalStatus,
      paymentStatus: order.paymentStatus,
      payrollReadyAt: order.payrollReadyAt,
      hasActiveChargeback,
      hasDisputedChargeback,
    });

    await db.update(salesOrders).set({
      simplifiedStatus: status,
      hasActiveChargeback,
      hasDisputedChargeback,
      updatedAt: new Date(),
    }).where(eq(salesOrders.id, order.id));
  }
}
