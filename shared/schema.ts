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
export const payRunStatusEnum = pgEnum("payrun_status", ["DRAFT", "FINALIZED"]);
export const rateIssueTypeEnum = pgEnum("rate_issue_type", ["MISSING_RATE", "CONFLICT_RATE"]);
export const sourceLevelEnum = pgEnum("source_level", ["REP", "SUPERVISOR", "MANAGER"]);
export const mobileProductTypeEnum = pgEnum("mobile_product_type", ["UNLIMITED", "3_GIG", "1_GIG", "BYOD", "OTHER"]);
export const mobilePortedStatusEnum = pgEnum("mobile_ported_status", ["PORTED", "NON_PORTED"]);

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
  weekEndingDate: date("week_ending_date").notNull().unique(),
  status: payRunStatusEnum("status").notNull().default("DRAFT"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finalizedAt: timestamp("finalized_at"),
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

// Override Agreements table - Flat rate overrides for hierarchy
export const overrideAgreements = pgTable("override_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceUserId: varchar("source_user_id").references(() => users.id),
  recipientUserId: varchar("recipient_user_id").notNull().references(() => users.id),
  sourceLevel: sourceLevelEnum("source_level").notNull(),
  amountFlat: decimal("amount_flat", { precision: 10, scale: 2 }).notNull(),
  providerId: varchar("provider_id").references(() => providers.id),
  clientId: varchar("client_id").references(() => clients.id),
  serviceId: varchar("service_id").references(() => services.id),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const overrideAgreementsRelations = relations(overrideAgreements, ({ one }) => ({
  sourceUser: one(users, { fields: [overrideAgreements.sourceUserId], references: [users.id], relationName: "sourceUser" }),
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

// Leads table - for imported lead data
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: text("rep_id").notNull(),
  customerName: text("customer_name"),
  customerAddress: text("customer_address"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  houseNumber: text("house_number"),
  streetName: text("street_name"),
  street: text("street"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  notes: text("notes"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  importedBy: varchar("imported_by").references(() => users.id),
  status: text("status").notNull().default("NEW"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  importedAt: true,
});
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

// Login schema
export const loginSchema = z.object({
  repId: z.string().min(1, "Rep ID is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;
