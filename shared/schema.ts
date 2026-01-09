import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, decimal, timestamp, date, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "DEACTIVATED"]);
export const jobStatusEnum = pgEnum("job_status", ["PENDING", "COMPLETED", "CANCELED"]);
export const approvalStatusEnum = pgEnum("approval_status", ["UNAPPROVED", "APPROVED", "REJECTED"]);
export const paymentStatusEnum = pgEnum("payment_status", ["UNPAID", "PARTIALLY_PAID", "PAID"]);
export const commissionSourceEnum = pgEnum("commission_source", ["CALCULATED", "MANUAL_OVERRIDE"]);
export const commissionTypeEnum = pgEnum("commission_type", ["FLAT", "PER_LINE", "TIERED"]);
export const conditionEnum = pgEnum("condition_enum", ["YES", "NO", "ANY"]);
export const appliesToEnum = pgEnum("applies_to", ["REP", "TEAM", "GLOBAL", "PROVIDER", "CLIENT", "SERVICE"]);
export const incentiveTypeEnum = pgEnum("incentive_type", ["FLAT", "PERCENT", "PER_LINE"]);
export const overrideTypeEnum = pgEnum("override_type", ["PERCENT", "FLAT_PER_JOB", "PER_LINE", "TIERED"]);
export const chargebackReasonEnum = pgEnum("chargeback_reason", ["CANCELLATION", "NON_PAYMENT", "SERVICE_ISSUE", "DUPLICATE", "OTHER"]);
export const adjustmentTypeEnum = pgEnum("adjustment_type", ["BONUS", "CORRECTION", "PENALTY", "ADVANCE", "CLAWBACK", "OTHER"]);
export const payeeTypeEnum = pgEnum("payee_type", ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN"]);
export const payRunStatusEnum = pgEnum("payrun_status", ["DRAFT", "PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED", "FINALIZED"]);
export const rateIssueTypeEnum = pgEnum("rate_issue_type", ["MISSING_RATE", "CONFLICT_RATE"]);
export const sourceLevelEnum = pgEnum("source_level", ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN"]);
export const mobileProductTypeEnum = pgEnum("mobile_product_type", ["UNLIMITED", "3_GIG", "1_GIG", "BYOD", "OTHER"]);
export const mobilePortedStatusEnum = pgEnum("mobile_ported_status", ["PORTED", "NON_PORTED"]);
export const serviceCategoryEnum = pgEnum("service_category", ["INTERNET", "MOBILE", "VIDEO"]);

// Users table with expanded hierarchy
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  repId: text("rep_id").notNull().unique(),
  role: userRoleEnum("role").notNull().default("REP"),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  tempPasswordExpiresAt: timestamp("temp_password_expires_at"),
  passwordUpdatedAt: timestamp("password_updated_at"),
  assignedSupervisorId: varchar("assigned_supervisor_id"),
  assignedManagerId: varchar("assigned_manager_id"),
  assignedExecutiveId: varchar("assigned_executive_id"),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  supervisor: one(users, { fields: [users.assignedSupervisorId], references: [users.id], relationName: "supervisorTeam" }),
  manager: one(users, { fields: [users.assignedManagerId], references: [users.id], relationName: "managerTeam" }),
  executive: one(users, { fields: [users.assignedExecutiveId], references: [users.id], relationName: "executiveTeam" }),
  supervisedReps: many(users, { relationName: "supervisorTeam" }),
  managedUsers: many(users, { relationName: "managerTeam" }),
  executiveUsers: many(users, { relationName: "executiveTeam" }),
  salesOrders: many(salesOrders),
}));

// Providers table
export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Clients table
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Services table
export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  category: text("category"),
  unitType: text("unit_type"),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Rate Cards table - Simplified payout structure
export const rateCards = pgTable("rate_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull().references(() => providers.id),
  clientId: varchar("client_id").references(() => clients.id),
  serviceId: varchar("service_id").references(() => services.id),
  mobileProductType: mobileProductTypeEnum("mobile_product_type"),
  mobilePortedStatus: mobilePortedStatusEnum("mobile_ported_status"),
  baseAmount: decimal("base_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  tvAddonAmount: decimal("tv_addon_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  mobilePerLineAmount: decimal("mobile_per_line_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  overrideDeduction: decimal("override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  tvOverrideDeduction: decimal("tv_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  mobileOverrideDeduction: decimal("mobile_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rateCardsRelations = relations(rateCards, ({ one }) => ({
  provider: one(providers, { fields: [rateCards.providerId], references: [providers.id] }),
  client: one(clients, { fields: [rateCards.clientId], references: [clients.id] }),
  service: one(services, { fields: [rateCards.serviceId], references: [services.id] }),
}));

// Export Batches table
export const exportBatches = pgTable("export_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  recordCount: integer("record_count").notNull().default(0),
  fileName: text("file_name"),
  notes: text("notes"),
});

// Pay Runs table
export const payRuns = pgTable("pay_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"),
  weekEndingDate: date("week_ending_date").notNull(),
  status: payRunStatusEnum("status").notNull().default("DRAFT"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finalizedAt: timestamp("finalized_at"),
  deletedAt: timestamp("deleted_at"),
  // QuickBooks sync fields
  qbJournalEntryId: text("qb_journal_entry_id"),
  qbSyncStatus: text("qb_sync_status"), // PENDING, SYNCED, FAILED
  qbSyncedAt: timestamp("qb_synced_at"),
  qbSyncError: text("qb_sync_error"),
});

// Sales Orders table
export const salesOrders = pgTable("sales_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: text("rep_id").notNull(),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  providerId: varchar("provider_id").notNull().references(() => providers.id),
  serviceId: varchar("service_id").notNull().references(() => services.id),
  dateSold: date("date_sold").notNull(),
  installDate: date("install_date"),
  accountNumber: text("account_number"),
  tvSold: boolean("tv_sold").notNull().default(false),
  mobileSold: boolean("mobile_sold").notNull().default(false),
  mobileProductType: mobileProductTypeEnum("mobile_product_type"),
  mobilePortedStatus: mobilePortedStatusEnum("mobile_ported_status"),
  mobileLinesQty: integer("mobile_lines_qty").notNull().default(0),
  customerName: text("customer_name").notNull(),
  customerAddress: text("customer_address"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  jobStatus: jobStatusEnum("job_status").notNull().default("PENDING"),
  completionDate: date("completion_date"),
  approvalStatus: approvalStatusEnum("approval_status").notNull().default("UNAPPROVED"),
  rejectionNote: text("rejection_note"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  invoiceNumber: text("invoice_number").unique(),
  exportedToAccounting: boolean("exported_to_accounting").notNull().default(false),
  exportBatchId: varchar("export_batch_id").references(() => exportBatches.id),
  exportedAt: timestamp("exported_at"),
  baseCommissionEarned: decimal("base_commission_earned", { precision: 10, scale: 2 }).notNull().default("0"),
  incentiveEarned: decimal("incentive_earned", { precision: 10, scale: 2 }).notNull().default("0"),
  commissionSource: commissionSourceEnum("commission_source").notNull().default("CALCULATED"),
  appliedRateCardId: varchar("applied_rate_card_id").references(() => rateCards.id),
  calcAt: timestamp("calc_at"),
  commissionPaid: decimal("commission_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("UNPAID"),
  paidDate: date("paid_date"),
  quickbooksRefId: text("quickbooks_ref_id"),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  // QuickBooks sync fields for invoice sync
  qbInvoiceId: text("qb_invoice_id"),
  qbInvoiceSyncStatus: text("qb_invoice_sync_status"), // PENDING, SYNCED, FAILED, NOT_APPLICABLE
  qbInvoiceSyncedAt: timestamp("qb_invoice_synced_at"),
  qbInvoiceSyncError: text("qb_invoice_sync_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  client: one(clients, { fields: [salesOrders.clientId], references: [clients.id] }),
  provider: one(providers, { fields: [salesOrders.providerId], references: [providers.id] }),
  service: one(services, { fields: [salesOrders.serviceId], references: [services.id] }),
  approvedBy: one(users, { fields: [salesOrders.approvedByUserId], references: [users.id] }),
  exportBatch: one(exportBatches, { fields: [salesOrders.exportBatchId], references: [exportBatches.id] }),
  appliedRateCard: one(rateCards, { fields: [salesOrders.appliedRateCardId], references: [rateCards.id] }),
  payRun: one(payRuns, { fields: [salesOrders.payRunId], references: [payRuns.id] }),
  overrideEarnings: many(overrideEarnings),
}));

// Incentives table
export const incentives = pgTable("incentives", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  appliesTo: appliesToEnum("applies_to").notNull(),
  repId: text("rep_id"),
  managerId: varchar("manager_id").references(() => users.id),
  providerId: varchar("provider_id").references(() => providers.id),
  clientId: varchar("client_id").references(() => clients.id),
  serviceId: varchar("service_id").references(() => services.id),
  type: incentiveTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Override Agreements table - Simplified: recipient gets flat rate on sales from their hierarchy
// No need to specify source user - system uses role hierarchy (assigned supervisor/manager/executive)
export const overrideAgreements = pgTable("override_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id),
  amountFlat: decimal("amount_flat", { precision: 10, scale: 2 }).notNull(),
  providerId: varchar("provider_id").references(() => providers.id),
  clientId: varchar("client_id").references(() => clients.id),
  serviceId: varchar("service_id").references(() => services.id),
  mobileProductType: varchar("mobile_product_type"),
  mobilePortedFilter: varchar("mobile_ported_filter"),
  tvSoldFilter: boolean("tv_sold_filter"),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const overrideAgreementsRelations = relations(overrideAgreements, ({ one }) => ({
  recipient: one(users, { fields: [overrideAgreements.recipientUserId], references: [users.id], relationName: "recipient" }),
  provider: one(providers, { fields: [overrideAgreements.providerId], references: [providers.id] }),
  client: one(clients, { fields: [overrideAgreements.clientId], references: [clients.id] }),
  service: one(services, { fields: [overrideAgreements.serviceId], references: [services.id] }),
}));

// Override Earnings table - Computed overrides per approved order
export const overrideEarnings = pgTable("override_earnings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id),
  sourceRepId: text("source_rep_id").notNull(),
  sourceLevelUsed: sourceLevelEnum("source_level_used").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  overrideAgreementId: varchar("override_agreement_id").references(() => overrideAgreements.id),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const overrideEarningsRelations = relations(overrideEarnings, ({ one }) => ({
  salesOrder: one(salesOrders, { fields: [overrideEarnings.salesOrderId], references: [salesOrders.id] }),
  recipient: one(users, { fields: [overrideEarnings.recipientUserId], references: [users.id] }),
  overrideAgreement: one(overrideAgreements, { fields: [overrideEarnings.overrideAgreementId], references: [overrideAgreements.id] }),
  payRun: one(payRuns, { fields: [overrideEarnings.payRunId], references: [payRuns.id] }),
}));

// Commission Line Items - Separate earnings per service category (Internet, Mobile, Video)
export const commissionLineItems = pgTable("commission_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id),
  serviceCategory: serviceCategoryEnum("service_category").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmount: decimal("unit_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  mobileProductType: mobileProductTypeEnum("mobile_product_type"),
  mobilePortedStatus: mobilePortedStatusEnum("mobile_ported_status"),
  appliedRateCardId: varchar("applied_rate_card_id").references(() => rateCards.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const commissionLineItemsRelations = relations(commissionLineItems, ({ one }) => ({
  salesOrder: one(salesOrders, { fields: [commissionLineItems.salesOrderId], references: [salesOrders.id] }),
  appliedRateCard: one(rateCards, { fields: [commissionLineItems.appliedRateCardId], references: [rateCards.id] }),
}));

export const insertCommissionLineItemSchema = createInsertSchema(commissionLineItems).omit({
  id: true,
  createdAt: true,
});

// Mobile Line Items - Individual mobile lines per order with their own product type and ported status
export const mobileLineItems = pgTable("mobile_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id),
  lineNumber: integer("line_number").notNull().default(1),
  mobileProductType: mobileProductTypeEnum("mobile_product_type").notNull(),
  mobilePortedStatus: mobilePortedStatusEnum("mobile_ported_status").notNull(),
  appliedRateCardId: varchar("applied_rate_card_id").references(() => rateCards.id),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const mobileLineItemsRelations = relations(mobileLineItems, ({ one }) => ({
  salesOrder: one(salesOrders, { fields: [mobileLineItems.salesOrderId], references: [salesOrders.id] }),
  appliedRateCard: one(rateCards, { fields: [mobileLineItems.appliedRateCardId], references: [rateCards.id] }),
}));

export const insertMobileLineItemSchema = createInsertSchema(mobileLineItems).omit({
  id: true,
  createdAt: true,
});

export type InsertMobileLineItem = z.infer<typeof insertMobileLineItemSchema>;
export type MobileLineItem = typeof mobileLineItems.$inferSelect;

// Chargebacks table
export const chargebacks = pgTable("chargebacks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").notNull(),
  salesOrderId: varchar("sales_order_id").references(() => salesOrders.id),
  repId: text("rep_id").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: chargebackReasonEnum("reason").notNull(),
  chargebackDate: date("chargeback_date").notNull(),
  quickbooksRefId: text("quickbooks_ref_id"),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  notes: text("notes"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Adjustments table
export const adjustments = pgTable("adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payeeType: payeeTypeEnum("payee_type").notNull(),
  payeeUserId: varchar("payee_user_id").notNull().references(() => users.id),
  sourceRepId: text("source_rep_id"),
  invoiceNumber: text("invoice_number"),
  type: adjustmentTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  adjustmentDate: date("adjustment_date").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  approvalStatus: approvalStatusEnum("approval_status").notNull().default("UNAPPROVED"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Unmatched Payments table
export const unmatchedPayments = pgTable("unmatched_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  rawRowJson: text("raw_row_json").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
});

// Unmatched Chargebacks table
export const unmatchedChargebacks = pgTable("unmatched_chargebacks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  rawRowJson: text("raw_row_json").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
});

// Override Deduction Pool - Pending rate card deductions awaiting distribution during export
export const overrideDeductionPoolStatusEnum = pgEnum("override_deduction_pool_status", ["PENDING", "DISTRIBUTED"]);
export const overrideDeductionTypeEnum = pgEnum("override_deduction_type", ["MOBILE", "TV", "BASE"]);

export const overrideDeductionPool = pgTable("override_deduction_pool", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id),
  rateCardId: varchar("rate_card_id").notNull().references(() => rateCards.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  deductionType: overrideDeductionTypeEnum("deduction_type").notNull().default("MOBILE"),
  status: overrideDeductionPoolStatusEnum("status").notNull().default("PENDING"),
  exportBatchId: varchar("export_batch_id").references(() => exportBatches.id),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  distributedAt: timestamp("distributed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const overrideDeductionPoolRelations = relations(overrideDeductionPool, ({ one }) => ({
  salesOrder: one(salesOrders, { fields: [overrideDeductionPool.salesOrderId], references: [salesOrders.id] }),
  rateCard: one(rateCards, { fields: [overrideDeductionPool.rateCardId], references: [rateCards.id] }),
  exportBatch: one(exportBatches, { fields: [overrideDeductionPool.exportBatchId], references: [exportBatches.id] }),
  payRun: one(payRuns, { fields: [overrideDeductionPool.payRunId], references: [payRuns.id] }),
}));

export const insertOverrideDeductionPoolSchema = createInsertSchema(overrideDeductionPool).omit({
  id: true,
  createdAt: true,
  distributedAt: true,
});

export type OverrideDeductionPool = typeof overrideDeductionPool.$inferSelect;
export type InsertOverrideDeductionPool = z.infer<typeof insertOverrideDeductionPoolSchema>;

// Override Distributions - Manual allocation of pooled overrides to recipients
export const overrideDistributionAllocTypeEnum = pgEnum("override_distribution_alloc_type", ["PERCENT", "FIXED"]);
export const overrideDistributionStatusEnum = pgEnum("override_distribution_status", ["PENDING", "APPLIED"]);

export const overrideDistributions = pgTable("override_distributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").notNull().references(() => payRuns.id),
  poolEntryId: varchar("pool_entry_id").notNull().references(() => overrideDeductionPool.id),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id),
  allocationType: overrideDistributionAllocTypeEnum("allocation_type").notNull().default("FIXED"),
  allocationValue: decimal("allocation_value", { precision: 10, scale: 2 }).notNull(),
  calculatedAmount: decimal("calculated_amount", { precision: 10, scale: 2 }).notNull(),
  status: overrideDistributionStatusEnum("status").notNull().default("PENDING"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  appliedAt: timestamp("applied_at"),
});

export const overrideDistributionsRelations = relations(overrideDistributions, ({ one }) => ({
  payRun: one(payRuns, { fields: [overrideDistributions.payRunId], references: [payRuns.id] }),
  poolEntry: one(overrideDeductionPool, { fields: [overrideDistributions.poolEntryId], references: [overrideDeductionPool.id] }),
  recipient: one(users, { fields: [overrideDistributions.recipientUserId], references: [users.id] }),
  createdBy: one(users, { fields: [overrideDistributions.createdByUserId], references: [users.id] }),
}));

export const insertOverrideDistributionSchema = createInsertSchema(overrideDistributions).omit({
  id: true,
  createdAt: true,
  appliedAt: true,
});

export type OverrideDistribution = typeof overrideDistributions.$inferSelect;
export type InsertOverrideDistribution = z.infer<typeof insertOverrideDistributionSchema>;

// Rate Issues table
export const rateIssues = pgTable("rate_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id),
  type: rateIssueTypeEnum("type").notNull(),
  details: text("details").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
});

// Audit Log table
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(),
  tableName: text("table_name").notNull(),
  recordId: text("record_id"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Counter table for invoice sequencing
export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProviderSchema = createInsertSchema(providers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRateCardSchema = createInsertSchema(rateCards).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSalesOrderSchema = createInsertSchema(salesOrders).omit({ id: true, createdAt: true, updatedAt: true, invoiceNumber: true, approvedAt: true, approvedByUserId: true, exportedAt: true, exportBatchId: true, exportedToAccounting: true });
export const insertIncentiveSchema = createInsertSchema(incentives).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOverrideAgreementSchema = createInsertSchema(overrideAgreements).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOverrideEarningSchema = createInsertSchema(overrideEarnings).omit({ id: true, createdAt: true });
export const insertChargebackSchema = createInsertSchema(chargebacks).omit({ id: true, createdAt: true });
export const insertAdjustmentSchema = createInsertSchema(adjustments).omit({ id: true, createdAt: true, approvedAt: true, approvedByUserId: true });
export const insertPayRunSchema = createInsertSchema(payRuns).omit({ id: true, createdAt: true, finalizedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Provider = typeof providers.$inferSelect;
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Service = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type RateCard = typeof rateCards.$inferSelect;
export type InsertRateCard = z.infer<typeof insertRateCardSchema>;
export type SalesOrder = typeof salesOrders.$inferSelect;
export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;
export type Incentive = typeof incentives.$inferSelect;
export type InsertIncentive = z.infer<typeof insertIncentiveSchema>;
export type OverrideAgreement = typeof overrideAgreements.$inferSelect;
export type InsertOverrideAgreement = z.infer<typeof insertOverrideAgreementSchema>;
export type OverrideEarning = typeof overrideEarnings.$inferSelect;
export type InsertOverrideEarning = z.infer<typeof insertOverrideEarningSchema>;
export type Chargeback = typeof chargebacks.$inferSelect;
export type InsertChargeback = z.infer<typeof insertChargebackSchema>;
export type Adjustment = typeof adjustments.$inferSelect;
export type InsertAdjustment = z.infer<typeof insertAdjustmentSchema>;
export type PayRun = typeof payRuns.$inferSelect;
export type InsertPayRun = z.infer<typeof insertPayRunSchema>;
export type UnmatchedPayment = typeof unmatchedPayments.$inferSelect;
export type UnmatchedChargeback = typeof unmatchedChargebacks.$inferSelect;
export type RateIssue = typeof rateIssues.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type ExportBatch = typeof exportBatches.$inferSelect;
export type Counter = typeof counters.$inferSelect;
export type CommissionLineItem = typeof commissionLineItems.$inferSelect;
export type InsertCommissionLineItem = z.infer<typeof insertCommissionLineItemSchema>;

// Lead dispositions
export const leadDispositions = ["NONE", "SOLD", "NOT_HOME", "RETURN", "REJECT"] as const;
export type LeadDisposition = typeof leadDispositions[number];

// Leads table - for imported lead data
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: text("rep_id").notNull(),
  customerName: text("customer_name"),
  customerAddress: text("customer_address"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  houseNumber: text("house_number"),
  aptUnit: text("apt_unit"),
  streetName: text("street_name"),
  street: text("street"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  accountNumber: text("account_number"),
  customerStatus: text("customer_status"),
  discoReason: text("disco_reason"),
  notes: text("notes"),
  disposition: text("disposition").notNull().default("NONE"),
  dispositionAt: timestamp("disposition_at"),
  notHomeCount: integer("not_home_count").notNull().default(0),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  importedBy: varchar("imported_by").references(() => users.id),
  status: text("status").notNull().default("NEW"),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  importedAt: true,
  deletedAt: true,
  deletedByUserId: true,
});
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

// Knowledge Documents table - for reference files (PDFs, Word docs, images)
export const knowledgeDocumentTypeEnum = pgEnum("knowledge_document_type", ["PDF", "WORD", "IMAGE", "OTHER"]);

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  fileName: text("file_name").notNull(),
  fileType: knowledgeDocumentTypeEnum("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  objectPath: text("object_path").notNull(),
  category: text("category"),
  tags: text("tags").array(),
  uploadedById: varchar("uploaded_by_id").references(() => users.id).notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ one }) => ({
  uploadedBy: one(users, { fields: [knowledgeDocuments.uploadedById], references: [users.id] }),
  deletedBy: one(users, { fields: [knowledgeDocuments.deletedByUserId], references: [users.id] }),
}));

export const insertKnowledgeDocumentSchema = createInsertSchema(knowledgeDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedByUserId: true,
});
export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type InsertKnowledgeDocument = z.infer<typeof insertKnowledgeDocumentSchema>;

// ================== PAYROLL SYSTEM ==================

// Payroll-related enums
export const payRunApprovalStatusEnum = pgEnum("payrun_approval_status", ["PENDING", "APPROVED", "REJECTED"]);
export const deductionFrequencyEnum = pgEnum("deduction_frequency", ["ONE_TIME", "WEEKLY", "BI_WEEKLY", "MONTHLY"]);
export const deductionCalculationMethodEnum = pgEnum("deduction_calc_method", ["FLAT", "PERCENT"]);
export const advanceStatusEnum = pgEnum("advance_status", ["PENDING", "APPROVED", "REJECTED", "PAID", "REPAYING", "REPAID"]);
export const payStatementStatusEnum = pgEnum("pay_statement_status", ["DRAFT", "ISSUED", "PAID", "VOIDED"]);
export const paymentMethodTypeEnum = pgEnum("payment_method_type", ["DIRECT_DEPOSIT", "CHECK", "CASH", "VENMO", "ZELLE", "OTHER"]);

// Payroll Schedules - Define recurring pay periods
export const payrollSchedules = pgTable("payroll_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  periodStartDate: date("period_start_date").notNull(),
  periodEndDate: date("period_end_date").notNull(),
  payDate: date("pay_date").notNull(),
  reminderDaysBefore: integer("reminder_days_before").notNull().default(2),
  isRecurring: boolean("is_recurring").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPayrollScheduleSchema = createInsertSchema(payrollSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type PayrollSchedule = typeof payrollSchedules.$inferSelect;
export type InsertPayrollSchedule = z.infer<typeof insertPayrollScheduleSchema>;

// Pay Run Approvals - Multi-level approval workflow
export const payRunApprovals = pgTable("pay_run_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").notNull().references(() => payRuns.id),
  roleRequired: userRoleEnum("role_required").notNull(),
  approverId: varchar("approver_id").references(() => users.id),
  status: payRunApprovalStatusEnum("status").notNull().default("PENDING"),
  decidedAt: timestamp("decided_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payRunApprovalsRelations = relations(payRunApprovals, ({ one }) => ({
  payRun: one(payRuns, { fields: [payRunApprovals.payRunId], references: [payRuns.id] }),
  approver: one(users, { fields: [payRunApprovals.approverId], references: [users.id] }),
}));

export const insertPayRunApprovalSchema = createInsertSchema(payRunApprovals).omit({ id: true, createdAt: true, decidedAt: true });
export type PayRunApproval = typeof payRunApprovals.$inferSelect;
export type InsertPayRunApproval = z.infer<typeof insertPayRunApprovalSchema>;

// Deduction Types - Master list of deduction types
export const deductionTypes = pgTable("deduction_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isTaxable: boolean("is_taxable").notNull().default(false),
  isPreTax: boolean("is_pre_tax").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDeductionTypeSchema = createInsertSchema(deductionTypes).omit({ id: true, createdAt: true, updatedAt: true });
export type DeductionType = typeof deductionTypes.$inferSelect;
export type InsertDeductionType = z.infer<typeof insertDeductionTypeSchema>;

// User Deductions - Deductions assigned to specific users
export const userDeductions = pgTable("user_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  deductionTypeId: varchar("deduction_type_id").notNull().references(() => deductionTypes.id),
  calculationMethod: deductionCalculationMethodEnum("calculation_method").notNull().default("FLAT"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  frequency: deductionFrequencyEnum("frequency").notNull().default("WEEKLY"),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userDeductionsRelations = relations(userDeductions, ({ one }) => ({
  user: one(users, { fields: [userDeductions.userId], references: [users.id] }),
  deductionType: one(deductionTypes, { fields: [userDeductions.deductionTypeId], references: [deductionTypes.id] }),
}));

export const insertUserDeductionSchema = createInsertSchema(userDeductions).omit({ id: true, createdAt: true, updatedAt: true });
export type UserDeduction = typeof userDeductions.$inferSelect;
export type InsertUserDeduction = z.infer<typeof insertUserDeductionSchema>;

// Advances - Draws against future commissions
export const advances = pgTable("advances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  requestedAmount: decimal("requested_amount", { precision: 10, scale: 2 }).notNull(),
  approvedAmount: decimal("approved_amount", { precision: 10, scale: 2 }),
  paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  remainingBalance: decimal("remaining_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  status: advanceStatusEnum("status").notNull().default("PENDING"),
  repaymentPercentage: decimal("repayment_percentage", { precision: 5, scale: 2 }).notNull().default("100"),
  reason: text("reason"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const advancesRelations = relations(advances, ({ one }) => ({
  user: one(users, { fields: [advances.userId], references: [users.id] }),
  approvedBy: one(users, { fields: [advances.approvedById], references: [users.id] }),
}));

export const insertAdvanceSchema = createInsertSchema(advances).omit({ id: true, createdAt: true, updatedAt: true, approvedAt: true, paidAt: true, requestedAt: true });
export type Advance = typeof advances.$inferSelect;
export type InsertAdvance = z.infer<typeof insertAdvanceSchema>;

// Advance Repayments - Track how advances are repaid from pay statements
export const advanceRepayments = pgTable("advance_repayments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  advanceId: varchar("advance_id").notNull().references(() => advances.id),
  payStatementId: varchar("pay_statement_id").notNull(),
  amountApplied: decimal("amount_applied", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const advanceRepaymentsRelations = relations(advanceRepayments, ({ one }) => ({
  advance: one(advances, { fields: [advanceRepayments.advanceId], references: [advances.id] }),
}));

export type AdvanceRepayment = typeof advanceRepayments.$inferSelect;

// User Tax Profiles - For 1099 preparation
export const userTaxProfiles = pgTable("user_tax_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  isContractor: boolean("is_contractor").notNull().default(true),
  w9OnFile: boolean("w9_on_file").notNull().default(false),
  w9ReceivedDate: date("w9_received_date"),
  taxIdLastFour: text("tax_id_last_four"),
  businessName: text("business_name"),
  businessAddress: text("business_address"),
  withholdingRate: decimal("withholding_rate", { precision: 5, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userTaxProfilesRelations = relations(userTaxProfiles, ({ one }) => ({
  user: one(users, { fields: [userTaxProfiles.userId], references: [users.id] }),
}));

export const insertUserTaxProfileSchema = createInsertSchema(userTaxProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type UserTaxProfile = typeof userTaxProfiles.$inferSelect;
export type InsertUserTaxProfile = z.infer<typeof insertUserTaxProfileSchema>;

// User Payment Methods - How reps receive payment
export const userPaymentMethods = pgTable("user_payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  methodType: paymentMethodTypeEnum("method_type").notNull(),
  accountNickname: text("account_nickname"),
  accountLastFour: text("account_last_four"),
  routingLastFour: text("routing_last_four"),
  isDefault: boolean("is_default").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userPaymentMethodsRelations = relations(userPaymentMethods, ({ one }) => ({
  user: one(users, { fields: [userPaymentMethods.userId], references: [users.id] }),
}));

export const insertUserPaymentMethodSchema = createInsertSchema(userPaymentMethods).omit({ id: true, createdAt: true, updatedAt: true, verifiedAt: true });
export type UserPaymentMethod = typeof userPaymentMethods.$inferSelect;
export type InsertUserPaymentMethod = z.infer<typeof insertUserPaymentMethodSchema>;

// Pay Statements - Individual pay stubs for each rep per pay run
export const payStatements = pgTable("pay_statements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").notNull().references(() => payRuns.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  grossCommission: decimal("gross_commission", { precision: 10, scale: 2 }).notNull().default("0"),
  overrideEarningsTotal: decimal("override_earnings_total", { precision: 10, scale: 2 }).notNull().default("0"),
  incentivesTotal: decimal("incentives_total", { precision: 10, scale: 2 }).notNull().default("0"),
  chargebacksTotal: decimal("chargebacks_total", { precision: 10, scale: 2 }).notNull().default("0"),
  adjustmentsTotal: decimal("adjustments_total", { precision: 10, scale: 2 }).notNull().default("0"),
  deductionsTotal: decimal("deductions_total", { precision: 10, scale: 2 }).notNull().default("0"),
  advancesApplied: decimal("advances_applied", { precision: 10, scale: 2 }).notNull().default("0"),
  taxWithheld: decimal("tax_withheld", { precision: 10, scale: 2 }).notNull().default("0"),
  netPay: decimal("net_pay", { precision: 10, scale: 2 }).notNull().default("0"),
  status: payStatementStatusEnum("status").notNull().default("DRAFT"),
  issuedAt: timestamp("issued_at"),
  paidAt: timestamp("paid_at"),
  paymentMethodId: varchar("payment_method_id").references(() => userPaymentMethods.id),
  paymentReference: text("payment_reference"),
  ytdGross: decimal("ytd_gross", { precision: 12, scale: 2 }).notNull().default("0"),
  ytdDeductions: decimal("ytd_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  ytdNetPay: decimal("ytd_net_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const payStatementsRelations = relations(payStatements, ({ one }) => ({
  payRun: one(payRuns, { fields: [payStatements.payRunId], references: [payRuns.id] }),
  user: one(users, { fields: [payStatements.userId], references: [users.id] }),
  paymentMethod: one(userPaymentMethods, { fields: [payStatements.paymentMethodId], references: [userPaymentMethods.id] }),
}));

export const insertPayStatementSchema = createInsertSchema(payStatements).omit({ id: true, createdAt: true, updatedAt: true, issuedAt: true, paidAt: true });
export type PayStatement = typeof payStatements.$inferSelect;
export type InsertPayStatement = z.infer<typeof insertPayStatementSchema>;

// Pay Statement Line Items - Detailed breakdown of earnings
export const payStatementLineItems = pgTable("pay_statement_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payStatementId: varchar("pay_statement_id").notNull().references(() => payStatements.id),
  category: text("category").notNull(),
  description: text("description").notNull(),
  sourceType: text("source_type"),
  sourceId: varchar("source_id"),
  quantity: integer("quantity").notNull().default(1),
  rate: decimal("rate", { precision: 10, scale: 2 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payStatementLineItemsRelations = relations(payStatementLineItems, ({ one }) => ({
  payStatement: one(payStatements, { fields: [payStatementLineItems.payStatementId], references: [payStatements.id] }),
}));

export type PayStatementLineItem = typeof payStatementLineItems.$inferSelect;

// Pay Statement Deductions - Applied deductions for each statement
export const payStatementDeductions = pgTable("pay_statement_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payStatementId: varchar("pay_statement_id").notNull().references(() => payStatements.id),
  userDeductionId: varchar("user_deduction_id").references(() => userDeductions.id),
  deductionTypeName: text("deduction_type_name").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payStatementDeductionsRelations = relations(payStatementDeductions, ({ one }) => ({
  payStatement: one(payStatements, { fields: [payStatementDeductions.payStatementId], references: [payStatements.id] }),
  userDeduction: one(userDeductions, { fields: [payStatementDeductions.userDeductionId], references: [userDeductions.id] }),
}));

export type PayStatementDeduction = typeof payStatementDeductions.$inferSelect;

// QuickBooks Integration Enums
export const qbSyncStatusEnum = pgEnum("qb_sync_status", ["PENDING", "SYNCED", "FAILED", "SKIPPED"]);
export const qbEntityTypeEnum = pgEnum("qb_entity_type", ["INVOICE", "JOURNAL_ENTRY", "PAYMENT", "VENDOR_BILL"]);

// QuickBooks Connection - OAuth token storage (encrypted)
export const quickbooksConnection = pgTable("quickbooks_connection", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  realmId: text("realm_id").notNull(),
  companyName: text("company_name"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  isConnected: boolean("is_connected").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at"),
  connectedByUserId: varchar("connected_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type QuickBooksConnection = typeof quickbooksConnection.$inferSelect;

// QuickBooks Account Mappings - Configure which QB accounts to use
export const quickbooksAccountMappings = pgTable("quickbooks_account_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mappingType: text("mapping_type").notNull(), // 'COMMISSION_EXPENSE', 'ACCOUNTS_PAYABLE', 'CASH', 'INCOME'
  qbAccountId: text("qb_account_id").notNull(),
  qbAccountName: text("qb_account_name").notNull(),
  qbAccountType: text("qb_account_type"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertQBAccountMappingSchema = createInsertSchema(quickbooksAccountMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type QuickBooksAccountMapping = typeof quickbooksAccountMappings.$inferSelect;
export type InsertQuickBooksAccountMapping = z.infer<typeof insertQBAccountMappingSchema>;

// QuickBooks Sync Log - Audit trail for all QB operations
export const quickbooksSyncLog = pgTable("quickbooks_sync_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: qbEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  qbEntityId: text("qb_entity_id"),
  qbDocNumber: text("qb_doc_number"),
  action: text("action").notNull(), // 'CREATE', 'UPDATE', 'DELETE'
  status: qbSyncStatusEnum("status").notNull().default("PENDING"),
  requestPayload: text("request_payload"),
  responsePayload: text("response_payload"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  syncedAt: timestamp("synced_at"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type QuickBooksSyncLog = typeof quickbooksSyncLog.$inferSelect;

// ========== NEW PAYROLL FEATURES (January 2026) ==========

// Enums for new payroll features
export const taxDocumentTypeEnum = pgEnum("tax_document_type", ["1099_NEC", "1099_MISC", "W2"]);
export const taxDocumentStatusEnum = pgEnum("tax_document_status", ["DRAFT", "GENERATED", "SENT", "CORRECTED"]);
export const achStatusEnum = pgEnum("ach_status", ["PENDING", "EXPORTED", "SENT", "COMPLETED", "FAILED"]);
export const paymentMethodEnum = pgEnum("payment_method", ["ACH", "CHECK", "WIRE", "CASH", "OTHER"]);
export const reconciliationStatusEnum = pgEnum("reconciliation_status", ["PENDING", "MATCHED", "UNMATCHED", "DISPUTED"]);
export const bonusTypeEnum = pgEnum("bonus_type", ["SPIFF", "BONUS", "CONTEST", "REFERRAL", "OTHER"]);
export const bonusStatusEnum = pgEnum("bonus_status", ["PENDING", "APPROVED", "PAID", "CANCELLED"]);
export const drawTypeEnum = pgEnum("draw_type", ["RECOVERABLE", "NON_RECOVERABLE"]);
export const drawStatusEnum = pgEnum("draw_status", ["ACTIVE", "RECOVERING", "SETTLED", "FORGIVEN"]);
export const splitTypeEnum = pgEnum("split_type", ["PERCENTAGE", "FIXED"]);
export const tierBasisEnum = pgEnum("tier_basis", ["MONTHLY_VOLUME", "QUARTERLY_VOLUME", "YEARLY_VOLUME", "ORDER_VALUE"]);

// Tax Documents (1099s, W2s)
export const taxDocuments = pgTable("tax_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  taxYear: integer("tax_year").notNull(),
  documentType: taxDocumentTypeEnum("document_type").notNull(),
  status: taxDocumentStatusEnum("status").notNull().default("DRAFT"),
  totalEarnings: decimal("total_earnings", { precision: 12, scale: 2 }).notNull().default("0"),
  totalWithholdings: decimal("total_withholdings", { precision: 12, scale: 2 }).notNull().default("0"),
  federalTaxWithheld: decimal("federal_tax_withheld", { precision: 12, scale: 2 }).notNull().default("0"),
  stateTaxWithheld: decimal("state_tax_withheld", { precision: 12, scale: 2 }).notNull().default("0"),
  recipientTin: text("recipient_tin"), // Last 4 only for display, full stored encrypted
  recipientName: text("recipient_name").notNull(),
  recipientAddress: text("recipient_address"),
  recipientCity: text("recipient_city"),
  recipientState: text("recipient_state"),
  recipientZip: text("recipient_zip"),
  generatedAt: timestamp("generated_at"),
  sentAt: timestamp("sent_at"),
  sentMethod: text("sent_method"), // EMAIL, MAIL, PORTAL
  correctionOf: varchar("correction_of").references((): any => taxDocuments.id),
  pdfPath: text("pdf_path"), // Object storage path
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTaxDocumentSchema = createInsertSchema(taxDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type TaxDocument = typeof taxDocuments.$inferSelect;
export type InsertTaxDocument = z.infer<typeof insertTaxDocumentSchema>;

// ACH/Direct Deposit Bank Details
export const userBankAccounts = pgTable("user_bank_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  accountHolderName: text("account_holder_name").notNull(),
  bankName: text("bank_name").notNull(),
  routingNumber: text("routing_number").notNull(), // Should be encrypted
  accountNumberLast4: text("account_number_last_4").notNull(),
  accountNumberEncrypted: text("account_number_encrypted").notNull(), // Encrypted full number
  accountType: text("account_type").notNull(), // CHECKING, SAVINGS
  isPrimary: boolean("is_primary").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserBankAccountSchema = createInsertSchema(userBankAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type UserBankAccount = typeof userBankAccounts.$inferSelect;
export type InsertUserBankAccount = z.infer<typeof insertUserBankAccountSchema>;

// ACH Export Batches
export const achExports = pgTable("ach_exports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  batchNumber: text("batch_number").notNull().unique(),
  status: achStatusEnum("status").notNull().default("PENDING"),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  transactionCount: integer("transaction_count").notNull(),
  effectiveDate: date("effective_date").notNull(),
  filePath: text("file_path"), // NACHA file path in object storage
  sentAt: timestamp("sent_at"),
  completedAt: timestamp("completed_at"),
  failureReason: text("failure_reason"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAchExportSchema = createInsertSchema(achExports).omit({ id: true, createdAt: true });
export type AchExport = typeof achExports.$inferSelect;
export type InsertAchExport = z.infer<typeof insertAchExportSchema>;

// ACH Export Line Items
export const achExportItems = pgTable("ach_export_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  achExportId: varchar("ach_export_id").notNull().references(() => achExports.id),
  payStatementId: varchar("pay_statement_id").references(() => payStatements.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  bankAccountId: varchar("bank_account_id").references(() => userBankAccounts.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: achStatusEnum("status").notNull().default("PENDING"),
  traceNumber: text("trace_number"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AchExportItem = typeof achExportItems.$inferSelect;

// Payment Reconciliation
export const paymentReconciliations = pgTable("payment_reconciliations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payStatementId: varchar("pay_statement_id").references(() => payStatements.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  expectedAmount: decimal("expected_amount", { precision: 12, scale: 2 }).notNull(),
  paidAmount: decimal("paid_amount", { precision: 12, scale: 2 }),
  status: reconciliationStatusEnum("status").notNull().default("PENDING"),
  paymentDate: date("payment_date"),
  paymentReference: text("payment_reference"), // Check number, ACH trace, etc.
  bankReference: text("bank_reference"),
  matchedAt: timestamp("matched_at"),
  disputeReason: text("dispute_reason"),
  notes: text("notes"),
  reconciledByUserId: varchar("reconciled_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPaymentReconciliationSchema = createInsertSchema(paymentReconciliations).omit({ id: true, createdAt: true, updatedAt: true });
export type PaymentReconciliation = typeof paymentReconciliations.$inferSelect;
export type InsertPaymentReconciliation = z.infer<typeof insertPaymentReconciliationSchema>;

// Bonuses/SPIFFs
export const bonuses = pgTable("bonuses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  bonusType: bonusTypeEnum("bonus_type").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  status: bonusStatusEnum("status").notNull().default("PENDING"),
  effectiveDate: date("effective_date").notNull(),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  salesOrderId: varchar("sales_order_id").references(() => salesOrders.id), // Link to triggering order if applicable
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBonusSchema = createInsertSchema(bonuses).omit({ id: true, createdAt: true, updatedAt: true });
export type Bonus = typeof bonuses.$inferSelect;
export type InsertBonus = z.infer<typeof insertBonusSchema>;

// Draw Against Commission
export const drawAccounts = pgTable("draw_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  drawType: drawTypeEnum("draw_type").notNull(),
  monthlyGuarantee: decimal("monthly_guarantee", { precision: 12, scale: 2 }).notNull(),
  currentBalance: decimal("current_balance", { precision: 12, scale: 2 }).notNull().default("0"), // Amount owed back
  recoveryPercentage: decimal("recovery_percentage", { precision: 5, scale: 2 }).notNull().default("100"), // % of excess to apply to balance
  maxRecoveryPerPeriod: decimal("max_recovery_per_period", { precision: 12, scale: 2 }), // Cap on recovery per pay period
  status: drawStatusEnum("status").notNull().default("ACTIVE"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  settledAt: timestamp("settled_at"),
  forgivenAt: timestamp("forgiven_at"),
  forgivenByUserId: varchar("forgiven_by_user_id").references(() => users.id),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDrawAccountSchema = createInsertSchema(drawAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export type DrawAccount = typeof drawAccounts.$inferSelect;
export type InsertDrawAccount = z.infer<typeof insertDrawAccountSchema>;

// Draw Transactions
export const drawTransactions = pgTable("draw_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  drawAccountId: varchar("draw_account_id").notNull().references(() => drawAccounts.id),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  commissionEarned: decimal("commission_earned", { precision: 12, scale: 2 }).notNull(),
  guaranteeAmount: decimal("guarantee_amount", { precision: 12, scale: 2 }).notNull(),
  drawPaid: decimal("draw_paid", { precision: 12, scale: 2 }).notNull().default("0"), // Shortfall covered
  recoveryApplied: decimal("recovery_applied", { precision: 12, scale: 2 }).notNull().default("0"), // Excess applied to balance
  netPayout: decimal("net_payout", { precision: 12, scale: 2 }).notNull(),
  balanceAfter: decimal("balance_after", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DrawTransaction = typeof drawTransactions.$inferSelect;

// Split Commission Agreements
export const splitCommissionAgreements = pgTable("split_commission_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  primaryRepId: varchar("primary_rep_id").notNull().references(() => users.id),
  isActive: boolean("is_active").notNull().default(true),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSplitAgreementSchema = createInsertSchema(splitCommissionAgreements).omit({ id: true, createdAt: true, updatedAt: true });
export type SplitCommissionAgreement = typeof splitCommissionAgreements.$inferSelect;
export type InsertSplitCommissionAgreement = z.infer<typeof insertSplitAgreementSchema>;

// Split Commission Recipients
export const splitCommissionRecipients = pgTable("split_commission_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agreementId: varchar("agreement_id").notNull().references(() => splitCommissionAgreements.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  splitType: splitTypeEnum("split_type").notNull(),
  splitValue: decimal("split_value", { precision: 10, scale: 4 }).notNull(), // Percentage or fixed amount
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SplitCommissionRecipient = typeof splitCommissionRecipients.$inferSelect;

// Split Commission Ledger (actual splits from orders)
export const splitCommissionLedger = pgTable("split_commission_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id),
  agreementId: varchar("agreement_id").notNull().references(() => splitCommissionAgreements.id),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id),
  originalAmount: decimal("original_amount", { precision: 12, scale: 2 }).notNull(),
  splitAmount: decimal("split_amount", { precision: 12, scale: 2 }).notNull(),
  payRunId: varchar("pay_run_id").references(() => payRuns.id),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SplitCommissionLedgerEntry = typeof splitCommissionLedger.$inferSelect;

// Commission Tiers
export const commissionTiers = pgTable("commission_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  tierBasis: tierBasisEnum("tier_basis").notNull(),
  providerId: varchar("provider_id").references(() => providers.id), // Optional: tier for specific provider
  clientId: varchar("client_id").references(() => clients.id), // Optional: tier for specific client
  isActive: boolean("is_active").notNull().default(true),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCommissionTierSchema = createInsertSchema(commissionTiers).omit({ id: true, createdAt: true, updatedAt: true });
export type CommissionTier = typeof commissionTiers.$inferSelect;
export type InsertCommissionTier = z.infer<typeof insertCommissionTierSchema>;

// Commission Tier Levels
export const commissionTierLevels = pgTable("commission_tier_levels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tierId: varchar("tier_id").notNull().references(() => commissionTiers.id),
  minVolume: decimal("min_volume", { precision: 12, scale: 2 }).notNull(),
  maxVolume: decimal("max_volume", { precision: 12, scale: 2 }), // Null = unlimited
  bonusPercentage: decimal("bonus_percentage", { precision: 5, scale: 2 }), // Additional % on top of base
  bonusFlat: decimal("bonus_flat", { precision: 12, scale: 2 }), // Or flat bonus
  multiplier: decimal("multiplier", { precision: 5, scale: 4 }), // Or multiplier on base
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CommissionTierLevel = typeof commissionTierLevels.$inferSelect;

// Rep Tier Assignments (assign reps to specific tiers)
export const repTierAssignments = pgTable("rep_tier_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  tierId: varchar("tier_id").notNull().references(() => commissionTiers.id),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RepTierAssignment = typeof repTierAssignments.$inferSelect;

// Volume Tracking (for tier calculations)
export const repVolumeTracking = pgTable("rep_volume_tracking", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  periodType: text("period_type").notNull(), // MONTHLY, QUARTERLY, YEARLY
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  orderCount: integer("order_count").notNull().default(0),
  totalVolume: decimal("total_volume", { precision: 14, scale: 2 }).notNull().default("0"),
  totalCommission: decimal("total_commission", { precision: 14, scale: 2 }).notNull().default("0"),
  tierBonusEarned: decimal("tier_bonus_earned", { precision: 12, scale: 2 }).notNull().default("0"),
  currentTierId: varchar("current_tier_id").references(() => commissionTierLevels.id),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RepVolumeTracking = typeof repVolumeTracking.$inferSelect;

// Scheduled Pay Runs
export const scheduledPayRuns = pgTable("scheduled_pay_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  frequency: text("frequency").notNull(), // WEEKLY, BIWEEKLY, SEMIMONTHLY, MONTHLY
  dayOfWeek: integer("day_of_week"), // 0-6 for weekly
  dayOfMonth: integer("day_of_month"), // 1-31 for monthly
  secondDayOfMonth: integer("second_day_of_month"), // For semi-monthly
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  autoCreatePayRun: boolean("auto_create_pay_run").notNull().default(true),
  autoLinkOrders: boolean("auto_link_orders").notNull().default(true),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScheduledPayRunSchema = createInsertSchema(scheduledPayRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type ScheduledPayRun = typeof scheduledPayRuns.$inferSelect;
export type InsertScheduledPayRun = z.infer<typeof insertScheduledPayRunSchema>;

// Commission Forecasts
export const commissionForecasts = pgTable("commission_forecasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id), // Null = company-wide
  forecastPeriod: text("forecast_period").notNull(), // WEEK, MONTH, QUARTER
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  pendingOrders: integer("pending_orders").notNull().default(0),
  pendingCommission: decimal("pending_commission", { precision: 14, scale: 2 }).notNull().default("0"),
  projectedOrders: integer("projected_orders").notNull().default(0), // Based on trends
  projectedCommission: decimal("projected_commission", { precision: 14, scale: 2 }).notNull().default("0"),
  historicalAverage: decimal("historical_average", { precision: 14, scale: 2 }).notNull().default("0"),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }), // 0-100
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CommissionForecast = typeof commissionForecasts.$inferSelect;

// Login schema
export const loginSchema = z.object({
  repId: z.string().min(1, "Rep ID is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;
