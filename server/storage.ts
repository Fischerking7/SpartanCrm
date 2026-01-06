import { db } from "./db";
import { eq, and, desc, sql, lte, gte, or, isNull } from "drizzle-orm";
import {
  users, providers, clients, services, rateCards, salesOrders,
  incentives, overrideAgreements, chargebacks, adjustments,
  payRuns, unmatchedPayments, unmatchedChargebacks, rateIssues,
  auditLogs, exportBatches, counters,
  type User, type InsertUser, type Provider, type InsertProvider,
  type Client, type InsertClient, type Service, type InsertService,
  type RateCard, type InsertRateCard, type SalesOrder, type InsertSalesOrder,
  type Incentive, type InsertIncentive, type OverrideAgreement,
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
  async getTeamMembers(managerId: string) {
    return db.query.users.findMany({ where: and(eq(users.assignedManagerId, managerId), eq(users.status, "ACTIVE")) });
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
  async findMatchingRateCard(order: SalesOrder, date: string) {
    const cards = await db.query.rateCards.findMany({
      where: and(
        eq(rateCards.providerId, order.providerId),
        eq(rateCards.serviceId, order.serviceId),
        eq(rateCards.active, true),
        lte(rateCards.effectiveStart, date),
        or(isNull(rateCards.effectiveEnd), gte(rateCards.effectiveEnd, date))
      ),
    });
    // Filter by conditions
    return cards.find(card => {
      if (card.clientId && card.clientId !== order.clientId) return false;
      if (card.tvCondition === "YES" && !order.tvSold) return false;
      if (card.tvCondition === "NO" && order.tvSold) return false;
      if (card.mobileCondition === "YES" && !order.mobileSold) return false;
      if (card.mobileCondition === "NO" && order.mobileSold) return false;
      if (card.linesMin && order.mobileLinesQty < card.linesMin) return false;
      if (card.linesMax && order.mobileLinesQty > card.linesMax) return false;
      return true;
    }) || cards[0];
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
};
