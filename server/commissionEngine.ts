import { db } from "./db";
import { storage } from "./storage";
import type { TxDb } from "./storage";
import {
  compPlanRates,
  commissionOverrideRules,
  users,
  type CompPlanRate,
  type CommissionOverrideRule,
} from "@shared/schema";
import { eq, and, isNull, lte, gte, or, sql } from "drizzle-orm";

const OWNER_ROLES = ["EXECUTIVE"];
const DD_FEE_CENTS = 250;

export interface CompPlanLookupResult {
  rate: CompPlanRate;
  repRateCents: number;
  leaderRateCents: number;
  managerRateCents: number;
  directorOverrideCents: number;
  operationsOverrideCents: number;
  accountingOverrideCents: number;
  executivePayCents: number;
  icProfitCents: number;
  elevatedPersonalSalesCents: number;
}

export async function lookupCompPlanRate(
  serviceId: string | null,
  providerId: string | null,
  clientId: string | null,
  asOfDate: string,
  txDb?: TxDb,
): Promise<CompPlanLookupResult | null> {
  const d = txDb ?? db;

  const conditions = [
    eq(compPlanRates.active, true),
    lte(compPlanRates.effectiveStart, asOfDate),
    or(
      isNull(compPlanRates.effectiveEnd),
      gte(compPlanRates.effectiveEnd, asOfDate),
    ),
  ];

  if (serviceId) conditions.push(eq(compPlanRates.serviceId, serviceId));
  if (providerId) conditions.push(eq(compPlanRates.providerId, providerId));
  if (clientId) conditions.push(eq(compPlanRates.clientId, clientId));

  const [rate] = await d
    .select()
    .from(compPlanRates)
    .where(and(...conditions))
    .limit(1);

  if (!rate) return null;

  return {
    rate,
    repRateCents: rate.repRateCents,
    leaderRateCents: rate.leaderRateCents,
    managerRateCents: rate.managerRateCents,
    directorOverrideCents: rate.directorOverrideCents,
    operationsOverrideCents: rate.operationsOverrideCents,
    accountingOverrideCents: rate.accountingOverrideCents,
    executivePayCents: rate.executivePayCents,
    icProfitCents: rate.icProfitCents,
    elevatedPersonalSalesCents: rate.elevatedPersonalSalesCents,
  };
}

export function getRateForRole(
  lookup: CompPlanLookupResult,
  role: string,
  compPlanType: string,
): number {
  if (compPlanType === "ELEVATED") return lookup.elevatedPersonalSalesCents;
  if (compPlanType === "OWNER") return lookup.executivePayCents;
  switch (role) {
    case "REP":
    case "MDU":
      return lookup.repRateCents;
    case "LEAD":
      return lookup.leaderRateCents;
    case "MANAGER":
      return lookup.managerRateCents;
    case "DIRECTOR":
      return lookup.directorOverrideCents;
    case "EXECUTIVE":
      return lookup.executivePayCents;
    default:
      return lookup.repRateCents;
  }
}

export function getElevatedAdjustmentCents(
  lookup: CompPlanLookupResult,
  standardCommissionCents: number,
): number {
  const elevatedCents = lookup.elevatedPersonalSalesCents;
  const repCents = lookup.repRateCents;
  if (elevatedCents <= repCents || repCents <= 0) return 0;
  return elevatedCents - repCents;
}

export interface OverrideEligibility {
  eligible: boolean;
  amountCents: number;
  reason?: string;
}

export async function checkOverrideEligibility(
  recipientUserId: string,
  recipientRole: string,
  sellingRepId: string,
  sellingRepRole: string,
  order: {
    serviceId: string | null;
    providerId: string | null;
    clientId: string | null;
    speedMbps?: number;
    dateSold: string;
  },
  compPlanLookup: CompPlanLookupResult | null,
  txDb?: TxDb,
): Promise<OverrideEligibility> {
  const d = txDb ?? db;

  const rules = await d
    .select()
    .from(commissionOverrideRules)
    .where(
      and(
        eq(commissionOverrideRules.active, true),
        or(
          eq(commissionOverrideRules.recipientUserId, recipientUserId),
          and(
            isNull(commissionOverrideRules.recipientUserId),
            eq(commissionOverrideRules.recipientRole, recipientRole as "REP"),
          ),
        ),
      ),
    )
    .orderBy(commissionOverrideRules.priority);

  if (rules.length === 0) {
    return { eligible: false, amountCents: 0, reason: "No override rule configured for recipient" };
  }

  const isOwnerSale = OWNER_ROLES.includes(sellingRepRole);

  for (const rule of rules) {
    if (rule.excludeOwnerSales && isOwnerSale && !rule.includeOwnerSales) {
      continue;
    }

    if (rule.excludeSelfSales && recipientUserId === sellingRepId) {
      continue;
    }

    if (rule.excludeOwnTeamSales) {
      const sellingRep = await storage.getUserById(sellingRepId);
      if (sellingRep) {
        if (sellingRep.assignedSupervisorId === recipientUserId ||
            sellingRep.assignedManagerId === recipientUserId) {
          continue;
        }
      }
    }

    if (rule.minSpeedMbps && rule.minSpeedMbps > 0) {
      const speed = order.speedMbps || 0;
      if (speed < rule.minSpeedMbps) {
        continue;
      }
    }

    const excludeIds = rule.excludeRepIds as string[] | null;
    if (excludeIds && excludeIds.includes(sellingRepId)) {
      continue;
    }

    const includeIds = rule.includeRepIds as string[] | null;
    if (includeIds && includeIds.length > 0 && !includeIds.includes(sellingRepId)) {
      continue;
    }

    let amountCents = 0;

    const reducedReps = rule.reducedAmountReps as Array<{ repId: string; amountCents: number }> | null;
    if (reducedReps) {
      const reducedEntry = reducedReps.find(r => r.repId === sellingRepId);
      if (reducedEntry) {
        return { eligible: true, amountCents: reducedEntry.amountCents };
      }
    }

    if (rule.flatAmountCents !== null && rule.flatAmountCents !== undefined) {
      amountCents = rule.flatAmountCents;
    } else if (rule.useCompPlanColumn && compPlanLookup) {
      amountCents = getOverrideAmountFromColumn(rule.overrideColumn, compPlanLookup);
    }

    if (amountCents > 0) {
      return { eligible: true, amountCents };
    }
  }

  return { eligible: false, amountCents: 0 };
}

function getOverrideAmountFromColumn(
  column: string,
  lookup: CompPlanLookupResult,
): number {
  switch (column) {
    case "B": return lookup.repRateCents;
    case "C": return lookup.leaderRateCents;
    case "D": return lookup.managerRateCents;
    case "E": return lookup.directorOverrideCents;
    case "F": return lookup.operationsOverrideCents;
    case "G": return lookup.accountingOverrideCents;
    case "H": return lookup.executivePayCents;
    case "I": return lookup.icProfitCents;
    case "J": return lookup.elevatedPersonalSalesCents;
    default: return 0;
  }
}

export interface OwnerPoolResult {
  pooledGrossCents: number;
  splitPerOwnerCents: number;
  ownerUserIds: string[];
  orderCount: number;
}

export async function calculateOwnerPooling(
  ownerPoolGroup: string,
  orders: Array<{ userId: string; commissionAmountCents: number }>,
  txDb?: TxDb,
): Promise<OwnerPoolResult> {
  const d = txDb ?? db;

  const ownerUsers = await d
    .select()
    .from(users)
    .where(
      and(
        eq(users.ownerPoolGroup, ownerPoolGroup),
        eq(users.compPlanType, "OWNER"),
        eq(users.status, "ACTIVE"),
        isNull(users.deletedAt),
      ),
    );

  const ownerUserIds = ownerUsers.map(u => u.id);
  if (ownerUserIds.length === 0) {
    return { pooledGrossCents: 0, splitPerOwnerCents: 0, ownerUserIds: [], orderCount: 0 };
  }

  const ownerOrders = orders.filter(o => ownerUserIds.includes(o.userId));
  const pooledGrossCents = ownerOrders.reduce((sum, o) => sum + o.commissionAmountCents, 0);
  const splitPerOwnerCents = Math.floor(pooledGrossCents / ownerUserIds.length);

  return {
    pooledGrossCents,
    splitPerOwnerCents,
    ownerUserIds,
    orderCount: ownerOrders.length,
  };
}

export function isOwnerRole(role: string): boolean {
  return OWNER_ROLES.includes(role);
}

export function calculateDdFeeCents(
  role: string,
  compPlanType: string,
  netPayBeforeFeeCents: number,
): number {
  if (compPlanType === "OWNER" || isOwnerRole(role)) return 0;
  if (netPayBeforeFeeCents <= 0) return 0;
  return DD_FEE_CENTS;
}

export async function getActiveOverrideRules(
  recipientUserId?: string,
  recipientRole?: string,
  txDb?: TxDb,
): Promise<CommissionOverrideRule[]> {
  const d = txDb ?? db;
  const conditions = [eq(commissionOverrideRules.active, true)];

  if (recipientUserId) {
    conditions.push(
      or(
        eq(commissionOverrideRules.recipientUserId, recipientUserId),
        and(
          isNull(commissionOverrideRules.recipientUserId),
          recipientRole
            ? eq(commissionOverrideRules.recipientRole, recipientRole as "REP")
            : sql`true`,
        ),
      )!,
    );
  }

  return d
    .select()
    .from(commissionOverrideRules)
    .where(and(...conditions))
    .orderBy(commissionOverrideRules.priority);
}

export async function getAllCompPlanRates(txDb?: TxDb): Promise<CompPlanRate[]> {
  const d = txDb ?? db;
  return d
    .select()
    .from(compPlanRates)
    .where(eq(compPlanRates.active, true));
}
