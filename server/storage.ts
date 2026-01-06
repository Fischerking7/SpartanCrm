import { db } from "./db";
import { eq, and, desc, sql, lte, gte, or, isNull } from "drizzle-orm";
import {
  users, providers, clients, services, rateCards, salesOrders,
  incentives, overrideAgreements, chargebacks, adjustments,
  payRuns, unmatchedPayments, unmatchedChargebacks, rateIssues,
  auditLogs, exportBatches, counters, overrideEarnings,
  type User, type InsertUser, type Provider, type InsertProvider,
  type Client, type InsertClient, type Service, type InsertService,
  type RateCard, type InsertRateCard, type SalesOrder, type InsertSalesOrder,
  type Incentive, type InsertIncentive, type OverrideAgreement, type InsertOverrideAgreement,
  type OverrideEarning, type InsertOverrideEarning,
  type Chargeback, type InsertChargeback, type Adjustment, type InsertAdjustment,
  type PayRun, type InsertPayRun, type UnmatchedPayment, type UnmatchedChargeback,
  type RateIssue, type AuditLog, type InsertAuditLog,
} from "@shared/schema";

export const storage = {
  // Users
  async getUsers() {
    return db.query.users.findMany({ orderBy: [desc(users.createdAt)] });
  },
  async getUserById(id: string) {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  },
  async getUserByRepId(repId: string) {
    return db.query.users.findFirst({ where: eq(users.repId, repId) });
  },
  async createUser(data: InsertUser) {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  },
  async updateUser(id: string, data: Partial<InsertUser>) {
    const [user] = await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return user;
  },
  async updateUserPassword(id: string, passwordHash: string) {
    const [user] = await db.update(users).set({ 
      passwordHash, 
      mustChangePassword: false, 
      tempPasswordExpiresAt: null, 
      passwordUpdatedAt: new Date(),
      updatedAt: new Date() 
    }).where(eq(users.id, id)).returning();
    return user;
  },
  async setTempPassword(id: string, passwordHash: string, expiresAt: Date) {
    const [user] = await db.update(users).set({ 
      passwordHash, 
      mustChangePassword: true, 
      tempPasswordExpiresAt: expiresAt, 
      updatedAt: new Date() 
    }).where(eq(users.id, id)).returning();
    return user;
  },
  async getTeamMembers(managerId: string) {
    return db.query.users.findMany({ where: and(eq(users.assignedManagerId, managerId), eq(users.status, "ACTIVE")) });
  },
  async softDeleteUser(id: string, deletedByUserId: string) {
    const [user] = await db.update(users).set({ 
      status: "DEACTIVATED",
      deletedAt: new Date(), 
      deletedByUserId,
      updatedAt: new Date() 
    }).where(eq(users.id, id)).returning();
    return user;
  },
  async getActiveUsers() {
    return db.query.users.findMany({ 
      where: and(eq(users.status, "ACTIVE"), isNull(users.deletedAt)),
      orderBy: [desc(users.createdAt)] 
    });
  },

  // Providers
  async getProviders() {
    return db.query.providers.findMany({ orderBy: [desc(providers.createdAt)] });
  },
  async createProvider(data: InsertProvider) {
    const [provider] = await db.insert(providers).values(data).returning();
    return provider;
  },
  async updateProvider(id: string, data: Partial<InsertProvider>) {
    const [provider] = await db.update(providers).set({ ...data, updatedAt: new Date() }).where(eq(providers.id, id)).returning();
    return provider;
  },
  async softDeleteProvider(id: string, deletedByUserId: string) {
    const [provider] = await db.update(providers).set({ 
      active: false,
      deletedAt: new Date(), 
      deletedByUserId,
      updatedAt: new Date() 
    }).where(eq(providers.id, id)).returning();
    return provider;
  },
  async getActiveProviders() {
    return db.query.providers.findMany({ 
      where: and(eq(providers.active, true), isNull(providers.deletedAt)),
      orderBy: [desc(providers.createdAt)] 
    });
  },
  async getProviderDependencyCount(id: string): Promise<number> {
    const orders = await db.select({ count: sql<number>`count(*)` }).from(salesOrders).where(eq(salesOrders.providerId, id));
    return Number(orders[0]?.count || 0);
  },

  // Clients
  async getClients() {
    return db.query.clients.findMany({ orderBy: [desc(clients.createdAt)] });
  },
  async createClient(data: InsertClient) {
    const [client] = await db.insert(clients).values(data).returning();
    return client;
  },
  async updateClient(id: string, data: Partial<InsertClient>) {
    const [client] = await db.update(clients).set({ ...data, updatedAt: new Date() }).where(eq(clients.id, id)).returning();
    return client;
  },
  async softDeleteClient(id: string, deletedByUserId: string) {
    const [client] = await db.update(clients).set({ 
      active: false,
      deletedAt: new Date(), 
      deletedByUserId,
      updatedAt: new Date() 
    }).where(eq(clients.id, id)).returning();
    return client;
  },
  async getActiveClients() {
    return db.query.clients.findMany({ 
      where: and(eq(clients.active, true), isNull(clients.deletedAt)),
      orderBy: [desc(clients.createdAt)] 
    });
  },
  async getClientDependencyCount(id: string): Promise<number> {
    const orders = await db.select({ count: sql<number>`count(*)` }).from(salesOrders).where(eq(salesOrders.clientId, id));
    return Number(orders[0]?.count || 0);
  },

  // Services
  async getServices() {
    return db.query.services.findMany({ orderBy: [desc(services.createdAt)] });
  },
  async createService(data: InsertService) {
    const [service] = await db.insert(services).values(data).returning();
    return service;
  },
  async updateService(id: string, data: Partial<InsertService>) {
    const [service] = await db.update(services).set({ ...data, updatedAt: new Date() }).where(eq(services.id, id)).returning();
    return service;
  },
  async softDeleteService(id: string, deletedByUserId: string) {
    const [service] = await db.update(services).set({ 
      active: false,
      deletedAt: new Date(), 
      deletedByUserId,
      updatedAt: new Date() 
    }).where(eq(services.id, id)).returning();
    return service;
  },
  async getActiveServices() {
    return db.query.services.findMany({ 
      where: and(eq(services.active, true), isNull(services.deletedAt)),
      orderBy: [desc(services.createdAt)] 
    });
  },
  async getServiceDependencyCount(id: string): Promise<number> {
    const orders = await db.select({ count: sql<number>`count(*)` }).from(salesOrders).where(eq(salesOrders.serviceId, id));
    return Number(orders[0]?.count || 0);
  },

  // Rate Cards
  async getRateCards() {
    return db.query.rateCards.findMany({ orderBy: [desc(rateCards.createdAt)] });
  },
  async createRateCard(data: InsertRateCard) {
    const [rateCard] = await db.insert(rateCards).values(data).returning();
    return rateCard;
  },
  async updateRateCard(id: string, data: Partial<InsertRateCard>) {
    const [rateCard] = await db.update(rateCards).set({ ...data, updatedAt: new Date() }).where(eq(rateCards.id, id)).returning();
    return rateCard;
  },
  async softDeleteRateCard(id: string, deletedByUserId: string) {
    const [rateCard] = await db.update(rateCards).set({ 
      active: false,
      deletedAt: new Date(), 
      deletedByUserId,
      updatedAt: new Date() 
    }).where(eq(rateCards.id, id)).returning();
    return rateCard;
  },
  async getActiveRateCards() {
    return db.query.rateCards.findMany({ 
      where: and(eq(rateCards.active, true), isNull(rateCards.deletedAt)),
      orderBy: [desc(rateCards.createdAt)] 
    });
  },
  async getRateCardDependencyCount(id: string): Promise<number> {
    const orders = await db.select({ count: sql<number>`count(*)` }).from(salesOrders).where(eq(salesOrders.appliedRateCardId, id));
    return Number(orders[0]?.count || 0);
  },
  async findMatchingRateCard(order: SalesOrder, date: string) {
    const cards = await db.query.rateCards.findMany({
      where: and(
        eq(rateCards.providerId, order.providerId),
        eq(rateCards.serviceId, order.serviceId),
        eq(rateCards.active, true),
        isNull(rateCards.deletedAt),
        lte(rateCards.effectiveStart, date),
        or(isNull(rateCards.effectiveEnd), gte(rateCards.effectiveEnd, date))
      ),
    });
    // Find best match: client-specific first, then any client
    const clientSpecific = cards.find(card => card.clientId === order.clientId);
    const anyClient = cards.find(card => !card.clientId);
    return clientSpecific || anyClient || cards[0];
  },
  
  // Calculate commission using rate card with new payout structure
  calculateCommission(rateCard: RateCard, order: SalesOrder): number {
    const baseAmount = parseFloat(rateCard.baseAmount || "0");
    const tvAddonAmount = parseFloat(rateCard.tvAddonAmount || "0");
    const mobilePerLineAmount = parseFloat(rateCard.mobilePerLineAmount || "0");
    
    let total = baseAmount;
    if (order.tvSold) {
      total += tvAddonAmount;
    }
    if (order.mobileSold && order.mobileLinesQty > 0) {
      total += mobilePerLineAmount * order.mobileLinesQty;
    }
    return total;
  },

  // Sales Orders
  async getOrders(filter?: { repId?: string; teamRepIds?: string[]; limit?: number }) {
    let query = db.query.salesOrders.findMany({
      orderBy: [desc(salesOrders.createdAt)],
      limit: filter?.limit,
    });
    if (filter?.repId) {
      return db.query.salesOrders.findMany({
        where: eq(salesOrders.repId, filter.repId),
        orderBy: [desc(salesOrders.createdAt)],
        limit: filter.limit,
      });
    }
    if (filter?.teamRepIds?.length) {
      return db.select().from(salesOrders)
        .where(sql`${salesOrders.repId} = ANY(${filter.teamRepIds})`)
        .orderBy(desc(salesOrders.createdAt))
        .limit(filter.limit || 1000);
    }
    return db.query.salesOrders.findMany({ orderBy: [desc(salesOrders.createdAt)], limit: filter?.limit });
  },
  async getOrderById(id: string) {
    return db.query.salesOrders.findFirst({ where: eq(salesOrders.id, id) });
  },
  async getOrderByInvoiceNumber(invoiceNumber: string) {
    return db.query.salesOrders.findFirst({ where: eq(salesOrders.invoiceNumber, invoiceNumber) });
  },
  async createOrder(data: InsertSalesOrder) {
    const invoiceNumber = await this.generateInvoiceNumber();
    const [order] = await db.insert(salesOrders).values({ ...data, invoiceNumber }).returning();
    return order;
  },
  async updateOrder(id: string, data: Partial<SalesOrder>) {
    const [order] = await db.update(salesOrders).set({ ...data, updatedAt: new Date() }).where(eq(salesOrders.id, id)).returning();
    return order;
  },
  async getPendingApprovals() {
    return db.query.salesOrders.findMany({
      where: eq(salesOrders.approvalStatus, "UNAPPROVED"),
      orderBy: [desc(salesOrders.createdAt)],
    });
  },
  async getApprovedUnexported() {
    return db.query.salesOrders.findMany({
      where: and(eq(salesOrders.approvalStatus, "APPROVED"), eq(salesOrders.exportedToAccounting, false)),
      orderBy: [desc(salesOrders.createdAt)],
    });
  },

  // Invoice Numbering
  async generateInvoiceNumber(): Promise<string> {
    const key = "invoice_number";
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, "0");
    
    const existing = await db.query.counters.findFirst({ where: eq(counters.key, key) });
    let nextValue = 1;
    if (existing) {
      nextValue = existing.value + 1;
      await db.update(counters).set({ value: nextValue }).where(eq(counters.key, key));
    } else {
      await db.insert(counters).values({ key, value: nextValue });
    }
    return `INV-${year}${month}-${nextValue.toString().padStart(5, "0")}`;
  },

  // Incentives
  async getIncentives() {
    return db.query.incentives.findMany({ orderBy: [desc(incentives.createdAt)] });
  },
  async createIncentive(data: InsertIncentive) {
    const [incentive] = await db.insert(incentives).values(data).returning();
    return incentive;
  },
  async updateIncentive(id: string, data: Partial<InsertIncentive>) {
    const [incentive] = await db.update(incentives).set({ ...data, updatedAt: new Date() }).where(eq(incentives.id, id)).returning();
    return incentive;
  },

  // Chargebacks
  async getChargebacks() {
    return db.query.chargebacks.findMany({ orderBy: [desc(chargebacks.createdAt)] });
  },
  async createChargeback(data: InsertChargeback) {
    const [chargeback] = await db.insert(chargebacks).values(data).returning();
    return chargeback;
  },

  // Adjustments
  async getAdjustments() {
    return db.query.adjustments.findMany({ orderBy: [desc(adjustments.createdAt)] });
  },
  async getAdjustmentsByUser(userId: string) {
    return db.query.adjustments.findMany({
      where: eq(adjustments.payeeUserId, userId),
      orderBy: [desc(adjustments.createdAt)],
    });
  },
  async createAdjustment(data: InsertAdjustment) {
    const [adjustment] = await db.insert(adjustments).values(data).returning();
    return adjustment;
  },
  async updateAdjustment(id: string, data: Partial<Adjustment>) {
    const [adjustment] = await db.update(adjustments).set(data).where(eq(adjustments.id, id)).returning();
    return adjustment;
  },

  // Pay Runs
  async getPayRuns() {
    return db.query.payRuns.findMany({ orderBy: [desc(payRuns.createdAt)] });
  },
  async createPayRun(data: InsertPayRun) {
    const [payRun] = await db.insert(payRuns).values(data).returning();
    return payRun;
  },
  async updatePayRun(id: string, data: Partial<PayRun>) {
    const [payRun] = await db.update(payRuns).set(data).where(eq(payRuns.id, id)).returning();
    return payRun;
  },

  // Exception Queues
  async getUnmatchedPayments() {
    return db.query.unmatchedPayments.findMany({ orderBy: [desc(unmatchedPayments.createdAt)] });
  },
  async createUnmatchedPayment(data: { payRunId?: string; rawRowJson: string; reason: string }) {
    const [record] = await db.insert(unmatchedPayments).values(data).returning();
    return record;
  },
  async resolveUnmatchedPayment(id: string, userId: string, note: string) {
    const [record] = await db.update(unmatchedPayments).set({
      resolvedByUserId: userId,
      resolvedAt: new Date(),
      resolutionNote: note,
    }).where(eq(unmatchedPayments.id, id)).returning();
    return record;
  },

  async getUnmatchedChargebacks() {
    return db.query.unmatchedChargebacks.findMany({ orderBy: [desc(unmatchedChargebacks.createdAt)] });
  },
  async createUnmatchedChargeback(data: { payRunId?: string; rawRowJson: string; reason: string }) {
    const [record] = await db.insert(unmatchedChargebacks).values(data).returning();
    return record;
  },
  async resolveUnmatchedChargeback(id: string, userId: string, note: string) {
    const [record] = await db.update(unmatchedChargebacks).set({
      resolvedByUserId: userId,
      resolvedAt: new Date(),
      resolutionNote: note,
    }).where(eq(unmatchedChargebacks.id, id)).returning();
    return record;
  },

  async getRateIssues() {
    return db.query.rateIssues.findMany({ orderBy: [desc(rateIssues.createdAt)] });
  },
  async createRateIssue(data: { salesOrderId: string; type: "MISSING_RATE" | "CONFLICT_RATE"; details: string }) {
    const [record] = await db.insert(rateIssues).values(data).returning();
    return record;
  },
  async resolveRateIssue(id: string, userId: string, note: string) {
    const [record] = await db.update(rateIssues).set({
      resolvedByUserId: userId,
      resolvedAt: new Date(),
      resolutionNote: note,
    }).where(eq(rateIssues.id, id)).returning();
    return record;
  },

  // Audit Log
  async getAuditLogs() {
    return db.query.auditLogs.findMany({ orderBy: [desc(auditLogs.createdAt)], limit: 500 });
  },
  async createAuditLog(data: InsertAuditLog) {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  },

  // Export Batches
  async createExportBatch(userId: string, recordCount: number, fileName?: string) {
    const [batch] = await db.insert(exportBatches).values({
      createdByUserId: userId,
      recordCount,
      fileName,
    }).returning();
    return batch;
  },

  // Override Agreements
  async getOverrideAgreements() {
    return db.query.overrideAgreements.findMany({ orderBy: [desc(overrideAgreements.createdAt)] });
  },
  async createOverrideAgreement(data: InsertOverrideAgreement) {
    const [agreement] = await db.insert(overrideAgreements).values(data).returning();
    return agreement;
  },
  async updateOverrideAgreement(id: string, data: Partial<InsertOverrideAgreement>) {
    const [agreement] = await db.update(overrideAgreements).set({ ...data, updatedAt: new Date() }).where(eq(overrideAgreements.id, id)).returning();
    return agreement;
  },
  async getActiveOverrideAgreements(recipientUserId: string, sourceLevel: string, date: string, filter?: { providerId?: string; clientId?: string; serviceId?: string }) {
    const agreements = await db.query.overrideAgreements.findMany({
      where: and(
        eq(overrideAgreements.recipientUserId, recipientUserId),
        eq(overrideAgreements.sourceLevel, sourceLevel as any),
        eq(overrideAgreements.active, true),
        lte(overrideAgreements.effectiveStart, date),
        or(isNull(overrideAgreements.effectiveEnd), gte(overrideAgreements.effectiveEnd, date))
      ),
    });
    return agreements.filter(a => {
      if (a.providerId && filter?.providerId && a.providerId !== filter.providerId) return false;
      if (a.clientId && filter?.clientId && a.clientId !== filter.clientId) return false;
      if (a.serviceId && filter?.serviceId && a.serviceId !== filter.serviceId) return false;
      return true;
    });
  },

  // Override Earnings
  async getOverrideEarnings() {
    return db.query.overrideEarnings.findMany({ orderBy: [desc(overrideEarnings.createdAt)] });
  },
  async getOverrideEarningsByOrder(salesOrderId: string) {
    return db.query.overrideEarnings.findMany({ where: eq(overrideEarnings.salesOrderId, salesOrderId) });
  },
  async getOverrideEarningsByRecipient(recipientUserId: string) {
    return db.query.overrideEarnings.findMany({ where: eq(overrideEarnings.recipientUserId, recipientUserId), orderBy: [desc(overrideEarnings.createdAt)] });
  },
  async createOverrideEarning(data: InsertOverrideEarning) {
    const [earning] = await db.insert(overrideEarnings).values(data).returning();
    return earning;
  },

  // Hierarchy helpers
  async getUsersByRole(role: string) {
    return db.query.users.findMany({ where: and(eq(users.role, role as any), eq(users.status, "ACTIVE")) });
  },
  async getRepHierarchy(repId: string): Promise<{ supervisor?: User; manager?: User; executive?: User }> {
    const rep = await db.query.users.findFirst({ where: eq(users.repId, repId) });
    if (!rep) return {};
    const result: { supervisor?: User; manager?: User; executive?: User } = {};
    if (rep.assignedSupervisorId) {
      result.supervisor = await db.query.users.findFirst({ where: eq(users.id, rep.assignedSupervisorId) }) || undefined;
    }
    if (rep.assignedManagerId) {
      result.manager = await db.query.users.findFirst({ where: eq(users.id, rep.assignedManagerId) }) || undefined;
    } else if (result.supervisor?.assignedManagerId) {
      result.manager = await db.query.users.findFirst({ where: eq(users.id, result.supervisor.assignedManagerId) }) || undefined;
    }
    if (rep.assignedExecutiveId) {
      result.executive = await db.query.users.findFirst({ where: eq(users.id, rep.assignedExecutiveId) }) || undefined;
    } else if (result.manager?.assignedExecutiveId) {
      result.executive = await db.query.users.findFirst({ where: eq(users.id, result.manager.assignedExecutiveId) }) || undefined;
    } else if (result.supervisor?.assignedExecutiveId) {
      result.executive = await db.query.users.findFirst({ where: eq(users.id, result.supervisor.assignedExecutiveId) }) || undefined;
    }
    return result;
  },
  async getSupervisedReps(supervisorId: string) {
    return db.query.users.findMany({ where: and(eq(users.assignedSupervisorId, supervisorId), eq(users.status, "ACTIVE")) });
  },
  
  // Manager scope: returns all rep IDs a manager can see (direct + indirect via supervisors)
  async getManagerScope(managerId: string): Promise<{ directRepIds: string[]; indirectRepIds: string[]; supervisorIds: string[]; allRepIds: string[]; allRepRepIds: string[] }> {
    // Get supervisors assigned to this manager
    const supervisors = await db.query.users.findMany({
      where: and(eq(users.assignedManagerId, managerId), eq(users.role, "SUPERVISOR"), eq(users.status, "ACTIVE"))
    });
    const supervisorIds = supervisors.map(s => s.id);
    
    // Get ALL reps directly assigned to manager (regardless of supervisor)
    const directReps = await db.query.users.findMany({
      where: and(
        eq(users.assignedManagerId, managerId),
        eq(users.role, "REP"),
        eq(users.status, "ACTIVE")
      )
    });
    const directRepIds = directReps.map(r => r.id);
    const directRepRepIds = directReps.map(r => r.repId);
    
    // Get reps indirectly assigned (via supervisors) - these may also be in directReps
    const indirectRepIds: string[] = [];
    const indirectRepRepIds: string[] = [];
    for (const supervisorId of supervisorIds) {
      const supervisedReps = await db.query.users.findMany({
        where: and(eq(users.assignedSupervisorId, supervisorId), eq(users.role, "REP"), eq(users.status, "ACTIVE"))
      });
      indirectRepIds.push(...supervisedReps.map(r => r.id));
      indirectRepRepIds.push(...supervisedReps.map(r => r.repId));
    }
    
    // Combine and dedupe
    const allRepIds = Array.from(new Set([...directRepIds, ...indirectRepIds]));
    const allRepRepIds = Array.from(new Set([...directRepRepIds, ...indirectRepRepIds]));
    
    return {
      directRepIds,
      indirectRepIds,
      supervisorIds,
      allRepIds,
      allRepRepIds, // repId strings for order filtering
    };
  },
  
  // Get supervisors assigned to a manager
  async getSupervisorsByManager(managerId: string) {
    return db.query.users.findMany({
      where: and(eq(users.assignedManagerId, managerId), eq(users.role, "SUPERVISOR"), eq(users.status, "ACTIVE"))
    });
  },
  
  // Executive scope: returns all rep repIds an executive can see (their entire org tree)
  async getExecutiveScope(executiveId: string): Promise<{ managerIds: string[]; supervisorIds: string[]; allRepIds: string[]; allRepRepIds: string[] }> {
    const allRepRepIds: string[] = [];
    const allRepIds: string[] = [];
    const supervisorIds: string[] = [];
    
    // Get managers assigned to this executive
    const managers = await db.query.users.findMany({
      where: and(eq(users.assignedExecutiveId, executiveId), eq(users.role, "MANAGER"), eq(users.status, "ACTIVE"))
    });
    const managerIds = managers.map(m => m.id);
    
    // For each manager, get their scope
    for (const manager of managers) {
      allRepRepIds.push(manager.repId); // Include manager's own repId
      const scope = await this.getManagerScope(manager.id);
      allRepRepIds.push(...scope.allRepRepIds);
      allRepIds.push(...scope.allRepIds);
      supervisorIds.push(...scope.supervisorIds);
    }
    
    // Get supervisors directly assigned to this executive (if any)
    const supervisors = await db.query.users.findMany({
      where: and(eq(users.assignedExecutiveId, executiveId), eq(users.role, "SUPERVISOR"), eq(users.status, "ACTIVE"))
    });
    for (const supervisor of supervisors) {
      supervisorIds.push(supervisor.id);
      allRepRepIds.push(supervisor.repId);
      const supervisedReps = await this.getSupervisedReps(supervisor.id);
      allRepRepIds.push(...supervisedReps.map(r => r.repId));
      allRepIds.push(...supervisedReps.map(r => r.id));
    }
    
    // Get reps directly assigned to this executive (if any)
    const directReps = await db.query.users.findMany({
      where: and(eq(users.assignedExecutiveId, executiveId), eq(users.role, "REP"), eq(users.status, "ACTIVE"))
    });
    allRepRepIds.push(...directReps.map(r => r.repId));
    allRepIds.push(...directReps.map(r => r.id));
    
    return {
      managerIds,
      supervisorIds: Array.from(new Set(supervisorIds)),
      allRepIds: Array.from(new Set(allRepIds)),
      allRepRepIds: Array.from(new Set(allRepRepIds)),
    };
  },
  
  // Validate org hierarchy rules
  async validateOrgHierarchy(userData: { role?: string; assignedSupervisorId?: string | null; assignedManagerId?: string | null; assignedExecutiveId?: string | null }): Promise<{ valid: boolean; error?: string }> {
    const { role, assignedSupervisorId, assignedManagerId, assignedExecutiveId } = userData;
    
    // REP rules
    if (role === "REP") {
      // REP must have either supervisor, direct manager, or executive
      if (!assignedSupervisorId && !assignedManagerId && !assignedExecutiveId) {
        return { valid: false, error: "Rep must be assigned to a Supervisor, Manager, or Executive" };
      }
      
      // If supervisor is set, check for manager mismatch
      if (assignedSupervisorId && assignedManagerId) {
        const supervisor = await db.query.users.findFirst({ where: eq(users.id, assignedSupervisorId) });
        if (supervisor && supervisor.assignedManagerId && supervisor.assignedManagerId !== assignedManagerId) {
          return { valid: false, error: "Org conflict: Rep's assigned manager differs from supervisor's manager" };
        }
      }
    }
    
    // SUPERVISOR rules
    if (role === "SUPERVISOR") {
      if (!assignedManagerId) {
        return { valid: false, error: "Supervisor must be assigned to a Manager" };
      }
    }
    
    return { valid: true };
  },

  // =====================================================
  // PRODUCTION AGGREGATION SERVICE
  // =====================================================
  
  // Get date range for cadence
  getCadenceDateRange(cadence: "DAY" | "WEEK" | "MONTH"): { startDate: Date; endDate: Date } {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
    
    let startDate: Date;
    switch (cadence) {
      case "DAY":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "WEEK":
        startDate = new Date(now);
        const dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek); // Start of week (Sunday)
        startDate.setHours(0, 0, 0, 0);
        break;
      case "MONTH":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    return { startDate, endDate };
  },

  // Format date for SQL comparison (YYYY-MM-DD)
  formatDateForSql(date: Date): string {
    return date.toISOString().split('T')[0];
  },

  // Get production aggregation for any role
  async getProductionAggregation(
    userId: string,
    role: "SUPERVISOR" | "MANAGER" | "EXECUTIVE",
    cadence: "DAY" | "WEEK" | "MONTH"
  ): Promise<{
    summary: { sold: number; connected: number; approved: number; conversionPercent: number };
    breakdown: Array<{ id: string; name: string; repId?: string; sold: number; connected: number; approved: number; conversionPercent: number }>;
  }> {
    const { startDate, endDate } = this.getCadenceDateRange(cadence);
    const startStr = this.formatDateForSql(startDate);
    const endStr = this.formatDateForSql(endDate);
    
    // Get the user
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new Error("User not found");
    
    // Resolve scope based on role
    let repRepIds: string[] = [];
    let groupByField: "rep" | "manager" = "rep";
    
    switch (role) {
      case "SUPERVISOR": {
        const supervisedReps = await this.getSupervisedReps(userId);
        repRepIds = [user.repId, ...supervisedReps.map(r => r.repId)];
        groupByField = "rep";
        break;
      }
      case "MANAGER": {
        const scope = await this.getManagerScope(userId);
        repRepIds = [user.repId, ...scope.allRepRepIds];
        groupByField = "rep";
        break;
      }
      case "EXECUTIVE": {
        const scope = await this.getExecutiveScope(userId);
        repRepIds = [user.repId, ...scope.allRepRepIds];
        groupByField = "manager";
        break;
      }
    }
    
    if (repRepIds.length === 0) {
      return {
        summary: { sold: 0, connected: 0, approved: 0, conversionPercent: 0 },
        breakdown: [],
      };
    }
    
    // Get all relevant orders in scope
    const orders = await db.select().from(salesOrders).where(
      sql`${salesOrders.repId} IN (${sql.raw(repRepIds.map(r => `'${r}'`).join(','))})`
    );
    
    // Calculate summary metrics
    const sold = orders.filter(o => o.dateSold >= startStr && o.dateSold <= endStr).length;
    const connected = orders.filter(o => 
      o.jobStatus === "COMPLETED" && 
      o.completionDate && 
      o.completionDate >= startStr && 
      o.completionDate <= endStr
    ).length;
    const approved = orders.filter(o => 
      o.jobStatus === "COMPLETED" && 
      o.approvalStatus === "APPROVED" && 
      o.approvedAt && 
      this.formatDateForSql(new Date(o.approvedAt)) >= startStr && 
      this.formatDateForSql(new Date(o.approvedAt)) <= endStr
    ).length;
    const conversionPercent = sold > 0 ? Math.round((connected / sold) * 100) : 0;
    
    // Calculate breakdown
    let breakdown: Array<{ id: string; name: string; repId?: string; sold: number; connected: number; approved: number; conversionPercent: number }> = [];
    
    if (groupByField === "rep") {
      // Group by rep for SUPERVISOR and MANAGER
      const allUsers = await db.query.users.findMany({
        where: sql`${users.repId} IN (${sql.raw(repRepIds.map(r => `'${r}'`).join(','))})`
      });
      
      for (const u of allUsers) {
        const repOrders = orders.filter(o => o.repId === u.repId);
        const repSold = repOrders.filter(o => o.dateSold >= startStr && o.dateSold <= endStr).length;
        const repConnected = repOrders.filter(o => 
          o.jobStatus === "COMPLETED" && 
          o.completionDate && 
          o.completionDate >= startStr && 
          o.completionDate <= endStr
        ).length;
        const repApproved = repOrders.filter(o => 
          o.jobStatus === "COMPLETED" && 
          o.approvalStatus === "APPROVED" && 
          o.approvedAt && 
          this.formatDateForSql(new Date(o.approvedAt)) >= startStr && 
          this.formatDateForSql(new Date(o.approvedAt)) <= endStr
        ).length;
        const repConversion = repSold > 0 ? Math.round((repConnected / repSold) * 100) : 0;
        
        breakdown.push({
          id: u.id,
          name: u.name,
          repId: u.repId,
          sold: repSold,
          connected: repConnected,
          approved: repApproved,
          conversionPercent: repConversion,
        });
      }
    } else {
      // Group by manager for EXECUTIVE
      const scope = await this.getExecutiveScope(userId);
      const managers = await db.query.users.findMany({
        where: sql`${users.id} IN (${sql.raw(scope.managerIds.map(id => `'${id}'`).join(',') || "''")})`
      });
      
      for (const manager of managers) {
        const managerScope = await this.getManagerScope(manager.id);
        const managerRepIds = [manager.repId, ...managerScope.allRepRepIds];
        const managerOrders = orders.filter(o => managerRepIds.includes(o.repId));
        
        const mgrSold = managerOrders.filter(o => o.dateSold >= startStr && o.dateSold <= endStr).length;
        const mgrConnected = managerOrders.filter(o => 
          o.jobStatus === "COMPLETED" && 
          o.completionDate && 
          o.completionDate >= startStr && 
          o.completionDate <= endStr
        ).length;
        const mgrApproved = managerOrders.filter(o => 
          o.jobStatus === "COMPLETED" && 
          o.approvalStatus === "APPROVED" && 
          o.approvedAt && 
          this.formatDateForSql(new Date(o.approvedAt)) >= startStr && 
          this.formatDateForSql(new Date(o.approvedAt)) <= endStr
        ).length;
        const mgrConversion = mgrSold > 0 ? Math.round((mgrConnected / mgrSold) * 100) : 0;
        
        breakdown.push({
          id: manager.id,
          name: manager.name,
          sold: mgrSold,
          connected: mgrConnected,
          approved: mgrApproved,
          conversionPercent: mgrConversion,
        });
      }
    }
    
    // Sort by connected descending
    breakdown.sort((a, b) => b.connected - a.connected);
    
    return {
      summary: { sold, connected, approved, conversionPercent },
      breakdown,
    };
  },
  
  // Get filtered production aggregation for Manager dashboard
  async getFilteredProductionAggregation(
    userId: string,
    cadence: "DAY" | "WEEK" | "MONTH",
    filters: { supervisorId?: string; repId?: string; providerId?: string }
  ): Promise<{
    summary: { sold: number; connected: number; approved: number; conversionPercent: number };
    breakdown: Array<{ id: string; name: string; repId?: string; sold: number; connected: number; approved: number; conversionPercent: number }>;
  }> {
    const { startDate, endDate } = this.getCadenceDateRange(cadence);
    const startStr = this.formatDateForSql(startDate);
    const endStr = this.formatDateForSql(endDate);
    
    // Get the user (manager)
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new Error("User not found");
    
    // Get manager's scope
    const scope = await this.getManagerScope(userId);
    let repRepIds = [user.repId, ...scope.allRepRepIds];
    
    // Apply filters
    if (filters.supervisorId) {
      const supervisedReps = await this.getSupervisedReps(filters.supervisorId);
      const supervisorRepIds = supervisedReps.map(r => r.repId);
      repRepIds = repRepIds.filter(r => supervisorRepIds.includes(r));
    }
    if (filters.repId) {
      const filterUser = await this.getUserById(filters.repId);
      if (filterUser) {
        repRepIds = repRepIds.filter(r => r === filterUser.repId);
      }
    }
    
    if (repRepIds.length === 0) {
      return {
        summary: { sold: 0, connected: 0, approved: 0, conversionPercent: 0 },
        breakdown: [],
      };
    }
    
    // Get orders with optional provider filter
    let ordersQuery = db.select().from(salesOrders).where(
      sql`${salesOrders.repId} IN (${sql.raw(repRepIds.map(r => `'${r}'`).join(','))})`
    );
    
    let orders = await ordersQuery;
    
    if (filters.providerId) {
      orders = orders.filter(o => o.providerId === filters.providerId);
    }
    
    // Calculate summary metrics
    const sold = orders.filter(o => o.dateSold >= startStr && o.dateSold <= endStr).length;
    const connected = orders.filter(o => 
      o.jobStatus === "COMPLETED" && 
      o.completionDate && 
      o.completionDate >= startStr && 
      o.completionDate <= endStr
    ).length;
    const approved = orders.filter(o => 
      o.jobStatus === "COMPLETED" && 
      o.approvalStatus === "APPROVED" && 
      o.approvedAt && 
      this.formatDateForSql(new Date(o.approvedAt)) >= startStr && 
      this.formatDateForSql(new Date(o.approvedAt)) <= endStr
    ).length;
    const conversionPercent = sold > 0 ? Math.round((connected / sold) * 100) : 0;
    
    // Group by rep
    const allUsers = await db.query.users.findMany({
      where: sql`${users.repId} IN (${sql.raw(repRepIds.map(r => `'${r}'`).join(','))})`
    });
    
    const breakdown: Array<{ id: string; name: string; repId?: string; sold: number; connected: number; approved: number; conversionPercent: number }> = [];
    
    for (const u of allUsers) {
      const repOrders = orders.filter(o => o.repId === u.repId);
      const repSold = repOrders.filter(o => o.dateSold >= startStr && o.dateSold <= endStr).length;
      const repConnected = repOrders.filter(o => 
        o.jobStatus === "COMPLETED" && 
        o.completionDate && 
        o.completionDate >= startStr && 
        o.completionDate <= endStr
      ).length;
      const repApproved = repOrders.filter(o => 
        o.jobStatus === "COMPLETED" && 
        o.approvalStatus === "APPROVED" && 
        o.approvedAt && 
        this.formatDateForSql(new Date(o.approvedAt)) >= startStr && 
        this.formatDateForSql(new Date(o.approvedAt)) <= endStr
      ).length;
      const repConversion = repSold > 0 ? Math.round((repConnected / repSold) * 100) : 0;
      
      breakdown.push({
        id: u.id,
        name: u.name,
        repId: u.repId,
        sold: repSold,
        connected: repConnected,
        approved: repApproved,
        conversionPercent: repConversion,
      });
    }
    
    // Sort by connected descending
    breakdown.sort((a, b) => b.connected - a.connected);
    
    return {
      summary: { sold, connected, approved, conversionPercent },
      breakdown,
    };
  },

  // Production & Earnings Dashboard Aggregation
  async getProductionMetrics(
    repIds: string[],
    startDate: string,
    endDate: string
  ): Promise<{ soldCount: number; connectedCount: number; earnedDollars: number }> {
    if (repIds.length === 0) {
      return { soldCount: 0, connectedCount: 0, earnedDollars: 0 };
    }

    const orders = await db.query.salesOrders.findMany({
      where: sql`${salesOrders.repId} IN (${sql.raw(repIds.map(r => `'${r}'`).join(','))})`
    });

    // Sales: dateSold within window
    const soldCount = orders.filter(o => o.dateSold >= startDate && o.dateSold <= endDate).length;

    // Connects: jobStatus=COMPLETED AND completionDate within window
    const connectedCount = orders.filter(o =>
      o.jobStatus === "COMPLETED" &&
      o.completionDate &&
      o.completionDate >= startDate &&
      o.completionDate <= endDate
    ).length;

    // Earned $: jobStatus=COMPLETED AND approvalStatus=APPROVED AND approvedAt within window
    const earnedDollars = orders
      .filter(o =>
        o.jobStatus === "COMPLETED" &&
        o.approvalStatus === "APPROVED" &&
        o.approvedAt
      )
      .filter(o => {
        const approvedDate = this.formatDateForSql(new Date(o.approvedAt!));
        return approvedDate >= startDate && approvedDate <= endDate;
      })
      .reduce((sum, o) => sum + Number(o.baseCommissionEarned) + Number(o.incentiveEarned), 0);

    return { soldCount, connectedCount, earnedDollars };
  },

  async getDailyProductionSeries(
    repIds: string[],
    startDate: string,
    endDate: string
  ): Promise<Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>> {
    if (repIds.length === 0) {
      return [];
    }

    const orders = await db.query.salesOrders.findMany({
      where: sql`${salesOrders.repId} IN (${sql.raw(repIds.map(r => `'${r}'`).join(','))})`
    });

    const series: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }> = [];
    
    // Generate each day in range
    const current = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    
    while (current <= end) {
      const dateStr = this.formatDateForSql(current);
      
      const soldCount = orders.filter(o => o.dateSold === dateStr).length;
      
      const connectedCount = orders.filter(o =>
        o.jobStatus === "COMPLETED" &&
        o.completionDate === dateStr
      ).length;
      
      const earnedDollars = orders
        .filter(o =>
          o.jobStatus === "COMPLETED" &&
          o.approvalStatus === "APPROVED" &&
          o.approvedAt &&
          this.formatDateForSql(new Date(o.approvedAt)) === dateStr
        )
        .reduce((sum, o) => sum + Number(o.baseCommissionEarned) + Number(o.incentiveEarned), 0);

      series.push({ date: dateStr, soldCount, connectedCount, earnedDollars });
      
      current.setDate(current.getDate() + 1);
    }
    
    return series;
  },

  async getRepIdsForScope(userId: string, role: string, scopeType: "personal" | "team"): Promise<string[]> {
    if (scopeType === "personal") {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      return user ? [user.repId] : [];
    }

    // Team scope based on role
    switch (role) {
      case "REP":
        return []; // REPs have no team scope

      case "SUPERVISOR": {
        const reps = await db.query.users.findMany({
          where: and(
            eq(users.assignedSupervisorId, userId),
            eq(users.role, "REP"),
            eq(users.status, "ACTIVE")
          )
        });
        return reps.map(r => r.repId);
      }

      case "MANAGER": {
        // Direct reps + indirect reps via supervisors
        const directReps = await db.query.users.findMany({
          where: and(
            eq(users.assignedManagerId, userId),
            eq(users.role, "REP"),
            eq(users.status, "ACTIVE")
          )
        });
        
        const supervisors = await db.query.users.findMany({
          where: and(
            eq(users.assignedManagerId, userId),
            eq(users.role, "SUPERVISOR"),
            eq(users.status, "ACTIVE")
          )
        });
        
        const indirectReps: User[] = [];
        for (const sup of supervisors) {
          const supReps = await db.query.users.findMany({
            where: and(
              eq(users.assignedSupervisorId, sup.id),
              eq(users.role, "REP"),
              eq(users.status, "ACTIVE")
            )
          });
          indirectReps.push(...supReps);
        }
        
        const allReps = [...directReps, ...indirectReps];
        return Array.from(new Set(allReps.map(r => r.repId)));
      }

      case "EXECUTIVE":
      case "ADMIN":
      case "FOUNDER": {
        // All active reps company-wide
        const allReps = await db.query.users.findMany({
          where: and(eq(users.role, "REP"), eq(users.status, "ACTIVE"))
        });
        return allReps.map(r => r.repId);
      }

      default:
        return [];
    }
  },

  async getTeamBreakdownByRep(
    userId: string,
    role: string,
    startDate: string,
    endDate: string
  ): Promise<Array<{ id: string; name: string; repId: string; soldCount: number; connectedCount: number; approvedCount: number; earnedDollars: number }>> {
    const repIds = await this.getRepIdsForScope(userId, role, "team");
    if (repIds.length === 0) return [];

    const usersList = await db.query.users.findMany({
      where: sql`${users.repId} IN (${sql.raw(repIds.map(r => `'${r}'`).join(','))})`
    });

    const orders = await db.query.salesOrders.findMany({
      where: sql`${salesOrders.repId} IN (${sql.raw(repIds.map(r => `'${r}'`).join(','))})`
    });

    const breakdown = usersList.map(u => {
      const repOrders = orders.filter(o => o.repId === u.repId);
      
      const soldCount = repOrders.filter(o => o.dateSold >= startDate && o.dateSold <= endDate).length;
      
      const connectedCount = repOrders.filter(o =>
        o.jobStatus === "COMPLETED" &&
        o.completionDate &&
        o.completionDate >= startDate &&
        o.completionDate <= endDate
      ).length;
      
      const approvedOrders = repOrders.filter(o =>
        o.jobStatus === "COMPLETED" &&
        o.approvalStatus === "APPROVED" &&
        o.approvedAt &&
        this.formatDateForSql(new Date(o.approvedAt)) >= startDate &&
        this.formatDateForSql(new Date(o.approvedAt)) <= endDate
      );
      
      const approvedCount = approvedOrders.length;
      const earnedDollars = approvedOrders.reduce((sum, o) => sum + Number(o.baseCommissionEarned) + Number(o.incentiveEarned), 0);

      return {
        id: u.id,
        name: u.name,
        repId: u.repId,
        soldCount,
        connectedCount,
        approvedCount,
        earnedDollars,
      };
    });

    // Sort by earned descending
    breakdown.sort((a, b) => b.earnedDollars - a.earnedDollars);
    return breakdown;
  },

  async getTeamBreakdownByManager(
    startDate: string,
    endDate: string
  ): Promise<Array<{ id: string; name: string; soldCount: number; connectedCount: number; approvedCount: number; earnedDollars: number }>> {
    const managers = await db.query.users.findMany({
      where: and(eq(users.role, "MANAGER"), eq(users.status, "ACTIVE"))
    });

    const breakdown = [];

    for (const manager of managers) {
      const repIds = await this.getRepIdsForScope(manager.id, "MANAGER", "team");
      if (repIds.length === 0) {
        breakdown.push({
          id: manager.id,
          name: manager.name,
          soldCount: 0,
          connectedCount: 0,
          approvedCount: 0,
          earnedDollars: 0,
        });
        continue;
      }

      const orders = await db.query.salesOrders.findMany({
        where: sql`${salesOrders.repId} IN (${sql.raw(repIds.map(r => `'${r}'`).join(','))})`
      });

      const soldCount = orders.filter(o => o.dateSold >= startDate && o.dateSold <= endDate).length;
      
      const connectedCount = orders.filter(o =>
        o.jobStatus === "COMPLETED" &&
        o.completionDate &&
        o.completionDate >= startDate &&
        o.completionDate <= endDate
      ).length;
      
      const approvedOrders = orders.filter(o =>
        o.jobStatus === "COMPLETED" &&
        o.approvalStatus === "APPROVED" &&
        o.approvedAt &&
        this.formatDateForSql(new Date(o.approvedAt)) >= startDate &&
        this.formatDateForSql(new Date(o.approvedAt)) <= endDate
      );
      
      const approvedCount = approvedOrders.length;
      const earnedDollars = approvedOrders.reduce((sum, o) => sum + Number(o.baseCommissionEarned) + Number(o.incentiveEarned), 0);

      breakdown.push({
        id: manager.id,
        name: manager.name,
        soldCount,
        connectedCount,
        approvedCount,
        earnedDollars,
      });
    }

    breakdown.sort((a, b) => b.earnedDollars - a.earnedDollars);
    return breakdown;
  },
};
