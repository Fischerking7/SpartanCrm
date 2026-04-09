import { storage } from "./storage";
import { db } from "./db";
import { users, services as servicesTable } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

export async function seedCompPlanData() {
  const existingRates = await storage.getCompPlanRates();
  const existingRules = await storage.getCommissionOverrideRules();

  const results = {
    ratesCreated: 0,
    rulesCreated: 0,
    usersUpdated: 0,
    skippedRates: existingRates.length,
    skippedRules: existingRules.length,
  };

  if (existingRates.length === 0) {
    const services = await db.select().from(servicesTable).where(eq(servicesTable.active, true));
    const serviceMap = new Map<string, string>();
    for (const s of services) {
      serviceMap.set(s.code.toUpperCase(), s.id);
    }

    const compPlanTiers = [
      { label: "200 Mbps", code: "200MBPS", repB: 4000, leaderC: 1000, managerD: 1000, directorE: 0, opsF: 1000, acctG: 500, execH: 6500, profitI: 2500, elevatedJ: 5000 },
      { label: "300 Mbps", code: "300MBPS", repB: 4500, leaderC: 1000, managerD: 1000, directorE: 500, opsF: 1000, acctG: 500, execH: 7500, profitI: 2500, elevatedJ: 5500 },
      { label: "500 Mbps", code: "500MBPS", repB: 5000, leaderC: 1000, managerD: 1000, directorE: 500, opsF: 1000, acctG: 500, execH: 8000, profitI: 3000, elevatedJ: 6000 },
      { label: "1 Gig", code: "1GIG", repB: 5500, leaderC: 1000, managerD: 1000, directorE: 1000, opsF: 1000, acctG: 500, execH: 9000, profitI: 3000, elevatedJ: 6600 },
      { label: "1.5 Gig", code: "1.5GIG", repB: 6000, leaderC: 1000, managerD: 1000, directorE: 1000, opsF: 1000, acctG: 500, execH: 9500, profitI: 3000, elevatedJ: 7000 },
      { label: "2 Gig", code: "2GIG", repB: 7500, leaderC: 1000, managerD: 1000, directorE: 1500, opsF: 1000, acctG: 500, execH: 12000, profitI: 3500, elevatedJ: 8500 },
      { label: "8 Gig", code: "8GIG", repB: 10000, leaderC: 1500, managerD: 1500, directorE: 2000, opsF: 1000, acctG: 500, execH: 15000, profitI: 5000, elevatedJ: 11000 },
      { label: "TV Addon", code: "TV_ADDON", repB: 1000, leaderC: 0, managerD: 0, directorE: 0, opsF: 0, acctG: 0, execH: 1500, profitI: 500, elevatedJ: 1200 },
    ];

    for (const tier of compPlanTiers) {
      const serviceId = serviceMap.get(tier.code) || null;
      await storage.createCompPlanRate({
        serviceId,
        speedTierLabel: tier.label,
        repRateCents: tier.repB,
        leaderRateCents: tier.leaderC,
        managerRateCents: tier.managerD,
        directorOverrideCents: tier.directorE,
        operationsOverrideCents: tier.opsF,
        accountingOverrideCents: tier.acctG,
        executivePayCents: tier.execH,
        icProfitCents: tier.profitI,
        elevatedPersonalSalesCents: tier.elevatedJ,
        effectiveStart: "2025-01-01",
        active: true,
      });
      results.ratesCreated++;
    }
  }

  if (existingRules.length === 0) {
    const allUsers = await db.select().from(users).where(and(eq(users.status, "ACTIVE"), isNull(users.deletedAt)));
    const findUser = (name: string) => allUsers.find(u => u.name.toLowerCase().includes(name.toLowerCase()));

    const sean = findUser("Sean");
    const stefano = findUser("Stefano");
    const joei = findUser("Joei") || findUser("Ruffino");
    const dan = findUser("Dan") || findUser("DeLeon");
    const andrew = findUser("Andrew") || findUser("Unglert");

    if (sean) {
      await storage.createCommissionOverrideRule({
        ruleName: "Director Override — Sean Fischer (Col E, 300Mbps+, non-owner)",
        recipientUserId: sean.id,
        recipientRole: "DIRECTOR",
        overrideType: "DIRECTOR_OVERRIDE",
        overrideColumn: "E",
        useCompPlanColumn: true,
        minSpeedMbps: 300,
        excludeOwnerSales: true,
        excludeSelfSales: true,
        reducedAmountReps: stefano || andrew ? [
          ...(stefano ? [{ repId: stefano.id, amountCents: 1500 }] : []),
          ...(andrew ? [{ repId: andrew.id, amountCents: 1500 }] : []),
        ] : null,
        active: true,
        priority: 10,
        notes: "Director override: Col E on 300Mbps+ non-owner sales. $15 reduced for Stefano/Andrew.",
      });
      results.rulesCreated++;
    }

    if (stefano) {
      await storage.createCommissionOverrideRule({
        ruleName: "Operations Override — Stefano Fischer ($10 all sales, excl self/own team)",
        recipientUserId: stefano.id,
        recipientRole: "OPERATIONS",
        overrideType: "OPERATIONS_OVERRIDE",
        overrideColumn: "F",
        flatAmountCents: 1000,
        useCompPlanColumn: false,
        includeOwnerSales: true,
        appliesToAllSales: true,
        excludeSelfSales: true,
        excludeOwnTeamSales: true,
        active: true,
        priority: 30,
        notes: "Operations override: $10 flat on ALL sales including owners. Excludes own personal sales and own reps' sales — in perpetuity.",
      });
      results.rulesCreated++;
    }

    if (joei) {
      await storage.createCommissionOverrideRule({
        ruleName: "Accounting Override — Joei Ruffino (Col G, all sales, no exceptions)",
        recipientUserId: joei.id,
        recipientRole: "ACCOUNTING",
        overrideType: "ACCOUNTING_OVERRIDE",
        overrideColumn: "G",
        useCompPlanColumn: true,
        includeOwnerSales: true,
        appliesToAllSales: true,
        active: true,
        priority: 40,
        notes: "Accounting override: Col G on ALL sales including owners — no exceptions.",
      });
      results.rulesCreated++;
    }
  }

  const allUsersForUpdate = await db.select().from(users).where(and(eq(users.status, "ACTIVE"), isNull(users.deletedAt)));
  const findUserForUpdate = (name: string) => allUsersForUpdate.find(u => u.name.toLowerCase().includes(name.toLowerCase()));

  const nik = findUserForUpdate("Nik") || allUsersForUpdate.find(u => u.role === "EXECUTIVE" && u.name.includes("Fischer"));
  const nick = findUserForUpdate("Nick") || allUsersForUpdate.find(u => u.role === "EXECUTIVE" && u.name.includes("Marotta"));
  const stefanoUpdate = findUserForUpdate("Stefano");
  const andrewUpdate = findUserForUpdate("Andrew") || findUserForUpdate("Unglert");
  const seanUpdate = findUserForUpdate("Sean");

  const ownerUpdates = [nik, nick].filter(Boolean);
  for (const owner of ownerUpdates) {
    if (owner && owner.compPlanType !== "OWNER") {
      await db.update(users).set({ compPlanType: "OWNER", ownerPoolGroup: "OWNER_POOL_1" }).where(eq(users.id, owner.id));
      results.usersUpdated++;
    }
  }

  const elevatedReps = [stefanoUpdate, andrewUpdate, seanUpdate].filter(Boolean);
  for (const rep of elevatedReps) {
    if (rep && rep.compPlanType !== "ELEVATED") {
      await db.update(users).set({ compPlanType: "ELEVATED" }).where(eq(users.id, rep.id));
      results.usersUpdated++;
    }
  }

  return results;
}
