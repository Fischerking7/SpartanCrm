import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { authMiddleware, generateToken, hashPassword, comparePassword, adminOnly, managerOrAdmin, type AuthRequest } from "./auth";
import { loginSchema, insertUserSchema, insertProviderSchema, insertClientSchema, insertServiceSchema, insertRateCardSchema, insertSalesOrderSchema, insertIncentiveSchema, insertAdjustmentSchema, insertPayRunSchema, insertChargebackSchema, insertOverrideAgreementSchema, type SalesOrder, type OverrideEarning, type User, type Provider, type Client } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import crypto from "crypto";
import multer from "multer";
import * as XLSX from "xlsx";

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
  
  const earnings: OverrideEarning[] = [];
  
  // Fetch mobile line items for per-line override calculation
  const mobileLines = await storage.getMobileLineItemsByOrderId(approvedOrder.id);
  
  // Base order filter (without mobile product type - we'll handle mobile per-line)
  const baseOrderFilter = { 
    providerId: approvedOrder.providerId, 
    clientId: approvedOrder.clientId, 
    serviceId: approvedOrder.serviceId,
    tvSold: approvedOrder.tvSold
  };
  
  // Helper: Calculate override amount for non-mobile or legacy mobile orders
  const calculateOverrideAmount = (agreement: { amountFlat: string; mobileProductType: string | null }): string => {
    // For non-mobile agreements or when no mobile line items exist, use the base amount
    // If using legacy aggregate fields, multiply by mobileLinesQty
    if (agreement.mobileProductType && agreement.mobileProductType !== "NO_MOBILE" && mobileLines.length === 0 && approvedOrder.mobileLinesQty > 0) {
      return (parseFloat(agreement.amountFlat) * approvedOrder.mobileLinesQty).toFixed(2);
    }
    return agreement.amountFlat;
  };
  
  // Helper: Process agreements for a recipient and source level
  const processAgreements = async (
    recipientUserId: string, 
    sourceLevel: "REP" | "SUPERVISOR" | "MANAGER",
    filter: typeof baseOrderFilter & { mobileProductType?: string | null }
  ) => {
    const agreements = await storage.getActiveOverrideAgreements(recipientUserId, sourceLevel, approvedOrder.dateSold, filter);
    for (const agreement of agreements) {
      // For mobile-specific agreements with mobile line items, process per-line
      if (agreement.mobileProductType && agreement.mobileProductType !== "NO_MOBILE" && mobileLines.length > 0) {
        // Count matching mobile lines for this specific product type
        const matchingLines = mobileLines.filter(line => line.mobileProductType === agreement.mobileProductType);
        if (matchingLines.length > 0) {
          const totalAmount = (parseFloat(agreement.amountFlat) * matchingLines.length).toFixed(2);
          const earning = await storage.createOverrideEarning({
            salesOrderId: approvedOrder.id,
            recipientUserId,
            sourceRepId: approvedOrder.repId,
            sourceLevelUsed: sourceLevel,
            amount: totalAmount,
            overrideAgreementId: agreement.id,
          });
          earnings.push(earning);
        }
      } else {
        // Non-mobile agreement or legacy order
        const earning = await storage.createOverrideEarning({
          salesOrderId: approvedOrder.id,
          recipientUserId,
          sourceRepId: approvedOrder.repId,
          sourceLevelUsed: sourceLevel,
          amount: calculateOverrideAmount(agreement),
          overrideAgreementId: agreement.id,
        });
        earnings.push(earning);
      }
    }
  };
  
  // Get hierarchy for the rep
  const hierarchy = await storage.getRepHierarchy(approvedOrder.repId);
  
  // Build filter for agreements - include each mobile product type from the order
  const mobileProductTypes = mobileLines.length > 0 
    ? Array.from(new Set(mobileLines.map(l => l.mobileProductType))) 
    : (approvedOrder.mobileProductType ? [approvedOrder.mobileProductType] : []);
  
  // Get all admins - they get overrides on every approved order globally
  const admins = await storage.getUsersByRole("ADMIN");
  for (const admin of admins) {
    // Process non-mobile agreements
    await processAgreements(admin.id, "REP", { ...baseOrderFilter, mobileProductType: null });
    // Process mobile agreements for each product type
    for (const mobileType of mobileProductTypes) {
      await processAgreements(admin.id, "REP", { ...baseOrderFilter, mobileProductType: mobileType });
    }
  }

  // Executive overrides (MANAGER, SUPERVISOR, REP levels)
  if (hierarchy.executive) {
    for (const sourceLevel of ["REP", "SUPERVISOR", "MANAGER"] as const) {
      await processAgreements(hierarchy.executive.id, sourceLevel, { ...baseOrderFilter, mobileProductType: null });
      for (const mobileType of mobileProductTypes) {
        await processAgreements(hierarchy.executive.id, sourceLevel, { ...baseOrderFilter, mobileProductType: mobileType });
      }
    }
  }

  // Manager overrides (REP level always, SUPERVISOR level only if supervisor exists)
  if (hierarchy.manager) {
    await processAgreements(hierarchy.manager.id, "REP", { ...baseOrderFilter, mobileProductType: null });
    for (const mobileType of mobileProductTypes) {
      await processAgreements(hierarchy.manager.id, "REP", { ...baseOrderFilter, mobileProductType: mobileType });
    }
    
    if (hierarchy.supervisor) {
      await processAgreements(hierarchy.manager.id, "SUPERVISOR", { ...baseOrderFilter, mobileProductType: null });
      for (const mobileType of mobileProductTypes) {
        await processAgreements(hierarchy.manager.id, "SUPERVISOR", { ...baseOrderFilter, mobileProductType: mobileType });
      }
    }
  }

  // Supervisor overrides (REP level only)
  if (hierarchy.supervisor) {
    await processAgreements(hierarchy.supervisor.id, "REP", { ...baseOrderFilter, mobileProductType: null });
    for (const mobileType of mobileProductTypes) {
      await processAgreements(hierarchy.supervisor.id, "REP", { ...baseOrderFilter, mobileProductType: mobileType });
    }
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const auth = authMiddleware(db);
  
  // Bootstrap FOUNDER and ADMIN on first run
  await bootstrapFounder();
  await bootstrapAdmin();

  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
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
  
  // Admin/Manager/Supervisor password reset for target user
  app.post("/api/users/:id/password-reset", auth, async (req: AuthRequest, res) => {
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
      const role = user.role as "SUPERVISOR" | "MANAGER" | "EXECUTIVE";
      
      // Only SUPERVISOR, MANAGER, EXECUTIVE can use this endpoint
      if (!["SUPERVISOR", "MANAGER", "EXECUTIVE"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const result = await storage.getProductionAggregation(user.id, role, cadence);
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
        
        // Sum up all line item commissions
        baseCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0).toFixed(2);
        appliedRateCardId = rateCard.id;
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
        baseCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0).toFixed(2);
        appliedRateCardId = rateCard.id;
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

  // Admin approval routes
  app.get("/api/admin/approvals/queue", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      let orders = await storage.getPendingApprovals();
      if (limit) orders = orders.slice(0, limit);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get approvals" });
    }
  });

  app.post("/api/admin/orders/:id/approve", auth, adminOnly, async (req: AuthRequest, res) => {
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

      const updated = await storage.updateOrder(id, {
        approvalStatus: "APPROVED",
        approvedByUserId: user.id,
        approvedAt: new Date(),
        baseCommissionEarned: baseCommission,
        appliedRateCardId: rateCard?.id || null,
        calcAt: new Date(),
        commissionSource: "CALCULATED",
      });

      // Generate override earnings
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

  app.post("/api/admin/orders/bulk-approve", auth, adminOnly, async (req: AuthRequest, res) => {
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
          
          const updated = await storage.updateOrder(id, {
            approvalStatus: "APPROVED",
            approvedByUserId: user.id,
            approvedAt: new Date(),
            baseCommissionEarned: baseCommission,
            appliedRateCardId: rateCard.id,
            calcAt: new Date(),
            commissionSource: "CALCULATED",
          });
          
          // Generate override earnings
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

  // Excel Import for Orders
  const upload = multer({ storage: multer.memoryStorage() });
  
  app.post("/api/admin/orders/import", auth, adminOnly, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];

      if (rows.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }

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

  app.post("/api/admin/users", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const { password, name, repId, role, assignedSupervisorId, assignedManagerId, assignedExecutiveId, skipValidation } = req.body;
      if (!password || !name || !repId) {
        return res.status(400).json({ message: "Missing required fields: name, repId, password" });
      }
      
      const userRole = role || "REP";
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
      const { password, name, role, assignedSupervisorId, assignedManagerId, assignedExecutiveId, skipValidation } = req.body;
      
      // Get existing user for before snapshot
      const existingUser = await storage.getUserById(id);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (role !== undefined) updateData.role = role;
      if (assignedSupervisorId !== undefined) updateData.assignedSupervisorId = assignedSupervisorId || null;
      if (assignedManagerId !== undefined) updateData.assignedManagerId = assignedManagerId || null;
      if (assignedExecutiveId !== undefined) updateData.assignedExecutiveId = assignedExecutiveId || null;
      if (password) {
        updateData.passwordHash = await hashPassword(password);
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
  app.get("/api/admin/payruns", auth, adminOnly, async (req, res) => {
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

  app.get("/api/admin/payruns/:id", auth, adminOnly, async (req: AuthRequest, res) => {
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

      const csvData = orders.map((o: any) => ({
        "Rep ID": o.repId,
        "Client": o.client?.name || "",
        "Provider": o.provider?.name || "",
        "Date Sold": o.dateSold,
        "Install Date": o.installDate || "",
        "Account Number": o.accountNumber || "",
        "Service": o.service?.name || "",
        "TV/Video?": o.tvSold ? "Yes" : "No",
        "Mobile sold?": o.mobileSold ? "Yes" : "No",
        "Mobile Lines Sold Quantity": o.mobileLinesQty || 0,
        "Commission Earned": (parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned)).toFixed(2),
        "Customer Name": o.customerName,
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
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const payRunId = req.body.payRunId || null;
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, any>[];

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
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const payRunId = req.body.payRunId || null;
      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, any>[];

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
            baseCommission = lineItems.reduce((sum, item) => sum + parseFloat(item.totalAmount || "0"), 0).toFixed(2);
            appliedRateCardId = rateCard.id;
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
  app.get("/api/admin/accounting/export-batches", auth, adminOnly, async (req, res) => {
    try {
      const batches = await storage.getExportBatches();
      res.json(batches);
    } catch (error) { res.status(500).json({ message: "Failed to get export batches" }); }
  });

  app.get("/api/admin/accounting/export-batches/:id", auth, adminOnly, async (req, res) => {
    try {
      const batch = await storage.getExportBatchById(req.params.id);
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      const orders = await storage.getOrdersByExportBatch(req.params.id);
      res.json({ batch, orders });
    } catch (error) { res.status(500).json({ message: "Failed to get export batch" }); }
  });

  app.get("/api/admin/accounting/exported-orders", auth, adminOnly, async (req, res) => {
    try {
      const orders = await storage.getExportedOrders();
      res.json(orders);
    } catch (error) { res.status(500).json({ message: "Failed to get exported orders" }); }
  });

  // Exception Queues
  app.get("/api/admin/queues/unmatched-payments", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getUnmatchedPayments()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/unmatched-chargebacks", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getUnmatchedChargebacks()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/rate-issues", auth, adminOnly, async (req, res) => {
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
  app.get("/api/admin/audit", auth, adminOnly, async (req, res) => {
    try { res.json(await storage.getAuditLogs()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });

  // Leads - accessible by all authenticated users for their own leads
  app.get("/api/leads", auth, async (req: AuthRequest, res) => {
    try {
      const { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName } = req.query as {
        zipCode?: string;
        street?: string;
        city?: string;
        dateFrom?: string;
        dateTo?: string;
        houseNumber?: string;
        streetName?: string;
      };
      const leads = await storage.getLeadsByRepId(req.user!.repId, { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName });
      res.json(leads);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch leads" });
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

  // Import leads from Excel (REP and above can import)
  app.post("/api/leads/import", auth, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[];

      if (rows.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }

      const errors: string[] = [];
      let success = 0;
      let failed = 0;

      // Get users for validation
      const users = await storage.getUsers();
      const currentUser = req.user!;
      const isRep = currentUser.role === "REP";

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        try {
          // For REPs, use their own repId; for others, use from file or default to their own
          let repId = row.repId?.toString().trim();
          
          if (isRep) {
            // REPs can only import leads for themselves
            repId = currentUser.repId;
          } else if (!repId) {
            // Non-REPs default to their own repId if not specified
            repId = currentUser.repId;
          }

          // Address fields - houseNumber and streetName, or combined address/street
          let houseNumber = row.houseNumber?.toString().trim() || row.house_number?.toString().trim() || "";
          let streetName = row.streetName?.toString().trim() || row.street_name?.toString().trim() || "";
          const customerAddress = row.customerAddress?.toString().trim() || row.address?.toString().trim() || "";
          const street = row.street?.toString().trim() || "";
          
          // If no separate fields, try to parse from combined address
          if (!houseNumber && !streetName && (customerAddress || street)) {
            const fullAddr = customerAddress || street;
            const match = fullAddr.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
            if (match) {
              houseNumber = match[1];
              streetName = match[2];
            } else {
              streetName = fullAddr;
            }
          }
          
          if (!houseNumber && !streetName && !customerAddress && !street) {
            errors.push(`Row ${rowNum}: Missing address (houseNumber/streetName or address required)`);
            failed++;
            continue;
          }

          const customerName = row.customerName?.toString().trim() || "";

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
            customerPhone: row.customerPhone?.toString().trim() || null,
            customerEmail: row.customerEmail?.toString().trim() || null,
            houseNumber: houseNumber || null,
            streetName: streetName || null,
            street: street || null,
            city: row.city?.toString().trim() || null,
            state: row.state?.toString().trim() || null,
            zipCode: row.zipCode?.toString().trim() || null,
            notes: row.notes?.toString().trim() || null,
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

  return httpServer;
}
