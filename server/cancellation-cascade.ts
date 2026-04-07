import { eq, and, inArray, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "./db";
import {
  overrideEarnings,
  arExpectations,
  arPayments,
  reserveTransactions,
  rollingReserves,
  payStatementLineItems,
  payStatements,
  payRuns,
  systemExceptions,
  auditLogs,
  salesOrders,
  users,
} from "@shared/schema";

export interface CancellationImpactItem {
  orderId: string;
  orderInvoice: string;
  customerName: string;
  overridesReversed: number;
  overridesReversedAmountCents: number;
  arExpectationsVoided: number;
  reserveReversedCents: number;
  flaggedForReview: boolean;
  flagReason?: string;
  payRunId?: string;
}

export interface CancellationImpact {
  ordersCanceled: number;
  overridesReversedCount: number;
  overridesReversedAmountCents: number;
  arExpectationsVoided: number;
  reserveAdjustedCents: number;
  flaggedForReviewCount: number;
  items: CancellationImpactItem[];
}

export function emptyCancellationImpact(): CancellationImpact {
  return {
    ordersCanceled: 0,
    overridesReversedCount: 0,
    overridesReversedAmountCents: 0,
    arExpectationsVoided: 0,
    reserveAdjustedCents: 0,
    flaggedForReviewCount: 0,
    items: [],
  };
}

export async function cancelOrderCascade(
  orderId: string,
  syncRunId: string,
  actingUserId: string,
  dryRun: boolean = false,
  txDb?: NodePgDatabase
): Promise<CancellationImpactItem> {
  const db = txDb || defaultDb;
  const [order] = await db
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId));

  if (!order) {
    return {
      orderId,
      orderInvoice: "",
      customerName: "",
      overridesReversed: 0,
      overridesReversedAmountCents: 0,
      arExpectationsVoided: 0,
      reserveReversedCents: 0,
      flaggedForReview: false,
    };
  }

  const item: CancellationImpactItem = {
    orderId,
    orderInvoice: order.invoiceNumber || "",
    customerName: order.customerName,
    overridesReversed: 0,
    overridesReversedAmountCents: 0,
    arExpectationsVoided: 0,
    reserveReversedCents: 0,
    flaggedForReview: false,
  };

  if (order.approvalStatus !== "APPROVED") {
    return item;
  }

  const paidLineItems = await db
    .select({
      payStatementId: payStatementLineItems.payStatementId,
      payRunId: payStatements.payRunId,
    })
    .from(payStatementLineItems)
    .innerJoin(payStatements, eq(payStatementLineItems.payStatementId, payStatements.id))
    .where(
      and(
        eq(payStatementLineItems.salesOrderId, orderId),
        isNotNull(payStatements.payRunId)
      )
    );

  const payRunIds = new Set<string>();
  for (const li of paidLineItems) {
    if (li.payRunId) payRunIds.add(li.payRunId);
  }

  if (payRunIds.size > 0) {
    const finalizedPayRuns = await db
      .select({ id: payRuns.id, name: payRuns.name, status: payRuns.status })
      .from(payRuns)
      .where(
        and(
          inArray(payRuns.id, Array.from(payRunIds)),
          eq(payRuns.status, "FINALIZED")
        )
      );

    if (finalizedPayRuns.length > 0) {
      const payRunRef = finalizedPayRuns[0];
      item.flaggedForReview = true;
      item.flagReason = `Order included in finalized pay run "${payRunRef.name || payRunRef.id}". Commission already paid — requires manual chargeback or adjustment.`;
      item.payRunId = payRunRef.id;

      if (!dryRun) {
        const finalizedPayRunIds = finalizedPayRuns.map(pr => pr.id);
        const paidItems = await db
          .select({ amount: payStatementLineItems.amount })
          .from(payStatementLineItems)
          .innerJoin(payStatements, eq(payStatementLineItems.payStatementId, payStatements.id))
          .where(
            and(
              eq(payStatementLineItems.salesOrderId, orderId),
              inArray(payStatements.payRunId, finalizedPayRunIds)
            )
          );
        const commissionPaidCents = paidItems.reduce(
          (sum, li) => sum + Math.round(parseFloat(li.amount || "0") * 100),
          0
        );

        await db.insert(systemExceptions).values({
          exceptionType: "CANCELLATION_PAY_CONFLICT",
          severity: "HIGH",
          title: `Canceled order ${order.invoiceNumber || orderId} was already paid`,
          detail: JSON.stringify({
            orderId,
            invoiceNumber: order.invoiceNumber,
            customerName: order.customerName,
            payRunId: payRunRef.id,
            payRunName: payRunRef.name,
            commissionPaidCents,
            syncRunId,
            recommendedAction: "Create a chargeback or manual adjustment to recover the paid commission.",
          }),
          relatedEntityId: orderId,
          relatedEntityType: "sales_order",
        });

        await db.insert(auditLogs).values({
          action: "cancellation_cascade_flagged",
          tableName: "sales_orders",
          recordId: orderId,
          afterJson: JSON.stringify({
            reason: "Order in finalized pay run",
            payRunId: payRunRef.id,
            syncRunId,
          }),
          userId: actingUserId,
        });
      }

      return item;
    }
  }

  const earnings = await db
    .select()
    .from(overrideEarnings)
    .where(eq(overrideEarnings.salesOrderId, orderId));

  if (earnings.length > 0) {
    item.overridesReversed = earnings.length;
    item.overridesReversedAmountCents = earnings.reduce(
      (sum, e) => sum + Math.round(parseFloat(e.amount) * 100),
      0
    );

    if (!dryRun) {
      await db
        .delete(overrideEarnings)
        .where(eq(overrideEarnings.salesOrderId, orderId));

      for (const earning of earnings) {
        await db.insert(auditLogs).values({
          action: "cancellation_cascade_override_reversed",
          tableName: "override_earnings",
          recordId: earning.id,
          afterJson: JSON.stringify({
            salesOrderId: orderId,
            overrideType: earning.overrideType,
            recipientUserId: earning.recipientUserId,
            amountCents: Math.round(parseFloat(earning.amount) * 100),
            syncRunId,
          }),
          userId: actingUserId,
        });
      }
    }
  }

  const arRecords = await db
    .select()
    .from(arExpectations)
    .where(eq(arExpectations.orderId, orderId));

  for (const ar of arRecords) {
    if (ar.status === "VOID" || ar.status === "WRITTEN_OFF") continue;

    const payments = await db
      .select()
      .from(arPayments)
      .where(eq(arPayments.arExpectationId, ar.id));

    if (payments.length > 0) {
      if (!dryRun) {
        await db.insert(systemExceptions).values({
          exceptionType: "CANCELLATION_AR_PAYMENT_EXISTS",
          severity: "WARNING",
          title: `AR expectation ${ar.id} for canceled order has ${payments.length} payment(s)`,
          detail: JSON.stringify({
            orderId,
            arExpectationId: ar.id,
            paymentCount: payments.length,
            totalPaidCents: payments.reduce((s, p) => s + p.amountCents, 0),
            syncRunId,
          }),
          relatedEntityId: ar.id,
          relatedEntityType: "ar_expectation",
        });
      }
    } else {
      item.arExpectationsVoided++;

      if (!dryRun) {
        await db
          .update(arExpectations)
          .set({
            status: "VOID",
            writtenOffReason: `Voided by cancellation cascade (sync run: ${syncRunId})`,
            updatedAt: new Date(),
          })
          .where(eq(arExpectations.id, ar.id));
      }
    }
  }

  if (!dryRun && item.arExpectationsVoided > 0) {
    await db.insert(auditLogs).values({
      action: "cancellation_cascade_ar_voided",
      tableName: "ar_expectations",
      recordId: orderId,
      afterJson: JSON.stringify({
        voidedCount: item.arExpectationsVoided,
        syncRunId,
      }),
      userId: actingUserId,
    });
  }

  if (order.reserveWithholdingApplied && order.reserveWithheldCents > 0) {
    const rep = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.repId, order.repId));

    if (rep.length > 0) {
      const repUserId = rep[0].id;

      const [reserve] = await db
        .select()
        .from(rollingReserves)
        .where(eq(rollingReserves.userId, repUserId));

      if (reserve) {
        const effectiveReversalCents = Math.min(order.reserveWithheldCents, reserve.currentBalanceCents);
        item.reserveReversedCents = effectiveReversalCents;

        if (!dryRun && effectiveReversalCents > 0) {
          const newBalance = reserve.currentBalanceCents - effectiveReversalCents;

          await db.insert(reserveTransactions).values({
            reserveId: reserve.id,
            userId: repUserId,
            transactionType: "ADJUSTMENT",
            amountCents: effectiveReversalCents,
            isCredit: false,
            balanceAfterCents: newBalance,
            salesOrderId: orderId,
            description: `Reserve reversal for canceled order ${order.invoiceNumber || orderId} (sync run: ${syncRunId})`,
            processedByUserId: actingUserId,
          });

          const newStatus =
            newBalance < reserve.capCents && reserve.status === "AT_CAP"
              ? "ACTIVE"
              : reserve.status;

          await db
            .update(rollingReserves)
            .set({
              currentBalanceCents: newBalance,
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(rollingReserves.id, reserve.id));

          if (newStatus !== reserve.status) {
            await db
              .update(users)
              .set({ reserveStatus: newStatus })
              .where(eq(users.id, repUserId));
          }

          await db
            .update(salesOrders)
            .set({
              reserveWithholdingApplied: false,
              reserveWithheldCents: 0,
            })
            .where(eq(salesOrders.id, orderId));

          await db.insert(auditLogs).values({
            action: "cancellation_cascade_reserve_reversed",
            tableName: "reserve_transactions",
            recordId: orderId,
            afterJson: JSON.stringify({
              reversedCents: effectiveReversalCents,
              newBalance: newBalance,
              syncRunId,
            }),
            userId: actingUserId,
          });
        }
      }
    }
  }

  return item;
}
