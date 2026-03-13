import { db } from "./db";
import { eq, and, desc, sql, lte, gte, or, isNull, ilike, inArray, notInArray, ne, asc } from "drizzle-orm";

export type TxDb = typeof db;
import {
  users, providers, clients, services, rateCards, rateCardLeadOverrides, rateCardRoleOverrides, salesOrders,
  incentives, overrideAgreements, chargebacks, adjustments,
  payRuns, unmatchedPayments, unmatchedChargebacks, rateIssues, orderExceptions,
  auditLogs, exportBatches, counters, overrideEarnings, leads, leadDispositionHistory, commissionLineItems, mobileLineItems,
  overrideDeductionPool, overrideDistributions, knowledgeDocuments,
  payrollSchedules, payRunApprovals, deductionTypes, userDeductions,
  advances, advanceRepayments, userTaxProfiles, userPaymentMethods,
  payStatements, payStatementLineItems, payStatementDeductions,
  taxDocuments, userBankAccounts, achExports, achExportItems,
  paymentReconciliations, bonuses, drawAccounts, drawTransactions,
  splitCommissionAgreements, splitCommissionRecipients, splitCommissionLedger,
  commissionTiers, commissionTierLevels, repTierAssignments, repVolumeTracking,
  scheduledPayRuns, commissionForecasts,
  emailNotifications, notificationPreferences, backgroundJobs, employeeCredentials, salesGoals,
  mduStagingOrders, scheduledReports, commissionDisputes,
  financeImports, financeImportRowsRaw, financeImportRows, arExpectations, clientColumnMappings,
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
  type OverrideDistribution, type InsertOverrideDistribution,
  type KnowledgeDocument, type InsertKnowledgeDocument,
  type PayrollSchedule, type InsertPayrollSchedule,
  type PayRunApproval, type InsertPayRunApproval,
  type DeductionType, type InsertDeductionType,
  type UserDeduction, type InsertUserDeduction,
  type Advance, type InsertAdvance, type AdvanceRepayment,
  type UserTaxProfile, type InsertUserTaxProfile,
  type UserPaymentMethod, type InsertUserPaymentMethod,
  type PayStatement, type InsertPayStatement,
  type PayStatementLineItem, type PayStatementDeduction,
  type TaxDocument, type InsertTaxDocument,
  type UserBankAccount, type InsertUserBankAccount,
  type AchExport, type InsertAchExport, type AchExportItem,
  type PaymentReconciliation, type InsertPaymentReconciliation,
  type Bonus, type InsertBonus,
  type DrawAccount, type InsertDrawAccount, type DrawTransaction,
  type SplitCommissionAgreement, type InsertSplitCommissionAgreement,
  type SplitCommissionRecipient, type SplitCommissionLedgerEntry,
  type CommissionTier, type InsertCommissionTier,
  type CommissionTierLevel, type RepTierAssignment, type RepVolumeTracking,
  type ScheduledPayRun, type InsertScheduledPayRun,
  type CommissionForecast,
  type EmailNotification, type InsertEmailNotification,
  type NotificationPreference, type InsertNotificationPreference,
  type BackgroundJob,
  type EmployeeCredential, type InsertEmployeeCredential,
  type SalesGoal, type InsertSalesGoal,
  type MduStagingOrder, type InsertMduStagingOrder,
  type ScheduledReport, type InsertScheduledReport,
  type CommissionDispute, type InsertCommissionDispute,
  type LeadDispositionHistory, type InsertLeadDispositionHistory,
  type OrderException, type InsertOrderException,
  type FinanceImport, type InsertFinanceImport,
  type FinanceImportRowRaw, type InsertFinanceImportRowRaw,
  type FinanceImportRow, type InsertFinanceImportRow,
  type ArExpectation, type InsertArExpectation,
  type ArPayment, type InsertArPayment, arPayments,
  type ClientColumnMapping, type InsertClientColumnMapping,
  userActivityLogs, type UserActivityLog, type InsertUserActivityLog,
  installSyncRuns, type InstallSyncRun, type InsertInstallSyncRun,
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
  async getActiveUserByRepId(repId: string) {
    return db.query.users.findFirst({ 
      where: and(eq(users.repId, repId), isNull(users.deletedAt)) 
    });
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
    // First get the current user to modify their repId
    const currentUser = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!currentUser) return null;
    
    // Append timestamp to repId to free it up for reuse
    const deletedRepId = `${currentUser.repId}_DELETED_${Date.now()}`;
    
    const [user] = await db.update(users).set({ 
      status: "DEACTIVATED",
      repId: deletedRepId,
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
  async getRateCardLeadOverrides(rateCardId: string) {
    return db.query.rateCardLeadOverrides.findMany({
      where: eq(rateCardLeadOverrides.rateCardId, rateCardId),
      with: { lead: true },
    });
  },
  async getLeadOverrideForRateCard(rateCardId: string, leadId: string) {
    return db.query.rateCardLeadOverrides.findFirst({
      where: and(
        eq(rateCardLeadOverrides.rateCardId, rateCardId),
        eq(rateCardLeadOverrides.leadId, leadId)
      ),
    });
  },
  async upsertRateCardLeadOverride(data: { rateCardId: string; leadId: string; overrideDeduction: string; tvOverrideDeduction: string; mobileOverrideDeduction: string }) {
    const existing = await this.getLeadOverrideForRateCard(data.rateCardId, data.leadId);
    if (existing) {
      const [updated] = await db.update(rateCardLeadOverrides).set({
        overrideDeduction: data.overrideDeduction,
        tvOverrideDeduction: data.tvOverrideDeduction,
        mobileOverrideDeduction: data.mobileOverrideDeduction,
        updatedAt: new Date(),
      }).where(eq(rateCardLeadOverrides.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(rateCardLeadOverrides).values(data).returning();
    return created;
  },
  async deleteRateCardLeadOverride(id: string) {
    await db.delete(rateCardLeadOverrides).where(eq(rateCardLeadOverrides.id, id));
  },
  
  // Role-based override methods
  async getRateCardRoleOverrides(rateCardId: string) {
    return db.query.rateCardRoleOverrides.findMany({
      where: eq(rateCardRoleOverrides.rateCardId, rateCardId),
    });
  },
  async getRoleOverrideForRateCard(rateCardId: string, role: string) {
    return db.query.rateCardRoleOverrides.findFirst({
      where: and(
        eq(rateCardRoleOverrides.rateCardId, rateCardId),
        eq(rateCardRoleOverrides.role, role as any)
      ),
    });
  },
  async upsertRateCardRoleOverride(data: { rateCardId: string; role: string; overrideDeduction: string; tvOverrideDeduction: string; mobileOverrideDeduction: string }) {
    const existing = await this.getRoleOverrideForRateCard(data.rateCardId, data.role);
    if (existing) {
      const [updated] = await db.update(rateCardRoleOverrides).set({
        overrideDeduction: data.overrideDeduction,
        tvOverrideDeduction: data.tvOverrideDeduction,
        mobileOverrideDeduction: data.mobileOverrideDeduction,
        updatedAt: new Date(),
      }).where(eq(rateCardRoleOverrides.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(rateCardRoleOverrides).values(data as any).returning();
    return created;
  },
  async deleteRateCardRoleOverride(id: string) {
    await db.delete(rateCardRoleOverrides).where(eq(rateCardRoleOverrides.id, id));
  },
  async deleteAllRoleOverridesForRateCard(rateCardId: string) {
    await db.delete(rateCardRoleOverrides).where(eq(rateCardRoleOverrides.rateCardId, rateCardId));
  },
  async saveRateCardRoleOverrides(rateCardId: string, roleOverrides: Array<{ role: string; overrideDeduction: string; tvOverrideDeduction: string; mobileOverrideDeduction: string }>) {
    // Delete all existing overrides for this rate card
    await this.deleteAllRoleOverridesForRateCard(rateCardId);
    // Insert new overrides (only those with non-zero values)
    const toInsert = roleOverrides.filter(ro => 
      parseFloat(ro.overrideDeduction) > 0 || 
      parseFloat(ro.tvOverrideDeduction) > 0 || 
      parseFloat(ro.mobileOverrideDeduction) > 0
    );
    for (const ro of toInsert) {
      await db.insert(rateCardRoleOverrides).values({
        rateCardId,
        role: ro.role as any,
        overrideDeduction: ro.overrideDeduction,
        tvOverrideDeduction: ro.tvOverrideDeduction,
        mobileOverrideDeduction: ro.mobileOverrideDeduction,
      });
    }
  },
  
  async getRateCardDependencyCount(id: string): Promise<number> {
    const orders = await db.select({ count: sql<number>`count(*)` }).from(salesOrders).where(eq(salesOrders.appliedRateCardId, id));
    return Number(orders[0]?.count || 0);
  },
  async findMatchingRateCard(order: SalesOrder, date: string) {
    // Get the rep's Lead (assignedSupervisorId) for Lead-specific rate card matching
    const rep = order.repId ? await this.getUserByRepId(order.repId) : null;
    const repLeadId = rep?.assignedSupervisorId || null;
    
    // Helper to fetch rate cards with optional leadId filter
    const fetchRateCards = async (serviceId: string | null, leadIdFilter: string | null) => {
      const conditions = [
        eq(rateCards.providerId, order.providerId),
        eq(rateCards.active, true),
        isNull(rateCards.deletedAt),
        lte(rateCards.effectiveStart, date),
        or(isNull(rateCards.effectiveEnd), gte(rateCards.effectiveEnd, date))
      ];
      
      if (serviceId) {
        conditions.push(eq(rateCards.serviceId, serviceId));
      } else {
        conditions.push(isNull(rateCards.serviceId));
      }
      
      if (leadIdFilter) {
        conditions.push(eq(rateCards.leadId, leadIdFilter));
      } else {
        conditions.push(isNull(rateCards.leadId));
      }
      
      return db.query.rateCards.findMany({ where: and(...conditions) });
    };
    
    // Helper to find best match from a set of cards
    const findBestMatch = (cards: RateCard[]) => {
      const orderMobileType = order.mobileProductType;
      const orderPortedStatus = order.mobilePortedStatus;
      
      const matchesMobile = (card: RateCard, matchType: boolean, matchPorted: boolean) => {
        const typeMatch = matchType ? card.mobileProductType === orderMobileType : !card.mobileProductType;
        const portedMatch = matchPorted ? card.mobilePortedStatus === orderPortedStatus : !card.mobilePortedStatus;
        return typeMatch && portedMatch;
      };
      
      if (cards.length === 0) return null;
      
      // Full match: client + mobile type + ported status
      if (orderMobileType && orderPortedStatus) {
        const fullMatch = cards.find(card => card.clientId === order.clientId && matchesMobile(card, true, true));
        if (fullMatch) return fullMatch;
      }
      
      // Client + mobile type (any ported)
      if (orderMobileType) {
        const typeMatch = cards.find(card => card.clientId === order.clientId && card.mobileProductType === orderMobileType && !card.mobilePortedStatus);
        if (typeMatch) return typeMatch;
      }
      
      // Client + ported status (any type)
      if (orderPortedStatus) {
        const portedMatch = cards.find(card => card.clientId === order.clientId && !card.mobileProductType && card.mobilePortedStatus === orderPortedStatus);
        if (portedMatch) return portedMatch;
      }
      
      // Client only (general)
      const clientGeneral = cards.find(card => card.clientId === order.clientId && !card.mobileProductType && !card.mobilePortedStatus);
      if (clientGeneral) return clientGeneral;
      
      // Any client + mobile type + ported
      if (orderMobileType && orderPortedStatus) {
        const anyFullMatch = cards.find(card => !card.clientId && matchesMobile(card, true, true));
        if (anyFullMatch) return anyFullMatch;
      }
      
      // Any client + mobile type
      if (orderMobileType) {
        const anyTypeMatch = cards.find(card => !card.clientId && card.mobileProductType === orderMobileType && !card.mobilePortedStatus);
        if (anyTypeMatch) return anyTypeMatch;
      }
      
      // Any client + ported status
      if (orderPortedStatus) {
        const anyPortedMatch = cards.find(card => !card.clientId && !card.mobileProductType && card.mobilePortedStatus === orderPortedStatus);
        if (anyPortedMatch) return anyPortedMatch;
      }
      
      // Any client general
      const anyGeneral = cards.find(card => !card.clientId && !card.mobileProductType && !card.mobilePortedStatus);
      if (anyGeneral) return anyGeneral;
      
      return cards[0];
    };
    
    // Try Lead-specific rate cards first, then fall back to general
    const tryFindRateCard = async (serviceId: string | null) => {
      // Priority: Lead-specific rate cards first
      if (repLeadId) {
        const leadCards = await fetchRateCards(serviceId, repLeadId);
        const leadMatch = findBestMatch(leadCards);
        if (leadMatch) return leadMatch;
      }
      
      // Fall back to general rate cards (no leadId)
      const generalCards = await fetchRateCards(serviceId, null);
      return findBestMatch(generalCards);
    };
    
    // Service-specific cards first
    if (order.serviceId) {
      const serviceMatch = await tryFindRateCard(order.serviceId);
      if (serviceMatch) return serviceMatch;
    }
    
    // Mobile-only rate cards (no service requirement)
    if (order.mobileProductType) {
      const mobileMatch = await tryFindRateCard(null);
      if (mobileMatch) return mobileMatch;
    }
    
    return null;
  },
  
  // Calculate commission using rate card with new payout structure - returns NET total after override deductions
  calculateCommission(rateCard: RateCard, order: SalesOrder): number {
    const lineItems = this.calculateCommissionLineItems(rateCard, order);
    const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
    
    // Subtract override deductions from gross commission to get net
    let totalDeduction = 0;
    
    // BASE deduction always applies if there's a base commission
    const baseDeduction = parseFloat(rateCard.overrideDeduction || "0");
    if (baseDeduction > 0 && parseFloat(rateCard.baseAmount || "0") > 0) {
      totalDeduction += baseDeduction;
    }
    
    // TV deduction applies if TV was sold
    const tvDeduction = parseFloat(rateCard.tvOverrideDeduction || "0");
    if (tvDeduction > 0 && order.tvSold) {
      totalDeduction += tvDeduction;
    }
    
    // Mobile deduction applies if mobile was sold
    const mobileDeduction = parseFloat(rateCard.mobileOverrideDeduction || "0");
    if (mobileDeduction > 0 && order.mobileSold) {
      totalDeduction += mobileDeduction;
    }
    
    return Math.max(0, grossCommission - totalDeduction);
  },

  // Calculate commission line items - returns separate entries for Internet, Mobile, Video
  // This now handles per-line mobile commissions using mobileLineItems table
  async calculateCommissionLineItemsAsync(rateCard: RateCard, order: SalesOrder): Promise<Omit<InsertCommissionLineItem, "salesOrderId">[]> {
    const lineItems: Omit<InsertCommissionLineItem, "salesOrderId">[] = [];
    
    const baseAmount = parseFloat(rateCard.baseAmount || "0");
    const tvAddonAmount = parseFloat(rateCard.tvAddonAmount || "0");
    const isMobileOnly = (order as any).isMobileOrder === true;
    
    // Internet line item (base service) - skip for mobile-only orders
    if (baseAmount > 0 && !isMobileOnly) {
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
    
    // Video/TV line item - skip for mobile-only orders
    if (order.tvSold && tvAddonAmount > 0 && !isMobileOnly) {
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
    
    // Helper to check if card has mobile payout configured
    const hasMobileAmount = (c: RateCard) => parseFloat(c.mobilePerLineAmount || "0") > 0;
    
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
      c.mobilePortedStatus === mobileLine.mobilePortedStatus &&
      hasMobileAmount(c)
    );
    if (fullMatch) return fullMatch;
    
    // 2. Match provider + client + mobile product type (any ported)
    const typeMatch = cards.find(c => 
      c.clientId === order.clientId && 
      c.mobileProductType === mobileLine.mobileProductType && 
      !c.mobilePortedStatus &&
      hasMobileAmount(c)
    );
    if (typeMatch) return typeMatch;
    
    // 3. Match provider + client + ported status (any type)
    const portedMatch = cards.find(c => 
      c.clientId === order.clientId && 
      !c.mobileProductType && 
      c.mobilePortedStatus === mobileLine.mobilePortedStatus &&
      hasMobileAmount(c)
    );
    if (portedMatch) return portedMatch;
    
    // 4. Match provider + client with any mobile amount configured
    const clientMobileMatch = cards.find(c => 
      c.clientId === order.clientId && 
      hasMobileAmount(c)
    );
    if (clientMobileMatch) return clientMobileMatch;
    
    // 5. Match provider only with mobile product type
    const providerTypeMatch = cards.find(c => 
      !c.clientId && 
      c.mobileProductType === mobileLine.mobileProductType &&
      hasMobileAmount(c)
    );
    if (providerTypeMatch) return providerTypeMatch;
    
    // 6. Match provider only with ported status
    const providerPortedMatch = cards.find(c => 
      !c.clientId && 
      !c.mobileProductType &&
      c.mobilePortedStatus === mobileLine.mobilePortedStatus &&
      hasMobileAmount(c)
    );
    if (providerPortedMatch) return providerPortedMatch;
    
    // 7. Match provider only with any mobile amount
    const providerMobileMatch = cards.find(c => 
      !c.clientId && 
      hasMobileAmount(c)
    );
    if (providerMobileMatch) return providerMobileMatch;
    
    // 8. Final fallback - any rate card (may have $0 mobile)
    const providerMatch = cards.find(c => !c.clientId);
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
  async getMobileCommissionTotalsByOrderIds(orderIds: string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();
    const results = await db.select({
      orderId: commissionLineItems.salesOrderId,
      total: sql<string>`COALESCE(SUM(${commissionLineItems.totalAmount}), 0)::text`
    }).from(commissionLineItems)
      .where(and(
        inArray(commissionLineItems.salesOrderId, orderIds),
        eq(commissionLineItems.serviceCategory, "MOBILE")
      ))
      .groupBy(commissionLineItems.salesOrderId);
    const map = new Map<string, string>();
    for (const row of results) {
      map.set(row.orderId, row.total);
    }
    return map;
  },
  async getGrossCommissionTotalsByOrderIds(orderIds: string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();
    const results = await db.select({
      orderId: commissionLineItems.salesOrderId,
      total: sql<string>`COALESCE(SUM(${commissionLineItems.totalAmount}), 0)::text`
    }).from(commissionLineItems)
      .where(inArray(commissionLineItems.salesOrderId, orderIds))
      .groupBy(commissionLineItems.salesOrderId);
    const map = new Map<string, string>();
    for (const row of results) {
      map.set(row.orderId, row.total);
    }
    return map;
  },
  async createCommissionLineItems(orderId: string, items: Omit<InsertCommissionLineItem, "salesOrderId">[], txDb?: TxDb) {
    const d = txDb ?? db;
    if (items.length === 0) return [];
    const itemsWithOrderId = items.map(item => ({ ...item, salesOrderId: orderId }));
    return d.insert(commissionLineItems).values(itemsWithOrderId).returning();
  },

  // Mobile Line Items CRUD
  async getMobileLineItemsByOrderId(orderId: string) {
    return db.query.mobileLineItems.findMany({
      where: eq(mobileLineItems.salesOrderId, orderId),
      orderBy: [mobileLineItems.lineNumber],
    });
  },
  async createMobileLineItem(data: InsertMobileLineItem, txDb?: TxDb) {
    const d = txDb ?? db;
    const [item] = await d.insert(mobileLineItems).values(data).returning();
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
  async createOverrideDeductionPoolEntry(data: InsertOverrideDeductionPool, txDb?: TxDb) {
    const d = txDb ?? db;
    const [entry] = await d.insert(overrideDeductionPool).values(data).returning();
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
  async searchOrders(searchTerm: string, limit: number = 20) {
    const words = searchTerm.trim().split(/\s+/).filter(w => w.length > 0);
    const fullTerm = `%${searchTerm}%`;
    const wordConditions = words.map(w => ilike(salesOrders.customerName, `%${w}%`));
    return db.select({
      id: salesOrders.id,
      customerName: salesOrders.customerName,
      invoiceNumber: salesOrders.invoiceNumber,
      accountNumber: salesOrders.accountNumber,
      dateSold: salesOrders.dateSold,
      approvalStatus: salesOrders.approvalStatus,
      jobStatus: salesOrders.jobStatus,
      repId: salesOrders.repId,
      baseCommissionEarned: salesOrders.baseCommissionEarned,
      incentiveEarned: salesOrders.incentiveEarned,
      overrideDeduction: salesOrders.overrideDeduction,
    })
      .from(salesOrders)
      .where(and(
        ne(salesOrders.approvalStatus, 'REJECTED'),
        or(
          and(...wordConditions),
          ilike(salesOrders.invoiceNumber, fullTerm),
          ilike(salesOrders.accountNumber, fullTerm)
        )
      ))
      .orderBy(desc(salesOrders.dateSold))
      .limit(limit);
  },

  async getOrderById(id: string) {
    return db.query.salesOrders.findFirst({ where: eq(salesOrders.id, id) });
  },
  async getOrderByInvoiceNumber(invoiceNumber: string) {
    return db.query.salesOrders.findFirst({ where: eq(salesOrders.invoiceNumber, invoiceNumber) });
  },
  async createOrder(data: InsertSalesOrder, txDb?: TxDb) {
    const d = txDb ?? db;
    const isMobile = data.isMobileOrder === true || data.mobileSold === true;
    const invoiceNumber = await this.generateInvoiceNumber(isMobile, txDb);
    const [order] = await d.insert(salesOrders).values({ ...data, invoiceNumber }).returning();
    return order;
  },
  async updateOrder(id: string, data: Partial<SalesOrder>, txDb?: TxDb) {
    const d = txDb ?? db;
    const [order] = await d.update(salesOrders).set({ ...data, updatedAt: new Date() }).where(eq(salesOrders.id, id)).returning();
    return order;
  },
  async hardDeleteOrder(id: string) {
    const order = await db.query.salesOrders.findFirst({ where: eq(salesOrders.id, id) });
    await db.delete(commissionLineItems).where(eq(commissionLineItems.salesOrderId, id));
    await db.delete(mobileLineItems).where(eq(mobileLineItems.salesOrderId, id));
    await db.delete(overrideEarnings).where(eq(overrideEarnings.salesOrderId, id));
    await db.delete(overrideDeductionPool).where(eq(overrideDeductionPool.salesOrderId, id));
    await db.delete(chargebacks).where(eq(chargebacks.salesOrderId, id));
    await db.delete(rateIssues).where(eq(rateIssues.salesOrderId, id));
    await db.delete(orderExceptions).where(eq(orderExceptions.salesOrderId, id));
    await db.delete(commissionDisputes).where(eq(commissionDisputes.salesOrderId, id));
    await db.delete(splitCommissionLedger).where(eq(splitCommissionLedger.salesOrderId, id));
    await db.delete(bonuses).where(eq(bonuses.salesOrderId, id));
    await db.delete(arExpectations).where(eq(arExpectations.orderId, id));
    await db.update(financeImportRows).set({ matchedOrderId: null }).where(eq(financeImportRows.matchedOrderId, id));
    await db.update(leads).set({ convertedToOrderId: null }).where(eq(leads.convertedToOrderId, id));
    await db.update(mduStagingOrders).set({ promotedToOrderId: null }).where(eq(mduStagingOrders.promotedToOrderId, id));
    if (order?.invoiceNumber) {
      await db.delete(adjustments).where(eq(adjustments.invoiceNumber, order.invoiceNumber));
    }
    await db.delete(salesOrders).where(eq(salesOrders.id, id));
  },
  async getPendingApprovals() {
    return db.query.salesOrders.findMany({
      where: and(
        eq(salesOrders.approvalStatus, "UNAPPROVED"),
        eq(salesOrders.jobStatus, "COMPLETED")
      ),
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
  async getAllApproved() {
    return db.query.salesOrders.findMany({
      where: eq(salesOrders.approvalStatus, "APPROVED"),
      orderBy: [desc(salesOrders.createdAt)],
      with: {
        client: true,
        provider: true,
        service: true,
      },
    });
  },

  // Invoice Numbering
  async generateInvoiceNumber(isMobile: boolean = false, txDb?: TxDb): Promise<string> {
    const d = txDb ?? db;
    const key = "invoice_number";
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, "0");
    
    const existing = await d.query.counters.findFirst({ where: eq(counters.key, key) });
    let nextValue = 1;
    if (existing) {
      nextValue = existing.value + 1;
      await d.update(counters).set({ value: nextValue }).where(eq(counters.key, key));
    } else {
      await d.insert(counters).values({ key, value: nextValue });
    }
    const prefix = isMobile ? "MINV" : "INV";
    return `${prefix}-${month}${year}-${nextValue.toString().padStart(5, "0")}`;
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
  async getChargebacksByPayRun(payRunId: string) {
    return db.query.chargebacks.findMany({ 
      where: eq(chargebacks.payRunId, payRunId),
      orderBy: [desc(chargebacks.createdAt)] 
    });
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
    return db.query.payRuns.findMany({ 
      where: isNull(payRuns.deletedAt),
      orderBy: [desc(payRuns.createdAt)] 
    });
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
  async updatePayRun(id: string, data: Partial<PayRun>, txDb?: TxDb) {
    const d = txDb ?? db;
    const [payRun] = await d.update(payRuns).set(data).where(eq(payRuns.id, id)).returning();
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
  async unlinkOrdersFromPayRun(payRunId: string) {
    return db.update(salesOrders).set({ payRunId: null }).where(eq(salesOrders.payRunId, payRunId)).returning();
  },
  async unlinkSpecificOrders(orderIds: string[]) {
    const results = [];
    for (const orderId of orderIds) {
      const [order] = await db.update(salesOrders).set({ payRunId: null }).where(eq(salesOrders.id, orderId)).returning();
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

  // Order Exceptions (flagged orders)
  async getOrderExceptions() {
    return db.query.orderExceptions.findMany({ orderBy: [desc(orderExceptions.createdAt)] });
  },
  async createOrderException(data: InsertOrderException) {
    const [record] = await db.insert(orderExceptions).values(data).returning();
    return record;
  },
  async resolveOrderException(id: string, userId: string, note: string) {
    const [record] = await db.update(orderExceptions).set({
      resolvedByUserId: userId,
      resolvedAt: new Date(),
      resolutionNote: note,
    }).where(eq(orderExceptions.id, id)).returning();
    return record;
  },

  // Audit Log
  async getAuditLogs() {
    return db.query.auditLogs.findMany({ orderBy: [desc(auditLogs.createdAt)], limit: 500 });
  },
  async createAuditLog(data: InsertAuditLog, txDb?: TxDb) {
    const d = txDb ?? db;
    const [log] = await d.insert(auditLogs).values(data).returning();
    return log;
  },
  async getAuditLogsByAction(action: string) {
    return db.query.auditLogs.findMany({
      where: eq(auditLogs.action, action),
      orderBy: [desc(auditLogs.createdAt)],
      limit: 1,
    });
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
  async getOverrideEarningsByPayRun(payRunId: string, recipientUserId?: string) {
    if (recipientUserId) {
      return db.query.overrideEarnings.findMany({ 
        where: and(
          eq(overrideEarnings.payRunId, payRunId),
          eq(overrideEarnings.recipientUserId, recipientUserId)
        ),
        orderBy: [desc(overrideEarnings.createdAt)] 
      });
    }
    return db.query.overrideEarnings.findMany({ 
      where: eq(overrideEarnings.payRunId, payRunId),
      orderBy: [desc(overrideEarnings.createdAt)] 
    });
  },
  async createOverrideEarning(data: InsertOverrideEarning, txDb?: TxDb) {
    const d = txDb ?? db;
    const [earning] = await d.insert(overrideEarnings).values(data).returning();
    return earning;
  },
  async updateOverrideEarningsPayRunId(orderIds: string[], payRunId: string | null) {
    if (orderIds.length === 0) return [];
    return db.update(overrideEarnings)
      .set({ payRunId })
      .where(inArray(overrideEarnings.salesOrderId, orderIds))
      .returning();
  },
  async getOverrideDeductionPoolByOrderIds(orderIds: string[]) {
    if (orderIds.length === 0) return [];
    return db.query.overrideDeductionPool.findMany({
      where: and(
        inArray(overrideDeductionPool.salesOrderId, orderIds),
        eq(overrideDeductionPool.status, "PENDING")
      ),
    });
  },
  async markPoolEntriesDistributedByOrderIds(orderIds: string[], payRunId: string) {
    if (orderIds.length === 0) return [];
    return db.update(overrideDeductionPool)
      .set({ 
        status: "DISTRIBUTED", 
        payRunId, 
        distributedAt: new Date() 
      })
      .where(and(
        inArray(overrideDeductionPool.salesOrderId, orderIds),
        eq(overrideDeductionPool.status, "PENDING")
      ))
      .returning();
  },
  async markPoolEntriesDistributedByIds(poolEntryIds: string[], payRunId: string, txDb?: TxDb) {
    const d = txDb ?? db;
    if (poolEntryIds.length === 0) return [];
    return d.update(overrideDeductionPool)
      .set({ 
        status: "DISTRIBUTED", 
        payRunId, 
        distributedAt: new Date() 
      })
      .where(inArray(overrideDeductionPool.id, poolEntryIds))
      .returning();
  },

  // Override Distributions
  async getOverrideDistributionsByPayRun(payRunId: string) {
    return db.query.overrideDistributions.findMany({
      where: eq(overrideDistributions.payRunId, payRunId),
      orderBy: [desc(overrideDistributions.createdAt)],
    });
  },
  async getOverrideDistributionsByPoolEntry(poolEntryId: string) {
    return db.query.overrideDistributions.findMany({
      where: eq(overrideDistributions.poolEntryId, poolEntryId),
    });
  },
  async createOverrideDistribution(data: InsertOverrideDistribution) {
    const [distribution] = await db.insert(overrideDistributions).values(data).returning();
    return distribution;
  },
  async createOverrideDistributions(data: InsertOverrideDistribution[]) {
    if (data.length === 0) return [];
    return db.insert(overrideDistributions).values(data).returning();
  },
  async updateOverrideDistribution(id: string, data: Partial<InsertOverrideDistribution>) {
    const [distribution] = await db.update(overrideDistributions)
      .set(data)
      .where(eq(overrideDistributions.id, id))
      .returning();
    return distribution;
  },
  async deleteOverrideDistribution(id: string) {
    return db.delete(overrideDistributions).where(eq(overrideDistributions.id, id));
  },
  async deleteOverrideDistributionsByPayRun(payRunId: string) {
    return db.delete(overrideDistributions).where(eq(overrideDistributions.payRunId, payRunId));
  },
  async applyOverrideDistributions(payRunId: string, txDb?: TxDb) {
    const d = txDb ?? db;
    return d.update(overrideDistributions)
      .set({ status: "APPLIED", appliedAt: new Date() })
      .where(and(
        eq(overrideDistributions.payRunId, payRunId),
        eq(overrideDistributions.status, "PENDING")
      ))
      .returning();
  },

  // Dashboard SQL Aggregations
  async getDashboardStatsSQL(repId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const dow = now.getDay();
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow));
    const weekStart = weekStartDate.toISOString().split("T")[0];
    const today = now.toISOString().split("T")[0];

    const [result] = await db.select({
      earnedMTD: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paymentStatus} = 'PAID' AND ${salesOrders.createdAt} >= ${monthStart}::date THEN (${salesOrders.baseCommissionEarned}::numeric + ${salesOrders.incentiveEarned}::numeric) ELSE 0 END), 0)`,
      paidMTD: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paidDate} >= ${monthStart} THEN ${salesOrders.commissionPaid}::numeric ELSE 0 END), 0)`,
      paidWeek: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paidDate} >= ${weekStart} THEN ${salesOrders.commissionPaid}::numeric ELSE 0 END), 0)`,
      pendingInstall: sql<number>`COUNT(CASE WHEN ${salesOrders.jobStatus} = 'PENDING' THEN 1 END)::int`,
      todayInstalls: sql<number>`COUNT(CASE WHEN ${salesOrders.installDate} = ${today} THEN 1 END)::int`,
    })
    .from(salesOrders)
    .where(eq(salesOrders.repId, repId));

    const earned = parseFloat(result.earnedMTD);
    const paid = parseFloat(result.paidMTD);
    return {
      earnedMTD: earned,
      paidMTD: paid,
      paidWeek: parseFloat(result.paidWeek),
      chargebacksMTD: 0,
      outstanding: earned - paid,
      pendingInstall: result.pendingInstall,
      todayInstalls: result.todayInstalls,
    };
  },

  async getManagerStatsSQL(teamRepIds: string[]) {
    if (teamRepIds.length === 0) return { teamEarnedMTD: 0, teamPaidMTD: 0, pendingInstalls: 0 };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const [result] = await db.select({
      teamEarnedMTD: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paymentStatus} = 'PAID' AND ${salesOrders.createdAt} >= ${monthStart}::date THEN (${salesOrders.baseCommissionEarned}::numeric + ${salesOrders.incentiveEarned}::numeric) ELSE 0 END), 0)`,
      teamPaidMTD: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paidDate} >= ${monthStart} THEN ${salesOrders.commissionPaid}::numeric ELSE 0 END), 0)`,
      pendingInstalls: sql<number>`COUNT(CASE WHEN ${salesOrders.jobStatus} = 'PENDING' THEN 1 END)::int`,
    })
    .from(salesOrders)
    .where(inArray(salesOrders.repId, teamRepIds));

    return {
      teamEarnedMTD: parseFloat(result.teamEarnedMTD),
      teamPaidMTD: parseFloat(result.teamPaidMTD),
      pendingInstalls: result.pendingInstalls,
    };
  },

  async getAdminStatsSQL() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const [result] = await db.select({
      totalEarnedMTD: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paymentStatus} = 'PAID' AND ${salesOrders.createdAt} >= ${monthStart}::date THEN (${salesOrders.baseCommissionEarned}::numeric + ${salesOrders.incentiveEarned}::numeric) ELSE 0 END), 0)`,
      totalPaidMTD: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paidDate} >= ${monthStart} THEN ${salesOrders.commissionPaid}::numeric ELSE 0 END), 0)`,
      pendingInstalls: sql<number>`COUNT(CASE WHEN ${salesOrders.jobStatus} = 'PENDING' THEN 1 END)::int`,
    })
    .from(salesOrders);

    return {
      totalEarnedMTD: parseFloat(result.totalEarnedMTD),
      totalPaidMTD: parseFloat(result.totalPaidMTD),
      pendingInstalls: result.pendingInstalls,
    };
  },

  async getLeaderboardSQL(repIds: string[], startDate: string, endDate: string) {
    const nextDay = new Date(endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const endDateExclusive = nextDay.toISOString().split("T")[0];
    
    const results = await db.select({
      repId: salesOrders.repId,
      soldCount: sql<number>`COUNT(*)::int`,
      connectsCount: sql<number>`COUNT(CASE WHEN ${salesOrders.jobStatus} = 'COMPLETED' THEN 1 END)::int`,
      earnedDollars: sql<string>`COALESCE(SUM(CASE WHEN ${salesOrders.paymentStatus} = 'PAID' THEN (${salesOrders.baseCommissionEarned}::numeric + ${salesOrders.incentiveEarned}::numeric) ELSE 0 END), 0)`,
    })
    .from(salesOrders)
    .where(and(
      inArray(salesOrders.repId, repIds),
      gte(salesOrders.dateSold, startDate),
      sql`${salesOrders.dateSold} < ${endDateExclusive}`
    ))
    .groupBy(salesOrders.repId);

    return results.map(r => ({
      repId: r.repId,
      soldCount: r.soldCount,
      connectsCount: r.connectsCount,
      earnedDollars: parseFloat(r.earnedDollars),
    }));
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
      where: and(eq(users.assignedManagerId, managerId), eq(users.role, "LEAD"), eq(users.status, "ACTIVE"))
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
      where: and(eq(users.assignedManagerId, managerId), eq(users.role, "LEAD"), eq(users.status, "ACTIVE"))
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
      where: and(eq(users.assignedExecutiveId, executiveId), eq(users.role, "LEAD"), eq(users.status, "ACTIVE"))
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
    
    // LEAD rules
    if (role === "LEAD") {
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
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startDate.setDate(startDate.getDate() + mondayOffset); // Start of week (Monday)
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
    role: "LEAD" | "MANAGER" | "EXECUTIVE",
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
      case "LEAD": {
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
      // Group by rep for LEAD and MANAGER
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

      case "LEAD": {
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
            eq(users.role, "LEAD"),
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
  async getLeadsByRepId(repId: string, filters?: { zipCode?: string; street?: string; city?: string; dateFrom?: string; dateTo?: string; houseNumber?: string; streetName?: string; includeDisposed?: boolean; customerName?: string; disposition?: string }) {
    const conditions = [eq(leads.repId, repId), isNull(leads.deletedAt)];
    
    // By default, exclude SOLD and REJECT dispositions (they're "removed" from rep's view)
    if (!filters?.includeDisposed) {
      conditions.push(notInArray(leads.disposition, ["SOLD", "REJECT"]));
    }
    
    if (filters?.customerName) {
      conditions.push(ilike(leads.customerName, `%${filters.customerName}%`));
    }
    if (filters?.disposition) {
      conditions.push(eq(leads.disposition, filters.disposition));
    }
    if (filters?.zipCode) {
      conditions.push(ilike(leads.zipCode, `%${filters.zipCode}%`));
    }
    if (filters?.houseNumber) {
      conditions.push(ilike(leads.houseNumber, `%${filters.houseNumber}%`));
    }
    if (filters?.streetName) {
      conditions.push(or(
        ilike(leads.streetName, `%${filters.streetName}%`),
        ilike(leads.street, `%${filters.streetName}%`),
        ilike(leads.customerAddress, `%${filters.streetName}%`)
      )!);
    } else if (filters?.street) {
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
  
  async getAllLeadsForAdmin() {
    return db.query.leads.findMany({
      where: isNull(leads.deletedAt),
      orderBy: [desc(leads.importedAt)]
    });
  },

  async getLeadsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.query.leads.findMany({
      where: inArray(leads.id, ids),
    });
  },

  async getLeadDispositionHistoryBulk(leadIds: string[]) {
    if (leadIds.length === 0) return [];
    return db.query.leadDispositionHistory.findMany({
      where: inArray(leadDispositionHistory.leadId, leadIds),
      orderBy: [desc(leadDispositionHistory.createdAt)],
    });
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
  
  async updateLeadDisposition(id: string, disposition: string, changedByUserId?: string, notes?: string) {
    // Get the current lead to capture previous disposition
    const currentLead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
    const previousDisposition = currentLead?.disposition || null;
    
    // Update the lead
    const [lead] = await db.update(leads).set({ 
      disposition, 
      dispositionAt: new Date(),
      updatedAt: new Date() 
    }).where(eq(leads.id, id)).returning();
    
    // Record the disposition change in history
    if (lead && previousDisposition !== disposition) {
      await db.insert(leadDispositionHistory).values({
        leadId: id,
        disposition,
        previousDisposition,
        changedByUserId,
        notes,
      });
    }
    
    return lead;
  },
  
  async getLeadDispositionHistory(leadId: string) {
    return db.query.leadDispositionHistory.findMany({
      where: eq(leadDispositionHistory.leadId, leadId),
      orderBy: [desc(leadDispositionHistory.createdAt)],
    });
  },
  
  async getLeadPool(filters?: { repId?: string; disposition?: string; search?: string; hasNotes?: boolean; page?: number; limit?: number }) {
    const conditions = [isNull(leads.deletedAt)];
    
    if (filters?.repId) {
      conditions.push(eq(leads.repId, filters.repId));
    }
    if (filters?.disposition && filters.disposition !== "ALL") {
      conditions.push(eq(leads.disposition, filters.disposition));
    }
    if (filters?.hasNotes) {
      conditions.push(sql`${leads.notes} IS NOT NULL AND ${leads.notes} != ''`);
    }
    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      conditions.push(
        or(
          ilike(leads.customerName, searchTerm),
          ilike(leads.customerPhone, searchTerm),
          ilike(leads.customerEmail, searchTerm),
          ilike(leads.street, searchTerm),
          ilike(leads.city, searchTerm),
          ilike(leads.accountNumber, searchTerm)
        )!
      );
    }
    
    const whereClause = and(...conditions);
    
    // Get total count for pagination
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(leads)
      .where(whereClause);
    const total = Number(countResult[0]?.count || 0);
    
    // Apply pagination
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;
    
    const data = await db.query.leads.findMany({
      where: whereClause,
      orderBy: [desc(leads.updatedAt)],
      limit,
      offset,
    });
    
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  },
  
  async updateLead(id: string, data: Partial<InsertLead>) {
    const [lead] = await db.update(leads).set({ 
      ...data,
      updatedAt: new Date() 
    }).where(eq(leads.id, id)).returning();
    return lead;
  },
  
  async getAllLeadsForReporting(filters?: { repId?: string; disposition?: string; dateFrom?: string; dateTo?: string; customerName?: string; houseNumber?: string; streetName?: string; city?: string; zipCode?: string }) {
    const conditions = [isNull(leads.deletedAt)];
    
    if (filters?.repId) {
      conditions.push(eq(leads.repId, filters.repId));
    }
    if (filters?.customerName) {
      conditions.push(ilike(leads.customerName, `%${filters.customerName}%`));
    }
    if (filters?.disposition) {
      conditions.push(eq(leads.disposition, filters.disposition));
    }
    if (filters?.houseNumber) {
      conditions.push(ilike(leads.houseNumber, `%${filters.houseNumber}%`));
    }
    if (filters?.streetName) {
      conditions.push(or(
        ilike(leads.streetName, `%${filters.streetName}%`),
        ilike(leads.street, `%${filters.streetName}%`),
        ilike(leads.customerAddress, `%${filters.streetName}%`)
      )!);
    }
    if (filters?.city) {
      conditions.push(ilike(leads.city, `%${filters.city}%`));
    }
    if (filters?.zipCode) {
      conditions.push(ilike(leads.zipCode, `%${filters.zipCode}%`));
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
  
  async deleteLead(id: string) {
    await db.delete(leads).where(eq(leads.id, id));
  },
  
  // Bulk soft delete leads
  async getLeadImportSorts(repId?: string) {
    const conditions = [isNull(leads.deletedAt)];
    if (repId) {
      conditions.push(eq(leads.repId, repId));
    }
    const result = await db.select({
      importDate: sql<string>`date_trunc('minute', ${leads.importedAt})`.as('import_date'),
      importedBy: leads.importedBy,
      repId: leads.repId,
      count: sql<number>`count(*)::int`.as('count'),
      earliestId: sql<string>`min(${leads.id})`.as('earliest_id'),
    })
    .from(leads)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('minute', ${leads.importedAt})`, leads.importedBy, leads.repId)
    .orderBy(desc(sql`date_trunc('minute', ${leads.importedAt})`));
    return result;
  },

  async softDeleteLeadsBySort(importDate: string, importedBy: string | null, repId: string, deletedByUserId: string) {
    const conditions = [
      isNull(leads.deletedAt),
      eq(leads.repId, repId),
      sql`date_trunc('minute', ${leads.importedAt}) = ${importDate}::timestamptz`,
    ];
    if (importedBy) {
      conditions.push(eq(leads.importedBy, importedBy));
    } else {
      conditions.push(isNull(leads.importedBy));
    }
    const result = await db.update(leads)
      .set({ deletedAt: new Date(), deletedByUserId, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return result;
  },

  async softDeleteLeads(ids: string[], deletedByUserId: string) {
    if (ids.length === 0) return [];
    const result = await db.update(leads)
      .set({ deletedAt: new Date(), deletedByUserId, updatedAt: new Date() })
      .where(inArray(leads.id, ids))
      .returning();
    return result;
  },

  // Bulk soft delete all leads for a specific rep
  async softDeleteLeadsByRepId(repId: string, deletedByUserId: string) {
    const result = await db.update(leads)
      .set({ deletedAt: new Date(), deletedByUserId, updatedAt: new Date() })
      .where(and(eq(leads.repId, repId), isNull(leads.deletedAt)))
      .returning();
    return result;
  },
  
  // Bulk assign leads to a different rep
  async assignLeadsToRep(ids: string[], newRepId: string) {
    if (ids.length === 0) return [];
    const result = await db.update(leads)
      .set({ repId: newRepId, updatedAt: new Date() })
      .where(and(inArray(leads.id, ids), isNull(leads.deletedAt)))
      .returning();
    return result;
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
  
  // Pipeline analytics methods
  async updateLeadPipelineStage(id: string, pipelineStage: string, lostReason?: string | null, lostNotes?: string | null) {
    const updates: any = {
      pipelineStage,
      stageChangedAt: new Date(),
      updatedAt: new Date(),
    };
    
    if (pipelineStage === "LOST") {
      updates.lostAt = new Date();
      updates.lostReason = lostReason || null;
      updates.lostNotes = lostNotes || null;
    }
    
    if (pipelineStage === "WON") {
      updates.disposition = "SOLD";
      updates.dispositionAt = new Date();
    }
    
    const [lead] = await db.update(leads).set(updates).where(eq(leads.id, id)).returning();
    return lead;
  },
  
  async updateLeadFollowUp(id: string, scheduledFollowUp: Date | null, followUpNotes?: string | null) {
    const [lead] = await db.update(leads).set({
      scheduledFollowUp,
      followUpNotes: followUpNotes || null,
      updatedAt: new Date(),
    }).where(eq(leads.id, id)).returning();
    return lead;
  },
  
  async logLeadContact(id: string, existingLead: { notes?: string | null; contactAttempts?: number; pipelineStage?: string }, notes?: string) {
    const updates: any = {
      lastContactedAt: new Date(),
      contactAttempts: (existingLead.contactAttempts || 0) + 1,
      updatedAt: new Date(),
    };
    
    if (existingLead.pipelineStage === "NEW") {
      updates.pipelineStage = "CONTACTED";
      updates.stageChangedAt = new Date();
    }
    
    if (notes) {
      updates.notes = existingLead.notes 
        ? `${existingLead.notes}\n[${new Date().toLocaleDateString()}] ${notes}` 
        : `[${new Date().toLocaleDateString()}] ${notes}`;
    }
    
    const [lead] = await db.update(leads).set(updates).where(eq(leads.id, id)).returning();
    return lead;
  },
  
  async getLeadsWithFollowUpsDue(repId?: string, tomorrow?: Date) {
    const now = new Date();
    const tomorrowDate = tomorrow || new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const conditions = [
      isNull(leads.deletedAt),
      lte(leads.scheduledFollowUp, tomorrowDate),
      isNull(leads.convertedToOrderId),
      ne(leads.pipelineStage, "WON"),
      ne(leads.pipelineStage, "LOST"),
    ];
    
    if (repId) {
      conditions.push(eq(leads.repId, repId));
    }
    
    return db.select({
      id: leads.id,
      repId: leads.repId,
      customerName: leads.customerName,
      customerPhone: leads.customerPhone,
      customerEmail: leads.customerEmail,
      pipelineStage: leads.pipelineStage,
      scheduledFollowUp: leads.scheduledFollowUp,
      followUpNotes: leads.followUpNotes,
    }).from(leads)
      .where(and(...conditions))
      .orderBy(asc(leads.scheduledFollowUp))
      .limit(100);
  },
  
  async getPipelineFunnelData(filters?: { startDate?: string; endDate?: string; repId?: string; providerId?: string }) {
    const conditions = [isNull(leads.deletedAt)];
    
    if (filters?.startDate) {
      conditions.push(gte(leads.createdAt, new Date(filters.startDate)));
    }
    if (filters?.endDate) {
      conditions.push(lte(leads.createdAt, new Date(filters.endDate)));
    }
    if (filters?.repId) {
      conditions.push(eq(leads.repId, filters.repId));
    }
    if (filters?.providerId) {
      conditions.push(eq(leads.interestedProviderId, filters.providerId));
    }
    
    // Get counts by pipeline stage using aggregation
    const result = await db.select({
      pipelineStage: leads.pipelineStage,
      count: sql<number>`count(*)::int`,
    }).from(leads)
      .where(and(...conditions))
      .groupBy(leads.pipelineStage);
    
    return result;
  },
  
  async getActiveLeadsForAging(repId?: string, limit: number = 50) {
    const conditions = [
      isNull(leads.deletedAt),
      ne(leads.pipelineStage, "WON"),
      ne(leads.pipelineStage, "LOST"),
    ];
    
    if (repId) {
      conditions.push(eq(leads.repId, repId));
    }
    
    return db.select({
      id: leads.id,
      customerName: leads.customerName,
      repId: leads.repId,
      pipelineStage: leads.pipelineStage,
      createdAt: leads.createdAt,
      lastContactedAt: leads.lastContactedAt,
      scheduledFollowUp: leads.scheduledFollowUp,
    }).from(leads)
      .where(and(...conditions))
      .orderBy(asc(leads.createdAt))
      .limit(limit);
  },
  
  async getClosedLeadsForWinLoss(filters?: { startDate?: string; endDate?: string }) {
    const conditions = [
      isNull(leads.deletedAt),
      or(eq(leads.pipelineStage, "WON"), eq(leads.pipelineStage, "LOST")),
    ];
    
    if (filters?.startDate) {
      conditions.push(gte(leads.stageChangedAt, new Date(filters.startDate)));
    }
    if (filters?.endDate) {
      conditions.push(lte(leads.stageChangedAt, new Date(filters.endDate)));
    }
    
    return db.select({
      id: leads.id,
      repId: leads.repId,
      pipelineStage: leads.pipelineStage,
      lostReason: leads.lostReason,
      interestedProviderId: leads.interestedProviderId,
      interestedServiceId: leads.interestedServiceId,
    }).from(leads)
      .where(and(...conditions))
      .limit(1000);
  },

  // Knowledge Documents
  async getKnowledgeDocuments() {
    return db.select().from(knowledgeDocuments)
      .where(isNull(knowledgeDocuments.deletedAt))
      .orderBy(desc(knowledgeDocuments.createdAt));
  },

  async getKnowledgeDocumentById(id: string) {
    const results = await db.select().from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, id), isNull(knowledgeDocuments.deletedAt)));
    return results[0] || null;
  },

  async createKnowledgeDocument(data: InsertKnowledgeDocument) {
    const [doc] = await db.insert(knowledgeDocuments).values(data).returning();
    return doc;
  },

  async updateKnowledgeDocument(id: string, data: Partial<InsertKnowledgeDocument>) {
    const [doc] = await db.update(knowledgeDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id))
      .returning();
    return doc;
  },

  async softDeleteKnowledgeDocument(id: string, deletedByUserId: string) {
    const [doc] = await db.update(knowledgeDocuments)
      .set({ deletedAt: new Date(), deletedByUserId, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id))
      .returning();
    return doc;
  },

  async getKnowledgeDocumentsByCategory(category: string) {
    return db.select().from(knowledgeDocuments)
      .where(and(
        eq(knowledgeDocuments.category, category),
        isNull(knowledgeDocuments.deletedAt)
      ))
      .orderBy(desc(knowledgeDocuments.createdAt));
  },

  // ================== PAYROLL SYSTEM ==================

  // Payroll Schedules
  async getPayrollSchedules() {
    return db.select().from(payrollSchedules).orderBy(desc(payrollSchedules.payDate));
  },
  async getActivePayrollSchedules() {
    return db.select().from(payrollSchedules)
      .where(eq(payrollSchedules.active, true))
      .orderBy(desc(payrollSchedules.payDate));
  },
  async getPayrollScheduleById(id: string) {
    const results = await db.select().from(payrollSchedules).where(eq(payrollSchedules.id, id));
    return results[0] || null;
  },
  async createPayrollSchedule(data: InsertPayrollSchedule) {
    const [schedule] = await db.insert(payrollSchedules).values(data).returning();
    return schedule;
  },
  async updatePayrollSchedule(id: string, data: Partial<InsertPayrollSchedule>) {
    const [schedule] = await db.update(payrollSchedules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(payrollSchedules.id, id))
      .returning();
    return schedule;
  },
  async deletePayrollSchedule(id: string) {
    await db.delete(payrollSchedules).where(eq(payrollSchedules.id, id));
  },

  // Pay Run Approvals
  async getPayRunApprovals(payRunId: string) {
    return db.select().from(payRunApprovals)
      .where(eq(payRunApprovals.payRunId, payRunId))
      .orderBy(payRunApprovals.createdAt);
  },
  async createPayRunApproval(data: InsertPayRunApproval) {
    const [approval] = await db.insert(payRunApprovals).values(data).returning();
    return approval;
  },
  async updatePayRunApproval(id: string, data: { approverId: string; status: "APPROVED" | "REJECTED"; notes?: string }) {
    const [approval] = await db.update(payRunApprovals)
      .set({ ...data, decidedAt: new Date() })
      .where(eq(payRunApprovals.id, id))
      .returning();
    return approval;
  },
  async deletePayRunApprovals(payRunId: string) {
    await db.delete(payRunApprovals).where(eq(payRunApprovals.payRunId, payRunId));
  },

  // Deduction Types
  async getDeductionTypes() {
    return db.select().from(deductionTypes).orderBy(deductionTypes.name);
  },
  async getActiveDeductionTypes() {
    return db.select().from(deductionTypes)
      .where(eq(deductionTypes.active, true))
      .orderBy(deductionTypes.name);
  },
  async getDeductionTypeById(id: string) {
    const results = await db.select().from(deductionTypes).where(eq(deductionTypes.id, id));
    return results[0] || null;
  },
  async createDeductionType(data: InsertDeductionType) {
    const [type] = await db.insert(deductionTypes).values(data).returning();
    return type;
  },
  async updateDeductionType(id: string, data: Partial<InsertDeductionType>) {
    const [type] = await db.update(deductionTypes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(deductionTypes.id, id))
      .returning();
    return type;
  },
  async deleteDeductionType(id: string) {
    await db.delete(deductionTypes).where(eq(deductionTypes.id, id));
  },

  // User Deductions
  async getUserDeductions(userId: string) {
    return db.select().from(userDeductions)
      .where(eq(userDeductions.userId, userId))
      .orderBy(desc(userDeductions.createdAt));
  },
  async getActiveUserDeductions(userId: string) {
    return db.select().from(userDeductions)
      .where(and(
        eq(userDeductions.userId, userId),
        eq(userDeductions.active, true)
      ))
      .orderBy(desc(userDeductions.createdAt));
  },
  async getAllActiveUserDeductions() {
    return db.select().from(userDeductions)
      .where(eq(userDeductions.active, true))
      .orderBy(desc(userDeductions.createdAt));
  },
  async getUserDeductionById(id: string) {
    const results = await db.select().from(userDeductions).where(eq(userDeductions.id, id));
    return results[0] || null;
  },
  async createUserDeduction(data: InsertUserDeduction) {
    const [deduction] = await db.insert(userDeductions).values(data).returning();
    return deduction;
  },
  async updateUserDeduction(id: string, data: Partial<InsertUserDeduction>) {
    const [deduction] = await db.update(userDeductions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userDeductions.id, id))
      .returning();
    return deduction;
  },
  async deleteUserDeduction(id: string) {
    await db.delete(userDeductions).where(eq(userDeductions.id, id));
  },

  // Advances
  async getAdvances() {
    return db.select().from(advances).orderBy(desc(advances.requestedAt));
  },
  async getAdvancesByUser(userId: string) {
    return db.select().from(advances)
      .where(eq(advances.userId, userId))
      .orderBy(desc(advances.requestedAt));
  },
  async getPendingAdvances() {
    return db.select().from(advances)
      .where(eq(advances.status, "PENDING"))
      .orderBy(desc(advances.requestedAt));
  },
  async getActiveAdvancesForUser(userId: string) {
    return db.select().from(advances)
      .where(and(
        eq(advances.userId, userId),
        inArray(advances.status, ["APPROVED", "PAID", "REPAYING"])
      ))
      .orderBy(desc(advances.requestedAt));
  },
  async getAdvanceById(id: string) {
    const results = await db.select().from(advances).where(eq(advances.id, id));
    return results[0] || null;
  },
  async createAdvance(data: InsertAdvance) {
    const [advance] = await db.insert(advances).values(data).returning();
    return advance;
  },
  async updateAdvance(id: string, data: Partial<Advance>) {
    const [advance] = await db.update(advances)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(advances.id, id))
      .returning();
    return advance;
  },
  async approveAdvance(id: string, approvedById: string, approvedAmount: string, notes?: string) {
    const [advance] = await db.update(advances)
      .set({ 
        status: "APPROVED", 
        approvedById, 
        approvedAmount, 
        remainingBalance: approvedAmount,
        approvedAt: new Date(),
        notes,
        updatedAt: new Date() 
      })
      .where(eq(advances.id, id))
      .returning();
    return advance;
  },
  async rejectAdvance(id: string, approvedById: string, notes?: string) {
    const [advance] = await db.update(advances)
      .set({ status: "REJECTED", approvedById, approvedAt: new Date(), notes, updatedAt: new Date() })
      .where(eq(advances.id, id))
      .returning();
    return advance;
  },
  async markAdvancePaid(id: string) {
    const adv = await this.getAdvanceById(id);
    if (!adv) return null;
    const [advance] = await db.update(advances)
      .set({ 
        status: "REPAYING", 
        paidAmount: adv.approvedAmount || "0",
        paidAt: new Date(), 
        updatedAt: new Date() 
      })
      .where(eq(advances.id, id))
      .returning();
    return advance;
  },

  // Advance Repayments
  async createAdvanceRepayment(data: { advanceId: string; payStatementId: string; amountApplied: string }) {
    const [repayment] = await db.insert(advanceRepayments).values(data).returning();
    const advance = await this.getAdvanceById(data.advanceId);
    if (advance) {
      const newBalance = parseFloat(advance.remainingBalance) - parseFloat(data.amountApplied);
      await db.update(advances)
        .set({ 
          remainingBalance: String(Math.max(0, newBalance)),
          status: newBalance <= 0 ? "REPAID" : "REPAYING",
          updatedAt: new Date()
        })
        .where(eq(advances.id, data.advanceId));
    }
    return repayment;
  },
  async getAdvanceRepayments(advanceId: string) {
    return db.select().from(advanceRepayments)
      .where(eq(advanceRepayments.advanceId, advanceId))
      .orderBy(desc(advanceRepayments.createdAt));
  },

  // User Tax Profiles
  async getUserTaxProfile(userId: string) {
    const results = await db.select().from(userTaxProfiles).where(eq(userTaxProfiles.userId, userId));
    return results[0] || null;
  },
  async getAllUserTaxProfiles() {
    return db.select().from(userTaxProfiles).orderBy(desc(userTaxProfiles.createdAt));
  },
  async createUserTaxProfile(data: InsertUserTaxProfile) {
    const [profile] = await db.insert(userTaxProfiles).values(data).returning();
    return profile;
  },
  async updateUserTaxProfile(userId: string, data: Partial<InsertUserTaxProfile>) {
    const existing = await this.getUserTaxProfile(userId);
    if (existing) {
      const [profile] = await db.update(userTaxProfiles)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(userTaxProfiles.userId, userId))
        .returning();
      return profile;
    } else {
      return this.createUserTaxProfile({ userId, ...data } as InsertUserTaxProfile);
    }
  },
  async deleteUserTaxProfile(userId: string) {
    await db.delete(userTaxProfiles).where(eq(userTaxProfiles.userId, userId));
  },

  // User Payment Methods
  async getUserPaymentMethods(userId: string) {
    return db.select().from(userPaymentMethods)
      .where(eq(userPaymentMethods.userId, userId))
      .orderBy(desc(userPaymentMethods.createdAt));
  },
  async getDefaultPaymentMethod(userId: string) {
    const results = await db.select().from(userPaymentMethods)
      .where(and(
        eq(userPaymentMethods.userId, userId),
        eq(userPaymentMethods.isDefault, true)
      ));
    return results[0] || null;
  },
  async getUserPaymentMethodById(id: string) {
    const results = await db.select().from(userPaymentMethods).where(eq(userPaymentMethods.id, id));
    return results[0] || null;
  },
  async createUserPaymentMethod(data: InsertUserPaymentMethod) {
    if (data.isDefault) {
      await db.update(userPaymentMethods)
        .set({ isDefault: false })
        .where(eq(userPaymentMethods.userId, data.userId));
    }
    const [method] = await db.insert(userPaymentMethods).values(data).returning();
    return method;
  },
  async updateUserPaymentMethod(id: string, data: Partial<InsertUserPaymentMethod>) {
    const existing = await this.getUserPaymentMethodById(id);
    if (existing && data.isDefault) {
      await db.update(userPaymentMethods)
        .set({ isDefault: false })
        .where(eq(userPaymentMethods.userId, existing.userId));
    }
    const [method] = await db.update(userPaymentMethods)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userPaymentMethods.id, id))
      .returning();
    return method;
  },
  async deleteUserPaymentMethod(id: string) {
    await db.delete(userPaymentMethods).where(eq(userPaymentMethods.id, id));
  },

  // Pay Statements
  async getPayStatements(payRunId?: string) {
    if (payRunId) {
      return db.select().from(payStatements)
        .where(eq(payStatements.payRunId, payRunId))
        .orderBy(desc(payStatements.createdAt));
    }
    return db.select().from(payStatements).orderBy(desc(payStatements.createdAt));
  },
  async getPayStatementsByUser(userId: string) {
    return db.select().from(payStatements)
      .where(eq(payStatements.userId, userId))
      .orderBy(desc(payStatements.periodEnd));
  },
  async getPayStatementById(id: string) {
    const results = await db.select().from(payStatements).where(eq(payStatements.id, id));
    return results[0] || null;
  },
  async createPayStatement(data: InsertPayStatement, txDb?: TxDb) {
    const d = txDb ?? db;
    const [statement] = await d.insert(payStatements).values(data).returning();
    return statement;
  },
  async updatePayStatement(id: string, data: Partial<PayStatement>, txDb?: TxDb) {
    const d = txDb ?? db;
    const [statement] = await d.update(payStatements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(payStatements.id, id))
      .returning();
    return statement;
  },
  async issuePayStatement(id: string) {
    const [statement] = await db.update(payStatements)
      .set({ status: "ISSUED", issuedAt: new Date(), updatedAt: new Date() })
      .where(eq(payStatements.id, id))
      .returning();
    return statement;
  },
  async markPayStatementPaid(id: string, paymentMethodId?: string, paymentReference?: string) {
    const [statement] = await db.update(payStatements)
      .set({ 
        status: "PAID", 
        paidAt: new Date(), 
        paymentMethodId, 
        paymentReference,
        updatedAt: new Date() 
      })
      .where(eq(payStatements.id, id))
      .returning();
    return statement;
  },
  async voidPayStatement(id: string) {
    const [statement] = await db.update(payStatements)
      .set({ status: "VOIDED", updatedAt: new Date() })
      .where(eq(payStatements.id, id))
      .returning();
    return statement;
  },
  async deletePayStatement(id: string) {
    await db.delete(payStatementLineItems).where(eq(payStatementLineItems.payStatementId, id));
    await db.delete(payStatementDeductions).where(eq(payStatementDeductions.payStatementId, id));
    await db.delete(payStatements).where(eq(payStatements.id, id));
  },

  // Pay Statement Line Items
  async getPayStatementLineItems(payStatementId: string) {
    return db.select().from(payStatementLineItems)
      .where(eq(payStatementLineItems.payStatementId, payStatementId))
      .orderBy(payStatementLineItems.category);
  },
  async createPayStatementLineItem(data: { payStatementId: string; category: string; description: string; sourceType?: string; sourceId?: string; quantity?: number; rate?: string; amount: string }) {
    const [item] = await db.insert(payStatementLineItems).values(data).returning();
    return item;
  },
  async deletePayStatementLineItems(payStatementId: string) {
    await db.delete(payStatementLineItems).where(eq(payStatementLineItems.payStatementId, payStatementId));
  },
  async getPayStatementLineItemsBySourceId(sourceType: string, sourceId: string) {
    return db.select().from(payStatementLineItems)
      .where(and(
        eq(payStatementLineItems.sourceType, sourceType),
        eq(payStatementLineItems.sourceId, sourceId),
      ));
  },
  async updatePayStatementLineItem(id: string, data: { amount: string }) {
    const [item] = await db.update(payStatementLineItems)
      .set(data)
      .where(eq(payStatementLineItems.id, id))
      .returning();
    return item;
  },

  // Pay Statement Deductions
  async getPayStatementDeductions(payStatementId: string) {
    return db.select().from(payStatementDeductions)
      .where(eq(payStatementDeductions.payStatementId, payStatementId));
  },
  async createPayStatementDeduction(data: { payStatementId: string; userDeductionId?: string; deductionTypeName: string; amount: string }) {
    const [deduction] = await db.insert(payStatementDeductions).values(data).returning();
    return deduction;
  },
  async deletePayStatementDeductions(payStatementId: string) {
    await db.delete(payStatementDeductions).where(eq(payStatementDeductions.payStatementId, payStatementId));
  },

  // YTD calculations
  async getYTDTotalsForUser(userId: string, year: number) {
    const startOfYear = `${year}-01-01`;
    const endOfYear = `${year}-12-31`;
    const results = await db.select({
      ytdGross: sql<number>`COALESCE(SUM(${payStatements.grossCommission} + ${payStatements.overrideEarningsTotal} + ${payStatements.incentivesTotal} + ${payStatements.adjustmentsTotal} - ${payStatements.chargebacksTotal}), 0)::numeric`,
      ytdDeductions: sql<number>`COALESCE(SUM(${payStatements.deductionsTotal} + ${payStatements.advancesApplied} + ${payStatements.taxWithheld}), 0)::numeric`,
      ytdNet: sql<number>`COALESCE(SUM(${payStatements.netPay}), 0)::numeric`,
      statementsCount: sql<number>`COUNT(*)::int`,
    })
    .from(payStatements)
    .where(and(
      eq(payStatements.userId, userId),
      gte(payStatements.periodEnd, startOfYear),
      lte(payStatements.periodEnd, endOfYear),
      inArray(payStatements.status, ["ISSUED", "PAID"])
    ));
    const r = results[0] || { ytdGross: 0, ytdDeductions: 0, ytdNet: 0, statementsCount: 0 };
    return { totalGross: String(r.ytdGross), totalDeductions: String(r.ytdDeductions), totalNetPay: String(r.ytdNet), statementsCount: r.statementsCount };
  },

  // ========== NEW PAYROLL FEATURES ==========

  // Tax Documents (1099s)
  async getTaxDocuments(filters?: { userId?: string; taxYear?: number; status?: string }) {
    const conditions = [];
    if (filters?.userId) conditions.push(eq(taxDocuments.userId, filters.userId));
    if (filters?.taxYear) conditions.push(eq(taxDocuments.taxYear, filters.taxYear));
    if (filters?.status) conditions.push(eq(taxDocuments.status, filters.status as any));
    
    return db.select().from(taxDocuments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(taxDocuments.taxYear), desc(taxDocuments.createdAt));
  },
  async getTaxDocumentById(id: string) {
    const [doc] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, id));
    return doc;
  },
  async createTaxDocument(data: InsertTaxDocument) {
    const [doc] = await db.insert(taxDocuments).values(data).returning();
    return doc;
  },
  async updateTaxDocument(id: string, data: Partial<InsertTaxDocument>) {
    const [doc] = await db.update(taxDocuments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(taxDocuments.id, id))
      .returning();
    return doc;
  },
  async generate1099DataForYear(taxYear: number) {
    const startOfYear = `${taxYear}-01-01`;
    const endOfYear = `${taxYear}-12-31`;
    
    return db.select({
      userId: payStatements.userId,
      userName: users.name,
      totalEarnings: sql<string>`COALESCE(SUM(${payStatements.netPay}), 0)`,
      statementCount: sql<number>`COUNT(${payStatements.id})`,
    })
    .from(payStatements)
    .innerJoin(users, eq(payStatements.userId, users.id))
    .where(and(
      gte(payStatements.periodEnd, startOfYear),
      lte(payStatements.periodEnd, endOfYear),
      inArray(payStatements.status, ["ISSUED", "PAID"])
    ))
    .groupBy(payStatements.userId, users.name)
    .having(sql`SUM(${payStatements.netPay}) >= 600`);
  },

  // User Bank Accounts (ACH)
  async getUserBankAccounts(userId: string) {
    return db.select().from(userBankAccounts)
      .where(and(eq(userBankAccounts.userId, userId), eq(userBankAccounts.isActive, true)))
      .orderBy(desc(userBankAccounts.isPrimary));
  },
  async getUserBankAccountById(id: string) {
    const [account] = await db.select().from(userBankAccounts).where(eq(userBankAccounts.id, id));
    return account;
  },
  async getPrimaryBankAccount(userId: string) {
    const [account] = await db.select().from(userBankAccounts)
      .where(and(eq(userBankAccounts.userId, userId), eq(userBankAccounts.isPrimary, true), eq(userBankAccounts.isActive, true)));
    return account;
  },
  async createUserBankAccount(data: InsertUserBankAccount) {
    if (data.isPrimary) {
      await db.update(userBankAccounts)
        .set({ isPrimary: false })
        .where(eq(userBankAccounts.userId, data.userId));
    }
    const [account] = await db.insert(userBankAccounts).values(data).returning();
    return account;
  },
  async updateUserBankAccount(id: string, data: Partial<InsertUserBankAccount>) {
    const [account] = await db.update(userBankAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userBankAccounts.id, id))
      .returning();
    return account;
  },
  async deactivateUserBankAccount(id: string) {
    const [account] = await db.update(userBankAccounts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(userBankAccounts.id, id))
      .returning();
    return account;
  },

  // ACH Exports
  async getAchExports(filters?: { status?: string; payRunId?: string }) {
    const conditions = [];
    if (filters?.status) conditions.push(eq(achExports.status, filters.status as any));
    if (filters?.payRunId) conditions.push(eq(achExports.payRunId, filters.payRunId));
    
    return db.select().from(achExports)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(achExports.createdAt));
  },
  async getAchExportById(id: string) {
    const [exp] = await db.select().from(achExports).where(eq(achExports.id, id));
    return exp;
  },
  async createAchExport(data: InsertAchExport) {
    const [exp] = await db.insert(achExports).values(data).returning();
    return exp;
  },
  async updateAchExport(id: string, data: Partial<InsertAchExport>) {
    const [exp] = await db.update(achExports)
      .set(data)
      .where(eq(achExports.id, id))
      .returning();
    return exp;
  },
  async generateAchBatchNumber() {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const [result] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(achExports)
      .where(sql`DATE(${achExports.createdAt}) = CURRENT_DATE`);
    const sequence = (result?.count || 0) + 1;
    return `ACH-${dateStr}-${String(sequence).padStart(3, "0")}`;
  },

  // ACH Export Items
  async getAchExportItems(achExportId: string) {
    return db.select({
      item: achExportItems,
      user: users,
    })
    .from(achExportItems)
    .innerJoin(users, eq(achExportItems.userId, users.id))
    .where(eq(achExportItems.achExportId, achExportId));
  },
  async createAchExportItem(data: { achExportId: string; payStatementId?: string; userId: string; bankAccountId?: string; amount: string; status?: string }) {
    const [item] = await db.insert(achExportItems).values(data as any).returning();
    return item;
  },
  async updateAchExportItem(id: string, data: { status?: string; traceNumber?: string; errorMessage?: string }) {
    const [item] = await db.update(achExportItems)
      .set(data as any)
      .where(eq(achExportItems.id, id))
      .returning();
    return item;
  },

  // Payment Reconciliation
  async getPaymentReconciliations(filters?: { status?: string; userId?: string }) {
    const conditions = [];
    if (filters?.status) conditions.push(eq(paymentReconciliations.status, filters.status as any));
    if (filters?.userId) conditions.push(eq(paymentReconciliations.userId, filters.userId));
    
    return db.select({
      reconciliation: paymentReconciliations,
      user: users,
    })
    .from(paymentReconciliations)
    .innerJoin(users, eq(paymentReconciliations.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(paymentReconciliations.createdAt));
  },
  async getPaymentReconciliationById(id: string) {
    const [rec] = await db.select().from(paymentReconciliations).where(eq(paymentReconciliations.id, id));
    return rec;
  },
  async createPaymentReconciliation(data: InsertPaymentReconciliation) {
    const [rec] = await db.insert(paymentReconciliations).values(data).returning();
    return rec;
  },
  async updatePaymentReconciliation(id: string, data: Partial<InsertPaymentReconciliation>) {
    const [rec] = await db.update(paymentReconciliations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(paymentReconciliations.id, id))
      .returning();
    return rec;
  },
  async matchPaymentReconciliation(id: string, paidAmount: string, paymentReference?: string, reconciledByUserId?: string) {
    const [rec] = await db.update(paymentReconciliations)
      .set({ 
        status: "MATCHED", 
        paidAmount, 
        paymentReference, 
        matchedAt: new Date(),
        reconciledByUserId,
        updatedAt: new Date() 
      })
      .where(eq(paymentReconciliations.id, id))
      .returning();
    return rec;
  },

  // Bonuses/SPIFFs
  async getBonuses(filters?: { userId?: string; status?: string; bonusType?: string }) {
    const conditions = [];
    if (filters?.userId) conditions.push(eq(bonuses.userId, filters.userId));
    if (filters?.status) conditions.push(eq(bonuses.status, filters.status as any));
    if (filters?.bonusType) conditions.push(eq(bonuses.bonusType, filters.bonusType as any));
    
    return db.select({
      bonus: bonuses,
      user: users,
    })
    .from(bonuses)
    .innerJoin(users, eq(bonuses.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bonuses.effectiveDate));
  },
  async getBonusById(id: string) {
    const [bonus] = await db.select().from(bonuses).where(eq(bonuses.id, id));
    return bonus;
  },
  async createBonus(data: InsertBonus) {
    const [bonus] = await db.insert(bonuses).values(data).returning();
    return bonus;
  },
  async updateBonus(id: string, data: Partial<InsertBonus>) {
    const [bonus] = await db.update(bonuses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bonuses.id, id))
      .returning();
    return bonus;
  },
  async approveBonus(id: string, approvedByUserId: string) {
    const [bonus] = await db.update(bonuses)
      .set({ status: "APPROVED", approvedByUserId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(bonuses.id, id))
      .returning();
    return bonus;
  },
  async cancelBonus(id: string, cancelReason: string) {
    const [bonus] = await db.update(bonuses)
      .set({ status: "CANCELLED", cancelReason, cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(bonuses.id, id))
      .returning();
    return bonus;
  },
  async getPendingBonusesForPayRun(periodEnd: string) {
    return db.select({
      bonus: bonuses,
      user: users,
    })
    .from(bonuses)
    .innerJoin(users, eq(bonuses.userId, users.id))
    .where(and(
      eq(bonuses.status, "APPROVED"),
      isNull(bonuses.payRunId),
      lte(bonuses.effectiveDate, periodEnd)
    ));
  },
  async linkBonusToPayRun(id: string, payRunId: string) {
    const [bonus] = await db.update(bonuses)
      .set({ payRunId, status: "PAID", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(bonuses.id, id))
      .returning();
    return bonus;
  },

  // Draw Accounts
  async getDrawAccounts(filters?: { userId?: string; status?: string }) {
    const conditions = [];
    if (filters?.userId) conditions.push(eq(drawAccounts.userId, filters.userId));
    if (filters?.status) conditions.push(eq(drawAccounts.status, filters.status as any));
    
    return db.select({
      drawAccount: drawAccounts,
      user: users,
    })
    .from(drawAccounts)
    .innerJoin(users, eq(drawAccounts.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(drawAccounts.createdAt));
  },
  async getDrawAccountById(id: string) {
    const [account] = await db.select().from(drawAccounts).where(eq(drawAccounts.id, id));
    return account;
  },
  async getActiveDrawAccount(userId: string) {
    const [account] = await db.select().from(drawAccounts)
      .where(and(eq(drawAccounts.userId, userId), eq(drawAccounts.status, "ACTIVE")));
    return account;
  },
  async createDrawAccount(data: InsertDrawAccount) {
    const [account] = await db.insert(drawAccounts).values(data).returning();
    return account;
  },
  async updateDrawAccount(id: string, data: Partial<InsertDrawAccount>) {
    const [account] = await db.update(drawAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(drawAccounts.id, id))
      .returning();
    return account;
  },
  async updateDrawAccountBalance(id: string, newBalance: string) {
    const status = parseFloat(newBalance) <= 0 ? "SETTLED" : "RECOVERING";
    const [account] = await db.update(drawAccounts)
      .set({ currentBalance: newBalance, status, settledAt: status === "SETTLED" ? new Date() : null, updatedAt: new Date() })
      .where(eq(drawAccounts.id, id))
      .returning();
    return account;
  },

  // Draw Transactions
  async getDrawTransactions(drawAccountId: string) {
    return db.select().from(drawTransactions)
      .where(eq(drawTransactions.drawAccountId, drawAccountId))
      .orderBy(desc(drawTransactions.periodStart));
  },
  async createDrawTransaction(data: { drawAccountId: string; payRunId?: string; periodStart: string; periodEnd: string; commissionEarned: string; guaranteeAmount: string; drawPaid?: string; recoveryApplied?: string; netPayout: string; balanceAfter: string }) {
    const [transaction] = await db.insert(drawTransactions).values(data as any).returning();
    return transaction;
  },

  // Split Commission Agreements
  async getSplitAgreements(filters?: { primaryRepId?: string; isActive?: boolean }) {
    const conditions = [];
    if (filters?.primaryRepId) conditions.push(eq(splitCommissionAgreements.primaryRepId, filters.primaryRepId));
    if (filters?.isActive !== undefined) conditions.push(eq(splitCommissionAgreements.isActive, filters.isActive));
    
    return db.select({
      agreement: splitCommissionAgreements,
      primaryRep: users,
    })
    .from(splitCommissionAgreements)
    .innerJoin(users, eq(splitCommissionAgreements.primaryRepId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(splitCommissionAgreements.createdAt));
  },
  async getSplitAgreementById(id: string) {
    const [agreement] = await db.select().from(splitCommissionAgreements).where(eq(splitCommissionAgreements.id, id));
    return agreement;
  },
  async createSplitAgreement(data: InsertSplitCommissionAgreement) {
    const [agreement] = await db.insert(splitCommissionAgreements).values(data).returning();
    return agreement;
  },
  async updateSplitAgreement(id: string, data: Partial<InsertSplitCommissionAgreement>) {
    const [agreement] = await db.update(splitCommissionAgreements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(splitCommissionAgreements.id, id))
      .returning();
    return agreement;
  },

  // Split Commission Recipients
  async getSplitRecipients(agreementId: string) {
    return db.select({
      recipient: splitCommissionRecipients,
      user: users,
    })
    .from(splitCommissionRecipients)
    .innerJoin(users, eq(splitCommissionRecipients.userId, users.id))
    .where(eq(splitCommissionRecipients.agreementId, agreementId));
  },
  async createSplitRecipient(data: { agreementId: string; userId: string; splitType: string; splitValue: string }) {
    const [recipient] = await db.insert(splitCommissionRecipients).values(data as any).returning();
    return recipient;
  },
  async deleteSplitRecipients(agreementId: string) {
    await db.delete(splitCommissionRecipients).where(eq(splitCommissionRecipients.agreementId, agreementId));
  },

  // Split Commission Ledger
  async getSplitLedgerEntries(filters?: { salesOrderId?: string; recipientUserId?: string }) {
    const conditions = [];
    if (filters?.salesOrderId) conditions.push(eq(splitCommissionLedger.salesOrderId, filters.salesOrderId));
    if (filters?.recipientUserId) conditions.push(eq(splitCommissionLedger.recipientUserId, filters.recipientUserId));
    
    return db.select().from(splitCommissionLedger)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(splitCommissionLedger.createdAt));
  },
  async createSplitLedgerEntry(data: { salesOrderId: string; agreementId: string; recipientUserId: string; originalAmount: string; splitAmount: string }) {
    const [entry] = await db.insert(splitCommissionLedger).values(data as any).returning();
    return entry;
  },

  // Commission Tiers
  async getCommissionTiers(filters?: { providerId?: string; isActive?: boolean }) {
    const conditions = [];
    if (filters?.providerId) conditions.push(eq(commissionTiers.providerId, filters.providerId));
    if (filters?.isActive !== undefined) conditions.push(eq(commissionTiers.isActive, filters.isActive));
    
    return db.select().from(commissionTiers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(commissionTiers.createdAt));
  },
  async getCommissionTierById(id: string) {
    const [tier] = await db.select().from(commissionTiers).where(eq(commissionTiers.id, id));
    return tier;
  },
  async createCommissionTier(data: InsertCommissionTier) {
    const [tier] = await db.insert(commissionTiers).values(data).returning();
    return tier;
  },
  async updateCommissionTier(id: string, data: Partial<InsertCommissionTier>) {
    const [tier] = await db.update(commissionTiers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(commissionTiers.id, id))
      .returning();
    return tier;
  },

  // Commission Tier Levels
  async getTierLevels(tierId: string) {
    return db.select().from(commissionTierLevels)
      .where(eq(commissionTierLevels.tierId, tierId))
      .orderBy(commissionTierLevels.minVolume);
  },
  async createTierLevel(data: { tierId: string; minVolume: string; maxVolume?: string; bonusPercentage?: string; bonusFlat?: string; multiplier?: string }) {
    const [level] = await db.insert(commissionTierLevels).values(data as any).returning();
    return level;
  },
  async deleteTierLevels(tierId: string) {
    await db.delete(commissionTierLevels).where(eq(commissionTierLevels.tierId, tierId));
  },

  // Rep Tier Assignments
  async getRepTierAssignments(userId: string) {
    return db.select({
      assignment: repTierAssignments,
      tier: commissionTiers,
    })
    .from(repTierAssignments)
    .innerJoin(commissionTiers, eq(repTierAssignments.tierId, commissionTiers.id))
    .where(eq(repTierAssignments.userId, userId));
  },
  async createRepTierAssignment(data: { userId: string; tierId: string; effectiveStart: string; effectiveEnd?: string; createdByUserId?: string }) {
    const [assignment] = await db.insert(repTierAssignments).values(data as any).returning();
    return assignment;
  },
  async deleteRepTierAssignment(id: string) {
    await db.delete(repTierAssignments).where(eq(repTierAssignments.id, id));
  },

  // Volume Tracking
  async getRepVolumeTracking(userId: string, periodType: string, periodStart: string) {
    const [tracking] = await db.select().from(repVolumeTracking)
      .where(and(
        eq(repVolumeTracking.userId, userId),
        eq(repVolumeTracking.periodType, periodType),
        eq(repVolumeTracking.periodStart, periodStart)
      ));
    return tracking;
  },
  async upsertRepVolumeTracking(data: { userId: string; periodType: string; periodStart: string; periodEnd: string; orderCount: number; totalVolume: string; totalCommission: string; tierBonusEarned?: string; currentTierId?: string }) {
    const existing = await this.getRepVolumeTracking(data.userId, data.periodType, data.periodStart);
    if (existing) {
      const [tracking] = await db.update(repVolumeTracking)
        .set({ ...data, calculatedAt: new Date() } as any)
        .where(eq(repVolumeTracking.id, existing.id))
        .returning();
      return tracking;
    }
    const [tracking] = await db.insert(repVolumeTracking).values(data as any).returning();
    return tracking;
  },

  // Scheduled Pay Runs
  async getScheduledPayRuns() {
    return db.select().from(scheduledPayRuns).orderBy(scheduledPayRuns.name);
  },
  async getScheduledPayRunById(id: string) {
    const [schedule] = await db.select().from(scheduledPayRuns).where(eq(scheduledPayRuns.id, id));
    return schedule;
  },
  async getActiveScheduledPayRuns() {
    return db.select().from(scheduledPayRuns)
      .where(eq(scheduledPayRuns.isActive, true));
  },
  async createScheduledPayRun(data: InsertScheduledPayRun) {
    const [schedule] = await db.insert(scheduledPayRuns).values(data).returning();
    return schedule;
  },
  async updateScheduledPayRun(id: string, data: Partial<InsertScheduledPayRun>) {
    const [schedule] = await db.update(scheduledPayRuns)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scheduledPayRuns.id, id))
      .returning();
    return schedule;
  },
  async deleteScheduledPayRun(id: string) {
    await db.delete(scheduledPayRuns).where(eq(scheduledPayRuns.id, id));
  },

  // Commission Forecasts
  async getCommissionForecasts(filters?: { userId?: string; forecastPeriod?: string }) {
    const conditions = [];
    if (filters?.userId) conditions.push(eq(commissionForecasts.userId, filters.userId));
    if (filters?.forecastPeriod) conditions.push(eq(commissionForecasts.forecastPeriod, filters.forecastPeriod));
    
    return db.select().from(commissionForecasts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(commissionForecasts.periodStart));
  },
  async createCommissionForecast(data: { userId?: string; forecastPeriod: string; periodStart: string; periodEnd: string; pendingOrders?: number; pendingCommission?: string; projectedOrders?: number; projectedCommission?: string; historicalAverage?: string; confidenceScore?: string }) {
    const [forecast] = await db.insert(commissionForecasts).values(data as any).returning();
    return forecast;
  },
  async calculateCommissionForecast(userId: string, periodType: string, periodStart: string, periodEnd: string) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return { pendingOrders: 0, pendingCommission: "0", historicalAverage: "0", projectedOrders: 0 };
    
    const pendingOrdersResult = await db.select({
      count: sql<number>`COUNT(*)`,
      total: sql<string>`COALESCE(SUM(${salesOrders.baseCommissionEarned}), 0)`,
    })
    .from(salesOrders)
    .where(and(
      eq(salesOrders.repId, user.repId),
      eq(salesOrders.approvalStatus, "APPROVED"),
      isNull(salesOrders.payRunId),
      gte(salesOrders.dateSold, periodStart),
      lte(salesOrders.dateSold, periodEnd)
    ));
    
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const historicalResult = await db.select({
      avgCommission: sql<string>`COALESCE(AVG(${salesOrders.baseCommissionEarned}::numeric), 0)`,
      avgOrders: sql<string>`COALESCE(COUNT(*) / 3.0, 0)`,
    })
    .from(salesOrders)
    .where(and(
      eq(salesOrders.repId, user.repId),
      eq(salesOrders.approvalStatus, "APPROVED"),
      gte(salesOrders.dateSold, threeMonthsAgo.toISOString().slice(0, 10))
    ));
    
    return {
      pendingOrders: pendingOrdersResult[0]?.count || 0,
      pendingCommission: pendingOrdersResult[0]?.total || "0",
      historicalAverage: historicalResult[0]?.avgCommission || "0",
      projectedOrders: Math.round(parseFloat(historicalResult[0]?.avgOrders || "0")),
    };
  },

  // Email Notifications
  async getEmailNotifications(filters?: { userId?: string; status?: string }) {
    const conditions = [];
    if (filters?.userId) conditions.push(eq(emailNotifications.userId, filters.userId));
    if (filters?.status) conditions.push(eq(emailNotifications.status, filters.status as any));
    
    return db.select().from(emailNotifications)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(emailNotifications.createdAt));
  },
  async getPendingNotifications(limit = 50) {
    return db.select().from(emailNotifications)
      .where(eq(emailNotifications.status, "PENDING"))
      .orderBy(emailNotifications.createdAt)
      .limit(limit);
  },
  async createEmailNotification(data: Omit<InsertEmailNotification, "id" | "createdAt">) {
    const [notification] = await db.insert(emailNotifications).values(data).returning();
    return notification;
  },
  async updateEmailNotification(id: string, data: { status?: string; sentAt?: Date; errorMessage?: string; retryCount?: number; isRead?: boolean; readAt?: Date }) {
    const [notification] = await db.update(emailNotifications)
      .set(data as any)
      .where(eq(emailNotifications.id, id))
      .returning();
    return notification;
  },

  async getUserNotifications(userId: string, limit = 50) {
    return db.select().from(emailNotifications)
      .where(eq(emailNotifications.userId, userId))
      .orderBy(desc(emailNotifications.createdAt))
      .limit(limit);
  },

  async getUnreadNotificationCount(userId: string) {
    const result = await db.select({ count: sql<number>`count(*)::int` })
      .from(emailNotifications)
      .where(and(
        eq(emailNotifications.userId, userId),
        eq(emailNotifications.isRead, false)
      ));
    return result[0]?.count || 0;
  },

  async markNotificationRead(id: string, userId: string) {
    const [notification] = await db.update(emailNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(emailNotifications.id, id),
        eq(emailNotifications.userId, userId)
      ))
      .returning();
    return notification;
  },

  async markAllNotificationsRead(userId: string) {
    const result = await db.update(emailNotifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(emailNotifications.userId, userId),
        eq(emailNotifications.isRead, false)
      ))
      .returning();
    return result.length;
  },

  // Notification Preferences
  async getNotificationPreferences(userId: string) {
    return db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });
  },
  async upsertNotificationPreferences(userId: string, data: Partial<InsertNotificationPreference>) {
    const existing = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });
    
    if (existing) {
      const [updated] = await db.update(notificationPreferences)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationPreferences.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(notificationPreferences)
        .values({ userId, ...data } as any)
        .returning();
      return created;
    }
  },

  // Background Jobs
  async createBackgroundJob(data: { jobType: string; metadata?: string }) {
    const [job] = await db.insert(backgroundJobs).values(data).returning();
    return job;
  },
  async updateBackgroundJob(id: string, data: { status?: string; startedAt?: Date; completedAt?: Date; result?: string; errorMessage?: string }) {
    const [job] = await db.update(backgroundJobs)
      .set(data)
      .where(eq(backgroundJobs.id, id))
      .returning();
    return job;
  },
  async getRecentBackgroundJobs(jobType?: string, limit = 20) {
    const conditions = [];
    if (jobType) conditions.push(eq(backgroundJobs.jobType, jobType));
    
    return db.select().from(backgroundJobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(backgroundJobs.createdAt))
      .limit(limit);
  },

  // Scheduled Reports
  async getScheduledReports(userId?: string) {
    if (userId) {
      return db.select().from(scheduledReports)
        .where(eq(scheduledReports.userId, userId))
        .orderBy(desc(scheduledReports.createdAt));
    }
    return db.select().from(scheduledReports)
      .orderBy(desc(scheduledReports.createdAt));
  },

  async getActiveScheduledReports() {
    return db.select().from(scheduledReports)
      .where(eq(scheduledReports.isActive, true));
  },

  async getScheduledReportById(id: string) {
    return db.query.scheduledReports.findFirst({
      where: eq(scheduledReports.id, id),
    });
  },

  async createScheduledReport(data: InsertScheduledReport) {
    const [report] = await db.insert(scheduledReports).values(data).returning();
    return report;
  },

  async updateScheduledReport(id: string, data: Partial<InsertScheduledReport> & { lastSentAt?: Date; nextSendAt?: Date }) {
    const [report] = await db.update(scheduledReports)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scheduledReports.id, id))
      .returning();
    return report;
  },

  async deleteScheduledReport(id: string) {
    await db.delete(scheduledReports).where(eq(scheduledReports.id, id));
  },

  // Unmatched Chargebacks helpers
  async getUnresolvedUnmatchedChargebacks() {
    return db.query.unmatchedChargebacks.findMany({
      where: isNull(unmatchedChargebacks.resolvedAt),
    });
  },

  // Employee Credentials - Multiple entries per user
  async getEmployeeCredentialsByUser(userId: string) {
    return db.query.employeeCredentials.findMany({
      where: eq(employeeCredentials.userId, userId),
      orderBy: [employeeCredentials.entryLabel],
    });
  },

  async getEmployeeCredentialById(credentialId: string) {
    return db.query.employeeCredentials.findFirst({
      where: eq(employeeCredentials.id, credentialId),
    });
  },

  async getAllEmployeeCredentials() {
    return db.select({
      credentials: employeeCredentials,
      user: {
        id: users.id,
        name: users.name,
        repId: users.repId,
        role: users.role,
        status: users.status,
      },
    })
      .from(employeeCredentials)
      .leftJoin(users, eq(employeeCredentials.userId, users.id))
      .orderBy(users.name, employeeCredentials.entryLabel);
  },

  async createEmployeeCredential(userId: string, data: Partial<InsertEmployeeCredential>, lastUpdatedByUserId?: string) {
    const [created] = await db.insert(employeeCredentials)
      .values({ 
        userId, 
        ...data,
        updatedAt: new Date(),
        lastUpdatedByUserId,
      } as any)
      .returning();
    return created;
  },

  async updateEmployeeCredential(credentialId: string, data: Partial<InsertEmployeeCredential>, lastUpdatedByUserId?: string) {
    const [updated] = await db.update(employeeCredentials)
      .set({
        ...data,
        updatedAt: new Date(),
        lastUpdatedByUserId,
      })
      .where(eq(employeeCredentials.id, credentialId))
      .returning();
    return updated;
  },

  async deleteEmployeeCredential(credentialId: string) {
    const [deleted] = await db.delete(employeeCredentials)
      .where(eq(employeeCredentials.id, credentialId))
      .returning();
    return deleted;
  },

  // Sales Goals
  async getSalesGoalsByUser(userId: string) {
    return db.query.salesGoals.findMany({
      where: eq(salesGoals.userId, userId),
      orderBy: [desc(salesGoals.periodStart)],
    });
  },

  async getAllSalesGoals() {
    return db.query.salesGoals.findMany({
      orderBy: [desc(salesGoals.periodStart)],
    });
  },

  async getSalesGoalById(id: string) {
    return db.query.salesGoals.findFirst({
      where: eq(salesGoals.id, id),
    });
  },

  async createSalesGoal(data: InsertSalesGoal) {
    const [goal] = await db.insert(salesGoals).values(data).returning();
    return goal;
  },

  async updateSalesGoal(id: string, data: Partial<InsertSalesGoal>) {
    const [goal] = await db.update(salesGoals)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(salesGoals.id, id))
      .returning();
    return goal;
  },

  async deleteSalesGoal(id: string) {
    const [deleted] = await db.delete(salesGoals)
      .where(eq(salesGoals.id, id))
      .returning();
    return deleted;
  },

  // MDU Staging Orders
  async getMduStagingOrders(mduRepId?: string) {
    if (mduRepId) {
      return db.query.mduStagingOrders.findMany({
        where: eq(mduStagingOrders.mduRepId, mduRepId),
        orderBy: [desc(mduStagingOrders.createdAt)],
      });
    }
    return db.query.mduStagingOrders.findMany({
      orderBy: [desc(mduStagingOrders.createdAt)],
    });
  },

  async getMduStagingOrderById(id: string) {
    return db.query.mduStagingOrders.findFirst({
      where: eq(mduStagingOrders.id, id),
    });
  },

  async getPendingMduStagingOrders() {
    return db.query.mduStagingOrders.findMany({
      where: eq(mduStagingOrders.status, "PENDING"),
      orderBy: [desc(mduStagingOrders.createdAt)],
    });
  },

  async createMduStagingOrder(data: InsertMduStagingOrder) {
    const [order] = await db.insert(mduStagingOrders).values(data).returning();
    return order;
  },

  async updateMduStagingOrder(id: string, data: Partial<MduStagingOrder>) {
    const [order] = await db.update(mduStagingOrders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mduStagingOrders.id, id))
      .returning();
    return order;
  },

  async deleteMduStagingOrder(id: string) {
    const [deleted] = await db.delete(mduStagingOrders)
      .where(eq(mduStagingOrders.id, id))
      .returning();
    return deleted;
  },

  // Commission Disputes
  async getCommissionDisputes(filters?: { userId?: string; status?: string }) {
    const conditions = [];
    if (filters?.userId) conditions.push(eq(commissionDisputes.userId, filters.userId));
    if (filters?.status) conditions.push(eq(commissionDisputes.status, filters.status as any));
    
    return db.select({
      dispute: commissionDisputes,
      user: { id: users.id, name: users.name, repId: users.repId },
    })
    .from(commissionDisputes)
    .leftJoin(users, eq(commissionDisputes.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(commissionDisputes.createdAt));
  },

  async getCommissionDisputeById(id: string) {
    const [result] = await db.select({
      dispute: commissionDisputes,
      user: { id: users.id, name: users.name, repId: users.repId },
    })
    .from(commissionDisputes)
    .leftJoin(users, eq(commissionDisputes.userId, users.id))
    .where(eq(commissionDisputes.id, id));
    return result;
  },

  async getCommissionDisputesByUser(userId: string) {
    return db.select()
      .from(commissionDisputes)
      .where(eq(commissionDisputes.userId, userId))
      .orderBy(desc(commissionDisputes.createdAt));
  },

  async createCommissionDispute(data: InsertCommissionDispute) {
    const [dispute] = await db.insert(commissionDisputes).values(data).returning();
    return dispute;
  },

  async updateCommissionDispute(id: string, data: Partial<CommissionDispute>) {
    const [dispute] = await db.update(commissionDisputes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(commissionDisputes.id, id))
      .returning();
    return dispute;
  },

  async resolveCommissionDispute(id: string, data: { status: string; resolution: string; resolvedAmount?: string; resolvedByUserId: string }) {
    const [dispute] = await db.update(commissionDisputes)
      .set({
        status: data.status as any,
        resolution: data.resolution,
        resolvedAmount: data.resolvedAmount,
        resolvedByUserId: data.resolvedByUserId,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(commissionDisputes.id, id))
      .returning();
    return dispute;
  },

  async getPendingDisputesCount() {
    const [result] = await db.select({ count: sql<number>`COUNT(*)::int` })
      .from(commissionDisputes)
      .where(inArray(commissionDisputes.status, ["PENDING", "UNDER_REVIEW"]));
    return result?.count || 0;
  },

  // Finance Imports
  async getFinanceImports(clientId?: string) {
    if (clientId) {
      return db.query.financeImports.findMany({
        where: eq(financeImports.clientId, clientId),
        orderBy: [desc(financeImports.importedAt)],
        with: { client: true, importedBy: true }
      });
    }
    return db.query.financeImports.findMany({
      orderBy: [desc(financeImports.importedAt)],
      with: { client: true, importedBy: true }
    });
  },

  async getFinanceImportById(id: string) {
    return db.query.financeImports.findFirst({
      where: eq(financeImports.id, id),
      with: { client: true, importedBy: true }
    });
  },

  async getFinanceImportByClientAndHash(clientId: string, fileHash: string) {
    return db.query.financeImports.findFirst({
      where: and(eq(financeImports.clientId, clientId), eq(financeImports.fileHash, fileHash))
    });
  },

  async createFinanceImport(data: InsertFinanceImport) {
    const [result] = await db.insert(financeImports).values(data).returning();
    return result;
  },

  async updateFinanceImport(id: string, data: Partial<FinanceImport>) {
    const [result] = await db.update(financeImports)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(financeImports.id, id))
      .returning();
    return result;
  },

  async deleteFinanceImport(id: string) {
    const rows = await db.select({ id: financeImportRows.id }).from(financeImportRows).where(eq(financeImportRows.financeImportId, id));
    const rowIds = rows.map(r => r.id);
    if (rowIds.length > 0) {
      const arExps = await db.select({ id: arExpectations.id }).from(arExpectations).where(inArray(arExpectations.financeImportRowId, rowIds));
      const arExpIds = arExps.map(a => a.id);
      if (arExpIds.length > 0) {
        await db.delete(arPayments).where(inArray(arPayments.arExpectationId, arExpIds));
      }
      await db.delete(arExpectations).where(inArray(arExpectations.financeImportRowId, rowIds));
      await db.delete(financeImportRows).where(inArray(financeImportRows.id, rowIds));
    }
    await db.delete(financeImportRowsRaw).where(eq(financeImportRowsRaw.financeImportId, id));
    await db.delete(financeImports).where(eq(financeImports.id, id));
  },

  // Finance Import Raw Rows
  async createFinanceImportRowsRaw(data: InsertFinanceImportRowRaw[]) {
    if (data.length === 0) return [];
    return db.insert(financeImportRowsRaw).values(data).returning();
  },

  async getFinanceImportRowsRaw(financeImportId: string) {
    return db.select()
      .from(financeImportRowsRaw)
      .where(eq(financeImportRowsRaw.financeImportId, financeImportId))
      .orderBy(asc(financeImportRowsRaw.rowIndex));
  },

  // Finance Import Rows (normalized)
  async createFinanceImportRows(data: InsertFinanceImportRow[]) {
    if (data.length === 0) return [];
    return db.insert(financeImportRows).values(data).returning();
  },

  async deleteFinanceImportRows(financeImportId: string) {
    return db.delete(financeImportRows).where(eq(financeImportRows.financeImportId, financeImportId));
  },

  async getFinanceImportRows(financeImportId: string, matchStatus?: string) {
    if (matchStatus) {
      return db.select()
        .from(financeImportRows)
        .where(and(
          eq(financeImportRows.financeImportId, financeImportId),
          eq(financeImportRows.matchStatus, matchStatus as any)
        ))
        .orderBy(asc(financeImportRows.id));
    }
    return db.select()
      .from(financeImportRows)
      .where(eq(financeImportRows.financeImportId, financeImportId))
      .orderBy(asc(financeImportRows.id));
  },

  async getFinanceImportRowById(id: string) {
    return db.query.financeImportRows.findFirst({
      where: eq(financeImportRows.id, id),
      with: { matchedOrder: true }
    });
  },

  async updateFinanceImportRow(id: string, data: Partial<FinanceImportRow>) {
    const [result] = await db.update(financeImportRows)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(financeImportRows.id, id))
      .returning();
    return result;
  },

  async getFinanceImportRowCounts(financeImportId: string) {
    const results = await db.select({
      matchStatus: financeImportRows.matchStatus,
      clientStatus: financeImportRows.clientStatus,
      count: sql<number>`COUNT(*)::int`
    })
      .from(financeImportRows)
      .where(eq(financeImportRows.financeImportId, financeImportId))
      .groupBy(financeImportRows.matchStatus, financeImportRows.clientStatus);
    return results;
  },

  // AR Expectations
  async createArExpectation(data: InsertArExpectation) {
    const [result] = await db.insert(arExpectations).values(data).returning();
    return result;
  },

  async getArExpectations(clientId?: string, status?: string, hasVariance?: boolean) {
    const conditions = [];
    if (clientId) conditions.push(eq(arExpectations.clientId, clientId));
    if (status) conditions.push(eq(arExpectations.status, status as any));
    if (hasVariance !== undefined) conditions.push(eq(arExpectations.hasVariance, hasVariance));
    
    return db.query.arExpectations.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(arExpectations.createdAt)],
      with: { client: true, order: { with: { provider: true, service: true } }, payments: true }
    });
  },

  async getArExpectationById(id: string) {
    return db.query.arExpectations.findFirst({
      where: eq(arExpectations.id, id),
      with: { client: true, order: { with: { provider: true, service: true } }, payments: { with: { recordedBy: true } } }
    });
  },

  async getArExpectationByRowId(financeImportRowId: string) {
    return db.query.arExpectations.findFirst({
      where: eq(arExpectations.financeImportRowId, financeImportRowId)
    });
  },

  async getArExpectationByOrderId(orderId: string) {
    return db.query.arExpectations.findFirst({
      where: eq(arExpectations.orderId, orderId)
    });
  },

  async updateArExpectation(id: string, data: Partial<ArExpectation>) {
    const [result] = await db.update(arExpectations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(arExpectations.id, id))
      .returning();
    return result;
  },

  async getArSummaryByClient() {
    return db.select({
      clientId: arExpectations.clientId,
      status: arExpectations.status,
      totalCents: sql<number>`SUM(expected_amount_cents)::int`,
      totalActualCents: sql<number>`SUM(actual_amount_cents)::int`,
      totalVarianceCents: sql<number>`SUM(variance_amount_cents)::int`,
      varianceCount: sql<number>`COUNT(*) FILTER (WHERE has_variance = true)::int`,
      count: sql<number>`COUNT(*)::int`
    })
      .from(arExpectations)
      .groupBy(arExpectations.clientId, arExpectations.status);
  },

  // AR Payments
  async createArPayment(data: InsertArPayment) {
    const [result] = await db.insert(arPayments).values(data).returning();
    return result;
  },

  async getArPaymentsByExpectationId(arExpectationId: string) {
    return db.query.arPayments.findMany({
      where: eq(arPayments.arExpectationId, arExpectationId),
      orderBy: [desc(arPayments.paymentDate)],
      with: { recordedBy: true }
    });
  },

  async deleteArPayment(id: string) {
    const [result] = await db.delete(arPayments).where(eq(arPayments.id, id)).returning();
    return result;
  },

  // Client Column Mappings
  async getClientColumnMappings(clientId: string) {
    return db.select()
      .from(clientColumnMappings)
      .where(eq(clientColumnMappings.clientId, clientId))
      .orderBy(desc(clientColumnMappings.createdAt));
  },

  async createClientColumnMapping(data: InsertClientColumnMapping) {
    const [result] = await db.insert(clientColumnMappings).values(data).returning();
    return result;
  },

  async updateClientColumnMapping(id: string, data: Partial<ClientColumnMapping>) {
    const [result] = await db.update(clientColumnMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientColumnMappings.id, id))
      .returning();
    return result;
  },

  async getDefaultClientColumnMapping(clientId: string) {
    return db.query.clientColumnMappings.findFirst({
      where: and(eq(clientColumnMappings.clientId, clientId), eq(clientColumnMappings.isDefault, true))
    });
  },

  // Finance Reports
  async getEnrolledReportByRep(startDate: string, endDate: string) {
    return db.select({
      repId: salesOrders.repId,
      enrolledCount: sql<number>`COUNT(*) FILTER (WHERE ${salesOrders.clientAcceptanceStatus} = 'ACCEPTED')::int`,
      rejectedCount: sql<number>`COUNT(*) FILTER (WHERE ${salesOrders.clientAcceptanceStatus} = 'REJECTED')::int`,
      totalExpectedCents: sql<number>`COALESCE(SUM(${salesOrders.expectedAmountCents}) FILTER (WHERE ${salesOrders.clientAcceptanceStatus} = 'ACCEPTED'), 0)::int`
    })
      .from(salesOrders)
      .where(and(
        gte(salesOrders.dateSold, startDate),
        lte(salesOrders.dateSold, endDate)
      ))
      .groupBy(salesOrders.repId);
  },

  async getEnrolledReportGlobal(startDate: string, endDate: string) {
    const [result] = await db.select({
      enrolledCount: sql<number>`COUNT(*) FILTER (WHERE ${salesOrders.clientAcceptanceStatus} = 'ACCEPTED')::int`,
      rejectedCount: sql<number>`COUNT(*) FILTER (WHERE ${salesOrders.clientAcceptanceStatus} = 'REJECTED')::int`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${salesOrders.clientAcceptanceStatus} IS NULL OR ${salesOrders.clientAcceptanceStatus} = 'PENDING')::int`,
      totalExpectedCents: sql<number>`COALESCE(SUM(${salesOrders.expectedAmountCents}) FILTER (WHERE ${salesOrders.clientAcceptanceStatus} = 'ACCEPTED'), 0)::int`
    })
      .from(salesOrders)
      .where(and(
        gte(salesOrders.dateSold, startDate),
        lte(salesOrders.dateSold, endDate)
      ));
    return result;
  },

  // Orders matching for finance - find potential matches for a finance row
  async findOrdersForMatching(clientId: string | null, saleDateStart: string, saleDateEnd: string, customerNameNorm?: string) {
    const conditions = [
      ne(salesOrders.approvalStatus, 'REJECTED'),
      gte(salesOrders.dateSold, saleDateStart),
      lte(salesOrders.dateSold, saleDateEnd),
    ];
    if (clientId) {
      conditions.push(eq(salesOrders.clientId, clientId));
    }
    return db.select({
      id: salesOrders.id,
      customerName: salesOrders.customerName,
      dateSold: salesOrders.dateSold,
      clientId: salesOrders.clientId,
      providerId: salesOrders.providerId,
      serviceId: salesOrders.serviceId,
      repId: salesOrders.repId,
      accountNumber: salesOrders.accountNumber,
      invoiceNumber: salesOrders.invoiceNumber,
      expectedAmountCents: salesOrders.expectedAmountCents,
      baseCommissionEarned: salesOrders.baseCommissionEarned,
      incentiveEarned: salesOrders.incentiveEarned,
      overrideDeduction: salesOrders.overrideDeduction,
      approvalStatus: salesOrders.approvalStatus,
      jobStatus: salesOrders.jobStatus,
      repName: users.name,
      houseNumber: salesOrders.houseNumber,
      streetName: salesOrders.streetName,
      aptUnit: salesOrders.aptUnit,
      city: salesOrders.city,
      zipCode: salesOrders.zipCode,
      serviceName: services.name,
    })
      .from(salesOrders)
      .leftJoin(users, eq(salesOrders.repId, users.repId))
      .leftJoin(services, eq(salesOrders.serviceId, services.id))
      .where(and(...conditions));
  },

  async setOrderClientAcceptance(orderId: string, status: "ACCEPTED" | "REJECTED" | "PENDING", expectedAmountCents?: number) {
    const [result] = await db.update(salesOrders)
      .set({
        clientAcceptanceStatus: status,
        clientAcceptedAt: status === "ACCEPTED" ? new Date() : null,
        expectedAmountCents: expectedAmountCents,
        updatedAt: new Date()
      })
      .where(eq(salesOrders.id, orderId))
      .returning();
    return result;
  },

  async createUserActivityLog(data: InsertUserActivityLog) {
    const [log] = await db.insert(userActivityLogs).values(data).returning();
    return log;
  },
  async getUserActivityLogs(limit = 500) {
    return db.query.userActivityLogs.findMany({
      orderBy: [desc(userActivityLogs.createdAt)],
      limit,
    });
  },
  async getUserActivityLogsByUser(userId: string, limit = 100) {
    return db.query.userActivityLogs.findMany({
      where: eq(userActivityLogs.userId, userId),
      orderBy: [desc(userActivityLogs.createdAt)],
      limit,
    });
  },
  async getRecentLogins(since: Date) {
    return db.query.userActivityLogs.findMany({
      where: and(
        eq(userActivityLogs.eventType, "LOGIN"),
        gte(userActivityLogs.createdAt, since),
      ),
      orderBy: [desc(userActivityLogs.createdAt)],
    });
  },
  async updateUserLastLogin(userId: string, ip: string, location: string | null) {
    await db.update(users)
      .set({ lastLoginAt: new Date(), lastLoginIp: ip, lastLoginLocation: location, lastActiveAt: new Date() })
      .where(eq(users.id, userId));
  },
  async updateUserLastActive(userId: string) {
    await db.update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.id, userId));
  },

  async createInstallSyncRun(data: Partial<InsertInstallSyncRun> & { runByUserId: string }) {
    const [run] = await db.insert(installSyncRuns).values(data as any).returning();
    return run;
  },
  async updateInstallSyncRun(id: string, data: Partial<InstallSyncRun>) {
    const [run] = await db.update(installSyncRuns).set(data).where(eq(installSyncRuns.id, id)).returning();
    return run;
  },
  async getInstallSyncRuns(limit = 50) {
    return db.select().from(installSyncRuns).orderBy(desc(installSyncRuns.createdAt)).limit(limit);
  },
  async getPendingUnapprovedOrders() {
    return db.select().from(salesOrders).where(
      and(
        eq(salesOrders.approvalStatus, "UNAPPROVED"),
        or(
          eq(salesOrders.jobStatus, "PENDING"),
          eq(salesOrders.jobStatus, "COMPLETED"),
        ),
      )
    );
  },
};
