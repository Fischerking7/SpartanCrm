import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { authMiddleware, generateToken, hashPassword, comparePassword, adminOnly, executiveOrAdmin, managerOrAdmin, supervisorOrAbove, type AuthRequest } from "./auth";
import { loginSchema, insertUserSchema, insertProviderSchema, insertClientSchema, insertServiceSchema, insertRateCardSchema, insertSalesOrderSchema, insertIncentiveSchema, insertAdjustmentSchema, insertPayRunSchema, insertChargebackSchema, insertOverrideAgreementSchema, insertKnowledgeDocumentSchema, type SalesOrder, type OverrideEarning, type User, type Provider, type Client } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import crypto from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import rateLimit from "express-rate-limit";

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
  FOUNDER: 6,
};

// Generate secure temporary password
function generateTempPassword(): string {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16);
}

// Check if actor can reset target's password based on PASSWORD AUTHORITY rules
async function checkPasswordAuthority(actor: User, target: User): Promise<boolean> {
  // Rule 1: FOUNDER can reset any password
  if (actor.role === "FOUNDER") {
    return true;
  }
  
  // Rule 2: ADMIN can reset any password except FOUNDER
  if (actor.role === "ADMIN") {
    return target.role !== "FOUNDER";
  }
  
  // Rule 3: MANAGER can reset passwords for their supervisors and reps in their org tree
  if (actor.role === "MANAGER") {
    // Cannot reset Executives, Admins, Founders, or other Managers
    if (["EXECUTIVE", "ADMIN", "FOUNDER", "MANAGER"].includes(target.role)) {
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

// Bootstrap FOUNDER user on first run
async function bootstrapFounder(): Promise<void> {
  try {
    // Check if any FOUNDER exists
    const founders = await storage.getUsersByRole("FOUNDER");
    if (founders.length > 0) {
      console.log("FOUNDER user already exists, skipping bootstrap");
      return;
    }
    
    // Check env vars
    const repId = process.env.BOOTSTRAP_FOUNDER_REPID;
    const password = process.env.BOOTSTRAP_FOUNDER_PASSWORD;
    const name = process.env.BOOTSTRAP_FOUNDER_NAME || "System Founder";
    
    if (!repId || !password) {
      console.log("BOOTSTRAP_FOUNDER_REPID and BOOTSTRAP_FOUNDER_PASSWORD env vars not set, skipping founder bootstrap");
      return;
    }
    
    // Check if repId already exists (from a previous partial bootstrap)
    const existingUser = await storage.getUserByRepId(repId);
    if (existingUser) {
      console.log(`User with repId '${repId}' already exists, skipping founder bootstrap`);
      return;
    }
    
    // Create FOUNDER user
    const hashedPassword = await hashPassword(password);
    await storage.createUser({
      name,
      repId,
      role: "FOUNDER",
      status: "ACTIVE",
      passwordHash: hashedPassword,
    });
    
    console.log(`FOUNDER user '${name}' created with repId '${repId}'`);
    
    // Log the bootstrap event
    await storage.createAuditLog({
      action: "FOUNDER_BOOTSTRAP",
      tableName: "users",
      afterJson: JSON.stringify({ repId, name, role: "FOUNDER" }),
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
  
  // Bootstrap FOUNDER and ADMIN on first run
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
      if (!["MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(user.role)) {
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
      
      // Only EXECUTIVE, ADMIN, FOUNDER can drill into manager data
      if (!["EXECUTIVE", "ADMIN", "FOUNDER"].includes(user.role)) {
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
      
      if (["EXECUTIVE", "ADMIN", "FOUNDER"].includes(role)) {
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
        // ADMIN/FOUNDER see all
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
      
      if (user.role === "ADMIN" || user.role === "FOUNDER") {
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

      if (user.role === "ADMIN" || user.role === "FOUNDER") {
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
      if (["ADMIN", "FOUNDER"].includes(user.role) && submittedRepId) {
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
        const salesRepUser = await storage.getUserByRepId(repId);
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
      if (!["ADMIN", "FOUNDER"].includes(user.role)) {
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
        
        // Calculate override deductions to subtract from rep's commission (always apply)
        let totalDeductions = 0;
        totalDeductions += parseFloat(rateCard.overrideDeduction || "0");
        if (order.tvSold) {
          totalDeductions += parseFloat(rateCard.tvOverrideDeduction || "0");
        }
        if (order.mobileSold) {
          totalDeductions += parseFloat((rateCard as any).mobileOverrideDeduction || "0");
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
      
      // REPs can only modify their own orders
      if (user.role === "REP" && order.repId !== user.repId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // MANAGERs can only modify their team's orders
      if (user.role === "MANAGER") {
        const teamMembers = await storage.getTeamMembers(user.id);
        const teamRepIds = [...teamMembers.map(m => m.repId), user.repId];
        if (!teamRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      // Define strict whitelists based on approval status and role
      const statusFields = ["jobStatus", "installDate"];
      const customerFields = ["customerName", "customerPhone", "customerEmail", "customerAddress", "accountNumber"];
      const orderFields = ["clientId", "providerId", "serviceId", "dateSold", "tvSold", "mobileSold", "mobileProductType", "mobilePortedStatus", "mobileLinesQty", "notes"];
      
      let allowedFields: string[] = [];
      
      if (order.approvalStatus === "APPROVED") {
        // Approved orders: only status + customer contact can be updated
        allowedFields = [...statusFields, "customerPhone", "customerEmail", "customerAddress", "accountNumber"];
      } else if (order.approvalStatus === "UNAPPROVED") {
        if (user.role === "ADMIN") {
          // Admin can modify all non-financial fields on unapproved orders
          allowedFields = [...statusFields, ...customerFields, ...orderFields];
        } else {
          // REPs and MANAGERs can modify customer + order fields on their unapproved orders
          allowedFields = [...statusFields, ...customerFields, ...orderFields];
        }
      } else {
        // Rejected orders - allow limited edits for resubmission
        allowedFields = [...customerFields, ...orderFields];
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
          providerId: updateData.providerId ?? order.providerId,
          serviceId: updateData.serviceId ?? order.serviceId,
          clientId: updateData.clientId ?? order.clientId,
          tvSold: updateData.tvSold ?? order.tvSold,
          mobileSold: updateData.mobileSold ?? order.mobileSold,
          mobileLinesQty: updateData.mobileLinesQty ?? order.mobileLinesQty,
        };
        const dateSold = updateData.dateSold ?? order.dateSold;
        
        const rateCard = await storage.findMatchingRateCard(mergedOrder as any, dateSold);
        if (rateCard) {
          updateData.baseCommissionEarned = storage.calculateCommission(rateCard, mergedOrder as any).toString();
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
          
          // Calculate override deductions to subtract from rep's commission
          let totalDeductions = 0;
          const baseDeduction = parseFloat(rateCard.overrideDeduction || "0");
          totalDeductions += baseDeduction;
          if (order.tvSold) {
            totalDeductions += parseFloat(rateCard.tvOverrideDeduction || "0");
          }
          if (order.mobileSold) {
            totalDeductions += parseFloat((rateCard as any).mobileOverrideDeduction || "0");
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

  // Admin reference data routes
  app.get("/api/admin/users", auth, adminOnly, async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users.map(u => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ message: "Failed to get users" });
    }
  });

  app.get("/api/users", auth, adminOnly, async (req, res) => {
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
      const canAssign = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(currentUser.role);
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

  app.post("/api/admin/users", auth, adminOnly, async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/users/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { password, name, role, repId, status, assignedSupervisorId, assignedManagerId, assignedExecutiveId, skipValidation } = req.body;
      const isFounder = req.user!.role === "FOUNDER";
      
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
      
      // FOUNDER-only: Allow editing repId
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

  app.post("/api/admin/users/:id/deactivate", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = await storage.updateUser(id, { status: "DEACTIVATED" });
      await storage.createAuditLog({ action: "deactivate_user", tableName: "users", recordId: id, userId: req.user!.id });
      res.json({ ...user, passwordHash: undefined });
    } catch (error) {
      res.status(500).json({ message: "Failed to deactivate user" });
    }
  });
  
  app.delete("/api/admin/users/:id", auth, adminOnly, async (req: AuthRequest, res) => {
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
      if (!["ADMIN", "FOUNDER", "EXECUTIVE"].includes(user.role)) {
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
    try { res.json(await storage.getPayRuns()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/payruns", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.createPayRun({ ...req.body, createdByUserId: req.user!.id });
      await storage.createAuditLog({ action: "create_payrun", tableName: "pay_runs", recordId: payRun.id, afterJson: JSON.stringify(payRun), userId: req.user!.id });
      res.json(payRun);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.post("/api/admin/payruns/:id/finalize", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.updatePayRun(req.params.id, { status: "FINALIZED", finalizedAt: new Date() });
      await storage.createAuditLog({ action: "finalize_payrun", tableName: "pay_runs", recordId: req.params.id, afterJson: JSON.stringify(payRun), userId: req.user!.id });
      res.json(payRun);
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

  // Get approved orders not yet linked to a pay run
  app.get("/api/admin/payruns/unlinked-orders", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const orders = await storage.getOrders();
      const unlinked = orders.filter(o => 
        o.approvalStatus === "APPROVED" && 
        o.paymentStatus === "UNPAID" && 
        !o.payRunId
      );
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
    if (req.user?.role === "ADMIN" || req.user?.role === "FOUNDER" || req.user?.role === "EXECUTIVE") {
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

      // Build CSV data with override deduction info
      const csvData = await Promise.all(orders.map(async (o: any) => {
        // Calculate gross commission (before override deduction)
        const grossCommission = parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0");
        
        // Get override deductions for this order from the pool
        const poolEntries = await storage.getOverrideDeductionPoolByOrderId(o.id);
        const totalOverrideDeduction = poolEntries.reduce((sum, entry) => sum + parseFloat(entry.amount || "0"), 0);
        
        // Net commission after override deduction
        const netCommission = grossCommission - totalOverrideDeduction;
        
        return {
          "Invoice Number": o.invoiceNumber || "",
          "Rep ID": o.repId,
          "Customer Name": o.customerName,
          "Client": o.client?.name || "",
          "Provider": o.provider?.name || "",
          "Service": o.service?.name || "",
          "Date Sold": o.dateSold,
          "Install Date": o.installDate || "",
          "Account Number": o.accountNumber || "",
          "TV/Video?": o.tvSold ? "Yes" : "No",
          "Mobile sold?": o.mobileSold ? "Yes" : "No",
          "Mobile Lines Qty": o.mobileLinesQty || 0,
          "Commission Before Override": grossCommission.toFixed(2),
          "Override Deduction": totalOverrideDeduction.toFixed(2),
          "Commission After Override": netCommission.toFixed(2),
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
      const canViewOthers = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(req.user!.role);
      
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
      const canViewOthers = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(req.user!.role);
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
      const { disposition } = req.body;
      
      const validDispositions = ["NONE", "SOLD", "NOT_HOME", "RETURN", "REJECT"];
      if (!disposition || !validDispositions.includes(disposition)) {
        return res.status(400).json({ message: "Invalid disposition" });
      }
      
      // Verify the lead belongs to this user
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      if (lead.repId !== req.user!.repId) {
        return res.status(403).json({ message: "Not authorized to update this lead" });
      }
      
      const updated = await storage.updateLeadDisposition(id, disposition);
      
      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "lead_disposition_update",
        tableName: "leads",
        recordId: id,
        beforeJson: JSON.stringify({ disposition: lead.disposition }),
        afterJson: JSON.stringify({ disposition }),
      });
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update lead disposition" });
    }
  });

  // Reverse disposition (SUPERVISOR+ only) - clears SOLD/REJECT status
  app.patch("/api/leads/:id/reverse-disposition", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Only SUPERVISOR+ can reverse dispositions
      const canReverse = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(req.user!.role);
      if (!canReverse) {
        return res.status(403).json({ message: "Only supervisors and above can reverse dispositions" });
      }
      
      const lead = await storage.getLeadById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      // Only allow reversing SOLD or REJECT dispositions
      if (!["SOLD", "REJECT"].includes(lead.disposition || "")) {
        return res.status(400).json({ message: "Can only reverse SOLD or REJECTED leads" });
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
      const canAssign = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(req.user!.role);
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
      const canAssignToOthers = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(currentUser.role);
      
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
        o.jobStatus !== "CANCELLED" &&
        o.approvalStatus !== "DENIED"
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
    } else if (user.role === "ADMIN" || user.role === "FOUNDER") {
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
      
      if (user.role === "ADMIN" || user.role === "FOUNDER") {
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
      
      // Only ADMIN and FOUNDER can see all override earnings
      if (!["ADMIN", "FOUNDER"].includes(user.role)) {
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

  // Register object storage routes
  registerObjectStorageRoutes(app);

  // === Knowledge Documents API ===
  
  // Get all knowledge documents
  app.get("/api/knowledge-documents", auth, async (req: AuthRequest, res) => {
    try {
      const docs = await storage.getKnowledgeDocuments();
      res.json(docs);
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
      
      const { title, description, category, tags } = req.body;
      const doc = await storage.updateKnowledgeDocument(req.params.id, {
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        tags: tags !== undefined ? tags : existing.tags,
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

  return httpServer;
}
