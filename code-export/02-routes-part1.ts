import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage, type TxDb } from "./storage";
import { db } from "./db";
import { eq, and, sql, gte, lte, inArray, isNull, ne, asc, or } from "drizzle-orm";
import { users, providers, clients, services, rateCards, salesOrders, payStatements, payStatementDeductions, leads, arPayments } from "@shared/schema";
import { authMiddleware, generateToken, hashPassword, comparePassword, adminOnly, executiveOrAdmin, managerOrAdmin, leadOrAbove, type AuthRequest } from "./auth";
import { loginSchema, insertUserSchema, insertProviderSchema, insertClientSchema, insertServiceSchema, insertRateCardSchema, insertSalesOrderSchema, insertIncentiveSchema, insertAdjustmentSchema, insertPayRunSchema, insertChargebackSchema, insertOverrideAgreementSchema, insertKnowledgeDocumentSchema, insertMduStagingOrderSchema, leadDispositions, dispositionToPipelineStage, terminalDispositions, dispositionMetadata, type LeadDisposition, type SalesOrder, type OverrideEarning, type User, type Provider, type Client, type MduStagingOrder } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import crypto from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import rateLimit from "express-rate-limit";
import { encryptSsn, decryptSsn, extractSsnLast4, maskSsn } from "./encryption";
import { fetchGoogleSheet, parseUploadedCsv } from "./google-sheets";
import { matchInstallationsToOrders, type OrderSummary } from "./claude-matching";
import { emailService } from "./email";

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
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
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

// Shared helper for creating orders with commission calculation
// Used by both POST /api/orders and POST /api/orders/mobile
interface CreateOrderParams {
  orderData: Record<string, any>;
  mobileLineData?: Array<{ mobileProductType: string; mobilePortedStatus: string }>;
  dateSold: string;
  assignedRepId: string;
  userId: string;
  auditAction?: string;
}

async function createOrderWithCommission(params: CreateOrderParams) {
  const { orderData, mobileLineData, dateSold, assignedRepId, userId, auditAction = "create_order" } = params;
  
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as TxDb;
    
    const data = { 
      ...orderData,
      repId: assignedRepId,
      jobStatus: "PENDING" as const,
      baseCommissionEarned: "0",
      appliedRateCardId: null,
      commissionSource: "CALCULATED" as const,
      calcAt: null,
      incentiveEarned: "0",
      commissionPaid: "0",
      paymentStatus: "UNPAID" as const,
      exportedToAccounting: false,
    };
    
    const order = await storage.createOrder(data as any, txDb);
    
    if (mobileLineData && mobileLineData.length > 0) {
      for (let i = 0; i < mobileLineData.length; i++) {
        const line = mobileLineData[i];
        await storage.createMobileLineItem({
          salesOrderId: order.id,
          lineNumber: i + 1,
          mobileProductType: line.mobileProductType || "OTHER",
          mobilePortedStatus: line.mobilePortedStatus || "NON_PORTED",
        }, txDb);
      }
    }
    
    let baseCommission = "0";
    let appliedRateCardId: string | null = null;
    let totalDeductions = 0;
    
    const rateCard = await storage.findMatchingRateCard(order, dateSold);
    if (rateCard) {
      const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
      await storage.createCommissionLineItems(order.id, lineItems, txDb);
      
      const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
      appliedRateCardId = rateCard.id;
      
      const salesRepUser = await storage.getUserByRepId(assignedRepId);
      const userRole = salesRepUser?.role || "REP";
      const roleOverride = await storage.getRoleOverrideForRateCard(rateCard.id, userRole);
      
      const isMobileOnlyOrder = (order as any).isMobileOrder === true;
      
      if (roleOverride) {
        const overrideAmounts = {
          base: parseFloat(roleOverride.overrideDeduction || "0"),
          tv: parseFloat(roleOverride.tvOverrideDeduction || "0"),
          mobile: parseFloat(roleOverride.mobileOverrideDeduction || "0"),
        };
        
        if (!isMobileOnlyOrder) {
          totalDeductions += overrideAmounts.base;
          if (order.tvSold) {
            totalDeductions += overrideAmounts.tv;
          }
        }
        if (order.mobileSold) {
          totalDeductions += overrideAmounts.mobile;
        }
      } else {
        const overrideAmounts = {
          base: parseFloat(rateCard.overrideDeduction || "0"),
          tv: parseFloat(rateCard.tvOverrideDeduction || "0"),
          mobile: parseFloat((rateCard as any).mobileOverrideDeduction || "0"),
        };
        
        if (!isMobileOnlyOrder) {
          totalDeductions += overrideAmounts.base;
          if (order.tvSold) {
            totalDeductions += overrideAmounts.tv;
          }
        }
        if (order.mobileSold) {
          totalDeductions += overrideAmounts.mobile;
        }
      }
      baseCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
    }
    
    const updatedOrder = await storage.updateOrder(order.id, {
      baseCommissionEarned: baseCommission,
      appliedRateCardId,
      calcAt: rateCard ? new Date() : null,
      overrideDeduction: totalDeductions.toFixed(2),
    }, txDb);
    
    await storage.createAuditLog({ action: auditAction, tableName: "sales_orders", recordId: order.id, afterJson: JSON.stringify(updatedOrder), userId }, txDb);
    return updatedOrder;
  });
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
  LEAD: 2,
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
    if (target.role === "LEAD") {
      // Check if supervisor is assigned to this manager
      return target.assignedManagerId === actor.id;
    }
    if (target.role === "REP") {
      // Check if rep is in manager's org tree (direct or indirect)
      return scope.allRepRepIds.includes(target.repId);
    }
    return false;
  }
  
  // Rule 4: LEAD can reset passwords only for their assigned reps
  if (actor.role === "LEAD") {
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
  const salesRep = await storage.getUserByRepId(approvedOrder.repId);
  if (salesRep?.role === "EXECUTIVE") {
    return [];
  }
  
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as TxDb;
    
    const existingEarnings = await storage.getOverrideEarningsByOrder(approvedOrder.id);
    if (existingEarnings.length > 0) {
      return existingEarnings;
    }
    
    const earnings: OverrideEarning[] = [];
    
    const existingPoolEntries = await storage.getOverrideDeductionPoolByOrderId(approvedOrder.id);
    const existingPoolKeys = new Set(existingPoolEntries.map(e => `${e.rateCardId}-${e.deductionType}`));
    
    const commissionLineItemsList = await storage.getCommissionLineItemsByOrderId(approvedOrder.id);
    const usedRateCardIds = new Set<string>();
    
    for (const lineItem of commissionLineItemsList) {
      if (lineItem.appliedRateCardId && !usedRateCardIds.has(lineItem.appliedRateCardId)) {
        const rateCard = await storage.getRateCardById(lineItem.appliedRateCardId);
        if (rateCard) {
          const baseDeduction = parseFloat(rateCard.overrideDeduction || "0");
          const baseKey = `${rateCard.id}-BASE`;
          if (baseDeduction > 0 && !existingPoolKeys.has(baseKey)) {
            await storage.createOverrideDeductionPoolEntry({
              salesOrderId: approvedOrder.id,
              rateCardId: rateCard.id,
              amount: baseDeduction.toFixed(2),
              deductionType: "BASE",
              status: "PENDING",
            }, txDb);
          }
          
          const tvDeduction = parseFloat(rateCard.tvOverrideDeduction || "0");
          const tvKey = `${rateCard.id}-TV`;
          if (tvDeduction > 0 && approvedOrder.tvSold && !existingPoolKeys.has(tvKey)) {
            await storage.createOverrideDeductionPoolEntry({
              salesOrderId: approvedOrder.id,
              rateCardId: rateCard.id,
              amount: tvDeduction.toFixed(2),
              deductionType: "TV",
              status: "PENDING",
            }, txDb);
          }
          
          const mobileDeduction = parseFloat((rateCard as any).mobileOverrideDeduction || "0");
          const mobileKey = `${rateCard.id}-MOBILE`;
          if (mobileDeduction > 0 && approvedOrder.mobileSold && !existingPoolKeys.has(mobileKey)) {
            await storage.createOverrideDeductionPoolEntry({
              salesOrderId: approvedOrder.id,
              rateCardId: rateCard.id,
              amount: mobileDeduction.toFixed(2),
              deductionType: "MOBILE",
              status: "PENDING",
            }, txDb);
          }
          
          usedRateCardIds.add(lineItem.appliedRateCardId);
        }
      }
    }
    
    const hierarchy = await storage.getRepHierarchy(approvedOrder.repId);
    const mobileLines = await storage.getMobileLineItemsByOrderId(approvedOrder.id);
    
    const baseOrderFilter = { 
      providerId: approvedOrder.providerId, 
      clientId: approvedOrder.clientId, 
      serviceId: approvedOrder.serviceId,
      tvSold: approvedOrder.tvSold,
    };
    
    const mobileProductTypes = mobileLines.length > 0 
      ? Array.from(new Set(mobileLines.map(l => l.mobileProductType))) 
      : (approvedOrder.mobileProductType ? [approvedOrder.mobileProductType] : []);
    
    const processAgreements = async (recipientUserId: string, recipientRole: string) => {
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
        }, txDb);
        earnings.push(earning);
      }
      
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
            }, txDb);
            earnings.push(earning);
          }
        }
      }
    };
    
    if (hierarchy.supervisor) {
      await processAgreements(hierarchy.supervisor.id, "LEAD");
    }
    
    if (hierarchy.manager) {
      await processAgreements(hierarchy.manager.id, "MANAGER");
    }
    
    if (hierarchy.executive) {
      await processAgreements(hierarchy.executive.id, "EXECUTIVE");
    }
    
    const admins = await storage.getUsers();
    const activeAdmins = admins.filter(u => u.role === "ADMIN" && u.status === "ACTIVE" && !u.deletedAt);
    for (const admin of activeAdmins) {
      await processAgreements(admin.id, "ADMIN");
    }

    return earnings;
  });
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

  // Recalculate AR variance as (paid - expected) on every startup to ensure correctness
  try {
    await db.execute(sql`UPDATE ar_expectations SET variance_amount_cents = actual_amount_cents - expected_amount_cents WHERE variance_amount_cents != (actual_amount_cents - expected_amount_cents)`);
  } catch (e) {
    console.log('AR variance recalc skipped:', e);
  }
  
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

      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      const ua = req.headers["user-agent"] || "";
      const deviceType = /Mobile|Android|iPhone|iPad/i.test(ua) ? "Mobile" : "Desktop";

      setImmediate(async () => {
        let geoCity: string | null = null;
        let geoRegion: string | null = null;
        let geoCountry: string | null = null;
        try {
          const geoRes = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(3000) });
          if (geoRes.ok) {
            const geo = await geoRes.json();
            if (!geo.error) {
              geoCity = geo.city || null;
              geoRegion = geo.region || null;
              geoCountry = geo.country_name || null;
            }
          }
        } catch {}
        if (!geoCity && !geoRegion) {
          try {
            const geoRes2 = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country`, { signal: AbortSignal.timeout(3000) });
            if (geoRes2.ok) {
              const geo2 = await geoRes2.json();
              geoCity = geo2.city || null;
              geoRegion = geo2.regionName || null;
              geoCountry = geo2.country || null;
            }
          } catch {}
        }
        const locationStr = [geoCity, geoRegion, geoCountry].filter(Boolean).join(", ") || null;
        try {
          await storage.createUserActivityLog({
            userId: user.id,
            eventType: "LOGIN",
            ipAddress: ip,
            city: geoCity,
            region: geoRegion,
            country: geoCountry,
            userAgent: ua,
            deviceType,
          });
          await storage.updateUserLastLogin(user.id, ip, locationStr);
        } catch {
          try {
            await storage.createUserActivityLog({
              userId: user.id,
              eventType: "LOGIN",
              ipAddress: ip,
              userAgent: ua,
              deviceType,
            });
            await storage.updateUserLastLogin(user.id, ip, null);
          } catch {}
        }
      });

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
      const stats = await storage.getDashboardStatsSQL(req.user!.repId);
      res.json(stats);
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
      
      const stats = await storage.getManagerStatsSQL(teamRepIds);
      res.json({ ...stats, teamSize: teamMembers.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  app.get("/api/dashboard/admin-stats", auth, executiveOrAdmin, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getAdminStatsSQL();
      
      const allUsers = await storage.getUsers();
      const activeReps = allUsers.filter(u => u.role === "REP" && u.status === "ACTIVE").length;
      
      const unmatchedPayments = (await storage.getUnmatchedPayments()).filter(p => !p.resolvedAt).length;
      const unmatchedChargebacks = (await storage.getUnmatchedChargebacks()).filter(c => !c.resolvedAt).length;
      const rateIssues = (await storage.getRateIssues()).filter(r => !r.resolvedAt).length;
      const pendingAdjustments = (await storage.getAdjustments()).filter(a => a.approvalStatus === "UNAPPROVED").length;

      res.json({ ...stats, activeReps, unmatchedPayments, unmatchedChargebacks, rateIssues, pendingAdjustments });
    } catch (error) {
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  // Production aggregation endpoint for hierarchical dashboards
  app.get("/api/dashboard/production", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const cadence = (req.query.cadence as "DAY" | "WEEK" | "MONTH") || "WEEK";
      // Only LEAD, MANAGER, EXECUTIVE, ADMIN can use this endpoint
      if (!["LEAD", "MANAGER", "EXECUTIVE", "ADMIN"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ADMIN gets EXECUTIVE-level access to the production dashboard
      const effectiveRole = user.role === "ADMIN" ? "EXECUTIVE" : user.role as "LEAD" | "MANAGER" | "EXECUTIVE";
      
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
      const viewMode = req.query.viewMode as string | undefined; // "own", "team", "global"
      
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
      
      // Determine scope based on viewMode
      const isGlobalView = viewMode === "global" && ["MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(role);
      const isOwnView = viewMode === "own";
      
      // Get rep IDs for personal and team scopes
      const personalRepIds = await storage.getRepIdsForScope(user.id, role, "personal");
      let teamRepIds: string[] = [];
      if (isGlobalView) {
        const allUsers = await storage.getUsers();
        teamRepIds = allUsers.filter(u => ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role) && !u.deletedAt && u.status === "ACTIVE").map(u => u.repId);
      } else if (!isOwnView && role !== "REP" && role !== "MDU") {
        teamRepIds = await storage.getRepIdsForScope(user.id, role, "team");
      }
      
      // Personal metrics
      const personalWeekly = await storage.getProductionMetrics(personalRepIds, formatDate(weekStart), formatDate(weekEnd));
      const personalWeeklyPrior = await storage.getProductionMetrics(personalRepIds, formatDate(priorWeekStart), formatDate(priorWeekEnd));
      const personalWeeklySeries = await storage.getDailyProductionSeries(personalRepIds, formatDate(weekStart), formatDate(weekEnd));
      
      const personalMtd = await storage.getProductionMetrics(personalRepIds, formatDate(mtdStart), formatDate(mtdEnd));
      const personalMtdPrior = await storage.getProductionMetrics(personalRepIds, formatDate(priorMtdStart), formatDate(priorMtdEnd));
      const personalMtdSeries = await storage.getDailyProductionSeries(personalRepIds, formatDate(mtdStart), formatDate(mtdEnd));
      
      // Team metrics (null for REP/MDU or own-only view)
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
      
      if (!isOwnView) {
        if (isGlobalView || ["EXECUTIVE", "ADMIN", "OPERATIONS"].includes(role)) {
          teamByManager = await storage.getTeamBreakdownByManager(formatDate(mtdStart), formatDate(mtdEnd));
          teamByRep = await storage.getTeamBreakdownByRep(user.id, isGlobalView ? "ADMIN" : role, formatDate(mtdStart), formatDate(mtdEnd));
        } else if (["LEAD", "MANAGER"].includes(role)) {
          teamByRep = await storage.getTeamBreakdownByRep(user.id, role, formatDate(mtdStart), formatDate(mtdEnd));
        }
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
      } else if (role === "LEAD") {
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
        ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role)
      );
      
      // Determine which reps to show based on role scope
      let visibleRepIds: string[] = [];
      
      if (role === "REP") {
        visibleRepIds = activeUsers.map(u => u.repId);
      } else if (role === "LEAD") {
        const supervisedReps = await storage.getSupervisedReps(user.id);
        visibleRepIds = [user.repId, ...supervisedReps.map(r => r.repId)];
      } else if (role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        visibleRepIds = [user.repId, ...scope.allRepRepIds];
      } else {
        visibleRepIds = activeUsers.map(u => u.repId);
      }
      
      const leaderboardData = await storage.getLeaderboardSQL(visibleRepIds, formatDate(startDate), formatDate(endDate));
      
      const userMap = new Map(activeUsers.map(u => [u.repId, u]));
      
      const rankings = leaderboardData
        .map(d => {
          const u = userMap.get(d.repId);
          if (!u) return null;
          return {
            userId: u.id,
            repId: d.repId,
            name: u.name,
            role: u.role,
            soldCount: d.soldCount,
            connectsCount: d.connectsCount,
            earnedDollars: d.earnedDollars,
            isCurrentUser: u.id === user.id,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null && (r.soldCount > 0 || r.connectsCount > 0 || r.earnedDollars > 0))
        .sort((a, b) => b.soldCount - a.soldCount);
      
      const rankedResults = rankings.map((r, index) => ({
        ...r,
        rank: index + 1,
      }));
      
      const currentUserRank = rankedResults.find(r => r.isCurrentUser);
      let myRanking = currentUserRank;
      
      if (!currentUserRank) {
        const currentUserStats = activeUsers.find(u => u.id === user.id);
        if (currentUserStats) {
          const myData = leaderboardData.find(d => d.repId === currentUserStats.repId);
          const mySoldCount = myData?.soldCount || 0;
          const myRank = rankings.filter(r => r.soldCount > mySoldCount).length + 1;
          myRanking = {
            userId: user.id,
            repId: currentUserStats.repId,
            name: currentUserStats.name,
            role: currentUserStats.role,
            soldCount: mySoldCount,
            connectsCount: myData?.connectsCount || 0,
            earnedDollars: myData?.earnedDollars || 0,
            isCurrentUser: true,
            rank: myRank,
          };
        }
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
        .filter(o => o.jobStatus === "COMPLETED")
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
        const earnedMTD = memberOrders.filter(o => o.paymentStatus === "PAID").reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned), 0);
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
        supervisors = allUsers.filter(u => u.role === "LEAD" && u.status === "ACTIVE" && !u.deletedAt).map(u => ({ id: u.id, name: u.name }));
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
      const search = req.query.search as string | undefined;
      const viewMode = req.query.viewMode as string | undefined; // "own", "team", "global" for EXECUTIVE

      if (search && search.length >= 2 && (user.role === "ADMIN" || user.role === "OPERATIONS")) {
        const results = await storage.searchOrders(search, limit || 20);
        return res.json(results);
      }

      let orders;

      if (viewMode === "own") {
        orders = await storage.getOrders({ repId: user.repId, limit });
      } else if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        orders = await storage.getOrders({ limit });
      } else if (user.role === "EXECUTIVE") {
        if (viewMode === "global") {
          orders = await storage.getOrders({ limit });
        } else if (viewMode === "team") {
          const scope = await storage.getExecutiveScope(user.id);
          const teamRepIds = [...scope.allRepRepIds, user.repId];
          orders = await storage.getOrders({ teamRepIds, limit });
        } else {
          orders = await storage.getOrders({ repId: user.repId, limit });
        }
      } else if (user.role === "MANAGER") {
        if (viewMode === "global") {
          orders = await storage.getOrders({ limit });
        } else if (viewMode === "team") {
          const scope = await storage.getManagerScope(user.id);
          const teamRepIds = [...scope.allRepRepIds, user.repId];
          orders = await storage.getOrders({ teamRepIds, limit });
        } else {
          orders = await storage.getOrders({ repId: user.repId, limit });
        }
      } else if (user.role === "LEAD") {
        if (viewMode === "team") {
          const supervisedReps = await storage.getSupervisedReps(user.id);
          const teamRepIds = [...supervisedReps.map(r => r.repId), user.repId];
          orders = await storage.getOrders({ teamRepIds, limit });
        } else {
          orders = await storage.getOrders({ repId: user.repId, limit });
        }
      } else {
        orders = await storage.getOrders({ repId: user.repId, limit });
      }

      // Get mobile and gross commission totals for all orders
      const orderIds = orders.map((o: any) => o.id);
      const [mobileCommissionTotals, grossCommissionTotals] = await Promise.all([
        storage.getMobileCommissionTotalsByOrderIds(orderIds),
        storage.getGrossCommissionTotalsByOrderIds(orderIds),
      ]);
      
      // Attach commission totals to each order
      const ordersWithCommissions = orders.map((order: any) => ({
        ...order,
        mobileCommissionTotal: mobileCommissionTotals.get(order.id) || "0",
        grossCommissionTotal: grossCommissionTotals.get(order.id) || "0",
      }));

      res.json(ordersWithCommissions);
    } catch (error) {
      console.error("Get orders error:", error);
      res.status(500).json({ message: "Failed to get orders" });
    }
  });

  app.post("/api/orders", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      
      // Validate required fields
      const { clientId, providerId, serviceId, dateSold, customerName, mobileLines, repId: submittedRepId, hasMobile, hasTv } = req.body;
      if (!clientId || !providerId || !serviceId || !dateSold || !customerName) {
        return res.status(400).json({ message: "Missing required fields: clientId, providerId, serviceId, dateSold, customerName" });
      }
      
      // Determine repId - admins/executives can assign to any rep, others use their own
      let assignedRepId = user.repId;
      if (["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role) && submittedRepId) {
        // Verify the rep exists
        const rep = await storage.getUserByRepId(submittedRepId);
        if (rep) {
          assignedRepId = submittedRepId;
        }
      }
      
      // Base order data (non-mobile fields)
      const baseFields = ["clientId", "providerId", "serviceId", "dateSold", "customerName",
        "customerPhone", "customerEmail", "customerAddress", "houseNumber", "streetName", "aptUnit", "city", "zipCode",
        "accountNumber", "installDate", "notes"];
      
      const baseOrderData: Record<string, any> = {};
      for (const field of baseFields) {
        if (req.body[field] !== undefined) {
          baseOrderData[field] = req.body[field];
        }
      }
      
      const hasMobileLines = Array.isArray(mobileLines) && mobileLines.length > 0;
      const wantsMobile = hasMobile || hasMobileLines;
      const wantsTv = hasTv || req.body.tvSold;
      
      const createdOrders: any[] = [];
      
      // If mobile is selected, create a SEPARATE mobile order
      if (wantsMobile) {
        const mobileOrderData = {
          ...baseOrderData,
          tvSold: false,
          mobileSold: true,
          isMobileOrder: true,
          mobileLinesQty: hasMobileLines ? mobileLines.length : 0,
          mobileProductType: hasMobileLines ? mobileLines[0].mobileProductType : null,
          mobilePortedStatus: hasMobileLines ? mobileLines[0].mobilePortedStatus : null,
        };
        
        const mobileOrder = await createOrderWithCommission({
          orderData: mobileOrderData,
          mobileLineData: hasMobileLines ? mobileLines : undefined,
          dateSold,
          assignedRepId,
          userId: user.id,
        });
        createdOrders.push(mobileOrder);
      }
      
      // If TV or just a base order (no mobile-only), create the base order
      if (wantsTv || !wantsMobile) {
        const regularOrderData = {
          ...baseOrderData,
          tvSold: !!wantsTv,
          mobileSold: false,
          isMobileOrder: false,
        };
        
        const regularOrder = await createOrderWithCommission({
          orderData: regularOrderData,
          dateSold,
          assignedRepId,
          userId: user.id,
        });
        createdOrders.push(regularOrder);
      }
      
      // Return the first order for backward compatibility, or all orders if mobile was split
      if (createdOrders.length === 1) {
        res.json(createdOrders[0]);
      } else {
        // Return the non-mobile order as primary, with a note about the mobile order
        const primaryOrder = createdOrders.find(o => !o.isMobileOrder) || createdOrders[0];
        res.json({ 
          ...primaryOrder, 
          _mobileOrderCreated: true,
          _mobileOrderId: createdOrders.find(o => o.isMobileOrder)?.id
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create order" });
    }
  });

  // Create mobile-only order (separate from regular orders)
  // Uses the EXACT SAME shared createOrderWithCommission helper as POST /api/orders
  app.post("/api/orders/mobile", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      
      // Same required field validation as POST /api/orders
      const { clientId, providerId, serviceId, dateSold, customerName, customerPhone, customerAddress, accountNumber, mobileLines, repId: submittedRepId } = req.body;
      if (!clientId || !providerId || !serviceId || !dateSold || !customerName) {
        return res.status(400).json({ message: "Missing required fields: clientId, providerId, serviceId, dateSold, customerName" });
      }
      
      // Validate mobile lines have valid product types
      const validMobileProductTypes = ["UNLIMITED", "3_GIG", "1_GIG", "BYOD", "OTHER"];
      if (Array.isArray(mobileLines) && mobileLines.length > 0) {
        for (const line of mobileLines) {
          if (!line.mobileProductType || !validMobileProductTypes.includes(line.mobileProductType)) {
            return res.status(400).json({ message: `Invalid mobile product type. Must be one of: ${validMobileProductTypes.join(", ")}` });
          }
        }
      } else {
        return res.status(400).json({ message: "At least one mobile line with a valid product type is required" });
      }
      
      // Determine repId - admins/executives can assign to any rep, others use their own
      let assignedRepId = user.repId;
      if (["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role) && submittedRepId) {
        const rep = await storage.getUserByRepId(submittedRepId);
        if (rep) {
          assignedRepId = submittedRepId;
        }
      }
      
      const hasMobileLines = Array.isArray(mobileLines) && mobileLines.length > 0;
      
      // Build mobile order data
      const mobileOrderData = {
        clientId,
        providerId,
        serviceId,
        dateSold,
        customerName,
        customerPhone: customerPhone || null,
        customerAddress: customerAddress || null,
        accountNumber: accountNumber || null,
        tvSold: false,
        mobileSold: true,
        isMobileOrder: true,
        mobileLinesQty: hasMobileLines ? mobileLines.length : 0,
        mobileProductType: hasMobileLines ? mobileLines[0].mobileProductType : null,
        mobilePortedStatus: hasMobileLines ? mobileLines[0].mobilePortedStatus : null,
      };
      
      // Use the SAME shared helper as POST /api/orders
      const mobileOrder = await createOrderWithCommission({
        orderData: mobileOrderData,
        mobileLineData: hasMobileLines ? mobileLines : undefined,
        dateSold,
        assignedRepId,
        userId: user.id,
        auditAction: "create_mobile_order",
      });
      
      res.json(mobileOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create mobile order" });
    }
  });

  // Get commission line items for an order
  app.get("/api/orders/:id/commission-lines", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      
      // Verify user has access to this order
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      // REP and MDU can only view their own orders' commission lines
      if (["REP", "MDU"].includes(user.role) && order.repId !== user.repId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // LEAD can view their own + their team's orders
      if (user.role === "LEAD") {
        const supervisedReps = await storage.getSupervisedReps(user.id);
        const allowedRepIds = [user.repId, ...supervisedReps.map(r => r.repId)];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      // MANAGER can view their org tree's orders
      if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      // EXECUTIVE can view their org tree's orders
      if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      // ADMIN and OPERATIONS can view all orders
      
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
      
      // Only admins and executives can recalculate commissions
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Only admins and executives can recalculate commissions" });
      }
      
      // Delete existing commission line items
      await storage.deleteCommissionLineItemsByOrderId(id);
      
      // Find matching rate card and recalculate
      const rateCard = await storage.findMatchingRateCard(order, order.dateSold);
      let baseCommission = "0";
      let appliedRateCardId: string | null = null;
      let totalDeductions = 0;
      
      if (rateCard) {
        const lineItems = await storage.calculateCommissionLineItemsAsync(rateCard, order);
        await storage.createCommissionLineItems(order.id, lineItems);
        const grossCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0);
        appliedRateCardId = rateCard.id;
        
        // Calculate override deductions based on user's role
        const salesRep = order.repId ? await storage.getUserByRepId(order.repId) : null;
        
        // Look up role-based override for this user's role
        const userRole = salesRep?.role || "REP";
        const roleOverride = await storage.getRoleOverrideForRateCard(rateCard.id, userRole);
        const isMobileOnlyOrder = (order as any).isMobileOrder === true;
        
        if (roleOverride) {
          const overrideAmounts = {
            base: parseFloat(roleOverride.overrideDeduction || "0"),
            tv: parseFloat(roleOverride.tvOverrideDeduction || "0"),
            mobile: parseFloat(roleOverride.mobileOverrideDeduction || "0"),
          };
          
          if (!isMobileOnlyOrder) {
            totalDeductions += overrideAmounts.base;
            if (order.tvSold) {
              totalDeductions += overrideAmounts.tv;
            }
          }
          if (order.mobileSold) {
            totalDeductions += overrideAmounts.mobile;
          }
        } else {
          // Fall back to rate card default overrides if no role-specific override exists
          const overrideAmounts = {
            base: parseFloat(rateCard.overrideDeduction || "0"),
            tv: parseFloat(rateCard.tvOverrideDeduction || "0"),
            mobile: parseFloat((rateCard as any).mobileOverrideDeduction || "0"),
          };
          
          if (!isMobileOnlyOrder) {
            totalDeductions += overrideAmounts.base;
            if (order.tvSold) {
              totalDeductions += overrideAmounts.tv;
            }
          }
          if (order.mobileSold) {
            totalDeductions += overrideAmounts.mobile;
          }
        }
        baseCommission = Math.max(0, grossCommission - totalDeductions).toFixed(2);
      }
      
      // Update order with recalculated commission
      const updatedOrder = await storage.updateOrder(order.id, {
        baseCommissionEarned: baseCommission,
        appliedRateCardId,
        calcAt: new Date(),
        overrideDeduction: totalDeductions.toFixed(2),
      });
      
      await storage.createAuditLog({ action: "recalculate_commission", tableName: "sales_orders", recordId: order.id, afterJson: JSON.stringify(updatedOrder), userId: user.id });
      
      // Cascade commission changes to AR expectation if one exists
      try {
        const arExpectation = await storage.getArExpectationByOrderId(order.id);
        if (arExpectation) {
          const newBase = parseFloat(updatedOrder.baseCommissionEarned || "0");
          const newIncentive = parseFloat(updatedOrder.incentiveEarned || "0");
          const newOverride = parseFloat(updatedOrder.overrideDeduction || "0");
          const newExpectedCents = Math.round((newBase + newIncentive + newOverride) * 100);
          const newVarianceCents = arExpectation.actualAmountCents - newExpectedCents;
          await storage.updateArExpectation(arExpectation.id, {
            expectedAmountCents: newExpectedCents,
            varianceAmountCents: newVarianceCents,
            hasVariance: newVarianceCents !== 0,
          });
        }
      } catch (arErr) {
        console.error("[Recalculate] Failed to cascade commission change to AR:", arErr);
      }

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
        // REPs, MDU, LEAD can only modify their own orders
        if (["REP", "MDU", "LEAD"].includes(user.role) && order.repId !== user.repId) {
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
      
      if (order.jobStatus === "COMPLETED") {
        // Completed orders: limit editable fields for compliance
        allowedFields = [...statusFields, "customerPhone", "customerEmail", "customerAddress", "accountNumber", "notes"];
        // ADMIN/EXECUTIVE/OPERATIONS can also change repId, provider, client, service, and customerName on completed orders
        if (isAdminLevel) {
          allowedFields.push("repId", "providerId", "clientId", "serviceId", "customerName");
        }
      } else {
        // Non-completed orders - allow full edits
        if (isAdminLevel) {
          // Admin-level can modify all fields including repId
          allowedFields = [...statusFields, ...customerFields, ...orderFields, "repId"];
        } else {
          // REPs and MANAGERs can modify customer + order fields (not repId)
          allowedFields = [...statusFields, ...customerFields, ...orderFields];
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
      
      if (needsRecalc && order.jobStatus !== "COMPLETED") {
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
        
        // If mobile fields changed, update/recreate mobile line items
        const mobileFieldsChanged = updateData.mobileProductType !== undefined || 
                                     updateData.mobilePortedStatus !== undefined ||
                                     updateData.mobileSold !== undefined;
        if (mobileFieldsChanged) {
          // Delete existing mobile line items and recreate with new values
          await storage.deleteMobileLineItemsByOrderId(id);
          if (mergedOrder.mobileSold && mergedOrder.mobileLinesQty > 0) {
            const newMobileLines = [];
            for (let i = 0; i < mergedOrder.mobileLinesQty; i++) {
              newMobileLines.push({
                mobileProductType: mergedOrder.mobileProductType || "UNLIMITED",
                mobilePortedStatus: mergedOrder.mobilePortedStatus || "NON_PORTED",
              });
            }
            await storage.createMobileLineItems(id, newMobileLines);
          }
        }
        
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

      // Cascade commission changes to AR expectation if one exists
      const commissionChanged = 
        (updateData.baseCommissionEarned !== undefined && updateData.baseCommissionEarned !== order.baseCommissionEarned) ||
        (updateData.incentiveEarned !== undefined && updateData.incentiveEarned !== order.incentiveEarned) ||
        (updateData.overrideDeduction !== undefined && updateData.overrideDeduction !== order.overrideDeduction);
      
      if (commissionChanged) {
        try {
          const arExpectation = await storage.getArExpectationByOrderId(id);
          if (arExpectation) {
            const newBase = parseFloat(updated.baseCommissionEarned || "0");
            const newIncentive = parseFloat(updated.incentiveEarned || "0");
            const newOverride = parseFloat(updated.overrideDeduction || "0");
            const newExpectedCents = Math.round((newBase + newIncentive + newOverride) * 100);
            const newVarianceCents = arExpectation.actualAmountCents - newExpectedCents;
            await storage.updateArExpectation(arExpectation.id, {
              expectedAmountCents: newExpectedCents,
              varianceAmountCents: newVarianceCents,
              hasVariance: newVarianceCents !== 0,
            });
          }
        } catch (arErr) {
          console.error("[Orders] Failed to cascade commission change to AR:", arErr);
        }
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update order" });
    }
  });

  // Hard delete order (permanently removes order and all related data) - Executive/Admin/Operations only
  app.delete("/api/admin/orders/:id", auth, async (req: AuthRequest, res, next) => {
    const allowedRoles = ["ADMIN", "EXECUTIVE", "OPERATIONS"];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  }, async (req: AuthRequest, res) => {
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

  app.post("/api/admin/orders/bulk-mark-paid", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      const user = req.user!;
      
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "No orders selected" });
      }
      
      let marked = 0;
      let skipped = 0;
      const paidDate = new Date().toISOString().split("T")[0];
      
      for (const id of orderIds) {
        const order = await storage.getOrderById(id);
        if (!order) {
          skipped++;
          continue;
        }
        
        if (order.paymentStatus === "PAID") {
          skipped++;
          continue;
        }
        
        const totalCommission = (parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned)).toFixed(2);
        const updated = await storage.updateOrder(id, {
          paymentStatus: "PAID",
          paidDate,
          commissionPaid: totalCommission,
        });
        
        await storage.createAuditLog({ action: "bulk_mark_paid", tableName: "sales_orders", recordId: id, beforeJson: JSON.stringify(order), afterJson: JSON.stringify(updated), userId: user.id });
        marked++;
      }
      
      await storage.createAuditLog({ action: "bulk_mark_paid", tableName: "sales_orders", afterJson: JSON.stringify({ marked, skipped }), userId: user.id });
      res.json({ marked, skipped });
    } catch (error) {
      res.status(500).json({ message: "Failed to bulk mark orders as paid" });
    }
  });

  // Bulk delete orders - OPERATIONS only
  app.post("/api/admin/orders/bulk-delete", auth, async (req: AuthRequest, res, next) => {
    if (req.user?.role !== "OPERATIONS") {
      return res.status(403).json({ message: "Only OPERATIONS can bulk delete orders" });
    }
    next();
  }, async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      const user = req.user!;
      
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "No orders selected" });
      }
      
      let deleted = 0;
      let failed = 0;
      
      for (const id of orderIds) {
        try {
          const order = await storage.getOrderById(id);
          if (!order) {
            failed++;
            continue;
          }
          
          await storage.createAuditLog({ 
            action: "bulk_hard_delete_order", 
            tableName: "sales_orders", 
            recordId: id, 
            beforeJson: JSON.stringify(order), 
            userId: user.id 
          });
          await storage.hardDeleteOrder(id);
          deleted++;
        } catch (e) {
          failed++;
        }
      }
      
      await storage.createAuditLog({ action: "bulk_delete_orders", tableName: "sales_orders", afterJson: JSON.stringify({ deleted, failed }), userId: user.id });
      res.json({ deleted, failed });
    } catch (error) {
      res.status(500).json({ message: "Failed to bulk delete orders" });
    }
  });

  // Reverse approval - sets approved order back to unapproved
  app.post("/api/admin/orders/:id/reverse-approval", auth, async (req: AuthRequest, res, next) => {
    const allowedRoles = ["ADMIN", "EXECUTIVE", "OPERATIONS"];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  }, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      if (order.approvalStatus !== "APPROVED") {
        return res.status(400).json({ message: "Order is not approved" });
      }
      
      const beforeJson = JSON.stringify(order);
      
      const updatedOrder = await storage.updateOrder(id, {
        approvalStatus: "UNAPPROVED",
        approvedByUserId: null,
        approvedAt: null,
        jobStatus: "PENDING",
      });
      
      await storage.createAuditLog({ 
        action: "reverse_approval", 
        tableName: "sales_orders", 
        recordId: id, 
        beforeJson, 
        afterJson: JSON.stringify(updatedOrder), 
        userId: user.id 
      });
      
      res.json(updatedOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to reverse approval" });
    }
  });

  // Approve order - ADMIN, OPERATIONS, EXECUTIVE only
  app.post("/api/orders/:id/approve", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Only ADMIN, OPERATIONS, or EXECUTIVE can approve orders" });
      }
      
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      if (order.approvalStatus === "APPROVED") {
        return res.status(400).json({ message: "Order is already approved" });
      }
      
      const beforeJson = JSON.stringify(order);
      const now = new Date();
      
      // When approving, also set jobStatus to COMPLETED if not already
      const updates: Record<string, any> = {
        approvalStatus: "APPROVED",
        approvedByUserId: user.id,
        approvedAt: now,
      };
      
      // Set job status to COMPLETED upon approval if still pending
      if (order.jobStatus === "PENDING") {
        updates.jobStatus = "COMPLETED";
      }
      
      const updatedOrder = await storage.updateOrder(id, updates);
      
      if (updatedOrder) {
        await generateOverrideEarnings(order, updatedOrder);
      }
      
      await storage.createAuditLog({
        action: "approve_order",
        tableName: "sales_orders",
        recordId: id,
        beforeJson,
        afterJson: JSON.stringify(updatedOrder),
        userId: user.id,
      });
      
      res.json(updatedOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to approve order" });
    }
  });

  // Move order to pending - ADMIN, OPERATIONS, EXECUTIVE only
  app.post("/api/orders/:id/move-to-pending", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Only ADMIN, OPERATIONS, or EXECUTIVE can move orders to pending" });
      }
      
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      if (order.jobStatus === "PENDING") {
        return res.status(400).json({ message: "Order is already pending" });
      }
      
      const beforeJson = JSON.stringify(order);
      
      const updatedOrder = await storage.updateOrder(id, {
        jobStatus: "PENDING",
        approvalStatus: "UNAPPROVED",
        approvedByUserId: null,
        approvedAt: null,
      });
      
      await storage.createAuditLog({
        action: "move_order_to_pending",
        tableName: "sales_orders",
        recordId: id,
        beforeJson,
        afterJson: JSON.stringify(updatedOrder),
        userId: user.id,
      });
      
      res.json(updatedOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to move order to pending" });
    }
  });

  // Bulk approve orders - ADMIN, OPERATIONS, EXECUTIVE only
  app.post("/api/orders/bulk-approve", auth, async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Only ADMIN, OPERATIONS, or EXECUTIVE can approve orders" });
      }
      
      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "Order IDs array is required" });
      }
      
      let approved = 0;
      let skipped = 0;
      const now = new Date();
      
      for (const id of orderIds) {
        const order = await storage.getOrderById(id);
        if (!order || order.approvalStatus === "APPROVED") {
          skipped++;
          continue;
        }
        
        const updates: Record<string, any> = {
          approvalStatus: "APPROVED",
          approvedByUserId: user.id,
          approvedAt: now,
        };
        
        if (order.jobStatus === "PENDING") {
          updates.jobStatus = "COMPLETED";
        }
        
        const updatedOrder = await storage.updateOrder(id, updates);
        
        if (updatedOrder) {
          await generateOverrideEarnings(order, updatedOrder);
        }
        
        await storage.createAuditLog({
          action: "bulk_approve_order",
          tableName: "sales_orders",
          recordId: id,
          beforeJson: JSON.stringify(order),
          afterJson: JSON.stringify(updatedOrder),
          userId: user.id,
        });
        
        approved++;
      }
      
      res.json({ approved, skipped });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to bulk approve orders" });
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
      
      // Get default IDs (first available of each type)
      const defaultProviderId = providers[0]?.id;
      const defaultClientId = clients[0]?.id;
      const defaultServiceId = services[0]?.id;
      
      if (!defaultProviderId || !defaultClientId || !defaultServiceId) {
        return res.status(400).json({ 
          message: "Cannot import: Please create at least one Provider, Client, and Service first" 
        });
      }

      // Helper to find column value with flexible naming
      const getColumnValue = (row: Record<string, any>, ...possibleNames: string[]): any => {
        for (const name of possibleNames) {
          // Try exact match first
          if (row[name] !== undefined) return row[name];
          // Try case-insensitive match
          const lowerName = name.toLowerCase();
          for (const key of Object.keys(row)) {
            if (key.toLowerCase() === lowerName) return row[key];
            // Try without spaces/underscores
            if (key.toLowerCase().replace(/[\s_-]/g, '') === lowerName.replace(/[\s_-]/g, '')) return row[key];
          }
        }
        return undefined;
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // Excel row number (1-indexed + header row)

        try {
          // Required fields with flexible column name matching
          const repId = getColumnValue(row, 'repId', 'rep_id', 'Rep ID', 'RepID', 'rep')?.toString().trim() || undefined;
          const customerName = getColumnValue(row, 'customerName', 'customer_name', 'Customer Name', 'CustomerName', 'name', 'Name', 'customer')?.toString().trim();
          const dateSoldRaw = getColumnValue(row, 'dateSold', 'date_sold', 'Date Sold', 'DateSold', 'saleDate', 'Sale Date', 'date');

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

          // Validate rep exists if provided
          let user = null;
          if (repId) {
            user = users.find(u => u.repId === repId);
            if (!user) {
              errors.push(`Row ${rowNum}: Rep ID "${repId}" not found`);
              failed++;
              continue;
            }
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
          const installDateRaw = getColumnValue(row, 'installDate', 'install_date', 'Install Date', 'InstallDate', 'installation_date');
          if (installDateRaw) {
            if (typeof installDateRaw === "number") {
              installDate = new Date((installDateRaw - 25569) * 86400 * 1000);
            } else {
              installDate = new Date(installDateRaw);
            }
            if (isNaN(installDate.getTime())) {
              installDate = undefined;
            }
          }

          // Lookup IDs by name or use provided IDs with flexible column names
          const providerIdRaw = getColumnValue(row, 'providerId', 'provider_id', 'Provider ID', 'ProviderId');
          const providerNameRaw = getColumnValue(row, 'provider', 'Provider', 'provider_name', 'Provider Name');
          let providerId = providerIdRaw?.toString().trim();
          if (!providerId && providerNameRaw) {
            const provider = providers.find(p => p.name.toLowerCase() === providerNameRaw.toString().toLowerCase().trim());
            providerId = provider?.id;
          }

          const clientIdRaw = getColumnValue(row, 'clientId', 'client_id', 'Client ID', 'ClientId');
          const clientNameRaw = getColumnValue(row, 'client', 'Client', 'client_name', 'Client Name');
          let clientId = clientIdRaw?.toString().trim();
          if (!clientId && clientNameRaw) {
            const client = clients.find(c => c.name.toLowerCase() === clientNameRaw.toString().toLowerCase().trim());
            clientId = client?.id;
          }

          const serviceIdRaw = getColumnValue(row, 'serviceId', 'service_id', 'Service ID', 'ServiceId');
          const serviceNameRaw = getColumnValue(row, 'service', 'Service', 'service_name', 'Service Name', 'serviceType', 'Service Type');
          let serviceId = serviceIdRaw?.toString().trim();
          if (!serviceId && serviceNameRaw) {
            const service = services.find(s => s.name.toLowerCase() === serviceNameRaw.toString().toLowerCase().trim());
            serviceId = service?.id;
          }

          // Get other optional fields with flexible naming
          const customerAddress = getColumnValue(row, 'customerAddress', 'customer_address', 'Customer Address', 'address', 'Address')?.toString().trim() || "";
          const houseNumber = getColumnValue(row, 'houseNumber', 'house_number', 'House Number', 'House #', 'Bldg', 'Building')?.toString().trim() || null;
          const streetName = getColumnValue(row, 'streetName', 'street_name', 'Street Name', 'Street', 'street')?.toString().trim() || null;
          const aptUnit = getColumnValue(row, 'aptUnit', 'apt_unit', 'Apt', 'Apt #', 'Unit', 'Suite', 'Apartment')?.toString().trim() || null;
          const orderCity = getColumnValue(row, 'city', 'City')?.toString().trim() || null;
          const zipCode = getColumnValue(row, 'zipCode', 'zip_code', 'Zip Code', 'Zip', 'zip', 'Zipcode', 'ZIP')?.toString().trim() || null;
          const accountNumber = getColumnValue(row, 'accountNumber', 'account_number', 'Account Number', 'account', 'Account')?.toString().trim() || null;
          const invoiceNumber = getColumnValue(row, 'invoiceNumber', 'invoice_number', 'Invoice Number', 'invoice', 'Invoice')?.toString().trim() || null;
          const tvSoldVal = getColumnValue(row, 'tvSold', 'tv_sold', 'TV Sold', 'TV', 'tv');
          const mobileSoldVal = getColumnValue(row, 'mobileSold', 'mobile_sold', 'Mobile Sold', 'Mobile', 'mobile');
          const mobileLinesVal = getColumnValue(row, 'mobileLinesQty', 'mobile_lines_qty', 'Mobile Lines', 'mobileLines', 'mobile_lines');

          const tvSold = tvSoldVal === true || tvSoldVal === "true" || tvSoldVal === 1 || tvSoldVal === "1" || tvSoldVal?.toString().toLowerCase() === "yes";
          const mobileSold = mobileSoldVal === true || mobileSoldVal === "true" || mobileSoldVal === 1 || mobileSoldVal === "1" || mobileSoldVal?.toString().toLowerCase() === "yes";
          const mobileLinesQty = parseInt(mobileLinesVal) || 0;

          const orderData = {
            customerName,
            customerAddress,
            houseNumber,
            streetName,
            aptUnit,
            city: orderCity,
            zipCode,
            accountNumber,
            dateSold: dateSold.toISOString(),
            installDate: installDate ? installDate.toISOString() : null,
            providerId: providerId || defaultProviderId,
            clientId: clientId || defaultClientId,
            serviceId: serviceId || defaultServiceId,
            invoiceNumber,
            tvSold,
            mobileSold,
            mobileLinesQty,
          };

          const assignedRepId = repId || user?.repId || "UNASSIGNED";
          
          const mobileLineData: Array<{ mobileProductType: string; mobilePortedStatus: string }> = [];
          if (mobileSold && mobileLinesQty > 0) {
            for (let ml = 0; ml < mobileLinesQty; ml++) {
              mobileLineData.push({ mobileProductType: "OTHER", mobilePortedStatus: "NON_PORTED" });
            }
          }

          await createOrderWithCommission({
            orderData,
            mobileLineData: mobileLineData.length > 0 ? mobileLineData : undefined,
            dateSold: dateSold.toISOString(),
            assignedRepId,
            userId: req.user!.id,
            auditAction: "import_order",
          });
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

  // Get assignable users for leads - LEAD+ can access this for lead assignment
  app.get("/api/users/assignable", auth, async (req: AuthRequest, res) => {
    try {
      const currentUser = req.user!;
      const canAssign = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(currentUser.role);
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
  
  // Rate cards for override display - all authenticated users can access for commission display
  app.get("/api/rate-cards/for-overrides", auth, async (req: AuthRequest, res) => {
    try {
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

  // Rate Card Lead Overrides
  app.get("/api/admin/rate-cards/:id/lead-overrides", auth, adminOnly, async (req, res) => {
    try {
      res.json(await storage.getRateCardLeadOverrides(req.params.id));
    } catch (error) { res.status(500).json({ message: "Failed to get lead overrides" }); }
  });
  
  app.post("/api/admin/rate-cards/:id/lead-overrides", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { leadId, overrideDeduction, tvOverrideDeduction, mobileOverrideDeduction } = req.body;
      const override = await storage.upsertRateCardLeadOverride({
        rateCardId: req.params.id,
        leadId,
        overrideDeduction: overrideDeduction || "0",
        tvOverrideDeduction: tvOverrideDeduction || "0",
        mobileOverrideDeduction: mobileOverrideDeduction || "0",
      });
      await storage.createAuditLog({ action: "upsert_lead_override", tableName: "rate_card_lead_overrides", recordId: override.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json(override);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to save lead override" }); }
  });
  
  app.delete("/api/admin/rate-cards/:rateCardId/lead-overrides/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      await storage.deleteRateCardLeadOverride(req.params.id);
      await storage.createAuditLog({ action: "delete_lead_override", tableName: "rate_card_lead_overrides", recordId: req.params.id, userId: req.user!.id });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to delete lead override" }); }
  });

  // Rate Card Role Overrides
  app.get("/api/admin/rate-cards/:id/role-overrides", auth, adminOnly, async (req, res) => {
    try {
      res.json(await storage.getRateCardRoleOverrides(req.params.id));
    } catch (error) { res.status(500).json({ message: "Failed to get role overrides" }); }
  });
  
  app.post("/api/admin/rate-cards/:id/role-overrides", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const validRoles = ["REP", "MDU", "LEAD", "MANAGER", "EXECUTIVE"];
      const { roleOverrides } = req.body;
      if (!Array.isArray(roleOverrides)) {
        return res.status(400).json({ message: "roleOverrides must be an array" });
      }
      const validatedOverrides = roleOverrides.filter((ro: any) => 
        ro && typeof ro === "object" && validRoles.includes(ro.role)
      ).map((ro: any) => ({
        role: ro.role,
        overrideDeduction: String(ro.overrideDeduction || "0"),
        tvOverrideDeduction: String(ro.tvOverrideDeduction || "0"),
        mobileOverrideDeduction: String(ro.mobileOverrideDeduction || "0"),
      }));
      await storage.saveRateCardRoleOverrides(req.params.id, validatedOverrides);
      await storage.createAuditLog({ action: "update_role_overrides", tableName: "rate_card_role_overrides", recordId: req.params.id, userId: req.user!.id, afterJson: JSON.stringify(validatedOverrides) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to save role overrides" }); }
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
      
      const result = await db.transaction(async (tx) => {
        const txDb = tx as unknown as TxDb;
        
        const orderIds = orders.map(o => o.id);
        const pendingPoolEntries = await storage.getOverrideDeductionPoolByOrderIds(orderIds);
        const manualDistributions = await storage.getOverrideDistributionsByPayRun(req.params.id);
        const distributedPoolIds = new Set(manualDistributions.map(d => d.poolEntryId));
        
        const distributionResults: { recipientId: string; amount: number; orderId: string }[] = [];
        
        for (const dist of manualDistributions) {
          const poolEntry = pendingPoolEntries.find(e => e.id === dist.poolEntryId);
          if (!poolEntry) continue;
          
          const order = orders.find(o => o.id === poolEntry.salesOrderId);
          if (!order) continue;
          
          const recipient = await storage.getUserById(dist.recipientUserId);
          const earning = await storage.createOverrideEarning({
            salesOrderId: order.id,
            recipientUserId: dist.recipientUserId,
            sourceRepId: order.repId,
            sourceLevelUsed: recipient?.role as any || "LEAD",
            amount: dist.calculatedAmount,
            payRunId: req.params.id,
          }, txDb);
          
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
          }, txDb);
        }
        
        if (manualDistributions.length > 0) {
          await storage.applyOverrideDistributions(req.params.id, txDb);
        }
        
        const distributedPoolEntryIds = Array.from(distributedPoolIds);
        if (distributedPoolEntryIds.length > 0) {
          await storage.markPoolEntriesDistributedByIds(distributedPoolEntryIds, req.params.id, txDb);
        }
        
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
            }, txDb);
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
            }, txDb);
          }
        }
        
        const beforeJson = JSON.stringify({ status: payRun.status });
        const updated = await storage.updatePayRun(req.params.id, { status: "FINALIZED", finalizedAt: new Date() }, txDb);
        await storage.createAuditLog({ 
          action: "finalize_payrun", 
          tableName: "pay_runs", 
          recordId: req.params.id, 
          beforeJson, 
          afterJson: JSON.stringify({ ...updated, overrideDistributions: distributionResults.length }), 
          userId: req.user!.id 
        }, txDb);
        
        return { ...updated, overrideDistributions: distributionResults.length };
      });
      
      res.json(result);
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
  
  app.post("/api/admin/payruns/:id/link-all-orders", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status === "FINALIZED") return res.status(400).json({ message: "Cannot link to finalized pay runs" });

      const allOrders = await storage.getOrders();
      let eligible = allOrders.filter(o => 
        o.jobStatus === "COMPLETED" && 
        o.approvalStatus === "APPROVED" &&
        o.paymentStatus === "UNPAID" && 
        !o.payRunId
      );

      if (payRun.weekEndingDate) {
        const weekEnd = new Date(payRun.weekEndingDate);
        weekEnd.setHours(23, 59, 59, 999);
        const weekStart = new Date(payRun.weekEndingDate);
        weekStart.setDate(weekStart.getDate() - 6);
        weekStart.setHours(0, 0, 0, 0);
        
        eligible = eligible.filter(o => {
          if (!o.approvedAt) return false;
          const approvedAt = new Date(o.approvedAt);
          return approvedAt >= weekStart && approvedAt <= weekEnd;
        });
      }

      if (eligible.length === 0) {
        return res.json({ linked: 0, message: "No eligible orders found for this pay period" });
      }

      const orderIds = eligible.map(o => o.id);
      const orders = await storage.linkOrdersToPayRun(orderIds, req.params.id);
      await storage.updateOverrideEarningsPayRunId(orderIds, req.params.id);

      await storage.createAuditLog({ 
        action: "link_all_orders_to_payrun", 
        tableName: "pay_runs", 
        recordId: req.params.id, 
        afterJson: JSON.stringify({ count: orders.length }), 
        userId: req.user!.id 
      });
      res.json({ linked: orders.length, message: `Linked ${orders.length} orders to pay run` });
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
