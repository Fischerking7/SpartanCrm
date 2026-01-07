import { db } from "./db";
import { eq, and, desc, sql, lte, gte, or, isNull, ilike, inArray, notInArray } from "drizzle-orm";
import {
  users, providers, clients, services, rateCards, salesOrders,
  incentives, overrideAgreements, chargebacks, adjustments,
  payRuns, unmatchedPayments, unmatchedChargebacks, rateIssues,
  auditLogs, exportBatches, counters, overrideEarnings, leads, commissionLineItems, mobileLineItems,
  overrideDeductionPool,
  type User, type InsertUser, type Provider, type InsertProvider,
  type Client, type InsertClient, type Service, type InsertService,
  type RateCard, type InsertRateCard, type SalesOrder, type InsertSalesOrder,
  type Incentive, type InsertIncentive, type OverrideAgreement, type InsertOverrideAgreement,
  type OverrideEarning, type InsertOverrideEarning,
  type Chargeback, type InsertChargeback, type Adjustment, type InsertAdjustment,
  type PayRun, type InsertPayRun, type UnmatchedPayment, type UnmatchedChargeback,
  type RateIssue, type AuditLog, type InsertAuditLog, type Lead, type InsertLead,
  type CommissionLineItem, type InsertCommissionLineItem,
  type MobileLineItem, type InsertMobileLineItem,
  type OverrideDeductionPool, type InsertOverrideDeductionPool,
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
  async getRateCardById(id: string) {
    return db.query.rateCards.findFirst({ where: eq(rateCards.id, id) });
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
    // First try to find service-specific rate cards
    const serviceCards = order.serviceId ? await db.query.rateCards.findMany({
      where: and(
        eq(rateCards.providerId, order.providerId),
        eq(rateCards.serviceId, order.serviceId),
        eq(rateCards.active, true),
        isNull(rateCards.deletedAt),
        lte(rateCards.effectiveStart, date),
        or(isNull(rateCards.effectiveEnd), gte(rateCards.effectiveEnd, date))
      ),
    }) : [];
    
    // Also fetch mobile-only rate cards (no service) for mobile product matching
    const mobileOnlyCards = order.mobileProductType ? await db.query.rateCards.findMany({
      where: and(
        eq(rateCards.providerId, order.providerId),
        isNull(rateCards.serviceId),
        eq(rateCards.active, true),
        isNull(rateCards.deletedAt),
        lte(rateCards.effectiveStart, date),
        or(isNull(rateCards.effectiveEnd), gte(rateCards.effectiveEnd, date))
      ),
    }) : [];
    
    const orderMobileType = order.mobileProductType;
    const orderPortedStatus = order.mobilePortedStatus;
    
    // Helper to check if rate card matches mobile criteria
    const matchesMobile = (card: RateCard, matchType: boolean, matchPorted: boolean) => {
      const typeMatch = matchType ? card.mobileProductType === orderMobileType : !card.mobileProductType;
      const portedMatch = matchPorted ? card.mobilePortedStatus === orderPortedStatus : !card.mobilePortedStatus;
      return typeMatch && portedMatch;
    };
    
    // Priority for matching (most specific to least specific):
    // 1. Service + Client + mobile type + ported status
    // 2. Service + Client + mobile type (any ported)
    // 3. Service + Client + ported status (any type)
    // 4. Service + Client (general)
    // 5-8. Same pattern for Any client
    // 9-12. Mobile-only cards follow same pattern
    
    // Service-specific cards first
    if (serviceCards.length > 0) {
      // Full match: client + mobile type + ported status
      if (orderMobileType && orderPortedStatus) {
        const fullMatch = serviceCards.find(card => card.clientId === order.clientId && matchesMobile(card, true, true));
        if (fullMatch) return fullMatch;
      }
      
      // Client + mobile type (any ported)
      if (orderMobileType) {
        const typeMatch = serviceCards.find(card => card.clientId === order.clientId && card.mobileProductType === orderMobileType && !card.mobilePortedStatus);
        if (typeMatch) return typeMatch;
      }
      
      // Client + ported status (any type)
      if (orderPortedStatus) {
        const portedMatch = serviceCards.find(card => card.clientId === order.clientId && !card.mobileProductType && card.mobilePortedStatus === orderPortedStatus);
        if (portedMatch) return portedMatch;
      }
      
      // Client only (general)
      const clientGeneral = serviceCards.find(card => card.clientId === order.clientId && !card.mobileProductType && !card.mobilePortedStatus);
      if (clientGeneral) return clientGeneral;
      
      // Any client + mobile type + ported
      if (orderMobileType && orderPortedStatus) {
        const anyFullMatch = serviceCards.find(card => !card.clientId && matchesMobile(card, true, true));
        if (anyFullMatch) return anyFullMatch;
      }
      
      // Any client + mobile type
      if (orderMobileType) {
        const anyTypeMatch = serviceCards.find(card => !card.clientId && card.mobileProductType === orderMobileType && !card.mobilePortedStatus);
        if (anyTypeMatch) return anyTypeMatch;
      }
      
      // Any client + ported status
      if (orderPortedStatus) {
        const anyPortedMatch = serviceCards.find(card => !card.clientId && !card.mobileProductType && card.mobilePortedStatus === orderPortedStatus);
        if (anyPortedMatch) return anyPortedMatch;
      }
      
      // Any client general
      const anyGeneral = serviceCards.find(card => !card.clientId && !card.mobileProductType && !card.mobilePortedStatus);
      if (anyGeneral) return anyGeneral;
      
      // Fall back to any service card
      if (serviceCards[0]) return serviceCards[0];
    }
    
    // Mobile-only rate cards (no service requirement) - used for per-product mobile rates
    if (mobileOnlyCards.length > 0 && orderMobileType) {
      // Full match with ported
      if (orderPortedStatus) {
        const fullMatch = mobileOnlyCards.find(card => card.clientId === order.clientId && matchesMobile(card, true, true));
        if (fullMatch) return fullMatch;
      }
      
      // Client + type
      const clientType = mobileOnlyCards.find(card => card.clientId === order.clientId && card.mobileProductType === orderMobileType && !card.mobilePortedStatus);
      if (clientType) return clientType;
      
      // Any client + full match
      if (orderPortedStatus) {
        const anyFullMatch = mobileOnlyCards.find(card => !card.clientId && matchesMobile(card, true, true));
        if (anyFullMatch) return anyFullMatch;
      }
      
      // Any client + type
      const anyType = mobileOnlyCards.find(card => !card.clientId && card.mobileProductType === orderMobileType && !card.mobilePortedStatus);
      if (anyType) return anyType;
    }
    
    return serviceCards[0] || mobileOnlyCards[0];
  },
  
  // Calculate commission using rate card with new payout structure - returns total for backward compatibility
  calculateCommission(rateCard: RateCard, order: SalesOrder): number {
    const lineItems = this.calculateCommissionLineItems(rateCard, order);
    return lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
  },

  // Calculate commission line items - returns separate entries for Internet, Mobile, Video
  // This now handles per-line mobile commissions using mobileLineItems table
  async calculateCommissionLineItemsAsync(rateCard: RateCard, order: SalesOrder): Promise<Omit<InsertCommissionLineItem, "salesOrderId">[]> {
    const lineItems: Omit<InsertCommissionLineItem, "salesOrderId">[] = [];
    
    const baseAmount = parseFloat(rateCard.baseAmount || "0");
    const tvAddonAmount = parseFloat(rateCard.tvAddonAmount || "0");
    
    // Internet line item (base service)
    if (baseAmount > 0) {
      lineItems.push({
        serviceCategory: "INTERNET",
        quantity: 1,
        unitAmount: baseAmount.toFixed(2),
        totalAmount: baseAmount.toFixed(2),
        mobileProductType: null,
        mobilePortedStatus: null,
        appliedRateCardId: rateCard.id,
      });
    }
    
    // Video/TV line item
    if (order.tvSold && tvAddonAmount > 0) {
      lineItems.push({
        serviceCategory: "VIDEO",
        quantity: 1,
        unitAmount: tvAddonAmount.toFixed(2),
        totalAmount: tvAddonAmount.toFixed(2),
        mobileProductType: null,
        mobilePortedStatus: null,
        appliedRateCardId: rateCard.id,
      });
    }
    
    // Mobile line items - now processed per individual line from mobileLineItems table
    if (order.mobileSold) {
      const mobileLines = await this.getMobileLineItemsByOrderId(order.id);
      
      if (mobileLines.length > 0) {
        // Process each mobile line individually
        for (const mobileLine of mobileLines) {
          // Find rate card for this specific mobile line's product type and ported status
          const mobileRateCard = await this.findRateCardForMobileLine(order, mobileLine);
          const perLineAmount = parseFloat(mobileRateCard?.mobilePerLineAmount || "0");
          
          // Always add mobile line items to show in breakdown (even if $0)
          lineItems.push({
            serviceCategory: "MOBILE",
            quantity: 1,
            unitAmount: perLineAmount.toFixed(2),
            totalAmount: perLineAmount.toFixed(2),
            mobileProductType: mobileLine.mobileProductType,
            mobilePortedStatus: mobileLine.mobilePortedStatus,
            appliedRateCardId: mobileRateCard?.id || null,
          });
          
          // Update the mobile line item with its commission
          await this.updateMobileLineItemCommission(mobileLine.id, perLineAmount.toFixed(2), mobileRateCard?.id || null);
        }
      } else {
        // Fallback: Use legacy aggregate fields if no mobile line items exist
        const mobilePerLineAmount = parseFloat(rateCard.mobilePerLineAmount || "0");
        if (order.mobileLinesQty > 0 && mobilePerLineAmount > 0) {
          const mobileTotal = mobilePerLineAmount * order.mobileLinesQty;
          lineItems.push({
            serviceCategory: "MOBILE",
            quantity: order.mobileLinesQty,
            unitAmount: mobilePerLineAmount.toFixed(2),
            totalAmount: mobileTotal.toFixed(2),
            mobileProductType: order.mobileProductType,
            mobilePortedStatus: order.mobilePortedStatus,
            appliedRateCardId: rateCard.id,
          });
        }
      }
    }
    
    return lineItems;
  },

  // Find rate card for a specific mobile line based on its product type and ported status
  async findRateCardForMobileLine(order: SalesOrder, mobileLine: MobileLineItem): Promise<RateCard | null> {
    const date = order.dateSold;
    
    // Try to find rate card matching mobile product type and ported status
    const cards = await db.query.rateCards.findMany({
      where: and(
        eq(rateCards.providerId, order.providerId),
        eq(rateCards.active, true),
        isNull(rateCards.deletedAt),
        lte(rateCards.effectiveStart, date),
        or(isNull(rateCards.effectiveEnd), gte(rateCards.effectiveEnd, date))
      ),
    });
    
    // Priority matching: most specific to least specific
    // 1. Match provider + client + mobile product type + ported status
    const fullMatch = cards.find(c => 
      c.clientId === order.clientId && 
      c.mobileProductType === mobileLine.mobileProductType && 
      c.mobilePortedStatus === mobileLine.mobilePortedStatus
    );
    if (fullMatch) return fullMatch;
    
    // 2. Match provider + client + mobile product type (any ported)
    const typeMatch = cards.find(c => 
      c.clientId === order.clientId && 
      c.mobileProductType === mobileLine.mobileProductType && 
      !c.mobilePortedStatus
    );
    if (typeMatch) return typeMatch;
    
    // 3. Match provider + client + ported status (any type)
    const portedMatch = cards.find(c => 
      c.clientId === order.clientId && 
      !c.mobileProductType && 
      c.mobilePortedStatus === mobileLine.mobilePortedStatus
    );
    if (portedMatch) return portedMatch;
    
    // 4. Match provider + client (any mobile)
    const clientMatch = cards.find(c => 
      c.clientId === order.clientId && 
      !c.mobileProductType && 
      !c.mobilePortedStatus
    );
    if (clientMatch) return clientMatch;
    
    // 5. Match provider only with mobile product type
    const providerTypeMatch = cards.find(c => 
      !c.clientId && 
      c.mobileProductType === mobileLine.mobileProductType
    );
    if (providerTypeMatch) return providerTypeMatch;
    
    // 6. Match provider only (fallback)
    const providerMatch = cards.find(c => 
      !c.clientId && 
      !c.mobileProductType
    );
    return providerMatch || null;
  },

  // Legacy synchronous version for backward compatibility
  calculateCommissionLineItems(rateCard: RateCard, order: SalesOrder): Omit<InsertCommissionLineItem, "salesOrderId">[] {
    const lineItems: Omit<InsertCommissionLineItem, "salesOrderId">[] = [];
    
    const baseAmount = parseFloat(rateCard.baseAmount || "0");
    const tvAddonAmount = parseFloat(rateCard.tvAddonAmount || "0");
    const mobilePerLineAmount = parseFloat(rateCard.mobilePerLineAmount || "0");
    
    // Internet line item (base service)
    if (baseAmount > 0) {
      lineItems.push({
        serviceCategory: "INTERNET",
        quantity: 1,
        unitAmount: baseAmount.toFixed(2),
        totalAmount: baseAmount.toFixed(2),
        mobileProductType: null,
        mobilePortedStatus: null,
        appliedRateCardId: rateCard.id,
      });
    }
    
    // Video/TV line item
    if (order.tvSold && tvAddonAmount > 0) {
      lineItems.push({
        serviceCategory: "VIDEO",
        quantity: 1,
        unitAmount: tvAddonAmount.toFixed(2),
        totalAmount: tvAddonAmount.toFixed(2),
        mobileProductType: null,
        mobilePortedStatus: null,
        appliedRateCardId: rateCard.id,
      });
    }
    
    // Mobile line item (per line) - uses aggregate fields
    if (order.mobileSold && order.mobileLinesQty > 0 && mobilePerLineAmount > 0) {
      const mobileTotal = mobilePerLineAmount * order.mobileLinesQty;
      lineItems.push({
        serviceCategory: "MOBILE",
        quantity: order.mobileLinesQty,
        unitAmount: mobilePerLineAmount.toFixed(2),
        totalAmount: mobileTotal.toFixed(2),
        mobileProductType: order.mobileProductType,
        mobilePortedStatus: order.mobilePortedStatus,
        appliedRateCardId: rateCard.id,
      });
    }
    
    return lineItems;
  },

  // Commission Line Items CRUD
  async getCommissionLineItemsByOrderId(orderId: string) {
    return db.query.commissionLineItems.findMany({
      where: eq(commissionLineItems.salesOrderId, orderId),
    });
  },
  async createCommissionLineItem(data: InsertCommissionLineItem) {
    const [item] = await db.insert(commissionLineItems).values(data).returning();
    return item;
  },
  async deleteCommissionLineItemsByOrderId(orderId: string) {
    await db.delete(commissionLineItems).where(eq(commissionLineItems.salesOrderId, orderId));
  },
  async createCommissionLineItems(orderId: string, items: Omit<InsertCommissionLineItem, "salesOrderId">[]) {
    if (items.length === 0) return [];
    const itemsWithOrderId = items.map(item => ({ ...item, salesOrderId: orderId }));
    return db.insert(commissionLineItems).values(itemsWithOrderId).returning();
  },

  // Mobile Line Items CRUD
  async getMobileLineItemsByOrderId(orderId: string) {
    return db.query.mobileLineItems.findMany({
      where: eq(mobileLineItems.salesOrderId, orderId),
      orderBy: [mobileLineItems.lineNumber],
    });
  },
  async createMobileLineItem(data: InsertMobileLineItem) {
    const [item] = await db.insert(mobileLineItems).values(data).returning();
    return item;
  },
  async deleteMobileLineItemsByOrderId(orderId: string) {
    await db.delete(mobileLineItems).where(eq(mobileLineItems.salesOrderId, orderId));
  },
  async createMobileLineItems(orderId: string, items: Omit<InsertMobileLineItem, "salesOrderId">[]) {
    if (items.length === 0) return [];
    const itemsWithOrderId = items.map((item, index) => ({ 
      ...item, 
      salesOrderId: orderId,
      lineNumber: index + 1,
    }));
    return db.insert(mobileLineItems).values(itemsWithOrderId).returning();
  },
  async updateMobileLineItemCommission(id: string, commissionAmount: string, appliedRateCardId: string | null) {
    const [item] = await db.update(mobileLineItems).set({ 
      commissionAmount, 
      appliedRateCardId 
    }).where(eq(mobileLineItems.id, id)).returning();
    return item;
  },

  // Override Deduction Pool
  async getOverrideDeductionPoolEntries(status?: "PENDING" | "DISTRIBUTED") {
    if (status) {
      return db.query.overrideDeductionPool.findMany({
        where: eq(overrideDeductionPool.status, status),
        orderBy: [desc(overrideDeductionPool.createdAt)],
      });
    }
    return db.query.overrideDeductionPool.findMany({
      orderBy: [desc(overrideDeductionPool.createdAt)],
    });
  },
  async getOverrideDeductionPoolByOrderId(orderId: string) {
    return db.query.overrideDeductionPool.findMany({
      where: eq(overrideDeductionPool.salesOrderId, orderId),
    });
  },
  async createOverrideDeductionPoolEntry(data: InsertOverrideDeductionPool) {
    const [entry] = await db.insert(overrideDeductionPool).values(data).returning();
    return entry;
  },
  async markPoolEntriesDistributed(ids: string[], exportBatchId: string) {
    const updated = await db.update(overrideDeductionPool)
      .set({ 
        status: "DISTRIBUTED", 
        exportBatchId, 
        distributedAt: new Date() 
      })
      .where(inArray(overrideDeductionPool.id, ids))
      .returning();
    return updated;
  },
  async getPendingPoolTotal() {
    const result = await db.select({
      total: sql<string>`COALESCE(SUM(${overrideDeductionPool.amount}), 0)::text`
    }).from(overrideDeductionPool).where(eq(overrideDeductionPool.status, "PENDING"));
    return result[0]?.total || "0";
  },

  // Sales Orders
  async getOrders(filter?: { repId?: string; teamRepIds?: string[]; limit?: number }) {
    if (filter?.repId) {
      return db.query.salesOrders.findMany({
        where: eq(salesOrders.repId, filter.repId),
        orderBy: [desc(salesOrders.createdAt)],
        limit: filter.limit,
      });
    }
    if (filter?.teamRepIds?.length) {
      return db.query.salesOrders.findMany({
        where: inArray(salesOrders.repId, filter.teamRepIds),
        orderBy: [desc(salesOrders.createdAt)],
        limit: filter.limit || 1000,
      });
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
  async hardDeleteOrder(id: string) {
    // Get order first to get invoice number for adjustments
    const order = await db.query.salesOrders.findFirst({ where: eq(salesOrders.id, id) });
    // Delete all related records first
    await db.delete(commissionLineItems).where(eq(commissionLineItems.salesOrderId, id));
    await db.delete(mobileLineItems).where(eq(mobileLineItems.salesOrderId, id));
    await db.delete(overrideEarnings).where(eq(overrideEarnings.salesOrderId, id));
    await db.delete(overrideDeductionPool).where(eq(overrideDeductionPool.salesOrderId, id));
    await db.delete(chargebacks).where(eq(chargebacks.salesOrderId, id));
    await db.delete(rateIssues).where(eq(rateIssues.salesOrderId, id));
    // Delete adjustments by invoice number if order exists
    if (order?.invoiceNumber) {
      await db.delete(adjustments).where(eq(adjustments.invoiceNumber, order.invoiceNumber));
    }
    // Delete the order
    await db.delete(salesOrders).where(eq(salesOrders.id, id));
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
      with: {
        client: true,
        provider: true,
        service: true,
      },
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
    return `INV-${month}${year}-${nextValue.toString().padStart(5, "0")}`;
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
  async getPayRunById(id: string) {
    return db.query.payRuns.findFirst({ where: eq(payRuns.id, id) });
  },
  async getOrdersByPayRunId(payRunId: string) {
    return db.query.salesOrders.findMany({
      where: eq(salesOrders.payRunId, payRunId),
      orderBy: [desc(salesOrders.createdAt)],
      with: {
        client: true,
        provider: true,
        service: true,
      },
    });
  },
  async createPayRun(data: InsertPayRun) {
    const [payRun] = await db.insert(payRuns).values(data).returning();
    return payRun;
  },
  async updatePayRun(id: string, data: Partial<PayRun>) {
    const [payRun] = await db.update(payRuns).set(data).where(eq(payRuns.id, id)).returning();
    return payRun;
  },
  async linkOrdersToPayRun(orderIds: string[], payRunId: string) {
    const results = [];
    for (const orderId of orderIds) {
      const [order] = await db.update(salesOrders).set({ payRunId }).where(eq(salesOrders.id, orderId)).returning();
      results.push(order);
    }
    return results;
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
  async getExportBatches() {
    return db.query.exportBatches.findMany({ orderBy: [desc(exportBatches.createdAt)] });
  },
  async getExportBatchById(id: string) {
    return db.query.exportBatches.findFirst({ where: eq(exportBatches.id, id) });
  },
  async createExportBatch(userId: string, recordCount: number, fileName?: string, notes?: string) {
    const [batch] = await db.insert(exportBatches).values({
      createdByUserId: userId,
      recordCount,
      fileName,
      notes,
    }).returning();
    return batch;
  },
  async getOrdersByExportBatch(exportBatchId: string) {
    return db.query.salesOrders.findMany({
      where: eq(salesOrders.exportBatchId, exportBatchId),
      orderBy: [desc(salesOrders.createdAt)],
    });
  },
  async markOrdersAsExported(orderIds: string[], exportBatchId: string) {
    const updated = await db.update(salesOrders)
      .set({ 
        exportedToAccounting: true, 
        exportBatchId, 
        exportedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(inArray(salesOrders.id, orderIds))
      .returning();
    return updated;
  },
  async getExportedOrders() {
    return db.query.salesOrders.findMany({
      where: eq(salesOrders.exportedToAccounting, true),
      orderBy: [desc(salesOrders.exportedAt)],
    });
  },
  async deleteExportBatch(id: string) {
    // Clear export reference from orders first
    await db.update(salesOrders)
      .set({ exportBatchId: null, exportedToAccounting: false, exportedAt: null })
      .where(eq(salesOrders.exportBatchId, id));
    // Clear export reference from override pool
    await db.update(overrideDeductionPool)
      .set({ exportBatchId: null })
      .where(eq(overrideDeductionPool.exportBatchId, id));
    // Delete the batch
    await db.delete(exportBatches).where(eq(exportBatches.id, id));
  },

  // Override Agreements
  async getOverrideAgreements() {
    return db.query.overrideAgreements.findMany({ 
      where: eq(overrideAgreements.active, true),
      orderBy: [desc(overrideAgreements.createdAt)] 
    });
  },
  async createOverrideAgreement(data: InsertOverrideAgreement) {
    const [agreement] = await db.insert(overrideAgreements).values(data).returning();
    return agreement;
  },
  async updateOverrideAgreement(id: string, data: Partial<InsertOverrideAgreement>) {
    const [agreement] = await db.update(overrideAgreements).set({ ...data, updatedAt: new Date() }).where(eq(overrideAgreements.id, id)).returning();
    return agreement;
  },
  async getActiveOverrideAgreements(recipientUserId: string, date: string, filter?: { providerId?: string; clientId?: string; serviceId?: string; mobileProductType?: string | null; mobilePortedStatus?: string | null; tvSold?: boolean }) {
    // Get all active agreements for this recipient on the given date
    const agreements = await db.query.overrideAgreements.findMany({
      where: and(
        eq(overrideAgreements.recipientUserId, recipientUserId),
        eq(overrideAgreements.active, true),
        lte(overrideAgreements.effectiveStart, date),
        or(isNull(overrideAgreements.effectiveEnd), gte(overrideAgreements.effectiveEnd, date))
      ),
    });
    return agreements.filter(a => {
      // If override specifies provider/client/service, order must match
      if (a.providerId && a.providerId !== filter?.providerId) return false;
      if (a.clientId && a.clientId !== filter?.clientId) return false;
      if (a.serviceId && a.serviceId !== filter?.serviceId) return false;
      // Mobile product type matching
      if (a.mobileProductType) {
        if (a.mobileProductType === "NO_MOBILE") {
          if (filter?.mobileProductType) return false;
        } else {
          if (a.mobileProductType !== filter?.mobileProductType) return false;
        }
      }
      // Mobile ported status matching
      if (a.mobilePortedFilter && a.mobilePortedFilter !== filter?.mobilePortedStatus) return false;
      // TV sold filter
      if (a.tvSoldFilter !== null && a.tvSoldFilter !== undefined && a.tvSoldFilter !== filter?.tvSold) return false;
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

  // Leads
  async getLeadsByRepId(repId: string, filters?: { zipCode?: string; street?: string; city?: string; dateFrom?: string; dateTo?: string; houseNumber?: string; streetName?: string; includeDisposed?: boolean }) {
    const conditions = [eq(leads.repId, repId)];
    
    // By default, exclude SOLD and REJECT dispositions (they're "removed" from rep's view)
    if (!filters?.includeDisposed) {
      conditions.push(notInArray(leads.disposition, ["SOLD", "REJECT"]));
    }
    
    if (filters?.zipCode) {
      conditions.push(ilike(leads.zipCode, `%${filters.zipCode}%`));
    }
    if (filters?.houseNumber) {
      conditions.push(ilike(leads.houseNumber, `%${filters.houseNumber}%`));
    }
    if (filters?.streetName) {
      conditions.push(ilike(leads.streetName, `%${filters.streetName}%`));
    }
    if (filters?.street) {
      conditions.push(ilike(leads.street, `%${filters.street}%`));
    }
    if (filters?.city) {
      conditions.push(ilike(leads.city, `%${filters.city}%`));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(leads.importedAt, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(lte(leads.importedAt, new Date(filters.dateTo + 'T23:59:59')));
    }
    
    return db.query.leads.findMany({
      where: and(...conditions),
      orderBy: [desc(leads.importedAt)]
    });
  },
  
  async getLeadById(id: string) {
    return db.query.leads.findFirst({ where: eq(leads.id, id) });
  },
  
  async createLead(data: InsertLead) {
    const [lead] = await db.insert(leads).values(data).returning();
    return lead;
  },
  
  async createLeads(data: InsertLead[]) {
    if (data.length === 0) return [];
    const result = await db.insert(leads).values(data).returning();
    return result;
  },
  
  async updateLeadNotes(id: string, notes: string) {
    const [lead] = await db.update(leads).set({ notes, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
    return lead;
  },
  
  async updateLeadDisposition(id: string, disposition: string) {
    const [lead] = await db.update(leads).set({ 
      disposition, 
      dispositionAt: new Date(),
      updatedAt: new Date() 
    }).where(eq(leads.id, id)).returning();
    return lead;
  },
  
  async getAllLeadsForReporting(filters?: { repId?: string; disposition?: string; dateFrom?: string; dateTo?: string }) {
    const conditions = [];
    
    if (filters?.repId) {
      conditions.push(eq(leads.repId, filters.repId));
    }
    if (filters?.disposition) {
      conditions.push(eq(leads.disposition, filters.disposition));
    }
    if (filters?.dateFrom) {
      conditions.push(gte(leads.dispositionAt, new Date(filters.dateFrom)));
    }
    if (filters?.dateTo) {
      conditions.push(lte(leads.dispositionAt, new Date(filters.dateTo + 'T23:59:59')));
    }
    
    return db.query.leads.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(leads.updatedAt)]
    });
  },
  
  async deleteLead(id: string) {
    await db.delete(leads).where(eq(leads.id, id));
  },
  async deleteLeadsByDateRange(dateFrom: string, dateTo: string) {
    const result = await db.delete(leads)
      .where(and(
        gte(leads.importedAt, new Date(dateFrom)),
        lte(leads.importedAt, new Date(dateTo + 'T23:59:59'))
      ))
      .returning();
    return result.length;
  },
  async deleteAllLeads() {
    const result = await db.delete(leads).returning();
    return result.length;
  },
};
