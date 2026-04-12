import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, decimal, timestamp, date, pgEnum, uniqueIndex, unique, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["REP", "MDU", "LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE", "ADMIN", "OPERATIONS", "ACCOUNTING"]);
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
export const payeeTypeEnum = pgEnum("payee_type", ["REP", "LEAD", "MANAGER", "EXECUTIVE", "ADMIN"]);
export const payRunStatusEnum = pgEnum("payrun_status", ["DRAFT", "PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED", "FINALIZED"]);
export const rateIssueTypeEnum = pgEnum("rate_issue_type", ["MISSING_RATE", "CONFLICT_RATE", "MISSING_ACCOUNTING_RECIPIENT"]);
export const sourceLevelEnum = pgEnum("source_level", ["REP", "LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "ACCOUNTING", "DIRECTOR", "OPERATIONS"]);
export const mobileProductTypeEnum = pgEnum("mobile_product_type", ["UNLIMITED", "3_GIG", "1_GIG", "BYOD", "OTHER"]);
export const mobilePortedStatusEnum = pgEnum("mobile_ported_status", ["PORTED", "NON_PORTED"]);
export const serviceCategoryEnum = pgEnum("service_category", ["INTERNET", "MOBILE", "VIDEO"]);
export const installTypeEnum = pgEnum("install_type", ["AGENT_INSTALL", "DIRECT_SHIP", "TECH_INSTALL"]);
export const mduOrderStatusEnum = pgEnum("mdu_order_status", ["PENDING", "APPROVED", "REJECTED"]);
export const captureMethodEnum = pgEnum("capture_method", ["manual", "screenshot_capture"]);


// Finance module enums
export const financeImportStatusEnum = pgEnum("finance_import_status", ["IMPORTED", "MAPPED", "MATCHED", "POSTED", "LOCKED"]);
export const financeImportSourceTypeEnum = pgEnum("finance_import_source_type", ["CSV", "XLSX"]);
export const financeMatchStatusEnum = pgEnum("finance_match_status", ["UNMATCHED", "MATCHED", "AMBIGUOUS", "IGNORED"]);
export const arExpectationStatusEnum = pgEnum("ar_expectation_status", ["OPEN", "PARTIAL", "SATISFIED", "WRITTEN_OFF", "VOID"]);
export const clientAcceptanceStatusEnum = pgEnum("client_acceptance_status", ["ACCEPTED", "REJECTED", "PENDING"]);
export const financePeriodTypeEnum = pgEnum("finance_period_type", ["WEEK", "MONTH"]);
export const financePeriodStatusEnum = pgEnum("finance_period_status", ["DRAFT", "CLOSED"]);

// Users table with expanded hierarchy
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  repId: text("rep_id").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("REP"),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  tempPasswordExpiresAt: timestamp("temp_password_expires_at"),
  passwordUpdatedAt: timestamp("password_updated_at"),
  assignedSupervisorId: varchar("assigned_supervisor_id"),
  assignedManagerId: varchar("assigned_manager_id"),
  assignedExecutiveId: varchar("assigned_executive_id"),
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: text("last_login_ip"),
  lastLoginLocation: text("last_login_location"),
  lastActiveAt: timestamp("last_active_at"),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  dateOfBirth: text("date_of_birth"),
  onboardingStatus: varchar("onboarding_status", { length: 30 }).notNull().default("NOT_STARTED"),
  onboardingStartedAt: timestamp("onboarding_started_at"),
  onboardingSubmittedAt: timestamp("onboarding_submitted_at"),
  onboardingApprovedAt: timestamp("onboarding_approved_at"),
  onboardingApprovedByUserId: varchar("onboarding_approved_by_user_id"),
  onboardingRejectedAt: timestamp("onboarding_rejected_at"),
  onboardingRejectionReason: text("onboarding_rejection_reason"),
  backgroundCheckStatus: varchar("background_check_status", { length: 20 }).notNull().default("PENDING"),
  drugTestStatus: varchar("drug_test_status", { length: 20 }).notNull().default("PENDING"),
  ndaSignedAt: timestamp("nda_signed_at"),
  contractorAgreementSignedAt: timestamp("contractor_agreement_signed_at"),
  appAccessGrantedAt: timestamp("app_access_granted_at"),
  appAccessGrantedByUserId: varchar("app_access_granted_by_user_id"),
  onboardingOtpHash: varchar("onboarding_otp_hash"),
  onboardingOtpExpiresAt: timestamp("onboarding_otp_expires_at"),
  onboardingOtpAttempts: integer("onboarding_otp_attempts").notNull().default(0),
  onboardingOtpLockedAt: timestamp("onboarding_otp_locked_at"),
  hasActiveReserve: boolean("has_active_reserve").notNull().default(false),
  reserveStatus: varchar("reserve_status", { length: 20 }),
  compPlanType: varchar("comp_plan_type", { length: 20 }).notNull().default("STANDARD"),
  ownerPoolGroup: varchar("owner_pool_group", { length: 50 }),
  ipadIssued: boolean("ipad_issued").notNull().default(false),
  ipadSerialNumber: varchar("ipad_serial_number"),
  ipadIssuedAt: timestamp("ipad_issued_at"),
  ipadReturnedAt: timestamp("ipad_returned_at"),
  contractorAgreementExpiresAt: timestamp("contractor_agreement_expires_at"),
  ndaExpiresAt: timestamp("nda_expires_at"),
  backgroundCheckExpiresAt: timestamp("background_check_expires_at"),
  drugTestExpiresAt: timestamp("drug_test_expires_at"),
  commissionBlockedDueToExpiry: boolean("commission_blocked_due_to_expiry").notNull().default(false),
  commissionBlockedReason: text("commission_blocked_reason"),
  tutorialCompleted: boolean("tutorial_completed").notNull().default(false),
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
  leadId: varchar("lead_id").references(() => users.id), // Optional: Lead-specific rate card
  mobileProductType: mobileProductTypeEnum("mobile_product_type"),
  mobilePortedStatus: mobilePortedStatusEnum("mobile_ported_status"),
  baseAmount: decimal("base_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  tvAddonAmount: decimal("tv_addon_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  mobilePerLineAmount: decimal("mobile_per_line_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  overrideDeduction: decimal("override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  tvOverrideDeduction: decimal("tv_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  mobileOverrideDeduction: decimal("mobile_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  ironCrestRackRateCents: integer("iron_crest_rack_rate_cents"),
  ironCrestProfitBaseCents: integer("iron_crest_profit_base_cents"),
  directorOverrideCents: integer("director_override_cents"),
  adminOverrideCents: integer("admin_override_cents"),
  accountingOverrideCents: integer("accounting_override_cents"),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: varchar("deleted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rateCardsRelations = relations(rateCards, ({ one, many }) => ({
  provider: one(providers, { fields: [rateCards.providerId], references: [providers.id] }),
  client: one(clients, { fields: [rateCards.clientId], references: [clients.id] }),
  service: one(services, { fields: [rateCards.serviceId], references: [services.id] }),
  lead: one(users, { fields: [rateCards.leadId], references: [users.id] }),
  leadOverrides: many(rateCardLeadOverrides),
  roleOverrides: many(rateCardRoleOverrides),
}));

// Lead-specific override amounts for rate cards
export const rateCardLeadOverrides = pgTable("rate_card_lead_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rateCardId: varchar("rate_card_id").notNull().references(() => rateCards.id, { onDelete: "cascade" }),
  leadId: varchar("lead_id").notNull().references(() => users.id),
  overrideDeduction: decimal("override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  tvOverrideDeduction: decimal("tv_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  mobileOverrideDeduction: decimal("mobile_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueRateCardLead: unique().on(table.rateCardId, table.leadId),
}));

export const rateCardLeadOverridesRelations = relations(rateCardLeadOverrides, ({ one }) => ({
  rateCard: one(rateCards, { fields: [rateCardLeadOverrides.rateCardId], references: [rateCards.id] }),
  lead: one(users, { fields: [rateCardLeadOverrides.leadId], references: [users.id] }),
}));

// Role-specific override amounts for rate cards
export const rateCardRoleOverrides = pgTable("rate_card_role_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rateCardId: varchar("rate_card_id").notNull().references(() => rateCards.id, { onDelete: "cascade" }),
  role: userRoleEnum("role").notNull(),
  overrideDeduction: decimal("override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  tvOverrideDeduction: decimal("tv_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  mobileOverrideDeduction: decimal("mobile_override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  isAdditive: boolean("is_additive").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueRateCardRole: unique().on(table.rateCardId, table.role),
}));

export const rateCardRoleOverridesRelations = relations(rateCardRoleOverrides, ({ one }) => ({
  rateCard: one(rateCards, { fields: [rateCardRoleOverrides.rateCardId], references: [rateCards.id] }),
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
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  status: payRunStatusEnum("status").notNull().default("DRAFT"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finalizedAt: timestamp("finalized_at"),
  paidAt: timestamp("paid_at"),
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
  repId: text("rep_id"),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  providerId: varchar("provider_id").notNull().references(() => providers.id),
  serviceId: varchar("service_id").notNull().references(() => services.id),
  dateSold: date("date_sold").notNull(),
  installDate: date("install_date"),
  tvInstallDate: date("tv_install_date"),
  mobileInstallDate: date("mobile_install_date"),
  installTime: text("install_time"),
  installType: installTypeEnum("install_type"),
  accountNumber: text("account_number"),
  tvSold: boolean("tv_sold").notNull().default(false),
  mobileSold: boolean("mobile_sold").notNull().default(false),
  isMobileOrder: boolean("is_mobile_order").notNull().default(false),
  mobileProductType: mobileProductTypeEnum("mobile_product_type"),
  mobilePortedStatus: mobilePortedStatusEnum("mobile_ported_status"),
  mobileLinesQty: integer("mobile_lines_qty").notNull().default(0),
  customerName: text("customer_name").notNull(),
  customerAddress: text("customer_address"),
  houseNumber: text("house_number"),
  streetName: text("street_name"),
  aptUnit: text("apt_unit"),
  city: text("city"),
  zipCode: text("zip_code"),
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
  // Client acceptance fields for finance module
  clientAcceptanceStatus: clientAcceptanceStatusEnum("client_acceptance_status"),
  clientAcceptedAt: timestamp("client_accepted_at"),
  expectedAmountCents: integer("expected_amount_cents"),
  // Applied override deduction amount (from rate card or Lead-specific override)
  overrideDeduction: decimal("override_deduction", { precision: 10, scale: 2 }).notNull().default("0"),
  repRoleAtSale: text("rep_role_at_sale"),
  ironCrestRackRateCents: integer("iron_crest_rack_rate_cents"),
  ironCrestProfitCents: integer("iron_crest_profit_cents"),
  directorOverrideCents: integer("director_override_cents"),
  adminOverrideCents: integer("admin_override_cents"),
  accountingOverrideCents: integer("accounting_override_cents"),
  payrollReadyAt: timestamp("payroll_ready_at"),
  payrollReadyTriggeredBy: varchar("payroll_ready_triggered_by", { length: 20 }),
  payrollHoldReason: text("payroll_hold_reason"),
  isPayrollHeld: boolean("is_payroll_held").notNull().default(false),
  chargebackRiskScore: integer("chargeback_risk_score"),
  chargebackRiskFactors: text("chargeback_risk_factors"),
  reserveWithheldCents: integer("reserve_withheld_cents").notNull().default(0),
  reserveReleasedCents: integer("reserve_released_cents").notNull().default(0),
  reserveWithholdingApplied: boolean("reserve_withholding_applied").notNull().default(false),
  carrierMaturityType: varchar("carrier_maturity_type", { length: 30 }),
  maturityExpiresAt: timestamp("maturity_expires_at"),
  carrierConfirmedAt: timestamp("carrier_confirmed_at"),
  captureMethod: captureMethodEnum("capture_method").default("manual"),
  captureImageUrl: text("capture_image_url"),
  captureRawJson: jsonb("capture_raw_json"),
  autoApprovalAttemptedAt: timestamp("auto_approval_attempted_at"),
  autoApprovalResult: varchar("auto_approval_result"),
  autoApprovalBlockers: text("auto_approval_blockers"),
  autoApprovedBySystem: boolean("auto_approved_by_system").notNull().default(false),
  isDuplicateFlag: boolean("is_duplicate_flag").notNull().default(false),
  duplicateFlagReason: text("duplicate_flag_reason"),
  duplicateOfOrderId: varchar("duplicate_of_order_id"),
  notes: text("notes"),
  simplifiedStatus: varchar("simplified_status", { length: 30 }),
  hasActiveChargeback: boolean("has_active_chargeback").notNull().default(false),
  hasDisputedChargeback: boolean("has_disputed_chargeback").notNull().default(false),
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

// MDU Staging Orders - Orders from MDU users that need approval before entering main orders
export const mduStagingOrders = pgTable("mdu_staging_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mduRepId: text("mdu_rep_id").notNull(),
  clientId: varchar("client_id").references(() => clients.id),
  providerId: varchar("provider_id").references(() => providers.id),
  serviceId: varchar("service_id").references(() => services.id),
  dateSold: date("date_sold").notNull(),
  installDate: date("install_date"),
  installTime: text("install_time"),
  installType: installTypeEnum("install_type"),
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
  customerBirthday: date("customer_birthday"),
  customerSsnEncrypted: text("customer_ssn_encrypted"),
  customerSsnLast4: text("customer_ssn_last4"),
  creditCardLast4: text("credit_card_last4"),
  creditCardExpiry: text("credit_card_expiry"),
  creditCardName: text("credit_card_name"),
  notes: text("notes"),
  status: mduOrderStatusEnum("status").notNull().default("PENDING"),
  rejectionNote: text("rejection_note"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  promotedToOrderId: varchar("promoted_to_order_id").references(() => salesOrders.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const mduStagingOrdersRelations = relations(mduStagingOrders, ({ one }) => ({
  client: one(clients, { fields: [mduStagingOrders.clientId], references: [clients.id] }),
  provider: one(providers, { fields: [mduStagingOrders.providerId], references: [providers.id] }),
  service: one(services, { fields: [mduStagingOrders.serviceId], references: [services.id] }),
  reviewedBy: one(users, { fields: [mduStagingOrders.reviewedByUserId], references: [users.id] }),
  promotedOrder: one(salesOrders, { fields: [mduStagingOrders.promotedToOrderId], references: [salesOrders.id] }),
}));

export const insertMduStagingOrderSchema = createInsertSchema(mduStagingOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  rejectionNote: true,
  reviewedByUserId: true,
  reviewedAt: true,
  promotedToOrderId: true,
  customerSsnEncrypted: true,
}).extend({
  customerSsn: z.string().optional(),
  // Make enum fields truly optional - empty strings convert to null/undefined before validation
  installType: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["AGENT_INSTALL", "DIRECT_SHIP", "TECH_INSTALL"]).optional()
  ),
  mobileProductType: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["UNLIMITED", "3_GIG", "1_GIG", "BYOD", "OTHER"]).optional()
  ),
  mobilePortedStatus: z.preprocess(
    (v) => (v === "" || v === null || v === undefined) ? undefined : v,
    z.enum(["PORTED", "NON_PORTED"]).optional()
  ),
});
export type MduStagingOrder = typeof mduStagingOrders.$inferSelect;
export type InsertMduStagingOrder = z.infer<typeof insertMduStagingOrderSchema>;

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
  overrideType: text("override_type").default("STANDARD"),
  approvalStatus: text("approval_status").default("PENDING_APPROVAL"),
  approvedByUserId: varchar("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectedByUserId: varchar("rejected_by_user_id").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  approvalNote: text("approval_note"),
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
  reserveOffsetCents: integer("reserve_offset_cents").notNull().default(0),
  reserveOffsetApplied: boolean("reserve_offset_applied").notNull().default(false),
  chargebackType: varchar("chargeback_type", { length: 30 }),
  providerName: varchar("provider_name"),
  maturityDays: integer("maturity_days"),
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

// Order Exceptions table - for flagged orders
export const orderExceptions = pgTable("order_exceptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  salesOrderId: varchar("sales_order_id").notNull().references(() => salesOrders.id),
  reason: text("reason").notNull(),
  flaggedByUserId: varchar("flagged_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
});

export const orderExceptionsRelations = relations(orderExceptions, ({ one }) => ({
  salesOrder: one(salesOrders, { fields: [orderExceptions.salesOrderId], references: [salesOrders.id] }),
  flaggedBy: one(users, { fields: [orderExceptions.flaggedByUserId], references: [users.id], relationName: "flaggedExceptions" }),
  resolvedBy: one(users, { fields: [orderExceptions.resolvedByUserId], references: [users.id], relationName: "resolvedExceptions" }),
}));

export const insertOrderExceptionSchema = createInsertSchema(orderExceptions).omit({
  id: true,
  createdAt: true,
  resolvedByUserId: true,
  resolvedAt: true,
  resolutionNote: true,
});

export type OrderException = typeof orderExceptions.$inferSelect;
export type InsertOrderException = z.infer<typeof insertOrderExceptionSchema>;

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
export const insertOverrideEarningSchema = createInsertSchema(overrideEarnings).omit({ id: true, createdAt: true, approvedAt: true, rejectedAt: true });
export const insertChargebackSchema = createInsertSchema(chargebacks).omit({ id: true, createdAt: true });
export const insertAdjustmentSchema = createInsertSchema(adjustments).omit({ id: true, createdAt: true, approvedAt: true, approvedByUserId: true });
export const insertPayRunSchema = createInsertSchema(payRuns).omit({ id: true, createdAt: true, finalizedAt: true, paidAt: true });
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
export type RateCardLeadOverride = typeof rateCardLeadOverrides.$inferSelect;
export type RateCardRoleOverride = typeof rateCardRoleOverrides.$inferSelect;
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

// Lead dispositions - simplified for field operations
export const leadDispositions = [
  "NONE", "NOT_HOME", "RETURN", "DOOR_SLAM_REJECT", "SHORT_PITCH",
  "CALLED", "EMAIL_SENT", "CALL_NO_ANSWER", "NEGOTIATION", "SOLD"
] as const;
export type LeadDisposition = typeof leadDispositions[number];

// Lead disposition categories with metadata for UI and logic
export type DispositionCategory = "status" | "contact" | "positive" | "won" | "negative" | "follow_up";
export interface DispositionInfo {
  value: LeadDisposition;
  label: string;
  category: DispositionCategory;
  pipelineStage: LeadPipelineStage | null;
  isTerminal: boolean;
  requiresLostReason: boolean;
}

// Lead pipeline stages for funnel tracking - matches dispositions
export const leadPipelineStages = [
  "NOT_HOME", "RETURN", "DOOR_SLAM_REJECT", "SHORT_PITCH",
  "CALLED", "EMAIL_SENT", "CALL_NO_ANSWER", "NEGOTIATION", "SOLD"
] as const;
export type LeadPipelineStage = typeof leadPipelineStages[number];

export const dispositionMetadata: DispositionInfo[] = [
  { value: "NONE", label: "None", category: "status", pipelineStage: null, isTerminal: false, requiresLostReason: false },
  { value: "NOT_HOME", label: "Not Home", category: "contact", pipelineStage: "NOT_HOME", isTerminal: false, requiresLostReason: false },
  { value: "RETURN", label: "Return", category: "follow_up", pipelineStage: "RETURN", isTerminal: false, requiresLostReason: false },
  { value: "DOOR_SLAM_REJECT", label: "Door Slam/Reject", category: "negative", pipelineStage: "DOOR_SLAM_REJECT", isTerminal: true, requiresLostReason: false },
  { value: "SHORT_PITCH", label: "Short-Pitch", category: "contact", pipelineStage: "SHORT_PITCH", isTerminal: false, requiresLostReason: false },
  { value: "CALLED", label: "Called", category: "contact", pipelineStage: "CALLED", isTerminal: false, requiresLostReason: false },
  { value: "EMAIL_SENT", label: "Email Sent", category: "contact", pipelineStage: "EMAIL_SENT", isTerminal: false, requiresLostReason: false },
  { value: "CALL_NO_ANSWER", label: "Call-No Answer", category: "contact", pipelineStage: "CALL_NO_ANSWER", isTerminal: false, requiresLostReason: false },
  { value: "NEGOTIATION", label: "Negotiation", category: "positive", pipelineStage: "NEGOTIATION", isTerminal: false, requiresLostReason: false },
  { value: "SOLD", label: "Sold", category: "won", pipelineStage: "SOLD", isTerminal: true, requiresLostReason: false },
];

// Derived mappings for backward compatibility
export const dispositionToPipelineStage: Record<LeadDisposition, LeadPipelineStage | null> = 
  Object.fromEntries(dispositionMetadata.map(d => [d.value, d.pipelineStage])) as Record<LeadDisposition, LeadPipelineStage | null>;

export const terminalDispositions: LeadDisposition[] = dispositionMetadata.filter(d => d.isTerminal).map(d => d.value);

export const getDispositionInfo = (disposition: LeadDisposition): DispositionInfo | undefined =>
  dispositionMetadata.find(d => d.value === disposition);

// Lead loss reasons - expanded
export const leadLossReasons = [
  "PRICE",           // Too expensive
  "COMPETITOR",      // Chose competitor
  "NO_RESPONSE",     // Never responded
  "NOT_INTERESTED",  // Not interested in service
  "SERVICE_AREA",    // Outside service area
  "CREDIT",          // Credit/qualification issues
  "TIMING",          // Bad timing, not ready
  "WRONG_NUMBER",    // Invalid contact info
  "DO_NOT_CALL",     // Requested no contact
  "OTHER"            // Other reason
] as const;
export type LeadLossReason = typeof leadLossReasons[number];

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
  
  // Pipeline tracking
  pipelineStage: text("pipeline_stage").notNull().default("NEW"),
  stageChangedAt: timestamp("stage_changed_at"),
  
  // Follow-up scheduling
  scheduledFollowUp: timestamp("scheduled_follow_up"),
  followUpNotes: text("follow_up_notes"),
  lastContactedAt: timestamp("last_contacted_at"),
  contactAttempts: integer("contact_attempts").notNull().default(0),
  
  // Conversion tracking
  convertedToOrderId: varchar("converted_to_order_id").references(() => salesOrders.id),
  convertedAt: timestamp("converted_at"),
  
  // Loss tracking
  lostReason: text("lost_reason"),
  lostAt: timestamp("lost_at"),
  lostNotes: text("lost_notes"),
  
  // Provider/Service interest (for win/loss analysis)
  interestedProviderId: varchar("interested_provider_id").references(() => providers.id),
  interestedServiceId: varchar("interested_service_id").references(() => services.id),
  
  // Deduplication fields
  normalizedPhone: text("normalized_phone"),
  normalizedEmail: text("normalized_email"),
  addressHash: text("address_hash"),
  dedupeGroupId: varchar("dedupe_group_id"),
  
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

// Lead Disposition History - tracks all disposition changes for each lead
export const leadDispositionHistory = pgTable("lead_disposition_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => leads.id).notNull(),
  disposition: text("disposition").notNull(),
  previousDisposition: text("previous_disposition"),
  changedByUserId: varchar("changed_by_user_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leadDispositionHistoryRelations = relations(leadDispositionHistory, ({ one }) => ({
  lead: one(leads, { fields: [leadDispositionHistory.leadId], references: [leads.id] }),
  changedBy: one(users, { fields: [leadDispositionHistory.changedByUserId], references: [users.id] }),
}));

export const insertLeadDispositionHistorySchema = createInsertSchema(leadDispositionHistory).omit({
  id: true,
  createdAt: true,
});
export type LeadDispositionHistory = typeof leadDispositionHistory.$inferSelect;
export type InsertLeadDispositionHistory = z.infer<typeof insertLeadDispositionHistorySchema>;

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
  minimumRole: userRoleEnum("minimum_role").default("REP"),
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
  bonusesTotal: decimal("bonuses_total", { precision: 10, scale: 2 }).notNull().default("0"),
  status: payStatementStatusEnum("status").notNull().default("DRAFT"),
  issuedAt: timestamp("issued_at"),
  paidAt: timestamp("paid_at"),
  paymentMethodId: varchar("payment_method_id").references(() => userPaymentMethods.id),
  paymentReference: text("payment_reference"),
  repName: varchar("rep_name"),
  repId: varchar("rep_id_string"),
  repRole: varchar("rep_role"),
  repEmail: varchar("rep_email"),
  stubNumber: varchar("stub_number"),
  totalOrders: integer("total_orders").default(0),
  totalConnects: integer("total_connects").default(0),
  totalMobileLines: integer("total_mobile_lines").default(0),
  isViewableByRep: boolean("is_viewable_by_rep").notNull().default(false),
  companyName: varchar("company_name").default("Iron Crest"),
  reserveWithheldCents: integer("reserve_withheld_cents").notNull().default(0),
  reserveReleasedCents: integer("reserve_released_cents").notNull().default(0),
  reserveWithheldTotal: varchar("reserve_withheld_total").notNull().default("0"),
  reserveBalanceAfter: varchar("reserve_balance_after"),
  reservePreviousBalance: varchar("reserve_previous_balance"),
  reserveChargebacksOffset: varchar("reserve_chargebacks_offset"),
  reserveCapAmount: varchar("reserve_cap_amount"),
  reserveStatusLabel: varchar("reserve_status_label"),
  ytdGross: decimal("ytd_gross", { precision: 12, scale: 2 }).notNull().default("0"),
  ytdDeductions: decimal("ytd_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  ytdNetPay: decimal("ytd_net_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  emailDeliveryStatus: varchar("email_delivery_status", { length: 20 }).notNull().default("PENDING"),
  emailDeliveryError: text("email_delivery_error"),
  emailSentAt: timestamp("email_sent_at"),
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
  salesOrderId: varchar("sales_order_id").references(() => salesOrders.id),
  invoiceNumber: varchar("invoice_number"),
  customerName: varchar("customer_name"),
  dateSold: varchar("date_sold"),
  serviceDescription: varchar("service_description"),
  providerName: varchar("provider_name"),
  installDate: varchar("install_date"),
  repRoleAtSale: varchar("rep_role_at_sale"),
  quantity: integer("quantity").notNull().default(1),
  rate: decimal("rate", { precision: 10, scale: 2 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  netAmount: decimal("net_amount", { precision: 10, scale: 2 }),
  reserveWithheldForOrder: decimal("reserve_withheld_for_order", { precision: 10, scale: 2 }),
  chargebackSource: varchar("chargeback_source"),
  chargebackFromReserveCents: integer("chargeback_from_reserve_cents"),
  chargebackFromNetPayCents: integer("chargeback_from_net_pay_cents"),
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

export const stubSequences = pgTable("stub_sequences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payRunId: varchar("pay_run_id").notNull().references(() => payRuns.id),
  sequence: integer("sequence").notNull().default(0),
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

// Email Notifications
export const notificationTypeEnum = pgEnum("notification_type", [
  "ORDER_SUBMITTED",
  "ORDER_APPROVED",
  "ORDER_REJECTED",
  "PAY_RUN_FINALIZED",
  "CHARGEBACK_APPLIED",
  "ADVANCE_APPROVED",
  "ADVANCE_REJECTED",
  "PASSWORD_RESET",
  "PENDING_APPROVAL_ALERT",
  "LOW_PERFORMANCE_WARNING",
  "MDU_ORDER_SUBMITTED",
  "GENERAL",
  "OVERRIDE_PENDING_APPROVAL",
  "OVERRIDE_APPROVED",
  "OVERRIDE_REJECTED",
  "ONBOARDING_APPROVED",
  "ONBOARDING_REJECTED",
  "ONBOARDING_SUBMITTED",
  "ONBOARDING_OTP_LOCKED",
  "COMPLIANCE_CLEARED",
  "PAY_STUB_DELIVERY"
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "PENDING",
  "SENT",
  "FAILED",
  "SKIPPED"
]);

export const emailNotifications = pgTable("email_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  notificationType: notificationTypeEnum("notification_type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  status: notificationStatusEnum("status").notNull().default("PENDING"),
  relatedEntityType: text("related_entity_type"), // ORDER, PAY_RUN, CHARGEBACK, etc.
  relatedEntityId: varchar("related_entity_id"),
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailNotification = typeof emailNotifications.$inferSelect;
export type InsertEmailNotification = typeof emailNotifications.$inferInsert;

// Notification Preferences
export const notificationPreferences = pgTable("notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull().unique(),
  emailOrderApproved: boolean("email_order_approved").notNull().default(true),
  emailOrderRejected: boolean("email_order_rejected").notNull().default(true),
  emailPayRunFinalized: boolean("email_pay_run_finalized").notNull().default(true),
  emailChargebackApplied: boolean("email_chargeback_applied").notNull().default(true),
  emailAdvanceUpdates: boolean("email_advance_updates").notNull().default(true),
  emailPendingApprovalAlert: boolean("email_pending_approval_alert").notNull().default(true),
  emailLowPerformanceWarning: boolean("email_low_performance_warning").notNull().default(true),
  emailPayStubDelivery: boolean("email_pay_stub_delivery").notNull().default(true),
  pendingApprovalDaysThreshold: integer("pending_approval_days_threshold").notNull().default(3),
  tutorialEnabled: boolean("tutorial_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;

// Scheduled Reports
export const scheduledReports = pgTable("scheduled_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  reportType: varchar("report_type", { length: 100 }).notNull(), // 'summary', 'commission', 'profitability', 'product-mix'
  frequency: varchar("frequency", { length: 50 }).notNull(), // 'daily', 'weekly', 'monthly'
  dayOfWeek: integer("day_of_week"), // 0-6 for weekly (0=Sunday)
  dayOfMonth: integer("day_of_month"), // 1-31 for monthly
  timeOfDay: varchar("time_of_day", { length: 10 }).default("08:00"), // HH:mm format
  recipients: text("recipients").array(), // Array of email addresses
  isActive: boolean("is_active").notNull().default(true),
  lastSentAt: timestamp("last_sent_at"),
  nextSendAt: timestamp("next_send_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScheduledReportSchema = createInsertSchema(scheduledReports).omit({
  id: true,
  lastSentAt: true,
  nextSendAt: true,
  createdAt: true,
  updatedAt: true,
});

export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type InsertScheduledReport = z.infer<typeof insertScheduledReportSchema>;

// Background Job Log (for scheduled tasks)
export const backgroundJobs = pgTable("background_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobType: text("job_type").notNull(), // SCHEDULED_PAY_RUN, CHARGEBACK_PROCESSOR, NOTIFICATION_SENDER
  status: text("status").notNull().default("PENDING"), // PENDING, RUNNING, COMPLETED, FAILED
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  result: text("result"),
  errorMessage: text("error_message"),
  metadata: text("metadata"), // JSON string for job-specific data
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;

// Employee Credentials - Access & Device Credentials Sheet
export const employeeCredentials = pgTable("employee_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  entryLabel: varchar("entry_label", { length: 100 }).notNull().default("Primary"),
  peopleSoftNumber: text("people_soft_number"),
  networkId: text("network_id"),
  tempPassword: text("temp_password"),
  workEmail: text("work_email"),
  rtr: text("rtr"),
  rtrPassword: text("rtr_password"),
  authenticatorUsername: text("authenticator_username"),
  authenticatorPassword: text("authenticator_password"),
  ipadPin: text("ipad_pin"),
  deviceNumber: text("device_number"),
  gmail: text("gmail"),
  gmailPassword: text("gmail_password"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastUpdatedByUserId: varchar("last_updated_by_user_id").references(() => users.id),
});

export const employeeCredentialsRelations = relations(employeeCredentials, ({ one }) => ({
  user: one(users, { fields: [employeeCredentials.userId], references: [users.id] }),
  lastUpdatedBy: one(users, { fields: [employeeCredentials.lastUpdatedByUserId], references: [users.id], relationName: "credentialUpdater" }),
}));

export const insertEmployeeCredentialsSchema = createInsertSchema(employeeCredentials).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export type EmployeeCredential = typeof employeeCredentials.$inferSelect;
export type InsertEmployeeCredential = z.infer<typeof insertEmployeeCredentialsSchema>;

// Sales Goals/Quotas table
export const salesGoals = pgTable("sales_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  periodType: text("period_type").notNull().default("MONTHLY"), // WEEKLY, MONTHLY, QUARTERLY
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  salesTarget: integer("sales_target").notNull().default(0), // Number of sales
  connectsTarget: integer("connects_target").notNull().default(0), // Number of connects/completions
  revenueTarget: decimal("revenue_target", { precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
});

export const salesGoalsRelations = relations(salesGoals, ({ one }) => ({
  user: one(users, { fields: [salesGoals.userId], references: [users.id] }),
  createdBy: one(users, { fields: [salesGoals.createdByUserId], references: [users.id], relationName: "goalCreator" }),
}));

export const insertSalesGoalSchema = createInsertSchema(salesGoals).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export type SalesGoal = typeof salesGoals.$inferSelect;
export type InsertSalesGoal = z.infer<typeof insertSalesGoalSchema>;

// Login schema
export const loginSchema = z.object({
  repId: z.string().min(1, "Rep ID is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Commission Disputes
export const commissionDisputeStatusEnum = pgEnum("commission_dispute_status", ["PENDING", "UNDER_REVIEW", "ESCALATED", "LEGAL_HOLD", "APPROVED", "REJECTED", "CLOSED"]);
export const commissionDisputeTypeEnum = pgEnum("commission_dispute_type", ["MISSING_COMMISSION", "INCORRECT_AMOUNT", "INCORRECT_SERVICE", "CHARGEBACK_DISPUTE", "OTHER"]);

export const commissionDisputes = pgTable("commission_disputes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  salesOrderId: varchar("sales_order_id").references(() => salesOrders.id),
  payStatementId: varchar("pay_statement_id").references(() => payStatements.id),
  disputeType: commissionDisputeTypeEnum("dispute_type").notNull(),
  status: commissionDisputeStatusEnum("status").notNull().default("PENDING"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  expectedAmount: decimal("expected_amount", { precision: 10, scale: 2 }),
  actualAmount: decimal("actual_amount", { precision: 10, scale: 2 }),
  differenceAmount: decimal("difference_amount", { precision: 10, scale: 2 }),
  resolution: text("resolution"),
  resolvedAmount: decimal("resolved_amount", { precision: 10, scale: 2 }),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  escalationThresholdAmount: decimal("escalation_threshold_amount", { precision: 10, scale: 2 }),
  escalatedAt: timestamp("escalated_at"),
  escalatedByUserId: varchar("escalated_by_user_id").references(() => users.id),
  legalHoldAt: timestamp("legal_hold_at"),
  legalHoldByUserId: varchar("legal_hold_by_user_id").references(() => users.id),
  legalHoldReason: text("legal_hold_reason"),
  legalHoldReleasedAt: timestamp("legal_hold_released_at"),
  legalHoldReleasedByUserId: varchar("legal_hold_released_by_user_id").references(() => users.id),
  commissionFrozen: boolean("commission_frozen").notNull().default(false),
  autoEscalated: boolean("auto_escalated").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const commissionDisputesRelations = relations(commissionDisputes, ({ one, many }) => ({
  user: one(users, { fields: [commissionDisputes.userId], references: [users.id] }),
  salesOrder: one(salesOrders, { fields: [commissionDisputes.salesOrderId], references: [salesOrders.id] }),
  payStatement: one(payStatements, { fields: [commissionDisputes.payStatementId], references: [payStatements.id] }),
  resolvedBy: one(users, { fields: [commissionDisputes.resolvedByUserId], references: [users.id], relationName: "disputeResolver" }),
  escalationEvents: many(disputeEscalationEvents),
  evidenceAttachments: many(disputeEvidenceAttachments),
}));

export const insertCommissionDisputeSchema = createInsertSchema(commissionDisputes).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  resolvedAt: true,
  resolvedByUserId: true,
  resolution: true,
  resolvedAmount: true,
  escalatedAt: true,
  escalatedByUserId: true,
  legalHoldAt: true,
  legalHoldByUserId: true,
  legalHoldReleasedAt: true,
  legalHoldReleasedByUserId: true,
  commissionFrozen: true,
  autoEscalated: true,
});

export type CommissionDispute = typeof commissionDisputes.$inferSelect;
export type InsertCommissionDispute = z.infer<typeof insertCommissionDisputeSchema>;

// Dispute Escalation Events (timeline)
export const disputeEscalationEvents = pgTable("dispute_escalation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  disputeId: varchar("dispute_id").notNull().references(() => commissionDisputes.id, { onDelete: "cascade" }),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  fromStatus: varchar("from_status", { length: 30 }),
  toStatus: varchar("to_status", { length: 30 }),
  note: text("note"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const disputeEscalationEventsRelations = relations(disputeEscalationEvents, ({ one }) => ({
  dispute: one(commissionDisputes, { fields: [disputeEscalationEvents.disputeId], references: [commissionDisputes.id] }),
  actor: one(users, { fields: [disputeEscalationEvents.actorUserId], references: [users.id] }),
}));

export const insertDisputeEscalationEventSchema = createInsertSchema(disputeEscalationEvents).omit({
  id: true, createdAt: true,
});
export type DisputeEscalationEvent = typeof disputeEscalationEvents.$inferSelect;
export type InsertDisputeEscalationEvent = z.infer<typeof insertDisputeEscalationEventSchema>;

// Dispute Evidence Attachments
export const disputeEvidenceAttachments = pgTable("dispute_evidence_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  disputeId: varchar("dispute_id").notNull().references(() => commissionDisputes.id, { onDelete: "cascade" }),
  uploadedByUserId: varchar("uploaded_by_user_id").notNull().references(() => users.id),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  storageKey: text("storage_key").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const disputeEvidenceAttachmentsRelations = relations(disputeEvidenceAttachments, ({ one }) => ({
  dispute: one(commissionDisputes, { fields: [disputeEvidenceAttachments.disputeId], references: [commissionDisputes.id] }),
  uploadedBy: one(users, { fields: [disputeEvidenceAttachments.uploadedByUserId], references: [users.id] }),
}));

export const insertDisputeEvidenceAttachmentSchema = createInsertSchema(disputeEvidenceAttachments).omit({
  id: true, createdAt: true,
});
export type DisputeEvidenceAttachment = typeof disputeEvidenceAttachments.$inferSelect;
export type InsertDisputeEvidenceAttachment = z.infer<typeof insertDisputeEvidenceAttachmentSchema>;

// Contractor Document Version History — immutable audit trail for re-signs
export const contractorDocumentVersions = pgTable("contractor_document_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  documentType: varchar("document_type", { length: 50 }).notNull(), // CONTRACTOR_AGREEMENT, NDA, BACKGROUND_CHECK, DRUG_TEST
  eventType: varchar("event_type", { length: 30 }).notNull(), // SIGNED, EXPIRED, RE_CERTIFIED, MANUALLY_UPDATED
  expiresAt: timestamp("expires_at"),
  signedAt: timestamp("signed_at"),
  performedByUserId: varchar("performed_by_user_id").references(() => users.id),
  note: text("note"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contractorDocumentVersionsRelations = relations(contractorDocumentVersions, ({ one }) => ({
  user: one(users, { fields: [contractorDocumentVersions.userId], references: [users.id] }),
  performedBy: one(users, { fields: [contractorDocumentVersions.performedByUserId], references: [users.id] }),
}));

export const insertContractorDocumentVersionSchema = createInsertSchema(contractorDocumentVersions).omit({
  id: true, createdAt: true,
});
export type ContractorDocumentVersion = typeof contractorDocumentVersions.$inferSelect;
export type InsertContractorDocumentVersion = z.infer<typeof insertContractorDocumentVersionSchema>;

// Re-certification requests — tracks when a rep is asked to re-sign expired documents
export const recertificationRequests = pgTable("recertification_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  documentTypes: text("document_types").array().notNull(), // which documents need re-sign
  status: varchar("status", { length: 20 }).notNull().default("PENDING"), // PENDING, COMPLETED, EXPIRED
  requestedByUserId: varchar("requested_by_user_id").references(() => users.id),
  requestNote: text("request_note"),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"), // when this re-cert request expires if not acted on
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const recertificationRequestsRelations = relations(recertificationRequests, ({ one }) => ({
  user: one(users, { fields: [recertificationRequests.userId], references: [users.id] }),
  requestedBy: one(users, { fields: [recertificationRequests.requestedByUserId], references: [users.id] }),
}));

export const insertRecertificationRequestSchema = createInsertSchema(recertificationRequests).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type RecertificationRequest = typeof recertificationRequests.$inferSelect;
export type InsertRecertificationRequest = z.infer<typeof insertRecertificationRequestSchema>;

// Finance Import table - tracks file imports
export const financeImports = pgTable("finance_imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  sourceType: financeImportSourceTypeEnum("source_type").notNull(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  importedByUserId: varchar("imported_by_user_id").notNull().references(() => users.id),
  status: financeImportStatusEnum("status").notNull().default("IMPORTED"),
  totalRows: integer("total_rows").notNull().default(0),
  totalAmountCents: integer("total_amount_cents").notNull().default(0),
  columnMapping: text("column_mapping"), // JSON string for saved column mapping
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  clientFileHashUnique: uniqueIndex("finance_imports_client_file_hash_unique").on(table.clientId, table.fileHash),
}));

export const financeImportsRelations = relations(financeImports, ({ one, many }) => ({
  client: one(clients, { fields: [financeImports.clientId], references: [clients.id] }),
  importedBy: one(users, { fields: [financeImports.importedByUserId], references: [users.id] }),
  rawRows: many(financeImportRowsRaw),
  rows: many(financeImportRows),
}));

// Finance Import Raw Rows - immutable raw data from file
export const financeImportRowsRaw = pgTable("finance_import_rows_raw", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  financeImportId: varchar("finance_import_id").notNull().references(() => financeImports.id),
  rowIndex: integer("row_index").notNull(),
  rawJson: text("raw_json").notNull(), // JSON string of original row data
  rawTextFingerprint: text("raw_text_fingerprint").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const financeImportRowsRawRelations = relations(financeImportRowsRaw, ({ one }) => ({
  financeImport: one(financeImports, { fields: [financeImportRowsRaw.financeImportId], references: [financeImports.id] }),
}));

// Finance Import Rows - normalized data ready for matching
export const financeImportRows = pgTable("finance_import_rows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  financeImportId: varchar("finance_import_id").notNull().references(() => financeImports.id),
  rawRowId: varchar("raw_row_id").references(() => financeImportRowsRaw.id),
  customerName: text("customer_name"),
  customerNameNorm: text("customer_name_norm"), // lowercased, trimmed, punctuation removed
  repName: text("rep_name"),
  repNameNorm: text("rep_name_norm"),
  serviceType: text("service_type"),
  utility: text("utility"),
  saleDate: date("sale_date"),
  clientStatus: text("client_status"), // Enrolled, Rejected, Pending
  usageUnits: decimal("usage_units", { precision: 12, scale: 4 }),
  expectedAmountCents: integer("expected_amount_cents"),
  paidAmountCents: integer("paid_amount_cents"),
  rejectionReason: text("rejection_reason"),
  matchedOrderId: varchar("matched_order_id").references(() => salesOrders.id),
  matchStatus: financeMatchStatusEnum("match_status").notNull().default("UNMATCHED"),
  matchConfidence: integer("match_confidence").notNull().default(0),
  matchReason: text("match_reason"), // JSON with scoring details
  ignoreReason: text("ignore_reason"),
  isDuplicate: boolean("is_duplicate").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const financeImportRowsRelations = relations(financeImportRows, ({ one }) => ({
  financeImport: one(financeImports, { fields: [financeImportRows.financeImportId], references: [financeImports.id] }),
  rawRow: one(financeImportRowsRaw, { fields: [financeImportRows.rawRowId], references: [financeImportRowsRaw.id] }),
  matchedOrder: one(salesOrders, { fields: [financeImportRows.matchedOrderId], references: [salesOrders.id] }),
}));

// AR Expectations - expected receivables from accepted orders
export const arExpectations = pgTable("ar_expectations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  orderId: varchar("order_id").references(() => salesOrders.id),
  financeImportRowId: varchar("finance_import_row_id").unique().references(() => financeImportRows.id),
  expectedAmountCents: integer("expected_amount_cents").notNull(),
  actualAmountCents: integer("actual_amount_cents").notNull().default(0),
  varianceAmountCents: integer("variance_amount_cents").notNull().default(0),
  varianceReason: text("variance_reason"),
  expectedFromDate: date("expected_from_date").notNull(),
  status: arExpectationStatusEnum("status").notNull().default("OPEN"),
  hasVariance: boolean("has_variance").notNull().default(false),
  serviceType: text("service_type"),
  serviceInstallDate: date("service_install_date"),
  commissionAmountCents: integer("commission_amount_cents"),
  satisfiedAt: timestamp("satisfied_at"),
  writtenOffAt: timestamp("written_off_at"),
  writtenOffByUserId: varchar("written_off_by_user_id").references(() => users.id),
  writtenOffReason: text("written_off_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const arExpectationsRelations = relations(arExpectations, ({ one, many }) => ({
  client: one(clients, { fields: [arExpectations.clientId], references: [clients.id] }),
  order: one(salesOrders, { fields: [arExpectations.orderId], references: [salesOrders.id] }),
  financeImportRow: one(financeImportRows, { fields: [arExpectations.financeImportRowId], references: [financeImportRows.id] }),
  writtenOffBy: one(users, { fields: [arExpectations.writtenOffByUserId], references: [users.id] }),
  payments: many(arPayments),
}));

// AR Payments - track partial payments against AR expectations
export const arPayments = pgTable("ar_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  arExpectationId: varchar("ar_expectation_id").notNull().references(() => arExpectations.id),
  amountCents: integer("amount_cents").notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentReference: text("payment_reference"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  recordedByUserId: varchar("recorded_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const arPaymentsRelations = relations(arPayments, ({ one }) => ({
  arExpectation: one(arExpectations, { fields: [arPayments.arExpectationId], references: [arExpectations.id] }),
  recordedBy: one(users, { fields: [arPayments.recordedByUserId], references: [users.id] }),
}));

// Finance Periods - optional period tracking
export const financePeriods = pgTable("finance_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  periodType: financePeriodTypeEnum("period_type").notNull(),
  status: financePeriodStatusEnum("status").notNull().default("DRAFT"),
  closedAt: timestamp("closed_at"),
  closedByUserId: varchar("closed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const financePeriodsRelations = relations(financePeriods, ({ one }) => ({
  closedBy: one(users, { fields: [financePeriods.closedByUserId], references: [users.id] }),
}));

// Client Column Mappings - save column mapping templates per client
export const clientColumnMappings = pgTable("client_column_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  mappingJson: text("mapping_json").notNull(), // JSON with column -> field mappings
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientColumnMappingsRelations = relations(clientColumnMappings, ({ one }) => ({
  client: one(clients, { fields: [clientColumnMappings.clientId], references: [clients.id] }),
}));

// Insert schemas and types for finance tables
export const insertFinanceImportSchema = createInsertSchema(financeImports).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  importedAt: true 
});
export type FinanceImport = typeof financeImports.$inferSelect;
export type InsertFinanceImport = z.infer<typeof insertFinanceImportSchema>;

export const insertFinanceImportRowRawSchema = createInsertSchema(financeImportRowsRaw).omit({ 
  id: true, 
  createdAt: true 
});
export type FinanceImportRowRaw = typeof financeImportRowsRaw.$inferSelect;
export type InsertFinanceImportRowRaw = z.infer<typeof insertFinanceImportRowRawSchema>;

export const insertFinanceImportRowSchema = createInsertSchema(financeImportRows).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type FinanceImportRow = typeof financeImportRows.$inferSelect;
export type InsertFinanceImportRow = z.infer<typeof insertFinanceImportRowSchema>;

export const insertArExpectationSchema = createInsertSchema(arExpectations).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type ArExpectation = typeof arExpectations.$inferSelect;
export type InsertArExpectation = z.infer<typeof insertArExpectationSchema>;

export const insertArPaymentSchema = createInsertSchema(arPayments).omit({ 
  id: true, 
  createdAt: true 
});
export type ArPayment = typeof arPayments.$inferSelect;
export type InsertArPayment = z.infer<typeof insertArPaymentSchema>;

export const insertFinancePeriodSchema = createInsertSchema(financePeriods).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type FinancePeriod = typeof financePeriods.$inferSelect;
export type InsertFinancePeriod = z.infer<typeof insertFinancePeriodSchema>;

export const insertClientColumnMappingSchema = createInsertSchema(clientColumnMappings).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type ClientColumnMapping = typeof clientColumnMappings.$inferSelect;
export type InsertClientColumnMapping = z.infer<typeof insertClientColumnMappingSchema>;

export const userActivityLogs = pgTable("user_activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  eventType: text("event_type").notNull(),
  page: text("page"),
  ipAddress: text("ip_address"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserActivityLogSchema = createInsertSchema(userActivityLogs).omit({
  id: true,
  createdAt: true,
});
export type UserActivityLog = typeof userActivityLogs.$inferSelect;
export type InsertUserActivityLog = z.infer<typeof insertUserActivityLogSchema>;

export const installSyncRuns = pgTable("install_sync_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetUrl: text("sheet_url"),
  sourceType: text("source_type").notNull().default("google_sheet"),
  emailTo: text("email_to"),
  totalSheetRows: integer("total_sheet_rows").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  unmatchedCount: integer("unmatched_count").notNull().default(0),
  newCount: integer("new_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  emailSent: boolean("email_sent").notNull().default(false),
  status: text("status").notNull().default("RUNNING"),
  isIncremental: boolean("is_incremental").notNull().default(false),
  summary: text("summary"),
  matchDetails: text("match_details"),
  errorMessage: text("error_message"),
  runByUserId: varchar("run_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertInstallSyncRunSchema = createInsertSchema(installSyncRuns).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type InstallSyncRun = typeof installSyncRuns.$inferSelect;
export type InsertInstallSyncRun = z.infer<typeof insertInstallSyncRunSchema>;

export const processedWorkOrders = pgTable("processed_work_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workOrderNumber: text("work_order_number").notNull(),
  carrierProfileId: varchar("carrier_profile_id").notNull().default("__none__"),
  syncRunId: varchar("sync_run_id").notNull().references(() => installSyncRuns.id),
  matchedOrderId: varchar("matched_order_id").notNull().references(() => salesOrders.id),
  serviceLineType: text("service_line_type"),
  woStatus: text("wo_status"),
  rowHash: text("row_hash"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("processed_wo_carrier_unique").on(table.workOrderNumber, table.carrierProfileId),
]);
export type ProcessedWorkOrder = typeof processedWorkOrders.$inferSelect;

export const carrierImportSchedules = pgTable("carrier_import_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  sourceType: text("source_type").notNull().default("manual"),
  sftpHost: text("sftp_host"),
  sftpPort: integer("sftp_port").default(22),
  sftpUser: text("sftp_user"),
  sftpPasswordEncrypted: text("sftp_password_encrypted"),
  sftpRemotePath: text("sftp_remote_path"),
  emailTriggerDomain: text("email_trigger_domain"),
  fileNamePattern: text("file_name_pattern"),
  columnMappingJson: text("column_mapping_json"),
  frequency: text("frequency").notNull().default("daily"),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: text("last_run_status"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCarrierImportScheduleSchema = createInsertSchema(carrierImportSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastRunAt: true,
  lastRunStatus: true,
});
export type CarrierImportSchedule = typeof carrierImportSchedules.$inferSelect;
export type InsertCarrierImportSchedule = z.infer<typeof insertCarrierImportScheduleSchema>;

export const apiKeys = pgTable("api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: text("scopes").notNull().default("production-summary,ar-status,payroll-summary"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  lastUsedAt: timestamp("last_used_at"),
  usageCount: integer("usage_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
  usageCount: true,
});
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;

export const integrationLogs = pgTable("integration_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  integrationType: text("integration_type").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("SUCCESS"),
  details: text("details"),
  relatedEntityId: varchar("related_entity_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IntegrationLog = typeof integrationLogs.$inferSelect;

export const calendarSyncConfig = pgTable("calendar_sync_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  calendarId: text("calendar_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isActive: boolean("is_active").notNull().default(false),
  configuredByUserId: varchar("configured_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const onboardingSubmissions = pgTable("onboarding_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  repName: varchar("rep_name").notNull(),
  repEmail: varchar("rep_email"),
  repPhone: varchar("rep_phone"),
  ipAddress: varchar("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  payloadHash: varchar("payload_hash").notNull(),
  backgroundCheckCompleted: boolean("background_check_completed").notNull().default(false),
  backgroundCheckSignedAt: timestamp("background_check_signed_at"),
  chargebackPolicyCompleted: boolean("chargeback_policy_completed").notNull().default(false),
  chargebackPolicySignedAt: timestamp("chargeback_policy_signed_at"),
  contractorAppCompleted: boolean("contractor_app_completed").notNull().default(false),
  contractorAppSignedAt: timestamp("contractor_app_signed_at"),
  directDepositCompleted: boolean("direct_deposit_completed").notNull().default(false),
  directDepositSignedAt: timestamp("direct_deposit_signed_at"),
  drugTestCompleted: boolean("drug_test_completed").notNull().default(false),
  drugTestSignedAt: timestamp("drug_test_signed_at"),
  ndaCompleted: boolean("nda_completed").notNull().default(false),
  ndaSignedAt: timestamp("nda_signed_at"),
  w9Completed: boolean("w9_completed").notNull().default(false),
  w9SignedAt: timestamp("w9_signed_at"),
  w9FullName: varchar("w9_full_name"),
  w9BusinessName: varchar("w9_business_name"),
  w9Address: varchar("w9_address"),
  w9City: varchar("w9_city"),
  w9State: varchar("w9_state"),
  w9Zip: varchar("w9_zip"),
  w9TaxClassification: varchar("w9_tax_classification"),
  w9LlcType: varchar("w9_llc_type"),
  w9TinType: varchar("w9_tin_type"),
  w9TinLast4: varchar("w9_tin_last4", { length: 4 }),
  backgroundCheckSignature: text("background_check_signature"),
  chargebackPolicySignature: text("chargeback_policy_signature"),
  contractorAppSignature: text("contractor_app_signature"),
  directDepositSignature: text("direct_deposit_signature"),
  drugTestSignature: text("drug_test_signature"),
  ndaSignature: text("nda_signature"),
  w9Signature: text("w9_signature"),
  ssnEncrypted: text("ssn_encrypted"),
  ssnLast4: varchar("ssn_last4", { length: 4 }),
  routingNumberEncrypted: text("routing_number_encrypted"),
  accountNumberEncrypted: text("account_number_encrypted"),
  accountNumberLast4: varchar("account_number_last4", { length: 4 }),
  bankName: varchar("bank_name"),
  accountType: varchar("account_type", { length: 10 }),
  photoIdS3Key: varchar("photo_id_s3_key"),
  voidedCheckS3Key: varchar("voided_check_s3_key"),
  drugTestPhotoS3Key: varchar("drug_test_photo_s3_key"),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOnboardingSubmissionSchema = createInsertSchema(onboardingSubmissions).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type OnboardingSubmission = typeof onboardingSubmissions.$inferSelect;
export type InsertOnboardingSubmission = z.infer<typeof insertOnboardingSubmissionSchema>;

export const onboardingAuditLog = pgTable("onboarding_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  action: varchar("action").notNull(),
  detail: text("detail"),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OnboardingAuditEntry = typeof onboardingAuditLog.$inferSelect;

export const onboardingDrafts = pgTable("onboarding_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  documentType: varchar("document_type").notNull(),
  draftJson: text("draft_json").notNull(),
  lastSavedAt: timestamp("last_saved_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("onboarding_drafts_user_doc_unique").on(table.userId, table.documentType),
]);

export type OnboardingDraft = typeof onboardingDrafts.$inferSelect;

export const rollingReserves = pgTable("rolling_reserves", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  currentBalanceCents: integer("current_balance_cents").notNull().default(0),
  capCents: integer("cap_cents").notNull().default(250000),
  withholdingPercent: decimal("withholding_percent", { precision: 5, scale: 2 }).notNull().default("15.00"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  separatedAt: timestamp("separated_at"),
  separationType: varchar("separation_type", { length: 30 }),
  earliestReleaseAt: timestamp("earliest_release_at"),
  capOverrideReason: text("cap_override_reason"),
  capOverrideByUserId: varchar("cap_override_by_user_id").references(() => users.id),
  capOverrideAt: timestamp("cap_override_at"),
  totalWithheldCents: integer("total_withheld_cents").notNull().default(0),
  totalChargebacksCents: integer("total_chargebacks_cents").notNull().default(0),
  totalReleasedCents: integer("total_released_cents").notNull().default(0),
  totalEquipmentRecoveryCents: integer("total_equipment_recovery_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("rolling_reserves_user_id_unique").on(table.userId),
  index("rolling_reserves_status_idx").on(table.status),
]);

export const rollingReservesRelations = relations(rollingReserves, ({ one, many }) => ({
  user: one(users, { fields: [rollingReserves.userId], references: [users.id] }),
  capOverrideBy: one(users, { fields: [rollingReserves.capOverrideByUserId], references: [users.id], relationName: "capOverrideBy" }),
  transactions: many(reserveTransactions),
}));

export const insertRollingReserveSchema = createInsertSchema(rollingReserves).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type RollingReserve = typeof rollingReserves.$inferSelect;
export type InsertRollingReserve = z.infer<typeof insertRollingReserveSchema>;

export const reserveTransactions = pgTable("reserve_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reserveId: varchar("reserve_id").notNull().references(() => rollingReserves.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  transactionType: varchar("transaction_type", { length: 30 }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  isCredit: boolean("is_credit").notNull().default(true),
  balanceAfterCents: integer("balance_after_cents").notNull(),
  salesOrderId: varchar("sales_order_id").references(() => salesOrders.id),
  payStatementId: varchar("pay_statement_id").references(() => payStatements.id),
  chargebackId: varchar("chargeback_id").references(() => chargebacks.id),
  description: text("description").notNull(),
  processedByUserId: varchar("processed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("reserve_txn_reserve_id_idx").on(table.reserveId),
  index("reserve_txn_user_id_idx").on(table.userId),
  index("reserve_txn_type_idx").on(table.transactionType),
  index("reserve_txn_order_id_idx").on(table.salesOrderId),
  index("reserve_txn_chargeback_id_idx").on(table.chargebackId),
]);

export const reserveTransactionsRelations = relations(reserveTransactions, ({ one }) => ({
  reserve: one(rollingReserves, { fields: [reserveTransactions.reserveId], references: [rollingReserves.id] }),
  user: one(users, { fields: [reserveTransactions.userId], references: [users.id] }),
  salesOrder: one(salesOrders, { fields: [reserveTransactions.salesOrderId], references: [salesOrders.id] }),
  chargeback: one(chargebacks, { fields: [reserveTransactions.chargebackId], references: [chargebacks.id] }),
  payStatement: one(payStatements, { fields: [reserveTransactions.payStatementId], references: [payStatements.id] }),
  processedBy: one(users, { fields: [reserveTransactions.processedByUserId], references: [users.id] }),
}));

export const insertReserveTransactionSchema = createInsertSchema(reserveTransactions).omit({
  id: true, createdAt: true,
});
export type ReserveTransaction = typeof reserveTransactions.$inferSelect;
export type InsertReserveTransaction = z.infer<typeof insertReserveTransactionSchema>;

export const systemExceptions = pgTable("system_exceptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  exceptionType: varchar("exception_type").notNull(),
  severity: varchar("severity").notNull().default("WARNING"),
  title: text("title").notNull(),
  detail: text("detail"),
  relatedUserId: varchar("related_user_id").references(() => users.id),
  relatedEntityId: varchar("related_entity_id"),
  relatedEntityType: varchar("related_entity_type"),
  status: varchar("status").notNull().default("OPEN"),
  resolvedByUserId: varchar("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("sys_exc_type_idx").on(table.exceptionType),
  index("sys_exc_status_idx").on(table.status),
  index("sys_exc_user_idx").on(table.relatedUserId),
]);

export const systemExceptionsRelations = relations(systemExceptions, ({ one }) => ({
  relatedUser: one(users, { fields: [systemExceptions.relatedUserId], references: [users.id] }),
  resolvedBy: one(users, { fields: [systemExceptions.resolvedByUserId], references: [users.id] }),
}));

export const insertSystemExceptionSchema = createInsertSchema(systemExceptions).omit({
  id: true, createdAt: true, resolvedByUserId: true, resolvedAt: true, resolutionNote: true,
});
export type SystemException = typeof systemExceptions.$inferSelect;
export type InsertSystemException = z.infer<typeof insertSystemExceptionSchema>;

export const exceptionDismissals = pgTable("exception_dismissals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  exceptionType: varchar("exception_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  dismissedByUserId: varchar("dismissed_by_user_id").notNull().references(() => users.id),
  reason: text("reason"),
  snoozedUntil: timestamp("snoozed_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("exc_dismiss_type_entity_idx").on(table.exceptionType, table.entityId),
  index("exc_dismiss_user_idx").on(table.dismissedByUserId),
]);

export const exceptionDismissalsRelations = relations(exceptionDismissals, ({ one }) => ({
  dismissedBy: one(users, { fields: [exceptionDismissals.dismissedByUserId], references: [users.id] }),
}));

export const insertExceptionDismissalSchema = createInsertSchema(exceptionDismissals).omit({
  id: true, createdAt: true,
});
export type ExceptionDismissal = typeof exceptionDismissals.$inferSelect;
export type InsertExceptionDismissal = z.infer<typeof insertExceptionDismissalSchema>;

export const carrierProfiles = pgTable("carrier_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  providerId: varchar("provider_id").references(() => providers.id),
  columnMapping: text("column_mapping").notNull().default("{}"),
  speedTierMap: text("speed_tier_map").notNull().default("{}"),
  statusCodeMap: text("status_code_map").notNull().default("{}"),
  signatureHeaders: text("signature_headers").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCarrierProfileSchema = createInsertSchema(carrierProfiles).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type CarrierProfile = typeof carrierProfiles.$inferSelect;
export type InsertCarrierProfile = z.infer<typeof insertCarrierProfileSchema>;

export const carrierRepMappings = pgTable("carrier_rep_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  carrierProfileId: varchar("carrier_profile_id").notNull().references(() => carrierProfiles.id),
  salesmanNbr: text("salesman_nbr").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("crm_carrier_salesman_idx").on(table.carrierProfileId, table.salesmanNbr),
  unique("crm_carrier_salesman_unique").on(table.carrierProfileId, table.salesmanNbr),
]);

export const insertCarrierRepMappingSchema = createInsertSchema(carrierRepMappings).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type CarrierRepMapping = typeof carrierRepMappings.$inferSelect;
export type InsertCarrierRepMapping = z.infer<typeof insertCarrierRepMappingSchema>;

export const carryForwardBalances = pgTable("carry_forward_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  amountCents: integer("amount_cents").notNull(),
  remainingAmountCents: integer("remaining_amount_cents").notNull(),
  originPayRunId: varchar("origin_pay_run_id").notNull().references(() => payRuns.id),
  originPayStatementId: varchar("origin_pay_statement_id").notNull().references(() => payStatements.id),
  status: varchar("status", { length: 20 }).notNull().default("PENDING"),
  resolvedPayStatementId: varchar("resolved_pay_statement_id").references(() => payStatements.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("cf_bal_user_id_idx").on(table.userId),
  index("cf_bal_status_idx").on(table.status),
  index("cf_bal_origin_payrun_idx").on(table.originPayRunId),
]);

export const carryForwardBalancesRelations = relations(carryForwardBalances, ({ one }) => ({
  user: one(users, { fields: [carryForwardBalances.userId], references: [users.id] }),
  originPayRun: one(payRuns, { fields: [carryForwardBalances.originPayRunId], references: [payRuns.id] }),
  originPayStatement: one(payStatements, { fields: [carryForwardBalances.originPayStatementId], references: [payStatements.id] }),
}));

export const insertCarryForwardBalanceSchema = createInsertSchema(carryForwardBalances).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type CarryForwardBalance = typeof carryForwardBalances.$inferSelect;
export type InsertCarryForwardBalance = z.infer<typeof insertCarryForwardBalanceSchema>;

export const compPlanColumnEnum = pgEnum("comp_plan_column", [
  "REP_B", "LEADER_C", "MANAGER_D", "DIRECTOR_E",
  "OPERATIONS_F", "ACCOUNTING_G", "EXECUTIVE_H",
  "IC_PROFIT_I", "ELEVATED_J"
]);

export const compPlanRates = pgTable("comp_plan_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceId: varchar("service_id").references(() => services.id),
  providerId: varchar("provider_id").references(() => providers.id),
  clientId: varchar("client_id").references(() => clients.id),
  speedTierLabel: varchar("speed_tier_label", { length: 100 }),
  repRateCents: integer("rep_rate_cents").notNull().default(0),
  leaderRateCents: integer("leader_rate_cents").notNull().default(0),
  managerRateCents: integer("manager_rate_cents").notNull().default(0),
  directorOverrideCents: integer("director_override_cents").notNull().default(0),
  operationsOverrideCents: integer("operations_override_cents").notNull().default(0),
  accountingOverrideCents: integer("accounting_override_cents").notNull().default(0),
  executivePayCents: integer("executive_pay_cents").notNull().default(0),
  icProfitCents: integer("ic_profit_cents").notNull().default(0),
  elevatedPersonalSalesCents: integer("elevated_personal_sales_cents").notNull().default(0),
  effectiveStart: date("effective_start").notNull(),
  effectiveEnd: date("effective_end"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("cpr_service_id_idx").on(table.serviceId),
  index("cpr_provider_id_idx").on(table.providerId),
]);

export const compPlanRatesRelations = relations(compPlanRates, ({ one }) => ({
  service: one(services, { fields: [compPlanRates.serviceId], references: [services.id] }),
  provider: one(providers, { fields: [compPlanRates.providerId], references: [providers.id] }),
  client: one(clients, { fields: [compPlanRates.clientId], references: [clients.id] }),
}));

export const insertCompPlanRateSchema = createInsertSchema(compPlanRates).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type CompPlanRate = typeof compPlanRates.$inferSelect;
export type InsertCompPlanRate = z.infer<typeof insertCompPlanRateSchema>;

// System Settings table - configurable key/value pairs for system-level settings
export const overrideRuleTypeEnum = pgEnum("override_rule_type", [
  "DIRECTOR_OVERRIDE", "MANAGER_OVERRIDE", "OPERATIONS_OVERRIDE",
  "ACCOUNTING_OVERRIDE", "LEADER_OVERRIDE", "CUSTOM"
]);

export const commissionOverrideRules = pgTable("commission_override_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleName: varchar("rule_name", { length: 200 }).notNull(),
  recipientUserId: varchar("recipient_user_id").references(() => users.id),
  recipientRole: userRoleEnum("recipient_role"),
  overrideType: overrideRuleTypeEnum("override_type").notNull(),
  overrideColumn: varchar("override_column", { length: 10 }).notNull(),
  flatAmountCents: integer("flat_amount_cents"),
  useCompPlanColumn: boolean("use_comp_plan_column").notNull().default(true),
  minSpeedMbps: integer("min_speed_mbps"),
  excludeOwnerSales: boolean("exclude_owner_sales").notNull().default(false),
  excludeSelfSales: boolean("exclude_self_sales").notNull().default(false),
  excludeOwnTeamSales: boolean("exclude_own_team_sales").notNull().default(false),
  reducedAmountReps: jsonb("reduced_amount_reps"),
  excludeRepIds: jsonb("exclude_rep_ids"),
  includeRepIds: jsonb("include_rep_ids"),
  includeOwnerSales: boolean("include_owner_sales").notNull().default(false),
  appliesToAllSales: boolean("applies_to_all_sales").notNull().default(false),
  active: boolean("active").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const commissionOverrideRulesRelations = relations(commissionOverrideRules, ({ one }) => ({
  recipientUser: one(users, { fields: [commissionOverrideRules.recipientUserId], references: [users.id] }),
}));

export const insertCommissionOverrideRuleSchema = createInsertSchema(commissionOverrideRules).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type CommissionOverrideRule = typeof commissionOverrideRules.$inferSelect;
export type InsertCommissionOverrideRule = z.infer<typeof insertCommissionOverrideRuleSchema>;

// Match Corrections - learning records from manual match/unmatch/ignore actions
export const matchCorrectionTypeEnum = pgEnum("match_correction_type", ["MANUAL_MATCH", "MANUAL_UNMATCH", "MANUAL_IGNORE"]);

export const matchCorrections = pgTable("match_corrections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  financeImportId: varchar("finance_import_id").notNull().references(() => financeImports.id),
  financeImportRowId: varchar("finance_import_row_id").notNull().references(() => financeImportRows.id),
  correctionType: matchCorrectionTypeEnum("correction_type").notNull(),
  originalMatchedOrderId: varchar("original_matched_order_id").references(() => salesOrders.id),
  correctedMatchedOrderId: varchar("corrected_matched_order_id").references(() => salesOrders.id),
  scoreAtCorrection: integer("score_at_correction"),
  nameOverlapScore: integer("name_overlap_score"),
  dateDiffDays: integer("date_diff_days"),
  amountDiffCents: integer("amount_diff_cents"),
  correctedByUserId: varchar("corrected_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("mc_import_id_idx").on(table.financeImportId),
  index("mc_row_id_idx").on(table.financeImportRowId),
]);

export const matchCorrectionsRelations = relations(matchCorrections, ({ one }) => ({
  financeImport: one(financeImports, { fields: [matchCorrections.financeImportId], references: [financeImports.id] }),
  financeImportRow: one(financeImportRows, { fields: [matchCorrections.financeImportRowId], references: [financeImportRows.id] }),
  originalMatchedOrder: one(salesOrders, { fields: [matchCorrections.originalMatchedOrderId], references: [salesOrders.id], relationName: "originalMatch" }),
  correctedMatchedOrder: one(salesOrders, { fields: [matchCorrections.correctedMatchedOrderId], references: [salesOrders.id], relationName: "correctedMatch" }),
  correctedBy: one(users, { fields: [matchCorrections.correctedByUserId], references: [users.id] }),
}));

export const insertMatchCorrectionSchema = createInsertSchema(matchCorrections).omit({
  id: true, createdAt: true,
});
export type MatchCorrection = typeof matchCorrections.$inferSelect;
export type InsertMatchCorrection = z.infer<typeof insertMatchCorrectionSchema>;

// Finance Import Schedules - recurring import configuration per client
export const financeImportScheduleFrequencyEnum = pgEnum("finance_import_frequency", ["DAILY", "WEEKLY", "MONTHLY"]);

export const financeImportSchedules = pgTable("finance_import_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  frequency: financeImportScheduleFrequencyEnum("frequency").notNull().default("MONTHLY"),
  dayOfMonth: integer("day_of_month"),
  dayOfWeek: integer("day_of_week"),
  expectedByDaysAfterPeriod: integer("expected_by_days_after_period").notNull().default(7),
  emailToWatch: text("email_to_watch"),
  sftpPath: text("sftp_path"),
  lastImportedAt: timestamp("last_import_at"),
  nextExpectedAt: timestamp("next_expected_at"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("fis_client_id_idx").on(table.clientId),
  index("fis_active_idx").on(table.isActive),
]);

export const financeImportSchedulesRelations = relations(financeImportSchedules, ({ one }) => ({
  client: one(clients, { fields: [financeImportSchedules.clientId], references: [clients.id] }),
  createdBy: one(users, { fields: [financeImportSchedules.createdByUserId], references: [users.id] }),
}));

export const insertFinanceImportScheduleSchema = createInsertSchema(financeImportSchedules).omit({
  id: true, createdAt: true, updatedAt: true, lastImportedAt: true, nextExpectedAt: true,
});
export type FinanceImportSchedule = typeof financeImportSchedules.$inferSelect;
export type InsertFinanceImportSchedule = z.infer<typeof insertFinanceImportScheduleSchema>;

// Automation Rules
export const automationRuleTypeEnum = pgEnum("automation_rule_type", [
  "AUTO_APPROVE_ORDER",
  "AUTO_POST_IMPORT",
  "AUTO_PAYROLL_READY",
  "ALERT_ON_EXCEPTION",
  "ESCALATE_AFTER_DAYS",
]);

export const automationRules = pgTable("automation_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  ruleType: automationRuleTypeEnum("rule_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  conditions: jsonb("conditions").notNull().default([]),
  actions: jsonb("actions").notNull().default([]),
  lastTriggeredAt: timestamp("last_triggered_at"),
  triggerCount: integer("trigger_count").notNull().default(0),
  lastError: text("last_error"),
  createdByUserId: varchar("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const automationRulesRelations = relations(automationRules, ({ one }) => ({
  createdBy: one(users, { fields: [automationRules.createdByUserId], references: [users.id] }),
}));

export const insertAutomationRuleSchema = createInsertSchema(automationRules).omit({
  id: true, createdAt: true, updatedAt: true, lastTriggeredAt: true, triggerCount: true, lastError: true,
}).extend({
  conditions: z.array(z.object({
    field: z.string(),
    op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })).default([]),
  actions: z.array(z.object({
    type: z.string(),
  }).passthrough()).default([]),
});
export type AutomationRule = typeof automationRules.$inferSelect;
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;

// System Settings - key/value store for configurable application settings
export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedByUserId: varchar("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  updatedBy: one(users, { fields: [systemSettings.updatedByUserId], references: [users.id] }),
}));

export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;

export const savedReports = pgTable("saved_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  reportType: varchar("report_type", { length: 100 }).notNull(),
  paramsJson: jsonb("params_json"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id),
  isShared: boolean("is_shared").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("sr_created_by_idx").on(table.createdByUserId),
  index("sr_report_type_idx").on(table.reportType),
]);

export const savedReportsRelations = relations(savedReports, ({ one }) => ({
  createdBy: one(users, { fields: [savedReports.createdByUserId], references: [users.id] }),
}));

export const insertSavedReportSchema = createInsertSchema(savedReports).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type SavedReport = typeof savedReports.$inferSelect;
export type InsertSavedReport = z.infer<typeof insertSavedReportSchema>;

// Customer Referrals - reps log referrals from existing customers
export const customerReferrals = pgTable("customer_referrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: text("rep_id").notNull(),
  referrerOrderId: varchar("referrer_order_id").references(() => salesOrders.id),
  referrerName: text("referrer_name").notNull(),
  referrerPhone: text("referrer_phone"),
  referredName: text("referred_name").notNull(),
  referredPhone: text("referred_phone"),
  referredAddress: text("referred_address"),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).notNull().default("PENDING"),
  convertedOrderId: varchar("converted_order_id").references(() => salesOrders.id),
  convertedAt: timestamp("converted_at"),
  referralDate: date("referral_date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const customerReferralsRelations = relations(customerReferrals, ({ one }) => ({
  referrerOrder: one(salesOrders, { fields: [customerReferrals.referrerOrderId], references: [salesOrders.id], relationName: "referrerOrder" }),
  convertedOrder: one(salesOrders, { fields: [customerReferrals.convertedOrderId], references: [salesOrders.id], relationName: "convertedOrder" }),
}));

export const insertCustomerReferralSchema = createInsertSchema(customerReferrals).omit({
  id: true, createdAt: true, updatedAt: true, convertedAt: true, convertedOrderId: true,
});
export type CustomerReferral = typeof customerReferrals.$inferSelect;
export type InsertCustomerReferral = z.infer<typeof insertCustomerReferralSchema>;

// Post-Install Follow-Ups - reps schedule check-in reminders after customer installations
export const postInstallFollowUps = pgTable("post_install_follow_ups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repId: text("rep_id").notNull(),
  orderId: varchar("order_id").references(() => salesOrders.id),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  followUpDate: date("follow_up_date").notNull(),
  followUpType: varchar("follow_up_type", { length: 30 }).notNull().default("SATISFACTION_CALL"),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).notNull().default("SCHEDULED"),
  completedAt: timestamp("completed_at"),
  completionNotes: text("completion_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const postInstallFollowUpsRelations = relations(postInstallFollowUps, ({ one }) => ({
  order: one(salesOrders, { fields: [postInstallFollowUps.orderId], references: [salesOrders.id] }),
}));

export const insertPostInstallFollowUpSchema = createInsertSchema(postInstallFollowUps).omit({
  id: true, createdAt: true, updatedAt: true, completedAt: true, completionNotes: true,
});
export type PostInstallFollowUp = typeof postInstallFollowUps.$inferSelect;
export type InsertPostInstallFollowUp = z.infer<typeof insertPostInstallFollowUpSchema>;

export const repMessageCategoryEnum = pgEnum("rep_message_category", ["COMMISSION_INQUIRY", "PAY_QUESTION", "GENERAL", "SCHEDULE", "COMPLIANCE"]);

export const repMessages = pgTable("rep_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromUserId: varchar("from_user_id").notNull().references(() => users.id),
  toUserId: varchar("to_user_id").notNull().references(() => users.id),
  parentMessageId: varchar("parent_message_id"),
  category: repMessageCategoryEnum("category").notNull().default("GENERAL"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  relatedEntityType: varchar("related_entity_type", { length: 30 }),
  relatedEntityId: varchar("related_entity_id"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const repMessagesRelations = relations(repMessages, ({ one }) => ({
  fromUser: one(users, { fields: [repMessages.fromUserId], references: [users.id], relationName: "sentMessages" }),
  toUser: one(users, { fields: [repMessages.toUserId], references: [users.id], relationName: "receivedMessages" }),
}));

export const insertRepMessageSchema = createInsertSchema(repMessages).omit({
  id: true, createdAt: true, isRead: true, readAt: true,
});
export type RepMessage = typeof repMessages.$inferSelect;
export type InsertRepMessage = z.infer<typeof insertRepMessageSchema>;
