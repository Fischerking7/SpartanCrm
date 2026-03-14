import { db } from "./db";
import { salesOrders, chargebacks, users } from "@shared/schema";
import { eq, sql, and, gte, inArray } from "drizzle-orm";

interface RiskFactor {
  factor: string;
  weight: number;
  triggered: boolean;
  detail?: string;
}

export async function scoreChargebackRisk(orderId: string): Promise<{ score: number; factors: RiskFactor[] }> {
  const order = await db.query.salesOrders.findFirst({ where: eq(salesOrders.id, orderId) });
  if (!order) return { score: 0, factors: [] };

  const factors: RiskFactor[] = [];
  const repId = order.repId;

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const ninetyDaysStr = ninetyDaysAgo.toISOString().split("T")[0];

  const recentChargebacks = await db.select({ count: sql<number>`count(*)` })
    .from(chargebacks)
    .where(sql`"rep_id" = ${repId} AND "created_at" >= ${ninetyDaysStr}::date`);
  const hasRecentChargeback = (recentChargebacks[0]?.count || 0) > 0;
  factors.push({ factor: "Rep has chargeback in last 90 days", weight: 25, triggered: hasRecentChargeback });

  const repTotalOrders = await db.select({ count: sql<number>`count(*)` })
    .from(salesOrders).where(eq(salesOrders.repId, repId));
  const repTotalChargebacks = await db.select({ count: sql<number>`count(*)` })
    .from(chargebacks).where(sql`"rep_id" = ${repId}`);
  const cbRate = (repTotalOrders[0]?.count || 0) > 0
    ? ((repTotalChargebacks[0]?.count || 0) / (repTotalOrders[0]?.count || 1)) * 100
    : 0;
  factors.push({ factor: "Rep chargeback rate > 10%", weight: 20, triggered: cbRate > 10, detail: `${cbRate.toFixed(1)}%` });

  if (order.zipCode) {
    const zipChargebacks = await db.select({ count: sql<number>`count(*)` })
      .from(chargebacks)
      .innerJoin(salesOrders, eq(chargebacks.orderId, salesOrders.id))
      .where(eq(salesOrders.zipCode, order.zipCode));
    const zipTotal = await db.select({ count: sql<number>`count(*)` })
      .from(salesOrders).where(eq(salesOrders.zipCode, order.zipCode));
    const zipRate = (zipTotal[0]?.count || 0) > 0
      ? ((zipChargebacks[0]?.count || 0) / (zipTotal[0]?.count || 1)) * 100
      : 0;
    factors.push({ factor: "Customer zip code has high chargeback history", weight: 15, triggered: zipRate > 5, detail: `${zipRate.toFixed(1)}% in zip ${order.zipCode}` });
  } else {
    factors.push({ factor: "Customer zip code has high chargeback history", weight: 15, triggered: false });
  }

  const commissionCents = Math.round(parseFloat(order.baseCommissionEarned || "0") * 100);
  const p90 = await db.select({
    threshold: sql<string>`COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY CAST("base_commission_earned" AS DECIMAL) * 100), 0)`,
  }).from(salesOrders).where(eq(salesOrders.serviceId, order.serviceId));
  const threshold = parseFloat(p90[0]?.threshold || "0");
  factors.push({ factor: "Order amount is in the top 10% for this service", weight: 10, triggered: commissionCents > threshold && threshold > 0 });

  const dateSold = order.dateSold ? new Date(order.dateSold) : null;
  const isWeekend = dateSold ? [0, 6].includes(dateSold.getDay()) : false;
  factors.push({ factor: "Order submitted on a weekend", weight: 5, triggered: isWeekend });

  const hasNoInstall = !order.installDate;
  factors.push({ factor: "No install date set", weight: 10, triggered: hasNoInstall });

  const rep = await db.query.users.findFirst({
    where: eq(users.repId, repId),
  });
  const isNewRep = rep?.createdAt
    ? (Date.now() - new Date(rep.createdAt).getTime()) < 30 * 24 * 60 * 60 * 1000
    : false;
  factors.push({ factor: "Rep is in first 30 days", weight: 15, triggered: isNewRep });

  const score = Math.min(100, factors.reduce((sum, f) => sum + (f.triggered ? f.weight : 0), 0));
  return { score, factors };
}

export function getRiskLevel(score: number): { label: string; color: string } {
  if (score <= 25) return { label: "Low", color: "green" };
  if (score <= 50) return { label: "Medium", color: "yellow" };
  if (score <= 75) return { label: "High", color: "orange" };
  return { label: "Critical", color: "red" };
}
