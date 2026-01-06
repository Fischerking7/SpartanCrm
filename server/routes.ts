import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { authMiddleware, generateToken, hashPassword, comparePassword, adminOnly, managerOrAdmin, type AuthRequest } from "./auth";
import { loginSchema, insertUserSchema, insertProviderSchema, insertClientSchema, insertServiceSchema, insertRateCardSchema, insertSalesOrderSchema, insertIncentiveSchema, insertAdjustmentSchema, insertPayRunSchema, insertChargebackSchema, type SalesOrder, type OverrideEarning, type User } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import crypto from "crypto";

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
  const orderFilter = { providerId: approvedOrder.providerId, clientId: approvedOrder.clientId, serviceId: approvedOrder.serviceId };
  
  // Get hierarchy for the rep
  const hierarchy = await storage.getRepHierarchy(approvedOrder.repId);
  
  // Get all admins - they get overrides on every approved order globally
  const admins = await storage.getUsersByRole("ADMIN");
  for (const admin of admins) {
    const agreements = await storage.getActiveOverrideAgreements(admin.id, "REP", approvedOrder.dateSold, orderFilter);
    for (const agreement of agreements) {
      const earning = await storage.createOverrideEarning({
        salesOrderId: approvedOrder.id,
        recipientUserId: admin.id,
        sourceRepId: approvedOrder.repId,
        sourceLevelUsed: "REP",
        amount: agreement.amountFlat,
        overrideAgreementId: agreement.id,
      });
      earnings.push(earning);
    }
  }

  // Executive overrides (MANAGER, SUPERVISOR, REP levels)
  if (hierarchy.executive) {
    for (const sourceLevel of ["REP", "SUPERVISOR", "MANAGER"] as const) {
      const agreements = await storage.getActiveOverrideAgreements(hierarchy.executive.id, sourceLevel, approvedOrder.dateSold, orderFilter);
      for (const agreement of agreements) {
        const earning = await storage.createOverrideEarning({
          salesOrderId: approvedOrder.id,
          recipientUserId: hierarchy.executive.id,
          sourceRepId: approvedOrder.repId,
          sourceLevelUsed: sourceLevel,
          amount: agreement.amountFlat,
          overrideAgreementId: agreement.id,
        });
        earnings.push(earning);
      }
    }
  }

  // Manager overrides (REP level always, SUPERVISOR level only if supervisor exists)
  if (hierarchy.manager) {
    // Manager always gets REP-level overrides (whether direct or indirect)
    const repAgreements = await storage.getActiveOverrideAgreements(hierarchy.manager.id, "REP", approvedOrder.dateSold, orderFilter);
    for (const agreement of repAgreements) {
      const earning = await storage.createOverrideEarning({
        salesOrderId: approvedOrder.id,
        recipientUserId: hierarchy.manager.id,
        sourceRepId: approvedOrder.repId,
        sourceLevelUsed: "REP",
        amount: agreement.amountFlat,
        overrideAgreementId: agreement.id,
      });
      earnings.push(earning);
    }
    
    // Manager gets SUPERVISOR-level overrides ONLY if rep has a supervisor
    if (hierarchy.supervisor) {
      const supervisorAgreements = await storage.getActiveOverrideAgreements(hierarchy.manager.id, "SUPERVISOR", approvedOrder.dateSold, orderFilter);
      for (const agreement of supervisorAgreements) {
        const earning = await storage.createOverrideEarning({
          salesOrderId: approvedOrder.id,
          recipientUserId: hierarchy.manager.id,
          sourceRepId: approvedOrder.repId,
          sourceLevelUsed: "SUPERVISOR",
          amount: agreement.amountFlat,
          overrideAgreementId: agreement.id,
        });
        earnings.push(earning);
      }
    }
  }

  // Supervisor overrides (REP level only)
  if (hierarchy.supervisor) {
    const agreements = await storage.getActiveOverrideAgreements(hierarchy.supervisor.id, "REP", approvedOrder.dateSold, orderFilter);
    for (const agreement of agreements) {
      const earning = await storage.createOverrideEarning({
        salesOrderId: approvedOrder.id,
        recipientUserId: hierarchy.supervisor.id,
        sourceRepId: approvedOrder.repId,
        sourceLevelUsed: "REP",
        amount: agreement.amountFlat,
        overrideAgreementId: agreement.id,
      });
      earnings.push(earning);
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const auth = authMiddleware(db);
  
  // Bootstrap FOUNDER on first run (empty users table)
  await bootstrapFounder();

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

  // Orders routes
  app.get("/api/orders", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      let orders;

      if (user.role === "ADMIN") {
        // Admin sees all orders
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
        // Supervisor sees their assigned reps
        const supervisedReps = await storage.getSupervisedReps(user.id);
        const teamRepIds = [...supervisedReps.map(r => r.repId), user.repId];
        orders = await storage.getOrders({ teamRepIds, limit });
      } else {
        // REP sees only their own orders
        orders = await storage.getOrders({ repId: user.repId, limit });
      }

      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get orders" });
    }
  });

  app.post("/api/orders", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      
      // Validate required fields
      const { clientId, providerId, serviceId, dateSold, customerName } = req.body;
      if (!clientId || !providerId || !serviceId || !dateSold || !customerName) {
        return res.status(400).json({ message: "Missing required fields: clientId, providerId, serviceId, dateSold, customerName" });
      }
      
      // Strict whitelist of allowed fields for order creation
      const allowedFields = [
        "clientId", "providerId", "serviceId", "dateSold", "customerName",
        "customerPhone", "customerEmail", "customerAddress", "accountNumber",
        "installDate", "tvSold", "mobileSold", "mobileLinesQty", "notes"
      ];
      
      const orderData: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          orderData[field] = req.body[field];
        }
      }
      
      // System-controlled fields - cannot be set by user
      const data = { 
        ...orderData,
        repId: user.repId,
        jobStatus: "PENDING" as const,
        approvalStatus: "UNAPPROVED" as const,
        baseCommissionEarned: "0",
        incentiveEarned: "0",
        commissionPaid: "0",
        paymentStatus: "UNPAID" as const,
        exportedToAccounting: false,
      };
      
      const order = await storage.createOrder(data as any);
      await storage.createAuditLog({ action: "create_order", tableName: "sales_orders", recordId: order.id, afterJson: JSON.stringify(order), userId: user.id });
      res.json(order);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create order" });
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
      const orderFields = ["clientId", "providerId", "serviceId", "dateSold", "tvSold", "mobileSold", "mobileLinesQty", "notes"];
      
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

      // Calculate commission
      let baseCommission = "0";
      let rateCard = await storage.findMatchingRateCard(order, order.dateSold);
      if (rateCard) {
        if (rateCard.commissionType === "FLAT") {
          baseCommission = rateCard.amount;
        } else if (rateCard.commissionType === "PER_LINE") {
          baseCommission = (parseFloat(rateCard.amount) * order.mobileLinesQty).toString();
        }
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
          if (rateCard.commissionType === "FLAT") {
            baseCommission = rateCard.amount;
          } else if (rateCard.commissionType === "PER_LINE") {
            baseCommission = (parseFloat(rateCard.amount) * order.mobileLinesQty).toString();
          }
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
      // Prevent deleting founders unless you are a founder
      if (targetUser.role === "FOUNDER" && req.user!.role !== "FOUNDER") {
        return res.status(403).json({ message: "Only a Founder can remove another Founder" });
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
  app.post("/api/admin/rate-cards", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const rateCard = await storage.createRateCard(req.body);
      await storage.createAuditLog({ action: "create_rate_card", tableName: "rate_cards", recordId: rateCard.id, afterJson: JSON.stringify(rateCard), userId: req.user!.id });
      res.json(rateCard);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/rate-cards/:id", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const rateCard = await storage.updateRateCard(req.params.id, req.body);
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
  app.post("/api/admin/adjustments/:id/approve", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const adjustment = await storage.updateAdjustment(req.params.id, { approvalStatus: "APPROVED", approvedByUserId: req.user!.id, approvedAt: new Date() });
      await storage.createAuditLog({ action: "approve_adjustment", tableName: "adjustments", recordId: req.params.id, afterJson: JSON.stringify(adjustment), userId: req.user!.id });
      res.json(adjustment);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.post("/api/admin/adjustments/:id/reject", auth, adminOnly, async (req: AuthRequest, res) => {
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

      const csvData = orders.map(o => ({
        invoiceNumber: o.invoiceNumber,
        repId: o.repId,
        customerName: o.customerName,
        dateSold: o.dateSold,
        baseCommission: o.baseCommissionEarned,
        incentive: o.incentiveEarned,
        total: (parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned)).toFixed(2),
      }));

      const csv = stringify(csvData, { header: true });
      await storage.createAuditLog({ action: "export_accounting", tableName: "sales_orders", afterJson: JSON.stringify({ count: orders.length, batchId: batch.id }), userId: req.user!.id });
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="export-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csv);
    } catch (error) { res.status(500).json({ message: "Export failed" }); }
  });

  app.post("/api/admin/accounting/import-payments", auth, adminOnly, async (req: AuthRequest, res) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });
      
      // This is a simplified version - in production you'd use multer middleware
      res.json({ matched: 0, unmatched: 0, message: "Payment import endpoint ready" });
    } catch (error) { res.status(500).json({ message: "Import failed" }); }
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

  return httpServer;
}
