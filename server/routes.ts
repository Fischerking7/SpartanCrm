import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { eq, and, sql, gte, lte, inArray, isNull, ne, asc, or } from "drizzle-orm";
import { users, providers, clients, services, rateCards, salesOrders, payStatements, payStatementDeductions, leads } from "@shared/schema";
import { authMiddleware, generateToken, hashPassword, comparePassword, adminOnly, executiveOrAdmin, managerOrAdmin, supervisorOrAbove, type AuthRequest } from "./auth";
import { loginSchema, insertUserSchema, insertProviderSchema, insertClientSchema, insertServiceSchema, insertRateCardSchema, insertSalesOrderSchema, insertIncentiveSchema, insertAdjustmentSchema, insertPayRunSchema, insertChargebackSchema, insertOverrideAgreementSchema, insertKnowledgeDocumentSchema, insertMduStagingOrderSchema, leadDispositions, dispositionToPipelineStage, terminalDispositions, dispositionMetadata, type LeadDisposition, type SalesOrder, type OverrideEarning, type User, type Provider, type Client, type MduStagingOrder } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import crypto from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import rateLimit from "express-rate-limit";
import { encryptSsn, decryptSsn, extractSsnLast4, maskSsn } from "./encryption";

// Rate limiter for auth endpoints (10 attempts per 15 minutes per IP)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: { message: "Too many login attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  // Use default keyGenerator which properly handles IPv6
  validate: { xForwardedForHeader: false },
});

// File upload validation constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROW_COUNT = 10000;
const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-excel", // xls
  "text/csv",
  "application/csv",
];

// Validate uploaded file and return parsed data
function validateFileUpload(file: Express.Multer.File | undefined, res: Response): { valid: false } | { valid: true; workbook: XLSX.WorkBook } {
  if (!file) {
    res.status(400).json({ message: "No file uploaded" });
    return { valid: false };
  }
  
  if (file.size > MAX_FILE_SIZE) {
    res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
    return { valid: false };
  }
  
  // Check MIME type (allow through if not detected, check by extension)
  const isExcel = file.originalname.toLowerCase().endsWith('.xlsx') || file.originalname.toLowerCase().endsWith('.xls');
  const isCsv = file.originalname.toLowerCase().endsWith('.csv');
  
  if (!isExcel && !isCsv) {
    res.status(415).json({ message: "Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed" });
    return { valid: false };
  }
  
  try {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    return { valid: true, workbook };
  } catch (error) {
    res.status(422).json({ message: "Failed to parse file. Please ensure it is a valid Excel or CSV file" });
    return { valid: false };
  }
}

// Validate row count after parsing
function validateRowCount(rows: any[], res: Response): boolean {
  if (rows.length > MAX_ROW_COUNT) {
    res.status(422).json({ message: `Too many rows. Maximum allowed is ${MAX_ROW_COUNT} rows` });
    return false;
  }
  return true;
}

// Field allowlists for update operations (prevents privilege escalation)
const USER_UPDATE_ALLOWLIST = ["name", "status", "assignedSupervisorId", "assignedManagerId", "assignedExecutiveId"] as const;
const ORDER_UPDATE_ALLOWLIST = ["customerName", "customerAddress", "customerPhone", "customerEmail", "installDate", "accountNumber", "notes"] as const;

// Pick only allowed fields from an object
function pickAllowedFields<T extends Record<string, any>>(obj: T, allowlist: readonly string[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of allowlist) {
    if (key in obj) {
      result[key as keyof T] = obj[key];
    }
  }
  return result;
}

// Role hierarchy for authority comparisons (higher number = more authority)
const ROLE_HIERARCHY: Record<string, number> = {
  REP: 1,
  SUPERVISOR: 2,
  MANAGER: 3,
  EXECUTIVE: 4,
  ADMIN: 5,
  OPERATIONS: 6,
};

// Generate secure temporary password
function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16);
}

// Check if actor can reset target's password based on PASSWORD AUTHORITY rules
async function checkPasswordAuthority(actor: User, target: User): Promise<boolean> {
  // Rule 1: OPERATIONS can reset any password
  if (actor.role === "OPERATIONS") {
    return true;
  }
  
  // Rule 2: ADMIN can reset any password except OPERATIONS
  if (actor.role === "ADMIN") {
    return target.role !== "OPERATIONS";
  }
  
  // Rule 3: MANAGER can reset passwords for their supervisors and reps in their org tree
  if (actor.role === "MANAGER") {
    // Cannot reset Executives, Admins, Founders, or other Managers
    if (["EXECUTIVE", "ADMIN", "OPERATIONS", "MANAGER"].includes(target.role)) {
      return false;
    }
    // Check if target is in manager's org tree
    const scope = await storage.getManagerScope(actor.id);
    if (target.role === "SUPERVISOR") {
      // Check if supervisor is assigned to this manager
      return target.assignedManagerId === actor.id;
    }
    if (target.role === "REP") {
      // Check if rep is in manager's org tree (direct or indirect)
      return scope.allRepRepIds.includes(target.repId);
    }
    return false;
  }
  
  // Rule 4: SUPERVISOR can reset passwords only for their assigned reps
  if (actor.role === "SUPERVISOR") {
    if (target.role !== "REP") {
      return false;
    }
    // Check if rep is directly assigned to this supervisor
    return target.assignedSupervisorId === actor.id;
  }
  
  // Rule 5: REP cannot reset anyone else's password (only their own via self-service)
  return false;
}

async function generateOverrideEarnings(originalOrder: SalesOrder, approvedOrder: SalesOrder): Promise<OverrideEarning[]> {
  // Check if override earnings already exist for this order to prevent duplicates
  const existingEarnings = await storage.getOverrideEarningsByOrder(approvedOrder.id);
  if (existingEarnings.length > 0) {
    return existingEarnings; // Already generated, return existing
  }
  
  // Executives do not have overrides applied to their sales
  const salesRep = await storage.getUserByRepId(approvedOrder.repId);
  if (salesRep?.role === "EXECUTIVE") {
    return []; // No overrides for executive sales
  }
  
  const earnings: OverrideEarning[] = [];
  
  // --- RATE CARD OVERRIDE DEDUCTIONS (BASE/INTERNET & TV) ---
  // Pool override deductions from rate cards (distributed later during export)
  // Check if pool entries already exist for this order to prevent duplicates
  const existingPoolEntries = await storage.getOverrideDeductionPoolByOrderId(approvedOrder.id);
  const existingPoolKeys = new Set(existingPoolEntries.map(e => `${e.rateCardId}-${e.deductionType}`));
  
  const commissionLineItems = await storage.getCommissionLineItemsByOrderId(approvedOrder.id);
  const usedRateCardIds = new Set<string>();
  
  for (const lineItem of commissionLineItems) {
    if (lineItem.appliedRateCardId && !usedRateCardIds.has(lineItem.appliedRateCardId)) {
      const rateCard = await storage.getRateCardById(lineItem.appliedRateCardId);
      if (rateCard) {
        // Pool base/internet override deduction (always applies)
        const baseDeduction = parseFloat(rateCard.overrideDeduction || "0");
        const baseKey = `${rateCard.id}-BASE`;
        if (baseDeduction > 0 && !existingPoolKeys.has(baseKey)) {
          await storage.createOverrideDeductionPoolEntry({
            salesOrderId: approvedOrder.id,
            rateCardId: rateCard.id,
            amount: baseDeduction.toFixed(2),
            deductionType: "BASE",
            status: "PENDING",
          });
        }
        
        // Pool TV override deduction (only if tvSold is true)
        const tvDeduction = parseFloat(rateCard.tvOverrideDeduction || "0");
        const tvKey = `${rateCard.id}-TV`;
        if (tvDeduction > 0 && approvedOrder.tvSold && !existingPoolKeys.has(tvKey)) {
          await storage.createOverrideDeductionPoolEntry({
            salesOrderId: approvedOrder.id,
            rateCardId: rateCard.id,
            amount: tvDeduction.toFixed(2),
            deductionType: "TV",
            status: "PENDING",
          });
        }
        
        // Pool mobile override deduction (only if mobileSold is true)
        const mobileDeduction = parseFloat((rateCard as any).mobileOverrideDeduction || "0");
        const mobileKey = `${rateCard.id}-MOBILE`;
        if (mobileDeduction > 0 && approvedOrder.mobileSold && !existingPoolKeys.has(mobileKey)) {
          await storage.createOverrideDeductionPoolEntry({
            salesOrderId: approvedOrder.id,
            rateCardId: rateCard.id,
            amount: mobileDeduction.toFixed(2),
            deductionType: "MOBILE",
            status: "PENDING",
          });
        }
        
        usedRateCardIds.add(lineItem.appliedRateCardId);
      }
    }
  }
  
  // Get hierarchy for the rep who made the sale
  const hierarchy = await storage.getRepHierarchy(approvedOrder.repId);
  
  // --- OVERRIDE AGREEMENTS (legacy/additional) ---
  // Fetch mobile line items for per-line override calculation
  const mobileLines = await storage.getMobileLineItemsByOrderId(approvedOrder.id);
  
  // Base order filter
  const baseOrderFilter = { 
    providerId: approvedOrder.providerId, 
    clientId: approvedOrder.clientId, 
    serviceId: approvedOrder.serviceId,
    tvSold: approvedOrder.tvSold,
  };
  
  // Get mobile product types from order
  const mobileProductTypes = mobileLines.length > 0 
    ? Array.from(new Set(mobileLines.map(l => l.mobileProductType))) 
    : (approvedOrder.mobileProductType ? [approvedOrder.mobileProductType] : []);
  
  // Helper: Process agreements for a recipient based on hierarchy
  const processAgreements = async (recipientUserId: string, recipientRole: string) => {
    // Process non-mobile agreements first
    const nonMobileAgreements = await storage.getActiveOverrideAgreements(
      recipientUserId, 
      approvedOrder.dateSold, 
      { ...baseOrderFilter, mobileProductType: null }
    );
    
    for (const agreement of nonMobileAgreements) {
      const earning = await storage.createOverrideEarning({
        salesOrderId: approvedOrder.id,
        recipientUserId,
        sourceRepId: approvedOrder.repId,
        sourceLevelUsed: recipientRole as any,
        amount: agreement.amountFlat,
        overrideAgreementId: agreement.id,
      });
      earnings.push(earning);
    }
    
    // Process mobile-specific agreements for each product type and ported status combination
    const portedStatuses = mobileLines.length > 0 
      ? Array.from(new Set(mobileLines.map(l => l.mobilePortedStatus)))
      : (approvedOrder.mobilePortedStatus ? [approvedOrder.mobilePortedStatus] : [null]);
    
    for (const mobileType of mobileProductTypes) {
      for (const portedStatus of portedStatuses) {
        const mobileAgreements = await storage.getActiveOverrideAgreements(
          recipientUserId, 
          approvedOrder.dateSold, 
          { ...baseOrderFilter, mobileProductType: mobileType, mobilePortedStatus: portedStatus }
        );
        
        for (const agreement of mobileAgreements) {
          // Count matching lines for this product type and ported status
          const matchingLines = mobileLines.filter(l => 
            l.mobileProductType === mobileType && 
            (!agreement.mobilePortedFilter || l.mobilePortedStatus === agreement.mobilePortedFilter)
          );
          const lineCount = matchingLines.length || 1;
          const totalAmount = (parseFloat(agreement.amountFlat) * lineCount).toFixed(2);
          
          const earning = await storage.createOverrideEarning({
            salesOrderId: approvedOrder.id,
            recipientUserId,
            sourceRepId: approvedOrder.repId,
            sourceLevelUsed: recipientRole as any,
            amount: totalAmount,
            overrideAgreementId: agreement.id,
          });
          earnings.push(earning);
        }
      }
    }
  };
  
  // Supervisor gets override on their assigned reps' sales
  if (hierarchy.supervisor) {
    await processAgreements(hierarchy.supervisor.id, "SUPERVISOR");
  }
  
  // Manager gets override on their supervised reps and supervisors' sales
  if (hierarchy.manager) {
    await processAgreements(hierarchy.manager.id, "MANAGER");
  }
  
  // Executive gets override on everyone in their division
  if (hierarchy.executive) {
    await processAgreements(hierarchy.executive.id, "EXECUTIVE");
  }
  
  // ADMIN gets override on all sales company-wide
  const admins = await storage.getUsers();
  const activeAdmins = admins.filter(u => u.role === "ADMIN" && u.status === "ACTIVE" && !u.deletedAt);
  for (const admin of activeAdmins) {
    await processAgreements(admin.id, "ADMIN");
  }

  return earnings;
}

// Bootstrap OPERATIONS user on first run
async function bootstrapFounder(): Promise<void> {
  try {
    // Check if any OPERATIONS exists
    const founders = await storage.getUsersByRole("OPERATIONS");
    if (founders.length > 0) {
      console.log("OPERATIONS user already exists, skipping bootstrap");
      return;
    }
    
    // Check env vars
    const repId = process.env.BOOTSTRAP_OPERATIONS_REPID;
    const password = process.env.BOOTSTRAP_OPERATIONS_PASSWORD;
    const name = process.env.BOOTSTRAP_OPERATIONS_NAME || "System Founder";
    
    if (!repId || !password) {
      console.log("BOOTSTRAP_OPERATIONS_REPID and BOOTSTRAP_OPERATIONS_PASSWORD env vars not set, skipping founder bootstrap");
      return;
    }
    
    // Check if repId already exists (from a previous partial bootstrap)
    const existingUser = await storage.getUserByRepId(repId);
    if (existingUser) {
      console.log(`User with repId '${repId}' already exists, skipping founder bootstrap`);
      return;
    }
    
    // Create OPERATIONS user
    const hashedPassword = await hashPassword(password);
    await storage.createUser({
      name,
      repId,
      role: "OPERATIONS",
      status: "ACTIVE",
      passwordHash: hashedPassword,
    });
    
    console.log(`OPERATIONS user '${name}' created with repId '${repId}'`);
    
    // Log the bootstrap event
    await storage.createAuditLog({
      action: "OPERATIONS_BOOTSTRAP",
      tableName: "users",
      afterJson: JSON.stringify({ repId, name, role: "OPERATIONS" }),
      userId: null,
    });
  } catch (error) {
    console.error("Error bootstrapping founder:", error);
  }
}

// Bootstrap ADMIN user on first run
async function bootstrapAdmin(): Promise<void> {
  try {
    // Check env vars
    const repId = process.env.BOOTSTRAP_ADMIN_REPID;
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const name = process.env.BOOTSTRAP_ADMIN_NAME || "System Admin";
    
    if (!repId || !password) {
      console.log("BOOTSTRAP_ADMIN_REPID and BOOTSTRAP_ADMIN_PASSWORD env vars not set, skipping admin bootstrap");
      return;
    }
    
    // Check if this admin already exists
    const existingUser = await storage.getUserByRepId(repId);
    if (existingUser) {
      console.log(`ADMIN user with repId '${repId}' already exists, skipping bootstrap`);
      return;
    }
    
    // Create ADMIN user
    const hashedPassword = await hashPassword(password);
    await storage.createUser({
      name,
      repId,
      role: "ADMIN",
      status: "ACTIVE",
      passwordHash: hashedPassword,
    });
    
    console.log(`ADMIN user '${name}' created with repId '${repId}'`);
    
    // Log the bootstrap event
    await storage.createAuditLog({
      action: "ADMIN_BOOTSTRAP",
      tableName: "users",
      afterJson: JSON.stringify({ repId, name, role: "ADMIN" }),
      userId: null,
    });
  } catch (error) {
    console.error("Error bootstrapping admin:", error);
  }
}

// One-time migration to free up Rep IDs from deleted users
async function migrateDeletedUserRepIds(): Promise<void> {
  try {
    // Find deleted users whose repId hasn't been modified yet
    const deletedUsers = await db.query.users.findMany({
      where: and(
        sql`${users.deletedAt} IS NOT NULL`,
        sql`${users.repId} NOT LIKE '%_DELETED_%'`
      )
    });
    
    for (const user of deletedUsers) {
      const newRepId = `${user.repId}_DELETED_${Date.now()}`;
      await db.update(users).set({ repId: newRepId }).where(eq(users.id, user.id));
      console.log(`Migrated deleted user repId: ${user.repId} -> ${newRepId}`);
    }
    
    if (deletedUsers.length > 0) {
      console.log(`Freed up ${deletedUsers.length} Rep IDs from deleted users`);
    }
  } catch (error) {
    console.error("Error migrating deleted user Rep IDs:", error);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const auth = authMiddleware(db);
  
  // One-time migration to free up Rep IDs from deleted users
  await migrateDeletedUserRepIds();
  
  // Bootstrap OPERATIONS and ADMIN on first run
  await bootstrapFounder();
  await bootstrapAdmin();

  // Auth routes - with rate limiting
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input" });
      }
      const { repId, password } = parsed.data;
      const user = await storage.getUserByRepId(repId);
      if (!user || user.status !== "ACTIVE") {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const valid = await comparePassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Check if temporary password has expired
      if (user.tempPasswordExpiresAt && new Date() > new Date(user.tempPasswordExpiresAt)) {
        return res.status(401).json({ 
          message: "Temporary password expired. Contact your supervisor, manager, or admin.",
          code: "TEMP_PASSWORD_EXPIRED"
        });
      }
      
      const token = generateToken(user);
      await storage.createAuditLog({ action: "login", tableName: "users", recordId: user.id, userId: user.id });
      res.json({ 
        token, 
        user: { ...user, passwordHash: undefined },
        mustChangePassword: user.mustChangePassword
      });
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
    }
  });
  
  // Self-service password change
  app.put("/api/users/me/password", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }
      
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "New password must be at least 8 characters" });
      }
      
      // Verify current password
      const valid = await comparePassword(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }
      
      // Hash and update password
      const newHash = await hashPassword(newPassword);
      await storage.updateUserPassword(user.id, newHash);
      
      // Log the password change
      await storage.createAuditLog({
        action: "PASSWORD_CHANGED",
        tableName: "users",
        recordId: user.id,
        userId: user.id,
      });
      
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to change password" });
    }
  });
  
  // Admin/Manager/Supervisor password reset for target user (rate limited)
  app.post("/api/users/:id/password-reset", authLimiter, auth, async (req: AuthRequest, res) => {
    try {
      const actor = req.user!;
      const targetId = req.params.id;
      const target = await storage.getUserById(targetId);
      
      if (!target) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check password authority
      const authorized = await checkPasswordAuthority(actor, target);
      if (!authorized) {
        return res.status(403).json({ message: "You do not have permission to reset this user's password" });
      }
      
      // Generate temporary password
      const tempPassword = generateTempPassword();
      const hashedPassword = await hashPassword(tempPassword);
      
      // Calculate expiry (default 24 hours, configurable via RESET_TTL_HOURS)
      const ttlHours = parseInt(process.env.RESET_TTL_HOURS || "24", 10);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + ttlHours);
      
      // Update user with temp password
      await storage.setTempPassword(targetId, hashedPassword, expiresAt);
      
      // Log the reset
      await storage.createAuditLog({
        action: "PASSWORD_RESET_TEMP",
        tableName: "users",
        recordId: targetId,
        afterJson: JSON.stringify({ expiresAt: expiresAt.toISOString() }),
        userId: actor.id,
      });
      
      res.json({ 
        message: "Temporary password generated",
        tempPassword,
        expiresAt: expiresAt.toISOString(),
        expiresInHours: ttlHours
      });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  app.get("/api/auth/me", auth, async (req: AuthRequest, res) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    res.json({ user: { ...req.user, passwordHash: undefined } });
  });

  // Profile endpoints - users can view their own credentials and banking info (read-only)
  app.get("/api/profile/credentials", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const credentials = await storage.getEmployeeCredentialsByUser(user.id);
      // Mask sensitive fields for non-admin users viewing their own data
      const masked = credentials.map((c: any) => ({
        ...c,
        tempPassword: c.tempPassword ? "••••••••" : null,
        rtrPassword: c.rtrPassword ? "••••••••" : null,
        authenticatorPassword: c.authenticatorPassword ? "••••••••" : null,
        ipadPin: c.ipadPin ? "••••" : null,
        gmailPassword: c.gmailPassword ? "••••••••" : null,
      }));
      res.json(masked);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/profile/bank-accounts", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const accounts = await storage.getUserBankAccounts(user.id);
      // Return with masked account numbers (only last 4 visible)
      const masked = accounts.map(a => ({
        ...a,
        routingNumber: "•••••" + a.routingNumber.slice(-4),
        accountNumber: "•••••" + a.accountNumberLast4,
      }));
      res.json(masked);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Dashboard stats
  app.get("/api/dashboard/stats", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const orders = await storage.getOrders({ repId: user.repId });
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());

      const monthOrders = orders.filter(o => new Date(o.createdAt) >= monthStart);
      const earnedMTD = monthOrders.filter(o => o.approvalStatus === "APPROVED").reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      const paidMTD = monthOrders.filter(o => o.paidDate && new Date(o.paidDate) >= monthStart).reduce((sum, o) => sum + parseFloat(o.commissionPaid), 0);
      const weekOrders = orders.filter(o => o.paidDate && new Date(o.paidDate) >= weekStart);
      const paidWeek = weekOrders.reduce((sum, o) => sum + parseFloat(o.commissionPaid), 0);
      const pendingApproval = orders.filter(o => o.approvalStatus === "UNAPPROVED").length;
      const todayInstalls = orders.filter(o => o.installDate === now.toISOString().split("T")[0]).length;
      const outstanding = earnedMTD - paidMTD;

      res.json({ earnedMTD, paidMTD, paidWeek, chargebacksMTD: 0, outstanding, pendingApproval, todayInstalls });
    } catch (error) {
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  app.get("/api/dashboard/manager-stats", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const teamMembers = await storage.getTeamMembers(user.id);
      const teamRepIds = teamMembers.map(m => m.repId);
      if (user.role !== "ADMIN") teamRepIds.push(user.repId);
      
      const orders = await storage.getOrders({ teamRepIds });
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthOrders = orders.filter(o => new Date(o.createdAt) >= monthStart);
      
      const teamEarnedMTD = monthOrders.filter(o => o.approvalStatus === "APPROVED").reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      const teamPaidMTD = monthOrders.filter(o => o.paidDate && new Date(o.paidDate) >= monthStart).reduce((sum, o) => sum + parseFloat(o.commissionPaid), 0);
      const pendingApprovals = orders.filter(o => o.approvalStatus === "UNAPPROVED").length;

      res.json({ teamEarnedMTD, teamPaidMTD, pendingApprovals, teamSize: teamMembers.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  app.get("/api/dashboard/admin-stats", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getOrders({});
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthOrders = orders.filter(o => new Date(o.createdAt) >= monthStart);
      
      const totalEarnedMTD = monthOrders.filter(o => o.approvalStatus === "APPROVED").reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      const totalPaidMTD = monthOrders.filter(o => o.paidDate && new Date(o.paidDate) >= monthStart).reduce((sum, o) => sum + parseFloat(o.commissionPaid), 0);
      const pendingApprovals = orders.filter(o => o.approvalStatus === "UNAPPROVED").length;
      
      const users = await storage.getUsers();
      const activeReps = users.filter(u => u.role === "REP" && u.status === "ACTIVE").length;
      
      const unmatchedPayments = (await storage.getUnmatchedPayments()).filter(p => !p.resolvedAt).length;
      const unmatchedChargebacks = (await storage.getUnmatchedChargebacks()).filter(c => !c.resolvedAt).length;
      const rateIssues = (await storage.getRateIssues()).filter(r => !r.resolvedAt).length;
      const pendingAdjustments = (await storage.getAdjustments()).filter(a => a.approvalStatus === "UNAPPROVED").length;

      res.json({ totalEarnedMTD, totalPaidMTD, pendingApprovals, activeReps, unmatchedPayments, unmatchedChargebacks, rateIssues, pendingAdjustments });
    } catch (error) {
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  // Production aggregation endpoint for hierarchical dashboards
  app.get("/api/dashboard/production", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const cadence = (req.query.cadence as "DAY" | "WEEK" | "MONTH") || "WEEK";
      // Only SUPERVISOR, MANAGER, EXECUTIVE, ADMIN can use this endpoint
      if (!["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ADMIN gets EXECUTIVE-level access to the production dashboard
      const effectiveRole = user.role === "ADMIN" ? "EXECUTIVE" : user.role as "SUPERVISOR" | "MANAGER" | "EXECUTIVE";
      
      const result = await storage.getProductionAggregation(user.id, effectiveRole, cadence);
      res.json(result);
    } catch (error) {
      console.error("Production aggregation error:", error);
      res.status(500).json({ message: "Failed to get production data" });
    }
  });

  // Production aggregation with filters (for Manager dashboard)
  app.get("/api/dashboard/production/filtered", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const cadence = (req.query.cadence as "DAY" | "WEEK" | "MONTH") || "WEEK";
      const supervisorId = req.query.supervisorId as string | undefined;
      const repId = req.query.repId as string | undefined;
      const providerId = req.query.providerId as string | undefined;
      
      // Only MANAGER or higher can use filtered endpoint
      if (!["MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const result = await storage.getFilteredProductionAggregation(user.id, cadence, { supervisorId, repId, providerId });
      res.json(result);
    } catch (error) {
      console.error("Filtered production aggregation error:", error);
      res.status(500).json({ message: "Failed to get filtered production data" });
    }
  });

  // Get manager production for executive drill-down
  app.get("/api/dashboard/production/manager/:managerId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const managerId = req.params.managerId;
      const cadence = (req.query.cadence as "DAY" | "WEEK" | "MONTH") || "WEEK";
      
      // Only EXECUTIVE, ADMIN, OPERATIONS can drill into manager data
      if (!["EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Verify executive has access to this manager
      if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        if (!scope.managerIds.includes(managerId)) {
          return res.status(403).json({ message: "Manager not in your scope" });
        }
      }
      
      const result = await storage.getProductionAggregation(managerId, "MANAGER", cadence);
      res.json(result);
    } catch (error) {
      console.error("Manager drill-down error:", error);
      res.status(500).json({ message: "Failed to get manager production data" });
    }
  });

  // Production & Earnings Summary endpoint
  app.get("/api/dashboard/summary", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const role = user.role;
      
      // America/New_York timezone calculations
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      
      // Weekly: Monday-Sunday (current week)
      const dayOfWeek = nyNow.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const weekStart = new Date(nyNow);
      weekStart.setDate(nyNow.getDate() + mondayOffset);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      
      // Prior week
      const priorWeekStart = new Date(weekStart);
      priorWeekStart.setDate(weekStart.getDate() - 7);
      const priorWeekEnd = new Date(weekEnd);
      priorWeekEnd.setDate(weekEnd.getDate() - 7);
      
      // MTD: 1st of month through today
      const mtdStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1);
      const mtdEnd = new Date(nyNow);
      
      // Prior MTD: same day range in prior month
      const priorMtdStart = new Date(nyNow.getFullYear(), nyNow.getMonth() - 1, 1);
      const priorMtdEnd = new Date(nyNow.getFullYear(), nyNow.getMonth() - 1, Math.min(nyNow.getDate(), new Date(nyNow.getFullYear(), nyNow.getMonth(), 0).getDate()));
      
      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      
      // Get rep IDs for personal and team scopes
      const personalRepIds = await storage.getRepIdsForScope(user.id, role, "personal");
      const teamRepIds = role !== "REP" ? await storage.getRepIdsForScope(user.id, role, "team") : [];
      
      // Personal metrics
      const personalWeekly = await storage.getProductionMetrics(personalRepIds, formatDate(weekStart), formatDate(weekEnd));
      const personalWeeklyPrior = await storage.getProductionMetrics(personalRepIds, formatDate(priorWeekStart), formatDate(priorWeekEnd));
      const personalWeeklySeries = await storage.getDailyProductionSeries(personalRepIds, formatDate(weekStart), formatDate(weekEnd));
      
      const personalMtd = await storage.getProductionMetrics(personalRepIds, formatDate(mtdStart), formatDate(mtdEnd));
      const personalMtdPrior = await storage.getProductionMetrics(personalRepIds, formatDate(priorMtdStart), formatDate(priorMtdEnd));
      const personalMtdSeries = await storage.getDailyProductionSeries(personalRepIds, formatDate(mtdStart), formatDate(mtdEnd));
      
      // Team metrics (null for REP)
      let teamWeekly = null;
      let teamWeeklyPrior = null;
      let teamWeeklySeries: any[] = [];
      let teamMtd = null;
      let teamMtdPrior = null;
      let teamMtdSeries: any[] = [];
      
      if (teamRepIds.length > 0) {
        teamWeekly = await storage.getProductionMetrics(teamRepIds, formatDate(weekStart), formatDate(weekEnd));
        teamWeeklyPrior = await storage.getProductionMetrics(teamRepIds, formatDate(priorWeekStart), formatDate(priorWeekEnd));
        teamWeeklySeries = await storage.getDailyProductionSeries(teamRepIds, formatDate(weekStart), formatDate(weekEnd));
        
        teamMtd = await storage.getProductionMetrics(teamRepIds, formatDate(mtdStart), formatDate(mtdEnd));
        teamMtdPrior = await storage.getProductionMetrics(teamRepIds, formatDate(priorMtdStart), formatDate(priorMtdEnd));
        teamMtdSeries = await storage.getDailyProductionSeries(teamRepIds, formatDate(mtdStart), formatDate(mtdEnd));
      }
      
      // Calculate deltas
      const calcDelta = (current: number, prior: number) => ({
        value: current - prior,
        percent: prior === 0 ? null : Math.round(((current - prior) / prior) * 100)
      });
      
      const buildMetrics = (current: typeof personalWeekly, prior: typeof personalWeeklyPrior, series: any[]) => ({
        soldCount: current.soldCount,
        connectedCount: current.connectedCount,
        earnedDollars: current.earnedDollars,
        deltas: {
          soldCount: calcDelta(current.soldCount, prior.soldCount),
          connectedCount: calcDelta(current.connectedCount, prior.connectedCount),
          earnedDollars: calcDelta(current.earnedDollars, prior.earnedDollars),
        },
        sparklineSeries: series,
      });
      
      // Breakdowns
      let teamByRep = null;
      let teamByManager = null;
      
      if (["SUPERVISOR", "MANAGER"].includes(role)) {
        teamByRep = await storage.getTeamBreakdownByRep(user.id, role, formatDate(mtdStart), formatDate(mtdEnd));
      }
      
      if (["EXECUTIVE", "ADMIN", "OPERATIONS"].includes(role)) {
        teamByManager = await storage.getTeamBreakdownByManager(formatDate(mtdStart), formatDate(mtdEnd));
        teamByRep = await storage.getTeamBreakdownByRep(user.id, role, formatDate(mtdStart), formatDate(mtdEnd));
      }
      
      res.json({
        weekly: {
          personal: buildMetrics(personalWeekly, personalWeeklyPrior, personalWeeklySeries),
          team: teamWeekly ? buildMetrics(teamWeekly, teamWeeklyPrior!, teamWeeklySeries) : null,
        },
        mtd: {
          personal: buildMetrics(personalMtd, personalMtdPrior, personalMtdSeries),
          team: teamMtd ? buildMetrics(teamMtd, teamMtdPrior!, teamMtdSeries) : null,
        },
        breakdowns: {
          teamByRep,
          teamByManager,
        },
      });
    } catch (error) {
      console.error("Dashboard summary error:", error);
      res.status(500).json({ message: "Failed to get dashboard summary" });
    }
  });

  // Next-day installations endpoint
  app.get("/api/dashboard/next-day-installs", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const role = user.role;
      
      // Calculate tomorrow's date in America/New_York timezone
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const tomorrow = new Date(nyNow);
      tomorrow.setDate(nyNow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      // Get repIds based on role scope
      let repIds: string[] = [];
      
      if (role === "REP") {
        repIds = [user.repId];
      } else if (role === "SUPERVISOR") {
        const supervisedReps = await storage.getSupervisedReps(user.id);
        repIds = [user.repId, ...supervisedReps.map(r => r.repId)];
      } else if (role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        repIds = [user.repId, ...scope.allRepRepIds];
      } else if (role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        repIds = [user.repId, ...scope.allRepRepIds];
      } else {
        // ADMIN/OPERATIONS see all
        const allUsers = await storage.getUsers();
        repIds = allUsers.filter(u => u.role === "REP" && u.status === "ACTIVE" && !u.deletedAt).map(u => u.repId);
      }
      
      // Get orders with installDate = tomorrow
      const allOrders = await storage.getOrders({});
      const nextDayInstalls = allOrders.filter(order => {
        if (!order.installDate) return false;
        const installDateStr = new Date(order.installDate).toISOString().split('T')[0];
        return installDateStr === tomorrowStr && repIds.includes(order.repId);
      }).map(order => ({
        id: order.id,
        invoiceNumber: order.invoiceNumber,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress,
        installDate: order.installDate,
        repId: order.repId,
        jobStatus: order.jobStatus,
      }));
      
      res.json({ date: tomorrowStr, installs: nextDayInstalls });
    } catch (error) {
      console.error("Next-day installs error:", error);
      res.status(500).json({ message: "Failed to get next-day installations" });
    }
  });

  // Leaderboard endpoint - rankings by period
  app.get("/api/dashboard/leaderboard", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const role = user.role;
      const period = (req.query.period as string) || "weekly"; // daily, weekly, monthly
      
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      
      let startDate: Date;
      let endDate: Date = new Date(nyNow);
      
      if (period === "daily") {
        startDate = new Date(nyNow);
        startDate.setHours(0, 0, 0, 0);
      } else if (period === "weekly") {
        startDate = new Date(nyNow);
        const dayOfWeek = startDate.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setDate(startDate.getDate() - daysToMonday);
        startDate.setHours(0, 0, 0, 0);
      } else { // monthly
        startDate = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1);
      }
      
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      
      // Get all active users who can appear on leaderboard
      const allUsers = await storage.getUsers();
      const activeUsers = allUsers.filter(u => 
        u.status === "ACTIVE" && 
        !u.deletedAt && 
        ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"].includes(u.role)
      );
      
      // Determine which reps to show based on role scope
      let visibleRepIds: string[] = [];
      
      if (role === "REP") {
        visibleRepIds = activeUsers.map(u => u.repId);
      } else if (role === "SUPERVISOR") {
        const supervisedReps = await storage.getSupervisedReps(user.id);
        visibleRepIds = [user.repId, ...supervisedReps.map(r => r.repId)];
      } else if (role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        visibleRepIds = [user.repId, ...scope.allRepRepIds];
      } else {
        visibleRepIds = activeUsers.map(u => u.repId);
      }
      
      // Get orders in the period
      const allOrders = await storage.getOrders({});
      const periodOrders = allOrders.filter(order => {
        const orderDate = new Date(order.dateSold);
        return orderDate >= startDate && orderDate <= endDate;
      });
      
      // Calculate rankings
      const rankings = activeUsers
        .filter(u => visibleRepIds.includes(u.repId))
        .map(u => {
          const userOrders = periodOrders.filter(o => o.repId === u.repId);
          const soldCount = userOrders.length;
          const connectsCount = userOrders.filter(o => o.jobStatus === "COMPLETED").length;
          const approvedOrders = userOrders.filter(o => o.approvalStatus === "APPROVED");
          const earnedDollars = approvedOrders.reduce((sum, o) => 
            sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0
          );
          
          return {
            userId: u.id,
            repId: u.repId,
            name: u.name,
            role: u.role,
            soldCount,
            connectsCount,
            earnedDollars,
            isCurrentUser: u.id === user.id,
          };
        })
        .filter(r => r.soldCount > 0 || r.connectsCount > 0 || r.earnedDollars > 0)
        .sort((a, b) => b.soldCount - a.soldCount);
      
      // Add ranking position
      const rankedResults = rankings.map((r, index) => ({
        ...r,
        rank: index + 1,
      }));
      
      // Find current user's rank (even if they're not in top results)
      const currentUserRank = rankedResults.find(r => r.isCurrentUser);
      const currentUserStats = activeUsers.find(u => u.id === user.id);
      let myRanking = currentUserRank;
      
      if (!currentUserRank && currentUserStats) {
        const myOrders = periodOrders.filter(o => o.repId === currentUserStats.repId);
        const mySoldCount = myOrders.length;
        const myConnects = myOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const myEarned = myOrders.filter(o => o.approvalStatus === "APPROVED")
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const myRank = rankings.filter(r => r.soldCount > mySoldCount).length + 1;
        myRanking = {
          userId: user.id,
          repId: currentUserStats.repId,
          name: currentUserStats.name,
          role: currentUserStats.role,
          soldCount: mySoldCount,
          connectsCount: myConnects,
          earnedDollars: myEarned,
          isCurrentUser: true,
          rank: myRank,
        };
      }
      
      res.json({
        period,
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        leaderboard: rankedResults.slice(0, 10), // Top 10
        myRanking,
        totalParticipants: rankings.length,
      });
    } catch (error) {
      console.error("Leaderboard error:", error);
      res.status(500).json({ message: "Failed to get leaderboard" });
    }
  });

  // Quota progress endpoint - current user's goal attainment
  app.get("/api/dashboard/quota-progress", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      
      // Get current month date range
      const monthStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1);
      const monthEnd = new Date(nyNow.getFullYear(), nyNow.getMonth() + 1, 0);
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      
      // Find active goal for this user and period
      const userGoals = await storage.getSalesGoalsByUser(user.id);
      const currentGoal = userGoals.find(g => {
        const start = new Date(g.periodStart);
        const end = new Date(g.periodEnd);
        return start <= monthEnd && end >= monthStart;
      });
      
      // Get orders for the period
      const allOrders = await storage.getOrders({ repId: user.repId });
      const periodOrders = allOrders.filter(order => {
        const orderDate = new Date(order.dateSold);
        return orderDate >= monthStart && orderDate <= monthEnd;
      });
      
      const soldCount = periodOrders.length;
      const connectsCount = periodOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const earnedDollars = periodOrders
        .filter(o => o.approvalStatus === "APPROVED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      // Calculate progress percentages
      const salesProgress = currentGoal?.salesTarget && currentGoal.salesTarget > 0 
        ? Math.min(100, Math.round((soldCount / currentGoal.salesTarget) * 100)) 
        : null;
      const connectsProgress = currentGoal?.connectsTarget && currentGoal.connectsTarget > 0 
        ? Math.min(100, Math.round((connectsCount / currentGoal.connectsTarget) * 100)) 
        : null;
      const revenueProgress = currentGoal?.revenueTarget && parseFloat(currentGoal.revenueTarget) > 0 
        ? Math.min(100, Math.round((earnedDollars / parseFloat(currentGoal.revenueTarget)) * 100)) 
        : null;
      
      // Calculate days remaining in period
      const daysInMonth = Math.ceil((monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysPassed = Math.ceil((nyNow.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, daysInMonth - daysPassed);
      const expectedProgress = Math.round((daysPassed / daysInMonth) * 100);
      
      res.json({
        period: "monthly",
        periodStart: formatDate(monthStart),
        periodEnd: formatDate(monthEnd),
        daysRemaining,
        expectedProgress,
        hasGoal: !!currentGoal,
        goals: currentGoal ? {
          salesTarget: currentGoal.salesTarget,
          connectsTarget: currentGoal.connectsTarget,
          revenueTarget: parseFloat(currentGoal.revenueTarget),
        } : null,
        actual: {
          soldCount,
          connectsCount,
          earnedDollars,
        },
        progress: {
          sales: salesProgress,
          connects: connectsProgress,
          revenue: revenueProgress,
        },
      });
    } catch (error) {
      console.error("Quota progress error:", error);
      res.status(500).json({ message: "Failed to get quota progress" });
    }
  });

  // Admin: Manage sales goals
  app.get("/api/admin/sales-goals", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const goals = await storage.getAllSalesGoals();
      const users = await storage.getUsers();
      const goalsWithUsers = goals.map(g => ({
        ...g,
        userName: users.find(u => u.id === g.userId)?.name || "Unknown",
        userRepId: users.find(u => u.id === g.userId)?.repId || "",
      }));
      res.json(goalsWithUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sales goals" });
    }
  });

  app.post("/api/admin/sales-goals", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const goalData = {
        ...req.body,
        createdByUserId: user.id,
      };
      const newGoal = await storage.createSalesGoal(goalData);
      res.status(201).json(newGoal);
    } catch (error) {
      console.error("Create sales goal error:", error);
      res.status(500).json({ message: "Failed to create sales goal" });
    }
  });

  app.patch("/api/admin/sales-goals/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const updatedGoal = await storage.updateSalesGoal(id, req.body);
      if (!updatedGoal) {
        return res.status(404).json({ message: "Goal not found" });
      }
      res.json(updatedGoal);
    } catch (error) {
      console.error("Update sales goal error:", error);
      res.status(500).json({ message: "Failed to update sales goal" });
    }
  });

  app.delete("/api/admin/sales-goals/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await storage.deleteSalesGoal(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete sales goal error:", error);
      res.status(500).json({ message: "Failed to delete sales goal" });
    }
  });

  // Team routes
  app.get("/api/team/members", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const teamMembers = await storage.getTeamMembers(user.id);
      const orders = await storage.getOrders({});
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const membersWithStats = teamMembers.map(member => {
        const memberOrders = orders.filter(o => o.repId === member.repId && new Date(o.createdAt) >= monthStart);
        const earnedMTD = memberOrders.filter(o => o.approvalStatus === "APPROVED").reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned), 0);
        return { ...member, passwordHash: undefined, earnedMTD, orderCount: memberOrders.length };
      });

      res.json(membersWithStats);
    } catch (error) {
      res.status(500).json({ message: "Failed to get team" });
    }
  });

  // Filter options for manager dashboard - returns supervisors, reps, providers in manager's scope
  app.get("/api/team/filter-options", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      
      let supervisors: { id: string; name: string }[] = [];
      let reps: { id: string; name: string; repId: string }[] = [];
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        // Admin sees all
        const allUsers = await storage.getUsers();
        supervisors = allUsers.filter(u => u.role === "SUPERVISOR" && u.status === "ACTIVE" && !u.deletedAt).map(u => ({ id: u.id, name: u.name }));
        reps = allUsers.filter(u => u.role === "REP" && u.status === "ACTIVE" && !u.deletedAt).map(u => ({ id: u.id, name: u.name, repId: u.repId }));
      } else if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const allUsers = await storage.getUsers();
        supervisors = allUsers.filter(u => scope.supervisorIds.includes(u.id) && u.status === "ACTIVE" && !u.deletedAt).map(u => ({ id: u.id, name: u.name }));
        reps = allUsers.filter(u => scope.allRepIds.includes(u.id) && u.status === "ACTIVE" && !u.deletedAt).map(u => ({ id: u.id, name: u.name, repId: u.repId }));
      } else if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const allUsers = await storage.getUsers();
        supervisors = allUsers.filter(u => scope.supervisorIds.includes(u.id) && u.status === "ACTIVE" && !u.deletedAt).map(u => ({ id: u.id, name: u.name }));
        reps = allUsers.filter(u => scope.allRepIds.includes(u.id) && u.status === "ACTIVE" && !u.deletedAt).map(u => ({ id: u.id, name: u.name, repId: u.repId }));
      }
      
      // Get providers (visible to all managers+)
      const providers = await storage.getProviders();
      const activeProviders = providers.filter(p => p.active && !p.deletedAt).map(p => ({ id: p.id, name: p.name }));
      
      res.json({ supervisors, reps, providers: activeProviders });
    } catch (error) {
      console.error("Filter options error:", error);
      res.status(500).json({ message: "Failed to get filter options" });
    }
  });

  // Orders routes
  app.get("/api/orders", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      let orders;

      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        // Admin/Founder sees all orders
        orders = await storage.getOrders({ limit });
      } else if (user.role === "EXECUTIVE") {
        // Executive sees orders from their org tree (managers and their reps)
        const scope = await storage.getExecutiveScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId]; // Include executive's own orders
        orders = await storage.getOrders({ teamRepIds, limit });
      } else if (user.role === "MANAGER") {
        // Manager sees direct reps + reps under their supervisors
        const scope = await storage.getManagerScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId]; // Include manager's own orders
        orders = await storage.getOrders({ teamRepIds, limit });
      } else if (user.role === "SUPERVISOR") {
        // Supervisor sees their assigned reps + own orders
        const supervisedReps = await storage.getSupervisedReps(user.id);
        const teamRepIds = [...supervisedReps.map(r => r.repId), user.repId];
        orders = await storage.getOrders({ teamRepIds, limit });
      } else {
        // REP sees only their own orders
        orders = await storage.getOrders({ repId: user.repId, limit });
      }

      res.json(orders);
    } catch (error) {
      console.error("Get orders error:", error);
      res.status(500).json({ message: "Failed to get orders" });
    }
  });

  app.post("/api/orders", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      
      // Validate required fields
      const { clientId, providerId, serviceId, dateSold, customerName, mobileLines, repId: submittedRepId } = req.body;
      if (!clientId || !providerId || !serviceId || !dateSold || !customerName) {
        return res.status(400).json({ message: "Missing required fields: clientId, providerId, serviceId, dateSold, customerName" });
      }
      
      // Determine repId - admins can assign to any rep, others use their own
      let assignedRepId = user.repId;
      if (["ADMIN", "OPERATIONS"].includes(user.role) && submittedRepId) {
        // Verify the rep exists
        const rep = await storage.getUserByRepId(submittedRepId);
        if (rep) {
          assignedRepId = submittedRepId;
        }
      }
      
      // Strict whitelist of allowed fields for order creation
      const allowedFields = [
        "clientId", "providerId", "serviceId", "dateSold", "customerName",
        "customerPhone", "customerEmail", "customerAddress", "accountNumber",
        "installDate", "tvSold", "mobileSold", "mobileProductType", "mobilePortedStatus", "mobileLinesQty", "notes"
      ];
      
      const orderData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          orderData[field] = req.body[field];
        }
      }
      
      // Handle mobile lines array - set legacy fields for backward compatibility
      const hasMobileLines = Array.isArray(mobileLines) && mobileLines.length > 0;
      if (hasMobileLines) {
        orderData.mobileSold = true;
        orderData.mobileLinesQty = mobileLines.length;
        // Set legacy single-value fields from first line for backward compatibility
        orderData.mobileProductType = mobileLines[0].mobileProductType || null;
        orderData.mobilePortedStatus = mobileLines[0].mobilePortedStatus || null;
      } else if (req.body.hasMobile || req.body.mobileSold) {
        orderData.mobileSold = true;
      }
      
      // Handle hasTv -> tvSold mapping
      if (req.body.hasTv !== undefined) {
        orderData.tvSold = !!req.body.hasTv;
      }
      
      // System-controlled fields - cannot be set by user
      // Create order first without commission, then calculate after mobile lines exist
      const data = { 
        ...orderData,
        repId: assignedRepId,
        jobStatus: "PENDING" as const,
        approvalStatus: "UNAPPROVED" as const,
        baseCommissionEarned: "0",
        appliedRateCardId: null,
        commissionSource: "CALCULATED" as const,
        calcAt: null,
        incentiveEarned: "0",
        commissionPaid: "0",
        paymentStatus: "UNPAID" as const,
        exportedToAccounting: false,
      };
      
      const order = await storage.createOrder(data as any);
      
      // Create mobile line items if provided - must be done BEFORE commission calculation
      if (hasMobileLines) {
        for (let i = 0; i < mobileLines.length; i++) {
          const line = mobileLines[i];
          await storage.createMobileLineItem({
            salesOrderId: order.id,
            lineNumber: i + 1,
            mobileProductType: line.mobileProductType || "OTHER",
            mobilePortedStatus: line.mobilePortedStatus || "NON_PORTED",
          });
        }
      }
      
      // Now calculate commission using the async method that looks up per-line rate cards
      let baseCommission = "0";
      let appliedRateCardId: string | null = null;
      
      const rateCard = await storage.findMatchingRateCard(order, dateSold);
      if (rateCard) {
        // Use the async version that properly looks up mobile-specific rate cards per line
        const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
        await storage.createCommissionLineItems(order.id, lineItems);
        
        // Sum up all line item commissions (gross)
        const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
        appliedRateCardId = rateCard.id;
        
        // Check if sales rep is an EXECUTIVE (exempt from override deductions)
        const salesRepUser = await storage.getUserByRepId(assignedRepId);
        const isExecutiveSale = salesRepUser?.role === "EXECUTIVE";
        
        // Subtract override deductions for net commission (NOT for executives)
        let totalDeductions = 0;
        if (!isExecutiveSale) {
          totalDeductions += parseFloat(rateCard.overrideDeduction || "0");
          if (order.tvSold) {
            totalDeductions += parseFloat(rateCard.tvOverrideDeduction || "0");
          }
          if (order.mobileSold) {
            totalDeductions += parseFloat((rateCard as any).mobileOverrideDeduction || "0");
          }
        }
        baseCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
      }
      
      // Update order with calculated commission
      const updatedOrder = await storage.updateOrder(order.id, {
        baseCommissionEarned: baseCommission,
        appliedRateCardId,
        calcAt: rateCard ? new Date() : null,
      });
      
      await storage.createAuditLog({ action: "create_order", tableName: "sales_orders", recordId: order.id, afterJson: JSON.stringify(updatedOrder), userId: user.id });
      res.json(updatedOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create order" });
    }
  });

  // Get commission line items for an order
  app.get("/api/orders/:id/commission-lines", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const lineItems = await storage.getCommissionLineItemsByOrderId(id);
      res.json(lineItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to get commission line items" });
    }
  });
  
  // Recalculate commission for an existing order (useful for orders created before fixes)
  app.post("/api/orders/:id/recalculate-commission", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      // Only admins can recalculate commissions
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Only admins can recalculate commissions" });
      }
      
      // Delete existing commission line items
      await storage.deleteCommissionLineItemsByOrderId(id);
      
      // Find matching rate card and recalculate
      const rateCard = await storage.findMatchingRateCard(order, order.dateSold);
      let baseCommission = "0";
      let appliedRateCardId: string | null = null;
      
      if (rateCard) {
        const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
        await storage.createCommissionLineItems(order.id, lineItems);
        const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
        appliedRateCardId = rateCard.id;
        
        // Check if sales rep is an EXECUTIVE (exempt from override deductions)
        const salesRep = await storage.getUserByRepId(order.repId);
        const isExecutiveSale = salesRep?.role === "EXECUTIVE";
        
        // Calculate override deductions to subtract from rep's commission (NOT for executives)
        let totalDeductions = 0;
        if (!isExecutiveSale) {
          totalDeductions += parseFloat(rateCard.overrideDeduction || "0");
          if (order.tvSold) {
            totalDeductions += parseFloat(rateCard.tvOverrideDeduction || "0");
          }
          if (order.mobileSold) {
            totalDeductions += parseFloat((rateCard as any).mobileOverrideDeduction || "0");
          }
        }
        baseCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
      }
      
      // Update order with recalculated commission
      const updatedOrder = await storage.updateOrder(order.id, {
        baseCommissionEarned: baseCommission,
        appliedRateCardId,
        calcAt: new Date(),
      });
      
      await storage.createAuditLog({ action: "recalculate_commission", tableName: "sales_orders", recordId: order.id, afterJson: JSON.stringify(updatedOrder), userId: user.id });
      
      res.json(updatedOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to recalculate commission" });
    }
  });
  
  // Strict whitelist-based order mutation
  app.patch("/api/orders/:id", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      const order = await storage.getOrderById(id);
      
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      // Check if user is admin-level (can edit any order)
      const isAdminLevel = ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role);
      
      // Order locking: non-admin roles can only edit their own orders
      if (!isAdminLevel) {
        // REPs, MDU, SUPERVISOR can only modify their own orders
        if (["REP", "MDU", "SUPERVISOR"].includes(user.role) && order.repId !== user.repId) {
          return res.status(403).json({ message: "Orders are locked to their creator. Contact admin to make changes." });
        }
        
        // MANAGERs can only modify their team's orders
        if (user.role === "MANAGER") {
          const teamMembers = await storage.getTeamMembers(user.id);
          const teamRepIds = [...teamMembers.map(m => m.repId), user.repId];
          if (!teamRepIds.includes(order.repId)) {
            return res.status(403).json({ message: "Access denied" });
          }
        }
      }
      
      // Define strict whitelists based on approval status and role
      const statusFields = ["jobStatus", "installDate", "installTime", "installType"];
      const customerFields = ["customerName", "customerPhone", "customerEmail", "customerAddress", "accountNumber"];
      const orderFields = ["clientId", "providerId", "serviceId", "dateSold", "tvSold", "mobileSold", "mobileProductType", "mobilePortedStatus", "mobileLinesQty", "notes"];
      
      let allowedFields: string[] = [];
      
      if (order.approvalStatus === "APPROVED") {
        // Approved orders: only status + customer contact can be updated
        allowedFields = [...statusFields, "customerPhone", "customerEmail", "customerAddress", "accountNumber"];
        // ADMIN/EXECUTIVE/OPERATIONS can also change repId, provider, client, service on approved orders
        if (isAdminLevel) {
          allowedFields.push("repId", "providerId", "clientId", "serviceId");
        }
      } else if (order.approvalStatus === "UNAPPROVED") {
        if (isAdminLevel) {
          // Admin-level can modify all fields including repId on unapproved orders
          allowedFields = [...statusFields, ...customerFields, ...orderFields, "repId"];
        } else {
          // REPs and MANAGERs can modify customer + order fields on their unapproved orders (not repId)
          allowedFields = [...statusFields, ...customerFields, ...orderFields];
        }
      } else {
        // Rejected orders - allow limited edits for resubmission
        allowedFields = [...customerFields, ...orderFields];
        if (isAdminLevel) {
          allowedFields.push("repId");
        }
      }
      
      // Extract only whitelisted fields
      const updateData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      
      // Check if commission-affecting fields changed and recalculate if needed
      const commissionFields = ["providerId", "serviceId", "clientId", "dateSold", "tvSold", "mobileSold", "mobileProductType", "mobilePortedStatus", "mobileLinesQty"];
      const needsRecalc = commissionFields.some(f => updateData[f] !== undefined);
      
      if (needsRecalc && order.approvalStatus !== "APPROVED") {
        // Build merged order for recalculation
        const mergedOrder = {
          ...order,
          providerId: updateData.providerId ?? order.providerId,
          serviceId: updateData.serviceId ?? order.serviceId,
          clientId: updateData.clientId ?? order.clientId,
          tvSold: updateData.tvSold ?? order.tvSold,
          mobileSold: updateData.mobileSold ?? order.mobileSold,
          mobileLinesQty: updateData.mobileLinesQty ?? order.mobileLinesQty,
          mobileProductType: updateData.mobileProductType ?? order.mobileProductType,
          mobilePortedStatus: updateData.mobilePortedStatus ?? order.mobilePortedStatus,
        };
        const dateSold = updateData.dateSold ?? order.dateSold;
        
        const rateCard = await storage.findMatchingRateCard(mergedOrder as any, dateSold);
        if (rateCard) {
          // Delete existing commission line items and regenerate
          await storage.deleteCommissionLineItemsByOrderId(id);
          const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, mergedOrder as any);
          await storage.createCommissionLineItems(id, lineItems);
          
          // Calculate total commission from line items
          const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
          updateData.baseCommissionEarned = grossCommission.toFixed(2);
          updateData.appliedRateCardId = rateCard.id;
          updateData.commissionSource = "CALCULATED";
          updateData.calcAt = new Date();
        }
      }
      
      const updated = await storage.updateOrder(id, updateData);
      await storage.createAuditLog({ 
        action: "update_order", 
        tableName: "sales_orders", 
        recordId: id, 
        beforeJson: JSON.stringify(order), 
        afterJson: JSON.stringify(updated), 
        userId: user.id 
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update order" });
    }
  });

  // Hard delete order (permanently removes order and all related data) - Executive/Admin only
  app.delete("/api/admin/orders/:id", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      await storage.createAuditLog({ 
        action: "hard_delete_order", 
        tableName: "sales_orders", 
        recordId: id, 
        beforeJson: JSON.stringify(order), 
        userId: req.user!.id 
      });
      await storage.hardDeleteOrder(id);
      res.json({ message: "Order permanently deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete order" });
    }
  });

  // Admin approval routes
  app.get("/api/admin/approvals/queue", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      let orders = await storage.getPendingApprovals();
      if (limit) orders = orders.slice(0, limit);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get approvals" });
    }
  });

  app.post("/api/admin/orders/:id/approve", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Calculate commission using new rate card formula
      let baseCommission = "0";
      let rateCard = await storage.findMatchingRateCard(order, order.dateSold);
      if (rateCard) {
        // Create commission line items for Internet, Mobile, Video (using async version for per-line mobile)
        await storage.deleteCommissionLineItemsByOrderId(id); // Clear existing
        const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
        await storage.createCommissionLineItems(id, lineItems);
        
        // Calculate total commission from line items
        baseCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0).toFixed(2);
      } else {
        await storage.createRateIssue({ salesOrderId: id, type: "MISSING_RATE", details: "No matching rate card found for this order" });
      }

      // Check if sales rep is an EXECUTIVE (exempt from override deductions)
      const salesRep = await storage.getUserByRepId(order.repId);
      const isExecutiveSale = salesRep?.role === "EXECUTIVE";
      
      // Calculate override deductions to subtract from rep's commission (NOT for executives)
      let totalDeductions = 0;
      if (rateCard && !isExecutiveSale) {
        // BASE deduction always applies
        const baseDeduction = parseFloat(rateCard.overrideDeduction || "0");
        totalDeductions += baseDeduction;
        
        // TV deduction only if TV sold
        if (order.tvSold) {
          const tvDeduction = parseFloat(rateCard.tvOverrideDeduction || "0");
          totalDeductions += tvDeduction;
        }
        
        // Mobile deduction only if mobile sold
        if (order.mobileSold) {
          const mobileDeduction = parseFloat((rateCard as any).mobileOverrideDeduction || "0");
          totalDeductions += mobileDeduction;
        }
      }
      
      // Net commission is gross minus deductions (ensure non-negative)
      const grossCommission = parseFloat(baseCommission);
      const netCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);

      const updated = await storage.updateOrder(id, {
        approvalStatus: "APPROVED",
        approvedByUserId: user.id,
        approvedAt: new Date(),
        baseCommissionEarned: netCommission,
        appliedRateCardId: rateCard?.id || null,
        calcAt: new Date(),
        commissionSource: "CALCULATED",
      });

      // Generate override earnings (pools the deductions for later distribution)
      const overrideEarnings = await generateOverrideEarnings(order, updated);
      for (const earning of overrideEarnings) {
        await storage.createAuditLog({ action: "create_override_earning", tableName: "override_earnings", recordId: earning.id, afterJson: JSON.stringify(earning), userId: user.id });
      }

      await storage.createAuditLog({ action: "approve_order", tableName: "sales_orders", recordId: id, beforeJson: JSON.stringify(order), afterJson: JSON.stringify(updated), userId: user.id });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to approve order" });
    }
  });

  app.post("/api/admin/orders/:id/reject", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { rejectionNote } = req.body;
      const user = req.user!;
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const updated = await storage.updateOrder(id, {
        approvalStatus: "REJECTED",
        rejectionNote,
        approvedByUserId: user.id,
        approvedAt: new Date(),
      });

      await storage.createAuditLog({ action: "reject_order", tableName: "sales_orders", recordId: id, beforeJson: JSON.stringify(order), afterJson: JSON.stringify(updated), userId: user.id });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to reject order" });
    }
  });

  app.post("/api/admin/orders/:id/unapprove", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (order.approvalStatus === "UNAPPROVED") {
        return res.status(400).json({ message: "Order is already unapproved" });
      }

      if (order.payRunId) {
        return res.status(400).json({ message: "Cannot unapprove order that is linked to a pay run" });
      }

      if (order.paymentStatus === "PAID") {
        return res.status(400).json({ message: "Cannot unapprove order that has been paid" });
      }

      const updated = await storage.updateOrder(id, {
        approvalStatus: "UNAPPROVED",
        rejectionNote: null,
        approvedByUserId: null,
        approvedAt: null,
      });

      await storage.createAuditLog({ action: "unapprove_order", tableName: "sales_orders", recordId: id, beforeJson: JSON.stringify(order), afterJson: JSON.stringify(updated), userId: user.id });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to unapprove order" });
    }
  });

  app.post("/api/admin/orders/:id/mark-paid", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const totalCommission = (parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned)).toFixed(2);
      const updated = await storage.updateOrder(id, {
        paymentStatus: "PAID",
        paidDate: new Date().toISOString().split("T")[0],
        commissionPaid: totalCommission,
      });

      await storage.createAuditLog({ action: "mark_paid", tableName: "sales_orders", recordId: id, beforeJson: JSON.stringify(order), afterJson: JSON.stringify(updated), userId: user.id });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to mark order as paid" });
    }
  });

  app.post("/api/admin/orders/bulk-approve", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      const user = req.user!;
      let approved = 0;
      let skipped = 0;

      for (const id of orderIds) {
        const order = await storage.getOrderById(id);
        if (!order || order.approvalStatus !== "UNAPPROVED") continue;

        let baseCommission = "0";
        const rateCard = await storage.findMatchingRateCard(order, order.dateSold);
        if (rateCard) {
          // Create commission line items for Internet, Mobile, Video (using async version for per-line mobile)
          await storage.deleteCommissionLineItemsByOrderId(id);
          const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
          await storage.createCommissionLineItems(id, lineItems);
          
          // Calculate total commission from line items
          baseCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0).toFixed(2);
          
          // Check if sales rep is an EXECUTIVE (exempt from override deductions)
          const salesRep = await storage.getUserByRepId(order.repId);
          const isExecutiveSale = salesRep?.role === "EXECUTIVE";
          
          // Calculate override deductions to subtract from rep's commission (NOT for executives)
          let totalDeductions = 0;
          if (!isExecutiveSale) {
            const baseDeduction = parseFloat(rateCard.overrideDeduction || "0");
            totalDeductions += baseDeduction;
            if (order.tvSold) {
              totalDeductions += parseFloat(rateCard.tvOverrideDeduction || "0");
            }
            if (order.mobileSold) {
              totalDeductions += parseFloat((rateCard as any).mobileOverrideDeduction || "0");
            }
          }
          
          // Net commission is gross minus deductions
          const grossCommission = parseFloat(baseCommission);
          const netCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
          
          const updated = await storage.updateOrder(id, {
            approvalStatus: "APPROVED",
            approvedByUserId: user.id,
            approvedAt: new Date(),
            baseCommissionEarned: netCommission,
            appliedRateCardId: rateCard.id,
            calcAt: new Date(),
            commissionSource: "CALCULATED",
          });
          
          // Generate override earnings (pools deductions for later distribution)
          await generateOverrideEarnings(order, updated);
          approved++;
        } else {
          await storage.createRateIssue({ salesOrderId: id, type: "MISSING_RATE", details: "No matching rate card found" });
          skipped++;
        }
      }

      await storage.createAuditLog({ action: "bulk_approve", tableName: "sales_orders", afterJson: JSON.stringify({ approved, skipped }), userId: user.id });
      res.json({ approved, skipped });
    } catch (error) {
      res.status(500).json({ message: "Failed to bulk approve" });
    }
  });

  // Excel Import for Orders - with file validation
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE, files: 1 }
  });
  
  app.post("/api/admin/orders/import", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      // Validate file upload
      const validation = validateFileUpload(req.file, res);
      if (!validation.valid) return;
      
      const workbook = validation.workbook;
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];

      if (rows.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }
      
      // Validate row count
      if (!validateRowCount(rows, res)) return;

      const errors: string[] = [];
      let success = 0;
      let failed = 0;

      // Get reference data for lookups
      const users = await storage.getUsers();
      const providers = await storage.getProviders();
      const clients = await storage.getClients();
      const services = await storage.getServices();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // Excel row number (1-indexed + header row)

        try {
          // Required fields
          const repId = row.repId?.toString().trim();
          const customerName = row.customerName?.toString().trim();
          const dateSoldRaw = row.dateSold;

          if (!repId) {
            errors.push(`Row ${rowNum}: Missing repId`);
            failed++;
            continue;
          }
          if (!customerName) {
            errors.push(`Row ${rowNum}: Missing customerName`);
            failed++;
            continue;
          }
          if (!dateSoldRaw) {
            errors.push(`Row ${rowNum}: Missing dateSold`);
            failed++;
            continue;
          }

          // Validate rep exists
          const user = users.find(u => u.repId === repId);
          if (!user) {
            errors.push(`Row ${rowNum}: Rep ID "${repId}" not found`);
            failed++;
            continue;
          }

          // Parse dates (Excel serial or string)
          let dateSold: Date;
          if (typeof dateSoldRaw === "number") {
            dateSold = new Date((dateSoldRaw - 25569) * 86400 * 1000);
          } else {
            dateSold = new Date(dateSoldRaw);
          }
          if (isNaN(dateSold.getTime())) {
            errors.push(`Row ${rowNum}: Invalid dateSold format`);
            failed++;
            continue;
          }

          let installDate: Date | undefined;
          if (row.installDate) {
            if (typeof row.installDate === "number") {
              installDate = new Date((row.installDate - 25569) * 86400 * 1000);
            } else {
              installDate = new Date(row.installDate);
            }
            if (isNaN(installDate.getTime())) {
              installDate = undefined;
            }
          }

          // Lookup IDs by name or use provided IDs
          let providerId = row.providerId?.toString().trim();
          if (!providerId && row.provider) {
            const provider = providers.find(p => p.name.toLowerCase() === row.provider.toString().toLowerCase().trim());
            providerId = provider?.id;
          }

          let clientId = row.clientId?.toString().trim();
          if (!clientId && row.client) {
            const client = clients.find(c => c.name.toLowerCase() === row.client.toString().toLowerCase().trim());
            clientId = client?.id;
          }

          let serviceId = row.serviceId?.toString().trim();
          if (!serviceId && row.service) {
            const service = services.find(s => s.name.toLowerCase() === row.service.toString().toLowerCase().trim());
            serviceId = service?.id;
          }

          // Build order data (dates as ISO strings)
          const orderData = {
            repId,
            customerName,
            customerAddress: row.customerAddress?.toString().trim() || "",
            accountNumber: row.accountNumber?.toString().trim() || null,
            dateSold: dateSold.toISOString(),
            installDate: installDate ? installDate.toISOString() : null,
            providerId: providerId || "default-provider",
            clientId: clientId || "default-client",
            serviceId: serviceId || "default-service",
            invoiceNumber: row.invoiceNumber?.toString().trim() || null,
            tvSold: row.tvSold === true || row.tvSold === "true" || row.tvSold === 1 || row.tvSold === "1" || row.tvSold?.toString().toLowerCase() === "yes",
            mobileSold: row.mobileSold === true || row.mobileSold === "true" || row.mobileSold === 1 || row.mobileSold === "1" || row.mobileSold?.toString().toLowerCase() === "yes",
            mobileLinesQty: parseInt(row.mobileLinesQty) || 0,
            jobStatus: "PENDING" as const,
            approvalStatus: "UNAPPROVED" as const,
            paymentStatus: "UNPAID" as const,
            baseCommissionEarned: "0",
            incentiveEarned: "0",
          };

          await storage.createOrder(orderData);
          success++;
        } catch (err: any) {
          errors.push(`Row ${rowNum}: ${err.message || "Unknown error"}`);
          failed++;
        }
      }

      await storage.createAuditLog({
        action: "import_orders",
        tableName: "sales_orders",
        afterJson: JSON.stringify({ success, failed, errorCount: errors.length }),
        userId: req.user!.id,
      });

      res.json({ success, failed, errors });
    } catch (error: any) {
      console.error("Import error:", error);
      res.status(500).json({ message: error.message || "Import failed" });
    }
  });

  // Admin reference data routes (executives can view, admins can modify)
  app.get("/api/admin/users", auth, executiveOrAdmin, async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users.map(u => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ message: "Failed to get users" });
    }
  });

  app.get("/api/users", auth, executiveOrAdmin, async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users.map(u => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ message: "Failed to get users" });
    }
  });

  // Get assignable users for leads - SUPERVISOR+ can access this for lead assignment
  app.get("/api/users/assignable", auth, async (req: AuthRequest, res) => {
    try {
      const currentUser = req.user!;
      const canAssign = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(currentUser.role);
      if (!canAssign) {
        return res.status(403).json({ message: "Only supervisors and above can access assignable users" });
      }
      
      const users = await storage.getUsers();
      const currentUserLevel = ROLE_HIERARCHY[currentUser.role] || 0;
      
      // Filter to active users at or below caller's role level with valid repId
      const assignableUsers = users
        .filter(u => 
          u.status === "ACTIVE" && 
          !u.deletedAt && 
          u.repId && 
          (ROLE_HIERARCHY[u.role] || 0) <= currentUserLevel
        )
        .map(u => ({ 
          id: u.id,
          name: u.name,
          repId: u.repId,
          role: u.role,
          status: u.status,
        }));
      
      res.json(assignableUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get assignable users" });
    }
  });

  app.post("/api/admin/users", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { password, name, repId, role, assignedSupervisorId, assignedManagerId, assignedExecutiveId, skipValidation } = req.body;
      if (!password || !name || !repId) {
        return res.status(400).json({ message: "Missing required fields: name, repId, password" });
      }
      
      const userRole = role || "REP";
      
      // Check if repId is already in use by an active (non-deleted) user
      const existingWithRepId = await storage.getActiveUserByRepId(repId);
      if (existingWithRepId) {
        return res.status(400).json({ message: `Rep ID "${repId}" is already in use` });
      }
      
      const userData = {
        name,
        repId,
        role: userRole,
        assignedSupervisorId: assignedSupervisorId || null,
        assignedManagerId: assignedManagerId || null,
        assignedExecutiveId: assignedExecutiveId || null,
      };
      
      // Validate org hierarchy unless admin explicitly skips
      if (!skipValidation) {
        const validation = await storage.validateOrgHierarchy(userData);
        if (!validation.valid) {
          return res.status(400).json({ message: validation.error, validationError: true });
        }
      }
      
      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({ ...userData, passwordHash });
      
      // Detailed audit log for hierarchy
      await storage.createAuditLog({ 
        action: "create_user", 
        tableName: "users", 
        recordId: user.id, 
        afterJson: JSON.stringify({ 
          ...user, 
          passwordHash: undefined,
          hierarchyAssignments: { 
            supervisorId: user.assignedSupervisorId,
            managerId: user.assignedManagerId,
            executiveId: user.assignedExecutiveId
          }
        }), 
        userId: req.user!.id 
      });
      res.json({ ...user, passwordHash: undefined });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create user" });
    }
  });

  app.patch("/api/admin/users/:id", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { password, name, role, repId, status, assignedSupervisorId, assignedManagerId, assignedExecutiveId, skipValidation } = req.body;
      const isFounder = req.user!.role === "OPERATIONS";
      
      // Get existing user for before snapshot
      const existingUser = await storage.getUserById(id);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (role !== undefined) updateData.role = role;
      if (status !== undefined) updateData.status = status;
      if (assignedSupervisorId !== undefined) updateData.assignedSupervisorId = assignedSupervisorId || null;
      if (assignedManagerId !== undefined) updateData.assignedManagerId = assignedManagerId || null;
      if (assignedExecutiveId !== undefined) updateData.assignedExecutiveId = assignedExecutiveId || null;
      if (password) {
        updateData.passwordHash = await hashPassword(password);
      }
      
      // OPERATIONS-only: Allow editing repId
      if (repId !== undefined && isFounder) {
        // Check if new repId is already taken by another active (non-deleted) user
        if (repId !== existingUser.repId) {
          const existingWithRepId = await storage.getActiveUserByRepId(repId);
          if (existingWithRepId && existingWithRepId.id !== id) {
            return res.status(400).json({ message: `Rep ID "${repId}" is already in use` });
          }
        }
        updateData.repId = repId;
      }
      
      // Validate org hierarchy unless admin explicitly skips
      const effectiveRole = updateData.role ?? existingUser.role;
      const effectiveData = {
        role: effectiveRole,
        assignedSupervisorId: updateData.assignedSupervisorId ?? existingUser.assignedSupervisorId,
        assignedManagerId: updateData.assignedManagerId ?? existingUser.assignedManagerId,
      };
      
      if (!skipValidation) {
        const validation = await storage.validateOrgHierarchy(effectiveData);
        if (!validation.valid) {
          return res.status(400).json({ message: validation.error, validationError: true });
        }
      }
      
      const user = await storage.updateUser(id, updateData);
      
      // Detailed audit log for hierarchy changes
      const hierarchyChanged = 
        existingUser.assignedSupervisorId !== user.assignedSupervisorId ||
        existingUser.assignedManagerId !== user.assignedManagerId ||
        existingUser.assignedExecutiveId !== user.assignedExecutiveId;
      
      await storage.createAuditLog({ 
        action: hierarchyChanged ? "update_user_hierarchy" : "update_user", 
        tableName: "users", 
        recordId: id, 
        beforeJson: hierarchyChanged ? JSON.stringify({
          assignedSupervisorId: existingUser.assignedSupervisorId,
          assignedManagerId: existingUser.assignedManagerId,
          assignedExecutiveId: existingUser.assignedExecutiveId
        }) : undefined,
        afterJson: JSON.stringify({ 
          ...user, 
          passwordHash: undefined,
          hierarchyAssignments: hierarchyChanged ? { 
            supervisorId: user.assignedSupervisorId,
            managerId: user.assignedManagerId,
            executiveId: user.assignedExecutiveId
          } : undefined
        }), 
        userId: req.user!.id 
      });
      res.json({ ...user, passwordHash: undefined });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update user" });
    }
  });

  app.post("/api/admin/users/:id/deactivate", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = await storage.updateUser(id, { status: "DEACTIVATED" });
      await storage.createAuditLog({ action: "deactivate_user", tableName: "users", recordId: id, userId: req.user!.id });
      res.json({ ...user, passwordHash: undefined });
    } catch (error) {
      res.status(500).json({ message: "Failed to deactivate user" });
    }
  });
  
  app.delete("/api/admin/users/:id", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const targetUser = await storage.getUserById(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      const user = await storage.softDeleteUser(id, req.user!.id);
      await storage.createAuditLog({ 
        action: "USER_REMOVED", 
        tableName: "users", 
        recordId: id, 
        beforeJson: JSON.stringify({ ...targetUser, passwordHash: undefined }),
        afterJson: JSON.stringify({ ...user, passwordHash: undefined }),
        userId: req.user!.id 
      });
      res.json({ success: true, archived: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // Providers - public read for order creation dropdowns, admin for full CRUD
  app.get("/api/admin/providers", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getProviders()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/providers", auth, async (req, res) => {
    try { 
      const providers = await storage.getProviders();
      res.json(providers.filter(p => p.active).map(p => ({ id: p.id, name: p.name }))); 
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/providers", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.createProvider(req.body);
      await storage.createAuditLog({ action: "create_provider", tableName: "providers", recordId: provider.id, afterJson: JSON.stringify(provider), userId: req.user!.id });
      res.json(provider);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/providers/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const provider = await storage.updateProvider(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_provider", tableName: "providers", recordId: req.params.id, afterJson: JSON.stringify(provider), userId: req.user!.id });
      res.json(provider);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.delete("/api/admin/providers/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const depCount = await storage.getProviderDependencyCount(req.params.id);
      const provider = await storage.softDeleteProvider(req.params.id, req.user!.id);
      await storage.createAuditLog({ 
        action: "PROVIDER_REMOVED", 
        tableName: "providers", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ ...provider, dependenciesArchived: depCount }),
        userId: req.user!.id 
      });
      res.json({ success: true, archived: true, dependencyCount: depCount });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to remove provider" }); }
  });

  // Clients - public read for order creation dropdowns, admin for full CRUD
  app.get("/api/admin/clients", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getClients()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/clients", auth, async (req, res) => {
    try { 
      const clients = await storage.getClients();
      res.json(clients.filter(c => c.active).map(c => ({ id: c.id, name: c.name }))); 
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/clients", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const client = await storage.createClient(req.body);
      await storage.createAuditLog({ action: "create_client", tableName: "clients", recordId: client.id, afterJson: JSON.stringify(client), userId: req.user!.id });
      res.json(client);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/clients/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const client = await storage.updateClient(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_client", tableName: "clients", recordId: req.params.id, afterJson: JSON.stringify(client), userId: req.user!.id });
      res.json(client);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.delete("/api/admin/clients/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const depCount = await storage.getClientDependencyCount(req.params.id);
      const client = await storage.softDeleteClient(req.params.id, req.user!.id);
      await storage.createAuditLog({ 
        action: "CLIENT_REMOVED", 
        tableName: "clients", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ ...client, dependenciesArchived: depCount }),
        userId: req.user!.id 
      });
      res.json({ success: true, archived: true, dependencyCount: depCount });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to remove client" }); }
  });

  // Services - public read for order creation dropdowns, admin for full CRUD
  app.get("/api/admin/services", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getServices()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/services", auth, async (req, res) => {
    try { 
      const services = await storage.getServices();
      res.json(services.filter(s => s.active).map(s => ({ id: s.id, code: s.code, name: s.name }))); 
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  
  // Get available services filtered by client and provider (based on rate cards)
  app.get("/api/services/available", auth, async (req, res) => {
    try {
      const { clientId, providerId } = req.query as { clientId?: string; providerId?: string };
      
      // Get all rate cards and filter by client/provider
      const rateCards = await storage.getRateCards();
      const activeRateCards = rateCards.filter(rc => 
        rc.active && 
        !rc.deletedAt &&
        rc.serviceId && // Only internet service rate cards (not mobile-only)
        (!clientId || !rc.clientId || rc.clientId === clientId) && // Include rate cards for any client OR specific client
        (!providerId || rc.providerId === providerId)
      );
      
      // Get unique service IDs from matching rate cards
      const serviceIds = Array.from(new Set(activeRateCards.map(rc => rc.serviceId).filter(Boolean))) as string[];
      
      // Get all services and filter to only those with matching rate cards
      const allServices = await storage.getServices();
      const availableServices = allServices
        .filter(s => s.active && serviceIds.includes(s.id))
        .map(s => ({ id: s.id, code: s.code, name: s.name }));
      
      res.json(availableServices);
    } catch (error) { 
      res.status(500).json({ message: "Failed to get available services" }); 
    }
  });
  app.post("/api/admin/services", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const service = await storage.createService(req.body);
      await storage.createAuditLog({ action: "create_service", tableName: "services", recordId: service.id, afterJson: JSON.stringify(service), userId: req.user!.id });
      res.json(service);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/services/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const service = await storage.updateService(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_service", tableName: "services", recordId: req.params.id, afterJson: JSON.stringify(service), userId: req.user!.id });
      res.json(service);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.delete("/api/admin/services/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const depCount = await storage.getServiceDependencyCount(req.params.id);
      const service = await storage.softDeleteService(req.params.id, req.user!.id);
      await storage.createAuditLog({ 
        action: "SERVICE_REMOVED", 
        tableName: "services", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ ...service, dependenciesArchived: depCount }),
        userId: req.user!.id 
      });
      res.json({ success: true, archived: true, dependencyCount: depCount });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to remove service" }); }
  });

  // Rate Cards
  app.get("/api/admin/rate-cards", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getRateCards()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  
  // Rate cards for override display (admins and executives)
  app.get("/api/rate-cards/for-overrides", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json(await storage.getRateCards());
    } catch (error) {
      res.status(500).json({ message: "Failed to get rate cards" });
    }
  });
  
  // Check if mobile rates exist for given provider/client/service combo (for order form auto-detect)
  app.get("/api/rate-cards/mobile-check", auth, async (req, res) => {
    try {
      const { providerId, clientId, serviceId } = req.query;
      if (!providerId) return res.status(400).json({ hasMobileRates: false });
      
      // Find any active rate cards with non-zero mobile per-line amounts
      const allRateCards = await storage.getActiveRateCards();
      const mobileRateCards = allRateCards.filter(rc => {
        // Must match provider
        if (rc.providerId !== providerId) return false;
        // Client match (or no client specified on rate card = applies to all)
        if (rc.clientId && clientId && rc.clientId !== clientId) return false;
        // Service match (or no service specified on rate card = applies to all)
        if (rc.serviceId && serviceId && rc.serviceId !== serviceId) return false;
        // Must have mobile rate configured
        const mobileAmount = parseFloat(rc.mobilePerLineAmount || "0");
        return mobileAmount > 0 || rc.mobileProductType;
      });
      
      // Get distinct mobile product types from matching rate cards
      const mobileProductTypes = Array.from(new Set(mobileRateCards.filter(rc => rc.mobileProductType).map(rc => rc.mobileProductType))) as string[];
      
      res.json({ 
        hasMobileRates: mobileRateCards.length > 0,
        mobileProductTypes,
        rateCardCount: mobileRateCards.length
      });
    } catch (error) { 
      res.status(500).json({ hasMobileRates: false }); 
    }
  });
  app.post("/api/admin/rate-cards", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      let { customServiceName, serviceId, ...rateCardData } = req.body;
      
      // If customServiceName provided but no serviceId, create a new service
      if (customServiceName && !serviceId) {
        const code = customServiceName.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 20);
        const newService = await storage.createService({ name: customServiceName, code, active: true });
        await storage.createAuditLog({ action: "create_service", tableName: "services", recordId: newService.id, afterJson: JSON.stringify(newService), userId: req.user!.id });
        serviceId = newService.id;
      }
      
      const rateCard = await storage.createRateCard({ ...rateCardData, serviceId });
      await storage.createAuditLog({ action: "create_rate_card", tableName: "rate_cards", recordId: rateCard.id, afterJson: JSON.stringify(rateCard), userId: req.user!.id });
      res.json(rateCard);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/rate-cards/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      let { customServiceName, serviceId, ...rateCardData } = req.body;
      
      // If customServiceName provided but no serviceId, create a new service
      if (customServiceName && !serviceId) {
        const code = customServiceName.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 20);
        const newService = await storage.createService({ name: customServiceName, code, active: true });
        await storage.createAuditLog({ action: "create_service", tableName: "services", recordId: newService.id, afterJson: JSON.stringify(newService), userId: req.user!.id });
        serviceId = newService.id;
      }
      
      const updateData = serviceId ? { ...rateCardData, serviceId } : rateCardData;
      const rateCard = await storage.updateRateCard(req.params.id, updateData);
      await storage.createAuditLog({ action: "update_rate_card", tableName: "rate_cards", recordId: req.params.id, afterJson: JSON.stringify(rateCard), userId: req.user!.id });
      res.json(rateCard);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.delete("/api/admin/rate-cards/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const depCount = await storage.getRateCardDependencyCount(req.params.id);
      const rateCard = await storage.softDeleteRateCard(req.params.id, req.user!.id);
      await storage.createAuditLog({ 
        action: "RATECARD_REMOVED", 
        tableName: "rate_cards", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ ...rateCard, dependenciesArchived: depCount }),
        userId: req.user!.id 
      });
      res.json({ success: true, archived: true, dependencyCount: depCount });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to remove rate card" }); }
  });

  // Incentives
  app.get("/api/admin/incentives", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getIncentives()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/incentives", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const incentive = await storage.createIncentive(req.body);
      await storage.createAuditLog({ action: "create_incentive", tableName: "incentives", recordId: incentive.id, afterJson: JSON.stringify(incentive), userId: req.user!.id });
      res.json(incentive);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/incentives/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const incentive = await storage.updateIncentive(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_incentive", tableName: "incentives", recordId: req.params.id, afterJson: JSON.stringify(incentive), userId: req.user!.id });
      res.json(incentive);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Override Agreements
  app.get("/api/admin/overrides", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getOverrideAgreements()); } catch (error) { res.status(500).json({ message: "Failed to fetch override agreements" }); }
  });
  app.post("/api/admin/overrides", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const validated = insertOverrideAgreementSchema.parse(req.body);
      const override = await storage.createOverrideAgreement(validated);
      await storage.createAuditLog({ action: "create_override_agreement", tableName: "override_agreements", recordId: override.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json(override);
    } catch (error: any) { 
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      res.status(500).json({ message: error.message || "Failed to create override agreement" }); 
    }
  });
  app.patch("/api/admin/overrides/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const validated = insertOverrideAgreementSchema.partial().parse(req.body);
      const override = await storage.updateOverrideAgreement(req.params.id, validated);
      await storage.createAuditLog({ action: "update_override_agreement", tableName: "override_agreements", recordId: req.params.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json(override);
    } catch (error: any) { 
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      res.status(500).json({ message: error.message || "Failed to update override agreement" }); 
    }
  });
  app.delete("/api/admin/overrides/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const override = await storage.updateOverrideAgreement(req.params.id, { active: false });
      await storage.createAuditLog({ action: "soft_delete_override_agreement", tableName: "override_agreements", recordId: req.params.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to delete override agreement" }); }
  });

  // Pay Runs
  app.get("/api/admin/payruns", auth, executiveOrAdmin, async (req, res) => {
    try {
      const payRuns = await storage.getPayRuns();
      // Enrich with order counts and totals
      const enriched = await Promise.all(payRuns.map(async (pr) => {
        const orders = await storage.getOrdersByPayRunId(pr.id);
        const totalCommission = orders.reduce((sum, o) => 
          sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0
        );
        return {
          ...pr,
          orderCount: orders.length,
          totalCommission: totalCommission.toFixed(2),
        };
      }));
      res.json(enriched);
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/payruns", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const validated = insertPayRunSchema.parse({ ...req.body, createdByUserId: req.user!.id });
      const payRun = await storage.createPayRun(validated);
      await storage.createAuditLog({ action: "create_payrun", tableName: "pay_runs", recordId: payRun.id, afterJson: JSON.stringify(payRun), userId: req.user!.id });
      res.json(payRun);
    } catch (error: any) { 
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.errors });
      res.status(500).json({ message: error.message || "Failed" }); 
    }
  });
  app.delete("/api/admin/payruns/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status === "FINALIZED") return res.status(400).json({ message: "Cannot delete finalized pay runs" });
      
      // Unlink any orders first
      await storage.unlinkOrdersFromPayRun(req.params.id);
      // Soft delete
      const deleted = await storage.updatePayRun(req.params.id, { deletedAt: new Date() });
      await storage.createAuditLog({ action: "delete_payrun", tableName: "pay_runs", recordId: req.params.id, beforeJson: JSON.stringify(payRun), afterJson: JSON.stringify(deleted), userId: req.user!.id });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.post("/api/admin/payruns/:id/submit-review", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status !== "DRAFT") return res.status(400).json({ message: "Pay run must be in DRAFT status" });
      
      const orders = await storage.getOrdersByPayRunId(req.params.id);
      if (orders.length === 0) return res.status(400).json({ message: "Pay run has no orders linked" });
      
      let totalCommission = 0;
      for (const order of orders) {
        totalCommission += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
      }
      
      const beforeJson = JSON.stringify({ status: payRun.status });
      const updated = await storage.updatePayRun(req.params.id, { status: "PENDING_REVIEW" });
      await storage.createAuditLog({ action: "submit_payrun_review", tableName: "pay_runs", recordId: req.params.id, beforeJson, afterJson: JSON.stringify(updated), userId: req.user!.id });
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/submit-approval", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status !== "PENDING_REVIEW") return res.status(400).json({ message: "Pay run must be in PENDING_REVIEW status" });
      
      const beforeJson = JSON.stringify({ status: payRun.status });
      const updated = await storage.updatePayRun(req.params.id, { status: "PENDING_APPROVAL" });
      await storage.createAuditLog({ action: "submit_payrun_approval", tableName: "pay_runs", recordId: req.params.id, beforeJson, afterJson: JSON.stringify(updated), userId: req.user!.id });
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/approve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status !== "PENDING_APPROVAL") return res.status(400).json({ message: "Pay run must be in PENDING_APPROVAL status" });
      
      const beforeJson = JSON.stringify({ status: payRun.status });
      const updated = await storage.updatePayRun(req.params.id, { status: "APPROVED" });
      await storage.createAuditLog({ action: "approve_payrun", tableName: "pay_runs", recordId: req.params.id, beforeJson, afterJson: JSON.stringify(updated), userId: req.user!.id });
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/reject", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (!["PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED"].includes(payRun.status)) {
        return res.status(400).json({ message: "Pay run cannot be rejected in current status" });
      }
      
      const updated = await storage.updatePayRun(req.params.id, { status: "DRAFT" });
      await storage.createAuditLog({ action: "reject_payrun", tableName: "pay_runs", recordId: req.params.id, beforeJson: JSON.stringify({ status: payRun.status }), afterJson: JSON.stringify(updated), userId: req.user!.id });
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.get("/api/admin/payruns/:id/variance", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      
      const orders = await storage.getOrdersByPayRunId(req.params.id);
      const statements = await storage.getPayStatements(req.params.id);
      
      let totalGross = 0;
      let totalDeductions = 0;
      let totalNetPay = 0;
      const issues: string[] = [];
      const repSummaries: { repId: string; name: string; gross: number; deductions: number; net: number; hasNegative: boolean }[] = [];
      
      for (const order of orders) {
        totalGross += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
      }
      
      for (const stmt of statements) {
        const gross = parseFloat(stmt.grossCommission) + parseFloat(stmt.overrideEarningsTotal) + parseFloat(stmt.incentivesTotal);
        const deductions = parseFloat(stmt.deductionsTotal);
        const net = parseFloat(stmt.netPay);
        
        totalDeductions += deductions;
        totalNetPay += net;
        
        const hasNegative = net < 0;
        if (hasNegative) issues.push(`${stmt.userId} has negative net pay of $${net.toFixed(2)}`);
        
        repSummaries.push({
          repId: stmt.userId,
          name: stmt.userId,
          gross,
          deductions,
          net,
          hasNegative,
        });
      }
      
      if (orders.length === 0) issues.push("No orders linked to pay run");
      
      res.json({
        payRunId: payRun.id,
        status: payRun.status,
        orderCount: orders.length,
        statementCount: statements.length,
        totalGross: totalGross.toFixed(2),
        totalDeductions: totalDeductions.toFixed(2),
        totalNetPay: totalNetPay.toFixed(2),
        issues,
        canFinalize: issues.length === 0 && payRun.status === "APPROVED",
        repSummaries,
      });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/finalize", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status !== "APPROVED") return res.status(400).json({ message: "Pay run must be approved before finalizing" });
      
      const orders = await storage.getOrdersByPayRunId(req.params.id);
      if (orders.length === 0) return res.status(400).json({ message: "Pay run has no orders linked" });
      
      const statements = await storage.getPayStatements(req.params.id);
      for (const stmt of statements) {
        const net = parseFloat(stmt.netPay);
        if (net < 0) {
          return res.status(400).json({ message: `Cannot finalize: ${stmt.userId} has negative net pay of $${net.toFixed(2)}. Please resolve before finalizing.` });
        }
      }
      
      // ========== DISTRIBUTE OVERRIDE POOL DEDUCTIONS (Manual Distribution) ==========
      const orderIds = orders.map(o => o.id);
      const pendingPoolEntries = await storage.getOverrideDeductionPoolByOrderIds(orderIds);
      
      // Get manual distributions configured for this pay run
      const manualDistributions = await storage.getOverrideDistributionsByPayRun(req.params.id);
      
      // Check if all pool entries have distributions configured
      const distributedPoolIds = new Set(manualDistributions.map(d => d.poolEntryId));
      const undistributedEntries = pendingPoolEntries.filter(e => !distributedPoolIds.has(e.id));
      
      // If there are undistributed pool entries, warn but allow finalization
      // (Pool amounts without distributions will remain in pool for next pay run)
      
      const distributionResults: { recipientId: string; amount: number; orderId: string }[] = [];
      
      // Process manual distributions
      for (const dist of manualDistributions) {
        const poolEntry = pendingPoolEntries.find(e => e.id === dist.poolEntryId);
        if (!poolEntry) continue;
        
        const order = orders.find(o => o.id === poolEntry.salesOrderId);
        if (!order) continue;
        
        // Create override earning for this distribution
        const recipient = await storage.getUserById(dist.recipientUserId);
        const earning = await storage.createOverrideEarning({
          salesOrderId: order.id,
          recipientUserId: dist.recipientUserId,
          sourceRepId: order.repId,
          sourceLevelUsed: recipient?.role as any || "SUPERVISOR",
          amount: dist.calculatedAmount,
          payRunId: req.params.id,
        });
        
        distributionResults.push({
          recipientId: dist.recipientUserId,
          amount: parseFloat(dist.calculatedAmount),
          orderId: order.id,
        });
        
        await storage.createAuditLog({
          action: "apply_override_distribution",
          tableName: "override_earnings",
          recordId: earning.id,
          afterJson: JSON.stringify({ ...earning, distributionId: dist.id, poolEntryId: dist.poolEntryId }),
          userId: req.user!.id,
        });
      }
      
      // Mark distributions as applied
      if (manualDistributions.length > 0) {
        await storage.applyOverrideDistributions(req.params.id);
      }
      
      // Mark distributed pool entries as DISTRIBUTED
      const distributedPoolEntryIds = Array.from(distributedPoolIds);
      if (distributedPoolEntryIds.length > 0) {
        await storage.markPoolEntriesDistributedByIds(distributedPoolEntryIds, req.params.id);
      }
      
      // Update or create pay statements for recipients of override earnings
      const recipientTotals: Record<string, number> = {};
      for (const dist of distributionResults) {
        recipientTotals[dist.recipientId] = (recipientTotals[dist.recipientId] || 0) + dist.amount;
      }
      
      for (const [recipientId, addedOverride] of Object.entries(recipientTotals)) {
        const existingStatement = statements.find(s => s.userId === recipientId);
        if (existingStatement) {
          const currentOverride = parseFloat(existingStatement.overrideEarningsTotal);
          const newOverrideTotal = currentOverride + addedOverride;
          const grossBase = parseFloat(existingStatement.grossCommission) + parseFloat(existingStatement.incentivesTotal);
          const adjustments = parseFloat(existingStatement.adjustmentsTotal || "0");
          const newNetPay = grossBase + newOverrideTotal + adjustments - parseFloat(existingStatement.chargebacksTotal) - parseFloat(existingStatement.deductionsTotal) - parseFloat(existingStatement.advancesApplied);
          
          await storage.updatePayStatement(existingStatement.id, {
            overrideEarningsTotal: newOverrideTotal.toFixed(2),
            netPay: newNetPay.toFixed(2),
          });
        } else {
          const currentYear = new Date().getFullYear();
          const ytd = await storage.getYTDTotalsForUser(recipientId, currentYear);
          
          await storage.createPayStatement({
            payRunId: req.params.id,
            userId: recipientId,
            periodStart: payRun.weekEndingDate,
            periodEnd: payRun.weekEndingDate,
            grossCommission: "0.00",
            overrideEarningsTotal: addedOverride.toFixed(2),
            incentivesTotal: "0.00",
            chargebacksTotal: "0.00",
            adjustmentsTotal: "0.00",
            deductionsTotal: "0.00",
            advancesApplied: "0.00",
            taxWithheld: "0.00",
            netPay: addedOverride.toFixed(2),
            ytdGross: (parseFloat(ytd.totalGross) + addedOverride).toFixed(2),
            ytdDeductions: ytd.totalDeductions,
            ytdNetPay: (parseFloat(ytd.totalNetPay) + addedOverride).toFixed(2),
          });
        }
      }
      // ========== END DISTRIBUTE OVERRIDE POOL ==========
      
      const beforeJson = JSON.stringify({ status: payRun.status });
      const updated = await storage.updatePayRun(req.params.id, { status: "FINALIZED", finalizedAt: new Date() });
      await storage.createAuditLog({ 
        action: "finalize_payrun", 
        tableName: "pay_runs", 
        recordId: req.params.id, 
        beforeJson, 
        afterJson: JSON.stringify({ ...updated, overrideDistributions: distributionResults.length }), 
        userId: req.user!.id 
      });
      res.json({ ...updated, overrideDistributions: distributionResults.length });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.get("/api/admin/payruns/:id", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      
      const orders = await storage.getOrdersByPayRunId(req.params.id);
      
      // Calculate totals
      let totalCommission = 0;
      const repTotals: Record<string, { name: string; total: number; count: number }> = {};
      
      for (const order of orders) {
        const commission = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        totalCommission += commission;
        
        if (!repTotals[order.repId]) {
          repTotals[order.repId] = { name: order.repId, total: 0, count: 0 };
        }
        repTotals[order.repId].total += commission;
        repTotals[order.repId].count++;
      }
      
      res.json({
        ...payRun,
        orders,
        stats: {
          totalOrders: orders.length,
          totalCommission: totalCommission.toFixed(2),
          repBreakdown: Object.values(repTotals).sort((a, b) => b.total - a.total),
        },
      });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/link-orders", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      if (!orderIds?.length) return res.status(400).json({ message: "No orders to link" });
      
      const orders = await storage.linkOrdersToPayRun(orderIds, req.params.id);
      
      // Also link override earnings for these orders to this pay run
      await storage.updateOverrideEarningsPayRunId(orderIds, req.params.id);
      
      await storage.createAuditLog({ 
        action: "link_orders_to_payrun", 
        tableName: "pay_runs", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ orderIds }), 
        userId: req.user!.id 
      });
      res.json({ linked: orders.length });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  
  app.post("/api/admin/payruns/:id/unlink-orders", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      if (!orderIds?.length) return res.status(400).json({ message: "No orders to unlink" });
      
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status === "FINALIZED") return res.status(400).json({ message: "Cannot unlink from finalized pay runs" });
      
      // Unlink specified orders using storage method
      await storage.unlinkSpecificOrders(orderIds);
      
      // Also unlink override earnings for these orders
      await storage.updateOverrideEarningsPayRunId(orderIds, null);
      
      await storage.createAuditLog({ 
        action: "unlink_orders_from_payrun", 
        tableName: "pay_runs", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ orderIds }), 
        userId: req.user!.id 
      });
      res.json({ unlinked: orderIds.length });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Get approved orders not yet linked to a pay run
  // If weekEndingDate is provided, filter orders by approval date falling within that pay week
  app.get("/api/admin/payruns/unlinked-orders", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const weekEndingDate = req.query.weekEndingDate as string | undefined;
      const orders = await storage.getOrders();
      
      let unlinked = orders.filter(o => 
        o.approvalStatus === "APPROVED" && 
        o.paymentStatus === "UNPAID" && 
        !o.payRunId
      );
      
      // If weekEndingDate is provided, filter by approval date within the pay week
      // Pay week is 7 days ending on weekEndingDate (inclusive)
      if (weekEndingDate) {
        const weekEnd = new Date(weekEndingDate);
        weekEnd.setHours(23, 59, 59, 999);
        const weekStart = new Date(weekEndingDate);
        weekStart.setDate(weekStart.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);
        
        unlinked = unlinked.filter(o => {
          if (!o.approvedAt) return false;
          const approvedAt = new Date(o.approvedAt);
          return approvedAt >= weekStart && approvedAt <= weekEnd;
        });
      }
      
      res.json(unlinked);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Adjustments
  app.get("/api/adjustments", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (user.role === "ADMIN") {
        res.json(await storage.getAdjustments());
      } else {
        res.json(await storage.getAdjustmentsByUser(user.id));
      }
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/adjustments", auth, async (req: AuthRequest, res) => {
    try {
      const adjustment = await storage.createAdjustment({ ...req.body, createdByUserId: req.user!.id });
      await storage.createAuditLog({ action: "create_adjustment", tableName: "adjustments", recordId: adjustment.id, afterJson: JSON.stringify(adjustment), userId: req.user!.id });
      res.json(adjustment);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  const canApproveAdjustments = (req: AuthRequest, res: any, next: any) => {
    if (req.user?.role === "ADMIN" || req.user?.role === "OPERATIONS" || req.user?.role === "EXECUTIVE") {
      next();
    } else {
      res.status(403).json({ message: "Only Admin and Executive can approve adjustments" });
    }
  };

  app.post("/api/admin/adjustments/:id/approve", auth, canApproveAdjustments, async (req: AuthRequest, res) => {
    try {
      const adjustment = await storage.updateAdjustment(req.params.id, { approvalStatus: "APPROVED", approvedByUserId: req.user!.id, approvedAt: new Date() });
      await storage.createAuditLog({ action: "approve_adjustment", tableName: "adjustments", recordId: req.params.id, afterJson: JSON.stringify(adjustment), userId: req.user!.id });
      res.json(adjustment);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.post("/api/admin/adjustments/:id/reject", auth, canApproveAdjustments, async (req: AuthRequest, res) => {
    try {
      const adjustment = await storage.updateAdjustment(req.params.id, { approvalStatus: "REJECTED", approvedByUserId: req.user!.id, approvedAt: new Date() });
      await storage.createAuditLog({ action: "reject_adjustment", tableName: "adjustments", recordId: req.params.id, afterJson: JSON.stringify(adjustment), userId: req.user!.id });
      res.json(adjustment);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Override Deduction Pool
  app.get("/api/admin/override-pool", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as "PENDING" | "DISTRIBUTED" | undefined;
      const entries = await storage.getOverrideDeductionPoolEntries(status);
      
      // Enrich with order and rate card details
      const enrichedEntries = await Promise.all(entries.map(async (entry) => {
        const order = await storage.getOrderById(entry.salesOrderId);
        const rateCard = await storage.getRateCardById(entry.rateCardId);
        return {
          ...entry,
          invoiceNumber: order?.invoiceNumber,
          repId: order?.repId,
          dateSold: order?.dateSold,
          rateCardName: rateCard ? `${rateCard.providerId ? "Provider" : "General"} Rate` : "Unknown",
        };
      }));
      
      res.json(enrichedEntries);
    } catch (error) { res.status(500).json({ message: "Failed to fetch pool entries" }); }
  });

  app.get("/api/admin/override-pool/total", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const total = await storage.getPendingPoolTotal();
      res.json({ total });
    } catch (error) { res.status(500).json({ message: "Failed to fetch pool total" }); }
  });

  // Override Distribution Management (Manual Distribution)
  app.get("/api/admin/payruns/:id/override-pool", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getOrdersByPayRunId(req.params.id);
      if (orders.length === 0) return res.json([]);
      
      const orderIds = orders.map(o => o.id);
      const poolEntries = await storage.getOverrideDeductionPoolByOrderIds(orderIds);
      
      // Enrich with order details and existing distributions
      const enrichedEntries = await Promise.all(poolEntries.map(async (entry) => {
        const order = orders.find(o => o.id === entry.salesOrderId);
        const distributions = await storage.getOverrideDistributionsByPoolEntry(entry.id);
        const distributedTotal = distributions.reduce((sum, d) => sum + parseFloat(d.calculatedAmount), 0);
        
        // Enrich distributions with recipient names
        const enrichedDistributions = await Promise.all(distributions.map(async (dist) => {
          const recipient = await storage.getUserById(dist.recipientUserId);
          return {
            ...dist,
            recipientName: recipient?.name || "Unknown",
            recipientRepId: recipient?.repId || "Unknown",
          };
        }));
        
        return {
          ...entry,
          invoiceNumber: order?.invoiceNumber,
          repId: order?.repId,
          dateSold: order?.dateSold,
          distributions: enrichedDistributions,
          distributedTotal: distributedTotal.toFixed(2),
          remainingAmount: (parseFloat(entry.amount) - distributedTotal).toFixed(2),
        };
      }));
      
      res.json(enrichedEntries);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.get("/api/admin/payruns/:id/distributions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const distributions = await storage.getOverrideDistributionsByPayRun(req.params.id);
      
      // Enrich with recipient names and pool entry details
      const enriched = await Promise.all(distributions.map(async (dist) => {
        const recipient = await storage.getUserById(dist.recipientUserId);
        const poolEntry = await storage.getOverrideDeductionPoolByOrderId(dist.poolEntryId);
        return {
          ...dist,
          recipientName: recipient?.name || "Unknown",
          recipientRepId: recipient?.repId || "Unknown",
        };
      }));
      
      res.json(enriched);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.post("/api/admin/payruns/:id/distributions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { poolEntryId, recipientUserId, allocationType, allocationValue } = req.body;
      
      // Get pool entry to validate and calculate amount
      const poolEntries = await storage.getOverrideDeductionPoolByOrderId(poolEntryId);
      const poolEntry = poolEntries.find(e => e.id === poolEntryId);
      if (!poolEntry) {
        // Try to get by ID directly
        const allEntries = await storage.getOverrideDeductionPoolEntries();
        const entry = allEntries.find(e => e.id === poolEntryId);
        if (!entry) return res.status(404).json({ message: "Pool entry not found" });
      }
      
      const poolAmount = parseFloat(poolEntry?.amount || "0");
      let calculatedAmount = 0;
      
      if (allocationType === "PERCENT") {
        calculatedAmount = poolAmount * (parseFloat(allocationValue) / 100);
      } else {
        calculatedAmount = parseFloat(allocationValue);
      }
      
      // Check if distribution would exceed pool amount
      const existingDistributions = await storage.getOverrideDistributionsByPoolEntry(poolEntryId);
      const existingTotal = existingDistributions.reduce((sum, d) => sum + parseFloat(d.calculatedAmount), 0);
      
      if (existingTotal + calculatedAmount > poolAmount + 0.01) {
        return res.status(400).json({ 
          message: `Distribution exceeds pool amount. Available: $${(poolAmount - existingTotal).toFixed(2)}` 
        });
      }
      
      const distribution = await storage.createOverrideDistribution({
        payRunId: req.params.id,
        poolEntryId,
        recipientUserId,
        allocationType,
        allocationValue: allocationValue.toString(),
        calculatedAmount: calculatedAmount.toFixed(2),
        status: "PENDING",
        createdByUserId: req.user!.id,
      });
      
      await storage.createAuditLog({
        action: "create_override_distribution",
        tableName: "override_distributions",
        recordId: distribution.id,
        afterJson: JSON.stringify(distribution),
        userId: req.user!.id,
      });
      
      res.json(distribution);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  app.delete("/api/admin/payruns/:payRunId/distributions/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteOverrideDistribution(req.params.id);
      await storage.createAuditLog({
        action: "delete_override_distribution",
        tableName: "override_distributions",
        recordId: req.params.id,
        userId: req.user!.id,
      });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Accounting Export/Import
  app.post("/api/admin/accounting/export-approved", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getApprovedUnexported();
      if (orders.length === 0) {
        return res.status(400).json({ message: "No orders to export" });
      }

      const batch = await storage.createExportBatch(req.user!.id, orders.length, `export-${new Date().toISOString()}.csv`);
      
      for (const order of orders) {
        await storage.updateOrder(order.id, { exportedToAccounting: true, exportBatchId: batch.id, exportedAt: new Date() });
      }

      // Helper to format date as MM/DD/YYYY
      const formatDate = (dateStr: string | null | undefined): string => {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const year = d.getFullYear();
        return `${month}/${day}/${year}`;
      };

      // Build CSV data with override deduction info
      const csvData = await Promise.all(orders.map(async (o: any) => {
        // Base commission from rate card
        const baseCommission = parseFloat(o.baseCommissionEarned || "0");
        const incentive = parseFloat(o.incentiveEarned || "0");
        const grossCommission = baseCommission + incentive;
        
        // Get override deductions for this order from the pool
        const poolEntries = await storage.getOverrideDeductionPoolByOrderId(o.id);
        const totalOverrideDeduction = poolEntries.reduce((sum, entry) => sum + parseFloat(entry.amount || "0"), 0);
        
        // Net commission after override deduction
        const netCommission = grossCommission - totalOverrideDeduction;

        // Install type labels
        const typeLabels: Record<string, string> = {
          "AGENT_INSTALL": "Agent Install",
          "DIRECT_SHIP": "Direct Ship",
          "TECH_INSTALL": "Tech Install",
        };
        
        // Look up user name by repId
        const user = await storage.getUserByRepId(o.repId);
        
        return {
          "Invoice #": o.invoiceNumber || "",
          "Rep ID": o.repId,
          "Customer Name": o.customerName || "",
          "Account #": o.accountNumber || "",
          "Date Sold": formatDate(o.dateSold),
          "Install Date": formatDate(o.installDate),
          "Install Type": o.installType ? (typeLabels[o.installType] || o.installType) : "",
          "Approval Status": o.approvalStatus || "",
          "Base Commission": baseCommission.toFixed(2),
          "Incentive": incentive.toFixed(2),
          "Gross Commission": grossCommission.toFixed(2),
          "Override": totalOverrideDeduction.toFixed(2),
          "Net Commission": netCommission.toFixed(2),
          "Client": o.client?.name || "",
          "Provider": o.provider?.name || "",
          "User Name": user?.name || "",
        };
      }));

      const csv = stringify(csvData, { header: true });
      await storage.createAuditLog({ action: "export_accounting", tableName: "sales_orders", afterJson: JSON.stringify({ count: orders.length, batchId: batch.id }), userId: req.user!.id });
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="export-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csv);
    } catch (error) { res.status(500).json({ message: "Export failed" }); }
  });

  app.post("/api/admin/accounting/import-payments", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      // Validate file upload
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (req.file.size > MAX_FILE_SIZE) {
        return res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
      }
      // Validate file extension
      if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
        return res.status(415).json({ message: "Invalid file type. Only CSV files are allowed for payment imports" });
      }

      const payRunId = req.body.payRunId || null;
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, any>[];
      
      if (!validateRowCount(records, res)) return;

      let matched = 0;
      let unmatched = 0;
      const unmatchedRows: any[] = [];

      for (const row of records) {
        const invoiceNumber = row.invoiceNumber || row.invoice_number || row.Invoice || row["Invoice Number"] || row.InvoiceNumber;
        const amount = parseFloat(row.amount || row.Amount || row.payment || row.Payment || "0");
        const paidDate = row.paidDate || row.paid_date || row.PaidDate || row.date || row.Date || new Date().toISOString().split("T")[0];
        const quickbooksRefId = row.refId || row.ref_id || row.RefId || row.reference || row.Reference || null;

        if (!invoiceNumber) {
          unmatchedRows.push({ row, reason: "Missing invoice number" });
          unmatched++;
          continue;
        }

        const order = await storage.getOrderByInvoiceNumber(invoiceNumber);
        if (order) {
          await storage.updateOrder(order.id, {
            paidDate: paidDate,
            commissionPaid: amount.toString(),
            paymentStatus: "PAID",
            quickbooksRefId: quickbooksRefId,
            payRunId: payRunId,
          });
          matched++;
        } else {
          await storage.createUnmatchedPayment({
            payRunId: payRunId,
            rawRowJson: JSON.stringify(row),
            reason: `No order found with invoice number: ${invoiceNumber}`,
          });
          unmatched++;
        }
      }

      await storage.createAuditLog({
        action: "import_payments",
        tableName: "sales_orders",
        afterJson: JSON.stringify({ matched, unmatched, payRunId }),
        userId: req.user!.id,
      });

      res.json({ matched, unmatched, message: `Imported ${matched} payments, ${unmatched} unmatched` });
    } catch (error: any) {
      console.error("Payment import error:", error);
      res.status(500).json({ message: error.message || "Import failed" });
    }
  });

  // Chargeback import
  app.post("/api/admin/chargebacks/import", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      // Validate file upload
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (req.file.size > MAX_FILE_SIZE) {
        return res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
      }
      // Validate file extension
      if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
        return res.status(415).json({ message: "Invalid file type. Only CSV files are allowed for chargeback imports" });
      }

      const payRunId = req.body.payRunId || null;
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, any>[];
      
      if (!validateRowCount(records, res)) return;

      let matched = 0;
      let unmatched = 0;

      for (const row of records) {
        const invoiceNumber = row.invoiceNumber || row.invoice_number || row.Invoice || row["Invoice Number"] || row.InvoiceNumber;
        const amount = parseFloat(row.amount || row.Amount || row.chargeback || row.Chargeback || "0");
        const chargebackDate = row.chargebackDate || row.chargeback_date || row.date || row.Date || new Date().toISOString().split("T")[0];
        const reason = row.reason || row.Reason || "CANCELLATION";
        const notes = row.notes || row.Notes || null;
        const quickbooksRefId = row.refId || row.ref_id || row.RefId || row.reference || row.Reference || null;

        if (!invoiceNumber) {
          await storage.createUnmatchedChargeback({
            payRunId: payRunId,
            rawRowJson: JSON.stringify(row),
            reason: "Missing invoice number",
          });
          unmatched++;
          continue;
        }

        const order = await storage.getOrderByInvoiceNumber(invoiceNumber);
        if (order) {
          await storage.createChargeback({
            invoiceNumber: invoiceNumber,
            salesOrderId: order.id,
            repId: order.repId,
            amount: Math.abs(amount).toString(),
            reason: reason as any,
            chargebackDate: chargebackDate,
            quickbooksRefId: quickbooksRefId,
            payRunId: payRunId,
            notes: notes,
            createdByUserId: req.user!.id,
          });
          matched++;
        } else {
          await storage.createUnmatchedChargeback({
            payRunId: payRunId,
            rawRowJson: JSON.stringify(row),
            reason: `No order found with invoice number: ${invoiceNumber}`,
          });
          unmatched++;
        }
      }

      await storage.createAuditLog({
        action: "import_chargebacks",
        tableName: "chargebacks",
        afterJson: JSON.stringify({ matched, unmatched, payRunId }),
        userId: req.user!.id,
      });

      res.json({ matched, unmatched, message: `Imported ${matched} chargebacks, ${unmatched} unmatched` });
    } catch (error: any) {
      console.error("Chargeback import error:", error);
      res.status(500).json({ message: error.message || "Import failed" });
    }
  });

  // Bulk commission recalculation
  app.post("/api/admin/recalculate-commissions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { orderIds, providerId, clientId, dateFrom, dateTo, recalculateAll } = req.body;
      
      let orders: SalesOrder[];
      
      if (recalculateAll) {
        orders = await storage.getOrders({});
      } else if (orderIds && orderIds.length > 0) {
        orders = await Promise.all(orderIds.map((id: string) => storage.getOrderById(id)));
        orders = orders.filter((o): o is SalesOrder => o !== undefined);
      } else {
        const allOrders = await storage.getOrders({});
        orders = allOrders.filter((o: SalesOrder) => {
          if (providerId && o.providerId !== providerId) return false;
          if (clientId && o.clientId !== clientId) return false;
          if (dateFrom && new Date(o.dateSold) < new Date(dateFrom)) return false;
          if (dateTo && new Date(o.dateSold) > new Date(dateTo)) return false;
          return true;
        });
      }

      let recalculated = 0;
      let errors = 0;
      const errorDetails: string[] = [];

      for (const order of orders) {
        try {
          await storage.deleteCommissionLineItemsByOrderId(order.id);
          
          const rateCard = await storage.findMatchingRateCard(order, order.dateSold);
          let baseCommission = "0";
          let appliedRateCardId: string | null = null;
          
          if (rateCard) {
            const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
            await storage.createCommissionLineItems(order.id, lineItems);
            const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
            appliedRateCardId = rateCard.id;
            
            // Check if sales rep is an EXECUTIVE (exempt from override deductions)
            const salesRep = await storage.getUserByRepId(order.repId);
            const isExecutiveSale = salesRep?.role === "EXECUTIVE";
            
            // Calculate override deductions to subtract from rep's commission (NOT for executives)
            let totalDeductions = 0;
            if (!isExecutiveSale) {
              totalDeductions += parseFloat(rateCard.overrideDeduction || "0");
              if (order.tvSold) {
                totalDeductions += parseFloat(rateCard.tvOverrideDeduction || "0");
              }
              if (order.mobileSold) {
                totalDeductions += parseFloat((rateCard as any).mobileOverrideDeduction || "0");
              }
            }
            baseCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
          }
          
          await storage.updateOrder(order.id, {
            baseCommissionEarned: baseCommission,
            appliedRateCardId,
            calcAt: new Date(),
          });
          
          recalculated++;
        } catch (err: any) {
          errors++;
          errorDetails.push(`Order ${order.invoiceNumber || order.id}: ${err.message}`);
        }
      }

      await storage.createAuditLog({
        action: "bulk_recalculate_commissions",
        tableName: "sales_orders",
        afterJson: JSON.stringify({ recalculated, errors, filters: { providerId, clientId, dateFrom, dateTo, recalculateAll } }),
        userId: req.user!.id,
      });

      res.json({ 
        recalculated, 
        errors, 
        total: orders.length,
        errorDetails: errorDetails.slice(0, 10),
        message: `Recalculated ${recalculated} orders${errors > 0 ? `, ${errors} errors` : ""}` 
      });
    } catch (error: any) {
      console.error("Bulk recalculation error:", error);
      res.status(500).json({ message: error.message || "Recalculation failed" });
    }
  });

  // Reports API
  app.get("/api/admin/reports/summary", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { dateFrom, dateTo, providerId, clientId } = req.query as Record<string, string>;
      
      let orders: SalesOrder[] = await storage.getOrders({});
      
      if (dateFrom) orders = orders.filter((o: SalesOrder) => new Date(o.dateSold) >= new Date(dateFrom));
      if (dateTo) orders = orders.filter((o: SalesOrder) => new Date(o.dateSold) <= new Date(dateTo));
      if (providerId) orders = orders.filter((o: SalesOrder) => o.providerId === providerId);
      if (clientId) orders = orders.filter((o: SalesOrder) => o.clientId === clientId);

      const users = await storage.getUsers();
      const providers = await storage.getProviders();
      const clients = await storage.getClients();

      const totalOrders = orders.length;
      const approvedOrders = orders.filter((o: SalesOrder) => o.approvalStatus === "APPROVED").length;
      const pendingOrders = orders.filter((o: SalesOrder) => o.approvalStatus === "UNAPPROVED").length;
      const completedOrders = orders.filter((o: SalesOrder) => o.jobStatus === "COMPLETED").length;
      
      const totalEarned = orders
        .filter((o: SalesOrder) => o.approvalStatus === "APPROVED")
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const totalPaid = orders
        .filter((o: SalesOrder) => o.paymentStatus === "PAID")
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.commissionPaid), 0);

      const repPerformance = users
        .filter((u: User) => ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"].includes(u.role))
        .map((rep: User) => {
          const repOrders = orders.filter((o: SalesOrder) => o.repId === rep.repId);
          const repEarned = repOrders
            .filter((o: SalesOrder) => o.approvalStatus === "APPROVED")
            .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
          return {
            repId: rep.repId,
            name: rep.name,
            role: rep.role,
            orderCount: repOrders.length,
            approvedCount: repOrders.filter((o: SalesOrder) => o.approvalStatus === "APPROVED").length,
            totalEarned: repEarned,
          };
        })
        .filter((r: { orderCount: number }) => r.orderCount > 0)
        .sort((a: { totalEarned: number }, b: { totalEarned: number }) => b.totalEarned - a.totalEarned);

      const providerBreakdown = providers.map((provider: Provider) => {
        const providerOrders = orders.filter((o: SalesOrder) => o.providerId === provider.id);
        const earned = providerOrders
          .filter((o: SalesOrder) => o.approvalStatus === "APPROVED")
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        return {
          id: provider.id,
          name: provider.name,
          orderCount: providerOrders.length,
          totalEarned: earned,
        };
      }).filter((p: { orderCount: number }) => p.orderCount > 0).sort((a: { totalEarned: number }, b: { totalEarned: number }) => b.totalEarned - a.totalEarned);

      const clientBreakdown = clients.map((client: Client) => {
        const clientOrders = orders.filter((o: SalesOrder) => o.clientId === client.id);
        const earned = clientOrders
          .filter((o: SalesOrder) => o.approvalStatus === "APPROVED")
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        return {
          id: client.id,
          name: client.name,
          orderCount: clientOrders.length,
          totalEarned: earned,
        };
      }).filter((c: { orderCount: number }) => c.orderCount > 0).sort((a: { totalEarned: number }, b: { totalEarned: number }) => b.totalEarned - a.totalEarned);

      const monthlyTrend = orders.reduce((acc: Record<string, { month: string; orders: number; earned: number }>, order: SalesOrder) => {
        const month = order.dateSold.substring(0, 7);
        if (!acc[month]) {
          acc[month] = { month, orders: 0, earned: 0 };
        }
        acc[month].orders++;
        if (order.approvalStatus === "APPROVED") {
          acc[month].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
        return acc;
      }, {} as Record<string, { month: string; orders: number; earned: number }>);

      res.json({
        summary: {
          totalOrders,
          approvedOrders,
          pendingOrders,
          completedOrders,
          totalEarned,
          totalPaid,
          outstandingBalance: totalEarned - totalPaid,
        },
        repPerformance,
        providerBreakdown,
        clientBreakdown,
        monthlyTrend: Object.values(monthlyTrend).sort((a, b) => a.month.localeCompare(b.month)),
      });
    } catch (error: any) {
      console.error("Reports error:", error);
      res.status(500).json({ message: error.message || "Failed to generate reports" });
    }
  });

  // Export Batches
  app.get("/api/admin/accounting/export-batches", auth, executiveOrAdmin, async (req, res) => {
    try {
      const batches = await storage.getExportBatches();
      res.json(batches);
    } catch (error) { res.status(500).json({ message: "Failed to get export batches" }); }
  });

  app.get("/api/admin/accounting/export-batches/:id", auth, executiveOrAdmin, async (req, res) => {
    try {
      const batch = await storage.getExportBatchById(req.params.id);
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      const orders = await storage.getOrdersByExportBatch(req.params.id);
      res.json({ batch, orders });
    } catch (error) { res.status(500).json({ message: "Failed to get export batch" }); }
  });

  app.delete("/api/admin/accounting/export-batches/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteExportBatch(req.params.id);
      await storage.createAuditLog({ action: "delete_export_batch", tableName: "export_batches", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Export batch deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete export batch" }); }
  });

  app.get("/api/admin/accounting/exported-orders", auth, adminOnly, async (req, res) => {
    try {
      const orders = await storage.getExportedOrders();
      res.json(orders);
    } catch (error) { res.status(500).json({ message: "Failed to get exported orders" }); }
  });

  // Exception Queues
  app.get("/api/admin/queues/unmatched-payments", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getUnmatchedPayments()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/unmatched-chargebacks", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getUnmatchedChargebacks()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/rate-issues", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getRateIssues()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/queues/:type/:id/resolve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { type, id } = req.params;
      const { resolutionNote } = req.body;
      let result;
      if (type === "unmatched-payments") {
        result = await storage.resolveUnmatchedPayment(id, req.user!.id, resolutionNote);
      } else if (type === "unmatched-chargebacks") {
        result = await storage.resolveUnmatchedChargeback(id, req.user!.id, resolutionNote);
      } else if (type === "rate-issues") {
        result = await storage.resolveRateIssue(id, req.user!.id, resolutionNote);
      }
      await storage.createAuditLog({ action: `resolve_${type}`, tableName: type.replace(/-/g, "_"), recordId: id, afterJson: JSON.stringify(result), userId: req.user!.id });
      res.json(result);
    } catch (error) { res.status(500).json({ message: "Failed to resolve" }); }
  });

  // Audit Log
  app.get("/api/admin/audit", auth, executiveOrAdmin, async (req, res) => {
    try { res.json(await storage.getAuditLogs()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });

  // Leads - accessible by all authenticated users for their own leads
  app.get("/api/leads", auth, async (req: AuthRequest, res) => {
    try {
      const { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName, viewRepId } = req.query as {
        zipCode?: string;
        street?: string;
        city?: string;
        dateFrom?: string;
        dateTo?: string;
        houseNumber?: string;
        streetName?: string;
        viewRepId?: string;
      };
      
      // Determine which rep's leads to fetch
      let targetRepId = req.user!.repId;
      const canViewOthers = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      
      if (viewRepId && canViewOthers) {
        // Verify caller can view this rep's leads (target must be at or below caller's level)
        const users = await storage.getUsers();
        const targetUser = users.find(u => u.repId === viewRepId && !u.deletedAt);
        if (targetUser) {
          const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
          const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
          if (targetLevel <= callerLevel) {
            targetRepId = viewRepId;
          }
        }
      }
      
      let leads = await storage.getLeadsByRepId(targetRepId, { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName });
      
      // When SUPERVISOR+ is viewing another rep's leads, include SOLD/REJECTED leads
      // Otherwise filter them out (for own leads view)
      if (!viewRepId || !canViewOthers) {
        leads = leads.filter(l => !["SOLD", "REJECT"].includes(l.disposition || ""));
      }
      
      res.json(leads);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });
  
  // Get lead counts per rep for SUPERVISOR+ roles
  app.get("/api/leads/counts", auth, async (req: AuthRequest, res) => {
    try {
      const canViewOthers = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      if (!canViewOthers) {
        return res.status(403).json({ message: "Only supervisors and above can view lead counts" });
      }
      
      const users = await storage.getUsers();
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      
      // Get all leads
      const allLeads = await storage.getAllLeadsForReporting({});
      
      // Count leads per rep for users at or below caller's level
      const counts: { repId: string; name: string; role: string; count: number }[] = [];
      
      for (const user of users) {
        if (user.deletedAt || user.status !== "ACTIVE" || !user.repId) continue;
        const userLevel = ROLE_HIERARCHY[user.role] || 0;
        if (userLevel > callerLevel) continue;
        
        const userLeads = allLeads.filter(l => l.repId === user.repId && !["SOLD", "REJECT"].includes(l.disposition || ""));
        counts.push({
          repId: user.repId,
          name: user.name,
          role: user.role,
          count: userLeads.length,
        });
      }
      
      // Sort by count descending
      counts.sort((a, b) => b.count - a.count);
      
      res.json(counts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch lead counts" });
    }
  });

  app.patch("/api/leads/:id/notes", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      
      // Verify the lead belongs to this user
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      if (lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "Not authorized to update this lead" });
      }
      
      const updated = await storage.updateLeadNotes(id, notes || "");
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update lead notes" });
    }
  });

  app.patch("/api/leads/:id/disposition", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { disposition, lostReason, lostNotes } = req.body;
      
      if (!disposition || !leadDispositions.includes(disposition)) {
        return res.status(400).json({ message: "Invalid disposition" });
      }
      
      // Verify the lead belongs to this user or user is admin
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "SUPERVISOR"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "Not authorized to update this lead" });
      }
      
      // Get the mapped pipeline stage from disposition
      const mappedStage = dispositionToPipelineStage[disposition as LeadDisposition];
      
      // Update disposition (with history tracking)
      const updated = await storage.updateLeadDisposition(id, disposition, req.user!.id);
      
      // Auto-update pipeline stage if disposition maps to one
      if (mappedStage) {
        await storage.updateLeadPipelineStage(id, mappedStage, 
          mappedStage === "LOST" ? lostReason : null,
          mappedStage === "LOST" ? lostNotes : null
        );
      }
      
      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "lead_disposition_update",
        tableName: "leads",
        recordId: id,
        beforeJson: JSON.stringify({ disposition: lead.disposition, pipelineStage: lead.pipelineStage }),
        afterJson: JSON.stringify({ disposition, pipelineStage: mappedStage || lead.pipelineStage }),
      });
      
      // Fetch updated lead with new pipeline stage
      const finalLead = await storage.getLeadById(id);
      res.json(finalLead);
    } catch (error) {
      res.status(500).json({ message: "Failed to update lead disposition" });
    }
  });

  // Reverse disposition (SUPERVISOR+ only) - clears SOLD/REJECT status
  app.patch("/api/leads/:id/reverse-disposition", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Only SUPERVISOR+ can reverse dispositions
      const canReverse = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      if (!canReverse) {
        return res.status(403).json({ message: "Only supervisors and above can reverse dispositions" });
      }
      
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // Only allow reversing terminal dispositions (SOLD or loss-related)
      if (!terminalDispositions.includes(lead.disposition as LeadDisposition)) {
        return res.status(400).json({ message: "Can only reverse terminal dispositions (SOLD, REJECTED, NOT_INTERESTED, etc.)" });
      }
      
      // Verify caller can manage this lead's rep (target must be at or below caller's level)
      const users = await storage.getUsers();
      const leadOwner = users.find(u => u.repId === lead.repId && !u.deletedAt);
      if (leadOwner) {
        const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
        const ownerLevel = ROLE_HIERARCHY[leadOwner.role] || 0;
        if (ownerLevel > callerLevel) {
          return res.status(403).json({ message: "Cannot reverse dispositions for users above your role level" });
        }
      }
      
      const previousDisposition = lead.disposition;
      const updated = await storage.updateLeadDisposition(id, "NONE");
      
      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "lead_disposition_reversed",
        tableName: "leads",
        recordId: id,
        beforeJson: JSON.stringify({ disposition: previousDisposition, repId: lead.repId }),
        afterJson: JSON.stringify({ disposition: "NONE" }),
      });
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to reverse lead disposition" });
    }
  });

  // Assign/reassign a lead to another user (SUPERVISOR+ only)
  app.patch("/api/leads/:id/assign", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { targetRepId } = req.body;
      
      if (!targetRepId) {
        return res.status(400).json({ message: "targetRepId is required" });
      }
      
      // Only SUPERVISOR+ can assign leads to others
      const canAssign = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      if (!canAssign) {
        return res.status(403).json({ message: "Only supervisors and above can assign leads to other users" });
      }
      
      // Verify lead exists
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // Verify target user exists and is a valid lead assignee
      const users = await storage.getUsers();
      const targetUser = users.find(u => u.repId === targetRepId && !u.deletedAt && u.status === "ACTIVE");
      if (!targetUser) {
        return res.status(400).json({ message: `User with rep ID '${targetRepId}' not found` });
      }
      // Users can only assign leads to users at or below their role level
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
      if (targetLevel > callerLevel) {
        return res.status(400).json({ message: "You can only assign leads to users at or below your role level" });
      }
      
      const oldRepId = lead.repId;
      
      // Update the lead's repId
      const updated = await storage.updateLead(id, { repId: targetRepId });
      
      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "lead_assign",
        tableName: "leads",
        recordId: id,
        beforeJson: JSON.stringify({ repId: oldRepId }),
        afterJson: JSON.stringify({ repId: targetRepId, assignedBy: req.user!.repId }),
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Lead assign error:", error);
      res.status(500).json({ message: "Failed to assign lead" });
    }
  });

  // Get lead pool - all leads with filtering and pagination (SUPERVISOR+ for all, REP for own)
  app.get("/api/leads/pool", auth, async (req: AuthRequest, res) => {
    try {
      const { repId, disposition, search, page, limit } = req.query;
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "SUPERVISOR"].includes(req.user!.role);
      
      const filters: { repId?: string; disposition?: string; search?: string; page?: number; limit?: number } = {
        disposition: typeof disposition === "string" ? disposition : undefined,
        search: typeof search === "string" ? search : undefined,
        page: typeof page === "string" ? parseInt(page, 10) : 1,
        limit: typeof limit === "string" ? Math.min(parseInt(limit, 10), 100) : 50, // Max 100 per page
      };
      
      // REPs can only see their own leads, SUPERVISOR+ can see all or filter by rep
      if (!isAdmin) {
        filters.repId = req.user!.repId;
      } else if (typeof repId === "string" && repId !== "ALL") {
        filters.repId = repId;
      }
      
      const result = await storage.getLeadPool(filters);
      res.json(result);
    } catch (error) {
      console.error("Lead pool error:", error);
      res.status(500).json({ message: "Failed to fetch lead pool" });
    }
  });

  // Export lead pool with history (OPERATIONS and EXECUTIVE only)
  app.get("/api/leads/pool/export", auth, async (req: AuthRequest, res) => {
    try {
      if (!["OPERATIONS", "EXECUTIVE"].includes(req.user!.role)) {
        return res.status(403).json({ message: "Export requires OPERATIONS or EXECUTIVE role" });
      }

      const { repId, disposition, search } = req.query;
      const filters: { repId?: string; disposition?: string; search?: string; limit?: number } = {
        disposition: typeof disposition === "string" ? disposition : undefined,
        search: typeof search === "string" ? search : undefined,
        limit: 10000, // Export up to 10k leads at once
      };
      if (typeof repId === "string" && repId !== "ALL") {
        filters.repId = repId;
      }

      const result = await storage.getLeadPool(filters);
      const leadPool = result.data;
      const users = await storage.getUsers();
      const getUserName = (userId: string) => users.find(u => u.id === userId)?.name || userId;
      const getRepName = (repId: string | null) => {
        if (!repId) return "";
        const user = users.find(u => u.repId === repId);
        return user ? `${user.name} (${repId})` : repId;
      };
      
      // Prepare leads sheet data
      // Build full address from available fields (some imports use customerAddress, others use houseNumber/streetName)
      const buildAddress = (lead: any) => {
        // If customerAddress exists, use it
        if (lead.customerAddress) return lead.customerAddress;
        // Otherwise build from individual fields
        const parts = [lead.houseNumber, lead.street, lead.streetName, lead.aptUnit, lead.city, lead.state].filter(Boolean);
        return parts.join(" ");
      };
      
      const leadsData = leadPool.map(lead => ({
        "Lead ID": lead.id,
        "Customer Name": lead.customerName || "",
        "Phone": lead.customerPhone || "",
        "Email": lead.customerEmail || "",
        "Address": buildAddress(lead),
        "Zip Code": lead.zipCode || "",
        "Disposition": lead.disposition,
        "Rep ID": lead.repId || "",
        "Rep Name": getRepName(lead.repId),
        "Notes": lead.notes || "",
        "Created At": lead.createdAt ? new Date(lead.createdAt).toISOString() : "",
        "Updated At": lead.updatedAt ? new Date(lead.updatedAt).toISOString() : "",
      }));

      // Get all history for these leads
      const allHistory: any[] = [];
      for (const lead of leadPool) {
        const history = await storage.getLeadDispositionHistory(lead.id);
        for (const h of history) {
          allHistory.push({
            "Lead ID": lead.id,
            "Customer Name": lead.customerName || "",
            "Previous Disposition": h.previousDisposition || "NONE",
            "New Disposition": h.disposition,
            "Changed By": getUserName(h.changedByUserId || ""),
            "Notes": h.notes || "",
            "Changed At": h.createdAt ? new Date(h.createdAt).toISOString() : "",
          });
        }
      }

      const wb = XLSX.utils.book_new();
      const leadsWs = XLSX.utils.json_to_sheet(leadsData);
      XLSX.utils.book_append_sheet(wb, leadsWs, "Leads");
      
      if (allHistory.length > 0) {
        const historyWs = XLSX.utils.json_to_sheet(allHistory);
        XLSX.utils.book_append_sheet(wb, historyWs, "Disposition History");
      }

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      
      // Audit log the export
      await storage.createAuditLog({
        action: "lead_pool_export",
        tableName: "leads",
        recordId: "bulk",
        userId: req.user!.id,
        afterJson: JSON.stringify({
          filters,
          leadsExported: leadPool.length,
          historyRecords: allHistory.length,
        }),
      });

      res.setHeader("Content-Disposition", `attachment; filename="lead-pool-export.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error) {
      console.error("Lead pool export error:", error);
      res.status(500).json({ message: "Failed to export lead pool" });
    }
  });

  // Get lead disposition history
  app.get("/api/leads/:id/history", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Verify lead exists
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // REP can only see history for own leads, SUPERVISOR+ can see all
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "SUPERVISOR"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "Not authorized to view this lead's history" });
      }
      
      const history = await storage.getLeadDispositionHistory(id);
      
      // Enrich history with user names
      const users = await storage.getUsers();
      const enrichedHistory = history.map(h => ({
        ...h,
        changedByName: users.find(u => u.id === h.changedByUserId)?.name || "System",
      }));
      
      res.json(enrichedHistory);
    } catch (error) {
      console.error("Lead history error:", error);
      res.status(500).json({ message: "Failed to fetch lead history" });
    }
  });

  // Import leads from Excel (REP and above can import) - with file validation
  // SUPERVISOR+ can use ?targetRepId=X to import leads for another user
  app.post("/api/leads/import", auth, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      // Validate file upload
      const validation = validateFileUpload(req.file, res);
      if (!validation.valid) return;
      
      const workbook = validation.workbook;
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];

      if (rows.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }
      
      // Validate row count
      if (!validateRowCount(rows, res)) return;

      const errors: string[] = [];
      let success = 0;
      let failed = 0;

      // Get users for validation
      const users = await storage.getUsers();
      const currentUser = req.user!;
      const isRep = currentUser.role === "REP";
      const canAssignToOthers = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(currentUser.role);
      
      // Check for targetRepId query parameter (SUPERVISOR+ only)
      const targetRepId = req.query.targetRepId as string | undefined;
      if (targetRepId && !canAssignToOthers) {
        return res.status(403).json({ message: "Only supervisors and above can import leads for other users" });
      }
      
      // Validate targetRepId if provided - allow assigning to users at or below caller's role level
      if (targetRepId) {
        const targetUser = users.find(u => u.repId === targetRepId && !u.deletedAt && u.status === "ACTIVE");
        if (!targetUser) {
          return res.status(400).json({ message: `Target rep '${targetRepId}' not found` });
        }
        // Users can only assign leads to users at or below their role level
        const callerLevel = ROLE_HIERARCHY[currentUser.role] || 0;
        const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
        if (targetLevel > callerLevel) {
          return res.status(400).json({ message: "You can only assign leads to users at or below your role level" });
        }
      }

      // Helper to get value from row with case-insensitive column matching
      // Handles trailing/leading spaces, non-breaking spaces (NBSP), and normalizes whitespace
      const normalizeColumnName = (name: string): string => {
        return name
          .replace(/\u00A0/g, ' ')  // Replace non-breaking spaces
          .replace(/\s+/g, ' ')      // Normalize multiple spaces to single
          .trim()
          .toLowerCase();
      };
      
      const getRowValue = (row: Record<string, any>, ...keys: string[]): string => {
        for (const key of keys) {
          // Try exact match first
          if (row[key] !== undefined && row[key] !== null) {
            return row[key].toString().trim();
          }
          // Try normalized match
          const normalizedKey = normalizeColumnName(key);
          for (const rowKey of Object.keys(row)) {
            const normalizedRowKey = normalizeColumnName(rowKey);
            if (normalizedRowKey === normalizedKey && row[rowKey] !== undefined && row[rowKey] !== null) {
              return row[rowKey].toString().trim();
            }
          }
        }
        return "";
      };

      // Debug: Log column names found in first row (helpful for troubleshooting)
      if (rows.length > 0) {
        const colNames = Object.keys(rows[0]);
        console.log("Excel import - columns found:", colNames);
        console.log("Excel import - normalized columns:", colNames.map(normalizeColumnName));
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        try {
          // Determine repId for this lead:
          // 1. If targetRepId is provided (SUPERVISOR+ importing for specific user), use it
          // 2. If REP, always use their own repId
          // 3. Otherwise, use from file or default to current user's repId
          let repId: string;
          
          if (targetRepId) {
            // SUPERVISOR+ importing for a specific user - all leads go to that user
            repId = targetRepId;
          } else if (isRep) {
            // REPs can only import leads for themselves
            repId = currentUser.repId;
          } else {
            // Non-REPs: check file for repId or default to their own
            repId = getRowValue(row, "repId", "rep_id", "RepId", "Rep ID") || currentUser.repId;
          }

          // Address fields - houseNumber, aptUnit, and streetName, or combined address/street
          // Check for building/house number with many possible column name variations
          // Includes "Bld No" (without 'g') variations that some systems use
          let houseNumber = getRowValue(row, 
            "houseNumber", "house_number", "House Number", "HouseNumber", "House #", "House",
            "Bld No.", "Bld No", "Bld No ", "BldNo", "Bld#", "Bld #", "Bld",
            "Bldg No.", "Bldg No", "Bldg No ", "BldgNo", "Bldg#", "Bldg #", "Bldg",
            "Building No.", "Building No", "Building Number", "Building #", "Building",
            "Address No", "Address Number", "Street No", "Street Number", "No.", "No", "#"
          );
          const aptUnit = getRowValue(row, "apt", "Apt", "Apt.", "Apt #", "Apartment", "Unit", "Unit #", "Suite", "Ste", "Basement", "Bsmt", "apt_unit", "aptUnit");
          
          let streetName = getRowValue(row, "streetName", "street_name", "Street Name", "StreetName");
          const customerAddress = getRowValue(row, "customerAddress", "customer_address", "Address", "Full Address");
          const street = getRowValue(row, "street", "Street");
          
          // If no separate fields, try to parse from combined address
          if (!houseNumber && !streetName && (customerAddress || street)) {
            const fullAddr = (customerAddress || street).trim();
            // Try number at the BEGINNING: "123 Main St"
            let match = fullAddr.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
            if (match) {
              houseNumber = match[1];
              streetName = match[2];
            } else {
              // Try number at the END: "Main St 123"
              match = fullAddr.match(/^(.+)\s+(\d+[A-Za-z]?)$/);
              if (match) {
                streetName = match[1];
                houseNumber = match[2];
              } else {
                streetName = fullAddr;
              }
            }
          }
          
          if (!houseNumber && !streetName && !customerAddress && !street) {
            errors.push(`Row ${rowNum}: Missing address (houseNumber/streetName or address required)`);
            failed++;
            continue;
          }

          const customerName = getRowValue(row, "customerName", "customer_name", "Customer Name", "Name", "Customer");
          const customerPhone = getRowValue(row, "customerPhone", "customer_phone", "Phone", "Phone Number", "Telephone");
          const customerEmail = getRowValue(row, "customerEmail", "customer_email", "Email", "E-mail");
          const city = getRowValue(row, "city", "City");
          const state = getRowValue(row, "state", "State");
          const zipCode = getRowValue(row, "zipCode", "zip_code", "Zip", "Zip Code", "ZIP", "Postal Code");
          const notes = getRowValue(row, "notes", "Notes", "Comments");
          
          // Additional fields from file
          const accountNumber = getRowValue(row, "accountNumber", "account_number", "Account Number", "Account No", "Account #", "Account", "Acct", "Acct No", "Acct #");
          const customerStatus = getRowValue(row, "customerStatus", "customer_status", "Customer Status", "Status", "Cust Status");
          const discoReason = getRowValue(row, "discoReason", "disco_reason", "Disco Reason", "Disconnect Reason", "Disconnection Reason", "Disco", "DC Reason");

          // Verify rep exists (for non-REPs importing for other reps)
          const rep = users.find(u => u.repId === repId);
          if (!rep) {
            errors.push(`Row ${rowNum}: Rep '${repId}' not found`);
            failed++;
            continue;
          }

          // Create the lead
          await storage.createLead({
            repId,
            customerName: customerName || null,
            customerAddress: customerAddress || null,
            customerPhone: customerPhone || null,
            customerEmail: customerEmail || null,
            houseNumber: houseNumber || null,
            aptUnit: aptUnit || null,
            streetName: streetName || null,
            street: street || null,
            city: city || null,
            state: state || null,
            zipCode: zipCode || null,
            accountNumber: accountNumber || null,
            customerStatus: customerStatus || null,
            discoReason: discoReason || null,
            notes: notes || null,
            importedBy: req.user!.id,
            status: "NEW",
          });

          success++;
        } catch (rowError: any) {
          errors.push(`Row ${rowNum}: ${rowError.message}`);
          failed++;
        }
      }

      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "leads_import",
        tableName: "leads",
        afterJson: JSON.stringify({ success, failed, totalRows: rows.length }),
      });

      res.json({ success, failed, errors: errors.slice(0, 20) });
    } catch (error: any) {
      console.error("Lead import error:", error);
      res.status(500).json({ message: error.message || "Failed to import leads" });
    }
  });

  // Admin delete leads by date range
  app.delete("/api/admin/leads/by-date", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ message: "dateFrom and dateTo required" });
      }
      const count = await storage.deleteLeadsByDateRange(dateFrom as string, dateTo as string);
      await storage.createAuditLog({ 
        action: "bulk_delete_leads", 
        tableName: "leads", 
        afterJson: JSON.stringify({ dateFrom, dateTo, count }),
        userId: req.user!.id 
      });
      res.json({ message: `Deleted ${count} leads`, count });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Admin delete all leads
  app.delete("/api/admin/leads/all", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const count = await storage.deleteAllLeads();
      await storage.createAuditLog({ 
        action: "delete_all_leads", 
        tableName: "leads", 
        afterJson: JSON.stringify({ count }),
        userId: req.user!.id 
      });
      res.json({ message: `Deleted ${count} leads`, count });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Admin fix leads with building numbers in wrong position (street suffix)
  app.post("/api/admin/leads/fix-addresses", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      // Get all leads
      const allLeads = await storage.getAllLeadsForAdmin();
      let fixed = 0;
      const fixedLeads: { id: string; before: string; after: string }[] = [];
      
      for (const lead of allLeads) {
        // Skip if already has houseNumber populated
        if (lead.houseNumber) continue;
        
        // Check if streetName or street has a number at the end (e.g. "WOODLAND AVE 12")
        const addrToCheck = lead.streetName || lead.street || lead.customerAddress;
        if (!addrToCheck) continue;
        
        const match = addrToCheck.trim().match(/^(.+)\s+(\d+[A-Za-z]?)$/);
        if (match) {
          const newStreetName = match[1];
          const newHouseNumber = match[2];
          
          // Update the lead
          await storage.updateLead(lead.id, {
            houseNumber: newHouseNumber,
            streetName: newStreetName,
          });
          
          fixedLeads.push({
            id: lead.id,
            before: addrToCheck,
            after: `${newHouseNumber} ${newStreetName}`
          });
          fixed++;
        }
      }
      
      await storage.createAuditLog({ 
        action: "fix_lead_addresses", 
        tableName: "leads", 
        afterJson: JSON.stringify({ count: fixed, samples: fixedLeads.slice(0, 10) }),
        userId: req.user!.id 
      });
      
      res.json({ message: `Fixed ${fixed} leads`, count: fixed, fixed: fixedLeads });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fix leads" });
    }
  });

  // Admin delete single lead
  app.delete("/api/admin/leads/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const lead = await storage.getLeadById(id);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      
      await storage.deleteLead(id);
      await storage.createAuditLog({ 
        action: "delete_lead", 
        tableName: "leads", 
        recordId: id,
        beforeJson: JSON.stringify(lead),
        userId: req.user!.id 
      });
      res.json({ message: "Lead deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete lead" });
    }
  });

  // Bulk soft delete leads (SUPERVISOR+)
  // Enforces hierarchy: caller can only delete leads owned by users at or below their role level
  app.post("/api/leads/bulk-delete", auth, supervisorOrAbove, async (req: AuthRequest, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array required" });
      }
      
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const users = await storage.getUsers();
      const usersByRepId: Record<string, typeof users[0]> = {};
      users.forEach(u => { if (u.repId) usersByRepId[u.repId] = u; });
      
      // Validate each lead's ownership is within caller's authority
      const allowedIds: string[] = [];
      const deniedIds: string[] = [];
      
      for (const leadId of ids) {
        const lead = await storage.getLeadById(leadId);
        if (!lead || lead.deletedAt) {
          deniedIds.push(leadId);
          continue;
        }
        
        const leadOwner = usersByRepId[lead.repId];
        const ownerLevel = leadOwner ? (ROLE_HIERARCHY[leadOwner.role] || 0) : 0;
        
        if (ownerLevel > callerLevel) {
          deniedIds.push(leadId);
        } else {
          allowedIds.push(leadId);
        }
      }
      
      if (allowedIds.length === 0) {
        return res.status(403).json({ message: "You don't have permission to delete any of the selected leads" });
      }
      
      const deletedLeads = await storage.softDeleteLeads(allowedIds, req.user!.id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "bulk_soft_delete_leads",
        tableName: "leads",
        afterJson: JSON.stringify({ count: deletedLeads.length, ids: allowedIds, denied: deniedIds.length }),
      });
      
      const message = deniedIds.length > 0 
        ? `Deleted ${deletedLeads.length} leads (${deniedIds.length} skipped due to permissions)`
        : `Deleted ${deletedLeads.length} leads`;
      
      res.json({ message, count: deletedLeads.length, skipped: deniedIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Bulk delete all leads for a specific user (ADMIN/OPERATIONS/EXECUTIVE only)
  app.delete("/api/leads/by-user/:repId", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { repId } = req.params;
      if (!repId) {
        return res.status(400).json({ message: "repId required" });
      }
      
      // Verify the rep exists
      const targetRep = await storage.getUserByRepId(repId);
      if (!targetRep) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const deletedLeads = await storage.softDeleteLeadsByRepId(repId, req.user!.id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "bulk_delete_leads_by_user",
        tableName: "leads",
        afterJson: JSON.stringify({ repId, count: deletedLeads.length, targetUserName: targetRep.name }),
      });
      
      res.json({ 
        message: `Deleted ${deletedLeads.length} leads for ${targetRep.name}`, 
        count: deletedLeads.length 
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Bulk assign leads to a different rep (SUPERVISOR+)
  // Enforces hierarchy: caller can only assign leads owned by users at or below their role level
  // and can only assign to users at or below their role level
  app.post("/api/leads/bulk-assign", auth, supervisorOrAbove, async (req: AuthRequest, res) => {
    try {
      const { ids, newRepId } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array required" });
      }
      if (!newRepId) {
        return res.status(400).json({ message: "newRepId required" });
      }
      
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      
      // Verify target rep exists and is active
      const targetRep = await storage.getUserByRepId(newRepId);
      if (!targetRep || targetRep.status !== "ACTIVE") {
        return res.status(400).json({ message: "Target rep not found or inactive" });
      }
      
      // Verify caller can assign to target (target role at or below caller role)
      const targetLevel = ROLE_HIERARCHY[targetRep.role] || 0;
      if (targetLevel > callerLevel) {
        return res.status(403).json({ message: "You can only assign leads to users at or below your role level" });
      }
      
      const users = await storage.getUsers();
      const usersByRepId: Record<string, typeof users[0]> = {};
      users.forEach(u => { if (u.repId) usersByRepId[u.repId] = u; });
      
      // Validate each lead's ownership is within caller's authority
      const allowedIds: string[] = [];
      const deniedIds: string[] = [];
      
      for (const leadId of ids) {
        const lead = await storage.getLeadById(leadId);
        if (!lead || lead.deletedAt) {
          deniedIds.push(leadId);
          continue;
        }
        
        const leadOwner = usersByRepId[lead.repId];
        const ownerLevel = leadOwner ? (ROLE_HIERARCHY[leadOwner.role] || 0) : 0;
        
        if (ownerLevel > callerLevel) {
          deniedIds.push(leadId);
        } else {
          allowedIds.push(leadId);
        }
      }
      
      if (allowedIds.length === 0) {
        return res.status(403).json({ message: "You don't have permission to assign any of the selected leads" });
      }
      
      const assignedLeads = await storage.assignLeadsToRep(allowedIds, newRepId);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "bulk_assign_leads",
        tableName: "leads",
        afterJson: JSON.stringify({ count: assignedLeads.length, ids: allowedIds, newRepId, denied: deniedIds.length }),
      });
      
      const message = deniedIds.length > 0
        ? `Assigned ${assignedLeads.length} leads to ${targetRep.name} (${deniedIds.length} skipped due to permissions)`
        : `Assigned ${assignedLeads.length} leads to ${targetRep.name}`;
      
      res.json({ message, count: assignedLeads.length, skipped: deniedIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to assign leads" });
    }
  });

  // Update lead pipeline stage
  app.put("/api/leads/:id/stage", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { pipelineStage, lostReason, lostNotes } = req.body;
      
      if (!pipelineStage || typeof pipelineStage !== "string") {
        return res.status(400).json({ message: "pipelineStage is required" });
      }
      
      const validStages = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
      if (!validStages.includes(pipelineStage)) {
        return res.status(400).json({ message: "Invalid pipeline stage" });
      }
      
      const lead = await storage.getLeadById(id);
      if (!lead || lead.deletedAt) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "You can only update your own leads" });
      }
      
      const sanitizedLostReason = typeof lostReason === "string" ? lostReason : null;
      const sanitizedLostNotes = typeof lostNotes === "string" ? lostNotes : null;
      
      const updated = await storage.updateLeadPipelineStage(id, pipelineStage, sanitizedLostReason, sanitizedLostNotes);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update_lead_stage",
        tableName: "leads",
        recordId: id,
        afterJson: JSON.stringify({ pipelineStage, lostReason: sanitizedLostReason }),
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update lead stage" });
    }
  });

  // Schedule follow-up for a lead
  app.put("/api/leads/:id/follow-up", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { scheduledFollowUp, followUpNotes } = req.body;
      
      const lead = await storage.getLeadById(id);
      if (!lead || lead.deletedAt) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "You can only update your own leads" });
      }
      
      let parsedDate: Date | null = null;
      if (scheduledFollowUp) {
        const d = new Date(scheduledFollowUp);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ message: "Invalid date format for scheduledFollowUp" });
        }
        parsedDate = d;
      }
      
      const sanitizedNotes = typeof followUpNotes === "string" ? followUpNotes : null;
      const updated = await storage.updateLeadFollowUp(id, parsedDate, sanitizedNotes);
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to schedule follow-up" });
    }
  });

  // Log contact attempt
  app.post("/api/leads/:id/contact", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      
      const lead = await storage.getLeadById(id);
      if (!lead || lead.deletedAt) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      if (!isAdmin && lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "You can only update your own leads" });
      }
      
      const sanitizedNotes = typeof notes === "string" ? notes : undefined;
      const updated = await storage.logLeadContact(id, lead, sanitizedNotes);
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to log contact" });
    }
  });

  // Get leads with follow-ups due (for reminders)
  app.get("/api/leads/follow-ups", auth, async (req: AuthRequest, res) => {
    try {
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(req.user!.role);
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const repId = isAdmin ? undefined : req.user!.repId || undefined;
      const followUps = await storage.getLeadsWithFollowUpsDue(repId, tomorrow);
      
      // Categorize follow-ups
      const overdue = followUps.filter(f => f.scheduledFollowUp && f.scheduledFollowUp < now);
      const today = followUps.filter(f => {
        if (!f.scheduledFollowUp) return false;
        const followUpDate = new Date(f.scheduledFollowUp);
        return followUpDate.toDateString() === now.toDateString();
      });
      const upcoming = followUps.filter(f => {
        if (!f.scheduledFollowUp) return false;
        const followUpDate = new Date(f.scheduledFollowUp);
        return followUpDate > now && followUpDate.toDateString() !== now.toDateString();
      });
      
      res.json({ overdue, today, upcoming, total: followUps.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get follow-ups" });
    }
  });

  // Pipeline analytics - funnel data
  app.get("/api/pipeline/funnel", auth, supervisorOrAbove, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, repId, providerId } = req.query;
      
      const filters = {
        startDate: typeof startDate === "string" ? startDate : undefined,
        endDate: typeof endDate === "string" ? endDate : undefined,
        repId: typeof repId === "string" && repId !== "all" ? repId : undefined,
        providerId: typeof providerId === "string" ? providerId : undefined,
      };
      
      const stageCounts = await storage.getPipelineFunnelData(filters);
      
      // Build funnel data with proper stage ordering
      const stages = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
      const stageMap: Record<string, number> = {};
      for (const sc of stageCounts) {
        stageMap[sc.pipelineStage || "NEW"] = sc.count;
      }
      
      const funnelData = stages.map(stage => ({
        stage,
        count: stageMap[stage] || 0,
      }));
      
      // Calculate totals
      const total = funnelData.reduce((sum, f) => sum + f.count, 0);
      const won = stageMap["WON"] || 0;
      const lost = stageMap["LOST"] || 0;
      const active = total - won - lost;
      
      res.json({
        funnel: funnelData,
        summary: {
          total,
          won,
          lost,
          active,
          winRate: (won + lost) > 0 ? ((won / (won + lost)) * 100).toFixed(1) : "0",
          conversionRate: total > 0 ? ((won / total) * 100).toFixed(1) : "0",
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get funnel data" });
    }
  });

  // Lead aging report
  app.get("/api/pipeline/aging", auth, supervisorOrAbove, async (req: AuthRequest, res) => {
    try {
      const { repId } = req.query;
      const repFilter = typeof repId === "string" && repId !== "all" ? repId : undefined;
      
      const activeLeads = await storage.getActiveLeadsForAging(repFilter, 100);
      
      const now = new Date();
      const agingBuckets = {
        "0-7 days": 0,
        "8-14 days": 0,
        "15-30 days": 0,
        "31-60 days": 0,
        "60+ days": 0,
      };
      
      const agingDetails: any[] = [];
      
      for (const lead of activeLeads) {
        const createdAt = new Date(lead.createdAt);
        const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        
        if (ageDays <= 7) agingBuckets["0-7 days"]++;
        else if (ageDays <= 14) agingBuckets["8-14 days"]++;
        else if (ageDays <= 30) agingBuckets["15-30 days"]++;
        else if (ageDays <= 60) agingBuckets["31-60 days"]++;
        else agingBuckets["60+ days"]++;
        
        agingDetails.push({
          id: lead.id,
          customerName: lead.customerName,
          repId: lead.repId,
          pipelineStage: lead.pipelineStage,
          createdAt: lead.createdAt,
          ageDays,
          lastContactedAt: lead.lastContactedAt,
          scheduledFollowUp: lead.scheduledFollowUp,
        });
      }
      
      // Sort by age descending
      agingDetails.sort((a, b) => b.ageDays - a.ageDays);
      
      const avgAge = activeLeads.length > 0
        ? agingDetails.reduce((sum, l) => sum + l.ageDays, 0) / activeLeads.length
        : 0;
      
      res.json({
        buckets: agingBuckets,
        details: agingDetails.slice(0, 50),
        summary: {
          totalActive: activeLeads.length,
          averageAgeDays: avgAge.toFixed(1),
          oldestLead: agingDetails[0] || null,
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get aging report" });
    }
  });

  // Win/Loss analysis
  app.get("/api/pipeline/win-loss", auth, supervisorOrAbove, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, groupBy } = req.query;
      const groupByField = (typeof groupBy === "string" ? groupBy : "rep");
      
      const filters = {
        startDate: typeof startDate === "string" ? startDate : undefined,
        endDate: typeof endDate === "string" ? endDate : undefined,
      };
      
      const closedLeads = await storage.getClosedLeadsForWinLoss(filters);
      
      // Group analysis
      const analysis: Record<string, { wins: number; losses: number; lossReasons: Record<string, number> }> = {};
      
      for (const lead of closedLeads) {
        let key: string;
        switch (groupByField) {
          case "provider":
            key = lead.interestedProviderId || "Unknown";
            break;
          case "service":
            key = lead.interestedServiceId || "Unknown";
            break;
          default:
            key = lead.repId || "Unknown";
        }
        
        if (!analysis[key]) {
          analysis[key] = { wins: 0, losses: 0, lossReasons: {} };
        }
        
        if (lead.pipelineStage === "WON") {
          analysis[key].wins++;
        } else {
          analysis[key].losses++;
          const reason = lead.lostReason || "Not specified";
          analysis[key].lossReasons[reason] = (analysis[key].lossReasons[reason] || 0) + 1;
        }
      }
      
      // Convert to array and calculate rates
      const results = Object.entries(analysis).map(([key, data]) => ({
        [groupByField]: key,
        wins: data.wins,
        losses: data.losses,
        total: data.wins + data.losses,
        winRate: data.wins + data.losses > 0 ? ((data.wins / (data.wins + data.losses)) * 100).toFixed(1) : "0",
        topLossReasons: Object.entries(data.lossReasons)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([reason, count]) => ({ reason, count })),
      }));
      
      results.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
      
      // Overall loss reasons
      const overallLossReasons: Record<string, number> = {};
      for (const lead of closedLeads.filter(l => l.pipelineStage === "LOST")) {
        const reason = lead.lostReason || "Not specified";
        overallLossReasons[reason] = (overallLossReasons[reason] || 0) + 1;
      }
      
      res.json({
        byGroup: results,
        summary: {
          totalWins: closedLeads.filter(l => l.pipelineStage === "WON").length,
          totalLosses: closedLeads.filter(l => l.pipelineStage === "LOST").length,
          overallWinRate: closedLeads.length > 0 
            ? ((closedLeads.filter(l => l.pipelineStage === "WON").length / closedLeads.length) * 100).toFixed(1)
            : "0",
          topLossReasons: Object.entries(overallLossReasons)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([reason, count]) => ({ reason, count })),
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get win/loss analysis" });
    }
  });

  // Commissions - role-based view
  app.get("/api/commissions", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const isRep = user.role === "REP";
      
      // Get user's own orders with earned commissions (approved orders)
      const allOrders = await storage.getOrders();
      const myOrders = allOrders.filter((o: SalesOrder) => 
        o.repId === user.repId && 
        o.jobStatus === "COMPLETED" && 
        o.approvalStatus === "APPROVED"
      );
      
      // Get commission line items for service breakdown
      const allLineItems = await Promise.all(
        myOrders.map(async (o: SalesOrder) => {
          const lineItems = await storage.getCommissionLineItemsByOrderId(o.id);
          return { orderId: o.id, lineItems };
        })
      );
      
      // Map line items by order for quick lookup
      const lineItemsByOrder: Record<string, any[]> = {};
      for (const { orderId, lineItems } of allLineItems) {
        lineItemsByOrder[orderId] = lineItems;
      }
      
      const ownSoldCommissions = myOrders.map((o: SalesOrder) => {
        const lines = lineItemsByOrder[o.id] || [];
        return {
          id: o.id,
          dateSold: o.dateSold,
          customerName: o.customerName,
          accountNumber: o.accountNumber,
          baseCommission: parseFloat(o.baseCommissionEarned),
          incentive: parseFloat(o.incentiveEarned),
          total: parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned),
          serviceBreakdown: {
            internet: lines.filter((l: any) => l.serviceCategory === "INTERNET").reduce((sum: number, l: any) => sum + parseFloat(l.totalAmount), 0),
            mobile: lines.filter((l: any) => l.serviceCategory === "MOBILE").reduce((sum: number, l: any) => sum + parseFloat(l.totalAmount), 0),
            video: lines.filter((l: any) => l.serviceCategory === "VIDEO").reduce((sum: number, l: any) => sum + parseFloat(l.totalAmount), 0),
          },
        };
      });
      
      // Calculate service totals
      const serviceTotals = {
        internet: myOrders.reduce((sum: number, o: SalesOrder) => {
          const lines = lineItemsByOrder[o.id] || [];
          return sum + lines.filter((l: any) => l.serviceCategory === "INTERNET").reduce((s: number, l: any) => s + parseFloat(l.totalAmount), 0);
        }, 0),
        mobile: myOrders.reduce((sum: number, o: SalesOrder) => {
          const lines = lineItemsByOrder[o.id] || [];
          return sum + lines.filter((l: any) => l.serviceCategory === "MOBILE").reduce((s: number, l: any) => s + parseFloat(l.totalAmount), 0);
        }, 0),
        video: myOrders.reduce((sum: number, o: SalesOrder) => {
          const lines = lineItemsByOrder[o.id] || [];
          return sum + lines.filter((l: any) => l.serviceCategory === "VIDEO").reduce((s: number, l: any) => s + parseFloat(l.totalAmount), 0);
        }, 0),
      };
      
      const ownTotalConnected = myOrders.length;
      const ownTotalEarned = myOrders.reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      // Calculate weekly and MTD earnings (America/New_York timezone)
      const now = new Date();
      const nyOffset = -5 * 60; // EST offset in minutes
      const nyNow = new Date(now.getTime() + (now.getTimezoneOffset() + nyOffset) * 60000);
      
      // Week start (Monday)
      const dayOfWeek = nyNow.getDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(nyNow);
      weekStart.setDate(nyNow.getDate() - daysFromMonday);
      weekStart.setHours(0, 0, 0, 0);
      
      // Month start
      const monthStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1);
      
      const weeklyEarned = myOrders
        .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt) >= weekStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const mtdEarned = myOrders
        .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt) >= monthStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      // Get pending orders (not yet completed but still active) for this rep
      const pendingOrders = allOrders.filter((o: SalesOrder) => 
        o.repId === user.repId && 
        o.jobStatus !== "COMPLETED" &&
        o.jobStatus !== "CANCELED" &&
        o.approvalStatus !== "REJECTED"
      );
      
      // Calculate pending commissions (estimated from baseCommissionEarned which is pre-calculated)
      const pendingWeekly = pendingOrders
        .filter((o: SalesOrder) => new Date(o.dateSold) >= weekStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0"), 0);
      
      const pendingMtd = pendingOrders
        .filter((o: SalesOrder) => new Date(o.dateSold) >= monthStart)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0"), 0);
      
      // Calculate 30-day rolling average for connected commissions
      const thirtyDaysAgo = new Date(nyNow);
      thirtyDaysAgo.setDate(nyNow.getDate() - 30);
      
      const last30DaysConnected = myOrders
        .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt) >= thirtyDaysAgo)
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const rollingAverage30Days = last30DaysConnected / 30;
      
      // Generate daily data for charts (last 7 days for weekly, current month for MTD)
      const weeklyChartData: { day: string; amount: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(nyNow);
        date.setDate(nyNow.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayTotal = myOrders
          .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt).toISOString().split('T')[0] === dateStr)
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        weeklyChartData.push({ day: dayName, amount: dayTotal });
      }
      
      const mtdChartData: { day: string; amount: number }[] = [];
      const daysInMonth = new Date(nyNow.getFullYear(), nyNow.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= Math.min(nyNow.getDate(), daysInMonth); d++) {
        const date = new Date(nyNow.getFullYear(), nyNow.getMonth(), d);
        const dateStr = date.toISOString().split('T')[0];
        const dayTotal = myOrders
          .filter((o: SalesOrder) => o.approvedAt && new Date(o.approvedAt).toISOString().split('T')[0] === dateStr)
          .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        mtdChartData.push({ day: d.toString(), amount: dayTotal });
      }
      
      // For non-REP roles, also get override earnings
      let overrideEarnings: any[] = [];
      let overrideTotalEarned = 0;
      
      if (!isRep) {
        const rawOverrides = await storage.getOverrideEarningsByRecipient(user.id);
        
        // Get order details for each override
        for (const override of rawOverrides) {
          const order = allOrders.find((o: SalesOrder) => o.id === override.salesOrderId);
          if (order) {
            overrideEarnings.push({
              id: override.id,
              salesOrderId: override.salesOrderId,
              sourceRepId: override.sourceRepId,
              sourceLevelUsed: override.sourceLevelUsed,
              amount: parseFloat(override.amount),
              dateSold: order.dateSold,
              customerName: order.customerName,
            });
            overrideTotalEarned += parseFloat(override.amount);
          }
        }
      }
      
      res.json({
        role: user.role,
        ownSoldCommissions,
        ownTotalConnected,
        ownTotalEarned,
        serviceTotals,
        weeklyEarned,
        mtdEarned,
        pendingWeekly,
        pendingMtd,
        rollingAverage30Days,
        weeklyChartData,
        mtdChartData,
        overrideEarnings: isRep ? null : overrideEarnings,
        overrideTotalEarned: isRep ? null : overrideTotalEarned,
        grandTotal: ownTotalEarned + overrideTotalEarned,
      });
    } catch (error) {
      console.error("Commissions error:", error);
      res.status(500).json({ message: "Failed to fetch commissions" });
    }
  });

  // ==================== REPORTS ====================
  
  // Helper to apply role-based filtering to orders
  async function applyRoleBasedOrderFilter(orders: SalesOrder[], user: User): Promise<{ filteredOrders: SalesOrder[]; scopeInfo: { role: string; scopeDescription: string; repCount: number } }> {
    let filteredOrders = orders;
    let scopeDescription = "All data";
    let repCount = 0;
    
    if (user.role === "REP") {
      filteredOrders = orders.filter(o => o.repId === user.repId);
      scopeDescription = "Your personal data";
      repCount = 1;
    } else if (user.role === "SUPERVISOR") {
      const supervisedReps = await storage.getSupervisedReps(user.id);
      const repIds = [user.repId, ...supervisedReps.map(r => r.repId)];
      filteredOrders = orders.filter(o => repIds.includes(o.repId));
      scopeDescription = `Your team (${supervisedReps.length} direct reports)`;
      repCount = repIds.length;
    } else if (user.role === "MANAGER") {
      const scope = await storage.getManagerScope(user.id);
      filteredOrders = orders.filter(o => scope.allRepRepIds.includes(o.repId));
      scopeDescription = `Your organization (${scope.supervisorIds.length} supervisors, ${scope.allRepRepIds.length} total reps)`;
      repCount = scope.allRepRepIds.length;
    } else if (user.role === "EXECUTIVE") {
      const scope = await storage.getExecutiveScope(user.id);
      filteredOrders = orders.filter(o => scope.allRepRepIds.includes(o.repId));
      scopeDescription = `Your division (${scope.managerIds.length} managers, ${scope.allRepRepIds.length} total reps)`;
      repCount = scope.allRepRepIds.length;
    } else if (user.role === "ADMIN" || user.role === "OPERATIONS") {
      const allUsers = await storage.getUsers();
      const salesReps = allUsers.filter(u => ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"].includes(u.role) && !u.deletedAt);
      scopeDescription = `Company-wide (${salesReps.length} total sales reps)`;
      repCount = salesReps.length;
    }
    
    return {
      filteredOrders,
      scopeInfo: {
        role: user.role,
        scopeDescription,
        repCount,
      }
    };
  }
  
  // Helper to get date ranges
  function getDateRange(period: string, customStart?: string, customEnd?: string) {
    const now = new Date();
    let start: Date, end: Date;
    
    switch (period) {
      case "today":
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(start);
        end.setDate(end.getDate() + 1);
        break;
      case "yesterday":
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "this_week":
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
        end = new Date(start);
        end.setDate(end.getDate() + 7);
        break;
      case "last_week":
        const currentDayOfWeek = now.getDay();
        const lastMondayOffset = currentDayOfWeek === 0 ? -13 : -6 - currentDayOfWeek;
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + lastMondayOffset);
        end = new Date(start);
        end.setDate(end.getDate() + 7);
        break;
      case "this_month":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case "last_month":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "this_quarter":
        const currentQuarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), currentQuarter * 3, 1);
        end = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 1);
        break;
      case "last_quarter":
        const lastQuarter = Math.floor(now.getMonth() / 3) - 1;
        const year = lastQuarter < 0 ? now.getFullYear() - 1 : now.getFullYear();
        const adjustedQuarter = lastQuarter < 0 ? 3 : lastQuarter;
        start = new Date(year, adjustedQuarter * 3, 1);
        end = new Date(year, (adjustedQuarter + 1) * 3, 1);
        break;
      case "this_year":
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear() + 1, 0, 1);
        break;
      case "last_year":
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear(), 0, 1);
        break;
      case "custom":
        start = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), 1);
        end = customEnd ? new Date(customEnd) : new Date();
        end.setDate(end.getDate() + 1);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    
    return { start, end };
  }

  // Production metrics - weekly and MTD pending/connected dollars
  app.get("/api/reports/production", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const now = new Date();
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user);
      
      // Calculate week start (Monday)
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1); // Today end
      
      // Calculate MTD (calendar month-to-date)
      const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const mtdEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      
      // Weekly orders
      const weeklyOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= weekStart && orderDate < weekEnd;
      });
      
      // MTD orders
      const mtdOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= mtdStart && orderDate < mtdEnd;
      });
      
      // Calculate metrics
      const calcMetrics = (orderSet: SalesOrder[]) => {
        const totalSold = orderSet.length;
        const pendingOrders = orderSet.filter(o => o.jobStatus === "PENDING");
        const connectedOrders = orderSet.filter(o => o.jobStatus === "COMPLETED");
        const approvedOrders = orderSet.filter(o => o.approvalStatus === "APPROVED");
        
        const pendingDollars = pendingOrders.reduce((sum, o) => 
          sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        const connectedDollars = connectedOrders.reduce((sum, o) => 
          sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        const totalEarned = approvedOrders.reduce((sum, o) => 
          sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const mobileLines = orderSet.reduce((sum, o) => sum + (o.mobileLinesQty || 0), 0);
        const tvSold = orderSet.filter(o => o.tvSold).length;
        
        return {
          totalSold,
          pending: pendingOrders.length,
          connected: connectedOrders.length,
          approved: approvedOrders.length,
          pendingDollars: pendingDollars.toFixed(2),
          connectedDollars: connectedDollars.toFixed(2),
          totalEarned: totalEarned.toFixed(2),
          mobileLines,
          tvSold,
        };
      };
      
      const weekly = calcMetrics(weeklyOrders);
      const mtd = calcMetrics(mtdOrders);
      
      res.json({
        scopeInfo,
        periods: {
          weekly: {
            start: weekStart.toISOString().split("T")[0],
            end: weekEnd.toISOString().split("T")[0],
            label: "This Week",
          },
          mtd: {
            start: mtdStart.toISOString().split("T")[0],
            end: mtdEnd.toISOString().split("T")[0],
            label: `MTD (${now.toLocaleString("default", { month: "short" })})`,
          },
        },
        weekly,
        mtd,
      });
    } catch (error) {
      console.error("Production metrics error:", error);
      res.status(500).json({ message: "Failed to get production metrics" });
    }
  });

  // Reports Summary - KPIs
  app.get("/api/reports/summary", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user);
      
      // Filter by date range (using dateSold)
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const totalOrders = periodOrders.length;
      const completedOrders = periodOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const approvedOrders = periodOrders.filter(o => o.approvalStatus === "APPROVED").length;
      const pendingOrders = periodOrders.filter(o => o.approvalStatus === "UNAPPROVED").length;
      
      const totalEarned = periodOrders
        .filter(o => o.approvalStatus === "APPROVED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const totalPaid = periodOrders
        .filter(o => o.paymentStatus === "PAID")
        .reduce((sum, o) => sum + parseFloat(o.commissionPaid), 0);
      
      // Pending dollars: commission from orders with jobStatus = PENDING
      const pendingDollars = periodOrders
        .filter(o => o.jobStatus === "PENDING")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      // Connected dollars: commission from orders with jobStatus = COMPLETED
      const connectedDollars = periodOrders
        .filter(o => o.jobStatus === "COMPLETED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const avgCommission = approvedOrders > 0 ? totalEarned / approvedOrders : 0;
      const approvalRate = totalOrders > 0 ? (approvedOrders / totalOrders) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
      
      // Get previous period for comparison
      const periodLength = end.getTime() - start.getTime();
      const prevStart = new Date(start.getTime() - periodLength);
      const prevEnd = new Date(start);
      
      const prevOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= prevStart && orderDate < prevEnd;
      });
      
      const prevTotalOrders = prevOrders.length;
      const prevTotalEarned = prevOrders
        .filter(o => o.approvalStatus === "APPROVED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      res.json({
        period: { start: start.toISOString(), end: end.toISOString() },
        scopeInfo,
        totalOrders,
        completedOrders,
        approvedOrders,
        pendingOrders,
        totalEarned: totalEarned.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        outstanding: (totalEarned - totalPaid).toFixed(2),
        pendingDollars: pendingDollars.toFixed(2),
        connectedDollars: connectedDollars.toFixed(2),
        avgCommission: avgCommission.toFixed(2),
        approvalRate: approvalRate.toFixed(1),
        completionRate: completionRate.toFixed(1),
        comparison: {
          ordersTrend: prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100).toFixed(1) : "0",
          earnedTrend: prevTotalEarned > 0 ? ((totalEarned - prevTotalEarned) / prevTotalEarned * 100).toFixed(1) : "0",
        },
      });
    } catch (error) {
      console.error("Report summary error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Sales by Rep
  app.get("/api/reports/sales-by-rep", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const users = await storage.getUsers();
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const repStats: Record<string, { name: string; orders: number; earned: number; approved: number }> = {};
      
      for (const order of periodOrders) {
        if (!repStats[order.repId]) {
          const repUser = users.find(u => u.repId === order.repId);
          repStats[order.repId] = { name: repUser?.name || order.repId, orders: 0, earned: 0, approved: 0 };
        }
        repStats[order.repId].orders++;
        if (order.approvalStatus === "APPROVED") {
          repStats[order.repId].approved++;
          repStats[order.repId].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(repStats)
        .map(([repId, stats]) => ({ repId, ...stats }))
        .sort((a, b) => b.earned - a.earned);
      
      res.json({ data });
    } catch (error) {
      console.error("Sales by rep error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Sales by Provider
  app.get("/api/reports/sales-by-provider", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const providers = await storage.getProviders();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const providerStats: Record<string, { name: string; orders: number; earned: number }> = {};
      
      for (const order of periodOrders) {
        const providerId = order.providerId;
        if (!providerStats[providerId]) {
          const provider = providers.find(p => p.id === providerId);
          providerStats[providerId] = { name: provider?.name || "Unknown", orders: 0, earned: 0 };
        }
        providerStats[providerId].orders++;
        if (order.approvalStatus === "APPROVED") {
          providerStats[providerId].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(providerStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.orders - a.orders);
      
      res.json({ data });
    } catch (error) {
      console.error("Sales by provider error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Sales by Service
  app.get("/api/reports/sales-by-service", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const services = await storage.getServices();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const serviceStats: Record<string, { name: string; orders: number; earned: number }> = {};
      
      for (const order of periodOrders) {
        const serviceId = order.serviceId;
        if (!serviceStats[serviceId]) {
          const service = services.find(s => s.id === serviceId);
          serviceStats[serviceId] = { name: service?.name || "Unknown", orders: 0, earned: 0 };
        }
        serviceStats[serviceId].orders++;
        if (order.approvalStatus === "APPROVED") {
          serviceStats[serviceId].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(serviceStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.orders - a.orders);
      
      res.json({ data });
    } catch (error) {
      console.error("Sales by service error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Trend Data
  app.get("/api/reports/trend", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, groupBy = "day" } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const trendData: Record<string, { label: string; orders: number; earned: number }> = {};
      
      for (const order of periodOrders) {
        const orderDate = new Date(order.dateSold);
        let key: string, label: string;
        
        if (groupBy === "day") {
          key = orderDate.toISOString().split("T")[0];
          label = orderDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        } else if (groupBy === "week") {
          const weekStart = new Date(orderDate);
          const day = weekStart.getDay();
          const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
          weekStart.setDate(diff);
          key = weekStart.toISOString().split("T")[0];
          label = `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
        } else {
          key = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, "0")}`;
          label = orderDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        }
        
        if (!trendData[key]) {
          trendData[key] = { label, orders: 0, earned: 0 };
        }
        trendData[key].orders++;
        if (order.approvalStatus === "APPROVED") {
          trendData[key].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
      }
      
      const data = Object.entries(trendData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, stats]) => ({ key, ...stats }));
      
      res.json({ data });
    } catch (error) {
      console.error("Trend error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Commission Summary - Earned vs Paid
  app.get("/api/reports/commission-summary", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const users = await storage.getUsers();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const repSummary: Record<string, { name: string; earned: number; paid: number; outstanding: number; orders: number }> = {};
      
      for (const order of periodOrders) {
        if (!repSummary[order.repId]) {
          const repUser = users.find(u => u.repId === order.repId);
          repSummary[order.repId] = { name: repUser?.name || order.repId, earned: 0, paid: 0, outstanding: 0, orders: 0 };
        }
        repSummary[order.repId].orders++;
        if (order.approvalStatus === "APPROVED") {
          const earned = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
          const paid = parseFloat(order.commissionPaid);
          repSummary[order.repId].earned += earned;
          repSummary[order.repId].paid += paid;
          repSummary[order.repId].outstanding += (earned - paid);
        }
      }
      
      const data = Object.entries(repSummary)
        .map(([repId, stats]) => ({ repId, ...stats }))
        .sort((a, b) => b.earned - a.earned);
      
      const totals = data.reduce((acc, rep) => ({
        totalEarned: acc.totalEarned + rep.earned,
        totalPaid: acc.totalPaid + rep.paid,
        totalOutstanding: acc.totalOutstanding + rep.outstanding,
        totalOrders: acc.totalOrders + rep.orders,
      }), { totalEarned: 0, totalPaid: 0, totalOutstanding: 0, totalOrders: 0 });
      
      res.json({ data, totals });
    } catch (error) {
      console.error("Commission summary error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Team Production Report - For SUPERVISOR+ to view team leader production (within their scope)
  app.get("/api/reports/team-production", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      // REPs cannot access this report - need SUPERVISOR or higher
      if (user.role === "REP") {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const allUsers = await storage.getUsers();
      
      // Filter orders by date range
      const periodOrders = allOrders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      // Determine which team leaders to show based on user's role
      let teamLeaders: typeof allUsers = [];
      let userScope: { supervisorIds?: string[]; managerIds?: string[]; allRepRepIds: string[] } = { allRepRepIds: [] };
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        // Full access - show all team leaders
        teamLeaders = allUsers.filter(u => 
          ["EXECUTIVE", "MANAGER", "SUPERVISOR"].includes(u.role) && !u.deletedAt
        );
      } else if (user.role === "EXECUTIVE") {
        // Show managers and supervisors under this executive
        userScope = await storage.getExecutiveScope(user.id);
        teamLeaders = allUsers.filter(u => 
          (["MANAGER", "SUPERVISOR"].includes(u.role) && !u.deletedAt) &&
          (userScope.managerIds?.includes(u.id) || userScope.supervisorIds?.includes(u.id))
        );
        // Also include self
        teamLeaders.unshift(user);
      } else if (user.role === "MANAGER") {
        // Show supervisors under this manager
        userScope = await storage.getManagerScope(user.id);
        teamLeaders = allUsers.filter(u => 
          u.role === "SUPERVISOR" && !u.deletedAt && userScope.supervisorIds?.includes(u.id)
        );
        // Also include self
        teamLeaders.unshift(user);
      } else if (user.role === "SUPERVISOR") {
        // Supervisor only sees their own team production
        teamLeaders = [user];
        const supervisedReps = await storage.getSupervisedReps(user.id);
        userScope = { allRepRepIds: [user.repId, ...supervisedReps.map(r => r.repId)] };
      }
      
      const teamData: Array<{
        leaderId: string;
        leaderName: string;
        leaderRepId: string;
        role: string;
        sold: number;
        connected: number;
        mobileLines: number;
        pendingDollars: number;
        connectedDollars: number;
        teamSize: number;
      }> = [];
      
      for (const leader of teamLeaders) {
        let teamRepIds: string[] = [];
        
        if (leader.role === "EXECUTIVE") {
          const scope = await storage.getExecutiveScope(leader.id);
          teamRepIds = scope.allRepRepIds;
        } else if (leader.role === "MANAGER") {
          const scope = await storage.getManagerScope(leader.id);
          teamRepIds = scope.allRepRepIds;
        } else if (leader.role === "SUPERVISOR") {
          const supervisedReps = await storage.getSupervisedReps(leader.id);
          teamRepIds = [leader.repId, ...supervisedReps.map(r => r.repId)];
        }
        
        // Calculate team stats
        const teamOrders = periodOrders.filter(o => teamRepIds.includes(o.repId));
        const sold = teamOrders.length;
        const connected = teamOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const mobileLines = teamOrders.reduce((sum, o) => sum + (o.mobileLinesQty || 0), 0);
        
        const pendingDollars = teamOrders
          .filter(o => o.jobStatus === "PENDING")
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const connectedDollars = teamOrders
          .filter(o => o.jobStatus === "COMPLETED")
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        teamData.push({
          leaderId: leader.id,
          leaderName: leader.name,
          leaderRepId: leader.repId,
          role: leader.role,
          sold,
          connected,
          mobileLines,
          pendingDollars,
          connectedDollars,
          teamSize: teamRepIds.length,
        });
      }
      
      // Sort by role hierarchy then by sold
      const roleOrder = { EXECUTIVE: 0, MANAGER: 1, SUPERVISOR: 2 };
      teamData.sort((a, b) => {
        const roleCompare = (roleOrder[a.role as keyof typeof roleOrder] || 3) - (roleOrder[b.role as keyof typeof roleOrder] || 3);
        if (roleCompare !== 0) return roleCompare;
        return b.sold - a.sold;
      });
      
      const totals = teamData.reduce((acc, team) => ({
        totalSold: acc.totalSold + team.sold,
        totalConnected: acc.totalConnected + team.connected,
        totalMobileLines: acc.totalMobileLines + team.mobileLines,
        totalPendingDollars: acc.totalPendingDollars + team.pendingDollars,
        totalConnectedDollars: acc.totalConnectedDollars + team.connectedDollars,
      }), { totalSold: 0, totalConnected: 0, totalMobileLines: 0, totalPendingDollars: 0, totalConnectedDollars: 0 });
      
      res.json({ data: teamData, totals });
    } catch (error) {
      console.error("Team production error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Detailed Rep Leaderboard - All users can view (company-wide visibility)
  app.get("/api/reports/rep-leaderboard", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const allUsers = await storage.getUsers();
      
      // Show all reps to all authenticated users
      const scopedRepIds = allUsers
        .filter(u => !u.deletedAt && ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"].includes(u.role))
        .map(u => u.repId);
      const scopeDescription = "All Reps";
      
      // Filter orders by date range AND scope
      const periodOrders = allOrders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end && scopedRepIds.includes(o.repId);
      });
      
      // Build detailed metrics per rep
      const repMetrics: Array<{
        userId: string;
        repId: string;
        name: string;
        role: string;
        supervisorName: string | null;
        ordersSold: number;
        ordersConnected: number;
        ordersPending: number;
        ordersApproved: number;
        earned: number;
        paid: number;
        outstanding: number;
        mobileLines: number;
        tvSold: number;
        internetSold: number;
        avgOrderValue: number;
        approvalRate: number;
        connectionRate: number;
        leadsConverted: number;
        leadsTotal: number;
        conversionRate: number;
      }> = [];
      
      const scopeInfo = {
        role: user.role,
        scopeDescription,
        repCount: scopedRepIds.length,
      };
      
      for (const repId of scopedRepIds) {
        const repUser = allUsers.find(u => u.repId === repId && !u.deletedAt);
        if (!repUser) continue;
        
        const repOrders = periodOrders.filter(o => o.repId === repId);
        const ordersSold = repOrders.length;
        const ordersConnected = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const ordersPending = repOrders.filter(o => o.jobStatus === "PENDING").length;
        const ordersApproved = repOrders.filter(o => o.approvalStatus === "APPROVED").length;
        
        const earned = repOrders
          .filter(o => o.jobStatus === "COMPLETED" && o.approvalStatus === "APPROVED")
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const paid = repOrders
          .filter(o => o.paidDate)
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const mobileLines = repOrders.reduce((sum, o) => sum + (o.mobileLinesQty || 0), 0);
        const tvSold = repOrders.filter(o => o.tvSold).length;
        const internetSold = repOrders.length - tvSold; // Orders without TV as proxy for internet
        
        const avgOrderValue = ordersSold > 0 ? earned / ordersConnected || 0 : 0;
        const approvalRate = ordersSold > 0 ? (ordersApproved / ordersSold) * 100 : 0;
        const connectionRate = ordersSold > 0 ? (ordersConnected / ordersSold) * 100 : 0;
        
        // Get leads for this rep in period
        const repLeads = await storage.getLeadsByRepId(repId, {
          dateFrom: start.toISOString().split("T")[0],
          dateTo: end.toISOString().split("T")[0],
          includeDisposed: true,
        });
        const leadsConverted = repLeads.filter(l => l.disposition === "SOLD").length;
        const leadsTotal = repLeads.length;
        const conversionRate = leadsTotal > 0 ? (leadsConverted / leadsTotal) * 100 : 0;
        
        // Find supervisor name
        let supervisorName: string | null = null;
        if (repUser.assignedSupervisorId) {
          const supervisor = allUsers.find(u => u.id === repUser.assignedSupervisorId);
          supervisorName = supervisor?.name || null;
        }
        
        repMetrics.push({
          userId: repUser.id,
          repId: repUser.repId,
          name: repUser.name,
          role: repUser.role,
          supervisorName,
          ordersSold,
          ordersConnected,
          ordersPending,
          ordersApproved,
          earned,
          paid,
          outstanding: earned - paid,
          mobileLines,
          tvSold,
          internetSold,
          avgOrderValue,
          approvalRate,
          connectionRate,
          leadsConverted,
          leadsTotal,
          conversionRate,
        });
      }
      
      // Sort by earned descending
      repMetrics.sort((a, b) => b.earned - a.earned);
      
      const totals = repMetrics.reduce((acc, rep) => ({
        totalOrders: acc.totalOrders + rep.ordersSold,
        totalConnected: acc.totalConnected + rep.ordersConnected,
        totalEarned: acc.totalEarned + rep.earned,
        totalPaid: acc.totalPaid + rep.paid,
        totalMobileLines: acc.totalMobileLines + rep.mobileLines,
        totalLeads: acc.totalLeads + rep.leadsTotal,
        totalConverted: acc.totalConverted + rep.leadsConverted,
      }), { totalOrders: 0, totalConnected: 0, totalEarned: 0, totalPaid: 0, totalMobileLines: 0, totalLeads: 0, totalConverted: 0 });
      
      res.json({ 
        data: repMetrics, 
        totals,
        scopeInfo,
      });
    } catch (error) {
      console.error("Rep leaderboard error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Override Earnings by Invoice
  app.get("/api/reports/override-invoices", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, recipientId } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      // Only ADMIN and OPERATIONS can see all override earnings
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const overrideEarnings = await storage.getOverrideEarnings();
      const orders = await storage.getOrders({});
      const users = await storage.getUsers();
      const overrideAgreements = await storage.getOverrideAgreements();
      
      // Filter by date and optionally by recipient
      const filteredEarnings = overrideEarnings.filter(e => {
        const order = orders.find(o => o.id === e.salesOrderId);
        if (!order) return false;
        const orderDate = new Date(order.dateSold);
        if (orderDate < start || orderDate >= end) return false;
        if (recipientId && e.recipientUserId !== recipientId) return false;
        return true;
      });
      
      // Group by invoice/order
      const invoiceMap: Record<string, {
        orderId: string;
        invoiceNumber: string | null;
        customerName: string;
        dateSold: string;
        repName: string;
        totalOverride: number;
        overrides: Array<{
          recipientName: string;
          recipientRole: string;
          amount: string;
          agreementId: string | null;
        }>;
      }> = {};
      
      for (const earning of filteredEarnings) {
        const order = orders.find(o => o.id === earning.salesOrderId);
        if (!order) continue;
        
        const recipient = users.find(u => u.id === earning.recipientUserId);
        const rep = users.find(u => u.repId === order.repId);
        
        if (!invoiceMap[order.id]) {
          invoiceMap[order.id] = {
            orderId: order.id,
            invoiceNumber: order.invoiceNumber,
            customerName: order.customerName,
            dateSold: order.dateSold,
            repName: rep?.name || order.repId,
            totalOverride: 0,
            overrides: [],
          };
        }
        
        const amount = parseFloat(earning.amount);
        invoiceMap[order.id].totalOverride += amount;
        invoiceMap[order.id].overrides.push({
          recipientName: recipient?.name || earning.recipientUserId,
          recipientRole: earning.sourceLevelUsed,
          amount: earning.amount,
          agreementId: earning.overrideAgreementId,
        });
      }
      
      const data = Object.values(invoiceMap).sort((a, b) => 
        new Date(b.dateSold).getTime() - new Date(a.dateSold).getTime()
      );
      
      // Get totals
      const totalOverrides = data.reduce((sum, inv) => sum + inv.totalOverride, 0);
      const invoiceCount = data.length;
      
      // Get eligible recipients for filter dropdown
      const recipients = users
        .filter(u => ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN"].includes(u.role) && !u.deletedAt)
        .map(u => ({ id: u.id, name: u.name, role: u.role }));
      
      res.json({ 
        data, 
        totals: { totalOverrides: totalOverrides.toFixed(2), invoiceCount },
        recipients,
      });
    } catch (error) {
      console.error("Override invoices error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Provider/Client Profitability Analysis
  app.get("/api/reports/profitability", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate, type = "provider" } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const providers = await storage.getProviders();
      const clients = await storage.getClients();
      const rateCards = await storage.getRateCards();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const entityStats: Record<string, {
        name: string;
        orders: number;
        revenue: number;
        commissionCost: number;
        overrideCost: number;
        margin: number;
        marginPercent: number;
      }> = {};
      
      for (const order of periodOrders) {
        if (order.approvalStatus !== "APPROVED") continue;
        
        const entityId = type === "provider" ? order.providerId : order.clientId || "unknown";
        const entity = type === "provider" 
          ? providers.find(p => p.id === entityId)
          : clients.find(c => c.id === entityId);
        
        if (!entityStats[entityId]) {
          entityStats[entityId] = {
            name: entity?.name || "Unknown",
            orders: 0,
            revenue: 0,
            commissionCost: 0,
            overrideCost: 0,
            margin: 0,
            marginPercent: 0,
          };
        }
        
        const baseEarned = parseFloat(order.baseCommissionEarned);
        const incentiveEarned = parseFloat(order.incentiveEarned);
        const overrideEarned = parseFloat(order.overrideEarned);
        const totalCommissionCost = baseEarned + incentiveEarned;
        
        // Calculate estimated revenue (use MRC if available, otherwise estimate)
        const mrc = parseFloat(order.mrc) || 0;
        const estimatedRevenue = mrc > 0 ? mrc * 12 : totalCommissionCost * 5; // Assume 5x commission as revenue if MRC unknown
        
        entityStats[entityId].orders++;
        entityStats[entityId].revenue += estimatedRevenue;
        entityStats[entityId].commissionCost += totalCommissionCost;
        entityStats[entityId].overrideCost += overrideEarned;
      }
      
      // Calculate margins
      for (const stats of Object.values(entityStats)) {
        const totalCost = stats.commissionCost + stats.overrideCost;
        stats.margin = stats.revenue - totalCost;
        stats.marginPercent = stats.revenue > 0 ? (stats.margin / stats.revenue) * 100 : 0;
      }
      
      const data = Object.entries(entityStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.margin - a.margin);
      
      const totals = data.reduce((acc, item) => ({
        totalOrders: acc.totalOrders + item.orders,
        totalRevenue: acc.totalRevenue + item.revenue,
        totalCommissionCost: acc.totalCommissionCost + item.commissionCost,
        totalOverrideCost: acc.totalOverrideCost + item.overrideCost,
        totalMargin: acc.totalMargin + item.margin,
      }), { totalOrders: 0, totalRevenue: 0, totalCommissionCost: 0, totalOverrideCost: 0, totalMargin: 0 });
      
      res.json({ 
        data, 
        totals: {
          ...totals,
          avgMarginPercent: totals.totalRevenue > 0 ? (totals.totalMargin / totals.totalRevenue) * 100 : 0,
        },
        period: { start: start.toISOString(), end: end.toISOString() },
      });
    } catch (error) {
      console.error("Profitability report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Commission Cost Analysis by Product Mix
  app.get("/api/reports/product-mix", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const services = await storage.getServices();
      const providers = await storage.getProviders();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user);
      
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      // Product mix by service type
      const serviceStats: Record<string, {
        name: string;
        provider: string;
        orders: number;
        baseCommission: number;
        incentiveCommission: number;
        overrideCommission: number;
        totalCommission: number;
        avgCommissionPerOrder: number;
        percentOfTotal: number;
      }> = {};
      
      let grandTotalCommission = 0;
      
      for (const order of periodOrders) {
        if (order.approvalStatus !== "APPROVED") continue;
        
        const serviceId = order.serviceId;
        const service = services.find(s => s.id === serviceId);
        const provider = providers.find(p => p.id === order.providerId);
        
        if (!serviceStats[serviceId]) {
          serviceStats[serviceId] = {
            name: service?.name || "Unknown",
            provider: provider?.name || "Unknown",
            orders: 0,
            baseCommission: 0,
            incentiveCommission: 0,
            overrideCommission: 0,
            totalCommission: 0,
            avgCommissionPerOrder: 0,
            percentOfTotal: 0,
          };
        }
        
        const baseEarned = parseFloat(order.baseCommissionEarned);
        const incentiveEarned = parseFloat(order.incentiveEarned);
        const overrideEarned = parseFloat(order.overrideEarned);
        const totalCommission = baseEarned + incentiveEarned + overrideEarned;
        
        serviceStats[serviceId].orders++;
        serviceStats[serviceId].baseCommission += baseEarned;
        serviceStats[serviceId].incentiveCommission += incentiveEarned;
        serviceStats[serviceId].overrideCommission += overrideEarned;
        serviceStats[serviceId].totalCommission += totalCommission;
        grandTotalCommission += totalCommission;
      }
      
      // Calculate averages and percentages
      for (const stats of Object.values(serviceStats)) {
        stats.avgCommissionPerOrder = stats.orders > 0 ? stats.totalCommission / stats.orders : 0;
        stats.percentOfTotal = grandTotalCommission > 0 ? (stats.totalCommission / grandTotalCommission) * 100 : 0;
      }
      
      const data = Object.entries(serviceStats)
        .map(([id, stats]) => ({ id, ...stats }))
        .sort((a, b) => b.totalCommission - a.totalCommission);
      
      const totals = data.reduce((acc, item) => ({
        totalOrders: acc.totalOrders + item.orders,
        totalBaseCommission: acc.totalBaseCommission + item.baseCommission,
        totalIncentiveCommission: acc.totalIncentiveCommission + item.incentiveCommission,
        totalOverrideCommission: acc.totalOverrideCommission + item.overrideCommission,
        grandTotalCommission: acc.grandTotalCommission + item.totalCommission,
      }), { totalOrders: 0, totalBaseCommission: 0, totalIncentiveCommission: 0, totalOverrideCommission: 0, grandTotalCommission: 0 });
      
      // Also break down by provider
      const providerBreakdown: Record<string, { name: string; totalCommission: number; percentOfTotal: number }> = {};
      for (const order of periodOrders) {
        if (order.approvalStatus !== "APPROVED") continue;
        const provider = providers.find(p => p.id === order.providerId);
        if (!providerBreakdown[order.providerId]) {
          providerBreakdown[order.providerId] = {
            name: provider?.name || "Unknown",
            totalCommission: 0,
            percentOfTotal: 0,
          };
        }
        providerBreakdown[order.providerId].totalCommission += 
          parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned) + parseFloat(order.overrideEarned);
      }
      for (const stats of Object.values(providerBreakdown)) {
        stats.percentOfTotal = grandTotalCommission > 0 ? (stats.totalCommission / grandTotalCommission) * 100 : 0;
      }
      
      res.json({ 
        data, 
        totals,
        providerBreakdown: Object.entries(providerBreakdown)
          .map(([id, stats]) => ({ id, ...stats }))
          .sort((a, b) => b.totalCommission - a.totalCommission),
        period: { start: start.toISOString(), end: end.toISOString() },
      });
    } catch (error) {
      console.error("Product mix report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Register object storage routes
  registerObjectStorageRoutes(app);

  // === Knowledge Documents API ===
  
  // Role hierarchy for access control
  const ROLE_HIERARCHY: Record<string, number> = {
    "REP": 1,
    "SUPERVISOR": 2,
    "MANAGER": 3,
    "EXECUTIVE": 4,
    "ADMIN": 5,
    "OPERATIONS": 6,
  };

  // Get all knowledge documents (filtered by user's role)
  app.get("/api/knowledge-documents", auth, async (req: AuthRequest, res) => {
    try {
      const userRole = req.user!.role;
      const userRoleLevel = ROLE_HIERARCHY[userRole] || 1;
      
      const allDocs = await storage.getKnowledgeDocuments();
      
      // Filter documents based on minimumRole requirement
      const visibleDocs = allDocs.filter(doc => {
        const docMinRole = doc.minimumRole || "REP";
        const docRoleLevel = ROLE_HIERARCHY[docMinRole] || 1;
        return userRoleLevel >= docRoleLevel;
      });
      
      res.json(visibleDocs);
    } catch (error) {
      console.error("Get knowledge documents error:", error);
      res.status(500).json({ message: "Failed to get documents" });
    }
  });

  // Get single knowledge document
  app.get("/api/knowledge-documents/:id", auth, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.getKnowledgeDocumentById(req.params.id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      res.json(doc);
    } catch (error) {
      console.error("Get knowledge document error:", error);
      res.status(500).json({ message: "Failed to get document" });
    }
  });

  // Create knowledge document (after file is uploaded to object storage) - Manager+ only
  app.post("/api/knowledge-documents", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const validatedData = insertKnowledgeDocumentSchema.parse({
        ...req.body,
        uploadedById: req.user!.id,
      });
      
      const doc = await storage.createKnowledgeDocument(validatedData);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "CREATE",
        tableName: "knowledge_documents",
        recordId: doc.id,
        afterJson: JSON.stringify({ title: doc.title, fileName: doc.fileName }),
      });
      
      res.status(201).json(doc);
    } catch (error) {
      console.error("Create knowledge document error:", error);
      res.status(500).json({ message: "Failed to create document" });
    }
  });

  // Update knowledge document metadata
  app.patch("/api/knowledge-documents/:id", auth, async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getKnowledgeDocumentById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const { title, description, category, tags, minimumRole } = req.body;
      const doc = await storage.updateKnowledgeDocument(req.params.id, {
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        tags: tags !== undefined ? tags : existing.tags,
        minimumRole: minimumRole !== undefined ? minimumRole : existing.minimumRole,
      });
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "UPDATE",
        tableName: "knowledge_documents",
        recordId: doc!.id,
        afterJson: JSON.stringify({ title: doc!.title }),
      });
      
      res.json(doc);
    } catch (error) {
      console.error("Update knowledge document error:", error);
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  // Seed reference data from bundled JSON (OPERATIONS only) - one-click sync
  app.post("/api/admin/seed-reference-data", auth, async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "OPERATIONS") {
        return res.status(403).json({ message: "Only OPERATIONS can seed reference data" });
      }

      const referenceData = await import("./reference-data.json");
      const results = { users: 0, providers: 0, clients: 0, services: 0, rateCards: 0, errors: [] as string[] };

      // Step 0: Upsert users by repId (only sales roles, skip if already exists to preserve passwords)
      if (referenceData.users) {
        for (const u of referenceData.users) {
          try {
            // Only sync REP, SUPERVISOR, MANAGER, EXECUTIVE roles
            const salesRoles = ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"];
            if (!salesRoles.includes(u.role)) continue;
            
            // Check if user exists by repId
            const existing = await db.select().from(users).where(eq(users.repId, u.repId)).limit(1);
            
            if (existing.length > 0) {
              // User exists - only update name and status, preserve password
              await db.update(users).set({ 
                name: u.name, 
                status: u.status as any,
                deletedAt: null, // Reactivate if soft-deleted
              }).where(eq(users.id, existing[0].id));
            } else {
              // Create new user with specified password hash
              await db.insert(users).values({
                id: u.id,
                name: u.name,
                repId: u.repId,
                role: u.role as any,
                status: u.status as any,
                passwordHash: u.passwordHash,
                mustChangePassword: u.mustChangePassword,
              });
            }
            results.users++;
          } catch (e) {
            results.errors.push(`User ${u.repId}: ${e}`);
          }
        }
      }

      // Build lookup maps for names -> IDs (to handle UUID mismatches between dev/prod)
      const providerNameToId: Record<string, string> = {};
      const clientNameToId: Record<string, string> = {};
      const serviceCodeToId: Record<string, string> = {};

      // Step 1: Upsert providers by name, track their IDs
      for (const p of referenceData.providers) {
        try {
          // Check if provider exists by name
          const existing = await db.select().from(providers).where(eq(providers.name, p.name)).limit(1);
          let providerId: string;
          
          if (existing.length > 0) {
            // Update existing provider
            await db.update(providers).set({ active: p.active }).where(eq(providers.id, existing[0].id));
            providerId = existing[0].id;
          } else {
            // Insert new provider with specified ID
            await db.insert(providers).values({ id: p.id, name: p.name, active: p.active });
            providerId = p.id;
          }
          providerNameToId[p.name] = providerId;
          results.providers++;
        } catch (e) {
          results.errors.push(`Provider ${p.name}: ${e}`);
        }
      }

      // Step 2: Upsert clients by name
      for (const c of referenceData.clients) {
        try {
          const existing = await db.select().from(clients).where(eq(clients.name, c.name)).limit(1);
          let clientId: string;
          
          if (existing.length > 0) {
            await db.update(clients).set({ active: c.active }).where(eq(clients.id, existing[0].id));
            clientId = existing[0].id;
          } else {
            await db.insert(clients).values({ id: c.id, name: c.name, active: c.active });
            clientId = c.id;
          }
          clientNameToId[c.name] = clientId;
          results.clients++;
        } catch (e) {
          results.errors.push(`Client ${c.name}: ${e}`);
        }
      }

      // Step 3: Upsert services by code
      for (const s of referenceData.services) {
        try {
          const existing = await db.select().from(services).where(eq(services.code, s.code)).limit(1);
          let serviceId: string;
          
          if (existing.length > 0) {
            await db.update(services).set({ 
              name: s.name, 
              category: s.category,
              unitType: s.unitType,
              active: s.active 
            }).where(eq(services.id, existing[0].id));
            serviceId = existing[0].id;
          } else {
            await db.insert(services).values({ 
              id: s.id, 
              code: s.code, 
              name: s.name, 
              category: s.category,
              unitType: s.unitType,
              active: s.active 
            });
            serviceId = s.id;
          }
          serviceCodeToId[s.code] = serviceId;
          results.services++;
        } catch (e) {
          results.errors.push(`Service ${s.code}: ${e}`);
        }
      }

      // Build reverse lookups from reference data to resolve foreign keys
      const refProviderIdToName: Record<string, string> = {};
      const refClientIdToName: Record<string, string> = {};
      const refServiceIdToCode: Record<string, string> = {};
      
      for (const p of referenceData.providers) refProviderIdToName[p.id] = p.name;
      for (const c of referenceData.clients) refClientIdToName[c.id] = c.name;
      for (const s of referenceData.services) refServiceIdToCode[s.id] = s.code;

      // Step 4: Insert rate cards with resolved foreign keys
      for (const r of referenceData.rateCards) {
        try {
          // Resolve foreign keys using name-based lookups
          const providerName = refProviderIdToName[r.providerId];
          const clientName = r.clientId ? refClientIdToName[r.clientId] : null;
          const serviceCode = r.serviceId ? refServiceIdToCode[r.serviceId] : null;
          
          const resolvedProviderId = providerName ? providerNameToId[providerName] : null;
          const resolvedClientId = clientName ? clientNameToId[clientName] : null;
          const resolvedServiceId = serviceCode ? serviceCodeToId[serviceCode] : null;
          
          if (!resolvedProviderId) {
            results.errors.push(`Rate card skipped: missing provider ${providerName}`);
            continue;
          }

          // Create unique key for upsert matching
          const rateCardData = {
            providerId: resolvedProviderId,
            clientId: resolvedClientId,
            serviceId: resolvedServiceId,
            mobileProductType: r.mobileProductType as any,
            mobilePortedStatus: r.mobilePortedStatus as any,
            effectiveStart: r.effectiveStart,
            active: r.active,
            baseAmount: String(r.baseAmount),
            tvAddonAmount: String(r.tvAddonAmount),
            mobilePerLineAmount: String(r.mobilePerLineAmount),
            overrideDeduction: String(r.overrideDeduction),
            tvOverrideDeduction: String(r.tvOverrideDeduction),
            mobileOverrideDeduction: String(r.mobileOverrideDeduction),
          };

          // Check for existing rate card with same key combination
          let whereConditions = [eq(rateCards.providerId, resolvedProviderId)];
          if (resolvedClientId) {
            whereConditions.push(eq(rateCards.clientId, resolvedClientId));
          } else {
            whereConditions.push(sql`${rateCards.clientId} IS NULL`);
          }
          if (resolvedServiceId) {
            whereConditions.push(eq(rateCards.serviceId, resolvedServiceId));
          } else {
            whereConditions.push(sql`${rateCards.serviceId} IS NULL`);
          }
          if (r.mobileProductType) {
            whereConditions.push(eq(rateCards.mobileProductType, r.mobileProductType as any));
          } else {
            whereConditions.push(sql`${rateCards.mobileProductType} IS NULL`);
          }
          if (r.mobilePortedStatus) {
            whereConditions.push(eq(rateCards.mobilePortedStatus, r.mobilePortedStatus as any));
          } else {
            whereConditions.push(sql`${rateCards.mobilePortedStatus} IS NULL`);
          }

          const existing = await db.select().from(rateCards).where(and(...whereConditions)).limit(1);
          
          if (existing.length > 0) {
            // Update existing rate card
            await db.update(rateCards).set({
              effectiveStart: r.effectiveStart,
              active: r.active,
              baseAmount: String(r.baseAmount),
              tvAddonAmount: String(r.tvAddonAmount),
              mobilePerLineAmount: String(r.mobilePerLineAmount),
              overrideDeduction: String(r.overrideDeduction),
              tvOverrideDeduction: String(r.tvOverrideDeduction),
              mobileOverrideDeduction: String(r.mobileOverrideDeduction),
            }).where(eq(rateCards.id, existing[0].id));
          } else {
            // Insert new rate card
            await db.insert(rateCards).values(rateCardData);
          }
          results.rateCards++;
        } catch (e) {
          results.errors.push(`Rate card: ${e}`);
        }
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "SEED",
        tableName: "reference_data",
        recordId: "all",
        afterJson: JSON.stringify(results),
      });

      res.json({ message: "Reference data seeded successfully", results });
    } catch (error) {
      console.error("Seed reference data error:", error);
      res.status(500).json({ message: "Failed to seed reference data", error: String(error) });
    }
  });

  // Export reference data as SQL (OPERATIONS only) - for syncing to production
  app.get("/api/admin/export-reference-data", auth, async (req: AuthRequest, res) => {
    try {
      if (req.user?.role !== "OPERATIONS") {
        return res.status(403).json({ message: "Only OPERATIONS can export reference data" });
      }

      const providers = await storage.getProviders();
      const clients = await storage.getClients();
      const services = await storage.getServices();
      const rateCards = await storage.getRateCards();

      // Helper to escape SQL strings
      const esc = (val: string | null | undefined): string => {
        if (val === null || val === undefined) return '';
        return val.replace(/'/g, "''");
      };

      let sql = "-- Iron Crest CRM Reference Data Export\n";
      sql += `-- Generated: ${new Date().toISOString()}\n\n`;

      // Providers (omit timestamps - let target DB set them)
      sql += "-- PROVIDERS\n";
      for (const p of providers) {
        sql += `INSERT INTO providers (id, name, active) VALUES ('${p.id}', '${esc(p.name)}', ${p.active}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;\n`;
      }

      // Clients
      sql += "\n-- CLIENTS\n";
      for (const c of clients) {
        sql += `INSERT INTO clients (id, name, active) VALUES ('${c.id}', '${esc(c.name)}', ${c.active}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active;\n`;
      }

      // Services
      sql += "\n-- SERVICES\n";
      for (const s of services) {
        sql += `INSERT INTO services (id, code, name, category, unit_type, active) VALUES ('${s.id}', '${esc(s.code)}', '${esc(s.name)}', '${esc(s.category)}', '${esc(s.unitType)}', ${s.active}) ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category, unit_type = EXCLUDED.unit_type, active = EXCLUDED.active;\n`;
      }

      // Rate Cards - include ALL rate cards (active and deleted) with full metadata
      sql += "\n-- RATE CARDS (including deleted)\n";
      for (const r of rateCards) {
        const serviceId = r.serviceId ? `'${r.serviceId}'` : 'NULL';
        const clientId = r.clientId ? `'${r.clientId}'` : 'NULL';
        const mobileProductType = r.mobileProductType ? `'${esc(r.mobileProductType)}'` : 'NULL';
        const mobilePortedStatus = r.mobilePortedStatus ? `'${esc(r.mobilePortedStatus)}'` : 'NULL';
        const deletedAt = r.deletedAt ? `'${new Date(r.deletedAt).toISOString()}'` : 'NULL';
        const deletedByUserId = r.deletedByUserId ? `'${r.deletedByUserId}'` : 'NULL';
        sql += `INSERT INTO rate_cards (id, provider_id, client_id, service_id, effective_start, active, base_amount, tv_addon_amount, mobile_per_line_amount, mobile_product_type, mobile_ported_status, override_deduction, tv_override_deduction, mobile_override_deduction, deleted_at, deleted_by_user_id) VALUES ('${r.id}', '${r.providerId}', ${clientId}, ${serviceId}, '${r.effectiveStart}', ${r.active}, ${r.baseAmount}, ${r.tvAddonAmount}, ${r.mobilePerLineAmount}, ${mobileProductType}, ${mobilePortedStatus}, ${r.overrideDeduction}, ${r.tvOverrideDeduction}, ${r.mobileOverrideDeduction}, ${deletedAt}, ${deletedByUserId}) ON CONFLICT (id) DO UPDATE SET service_id = EXCLUDED.service_id, client_id = EXCLUDED.client_id, effective_start = EXCLUDED.effective_start, active = EXCLUDED.active, base_amount = EXCLUDED.base_amount, tv_addon_amount = EXCLUDED.tv_addon_amount, mobile_per_line_amount = EXCLUDED.mobile_per_line_amount, mobile_product_type = EXCLUDED.mobile_product_type, mobile_ported_status = EXCLUDED.mobile_ported_status, override_deduction = EXCLUDED.override_deduction, tv_override_deduction = EXCLUDED.tv_override_deduction, mobile_override_deduction = EXCLUDED.mobile_override_deduction, deleted_at = EXCLUDED.deleted_at, deleted_by_user_id = EXCLUDED.deleted_by_user_id;\n`;
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "EXPORT",
        tableName: "reference_data",
        recordId: "all",
        afterJson: JSON.stringify({ providers: providers.length, clients: clients.length, services: services.length, rateCards: rateCards.length }),
      });

      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", "attachment; filename=reference-data-export.sql");
      res.send(sql);
    } catch (error) {
      console.error("Export reference data error:", error);
      res.status(500).json({ message: "Failed to export reference data" });
    }
  });

  // Soft delete knowledge document (Admin/Manager only)
  app.delete("/api/knowledge-documents/:id", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getKnowledgeDocumentById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      await storage.softDeleteKnowledgeDocument(req.params.id, req.user!.id);
      
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "DELETE",
        tableName: "knowledge_documents",
        recordId: req.params.id,
        beforeJson: JSON.stringify({ title: existing.title, fileName: existing.fileName }),
      });
      
      res.json({ message: "Document deleted" });
    } catch (error) {
      console.error("Delete knowledge document error:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // ================== PAYROLL SYSTEM API ==================

  // Payroll Schedules
  app.get("/api/admin/payroll/schedules", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getPayrollSchedules();
      res.json(schedules);
    } catch (error) { res.status(500).json({ message: "Failed to get schedules" }); }
  });

  app.post("/api/admin/payroll/schedules", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.createPayrollSchedule(req.body);
      await storage.createAuditLog({ action: "create_payroll_schedule", tableName: "payroll_schedules", recordId: schedule.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(schedule);
    } catch (error) { res.status(500).json({ message: "Failed to create schedule" }); }
  });

  app.put("/api/admin/payroll/schedules/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.updatePayrollSchedule(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_payroll_schedule", tableName: "payroll_schedules", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(schedule);
    } catch (error) { res.status(500).json({ message: "Failed to update schedule" }); }
  });

  app.delete("/api/admin/payroll/schedules/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deletePayrollSchedule(req.params.id);
      await storage.createAuditLog({ action: "delete_payroll_schedule", tableName: "payroll_schedules", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Schedule deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete schedule" }); }
  });

  // Deduction Types
  app.get("/api/admin/payroll/deduction-types", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const types = await storage.getDeductionTypes();
      res.json(types);
    } catch (error) { res.status(500).json({ message: "Failed to get deduction types" }); }
  });

  app.post("/api/admin/payroll/deduction-types", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const type = await storage.createDeductionType(req.body);
      await storage.createAuditLog({ action: "create_deduction_type", tableName: "deduction_types", recordId: type.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(type);
    } catch (error) { res.status(500).json({ message: "Failed to create deduction type" }); }
  });

  app.put("/api/admin/payroll/deduction-types/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const type = await storage.updateDeductionType(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_deduction_type", tableName: "deduction_types", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(type);
    } catch (error) { res.status(500).json({ message: "Failed to update deduction type" }); }
  });

  app.delete("/api/admin/payroll/deduction-types/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteDeductionType(req.params.id);
      await storage.createAuditLog({ action: "delete_deduction_type", tableName: "deduction_types", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Deduction type deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete deduction type" }); }
  });

  // User Deductions
  app.get("/api/admin/payroll/user-deductions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const userId = req.query.userId as string | undefined;
      if (userId) {
        const deductions = await storage.getUserDeductions(userId);
        res.json(deductions);
      } else {
        const deductions = await storage.getAllActiveUserDeductions();
        res.json(deductions);
      }
    } catch (error) { res.status(500).json({ message: "Failed to get user deductions" }); }
  });

  app.post("/api/admin/payroll/user-deductions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const deduction = await storage.createUserDeduction(req.body);
      await storage.createAuditLog({ action: "create_user_deduction", tableName: "user_deductions", recordId: deduction.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(deduction);
    } catch (error) { res.status(500).json({ message: "Failed to create user deduction" }); }
  });

  app.put("/api/admin/payroll/user-deductions/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const deduction = await storage.updateUserDeduction(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_user_deduction", tableName: "user_deductions", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(deduction);
    } catch (error) { res.status(500).json({ message: "Failed to update user deduction" }); }
  });

  app.delete("/api/admin/payroll/user-deductions/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteUserDeduction(req.params.id);
      await storage.createAuditLog({ action: "delete_user_deduction", tableName: "user_deductions", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "User deduction deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete user deduction" }); }
  });

  // Advances
  app.get("/api/admin/payroll/advances", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as string | undefined;
      if (status === "pending") {
        const advances = await storage.getPendingAdvances();
        res.json(advances);
      } else {
        const advances = await storage.getAdvances();
        res.json(advances);
      }
    } catch (error) { res.status(500).json({ message: "Failed to get advances" }); }
  });

  app.get("/api/admin/payroll/advances/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.getAdvanceById(req.params.id);
      if (!advance) return res.status(404).json({ message: "Advance not found" });
      const repayments = await storage.getAdvanceRepayments(req.params.id);
      res.json({ ...advance, repayments });
    } catch (error) { res.status(500).json({ message: "Failed to get advance" }); }
  });

  app.post("/api/admin/payroll/advances", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.createAdvance(req.body);
      await storage.createAuditLog({ action: "create_advance", tableName: "advances", recordId: advance.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to create advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/approve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { approvedAmount, notes } = req.body;
      const advance = await storage.approveAdvance(req.params.id, req.user!.id, approvedAmount, notes);
      await storage.createAuditLog({ action: "approve_advance", tableName: "advances", recordId: req.params.id, afterJson: JSON.stringify({ approvedAmount, notes }), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to approve advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/reject", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { notes } = req.body;
      const advance = await storage.rejectAdvance(req.params.id, req.user!.id, notes);
      await storage.createAuditLog({ action: "reject_advance", tableName: "advances", recordId: req.params.id, afterJson: JSON.stringify({ notes }), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to reject advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/mark-paid", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.markAdvancePaid(req.params.id);
      await storage.createAuditLog({ action: "mark_advance_paid", tableName: "advances", recordId: req.params.id, userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to mark advance paid" }); }
  });

  // Rep can request an advance
  app.post("/api/payroll/advances/request", auth, async (req: AuthRequest, res) => {
    try {
      const advance = await storage.createAdvance({ 
        userId: req.user!.id, 
        requestedAmount: req.body.requestedAmount,
        reason: req.body.reason,
        repaymentPercentage: req.body.repaymentPercentage || "100"
      });
      await storage.createAuditLog({ action: "request_advance", tableName: "advances", recordId: advance.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to request advance" }); }
  });

  // Rep can view their own advances
  app.get("/api/payroll/my-advances", auth, async (req: AuthRequest, res) => {
    try {
      const advances = await storage.getAdvancesByUser(req.user!.id);
      res.json(advances);
    } catch (error) { res.status(500).json({ message: "Failed to get advances" }); }
  });

  // User Tax Profiles
  app.get("/api/admin/payroll/tax-profiles", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const profiles = await storage.getAllUserTaxProfiles();
      res.json(profiles);
    } catch (error) { res.status(500).json({ message: "Failed to get tax profiles" }); }
  });

  app.get("/api/admin/payroll/tax-profiles/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const profile = await storage.getUserTaxProfile(req.params.userId);
      res.json(profile || {});
    } catch (error) { res.status(500).json({ message: "Failed to get tax profile" }); }
  });

  app.put("/api/admin/payroll/tax-profiles/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const profile = await storage.updateUserTaxProfile(req.params.userId, req.body);
      await storage.createAuditLog({ action: "update_tax_profile", tableName: "user_tax_profiles", recordId: req.params.userId, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(profile);
    } catch (error) { res.status(500).json({ message: "Failed to update tax profile" }); }
  });

  // User Payment Methods
  app.get("/api/admin/payroll/payment-methods/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const methods = await storage.getUserPaymentMethods(req.params.userId);
      res.json(methods);
    } catch (error) { res.status(500).json({ message: "Failed to get payment methods" }); }
  });

  app.post("/api/admin/payroll/payment-methods", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const method = await storage.createUserPaymentMethod(req.body);
      await storage.createAuditLog({ action: "create_payment_method", tableName: "user_payment_methods", recordId: method.id, afterJson: JSON.stringify({ ...req.body, accountLastFour: req.body.accountLastFour }), userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to create payment method" }); }
  });

  app.put("/api/admin/payroll/payment-methods/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const method = await storage.updateUserPaymentMethod(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_payment_method", tableName: "user_payment_methods", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to update payment method" }); }
  });

  app.delete("/api/admin/payroll/payment-methods/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteUserPaymentMethod(req.params.id);
      await storage.createAuditLog({ action: "delete_payment_method", tableName: "user_payment_methods", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Payment method deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete payment method" }); }
  });

  // Rep can manage their own payment methods
  app.get("/api/payroll/my-payment-methods", auth, async (req: AuthRequest, res) => {
    try {
      const methods = await storage.getUserPaymentMethods(req.user!.id);
      res.json(methods);
    } catch (error) { res.status(500).json({ message: "Failed to get payment methods" }); }
  });

  app.post("/api/payroll/my-payment-methods", auth, async (req: AuthRequest, res) => {
    try {
      const method = await storage.createUserPaymentMethod({ ...req.body, userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to create payment method" }); }
  });

  // Pay Statements
  app.get("/api/admin/payroll/statements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRunId = req.query.payRunId as string | undefined;
      const statements = await storage.getPayStatements(payRunId);
      res.json(statements);
    } catch (error) { res.status(500).json({ message: "Failed to get statements" }); }
  });

  app.get("/api/admin/payroll/statements/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      res.json({ ...statement, lineItems, deductions });
    } catch (error) { res.status(500).json({ message: "Failed to get statement" }); }
  });

  // Generate pay statements for a pay run
  app.post("/api/admin/payroll/payruns/:payRunId/generate-statements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      
      // Get all orders in this pay run grouped by repId
      const orders = await storage.getOrdersByPayRunId(req.params.payRunId);
      const chargebacks = await storage.getChargebacksByPayRun(req.params.payRunId);
      
      // Group by repId
      const ordersByRep = new Map<string, any[]>();
      const chargebacksByRep = new Map<string, any[]>();
      
      for (const order of orders) {
        if (!ordersByRep.has(order.repId)) ordersByRep.set(order.repId, []);
        ordersByRep.get(order.repId)!.push(order);
      }
      
      for (const cb of chargebacks) {
        if (!chargebacksByRep.has(cb.repId)) chargebacksByRep.set(cb.repId, []);
        chargebacksByRep.get(cb.repId)!.push(cb);
      }
      
      const allRepIds = new Set([...Array.from(ordersByRep.keys()), ...Array.from(chargebacksByRep.keys())]);
      const statements: any[] = [];
      const currentYear = new Date().getFullYear();
      
      for (const repId of Array.from(allRepIds)) {
        const user = await storage.getUserByRepId(repId);
        if (!user) continue;
        
        const repOrders = ordersByRep.get(repId) || [];
        const repChargebacks = chargebacksByRep.get(repId) || [];
        
        // Calculate totals
        let grossCommission = 0;
        let incentivesTotal = 0;
        let chargebacksTotal = 0;
        
        for (const order of repOrders) {
          grossCommission += parseFloat(order.baseCommissionEarned || "0");
          incentivesTotal += parseFloat(order.incentiveEarned || "0");
        }
        
        for (const cb of repChargebacks) {
          chargebacksTotal += parseFloat(cb.amount || "0");
        }
        
        // Get override earnings for this user in this pay run
        const overrideEarnings = await storage.getOverrideEarningsByPayRun(req.params.payRunId, user.id);
        let overrideEarningsTotal = 0;
        for (const oe of overrideEarnings) {
          overrideEarningsTotal += parseFloat(oe.amount || "0");
        }
        
        // Get active deductions for this user
        const userDeductions = await storage.getActiveUserDeductions(user.id);
        let deductionsTotal = 0;
        const deductionDetails: { userDeductionId?: string; deductionTypeName: string; amount: string }[] = [];
        
        for (const ud of userDeductions) {
          const deductionType = await storage.getDeductionTypeById(ud.deductionTypeId);
          const deductionAmount = parseFloat(ud.amount || "0");
          deductionsTotal += deductionAmount;
          deductionDetails.push({
            userDeductionId: ud.id,
            deductionTypeName: deductionType?.name || "Unknown",
            amount: deductionAmount.toFixed(2)
          });
        }
        
        // Get active advances to apply
        const activeAdvances = await storage.getActiveAdvancesForUser(user.id);
        let advancesApplied = 0;
        
        // Get YTD totals
        const ytd = await storage.getYTDTotalsForUser(user.id, currentYear);
        
        // Calculate net pay
        const grossTotal = grossCommission + incentivesTotal + overrideEarningsTotal;
        const netPay = grossTotal - chargebacksTotal - deductionsTotal - advancesApplied;
        
        // Create pay statement
        const statement = await storage.createPayStatement({
          payRunId: req.params.payRunId,
          userId: user.id,
          periodStart: payRun.weekEndingDate,
          periodEnd: payRun.weekEndingDate,
          grossCommission: grossCommission.toFixed(2),
          overrideEarningsTotal: overrideEarningsTotal.toFixed(2),
          incentivesTotal: incentivesTotal.toFixed(2),
          chargebacksTotal: chargebacksTotal.toFixed(2),
          adjustmentsTotal: "0",
          deductionsTotal: deductionsTotal.toFixed(2),
          advancesApplied: advancesApplied.toFixed(2),
          taxWithheld: "0",
          netPay: netPay.toFixed(2),
          ytdGross: (parseFloat(ytd.totalGross) + grossTotal).toFixed(2),
          ytdDeductions: (parseFloat(ytd.totalDeductions) + deductionsTotal).toFixed(2),
          ytdNetPay: (parseFloat(ytd.totalNetPay) + netPay).toFixed(2),
        });
        
        // Create line items for orders
        for (const order of repOrders) {
          await storage.createPayStatementLineItem({
            payStatementId: statement.id,
            category: "Commission",
            description: `Order ${order.invoiceNumber || order.id}`,
            sourceType: "sales_order",
            sourceId: order.id,
            amount: order.baseCommissionEarned,
          });
        }
        
        // Create line items for chargebacks
        for (const cb of repChargebacks) {
          await storage.createPayStatementLineItem({
            payStatementId: statement.id,
            category: "Chargeback",
            description: `Chargeback ${cb.invoiceNumber}`,
            sourceType: "chargeback",
            sourceId: cb.id,
            amount: `-${cb.amount}`,
          });
        }
        
        // Create deduction records
        for (const ded of deductionDetails) {
          await storage.createPayStatementDeduction({
            payStatementId: statement.id,
            userDeductionId: ded.userDeductionId,
            deductionTypeName: ded.deductionTypeName,
            amount: ded.amount,
          });
        }
        
        statements.push(statement);
      }
      
      await storage.createAuditLog({ 
        action: "generate_pay_statements", 
        tableName: "pay_statements", 
        recordId: req.params.payRunId, 
        afterJson: JSON.stringify({ count: statements.length }), 
        userId: req.user!.id 
      });
      
      res.json({ generated: statements.length, statements });
    } catch (error: any) {
      console.error("Generate statements error:", error);
      res.status(500).json({ message: error.message || "Failed to generate statements" });
    }
  });

  // Issue a pay statement
  app.post("/api/admin/payroll/statements/:id/issue", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.issuePayStatement(req.params.id);
      await storage.createAuditLog({ action: "issue_pay_statement", tableName: "pay_statements", recordId: req.params.id, userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to issue statement" }); }
  });

  // Mark statement as paid
  app.post("/api/admin/payroll/statements/:id/mark-paid", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { paymentMethodId, paymentReference } = req.body;
      const statement = await storage.markPayStatementPaid(req.params.id, paymentMethodId, paymentReference);
      await storage.createAuditLog({ action: "mark_statement_paid", tableName: "pay_statements", recordId: req.params.id, afterJson: JSON.stringify({ paymentMethodId, paymentReference }), userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to mark statement paid" }); }
  });

  // Void a pay statement
  app.post("/api/admin/payroll/statements/:id/void", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.voidPayStatement(req.params.id);
      await storage.createAuditLog({ action: "void_pay_statement", tableName: "pay_statements", recordId: req.params.id, userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to void statement" }); }
  });

  // Rep can view their own pay statements
  app.get("/api/payroll/my-statements", auth, async (req: AuthRequest, res) => {
    try {
      const statements = await storage.getPayStatementsByUser(req.user!.id);
      res.json(statements);
    } catch (error) { res.status(500).json({ message: "Failed to get statements" }); }
  });

  app.get("/api/payroll/my-statements/:id", auth, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      if (statement.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      res.json({ ...statement, lineItems, deductions });
    } catch (error) { res.status(500).json({ message: "Failed to get statement" }); }
  });

  // PDF download for pay statement
  app.get("/api/payroll/my-statements/:id/pdf", auth, async (req: AuthRequest, res) => {
    try {
      const { generatePayStatementPdf } = await import("./pdf-generator");
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      if (statement.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      const user = await storage.getUserById(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const pdfBuffer = await generatePayStatementPdf({
        statement,
        lineItems,
        deductions,
        user,
        companyName: "Iron Crest CRM",
      });

      const periodStart = new Date(statement.periodStart).toISOString().split("T")[0];
      const periodEnd = new Date(statement.periodEnd).toISOString().split("T")[0];
      const filename = `PayStatement_${user.repId}_${periodStart}_${periodEnd}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Rep can view their YTD totals
  app.get("/api/payroll/my-ytd", auth, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const ytd = await storage.getYTDTotalsForUser(req.user!.id, year);
      res.json(ytd);
    } catch (error) { res.status(500).json({ message: "Failed to get YTD totals" }); }
  });

  // Payroll Reports
  app.get("/api/admin/payroll/reports/summary", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const statements = await storage.getPayStatements();
      const totalGross = statements.reduce((sum, s) => sum + parseFloat(s.grossCommission || "0"), 0);
      const totalNet = statements.reduce((sum, s) => sum + parseFloat(s.netPay || "0"), 0);
      const totalDeductions = statements.reduce((sum, s) => sum + parseFloat(s.deductionsTotal || "0"), 0);
      const paid = statements.filter(s => s.status === "PAID").length;
      const pending = statements.filter(s => s.status === "DRAFT" || s.status === "ISSUED").length;
      
      res.json({
        totalStatements: statements.length,
        totalGross: totalGross.toFixed(2),
        totalNet: totalNet.toFixed(2),
        totalDeductions: totalDeductions.toFixed(2),
        paidCount: paid,
        pendingCount: pending,
      });
    } catch (error) { res.status(500).json({ message: "Failed to get summary" }); }
  });

  app.get("/api/admin/payroll/reports/by-user", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const users = await storage.getActiveUsers();
      const report = [];
      
      for (const user of users) {
        const ytd = await storage.getYTDTotalsForUser(user.id, year);
        report.push({
          userId: user.id,
          repId: user.repId,
          name: user.name,
          role: user.role,
          ytdGross: ytd.totalGross,
          ytdDeductions: ytd.totalDeductions,
          ytdNetPay: ytd.totalNetPay,
        });
      }
      
      res.json(report);
    } catch (error) { res.status(500).json({ message: "Failed to get report" }); }
  });

  // Pay Run Approvals
  app.get("/api/admin/payroll/payruns/:payRunId/approvals", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const approvals = await storage.getPayRunApprovals(req.params.payRunId);
      res.json(approvals);
    } catch (error) { res.status(500).json({ message: "Failed to get approvals" }); }
  });

  app.post("/api/admin/payroll/payruns/:payRunId/approvals", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const approval = await storage.createPayRunApproval({
        payRunId: req.params.payRunId,
        roleRequired: req.body.roleRequired,
      });
      res.json(approval);
    } catch (error) { res.status(500).json({ message: "Failed to create approval" }); }
  });

  app.post("/api/admin/payroll/approvals/:id/decide", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { status, notes } = req.body;
      const approval = await storage.updatePayRunApproval(req.params.id, {
        approverId: req.user!.id,
        status,
        notes,
      });
      await storage.createAuditLog({ 
        action: `payrun_approval_${status.toLowerCase()}`, 
        tableName: "pay_run_approvals", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ status, notes }), 
        userId: req.user!.id 
      });
      res.json(approval);
    } catch (error) { res.status(500).json({ message: "Failed to update approval" }); }
  });

  // ============ QuickBooks Integration Routes ============
  
  // Get QuickBooks connection status
  app.get("/api/admin/quickbooks/status", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const connection = await qb.getConnection();
      const mappings = await qb.getAccountMappings();
      
      res.json({
        isConnected: connection?.isConnected || false,
        companyName: connection?.companyName || null,
        realmId: connection?.realmId || null,
        lastSyncAt: connection?.lastSyncAt || null,
        accessTokenExpiresAt: connection?.accessTokenExpiresAt || null,
        accountMappings: mappings,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get QuickBooks status" });
    }
  });

  // Get QuickBooks OAuth authorization URL
  app.get("/api/admin/quickbooks/authorize", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const state = crypto.randomBytes(16).toString("hex");
      const authUrl = qb.getAuthorizationUrl(state);
      res.json({ authUrl, state });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get authorization URL" });
    }
  });

  // QuickBooks OAuth callback
  app.get("/api/quickbooks/callback", async (req, res) => {
    try {
      const { code, realmId, state } = req.query;
      
      if (!code || !realmId) {
        return res.status(400).send("Missing authorization code or realm ID");
      }

      const qb = await import("./quickbooks");
      await qb.exchangeCodeForTokens(code as string, realmId as string, "system");
      
      res.send(`
        <html>
          <body>
            <h2>QuickBooks Connected Successfully!</h2>
            <p>You can close this window and return to Iron Crest CRM.</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'QUICKBOOKS_CONNECTED' }, '*');
                setTimeout(() => window.close(), 2000);
              }
            </script>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("QuickBooks callback error:", error);
      res.status(500).send(`QuickBooks connection failed: ${error.message}`);
    }
  });

  // Disconnect QuickBooks
  app.post("/api/admin/quickbooks/disconnect", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      await qb.disconnectQuickBooks();
      await storage.createAuditLog({
        action: "quickbooks_disconnected",
        tableName: "quickbooks_connection",
        recordId: "system",
        userId: req.user!.id,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to disconnect" });
    }
  });

  // Get QuickBooks accounts for mapping
  app.get("/api/admin/quickbooks/accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const accounts = await qb.fetchQBAccounts();
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch accounts" });
    }
  });

  // Save account mapping
  app.post("/api/admin/quickbooks/mappings", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { mappingType, qbAccountId, qbAccountName, qbAccountType } = req.body;
      
      if (!mappingType || !qbAccountId || !qbAccountName) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const qb = await import("./quickbooks");
      await qb.saveAccountMapping(mappingType, qbAccountId, qbAccountName, qbAccountType || "");
      
      await storage.createAuditLog({
        action: "quickbooks_mapping_saved",
        tableName: "quickbooks_account_mappings",
        recordId: mappingType,
        afterJson: JSON.stringify({ mappingType, qbAccountId, qbAccountName }),
        userId: req.user!.id,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to save mapping" });
    }
  });

  // Sync order invoice to QuickBooks
  app.post("/api/admin/quickbooks/sync-invoice/:orderId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.syncInvoiceToQuickBooks(req.params.orderId, req.user!.id);
      
      if (result.success) {
        await storage.createAuditLog({
          action: "quickbooks_invoice_synced",
          tableName: "sales_orders",
          recordId: req.params.orderId,
          afterJson: JSON.stringify({ qbInvoiceId: result.qbInvoiceId }),
          userId: req.user!.id,
        });
      }
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Post pay run journal entry to QuickBooks
  app.post("/api/admin/quickbooks/post-journal/:payRunId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.postPayRunJournalEntry(req.params.payRunId, req.user!.id);
      
      if (result.success) {
        await storage.createAuditLog({
          action: "quickbooks_journal_posted",
          tableName: "pay_runs",
          recordId: req.params.payRunId,
          afterJson: JSON.stringify({ qbJournalEntryId: result.qbJournalEntryId }),
          userId: req.user!.id,
        });
      }
      
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get QuickBooks sync logs
  app.get("/api/admin/quickbooks/sync-logs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const entityType = req.query.entityType as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await qb.getSyncLogs(entityType, limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get sync logs" });
    }
  });

  // Retry failed sync
  app.post("/api/admin/quickbooks/retry/:syncLogId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.retryFailedSync(req.params.syncLogId, req.user!.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Bulk sync approved orders to QuickBooks
  app.post("/api/admin/quickbooks/bulk-sync-invoices", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      
      // Get all approved orders without QB invoice ID
      const ordersToSync = await db.query.salesOrders.findMany({
        where: and(
          eq(salesOrders.approvalStatus, "APPROVED"),
          sql`${salesOrders.qbInvoiceId} IS NULL`
        ),
      });
      
      const results = {
        total: ordersToSync.length,
        synced: 0,
        failed: 0,
        errors: [] as string[],
      };
      
      for (const order of ordersToSync) {
        const result = await qb.syncInvoiceToQuickBooks(order.id, req.user!.id);
        if (result.success) {
          results.synced++;
        } else {
          results.failed++;
          results.errors.push(`Order ${order.invoiceNumber}: ${result.error}`);
        }
      }
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ========== NEW PAYROLL FEATURES ROUTES ==========

  // Tax Documents (1099s)
  app.get("/api/admin/tax-documents", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.taxYear) filters.taxYear = parseInt(req.query.taxYear as string);
      if (req.query.status) filters.status = req.query.status as string;
      const docs = await storage.getTaxDocuments(filters);
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/tax-documents/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.getTaxDocumentById(req.params.id);
      if (!doc) return res.status(404).json({ message: "Tax document not found" });
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/tax-documents/generate-data/:year", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const taxYear = parseInt(req.params.year);
      const data = await storage.generate1099DataForYear(taxYear);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tax-documents", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.createTaxDocument({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "tax_document_created",
        tableName: "tax_documents",
        recordId: doc.id,
        afterJson: JSON.stringify(doc),
        userId: req.user!.id,
      });
      res.status(201).json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/tax-documents/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const doc = await storage.updateTaxDocument(req.params.id, req.body);
      await storage.createAuditLog({
        action: "tax_document_updated",
        tableName: "tax_documents",
        recordId: req.params.id,
        afterJson: JSON.stringify(doc),
        userId: req.user!.id,
      });
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk generate 1099s for a tax year
  app.post("/api/admin/tax-documents/bulk-generate/:year", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const taxYear = parseInt(req.params.year);
      const data = await storage.generate1099DataForYear(taxYear);
      const results = { created: 0, skipped: 0, errors: [] as string[] };

      for (const row of data) {
        try {
          const existing = await storage.getTaxDocuments({ userId: row.userId, taxYear });
          if (existing.length > 0) {
            results.skipped++;
            continue;
          }

          const taxProfile = await storage.getUserTaxProfile(row.userId);
          
          await storage.createTaxDocument({
            userId: row.userId,
            taxYear,
            documentType: "1099_NEC",
            status: "DRAFT",
            totalEarnings: row.totalEarnings,
            recipientName: row.userName,
            recipientTin: taxProfile?.taxIdLastFour || null,
            recipientAddress: taxProfile?.businessAddress || null,
            recipientCity: null,
            recipientState: null,
            recipientZip: null,
            createdByUserId: req.user!.id,
          });
          results.created++;
        } catch (err: any) {
          results.errors.push(`${row.userName}: ${err.message}`);
        }
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // User Bank Accounts (ACH)
  app.get("/api/admin/bank-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ message: "userId required" });
      const accounts = await storage.getUserBankAccounts(userId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bank-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { userId, accountHolderName, bankName, accountType, routingNumber, accountNumber, isPrimary } = req.body;
      
      if (!userId || !accountHolderName || !bankName || !accountType || !routingNumber || !accountNumber) {
        return res.status(400).json({ message: "All fields are required" });
      }
      
      if (routingNumber.length !== 9) {
        return res.status(400).json({ message: "Routing number must be 9 digits" });
      }
      
      const accountNumberLast4 = accountNumber.slice(-4);
      const accountNumberEncrypted = accountNumber;
      
      const account = await storage.createUserBankAccount({
        userId,
        accountHolderName,
        bankName,
        accountType,
        routingNumber,
        accountNumberLast4,
        accountNumberEncrypted,
        isPrimary: isPrimary !== false,
      });
      
      await storage.createAuditLog({
        action: "bank_account_created",
        tableName: "user_bank_accounts",
        recordId: account.id,
        userId: req.user!.id,
      });
      res.status(201).json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/bank-accounts/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deactivateUserBankAccount(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ACH Exports
  app.get("/api/admin/ach-exports", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.payRunId) filters.payRunId = req.query.payRunId;
      const exports = await storage.getAchExports(filters);
      res.json(exports);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/ach-exports/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const exp = await storage.getAchExportById(req.params.id);
      if (!exp) return res.status(404).json({ message: "ACH export not found" });
      const items = await storage.getAchExportItems(req.params.id);
      res.json({ ...exp, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/ach-exports/generate/:payRunId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status !== "FINALIZED") return res.status(400).json({ message: "Pay run must be finalized" });

      const statements = await storage.getPayStatements(req.params.payRunId);
      
      let totalAmount = 0;
      const validStatements = [];

      for (const stmt of statements) {
        const bankAccount = await storage.getPrimaryBankAccount(stmt.userId);
        if (bankAccount) {
          totalAmount += parseFloat(stmt.netPay);
          validStatements.push({ statement: stmt, bankAccount });
        }
      }

      if (validStatements.length === 0) {
        return res.status(400).json({ message: "No users with bank accounts found" });
      }

      const batchNumber = await storage.generateAchBatchNumber();
      const effectiveDate = new Date();
      effectiveDate.setDate(effectiveDate.getDate() + 2);

      const achExport = await storage.createAchExport({
        payRunId: req.params.payRunId,
        batchNumber,
        status: "PENDING",
        totalAmount: totalAmount.toFixed(2),
        transactionCount: validStatements.length,
        effectiveDate: effectiveDate.toISOString().slice(0, 10),
        createdByUserId: req.user!.id,
      });

      for (const { statement, bankAccount } of validStatements) {
        await storage.createAchExportItem({
          achExportId: achExport.id,
          payStatementId: statement.id,
          userId: statement.userId,
          bankAccountId: bankAccount.id,
          amount: statement.netPay,
          status: "PENDING",
        });
      }

      await storage.createAuditLog({
        action: "ach_export_created",
        tableName: "ach_exports",
        recordId: achExport.id,
        afterJson: JSON.stringify({ batchNumber, totalAmount, count: validStatements.length }),
        userId: req.user!.id,
      });

      res.status(201).json(achExport);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/ach-exports/:id/status", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status } = req.body;
      const exp = await storage.updateAchExport(req.params.id, { 
        status,
        ...(status === "SENT" && { sentAt: new Date() }),
        ...(status === "COMPLETED" && { completedAt: new Date() }),
      });
      res.json(exp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payment Reconciliation
  app.get("/api/admin/payment-reconciliations", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.userId) filters.userId = req.query.userId;
      const recs = await storage.getPaymentReconciliations(filters);
      res.json(recs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payment-reconciliations", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const rec = await storage.createPaymentReconciliation(req.body);
      res.status(201).json(rec);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payment-reconciliations/:id/match", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { paidAmount, paymentReference } = req.body;
      const rec = await storage.matchPaymentReconciliation(
        req.params.id, 
        paidAmount, 
        paymentReference,
        req.user!.id
      );
      res.json(rec);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bonuses/SPIFFs
  app.get("/api/admin/bonuses", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.status) filters.status = req.query.status;
      if (req.query.bonusType) filters.bonusType = req.query.bonusType;
      const bonusList = await storage.getBonuses(filters);
      res.json(bonusList);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/bonuses/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const bonus = await storage.getBonusById(req.params.id);
      if (!bonus) return res.status(404).json({ message: "Bonus not found" });
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bonuses", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const bonus = await storage.createBonus({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "bonus_created",
        tableName: "bonuses",
        recordId: bonus.id,
        afterJson: JSON.stringify(bonus),
        userId: req.user!.id,
      });
      res.status(201).json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bonuses/:id/approve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const bonus = await storage.approveBonus(req.params.id, req.user!.id);
      await storage.createAuditLog({
        action: "bonus_approved",
        tableName: "bonuses",
        recordId: req.params.id,
        userId: req.user!.id,
      });
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bonuses/:id/cancel", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      const bonus = await storage.cancelBonus(req.params.id, reason);
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Draw Accounts
  app.get("/api/admin/draw-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.status) filters.status = req.query.status;
      const accounts = await storage.getDrawAccounts(filters);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/draw-accounts/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const account = await storage.getDrawAccountById(req.params.id);
      if (!account) return res.status(404).json({ message: "Draw account not found" });
      const transactions = await storage.getDrawTransactions(req.params.id);
      res.json({ ...account, transactions });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/draw-accounts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const account = await storage.createDrawAccount({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "draw_account_created",
        tableName: "draw_accounts",
        recordId: account.id,
        afterJson: JSON.stringify(account),
        userId: req.user!.id,
      });
      res.status(201).json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/draw-accounts/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const account = await storage.updateDrawAccount(req.params.id, req.body);
      res.json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Split Commission Agreements
  app.get("/api/admin/split-agreements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.primaryRepId) filters.primaryRepId = req.query.primaryRepId;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      const agreements = await storage.getSplitAgreements(filters);
      res.json(agreements);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/split-agreements/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const agreement = await storage.getSplitAgreementById(req.params.id);
      if (!agreement) return res.status(404).json({ message: "Agreement not found" });
      const recipients = await storage.getSplitRecipients(req.params.id);
      res.json({ ...agreement, recipients });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/split-agreements", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { recipients, ...agreementData } = req.body;
      const agreement = await storage.createSplitAgreement({
        ...agreementData,
        createdByUserId: req.user!.id,
      });

      if (recipients && Array.isArray(recipients)) {
        for (const recipient of recipients) {
          await storage.createSplitRecipient({
            agreementId: agreement.id,
            userId: recipient.userId,
            splitType: recipient.splitType,
            splitValue: recipient.splitValue,
          });
        }
      }

      await storage.createAuditLog({
        action: "split_agreement_created",
        tableName: "split_commission_agreements",
        recordId: agreement.id,
        afterJson: JSON.stringify({ ...agreement, recipients }),
        userId: req.user!.id,
      });

      res.status(201).json(agreement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/split-agreements/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { recipients, ...agreementData } = req.body;
      const agreement = await storage.updateSplitAgreement(req.params.id, agreementData);

      if (recipients && Array.isArray(recipients)) {
        await storage.deleteSplitRecipients(req.params.id);
        for (const recipient of recipients) {
          await storage.createSplitRecipient({
            agreementId: req.params.id,
            userId: recipient.userId,
            splitType: recipient.splitType,
            splitValue: recipient.splitValue,
          });
        }
      }

      res.json(agreement);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Commission Tiers
  app.get("/api/admin/commission-tiers", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.providerId) filters.providerId = req.query.providerId;
      if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === "true";
      const tiers = await storage.getCommissionTiers(filters);
      res.json(tiers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/commission-tiers/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const tier = await storage.getCommissionTierById(req.params.id);
      if (!tier) return res.status(404).json({ message: "Tier not found" });
      const levels = await storage.getTierLevels(req.params.id);
      res.json({ ...tier, levels });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/commission-tiers", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { levels, ...tierData } = req.body;
      const tier = await storage.createCommissionTier({
        ...tierData,
        createdByUserId: req.user!.id,
      });

      if (levels && Array.isArray(levels)) {
        for (const level of levels) {
          await storage.createTierLevel({
            tierId: tier.id,
            minVolume: level.minVolume,
            maxVolume: level.maxVolume,
            bonusPercentage: level.bonusPercentage,
            bonusFlat: level.bonusFlat,
            multiplier: level.multiplier,
          });
        }
      }

      await storage.createAuditLog({
        action: "commission_tier_created",
        tableName: "commission_tiers",
        recordId: tier.id,
        afterJson: JSON.stringify({ ...tier, levels }),
        userId: req.user!.id,
      });

      res.status(201).json(tier);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/commission-tiers/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { levels, ...tierData } = req.body;
      const tier = await storage.updateCommissionTier(req.params.id, tierData);

      if (levels && Array.isArray(levels)) {
        await storage.deleteTierLevels(req.params.id);
        for (const level of levels) {
          await storage.createTierLevel({
            tierId: req.params.id,
            minVolume: level.minVolume,
            maxVolume: level.maxVolume,
            bonusPercentage: level.bonusPercentage,
            bonusFlat: level.bonusFlat,
            multiplier: level.multiplier,
          });
        }
      }

      res.json(tier);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Rep Tier Assignments
  app.get("/api/admin/rep-tier-assignments/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const assignments = await storage.getRepTierAssignments(req.params.userId);
      res.json(assignments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/rep-tier-assignments", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const assignment = await storage.createRepTierAssignment({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      res.status(201).json(assignment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/rep-tier-assignments/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteRepTierAssignment(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Scheduled Pay Runs
  app.get("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getScheduledPayRuns();
      res.json(schedules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.getScheduledPayRunById(req.params.id);
      if (!schedule) return res.status(404).json({ message: "Schedule not found" });
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.createScheduledPayRun({
        ...req.body,
        createdByUserId: req.user!.id,
      });
      await storage.createAuditLog({
        action: "scheduled_pay_run_created",
        tableName: "scheduled_pay_runs",
        recordId: schedule.id,
        afterJson: JSON.stringify(schedule),
        userId: req.user!.id,
      });
      res.status(201).json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.updateScheduledPayRun(req.params.id, req.body);
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteScheduledPayRun(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Commission Forecasts
  app.get("/api/admin/commission-forecasts", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const filters: any = {};
      if (req.query.userId) filters.userId = req.query.userId;
      if (req.query.forecastPeriod) filters.forecastPeriod = req.query.forecastPeriod;
      const forecasts = await storage.getCommissionForecasts(filters);
      res.json(forecasts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/commission-forecasts/calculate/:userId", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { periodType = "MONTH", periodStart, periodEnd } = req.query as any;
      const now = new Date();
      const start = periodStart || now.toISOString().slice(0, 10);
      const endDate = new Date(now);
      endDate.setMonth(endDate.getMonth() + 1);
      const end = periodEnd || endDate.toISOString().slice(0, 10);

      const forecast = await storage.calculateCommissionForecast(req.params.userId, periodType, start, end);
      res.json(forecast);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll Reports Dashboard
  app.get("/api/admin/payroll-reports/summary", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const startOfYear = `${year}-01-01`;
      const endOfYear = `${year}-12-31`;

      const monthlyTotals = await db.select({
        month: sql<number>`EXTRACT(MONTH FROM ${payStatements.periodEnd})`,
        totalGross: sql<string>`COALESCE(SUM(${payStatements.grossCommission} + ${payStatements.overrideEarningsTotal} + ${payStatements.incentivesTotal}), 0)`,
        totalDeductions: sql<string>`COALESCE(SUM(${payStatements.deductionsTotal}), 0)`,
        totalNetPay: sql<string>`COALESCE(SUM(${payStatements.netPay}), 0)`,
        statementCount: sql<number>`COUNT(*)`,
      })
      .from(payStatements)
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear),
        inArray(payStatements.status, ["ISSUED", "PAID"])
      ))
      .groupBy(sql`EXTRACT(MONTH FROM ${payStatements.periodEnd})`)
      .orderBy(sql`EXTRACT(MONTH FROM ${payStatements.periodEnd})`);

      const topEarners = await db.select({
        userId: payStatements.userId,
        userName: users.name,
        totalNetPay: sql<string>`COALESCE(SUM(${payStatements.netPay}), 0)`,
      })
      .from(payStatements)
      .innerJoin(users, eq(payStatements.userId, users.id))
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear),
        inArray(payStatements.status, ["ISSUED", "PAID"])
      ))
      .groupBy(payStatements.userId, users.name)
      .orderBy(sql`SUM(${payStatements.netPay}) DESC`)
      .limit(10);

      const ytdTotals = await db.select({
        totalGross: sql<string>`COALESCE(SUM(${payStatements.grossCommission} + ${payStatements.overrideEarningsTotal} + ${payStatements.incentivesTotal}), 0)`,
        totalDeductions: sql<string>`COALESCE(SUM(${payStatements.deductionsTotal}), 0)`,
        totalNetPay: sql<string>`COALESCE(SUM(${payStatements.netPay}), 0)`,
        totalBonuses: sql<string>`COALESCE(SUM(${payStatements.adjustmentsTotal}), 0)`,
        statementCount: sql<number>`COUNT(*)`,
      })
      .from(payStatements)
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear),
        inArray(payStatements.status, ["ISSUED", "PAID"])
      ));

      res.json({
        year,
        monthlyTotals,
        topEarners,
        ytdTotals: ytdTotals[0],
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/payroll-reports/deductions", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const startOfYear = `${year}-01-01`;
      const endOfYear = `${year}-12-31`;

      const deductionsByType = await db.select({
        deductionTypeName: payStatementDeductions.deductionTypeName,
        totalAmount: sql<string>`COALESCE(SUM(${payStatementDeductions.amount}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(payStatementDeductions)
      .innerJoin(payStatements, eq(payStatementDeductions.payStatementId, payStatements.id))
      .where(and(
        gte(payStatements.periodEnd, startOfYear),
        lte(payStatements.periodEnd, endOfYear)
      ))
      .groupBy(payStatementDeductions.deductionTypeName)
      .orderBy(sql`SUM(${payStatementDeductions.amount}) DESC`);

      res.json({ year, deductionsByType });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Executive Reports - Sales Overview
  app.get("/api/executive/sales-overview", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      // EXECUTIVE, ADMIN, OPERATIONS, MANAGER access
      if (!["EXECUTIVE", "ADMIN", "OPERATIONS", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthStartStr = monthStart.toISOString().split('T')[0];

      // Role-based order scoping
      let allOrders: any[] = [];
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        allOrders = await storage.getOrders({});
      } else if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId];
        allOrders = await storage.getOrders({ teamRepIds });
      } else if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const teamRepIds = [user.repId, ...scope.directRepIds, ...scope.indirectRepIds];
        allOrders = await storage.getOrders({ teamRepIds });
      }
      const monthOrders = allOrders.filter(o => new Date(o.dateSold) >= monthStart);

      // Company totals
      const totalSales = monthOrders.length;
      const connectedSales = monthOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const pendingSales = monthOrders.filter(o => o.jobStatus === "PENDING").length;

      // Commission totals
      const pendingCommissions = monthOrders
        .filter(o => o.approvalStatus === "UNAPPROVED" || o.jobStatus === "PENDING")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0);
      const connectedCommissions = monthOrders
        .filter(o => o.jobStatus === "COMPLETED" && o.approvalStatus === "APPROVED")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0);

      // Get services and providers for breakdown
      const allServices = await storage.getServices();
      const allProviders = await storage.getProviders();

      // Service type breakdown
      const serviceBreakdown: Record<string, { sales: number; connected: number; pending: number; commission: number }> = {};
      for (const order of monthOrders) {
        const service = allServices.find(s => s.id === order.serviceId);
        const category = service?.category || service?.name || "Other";
        if (!serviceBreakdown[category]) {
          serviceBreakdown[category] = { sales: 0, connected: 0, pending: 0, commission: 0 };
        }
        serviceBreakdown[category].sales++;
        if (order.jobStatus === "COMPLETED") serviceBreakdown[category].connected++;
        if (order.jobStatus === "PENDING") serviceBreakdown[category].pending++;
        serviceBreakdown[category].commission += parseFloat(order.baseCommissionEarned || "0");
      }

      // Provider breakdown
      const providerBreakdown: Record<string, { name: string; sales: number; connected: number; pending: number; commission: number }> = {};
      for (const order of monthOrders) {
        const provider = allProviders.find(p => p.id === order.providerId);
        const providerName = provider?.name || "Unknown";
        if (!providerBreakdown[order.providerId]) {
          providerBreakdown[order.providerId] = { name: providerName, sales: 0, connected: 0, pending: 0, commission: 0 };
        }
        providerBreakdown[order.providerId].sales++;
        if (order.jobStatus === "COMPLETED") providerBreakdown[order.providerId].connected++;
        if (order.jobStatus === "PENDING") providerBreakdown[order.providerId].pending++;
        providerBreakdown[order.providerId].commission += parseFloat(order.baseCommissionEarned || "0");
      }

      // Get managers and their teams
      const allUsers = await storage.getUsers();
      const managers = allUsers.filter(u => u.role === "MANAGER" && u.status === "ACTIVE");
      
      const teamBreakdown = await Promise.all(managers.map(async (manager) => {
        const teamMembers = await storage.getTeamMembers(manager.id);
        const teamRepIds = [manager.repId, ...teamMembers.map(m => m.repId)];
        const teamOrders = monthOrders.filter(o => teamRepIds.includes(o.repId));
        
        return {
          managerId: manager.id,
          managerName: manager.name,
          teamSize: teamMembers.length,
          totalSales: teamOrders.length,
          connectedSales: teamOrders.filter(o => o.jobStatus === "COMPLETED").length,
          pendingSales: teamOrders.filter(o => o.jobStatus === "PENDING").length,
          pendingCommissions: teamOrders
            .filter(o => o.approvalStatus === "UNAPPROVED" || o.jobStatus === "PENDING")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          connectedCommissions: teamOrders
            .filter(o => o.jobStatus === "COMPLETED" && o.approvalStatus === "APPROVED")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
        };
      }));

      res.json({
        period: { start: monthStartStr, end: now.toISOString().split('T')[0] },
        companyTotals: {
          totalSales,
          connectedSales,
          pendingSales,
          pendingCommissions,
          connectedCommissions,
        },
        serviceBreakdown: Object.entries(serviceBreakdown).map(([category, data]) => ({
          category,
          ...data,
        })),
        providerBreakdown: Object.values(providerBreakdown),
        teamBreakdown,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Executive Reports - Rep Listing
  app.get("/api/executive/rep-listing", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["EXECUTIVE", "ADMIN", "OPERATIONS", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allUsers = await storage.getUsers();
      const allServices = await storage.getServices();
      const allProviders = await storage.getProviders();

      // Role-based order and rep scoping
      let allOrders: any[] = [];
      let scopedRepIds: string[] = [];
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        allOrders = await storage.getOrders({});
        scopedRepIds = allUsers.filter(u => ["REP", "SUPERVISOR"].includes(u.role) && u.status === "ACTIVE").map(u => u.repId);
      } else if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId];
        allOrders = await storage.getOrders({ teamRepIds });
        scopedRepIds = teamRepIds;
      } else if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const teamRepIds = [user.repId, ...scope.directRepIds, ...scope.indirectRepIds];
        allOrders = await storage.getOrders({ teamRepIds });
        scopedRepIds = teamRepIds;
      }
      
      const monthOrders = allOrders.filter(o => new Date(o.dateSold) >= monthStart);
      const reps = allUsers.filter(u => ["REP", "SUPERVISOR"].includes(u.role) && u.status === "ACTIVE" && scopedRepIds.includes(u.repId));

      const repListing = await Promise.all(reps.map(async (rep) => {
        const repOrders = monthOrders.filter(o => o.repId === rep.repId);
        
        // Service breakdown for this rep
        const serviceBreakdown: Record<string, { sales: number; connected: number; commission: number }> = {};
        for (const order of repOrders) {
          const service = allServices.find(s => s.id === order.serviceId);
          const category = service?.category || service?.name || "Other";
          if (!serviceBreakdown[category]) {
            serviceBreakdown[category] = { sales: 0, connected: 0, commission: 0 };
          }
          serviceBreakdown[category].sales++;
          if (order.jobStatus === "COMPLETED") serviceBreakdown[category].connected++;
          serviceBreakdown[category].commission += parseFloat(order.baseCommissionEarned || "0");
        }

        // Provider breakdown for this rep
        const providerBreakdown: Record<string, { name: string; sales: number; connected: number; commission: number }> = {};
        for (const order of repOrders) {
          const provider = allProviders.find(p => p.id === order.providerId);
          const providerName = provider?.name || "Unknown";
          if (!providerBreakdown[order.providerId]) {
            providerBreakdown[order.providerId] = { name: providerName, sales: 0, connected: 0, commission: 0 };
          }
          providerBreakdown[order.providerId].sales++;
          if (order.jobStatus === "COMPLETED") providerBreakdown[order.providerId].connected++;
          providerBreakdown[order.providerId].commission += parseFloat(order.baseCommissionEarned || "0");
        }

        // Find manager
        const manager = rep.assignedManagerId ? allUsers.find(u => u.id === rep.assignedManagerId) : null;

        return {
          repId: rep.repId,
          userId: rep.id,
          name: rep.name,
          role: rep.role,
          managerName: manager?.name || null,
          totalSales: repOrders.length,
          connectedSales: repOrders.filter(o => o.jobStatus === "COMPLETED").length,
          pendingSales: repOrders.filter(o => o.jobStatus === "PENDING").length,
          pendingCommissions: repOrders
            .filter(o => o.approvalStatus === "UNAPPROVED" || o.jobStatus === "PENDING")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          connectedCommissions: repOrders
            .filter(o => o.jobStatus === "COMPLETED" && o.approvalStatus === "APPROVED")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          serviceBreakdown: Object.entries(serviceBreakdown).map(([category, data]) => ({
            category,
            ...data,
          })),
          providerBreakdown: Object.values(providerBreakdown),
        };
      }));

      // Sort by total sales descending
      repListing.sort((a, b) => b.totalSales - a.totalSales);

      res.json({
        period: { start: monthStart.toISOString().split('T')[0], end: now.toISOString().split('T')[0] },
        reps: repListing,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================================
  // COMMISSION FORECASTING ENDPOINTS
  // =====================================================

  // Get commission forecast for current user (or any user for ADMIN/OPERATOR/EXECUTIVE)
  app.get("/api/commission-forecast", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const period = (req.query.period as string) || "MONTH";
      const requestedUserId = req.query.userId as string | undefined;
      
      // Determine target user ID
      let targetUserId = user.id;
      
      // ADMIN, OPERATOR, and EXECUTIVE can view any user's forecast
      if (requestedUserId && ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        targetUserId = requestedUserId;
      }
      
      const now = new Date();
      let periodStart: Date;
      let periodEnd: Date = now;
      
      switch (period) {
        case "WEEK":
          periodStart = new Date(now);
          periodStart.setDate(periodStart.getDate() - 7);
          break;
        case "QUARTER":
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 3);
          break;
        case "MONTH":
        default:
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 1);
          break;
      }
      
      const forecast = await storage.calculateCommissionForecast(
        targetUserId,
        period,
        periodStart.toISOString().split("T")[0],
        periodEnd.toISOString().split("T")[0]
      );
      
      // Calculate projected commission based on historical average and pending
      const projectedCommission = (
        parseFloat(forecast.pendingCommission) + 
        (parseFloat(forecast.historicalAverage) * forecast.projectedOrders)
      ).toFixed(2);
      
      // Confidence score based on data availability
      const hasHistory = parseFloat(forecast.historicalAverage) > 0;
      const confidenceScore = hasHistory ? 75 : 40;
      
      res.json({
        period: {
          type: period,
          start: periodStart.toISOString().split("T")[0],
          end: periodEnd.toISOString().split("T")[0],
        },
        pending: {
          orders: forecast.pendingOrders,
          commission: forecast.pendingCommission,
        },
        projected: {
          orders: forecast.projectedOrders,
          commission: projectedCommission,
        },
        historical: {
          averageCommission: forecast.historicalAverage,
        },
        confidenceScore,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: Get company-wide or team forecasts
  app.get("/api/admin/commission-forecast", auth, managerOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const period = (req.query.period as string) || "MONTH";
      const repId = req.query.repId as string | undefined;
      
      const now = new Date();
      let periodStart: Date;
      
      switch (period) {
        case "WEEK":
          periodStart = new Date(now);
          periodStart.setDate(periodStart.getDate() - 7);
          break;
        case "QUARTER":
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 3);
          break;
        case "MONTH":
        default:
          periodStart = new Date(now);
          periodStart.setMonth(periodStart.getMonth() - 1);
          break;
      }
      
      // Get scoped users based on role
      let scopedUsers: any[] = [];
      const allUsers = await storage.getActiveUsers();
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        scopedUsers = allUsers.filter(u => ["REP", "SUPERVISOR"].includes(u.role));
      } else if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        scopedUsers = allUsers.filter(u => scope.allRepRepIds.includes(u.repId));
      } else if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const teamRepIds = [...scope.directRepIds, ...scope.indirectRepIds];
        scopedUsers = allUsers.filter(u => teamRepIds.includes(u.repId));
      }
      
      // Filter to specific rep if requested
      if (repId) {
        scopedUsers = scopedUsers.filter(u => u.repId === repId);
      }
      
      // Calculate forecasts for each rep
      const forecasts = await Promise.all(scopedUsers.map(async (rep) => {
        const forecast = await storage.calculateCommissionForecast(
          rep.id,
          period,
          periodStart.toISOString().split("T")[0],
          now.toISOString().split("T")[0]
        );
        
        const projectedCommission = (
          parseFloat(forecast.pendingCommission) + 
          (parseFloat(forecast.historicalAverage) * forecast.projectedOrders)
        ).toFixed(2);
        
        return {
          repId: rep.repId,
          repName: rep.name,
          pendingOrders: forecast.pendingOrders,
          pendingCommission: forecast.pendingCommission,
          projectedOrders: forecast.projectedOrders,
          projectedCommission,
          historicalAverage: forecast.historicalAverage,
        };
      }));
      
      // Company totals
      const totals = {
        pendingOrders: forecasts.reduce((sum, f) => sum + f.pendingOrders, 0),
        pendingCommission: forecasts.reduce((sum, f) => sum + parseFloat(f.pendingCommission), 0).toFixed(2),
        projectedOrders: forecasts.reduce((sum, f) => sum + f.projectedOrders, 0),
        projectedCommission: forecasts.reduce((sum, f) => sum + parseFloat(f.projectedCommission), 0).toFixed(2),
      };
      
      res.json({
        period: {
          type: period,
          start: periodStart.toISOString().split("T")[0],
          end: now.toISOString().split("T")[0],
        },
        totals,
        byRep: forecasts.sort((a, b) => parseFloat(b.projectedCommission) - parseFloat(a.projectedCommission)),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================================
  // SCHEDULED PAY RUNS ENDPOINTS
  // =====================================================

  // Get all scheduled pay runs
  app.get("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getScheduledPayRuns();
      res.json(schedules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create scheduled pay run
  app.post("/api/admin/scheduled-pay-runs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { name, frequency, dayOfWeek, dayOfMonth, secondDayOfMonth, autoCreatePayRun, autoLinkOrders } = req.body;
      
      // Calculate next run date
      const nextRunAt = calculateNextRunFromNow(frequency, dayOfWeek, dayOfMonth);
      
      const schedule = await storage.createScheduledPayRun({
        name,
        frequency,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        secondDayOfMonth: secondDayOfMonth ?? null,
        isActive: true,
        autoCreatePayRun: autoCreatePayRun ?? true,
        autoLinkOrders: autoLinkOrders ?? true,
        createdByUserId: user.id,
        nextRunAt,
      });
      
      await storage.createAuditLog({
        userId: user.id,
        action: "SCHEDULED_PAY_RUN_CREATED",
        tableName: "scheduled_pay_runs",
        recordId: schedule.id,
        afterJson: JSON.stringify({ name, frequency, dayOfWeek, dayOfMonth }),
      });
      
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update scheduled pay run
  app.patch("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, frequency, dayOfWeek, dayOfMonth, secondDayOfMonth, isActive, autoCreatePayRun, autoLinkOrders } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (frequency !== undefined) updates.frequency = frequency;
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (dayOfMonth !== undefined) updates.dayOfMonth = dayOfMonth;
      if (secondDayOfMonth !== undefined) updates.secondDayOfMonth = secondDayOfMonth;
      if (isActive !== undefined) updates.isActive = isActive;
      if (autoCreatePayRun !== undefined) updates.autoCreatePayRun = autoCreatePayRun;
      if (autoLinkOrders !== undefined) updates.autoLinkOrders = autoLinkOrders;
      
      // Recalculate next run if frequency changed
      if (frequency !== undefined) {
        updates.nextRunAt = calculateNextRunFromNow(frequency, dayOfWeek, dayOfMonth);
      }
      
      const schedule = await storage.updateScheduledPayRun(id, updates);
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete scheduled pay run
  app.delete("/api/admin/scheduled-pay-runs/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await storage.deleteScheduledPayRun(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger scheduled pay run check
  app.post("/api/admin/scheduled-pay-runs/trigger", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { scheduler } = await import("./scheduler");
      await scheduler.checkScheduledPayRuns();
      res.json({ success: true, message: "Scheduled pay run check triggered" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================================
  // BACKGROUND JOBS & CHARGEBACK PROCESSING
  // =====================================================

  // Get recent background jobs
  app.get("/api/admin/background-jobs", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const jobType = req.query.type as string | undefined;
      const jobs = await storage.getRecentBackgroundJobs(jobType, 50);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger chargeback processing
  app.post("/api/admin/chargebacks/process", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { scheduler } = await import("./scheduler");
      await scheduler.processChargebacks();
      res.json({ success: true, message: "Chargeback processing triggered" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // =====================================================
  // NOTIFICATION ENDPOINTS
  // =====================================================

  // Get user's notification preferences
  app.get("/api/notification-preferences", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      let prefs = await storage.getNotificationPreferences(user.id);
      
      // Return defaults if no preferences exist
      if (!prefs) {
        prefs = {
          id: "",
          userId: user.id,
          emailOrderApproved: true,
          emailOrderRejected: true,
          emailPayRunFinalized: true,
          emailChargebackApplied: true,
          emailAdvanceUpdates: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      
      res.json(prefs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update notification preferences
  app.patch("/api/notification-preferences", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { emailOrderApproved, emailOrderRejected, emailPayRunFinalized, emailChargebackApplied, emailAdvanceUpdates } = req.body;
      
      const updates: any = {};
      if (emailOrderApproved !== undefined) updates.emailOrderApproved = emailOrderApproved;
      if (emailOrderRejected !== undefined) updates.emailOrderRejected = emailOrderRejected;
      if (emailPayRunFinalized !== undefined) updates.emailPayRunFinalized = emailPayRunFinalized;
      if (emailChargebackApplied !== undefined) updates.emailChargebackApplied = emailChargebackApplied;
      if (emailAdvanceUpdates !== undefined) updates.emailAdvanceUpdates = emailAdvanceUpdates;
      
      const prefs = await storage.upsertNotificationPreferences(user.id, updates);
      res.json(prefs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: Get notification logs
  app.get("/api/admin/notifications", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as string | undefined;
      const notifications = await storage.getEmailNotifications({ status });
      res.json(notifications);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: Manually trigger notification sending
  app.post("/api/admin/notifications/send", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { emailService } = await import("./email");
      const results = await emailService.sendPendingEmails();
      res.json({ success: true, ...results });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========== User Notifications (In-App) ==========

  // Get current user's notifications
  app.get("/api/notifications", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const notifications = await storage.getUserNotifications(user.id, limit);
      res.json(notifications);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const count = await storage.getUnreadNotificationCount(user.id);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Mark a single notification as read
  app.patch("/api/notifications/:id/read", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const notification = await storage.markNotificationRead(req.params.id, user.id);
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }
      res.json(notification);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const count = await storage.markAllNotificationsRead(user.id);
      res.json({ markedRead: count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========== Scheduled Reports ==========

  // Get user's scheduled reports
  app.get("/api/scheduled-reports", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      // ADMIN/OPERATIONS can see all, others see only their own
      const reports = ["ADMIN", "OPERATIONS"].includes(user.role)
        ? await storage.getScheduledReports()
        : await storage.getScheduledReports(user.id);
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create scheduled report
  app.post("/api/scheduled-reports", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const { name, reportType, frequency, dayOfWeek, dayOfMonth, timeOfDay, recipients, isActive } = req.body;
      
      // Calculate next send time
      const now = new Date();
      let nextSendAt = new Date();
      const [hours, minutes] = (timeOfDay || "08:00").split(":").map(Number);
      nextSendAt.setHours(hours, minutes, 0, 0);
      
      if (frequency === "daily") {
        if (nextSendAt <= now) nextSendAt.setDate(nextSendAt.getDate() + 1);
      } else if (frequency === "weekly" && dayOfWeek !== undefined) {
        const currentDay = now.getDay();
        let daysUntil = dayOfWeek - currentDay;
        if (daysUntil <= 0 || (daysUntil === 0 && nextSendAt <= now)) daysUntil += 7;
        nextSendAt.setDate(now.getDate() + daysUntil);
      } else if (frequency === "monthly" && dayOfMonth) {
        nextSendAt.setDate(dayOfMonth);
        if (nextSendAt <= now) nextSendAt.setMonth(nextSendAt.getMonth() + 1);
      }
      
      const report = await storage.createScheduledReport({
        userId: user.id,
        name,
        reportType,
        frequency,
        dayOfWeek: dayOfWeek !== undefined ? dayOfWeek : null,
        dayOfMonth: dayOfMonth || null,
        timeOfDay: timeOfDay || "08:00",
        recipients: recipients || [],
        isActive: isActive !== false,
      });
      
      // Update with calculated nextSendAt
      await storage.updateScheduledReport(report.id, { nextSendAt });
      
      res.json({ ...report, nextSendAt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update scheduled report
  app.patch("/api/scheduled-reports/:id", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const existing = await storage.getScheduledReportById(req.params.id);
      
      if (!existing) {
        return res.status(404).json({ message: "Scheduled report not found" });
      }
      
      // Check ownership or admin
      if (existing.userId !== user.id && !["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const { name, reportType, frequency, dayOfWeek, dayOfMonth, timeOfDay, recipients, isActive } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (reportType !== undefined) updates.reportType = reportType;
      if (frequency !== undefined) updates.frequency = frequency;
      if (dayOfWeek !== undefined) updates.dayOfWeek = dayOfWeek;
      if (dayOfMonth !== undefined) updates.dayOfMonth = dayOfMonth;
      if (timeOfDay !== undefined) updates.timeOfDay = timeOfDay;
      if (recipients !== undefined) updates.recipients = recipients;
      if (isActive !== undefined) updates.isActive = isActive;
      
      const report = await storage.updateScheduledReport(req.params.id, updates);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete scheduled report
  app.delete("/api/scheduled-reports/:id", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const existing = await storage.getScheduledReportById(req.params.id);
      
      if (!existing) {
        return res.status(404).json({ message: "Scheduled report not found" });
      }
      
      if (existing.userId !== user.id && !["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      await storage.deleteScheduledReport(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========== Employee Credentials (Multi-Entry) ==========

  // Get current user's all credential entries
  app.get("/api/my-credentials", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const credentials = await storage.getEmployeeCredentialsByUser(user.id);
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create new credential entry for current user
  app.post("/api/my-credentials", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const data: any = { entryLabel: entryLabel || "Primary" };
      if (peopleSoftNumber !== undefined) data.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) data.networkId = networkId;
      if (tempPassword !== undefined) data.tempPassword = tempPassword;
      if (workEmail !== undefined) data.workEmail = workEmail;
      if (rtr !== undefined) data.rtr = rtr;
      if (rtrPassword !== undefined) data.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) data.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) data.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) data.ipadPin = ipadPin;
      if (deviceNumber !== undefined) data.deviceNumber = deviceNumber;
      if (gmail !== undefined) data.gmail = gmail;
      if (gmailPassword !== undefined) data.gmailPassword = gmailPassword;
      if (notes !== undefined) data.notes = notes;

      const credentials = await storage.createEmployeeCredential(user.id, data, user.id);
      
      await storage.createAuditLog({
        userId: user.id,
        action: "CREATE",
        tableName: "employee_credentials",
        recordId: credentials.id,
        afterJson: JSON.stringify({ entryLabel: data.entryLabel }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update specific credential entry for current user
  app.patch("/api/my-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { credentialId } = req.params;

      // Verify ownership
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing || existing.userId !== user.id) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const updates: any = {};
      if (entryLabel !== undefined) updates.entryLabel = entryLabel;
      if (peopleSoftNumber !== undefined) updates.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) updates.networkId = networkId;
      if (tempPassword !== undefined) updates.tempPassword = tempPassword;
      if (workEmail !== undefined) updates.workEmail = workEmail;
      if (rtr !== undefined) updates.rtr = rtr;
      if (rtrPassword !== undefined) updates.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) updates.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) updates.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) updates.ipadPin = ipadPin;
      if (deviceNumber !== undefined) updates.deviceNumber = deviceNumber;
      if (gmail !== undefined) updates.gmail = gmail;
      if (gmailPassword !== undefined) updates.gmailPassword = gmailPassword;
      if (notes !== undefined) updates.notes = notes;

      const credentials = await storage.updateEmployeeCredential(credentialId, updates, user.id);
      
      await storage.createAuditLog({
        userId: user.id,
        action: "UPDATE",
        tableName: "employee_credentials",
        recordId: credentialId,
        afterJson: JSON.stringify({ fields: Object.keys(updates) }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete specific credential entry for current user
  app.delete("/api/my-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { credentialId } = req.params;

      // Verify ownership
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing || existing.userId !== user.id) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const deleted = await storage.deleteEmployeeCredential(credentialId);
      
      if (deleted) {
        await storage.createAuditLog({
          userId: user.id,
          action: "DELETE",
          tableName: "employee_credentials",
          recordId: credentialId,
          beforeJson: JSON.stringify({ entryLabel: deleted.entryLabel }),
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Get all employee credentials
  app.get("/api/admin/employee-credentials", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const credentials = await storage.getAllEmployeeCredentials();
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Get specific user's credentials (all entries)
  app.get("/api/admin/employee-credentials/user/:userId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { userId } = req.params;
      const targetUser = await storage.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const credentials = await storage.getEmployeeCredentialsByUser(userId);
      res.json({ user: targetUser, credentials });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Create new credential entry for any user
  app.post("/api/admin/employee-credentials/user/:userId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { userId } = req.params;
      const targetUser = await storage.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const data: any = { entryLabel: entryLabel || "Primary" };
      if (peopleSoftNumber !== undefined) data.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) data.networkId = networkId;
      if (tempPassword !== undefined) data.tempPassword = tempPassword;
      if (workEmail !== undefined) data.workEmail = workEmail;
      if (rtr !== undefined) data.rtr = rtr;
      if (rtrPassword !== undefined) data.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) data.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) data.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) data.ipadPin = ipadPin;
      if (deviceNumber !== undefined) data.deviceNumber = deviceNumber;
      if (gmail !== undefined) data.gmail = gmail;
      if (gmailPassword !== undefined) data.gmailPassword = gmailPassword;
      if (notes !== undefined) data.notes = notes;

      const credentials = await storage.createEmployeeCredential(userId, data, user.id);

      await storage.createAuditLog({
        userId: user.id,
        action: "CREATE",
        tableName: "employee_credentials",
        recordId: credentials.id,
        afterJson: JSON.stringify({ targetUserId: userId, entryLabel: data.entryLabel }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Update specific credential entry
  app.patch("/api/admin/employee-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { credentialId } = req.params;
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const {
        entryLabel, peopleSoftNumber, networkId, tempPassword, workEmail, rtr, rtrPassword,
        authenticatorUsername, authenticatorPassword, ipadPin, deviceNumber,
        gmail, gmailPassword, notes
      } = req.body;

      const updates: any = {};
      if (entryLabel !== undefined) updates.entryLabel = entryLabel;
      if (peopleSoftNumber !== undefined) updates.peopleSoftNumber = peopleSoftNumber;
      if (networkId !== undefined) updates.networkId = networkId;
      if (tempPassword !== undefined) updates.tempPassword = tempPassword;
      if (workEmail !== undefined) updates.workEmail = workEmail;
      if (rtr !== undefined) updates.rtr = rtr;
      if (rtrPassword !== undefined) updates.rtrPassword = rtrPassword;
      if (authenticatorUsername !== undefined) updates.authenticatorUsername = authenticatorUsername;
      if (authenticatorPassword !== undefined) updates.authenticatorPassword = authenticatorPassword;
      if (ipadPin !== undefined) updates.ipadPin = ipadPin;
      if (deviceNumber !== undefined) updates.deviceNumber = deviceNumber;
      if (gmail !== undefined) updates.gmail = gmail;
      if (gmailPassword !== undefined) updates.gmailPassword = gmailPassword;
      if (notes !== undefined) updates.notes = notes;

      const credentials = await storage.updateEmployeeCredential(credentialId, updates, user.id);

      await storage.createAuditLog({
        userId: user.id,
        action: "UPDATE",
        tableName: "employee_credentials",
        recordId: credentialId,
        afterJson: JSON.stringify({ targetUserId: existing.userId, fields: Object.keys(updates) }),
      });

      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Delete specific credential entry
  app.delete("/api/admin/employee-credentials/:credentialId", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { credentialId } = req.params;
      const existing = await storage.getEmployeeCredentialById(credentialId);
      if (!existing) {
        return res.status(404).json({ message: "Credential not found" });
      }

      const deleted = await storage.deleteEmployeeCredential(credentialId);
      
      if (deleted) {
        await storage.createAuditLog({
          userId: user.id,
          action: "DELETE",
          tableName: "employee_credentials",
          recordId: credentialId,
          beforeJson: JSON.stringify({ targetUserId: deleted.userId, entryLabel: deleted.entryLabel }),
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ================== MDU STAGING ORDERS ==================

  // MDU middleware - only MDU users can access their own staging orders
  const mduOnly = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== "MDU") {
      return res.status(403).json({ message: "MDU access required" });
    }
    next();
  };

  // MDU: Get my staging orders
  app.get("/api/mdu/orders", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const orders = await storage.getMduStagingOrders(user.repId);
      // Remove encrypted SSN and add masked display
      const safeOrders = orders.map((order: any) => {
        const { customerSsnEncrypted, ...safeOrder } = order;
        return { ...safeOrder, customerSsnDisplay: safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null };
      });
      res.json(safeOrders);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch MDU orders" });
    }
  });

  // MDU: Create new staging order
  app.post("/api/mdu/orders", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const parsed = insertMduStagingOrderSchema.safeParse({ ...req.body, mduRepId: user.repId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      }
      
      // Handle SSN encryption
      const { customerSsn, ...orderData } = parsed.data;
      const dataToSave: any = { ...orderData };
      
      // Sanitize empty strings to null for date fields
      const dateFields = ['installDate', 'customerBirthday'];
      dateFields.forEach(field => {
        if (dataToSave[field] === '' || dataToSave[field] === undefined) {
          dataToSave[field] = null;
        }
      });
      
      // Sanitize empty strings to null for optional text fields
      const optionalTextFields = ['installTime', 'accountNumber', 'customerAddress', 'customerPhone', 'customerEmail', 'creditCardLast4', 'creditCardExpiry', 'creditCardName', 'notes', 'clientId', 'providerId', 'serviceId'];
      optionalTextFields.forEach(field => {
        if (dataToSave[field] === '') {
          dataToSave[field] = null;
        }
      });
      if (customerSsn) {
        dataToSave.customerSsnEncrypted = encryptSsn(customerSsn);
        dataToSave.customerSsnLast4 = extractSsnLast4(customerSsn);
      }
      
      const order = await storage.createMduStagingOrder(dataToSave);
      await storage.createAuditLog({
        userId: user.id,
        action: "create_mdu_staging_order",
        tableName: "mdu_staging_orders",
        recordId: order.id,
        afterJson: JSON.stringify({ ...order, customerSsnEncrypted: "[ENCRYPTED]" }),
      });
      
      // Notify Operations and Executive users about new MDU order
      try {
        const [opsUsers, execUsers] = await Promise.all([
          storage.getUsersByRole("OPERATIONS"),
          storage.getUsersByRole("EXECUTIVE"),
        ]);
        const adminUsers = await storage.getUsersByRole("ADMIN");
        const notifyUsers = [...opsUsers, ...execUsers, ...adminUsers];
        
        for (const notifyUser of notifyUsers) {
          await storage.createEmailNotification({
            userId: notifyUser.id,
            notificationType: "MDU_ORDER_SUBMITTED",
            subject: "New MDU Order Submitted",
            body: `${user.name} (${user.repId}) submitted a new MDU order for ${req.body.customerName || "a customer"}. Please review it in the MDU Review queue.`,
            recipientEmail: "", // In-app notification only
            status: "PENDING",
            isRead: false,
          });
        }
      } catch (notifyError) {
        console.error("Failed to send MDU order notifications:", notifyError);
      }
      
      // Return with masked SSN display (never expose encrypted value to client)
      const { customerSsnEncrypted, ...safeOrder } = order;
      res.json({ ...safeOrder, customerSsnDisplay: safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create MDU order" });
    }
  });

  // MDU: Update my staging order (only if PENDING)
  app.put("/api/mdu/orders/:id", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const existing = await storage.getMduStagingOrderById(id);
      if (!existing) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (existing.mduRepId !== user.repId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      if (existing.status !== "PENDING") {
        return res.status(400).json({ message: "Can only edit pending orders" });
      }
      // Whitelist only editable fields - prevent privilege escalation
      const allowedFields: any = {
        clientId: req.body.clientId,
        providerId: req.body.providerId,
        serviceId: req.body.serviceId,
        dateSold: req.body.dateSold,
        installDate: req.body.installDate,
        installTime: req.body.installTime,
        installType: req.body.installType,
        accountNumber: req.body.accountNumber,
        tvSold: req.body.tvSold,
        mobileSold: req.body.mobileSold,
        mobileProductType: req.body.mobileProductType,
        mobilePortedStatus: req.body.mobilePortedStatus,
        mobileLinesQty: req.body.mobileLinesQty,
        customerName: req.body.customerName,
        customerAddress: req.body.customerAddress,
        customerPhone: req.body.customerPhone,
        customerEmail: req.body.customerEmail,
        customerBirthday: req.body.customerBirthday,
        creditCardLast4: req.body.creditCardLast4,
        creditCardExpiry: req.body.creditCardExpiry,
        creditCardName: req.body.creditCardName,
        notes: req.body.notes,
      };
      
      // Handle SSN update - encrypt if provided
      if (req.body.customerSsn) {
        allowedFields.customerSsnEncrypted = encryptSsn(req.body.customerSsn);
        allowedFields.customerSsnLast4 = extractSsnLast4(req.body.customerSsn);
      }
      
      // Sanitize empty strings to null for date fields
      const dateFieldsToSanitize = ['installDate', 'customerBirthday'];
      dateFieldsToSanitize.forEach(field => {
        if (allowedFields[field] === '') {
          allowedFields[field] = null;
        }
      });
      
      // Sanitize empty strings to null for optional text/enum fields
      const optionalFieldsToSanitize = ['installTime', 'accountNumber', 'customerAddress', 'customerPhone', 'customerEmail', 'creditCardLast4', 'creditCardExpiry', 'creditCardName', 'notes', 'clientId', 'providerId', 'serviceId', 'installType', 'mobileProductType', 'mobilePortedStatus'];
      optionalFieldsToSanitize.forEach(field => {
        if (allowedFields[field] === '') {
          allowedFields[field] = null;
        }
      });
      
      // Remove undefined values
      const sanitizedData = Object.fromEntries(
        Object.entries(allowedFields).filter(([_, v]) => v !== undefined)
      );
      const updated = await storage.updateMduStagingOrder(id, sanitizedData);
      
      // Return with masked SSN display
      const { customerSsnEncrypted, ...safeOrder } = updated as any;
      res.json({ ...safeOrder, customerSsnDisplay: safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update MDU order" });
    }
  });

  // MDU: Delete my staging order (only if PENDING)
  app.delete("/api/mdu/orders/:id", auth, mduOnly, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const existing = await storage.getMduStagingOrderById(id);
      if (!existing) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (existing.mduRepId !== user.repId) {
        return res.status(403).json({ message: "Not authorized" });
      }
      if (existing.status !== "PENDING") {
        return res.status(400).json({ message: "Can only delete pending orders" });
      }
      await storage.deleteMduStagingOrder(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete MDU order" });
    }
  });

  // Admin: Get all pending MDU staging orders for review
  app.get("/api/admin/mdu/pending", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getPendingMduStagingOrders();
      // Never send encrypted SSN to client - only masked display
      const safeOrders = orders.map((order: any) => {
        const { customerSsnEncrypted, ...safeOrder } = order;
        const ssnDisplay = safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null;
        return { ...safeOrder, customerSsnDisplay: ssnDisplay, hasSsn: !!customerSsnEncrypted };
      });
      res.json(safeOrders);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch pending MDU orders" });
    }
  });

  // Admin: Get all MDU staging orders
  app.get("/api/admin/mdu/orders", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getMduStagingOrders();
      // Never send encrypted SSN to client - only masked display
      const safeOrders = orders.map((order: any) => {
        const { customerSsnEncrypted, ...safeOrder } = order;
        const ssnDisplay = safeOrder.customerSsnLast4 ? `***-**-${safeOrder.customerSsnLast4}` : null;
        return { ...safeOrder, customerSsnDisplay: ssnDisplay, hasSsn: !!customerSsnEncrypted };
      });
      res.json(safeOrders);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch MDU orders" });
    }
  });

  // Admin/Executive: View full SSN (explicit request with audit logging)
  app.get("/api/admin/mdu/:id/ssn", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      // Only ADMIN, OPERATIONS, EXECUTIVE can view full SSN
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Not authorized to view SSN" });
      }
      
      const { id } = req.params;
      const order = await storage.getMduStagingOrderById(id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      const orderData = order as any;
      if (!orderData.customerSsnEncrypted) {
        return res.status(404).json({ message: "No SSN on file for this order" });
      }
      
      const decryptedSsn = decryptSsn(orderData.customerSsnEncrypted);
      
      // Audit log SSN access
      await storage.createAuditLog({
        userId: user.id,
        action: "view_ssn",
        tableName: "mdu_staging_orders",
        recordId: id,
        afterJson: JSON.stringify({ accessedBy: user.repId, accessedByRole: user.role }),
      });
      
      res.json({ ssn: decryptedSsn });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to retrieve SSN" });
    }
  });

  // Admin: Get MDU order data for prefilling regular order form (excludes sensitive data)
  app.get("/api/admin/mdu/:id/prefill", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const mduOrder = await storage.getMduStagingOrderById(id);
      if (!mduOrder) {
        return res.status(404).json({ message: "MDU order not found" });
      }
      // Whitelist only non-sensitive fields needed for order creation - explicitly exclude all PII/financial data
      const safeData = {
        id: mduOrder.id,
        mduRepId: mduOrder.mduRepId,
        clientId: mduOrder.clientId,
        providerId: mduOrder.providerId,
        serviceId: mduOrder.serviceId,
        dateSold: mduOrder.dateSold,
        installDate: mduOrder.installDate,
        installTime: mduOrder.installTime,
        installType: mduOrder.installType,
        accountNumber: mduOrder.accountNumber,
        tvSold: mduOrder.tvSold,
        mobileSold: mduOrder.mobileSold,
        mobileProductType: mduOrder.mobileProductType,
        mobilePortedStatus: mduOrder.mobilePortedStatus,
        mobileLinesQty: mduOrder.mobileLinesQty,
        customerName: mduOrder.customerName,
        customerAddress: mduOrder.customerAddress,
        customerPhone: mduOrder.customerPhone,
        customerEmail: mduOrder.customerEmail,
        notes: mduOrder.notes,
        status: mduOrder.status,
        createdAt: mduOrder.createdAt,
      };
      res.json(safeData);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch MDU order" });
    }
  });

  // Admin: Reject MDU staging order
  app.post("/api/admin/mdu/:id/reject", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { rejectionNote } = req.body;
      const mduOrder = await storage.getMduStagingOrderById(id);
      if (!mduOrder) {
        return res.status(404).json({ message: "MDU order not found" });
      }
      if (mduOrder.status !== "PENDING") {
        return res.status(400).json({ message: "Order is not pending" });
      }

      const updated = await storage.updateMduStagingOrder(id, {
        status: "REJECTED",
        rejectionNote: rejectionNote || "Rejected by admin",
        reviewedByUserId: user.id,
        reviewedAt: new Date(),
      });

      await storage.createAuditLog({
        userId: user.id,
        action: "reject_mdu_order",
        tableName: "mdu_staging_orders",
        recordId: id,
        afterJson: JSON.stringify({ rejectionNote }),
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to reject MDU order" });
    }
  });

  // ========== COMMISSION DISPUTES ==========

  // Rep can view their own disputes
  app.get("/api/disputes/my", auth, async (req: AuthRequest, res) => {
    try {
      const disputes = await storage.getCommissionDisputesByUser(req.user!.id);
      res.json(disputes);
    } catch (error) {
      res.status(500).json({ message: "Failed to get disputes" });
    }
  });

  // Rep can create a dispute
  app.post("/api/disputes", auth, async (req: AuthRequest, res) => {
    try {
      const { disputeType, title, description, salesOrderId, payStatementId, expectedAmount, actualAmount } = req.body;
      
      if (!disputeType || !title || !description) {
        return res.status(400).json({ message: "Dispute type, title, and description are required" });
      }

      const differenceAmount = expectedAmount && actualAmount 
        ? (parseFloat(expectedAmount) - parseFloat(actualAmount)).toFixed(2)
        : null;

      const dispute = await storage.createCommissionDispute({
        userId: req.user!.id,
        disputeType,
        title,
        description,
        salesOrderId: salesOrderId || null,
        payStatementId: payStatementId || null,
        expectedAmount: expectedAmount || null,
        actualAmount: actualAmount || null,
        differenceAmount,
        status: "PENDING",
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create_dispute",
        tableName: "commission_disputes",
        recordId: dispute.id,
        afterJson: JSON.stringify({ disputeType, title }),
      });

      res.status(201).json(dispute);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create dispute" });
    }
  });

  // Rep can get a specific dispute they own
  app.get("/api/disputes/my/:id", auth, async (req: AuthRequest, res) => {
    try {
      const result = await storage.getCommissionDisputeById(req.params.id);
      if (!result) return res.status(404).json({ message: "Dispute not found" });
      if (result.dispute.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dispute" });
    }
  });

  // Admin can view all disputes
  app.get("/api/admin/disputes", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status, userId } = req.query;
      const disputes = await storage.getCommissionDisputes({
        status: status as string | undefined,
        userId: userId as string | undefined,
      });
      res.json(disputes);
    } catch (error) {
      res.status(500).json({ message: "Failed to get disputes" });
    }
  });

  // Admin can get a specific dispute
  app.get("/api/admin/disputes/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const result = await storage.getCommissionDisputeById(req.params.id);
      if (!result) return res.status(404).json({ message: "Dispute not found" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dispute" });
    }
  });

  // Admin can update dispute status
  app.patch("/api/admin/disputes/:id/status", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status } = req.body;
      if (!["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const dispute = await storage.updateCommissionDispute(req.params.id, { status });
      if (!dispute) return res.status(404).json({ message: "Dispute not found" });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "update_dispute_status",
        tableName: "commission_disputes",
        recordId: req.params.id,
        afterJson: JSON.stringify({ status }),
      });

      res.json(dispute);
    } catch (error) {
      res.status(500).json({ message: "Failed to update dispute status" });
    }
  });

  // Admin can resolve a dispute
  app.post("/api/admin/disputes/:id/resolve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { status, resolution, resolvedAmount } = req.body;
      if (!["APPROVED", "REJECTED", "CLOSED"].includes(status)) {
        return res.status(400).json({ message: "Invalid resolution status" });
      }
      if (!resolution) {
        return res.status(400).json({ message: "Resolution note is required" });
      }

      const dispute = await storage.resolveCommissionDispute(req.params.id, {
        status,
        resolution,
        resolvedAmount: resolvedAmount || null,
        resolvedByUserId: req.user!.id,
      });

      if (!dispute) return res.status(404).json({ message: "Dispute not found" });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "resolve_dispute",
        tableName: "commission_disputes",
        recordId: req.params.id,
        afterJson: JSON.stringify({ status, resolution, resolvedAmount }),
      });

      res.json(dispute);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to resolve dispute" });
    }
  });

  // Get pending disputes count (for badges)
  app.get("/api/admin/disputes/count/pending", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const count = await storage.getPendingDisputesCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Failed to get count" });
    }
  });

  return httpServer;
}

// Helper function for scheduled pay runs
function calculateNextRunFromNow(frequency: string, dayOfWeek?: number | null, dayOfMonth?: number | null): Date {
  const now = new Date();
  let next = new Date(now);
  
  switch (frequency) {
    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      if (dayOfWeek !== null && dayOfWeek !== undefined) {
        const currentDay = next.getDay();
        const daysUntil = (dayOfWeek - currentDay + 7) % 7;
        if (daysUntil === 0) next.setDate(next.getDate() + 7);
        else next.setDate(next.getDate() + daysUntil);
      }
      break;
    case "BIWEEKLY":
      next.setDate(next.getDate() + 14);
      break;
    case "SEMIMONTHLY":
      if (now.getDate() < 15) {
        next.setDate(15);
      } else {
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
      }
      break;
    case "MONTHLY":
    default:
      next.setMonth(next.getMonth() + 1);
      if (dayOfMonth !== null && dayOfMonth !== undefined) {
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(dayOfMonth, lastDay));
      }
      break;
  }
  
  return next;
}
