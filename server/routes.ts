import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage, type TxDb } from "./storage";
import { db } from "./db";
import { eq, and, sql, gte, lte, inArray, isNull, isNotNull, ne, asc, or, desc } from "drizzle-orm";
import { users, providers, clients, services, rateCards, salesOrders, payStatements, payStatementDeductions, leads, arPayments, chargebacks, overrideEarnings, installSyncRuns, financeImports, financeImportRows, payRuns, scheduledPayRuns, advances, arExpectations, salesGoals, carrierImportSchedules, apiKeys, integrationLogs, calendarSyncConfig, onboardingSubmissions, onboardingAuditLog, onboardingDrafts, emailNotifications, rollingReserves, reserveTransactions, systemExceptions } from "@shared/schema";
import { authMiddleware, generateToken, hashPassword, comparePassword, managerOrAdmin, leadOrAbove, type AuthRequest } from "./auth";
import { requirePermission, hasPermission, canCreateRole, PERMISSIONS } from "./permissions";
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
import { getOrCreateReserve, applyWithholding, applyChargebackToReserve, applyEquipmentRecovery, handleRepSeparation, checkAndReleaseMaturedReserves, calculateWithholding, isReserveEligibleRole } from "./reserves/reserveService";
import { generatePayStub, generatePayStubsForPayRun } from "./payStubGenerator";
import { generatePayStubPdf } from "./payStubPdf";
import archiver from "archiver";

// Placeholder until actual MRC data is tracked
const REVENUE_MULTIPLIER = parseFloat(process.env.REVENUE_MULTIPLIER || "5");

function calcGrossCommission(order: any): number {
  return (
    parseFloat(order.baseCommissionEarned || '0') +
    parseFloat(order.incentiveEarned || '0') +
    parseFloat(order.overrideDeduction || '0')
  );
}

function getPeriodRange(period: string): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;
  switch (period) {
    case 'WEEK':
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      break;
    case 'QUARTER':
      start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      break;
    case 'MONTH':
    default:
      start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      break;
  }
  return { start, end };
}

function requireRoles(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user?.role || '')) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

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

async function scoreAndUpdateOrder(orderId: string) {
  try {
    const { scoreChargebackRisk } = await import("./chargebackRiskEngine");
    const { score, factors } = await scoreChargebackRisk(orderId);
    await storage.updateOrder(orderId, {
      chargebackRiskScore: score,
      chargebackRiskFactors: JSON.stringify(factors),
    });
    return score;
  } catch (error) {
    console.error(`[RiskEngine] Failed to score order ${orderId}:`, error);
    return 0;
  }
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
        const agreementAmount = parseFloat(agreement.amountFlat || "0");
        if (agreementAmount <= 0) continue;
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
            const agreementAmountParsed = parseFloat(agreement.amountFlat || "0");
            if (agreementAmountParsed <= 0) continue;
            const matchingLines = mobileLines.filter(l => 
              l.mobileProductType === mobileType && 
              (!agreement.mobilePortedFilter || l.mobilePortedStatus === agreement.mobilePortedFilter)
            );
            const lineCount = matchingLines.length || 1;
            const totalAmount = (agreementAmountParsed * lineCount).toFixed(2);
            
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

    let totalDirectorOverrideCents = 0;
    let totalAdminOverrideCents = 0;
    let totalAccountingOverrideCents = 0;
    let totalRackRateCents = 0;

    const accountingUsers = admins.filter(u => u.role === "ACCOUNTING" && u.status === "ACTIVE" && !u.deletedAt);

    for (const rateCardId of usedRateCardIds) {
      const rateCard = await storage.getRateCardById(rateCardId);
      if (!rateCard) continue;

      if (rateCard.ironCrestRackRateCents) totalRackRateCents += rateCard.ironCrestRackRateCents;

      const directorCents = rateCard.directorOverrideCents || 0;
      if (directorCents > 0) {
        totalDirectorOverrideCents += directorCents;
        if (hierarchy.executive) {
          const earning = await storage.createOverrideEarning({
            salesOrderId: approvedOrder.id,
            recipientUserId: hierarchy.executive.id,
            sourceRepId: approvedOrder.repId,
            sourceLevelUsed: "EXECUTIVE",
            amount: (directorCents / 100).toFixed(2),
            overrideType: "DIRECTOR_OVERRIDE",
            approvalStatus: "PENDING_APPROVAL",
          }, txDb);
          earnings.push(earning);

          const executiveUsers = admins.filter(u => u.role === "EXECUTIVE" && u.status === "ACTIVE" && !u.deletedAt);
          const operationsUsersForDirector = admins.filter(u => u.role === "OPERATIONS" && u.status === "ACTIVE" && !u.deletedAt);
          const directorNotifyList = [
            ...executiveUsers.filter(u => u.id !== hierarchy.executive!.id),
            ...operationsUsersForDirector,
          ];
          for (const notifyUser of directorNotifyList) {
            try {
              await storage.createEmailNotification({
                userId: notifyUser.id,
                notificationType: "OVERRIDE_PENDING_APPROVAL",
                subject: "Override Earning Pending Approval",
                body: `A DIRECTOR_OVERRIDE override of $${(directorCents / 100).toFixed(2)} for order ${approvedOrder.invoiceNumber || approvedOrder.id} (${approvedOrder.customerName}) is pending your approval.`,
                recipientEmail: "",
                status: "PENDING",
                isRead: false,
              });
            } catch (e) {}
          }
        }
      }

      const adminCents = rateCard.adminOverrideCents || 0;
      if (adminCents > 0) {
        totalAdminOverrideCents += adminCents;
        const operationsUsers = admins.filter(u => u.role === "OPERATIONS" && u.status === "ACTIVE" && !u.deletedAt);
        const recipientId = operationsUsers[0]?.id || activeAdmins[0]?.id;
        if (recipientId) {
          const earning = await storage.createOverrideEarning({
            salesOrderId: approvedOrder.id,
            recipientUserId: recipientId,
            sourceRepId: approvedOrder.repId,
            sourceLevelUsed: "ADMIN",
            amount: (adminCents / 100).toFixed(2),
            overrideType: "ADMIN_OVERRIDE",
            approvalStatus: "PENDING_APPROVAL",
          }, txDb);
          earnings.push(earning);

          const adminNotifyList = operationsUsers.length > 0 ? operationsUsers : activeAdmins;
          for (const notifyUser of adminNotifyList) {
            if (notifyUser.id === recipientId) continue;
            try {
              await storage.createEmailNotification({
                userId: notifyUser.id,
                notificationType: "OVERRIDE_PENDING_APPROVAL",
                subject: "Override Earning Pending Approval",
                body: `An ADMIN_OVERRIDE override of $${(adminCents / 100).toFixed(2)} for order ${approvedOrder.invoiceNumber || approvedOrder.id} (${approvedOrder.customerName}) is pending your approval.`,
                recipientEmail: "",
                status: "PENDING",
                isRead: false,
              });
            } catch (e) {}
          }
        }
      }

      const accountingCents = (rateCard as any).accountingOverrideCents || 0;
      if (accountingCents > 0) {
        totalAccountingOverrideCents += accountingCents;
        if (accountingUsers.length === 0) {
          try {
            await storage.createRateIssue({
              salesOrderId: approvedOrder.id,
              type: "MISSING_ACCOUNTING_RECIPIENT",
              details: `No active ACCOUNTING users found to receive accounting override of ${accountingCents}c for rate card ${rateCardId}`,
            });
          } catch (e) {
            console.error("[generateOverrideEarnings] Failed to create rate issue:", e);
          }
        } else {
          const totalAccountingDollars = accountingCents / 100;
          const perUserBase = Math.floor(totalAccountingDollars * 100 / accountingUsers.length) / 100;
          const remainderCents = Math.round(totalAccountingDollars * 100) - Math.round(perUserBase * 100 * accountingUsers.length);
          for (let i = 0; i < accountingUsers.length; i++) {
            const acctUser = accountingUsers[i];
            const userAmount = i === 0 ? (perUserBase + remainderCents / 100).toFixed(2) : perUserBase.toFixed(2);
            const earning = await storage.createOverrideEarning({
              salesOrderId: approvedOrder.id,
              recipientUserId: acctUser.id,
              sourceRepId: approvedOrder.repId,
              sourceLevelUsed: "ACCOUNTING",
              amount: userAmount,
              overrideType: "ACCOUNTING_OVERRIDE",
              approvalStatus: "PENDING_APPROVAL",
            }, txDb);
            earnings.push(earning);
          }

          const executiveUsers = admins.filter(u => u.role === "EXECUTIVE" && u.status === "ACTIVE" && !u.deletedAt);
          const operationsUsers = admins.filter(u => u.role === "OPERATIONS" && u.status === "ACTIVE" && !u.deletedAt);
          const notifyUsers = [...executiveUsers, ...operationsUsers];
          for (const notifyUser of notifyUsers) {
            try {
              await storage.createEmailNotification({
                userId: notifyUser.id,
                notificationType: "OVERRIDE_PENDING_APPROVAL",
                subject: "Override Earning Pending Approval",
                body: `An ACCOUNTING_OVERRIDE override of $${(accountingCents / 100).toFixed(2)} for order ${approvedOrder.invoiceNumber || approvedOrder.id} (${approvedOrder.customerName}) is pending your approval.`,
                recipientEmail: "",
                status: "PENDING",
                isRead: false,
              });
            } catch (e) {}
          }
        }
      }
    }

    const repPayoutCents = Math.round(parseFloat(approvedOrder.baseCommissionEarned || "0") * 100);
    const totalOverridePaidCents = totalDirectorOverrideCents + totalAdminOverrideCents + totalAccountingOverrideCents;
    const dynamicProfitCents = totalRackRateCents - repPayoutCents - totalOverridePaidCents;

    const orderUpdates: Record<string, any> = {};
    if (totalRackRateCents > 0) orderUpdates.ironCrestRackRateCents = totalRackRateCents;
    orderUpdates.directorOverrideCents = totalDirectorOverrideCents;
    orderUpdates.adminOverrideCents = totalAdminOverrideCents;
    orderUpdates.accountingOverrideCents = totalAccountingOverrideCents;

    if (dynamicProfitCents < 0 && totalRackRateCents > 0) {
      orderUpdates.ironCrestProfitCents = 0;
      try {
        await storage.createRateIssue({
          salesOrderId: approvedOrder.id,
          type: "CONFLICT_RATE",
          details: `Negative margin detected: rackRate=${totalRackRateCents}c, repPayout=${repPayoutCents}c, directorOverride=${totalDirectorOverrideCents}c, adminOverride=${totalAdminOverrideCents}c, accountingOverride=${totalAccountingOverrideCents}c, computedProfit=${dynamicProfitCents}c`,
        });
      } catch (e) {
        console.error("[generateOverrideEarnings] Failed to create rate issue:", e);
      }
    } else {
      orderUpdates.ironCrestProfitCents = Math.max(0, dynamicProfitCents);
    }

    if (Object.keys(orderUpdates).length > 0) {
      await storage.updateOrder(approvedOrder.id, orderUpdates as any, txDb);
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

function normalizeCustomerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function computeFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function computeRowFingerprint(clientId: string, customerNameNorm: string, saleDate: string, expectedAmountCents: number, serviceType: string): string {
  const data = `${clientId}|${customerNameNorm}|${saleDate}|${expectedAmountCents}|${serviceType}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

function tryAutoDetectColumnMapping(columns: string[], _clientId: string, _storage: any): { customerName: string; repName: string; saleDate: string; serviceType: string; utility: string; status: string; usage: string; rate: string; rejectionReason: string } | null {
  const colLower = columns.map(c => c.toLowerCase().trim());
  const findCol = (patterns: string[]): string => {
    for (const pattern of patterns) {
      const idx = colLower.findIndex(c => c === pattern || c.includes(pattern));
      if (idx >= 0) return columns[idx];
    }
    return '';
  };

  const customerName = findCol(['customer name', 'customer_name', 'customername']);
  const saleDate = findCol(['date sold', 'date_sold', 'datesold', 'sale date', 'sale_date', 'saledate', 'install date']);
  const status = findCol(['status', 'client status', 'client_status']);

  if (!customerName || !saleDate || !status) {
    return null;
  }

  return {
    customerName,
    repName: findCol(['rep name', 'rep_name', 'repname', 'sales rep', 'representative']),
    saleDate,
    serviceType: findCol(['service type', 'service_type', 'servicetype', 'service', 'product']),
    utility: findCol(['utility', 'provider', 'vendor']),
    status,
    usage: findCol(['usage', 'usage units', 'usage_units', 'units']),
    rate: findCol(['rate', 'amount', 'commission', 'price', 'payment']),
    rejectionReason: findCol(['rejection reason', 'rejection_reason', 'reason', 'reject reason']),
  };
}

function extractRepNameFromSheet(rows: any[][]): string | null {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (row && row[0] && typeof row[0] === 'string' && row[0].toLowerCase() === 'name') {
      const val = row[2] || row[1];
      if (val && typeof val === 'string') {
        return val.replace(/^Iron Crest\s*-\s*/i, '').trim();
      }
    }
  }
  return null;
}

function extractRepCodeFromSheet(rows: any[][]): string | null {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (row && row[0] && typeof row[0] === 'string' && row[0].toLowerCase() === 'repcode') {
      const val = row[2] || row[1];
      if (val !== undefined && val !== null) return String(val).split(',')[0].trim();
    }
  }
  return null;
}

function findDataTableInSheet(rows: any[][]): { columns: string[]; rows: any[][] } {
  const knownHeaders = ['customer name', 'service type', 'utility', 'client', 'date sold', 'status', 'usage', 'rate'];
  const masterHeaders = ['repcode', 'account number', 'customer name', 'utility', 'service type', 'date sold', 'status', 'client', 'state', 'usage'];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;

    const cellValues = row.map((c: any) => (c != null ? String(c).toLowerCase().trim() : ''));

    const matchesKnown = knownHeaders.filter(h => cellValues.includes(h)).length;
    const matchesMaster = masterHeaders.filter(h => cellValues.includes(h)).length;

    if (matchesKnown >= 4 || matchesMaster >= 4) {
      const columns = row.map((c: any) => c != null ? String(c).trim() : `Column ${row.indexOf(c)}`);
      const dataRows: any[][] = [];
      for (let j = i + 1; j < rows.length; j++) {
        const dRow = rows[j];
        if (!dRow || dRow.length === 0 || dRow.every((c: any) => c == null || c === '')) break;
        if (dRow[0] && typeof dRow[0] === 'string' && 
            (dRow[0].toLowerCase().includes('chargeback') || dRow[0].toLowerCase().includes('meter chargeback'))) break;
        dataRows.push(dRow);
      }
      return { columns, rows: dataRows };
    }
  }

  if (rows.length > 1 && rows[0] && rows[0].length >= 2) {
    const firstRowHasNums = rows[1]?.some((c: any) => typeof c === 'number');
    if (firstRowHasNums) {
      const columns = rows[0].map((c: any) => c != null ? String(c).trim() : 'Column');
      return { columns, rows: rows.slice(1).filter(r => r && r.length > 0 && !r.every((c: any) => c == null)) };
    }
  }

  return { columns: [], rows: [] };
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
      console.log(`[Login] Attempt for repId: '${repId}'`);
      const user = await storage.getUserByRepId(repId);
      if (!user || user.status !== "ACTIVE") {
        console.log(`[Login] User not found or inactive for repId: '${repId}', found: ${!!user}, status: ${user?.status}`);
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const valid = await comparePassword(password, user.passwordHash);
      if (!valid) {
        console.log(`[Login] Password mismatch for repId: '${repId}'`);
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
        user: { ...user, passwordHash: undefined, onboardingOtpHash: undefined },
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
    res.json({ user: { ...req.user, passwordHash: undefined, onboardingOtpHash: undefined } });
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

  app.get("/api/dashboard/admin-stats", auth, requirePermission("reports:all"), async (req: AuthRequest, res) => {
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

  app.get("/api/my/summary", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!user.repId) return res.status(400).json({ message: "No rep ID associated" });
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      const mtdStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1);
      const personalRepIds = await storage.getRepIdsForScope(user.id, user.role, "personal");
      const mtdMetrics = await storage.getProductionMetrics(personalRepIds, formatDate(mtdStart), formatDate(nyNow));

      const recentOrders = await db.select().from(salesOrders)
        .where(eq(salesOrders.repId, user.repId))
        .orderBy(desc(salesOrders.createdAt))
        .limit(5);

      const payrollReadyOrders = await db.select().from(salesOrders)
        .where(and(
          eq(salesOrders.repId, user.repId),
          sql`${salesOrders.payrollReadyAt} IS NOT NULL`,
          isNull(salesOrders.payRunId)
        ));
      let payrollReadyAmount = 0;
      for (const o of payrollReadyOrders) {
        payrollReadyAmount += parseFloat(o.commissionAmount || "0");
      }

      const activeChargebacks = await db.select().from(chargebacks)
        .where(eq(chargebacks.repId, user.repId))
        .orderBy(desc(chargebacks.createdAt))
        .limit(5);

      const myStatements = await db.select().from(payStatements)
        .where(and(
          eq(payStatements.userId, user.id),
          eq(payStatements.isViewableByRep, true)
        ))
        .orderBy(desc(payStatements.createdAt))
        .limit(1);

      const todayInstalls = await db.select().from(salesOrders)
        .where(and(
          eq(salesOrders.repId, user.repId),
          eq(salesOrders.installDate, formatDate(nyNow)),
          ne(salesOrders.jobStatus, "COMPLETED")
        ));

      const alerts: Array<{ type: string; severity: string; message: string; link?: string }> = [];

      for (const cb of activeChargebacks) {
        if (new Date(cb.createdAt).getTime() > now.getTime() - 30 * 24 * 60 * 60 * 1000) {
          alerts.push({
            type: "chargeback",
            severity: "red",
            message: `Chargeback: $${parseFloat(cb.amount).toFixed(2)} on ${cb.invoiceNumber}`,
            link: "/my-orders"
          });
        }
      }

      for (const inst of todayInstalls) {
        alerts.push({
          type: "install",
          severity: "yellow",
          message: `Install today: ${inst.customerName}`,
          link: "/my-orders"
        });
      }

      if (myStatements.length > 0) {
        const stmt = myStatements[0];
        const stmtAge = now.getTime() - new Date(stmt.createdAt).getTime();
        if (stmtAge < 7 * 24 * 60 * 60 * 1000) {
          alerts.push({
            type: "paystub",
            severity: "blue",
            message: `Pay stub ready: ${stmt.stubNumber}`,
            link: "/my-earnings"
          });
        }
      }

      const connectRate = mtdMetrics.soldCount > 0
        ? Math.round((mtdMetrics.connectedCount / mtdMetrics.soldCount) * 100)
        : 0;

      let reserveInfo = null;
      if (isReserveEligibleRole(user.role)) {
        try {
          const reserve = await getOrCreateReserve(user.id);
          reserveInfo = {
            currentBalance: reserve.currentBalanceCents / 100,
            cap: reserve.capCents / 100,
            status: reserve.status,
            percentFull: reserve.capCents > 0 ? Math.round((reserve.currentBalanceCents / reserve.capCents) * 100) : 0,
          };
        } catch (e) {
          console.error("Failed to load reserve for summary:", e);
        }
      }

      const hour = nyNow.getHours();
      const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

      res.json({
        greeting,
        userName: user.name,
        period: {
          label: nyNow.toLocaleString("en-US", { month: "long", year: "numeric" }),
          startDate: formatDate(mtdStart),
          endDate: formatDate(nyNow),
          soldCount: mtdMetrics.soldCount,
          connectedCount: mtdMetrics.connectedCount,
          connectRate,
          earnedDollars: mtdMetrics.earnedDollars,
          payrollReadyAmount: Math.round(payrollReadyAmount * 100) / 100,
        },
        alerts,
        recentOrders: recentOrders.map(o => ({
          id: o.id,
          invoiceNumber: o.invoiceNumber,
          customerName: o.customerName,
          dateSold: o.dateSold,
          serviceName: o.serviceId,
          approvalStatus: o.approvalStatus,
          jobStatus: o.jobStatus,
          paymentStatus: o.paymentStatus,
          commissionAmount: o.commissionAmount,
        })),
        reserve: reserveInfo,
      });
    } catch (error) {
      console.error("My summary error:", error);
      res.status(500).json({ message: "Failed to get summary" });
    }
  });

  app.get("/api/my/orders", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!user.repId) return res.status(400).json({ message: "No rep ID associated" });
      const { status, page = "1", limit = "20" } = req.query;
      const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

      let conditions = [eq(salesOrders.repId, user.repId)];
      if (status && status !== "all") {
        const statusMap: Record<string, any> = {
          pending: eq(salesOrders.approvalStatus, "PENDING"),
          installed: eq(salesOrders.jobStatus, "COMPLETED"),
          approved: eq(salesOrders.approvalStatus, "APPROVED"),
          payready: isNotNull(salesOrders.payrollReadyAt),
          paid: eq(salesOrders.paymentStatus, "PAID"),
          chargeback: eq(salesOrders.paymentStatus, "CHARGEBACK"),
        };
        if (statusMap[status as string]) {
          conditions.push(statusMap[status as string]);
        }
      }

      const orders = await db.select().from(salesOrders)
        .where(and(...conditions))
        .orderBy(desc(salesOrders.dateSold))
        .limit(parseInt(limit as string))
        .offset(offset);

      const countResult = await db.select({ count: sql<number>`count(*)` }).from(salesOrders)
        .where(and(...conditions));

      res.json({
        orders: orders.map(o => ({
          id: o.id,
          invoiceNumber: o.invoiceNumber,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          customerEmail: o.customerEmail,
          customerAddress: o.customerAddress,
          dateSold: o.dateSold,
          installDate: o.installDate,
          approvalStatus: o.approvalStatus,
          jobStatus: o.jobStatus,
          paymentStatus: o.paymentStatus,
          commissionAmount: o.commissionAmount,
          tvSold: o.tvSold,
          mobileSold: o.mobileSold,
          mobileLinesQty: o.mobileLinesQty,
          payrollReadyAt: o.payrollReadyAt,
          approvedAt: o.approvedAt,
          createdAt: o.createdAt,
        })),
        total: Number(countResult[0]?.count || 0),
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });
    } catch (error) {
      console.error("My orders error:", error);
      res.status(500).json({ message: "Failed to get orders" });
    }
  });

  app.get("/api/my/earnings", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!user.repId) return res.status(400).json({ message: "No rep ID associated" });
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      const mtdStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1);

      const periodOrders = await db.select().from(salesOrders)
        .where(and(
          eq(salesOrders.repId, user.repId),
          gte(salesOrders.dateSold, formatDate(mtdStart)),
          eq(salesOrders.approvalStatus, "APPROVED")
        ));

      let grossCommission = 0;
      for (const o of periodOrders) {
        grossCommission += parseFloat(o.commissionAmount || "0");
      }

      const periodOverrides = await db.select().from(overrideEarnings)
        .where(and(
          eq(overrideEarnings.recipientUserId, user.id),
          eq(overrideEarnings.approvalStatus, "APPROVED"),
          gte(overrideEarnings.createdAt, mtdStart)
        ));
      let overridesEarned = 0;
      for (const oe of periodOverrides) {
        overridesEarned += (oe.amountCents || 0) / 100;
      }

      const periodChargebacks = await db.select().from(chargebacks)
        .where(and(
          eq(chargebacks.repId, user.repId),
          gte(chargebacks.createdAt, mtdStart)
        ));
      let chargebackTotal = 0;
      for (const cb of periodChargebacks) {
        chargebackTotal += parseFloat(cb.amount || "0");
      }

      const monthlyHistory: Array<{ month: string; orders: number; connects: number; netPaid: number }> = [];
      for (let i = 11; i >= 0; i--) {
        const mStart = new Date(nyNow.getFullYear(), nyNow.getMonth() - i, 1);
        const mEnd = new Date(nyNow.getFullYear(), nyNow.getMonth() - i + 1, 0);
        const monthOrders = await db.select().from(salesOrders)
          .where(and(
            eq(salesOrders.repId, user.repId),
            gte(salesOrders.dateSold, formatDate(mStart)),
            sql`${salesOrders.dateSold} <= ${formatDate(mEnd)}`
          ));
        let netPaid = 0;
        let connects = 0;
        for (const o of monthOrders) {
          if (o.paymentStatus === "PAID") netPaid += parseFloat(o.commissionAmount || "0");
          if (o.jobStatus === "COMPLETED") connects++;
        }
        monthlyHistory.push({
          month: mStart.toLocaleString("en-US", { month: "short", year: "numeric" }),
          orders: monthOrders.length,
          connects,
          netPaid: Math.round(netPaid * 100) / 100,
        });
      }

      res.json({
        period: {
          label: nyNow.toLocaleString("en-US", { month: "long", year: "numeric" }),
          startDate: formatDate(mtdStart),
          endDate: formatDate(nyNow),
        },
        currentPeriod: {
          grossCommission: Math.round(grossCommission * 100) / 100,
          overridesEarned: Math.round(overridesEarned * 100) / 100,
          chargebacks: Math.round(chargebackTotal * 100) / 100,
          estimatedNet: Math.round((grossCommission + overridesEarned - chargebackTotal) * 100) / 100,
          orderCount: periodOrders.length,
        },
        monthlyHistory,
      });
    } catch (error) {
      console.error("My earnings error:", error);
      res.status(500).json({ message: "Failed to get earnings" });
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
  app.get("/api/admin/sales-goals", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/sales-goals", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/sales-goals/:id", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
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

  app.delete("/api/admin/sales-goals/:id", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
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
        return { ...member, passwordHash: undefined, onboardingOtpHash: undefined, earnedMTD, orderCount: memberOrders.length };
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
      
      for (const o of createdOrders) {
        scoreAndUpdateOrder(o.id).catch(() => {});
      }

      if (createdOrders.length === 1) {
        res.json(createdOrders[0]);
      } else {
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
      
      scoreAndUpdateOrder(mobileOrder.id).catch(() => {});
      res.json(mobileOrder);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create mobile order" });
    }
  });

  app.get("/api/orders/:id/commission-breakdown", auth, async (req: AuthRequest, res) => {
    try {
      const order = await storage.getOrderById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const user = req.user!;
      if (["REP", "MDU"].includes(user.role) && order.repId !== user.repId) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (user.role === "LEAD") {
        const supervisedReps = await storage.getSupervisedReps(user.id);
        const allowedRepIds = [user.repId, ...supervisedReps.map(r => r.repId)];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      if (user.role === "MANAGER") {
        const scope = await storage.getManagerScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      if (user.role === "EXECUTIVE") {
        const scope = await storage.getExecutiveScope(user.id);
        const allowedRepIds = [user.repId, ...scope.allRepRepIds];
        if (!allowedRepIds.includes(order.repId)) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const lineItems = await storage.getCommissionLineItemsByOrderId(order.id);
      const overrideEarnings = await storage.getOverrideEarningsByOrder(order.id);

      const directorOverride = overrideEarnings
        .filter(e => e.overrideType === "DIRECTOR_OVERRIDE")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
      const adminOverride = overrideEarnings
        .filter(e => e.overrideType === "ADMIN_OVERRIDE")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);
      const accountingOverride = overrideEarnings
        .filter(e => e.overrideType === "ACCOUNTING_OVERRIDE")
        .reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0);

      const rackRate = (order.ironCrestRackRateCents || 0) / 100;
      const repPayout = parseFloat(order.baseCommissionEarned || "0");
      const ironCrestProfit = (order.ironCrestProfitCents || 0) / 100;

      const bundleComponents = lineItems.map(li => ({
        type: li.serviceCategory as "INTERNET" | "VIDEO" | "MOBILE",
        lines: li.quantity || 1,
        unitPayout: parseFloat(li.unitAmount || "0"),
        totalPayout: parseFloat(li.totalAmount || "0"),
      }));

      res.json({
        commissionBreakdown: {
          repRole: order.repRoleAtSale || "REP",
          repPayout,
          directorOverride,
          adminOverride,
          accountingOverride,
          rackRate,
          ironCrestProfit,
          profitMarginPercent: rackRate > 0 ? parseFloat(((ironCrestProfit / rackRate) * 100).toFixed(1)) : 0,
          bundleComponents,
        },
      });
    } catch (error: any) {
      console.error("Commission breakdown error:", error);
      res.status(500).json({ message: "Failed to get commission breakdown" });
    }
  });

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

  
  app.post("/api/admin/orders/:id/mark-paid", auth, requirePermission("orders:edit"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/orders/bulk-mark-paid", auth, requirePermission("orders:edit"), async (req: AuthRequest, res) => {
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
      
      const salesRep = await storage.getUserByRepId(order.repId);
      
      const updates: Record<string, any> = {
        approvalStatus: "APPROVED",
        approvedByUserId: user.id,
        approvedAt: now,
        repRoleAtSale: salesRep?.role || "REP",
      };
      
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
        
        const salesRep = await storage.getUserByRepId(order.repId);
        
        const updates: Record<string, any> = {
          approvalStatus: "APPROVED",
          approvedByUserId: user.id,
          approvedAt: now,
          repRoleAtSale: salesRep?.role || "REP",
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
  
  app.post("/api/admin/orders/import", auth, requirePermission("orders:edit"), upload.single("file"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/users", auth, requirePermission("users:view"), async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users.map(u => ({ ...u, passwordHash: undefined, onboardingOtpHash: undefined })));
    } catch (error) {
      res.status(500).json({ message: "Failed to get users" });
    }
  });

  app.get("/api/users", auth, requirePermission("users:view"), async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users.map(u => ({ ...u, passwordHash: undefined, onboardingOtpHash: undefined })));
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

  app.post("/api/admin/users", auth, requirePermission("users:create"), async (req: AuthRequest, res) => {
    try {
      const { password, name, repId, role, assignedSupervisorId, assignedManagerId, assignedExecutiveId, skipValidation } = req.body;
      if (!password || !name || !repId) {
        return res.status(400).json({ message: "Missing required fields: name, repId, password" });
      }
      
      const userRole = role || "REP";
      
      const creatorRole = req.user!.role;
      const allowedCreators = canCreateRole[userRole];
      if (!allowedCreators || !allowedCreators.includes(creatorRole)) {
        return res.status(403).json({ message: `Your role (${creatorRole}) cannot create users with role ${userRole}` });
      }
      
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
      const user = await storage.createUser({ ...userData, passwordHash, email: req.body.email || null, phone: req.body.phone || null });
      
      // Detailed audit log for hierarchy
      await storage.createAuditLog({ 
        action: "create_user", 
        tableName: "users", 
        recordId: user.id, 
        afterJson: JSON.stringify({ 
          ...user, 
          passwordHash: undefined, onboardingOtpHash: undefined,
          hierarchyAssignments: { 
            supervisorId: user.assignedSupervisorId,
            managerId: user.assignedManagerId,
            executiveId: user.assignedExecutiveId
          }
        }), 
        userId: req.user!.id 
      });

      if (["REP", "LEAD", "MANAGER"].includes(userRole) && req.body.phone) {
        try {
          const { generateAndSendOtp } = await import("./onboarding/otpService");
          await generateAndSendOtp(user.id, req.body.phone, name);
        } catch (otpErr: any) {
          console.error("[Onboarding] Auto OTP send failed (non-fatal):", otpErr.message);
        }
      }

      res.json({ ...user, passwordHash: undefined, onboardingOtpHash: undefined });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create user" });
    }
  });

  app.patch("/api/admin/users/:id", auth, requirePermission("users:edit"), async (req: AuthRequest, res) => {
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
          passwordHash: undefined, onboardingOtpHash: undefined,
          hierarchyAssignments: hierarchyChanged ? { 
            supervisorId: user.assignedSupervisorId,
            managerId: user.assignedManagerId,
            executiveId: user.assignedExecutiveId
          } : undefined
        }), 
        userId: req.user!.id 
      });
      res.json({ ...user, passwordHash: undefined, onboardingOtpHash: undefined });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update user" });
    }
  });

  app.post("/api/admin/users/:id/deactivate", auth, requirePermission("users:deactivate"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const targetUser = await storage.getUserById(id);
      const user = await storage.updateUser(id, { status: "DEACTIVATED" });
      await storage.createAuditLog({ action: "deactivate_user", tableName: "users", recordId: id, userId: req.user!.id });

      if (targetUser && isReserveEligibleRole(targetUser.role)) {
        try {
          await handleRepSeparation(id, "TERMINATED", req.user!.id);
        } catch (sepErr) {
          console.error("Reserve separation on deactivation failed:", sepErr);
        }
      }

      res.json({ ...user, passwordHash: undefined, onboardingOtpHash: undefined });
    } catch (error) {
      res.status(500).json({ message: "Failed to deactivate user" });
    }
  });
  
  app.delete("/api/admin/users/:id", auth, requirePermission("users:edit"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const targetUser = await storage.getUserById(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      if (isReserveEligibleRole(targetUser.role)) {
        try {
          await handleRepSeparation(id, "TERMINATED", req.user!.id);
        } catch (sepErr) {
          console.error("Reserve separation on delete failed:", sepErr);
        }
      }

      const user = await storage.softDeleteUser(id, req.user!.id);
      await storage.createAuditLog({ 
        action: "USER_REMOVED", 
        tableName: "users", 
        recordId: id, 
        beforeJson: JSON.stringify({ ...targetUser, passwordHash: undefined, onboardingOtpHash: undefined }),
        afterJson: JSON.stringify({ ...user, passwordHash: undefined, onboardingOtpHash: undefined }),
        userId: req.user!.id 
      });
      res.json({ success: true, archived: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // Providers - public read for order creation dropdowns, admin for full CRUD
  app.get("/api/admin/providers", auth, requirePermission("admin:providers"), async (req, res) => {
    try { res.json(await storage.getProviders()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/providers", auth, async (req, res) => {
    try { 
      const providers = await storage.getProviders();
      res.json(providers.filter(p => p.active).map(p => ({ id: p.id, name: p.name }))); 
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/providers", auth, requirePermission("admin:providers"), async (req: AuthRequest, res) => {
    try {
      const provider = await storage.createProvider(req.body);
      await storage.createAuditLog({ action: "create_provider", tableName: "providers", recordId: provider.id, afterJson: JSON.stringify(provider), userId: req.user!.id });
      res.json(provider);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/providers/:id", auth, requirePermission("admin:providers"), async (req: AuthRequest, res) => {
    try {
      const provider = await storage.updateProvider(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_provider", tableName: "providers", recordId: req.params.id, afterJson: JSON.stringify(provider), userId: req.user!.id });
      res.json(provider);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.delete("/api/admin/providers/:id", auth, requirePermission("admin:providers"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/clients", auth, requirePermission("admin:clients"), async (req, res) => {
    try { res.json(await storage.getClients()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/clients", auth, async (req, res) => {
    try { 
      const clients = await storage.getClients();
      res.json(clients.filter(c => c.active).map(c => ({ id: c.id, name: c.name }))); 
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/clients", auth, requirePermission("admin:clients"), async (req: AuthRequest, res) => {
    try {
      const client = await storage.createClient(req.body);
      await storage.createAuditLog({ action: "create_client", tableName: "clients", recordId: client.id, afterJson: JSON.stringify(client), userId: req.user!.id });
      res.json(client);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/clients/:id", auth, requirePermission("admin:clients"), async (req: AuthRequest, res) => {
    try {
      const client = await storage.updateClient(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_client", tableName: "clients", recordId: req.params.id, afterJson: JSON.stringify(client), userId: req.user!.id });
      res.json(client);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.delete("/api/admin/clients/:id", auth, requirePermission("admin:clients"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/services", auth, requirePermission("admin:services"), async (req, res) => {
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
  app.post("/api/admin/services", auth, requirePermission("admin:services"), async (req: AuthRequest, res) => {
    try {
      const service = await storage.createService(req.body);
      await storage.createAuditLog({ action: "create_service", tableName: "services", recordId: service.id, afterJson: JSON.stringify(service), userId: req.user!.id });
      res.json(service);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/services/:id", auth, requirePermission("admin:services"), async (req: AuthRequest, res) => {
    try {
      const service = await storage.updateService(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_service", tableName: "services", recordId: req.params.id, afterJson: JSON.stringify(service), userId: req.user!.id });
      res.json(service);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.delete("/api/admin/services/:id", auth, requirePermission("admin:services"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/rate-cards", auth, requirePermission("system:ratecards:view"), async (req, res) => {
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
  app.post("/api/admin/rate-cards", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
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
  app.patch("/api/admin/rate-cards/:id", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
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
  app.delete("/api/admin/rate-cards/:id", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/rate-cards/:id/lead-overrides", auth, requirePermission("system:ratecards:view"), async (req, res) => {
    try {
      res.json(await storage.getRateCardLeadOverrides(req.params.id));
    } catch (error) { res.status(500).json({ message: "Failed to get lead overrides" }); }
  });
  
  app.post("/api/admin/rate-cards/:id/lead-overrides", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
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
  
  app.delete("/api/admin/rate-cards/:rateCardId/lead-overrides/:id", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteRateCardLeadOverride(req.params.id);
      await storage.createAuditLog({ action: "delete_lead_override", tableName: "rate_card_lead_overrides", recordId: req.params.id, userId: req.user!.id });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to delete lead override" }); }
  });

  // Rate Card Role Overrides
  app.get("/api/admin/rate-cards/:id/role-overrides", auth, requirePermission("system:ratecards:view"), async (req, res) => {
    try {
      res.json(await storage.getRateCardRoleOverrides(req.params.id));
    } catch (error) { res.status(500).json({ message: "Failed to get role overrides" }); }
  });
  
  app.post("/api/admin/rate-cards/:id/role-overrides", auth, requirePermission("system:ratecards:edit"), async (req: AuthRequest, res) => {
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
        isAdditive: ro.isAdditive === true,
      }));
      await storage.saveRateCardRoleOverrides(req.params.id, validatedOverrides);
      await storage.createAuditLog({ action: "update_role_overrides", tableName: "rate_card_role_overrides", recordId: req.params.id, userId: req.user!.id, afterJson: JSON.stringify(validatedOverrides) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to save role overrides" }); }
  });

  // Incentives
  app.get("/api/admin/incentives", auth, requirePermission("admin:incentives"), async (req, res) => {
    try { res.json(await storage.getIncentives()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/incentives", auth, requirePermission("admin:incentives"), async (req: AuthRequest, res) => {
    try {
      const incentive = await storage.createIncentive(req.body);
      await storage.createAuditLog({ action: "create_incentive", tableName: "incentives", recordId: incentive.id, afterJson: JSON.stringify(incentive), userId: req.user!.id });
      res.json(incentive);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });
  app.patch("/api/admin/incentives/:id", auth, requirePermission("admin:incentives"), async (req: AuthRequest, res) => {
    try {
      const incentive = await storage.updateIncentive(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_incentive", tableName: "incentives", recordId: req.params.id, afterJson: JSON.stringify(incentive), userId: req.user!.id });
      res.json(incentive);
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed" }); }
  });

  // Override Agreements
  app.get("/api/admin/overrides", auth, requirePermission("admin:overrides:manage"), async (req, res) => {
    try { res.json(await storage.getOverrideAgreements()); } catch (error) { res.status(500).json({ message: "Failed to fetch override agreements" }); }
  });
  app.post("/api/admin/overrides", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
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
  app.patch("/api/admin/overrides/:id", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
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
  app.delete("/api/admin/overrides/:id", auth, requirePermission("admin:overrides:manage"), async (req: AuthRequest, res) => {
    try {
      const override = await storage.updateOverrideAgreement(req.params.id, { active: false });
      await storage.createAuditLog({ action: "soft_delete_override_agreement", tableName: "override_agreements", recordId: req.params.id, afterJson: JSON.stringify(override), userId: req.user!.id });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ message: error.message || "Failed to delete override agreement" }); }
  });

  // Pay Runs
  app.get("/api/admin/payruns", auth, requirePermission("admin:payruns:manage"), async (req, res) => {
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
  app.post("/api/admin/payruns", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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
  app.delete("/api/admin/payruns/:id", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/payruns/:id/submit-review", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payruns/:id/submit-approval", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payruns/:id/approve", auth, requirePermission("admin:payruns:approve"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payruns/:id/reject", auth, requirePermission("admin:payruns:approve"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/payruns/:id/variance", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payruns/:id/finalize", auth, requirePermission("financial:finalize:payruns"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/payruns/:id", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payruns/:id/link-orders", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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
  
  app.post("/api/admin/payruns/:id/link-all-orders", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payruns/:id/unlink-orders", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
    try {
      const { orderIds } = req.body;
      if (!orderIds?.length) return res.status(400).json({ message: "No orders to unlink" });
      
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      if (payRun.status !== "DRAFT") return res.status(400).json({ message: "Can only unlink orders from DRAFT pay runs" });
      
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

  app.get("/api/admin/payruns/:id/cash-projection", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.id);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });

      const linkedOrders = await storage.getOrdersByPayRunId(req.params.id);
      const payRunTotalCents = linkedOrders.reduce((sum, o) => sum + Math.round(parseFloat(o.baseCommissionEarned || "0") * 100), 0);

      const overrideTotal = await db.select({
        total: sql<string>`COALESCE(SUM(CAST("amount" AS DECIMAL) * 100), 0)`,
      }).from(overrideEarnings).where(and(eq(overrideEarnings.payRunId, req.params.id), eq(overrideEarnings.approvalStatus, "APPROVED")));
      const overrideCents = parseInt(overrideTotal[0]?.total || "0");

      const totalOutgoing = payRunTotalCents + overrideCents;

      const openAr = await db.select({
        clientId: arExpectations.clientId,
        expectedCents: sql<string>`SUM("ar_expectations"."expected_amount_cents")`,
        actualCents: sql<string>`SUM("ar_expectations"."actual_amount_cents")`,
        avgDays: sql<string>`AVG(EXTRACT(EPOCH FROM (NOW() - "ar_expectations"."created_at")) / 86400)::int`,
      }).from(arExpectations)
        .where(sql`"ar_expectations"."status" IN ('OPEN', 'PARTIAL')`)
        .groupBy(arExpectations.clientId);

      const clientsList = await storage.getClients();
      const clientMap = new Map(clientsList.map((c: any) => [c.id, c.name]));

      const arPipeline = openAr.map(ar => {
        const expectedCents = parseInt(ar.expectedCents || "0");
        const actualCents = parseInt(ar.actualCents || "0");
        const remaining = expectedCents - actualCents;
        const avgDays = parseInt(ar.avgDays || "0");
        const probability = avgDays <= 15 ? 90 : avgDays <= 30 ? 70 : avgDays <= 45 ? 50 : avgDays <= 60 ? 30 : 10;
        const expectedDate = new Date();
        expectedDate.setDate(expectedDate.getDate() + Math.max(0, 30 - avgDays));
        return {
          clientName: clientMap.get(ar.clientId) || "Unknown",
          remainingCents: remaining,
          probability,
          expectedDate: expectedDate.toISOString().split("T")[0],
        };
      }).filter(a => a.remainingCents > 0).sort((a, b) => b.remainingCents - a.remainingCents);

      const totalIncomingCents = arPipeline.reduce((sum, a) => sum + Math.round(a.remainingCents * (a.probability / 100)), 0);
      const projectedNet = totalIncomingCents - totalOutgoing;

      res.json({
        payRunTotalCents,
        overrideCents,
        totalOutgoingCents: totalOutgoing,
        arPipeline: arPipeline.slice(0, 10),
        totalIncomingCents,
        projectedNetCents: projectedNet,
        isHealthy: projectedNet >= 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/payruns/unlinked-orders", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
    try {
      const weekEndingDate = req.query.weekEndingDate as string | undefined;
      const orders = await storage.getOrders();
      
      let unlinked = orders.filter(o => 
        o.jobStatus === "COMPLETED" && 
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
  app.get("/api/admin/override-pool", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/override-pool/total", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
    try {
      const total = await storage.getPendingPoolTotal();
      res.json({ total });
    } catch (error) { res.status(500).json({ message: "Failed to fetch pool total" }); }
  });

  // Override Distribution Management (Manual Distribution)
  app.get("/api/admin/payruns/:id/override-pool", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/payruns/:id/distributions", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payruns/:id/distributions", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
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

  app.delete("/api/admin/payruns/:payRunId/distributions/:id", auth, requirePermission("admin:overridepool"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/accounting/export-approved", auth, requirePermission("admin:export:approved"), async (req: AuthRequest, res) => {
    try {
      const { reexport } = req.body;
      const orders = reexport ? await storage.getAllApproved() : await storage.getApprovedUnexported();
      if (orders.length === 0) {
        return res.status(400).json({ message: reexport ? "No approved orders to export" : "No new orders to export" });
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
        
        // Get commission line items for TV commission
        const commissionLines = await storage.getCommissionLineItemsByOrderId(o.id);
        const tvCommission = commissionLines
          .filter((line: any) => line.serviceCategory === "VIDEO")
          .reduce((sum: number, line: any) => sum + parseFloat(line.totalAmount || "0"), 0);
        
        // Get mobile line items for mobile quantity and commission
        const mobileLines = await storage.getMobileLineItemsByOrderId(o.id);
        const mobileQuantitySold = mobileLines.length;
        const mobileCommission = mobileLines
          .reduce((sum: number, line: any) => sum + parseFloat(line.commissionAmount || "0"), 0);
        
        // Calculate overall combined commission (Base + TV + Mobile)
        const combinedCommission = baseCommission + tvCommission + mobileCommission;
        
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
          "User Name": user?.name || "",
          "Customer Name": o.customerName || "",
          "Account #": o.accountNumber || "",
          "House #/Bldg": o.houseNumber || "",
          "Street": o.streetName || "",
          "Apt/Unit": o.aptUnit || "",
          "City": o.city || "",
          "Zip Code": o.zipCode || "",
          "Address": o.customerAddress || "",
          "Date Sold": formatDate(o.dateSold),
          "Install Date": formatDate(o.installDate),
          "Install Type": o.installType ? (typeLabels[o.installType] || o.installType) : "",
          "Base Commission": baseCommission.toFixed(2),
          "TV Commission": tvCommission.toFixed(2),
          "Mobile Qty Sold": mobileQuantitySold.toString(),
          "Mobile Commission": mobileCommission.toFixed(2),
          "Combined Commission": combinedCommission.toFixed(2),
          "Incentive": incentive.toFixed(2),
          "Gross Commission": grossCommission.toFixed(2),
          "Override": totalOverrideDeduction.toFixed(2),
          "Net Commission": netCommission.toFixed(2),
          "Client": o.client?.name || "",
          "Provider": o.provider?.name || "",
        };
      }));

      const csv = stringify(csvData, { header: true });
      await storage.createAuditLog({ action: "export_accounting", tableName: "sales_orders", afterJson: JSON.stringify({ count: orders.length, batchId: batch.id }), userId: req.user!.id });
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="export-${new Date().toISOString().split("T")[0]}.csv"`);
      res.send(csv);
    } catch (error) { res.status(500).json({ message: "Export failed" }); }
  });

  app.post("/api/admin/accounting/import-payments", auth, requirePermission("admin:import:payments"), upload.single("file"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/chargebacks/import", auth, requirePermission("admin:import:chargebacks"), upload.single("file"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/recalculate-commissions", auth, requirePermission("admin:recalculate"), async (req: AuthRequest, res) => {
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
          
          const updatedOrder = await storage.updateOrder(order.id, {
            baseCommissionEarned: baseCommission,
            appliedRateCardId,
            calcAt: new Date(),
            overrideDeduction: totalDeductions.toFixed(2),
          });
          
          // Cascade to AR expectation
          try {
            const arExp = await storage.getArExpectationByOrderId(order.id);
            if (arExp) {
              const nb = parseFloat(updatedOrder.baseCommissionEarned || "0");
              const ni = parseFloat(updatedOrder.incentiveEarned || "0");
              const no = parseFloat(updatedOrder.overrideDeduction || "0");
              const expCents = Math.round((nb + ni + no) * 100);
              const varCents = arExp.actualAmountCents - expCents;
              await storage.updateArExpectation(arExp.id, {
                expectedAmountCents: expCents,
                varianceAmountCents: varCents,
                hasVariance: varCents !== 0,
              });
            }
          } catch (arErr) {
            console.error("[BulkRecalc] AR cascade error for order", order.id, arErr);
          }

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
  app.get("/api/admin/reports/summary", auth, requirePermission("reports:all"), async (req: AuthRequest, res) => {
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
      const completedOrders = orders.filter((o: SalesOrder) => o.jobStatus === "COMPLETED").length;
      const pendingOrders = orders.filter((o: SalesOrder) => o.jobStatus === "PENDING").length;
      
      const totalEarned = orders
        .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
      
      const totalPaid = orders
        .filter((o: SalesOrder) => o.paymentStatus === "PAID")
        .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.commissionPaid), 0);

      const repPerformance = users
        .filter((u: User) => ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role))
        .map((rep: User) => {
          const repOrders = orders.filter((o: SalesOrder) => o.repId === rep.repId);
          const repEarned = repOrders
            .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
            .reduce((sum: number, o: SalesOrder) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
          return {
            repId: rep.repId,
            name: rep.name,
            role: rep.role,
            orderCount: repOrders.length,
            approvedCount: repOrders.filter((o: SalesOrder) => o.jobStatus === "COMPLETED").length,
            totalEarned: repEarned,
          };
        })
        .filter((r: { orderCount: number }) => r.orderCount > 0)
        .sort((a: { totalEarned: number }, b: { totalEarned: number }) => b.totalEarned - a.totalEarned);

      const providerBreakdown = providers.map((provider: Provider) => {
        const providerOrders = orders.filter((o: SalesOrder) => o.providerId === provider.id);
        const earned = providerOrders
          .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
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
          .filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
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
        if (order.jobStatus === "COMPLETED") {
          acc[month].earned += parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned);
        }
        return acc;
      }, {} as Record<string, { month: string; orders: number; earned: number }>);

      res.json({
        summary: {
          totalOrders,
          completedOrders,
          pendingOrders,
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
  app.get("/api/admin/accounting/export-batches", auth, requirePermission("admin:export:approved"), async (req, res) => {
    try {
      const batches = await storage.getExportBatches();
      res.json(batches);
    } catch (error) { res.status(500).json({ message: "Failed to get export batches" }); }
  });

  app.get("/api/admin/accounting/export-batches/:id", auth, requirePermission("admin:export:approved"), async (req, res) => {
    try {
      const batch = await storage.getExportBatchById(req.params.id);
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      const orders = await storage.getOrdersByExportBatch(req.params.id);
      res.json({ batch, orders });
    } catch (error) { res.status(500).json({ message: "Failed to get export batch" }); }
  });

  app.delete("/api/admin/accounting/export-batches/:id", auth, requirePermission("admin:export:approved"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteExportBatch(req.params.id);
      await storage.createAuditLog({ action: "delete_export_batch", tableName: "export_batches", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Export batch deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete export batch" }); }
  });

  app.get("/api/admin/accounting/exported-orders", auth, requirePermission("admin:export:approved"), async (req, res) => {
    try {
      const orders = await storage.getExportedOrders();
      res.json(orders);
    } catch (error) { res.status(500).json({ message: "Failed to get exported orders" }); }
  });

  // Operations Center - Aggregated Exception Queue
  app.get("/api/ops/exceptions", auth, requireRoles("OPERATIONS", "ADMIN", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const [unmatchedPayments, unmatchedChargebacks, rateIssues, orderExceptions] = await Promise.all([
        storage.getUnmatchedPayments(),
        storage.getUnmatchedChargebacks(),
        storage.getRateIssues(),
        storage.getOrderExceptions(),
      ]);

      const exceptions: any[] = [];

      for (const p of unmatchedPayments as any[]) {
        exceptions.push({
          id: p.id, type: "UNMATCHED_PAYMENT", severity: "HIGH",
          title: "Unmatched Payment",
          description: `Payment of $${parseFloat(p.amount || "0").toFixed(2)} could not be matched to an order`,
          details: p, createdAt: p.createdAt,
        });
      }
      for (const c of unmatchedChargebacks as any[]) {
        exceptions.push({
          id: c.id, type: "UNMATCHED_CHARGEBACK", severity: "HIGH",
          title: "Unmatched Chargeback",
          description: `Chargeback of $${parseFloat(c.amount || "0").toFixed(2)} could not be matched`,
          details: c, createdAt: c.createdAt,
        });
      }
      for (const r of rateIssues as any[]) {
        exceptions.push({
          id: r.id, type: "RATE_ISSUE", severity: r.type === "MISSING_RATE" ? "URGENT" : "MEDIUM",
          title: r.type === "MISSING_RATE" ? "Missing Rate Card" : "Rate Conflict",
          description: r.details || "Rate card issue detected",
          details: r, createdAt: r.createdAt, orderId: r.salesOrderId,
        });
      }
      for (const e of orderExceptions as any[]) {
        const order = await storage.getOrderById(e.salesOrderId);
        exceptions.push({
          id: e.id, type: "ORDER_EXCEPTION", severity: "HIGH",
          title: "Flagged Order",
          description: `${order?.customerName || "Unknown"} - ${e.reason}`,
          details: { ...e, invoiceNumber: order?.invoiceNumber },
          createdAt: e.createdAt, orderId: e.salesOrderId,
        });
      }

      // Check for overdue approvals
      const pendingOrders = await db.select({
        id: salesOrders.id,
        customerName: salesOrders.customerName,
        invoiceNumber: salesOrders.invoiceNumber,
        repId: salesOrders.repId,
        completionDate: salesOrders.completionDate,
        createdAt: salesOrders.createdAt,
        baseCommissionEarned: salesOrders.baseCommissionEarned,
      }).from(salesOrders)
        .where(sql`"sales_orders"."job_status" = 'COMPLETED' AND "sales_orders"."approved_at" IS NULL AND "sales_orders"."approval_status" != 'REJECTED'`);
      for (const o of pendingOrders) {
        const completedAt = o.completionDate ? new Date(o.completionDate) : new Date(o.createdAt);
        const daysPending = Math.floor((Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24));
        if (daysPending >= 3) {
          exceptions.push({
            id: `approval-overdue-${o.id}`, type: "APPROVAL_OVERDUE", severity: daysPending >= 5 ? "URGENT" : "HIGH",
            title: "Order Approval Overdue",
            description: `${o.customerName} - waiting ${daysPending} days for approval`,
            details: { orderId: o.id, invoiceNumber: o.invoiceNumber, repId: o.repId, daysPending,
              estimatedCommission: o.baseCommissionEarned ? parseFloat(o.baseCommissionEarned) : 0 },
            createdAt: completedAt.toISOString(), orderId: o.id,
          });
        }
      }

      exceptions.sort((a, b) => {
        const sevOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3);
      });

      res.json({ exceptions, counts: {
        urgent: exceptions.filter(e => e.severity === "URGENT").length,
        high: exceptions.filter(e => e.severity === "HIGH").length,
        medium: exceptions.filter(e => e.severity === "MEDIUM").length,
      }});
    } catch (error) {
      console.error("Failed to get ops exceptions:", error);
      res.status(500).json({ message: "Failed to get exceptions" });
    }
  });

  // Operations Center - Activity Summary
  app.get("/api/ops/activity-summary", auth, requireRoles("OPERATIONS", "ADMIN", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];

      const todayOrders = await db.select({ count: sql<number>`count(*)` }).from(salesOrders)
        .where(sql`"sales_orders"."created_at"::date = ${today}::date`);

      const pendingApprovals = await db.select({ count: sql<number>`count(*)` }).from(salesOrders)
        .where(sql`"sales_orders"."job_status" = 'COMPLETED' AND "sales_orders"."approved_at" IS NULL`);

      const autoApproved = await db.select({ count: sql<number>`count(*)` }).from(salesOrders)
        .where(sql`"sales_orders"."approved_at"::date = ${today}::date`);

      // Install sync info
      const lastSync = await db.select().from(installSyncRuns)
        .orderBy(desc(installSyncRuns.createdAt)).limit(1);

      // Finance import info
      const pendingImports = await db.select({ count: sql<number>`count(*)` }).from(financeImports)
        .where(or(eq(financeImports.status, "IMPORTED"), eq(financeImports.status, "MAPPED")));

      const unmatchedRows = await db.select({ count: sql<number>`count(*)` }).from(financeImportRows)
        .where(eq(financeImportRows.matchStatus, "UNMATCHED"));

      res.json({
        today: {
          ordersSubmitted: Number(todayOrders[0]?.count || 0),
          approvalsPending: Number(pendingApprovals[0]?.count || 0),
          autoApprovals: Number(autoApproved[0]?.count || 0),
          manualReviewNeeded: Number(pendingApprovals[0]?.count || 0),
        },
        installSync: lastSync[0] ? {
          lastRun: lastSync[0].createdAt,
          matched: lastSync[0].matchedCount || 0,
          approved: lastSync[0].approvedCount || 0,
          unmatched: lastSync[0].unmatchedCount || 0,
        } : null,
        financeImports: {
          pendingImports: Number(pendingImports[0]?.count || 0),
          unmatchedRows: Number(unmatchedRows[0]?.count || 0),
        },
      });
    } catch (error) {
      console.error("Failed to get ops activity summary:", error);
      res.status(500).json({ message: "Failed to get activity summary" });
    }
  });

  // Exception Queues
  app.get("/api/admin/queues/unmatched-payments", auth, requirePermission("exceptions:all"), async (req, res) => {
    try { res.json(await storage.getUnmatchedPayments()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/unmatched-chargebacks", auth, requirePermission("exceptions:all"), async (req, res) => {
    try { res.json(await storage.getUnmatchedChargebacks()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.get("/api/admin/queues/rate-issues", auth, requirePermission("exceptions:all"), async (req, res) => {
    try { res.json(await storage.getRateIssues()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });
  app.post("/api/admin/queues/:type/:id/resolve", auth, requirePermission("admin:queues:resolve"), async (req: AuthRequest, res) => {
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
      } else if (type === "order-exceptions") {
        result = await storage.resolveOrderException(id, req.user!.id, resolutionNote);
      }
      await storage.createAuditLog({ action: `resolve_${type}`, tableName: type.replace(/-/g, "_"), recordId: id, afterJson: JSON.stringify(result), userId: req.user!.id });
      res.json(result);
    } catch (error) { res.status(500).json({ message: "Failed to resolve" }); }
  });

  // Order Exceptions (flagged orders)
  app.get("/api/admin/queues/order-exceptions", auth, requirePermission("exceptions:all"), async (req, res) => {
    try {
      const exceptions = await storage.getOrderExceptions();
      const enriched = await Promise.all(exceptions.map(async (exc: any) => {
        const order = await storage.getOrderById(exc.salesOrderId);
        const flagger = await storage.getUser(exc.flaggedByUserId);
        return {
          ...exc,
          invoiceNumber: order?.invoiceNumber || null,
          customerName: order?.customerName || null,
          repId: order?.repId || null,
          flaggedByName: flagger?.name || null,
        };
      }));
      res.json(enriched);
    } catch (error) { res.status(500).json({ message: "Failed" }); }
  });

  app.post("/api/orders/:id/flag", auth, async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      const user = req.user!;
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ message: "Reason is required" });
      }
      const order = await storage.getOrderById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      // REP and MDU can only flag their own orders
      if (["REP", "MDU"].includes(user.role) && order.repId !== user.repId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const exception = await storage.createOrderException({
        salesOrderId: req.params.id,
        reason,
        flaggedByUserId: req.user!.id,
      });
      await storage.createAuditLog({ action: "flag_order", tableName: "order_exceptions", recordId: exception.id, afterJson: JSON.stringify(exception), userId: req.user!.id });
      res.json(exception);
    } catch (error) { res.status(500).json({ message: "Failed to flag order" }); }
  });

  // Audit Log
  app.get("/api/admin/audit", auth, requirePermission("audit:view"), async (req, res) => {
    try { res.json(await storage.getAuditLogs()); } catch (error) { res.status(500).json({ message: "Failed" }); }
  });

  // Leads - accessible by all authenticated users for their own leads
  app.get("/api/leads", auth, async (req: AuthRequest, res) => {
    try {
      const { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName, viewRepId, customerName, disposition, page: pageStr, limit: limitStr } = req.query as {
        zipCode?: string;
        street?: string;
        city?: string;
        dateFrom?: string;
        dateTo?: string;
        houseNumber?: string;
        streetName?: string;
        viewRepId?: string;
        customerName?: string;
        disposition?: string;
        page?: string;
        limit?: string;
      };
      const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(limitStr || "50", 10) || 50));
      
      // Determine which rep's leads to fetch
      let targetRepId = req.user!.repId;
      const canViewOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      
      // Handle "All Team" option - fetch leads from all visible reps
      let leads: Awaited<ReturnType<typeof storage.getLeadsByRepId>> = [];
      
      if (viewRepId === "__all_team__" && canViewOthers) {
        // Fetch leads from all team members
        const users = await storage.getUsers();
        const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
        const callerId = req.user!.id;
        
        // Collect repIds that this user can view
        const visibleRepIds: string[] = [];
        for (const u of users) {
          if (u.deletedAt || u.status !== "ACTIVE" || !u.repId) continue;
          
          if (req.user!.role === "LEAD") {
            // LEAD sees self and direct reports
            if (u.id === callerId || u.assignedSupervisorId === callerId) {
              visibleRepIds.push(u.repId);
            }
          } else {
            // MANAGER+ sees users at or below their level
            const userLevel = ROLE_HIERARCHY[u.role] || 0;
            if (userLevel <= callerLevel) {
              visibleRepIds.push(u.repId);
            }
          }
        }
        
        // Fetch leads for all visible reps
        const allLeads = await storage.getAllLeadsForReporting({ zipCode, city, dateFrom, dateTo, houseNumber, streetName, customerName, disposition });
        leads = allLeads.filter(l => visibleRepIds.includes(l.repId));
      } else if (viewRepId && canViewOthers) {
        // Verify caller can view this rep's leads
        const users = await storage.getUsers();
        const targetUser = users.find(u => u.repId === viewRepId && !u.deletedAt);
        if (targetUser) {
          const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
          const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
          
          // For LEAD role: can only view direct reports or self
          if (req.user!.role === "LEAD") {
            const isDirectReport = targetUser.assignedSupervisorId === req.user!.id;
            const isSelf = targetUser.id === req.user!.id;
            if (isSelf || isDirectReport) {
              targetRepId = viewRepId;
            }
          } else if (targetLevel <= callerLevel) {
            // For MANAGER+: use role hierarchy
            targetRepId = viewRepId;
          }
        }
        leads = await storage.getLeadsByRepId(targetRepId, { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName, customerName, disposition });
      } else {
        leads = await storage.getLeadsByRepId(targetRepId, { zipCode, street, city, dateFrom, dateTo, houseNumber, streetName, customerName, disposition });
      }
      
      // When LEAD+ is viewing another rep's leads, include SOLD/REJECTED leads
      // Otherwise filter them out (for own leads view)
      if (!viewRepId || !canViewOthers) {
        leads = leads.filter(l => !["SOLD", "REJECT"].includes(l.disposition || ""));
      }
      
      const total = leads.length;
      const totalPages = Math.ceil(total / limit);
      const offset = (page - 1) * limit;
      const paginatedLeads = leads.slice(offset, offset + limit);
      
      res.json({ leads: paginatedLeads, total, page, totalPages, limit });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });
  
  // Get lead counts per rep for LEAD+ roles
  app.get("/api/leads/counts", auth, async (req: AuthRequest, res) => {
    try {
      const canViewOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      if (!canViewOthers) {
        return res.status(403).json({ message: "Only supervisors and above can view lead counts" });
      }
      
      const users = await storage.getUsers();
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const callerId = req.user!.id;
      
      // Get all leads
      const allLeads = await storage.getAllLeadsForReporting({});
      
      // Helper to check if a user is in the caller's org tree
      const isInOrgTree = (userId: string, visited = new Set<string>()): boolean => {
        if (visited.has(userId)) return false;
        visited.add(userId);
        const u = users.find(x => x.id === userId);
        if (!u) return false;
        if (u.id === callerId) return true;
        if (u.assignedSupervisorId) return isInOrgTree(u.assignedSupervisorId, visited);
        if (u.assignedManagerId) return isInOrgTree(u.assignedManagerId, visited);
        return false;
      };
      
      // Count leads per rep for users visible to caller
      const counts: { repId: string; name: string; role: string; count: number }[] = [];
      
      for (const user of users) {
        if (user.deletedAt || user.status !== "ACTIVE" || !user.repId) continue;
        
        // For LEAD role: show self and direct reports only
        if (req.user!.role === "LEAD") {
          const isDirectReport = user.assignedSupervisorId === callerId;
          const isSelf = user.id === callerId;
          if (!isSelf && !isDirectReport) continue;
        } else {
          // For MANAGER+: use role hierarchy and org tree
          const userLevel = ROLE_HIERARCHY[user.role] || 0;
          if (userLevel > callerLevel) continue;
        }
        
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

  // Get Sales Pipeline data - disposition funnel for MANAGER+ and OPERATIONS
  app.get("/api/leads/pipeline", auth, async (req: AuthRequest, res) => {
    try {
      const allowedRoles = ["MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"];
      if (!allowedRoles.includes(req.user!.role)) {
        return res.status(403).json({ message: "Only managers and above can view sales pipeline" });
      }
      
      const users = await storage.getUsers();
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      
      // Get all leads
      const allLeads = await storage.getAllLeadsForReporting({});
      
      // Filter to leads from users at or below caller's level
      const accessibleLeads = allLeads.filter(lead => {
        const leadOwner = users.find(u => u.repId === lead.repId);
        if (!leadOwner) return false;
        const ownerLevel = ROLE_HIERARCHY[leadOwner.role] || 0;
        return ownerLevel <= callerLevel;
      });
      
      // Aggregate by disposition
      const dispositionCounts: Record<string, number> = {};
      for (const lead of accessibleLeads) {
        const dispo = lead.disposition || "NONE";
        dispositionCounts[dispo] = (dispositionCounts[dispo] || 0) + 1;
      }
      
      // Aggregate by rep with disposition breakdown
      const repData: Record<string, { repId: string; name: string; role: string; dispositions: Record<string, number>; total: number }> = {};
      for (const lead of accessibleLeads) {
        const rep = users.find(u => u.repId === lead.repId);
        if (!rep) continue;
        
        if (!repData[lead.repId]) {
          repData[lead.repId] = {
            repId: lead.repId,
            name: rep.name,
            role: rep.role,
            dispositions: {},
            total: 0,
          };
        }
        
        const dispo = lead.disposition || "NONE";
        repData[lead.repId].dispositions[dispo] = (repData[lead.repId].dispositions[dispo] || 0) + 1;
        repData[lead.repId].total++;
      }
      
      // Calculate conversion metrics
      const totalLeads = accessibleLeads.length;
      const soldCount = dispositionCounts["SOLD"] || 0;
      const negotiationCount = dispositionCounts["NEGOTIATION"] || 0;
      const returnCount = dispositionCounts["RETURN"] || 0;
      const rejectCount = dispositionCounts["DOOR_SLAM_REJECT"] || 0;
      
      res.json({
        totalLeads,
        dispositionCounts,
        repBreakdown: Object.values(repData).sort((a, b) => b.total - a.total),
        metrics: {
          conversionRate: totalLeads > 0 ? ((soldCount / totalLeads) * 100).toFixed(1) : "0.0",
          negotiationRate: totalLeads > 0 ? ((negotiationCount / totalLeads) * 100).toFixed(1) : "0.0",
          returnRate: totalLeads > 0 ? ((returnCount / totalLeads) * 100).toFixed(1) : "0.0",
          rejectRate: totalLeads > 0 ? ((rejectCount / totalLeads) * 100).toFixed(1) : "0.0",
        },
      });
    } catch (error) {
      console.error("Sales pipeline error:", error);
      res.status(500).json({ message: "Failed to fetch sales pipeline data" });
    }
  });

  // Create a single lead (EXECUTIVE, OPERATIONS, ADMIN only)
  app.post("/api/leads", auth, async (req: AuthRequest, res) => {
    try {
      const { 
        repId: requestedRepId, customerName, houseNumber, aptUnit, streetName, street, 
        city, state, zipCode, customerPhone, customerEmail, accountNumber, 
        customerStatus, discoReason, notes 
      } = req.body;
      
      const canAssignToOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
      const repId = canAssignToOthers && requestedRepId ? requestedRepId : req.user!.repId;
      
      const users = await storage.getUsers();
      const targetUser = users.find(u => u.repId === repId && !u.deletedAt && u.status === "ACTIVE");
      if (!targetUser) {
        return res.status(400).json({ message: `Rep '${repId}' not found` });
      }
      
      const lead = await storage.createLead({
        repId,
        customerName: customerName || null,
        houseNumber: houseNumber || null,
        aptUnit: aptUnit || null,
        streetName: streetName || null,
        street: street || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        customerPhone: customerPhone || null,
        customerEmail: customerEmail || null,
        accountNumber: accountNumber || null,
        customerStatus: customerStatus || null,
        discoReason: discoReason || null,
        notes: notes || null,
        customerAddress: null,
        importedBy: req.user!.id,
        disposition: "NONE",
      });
      
      res.status(201).json(lead);
    } catch (error) {
      console.error("Create lead error:", error);
      res.status(500).json({ message: "Failed to create lead" });
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
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "LEAD"].includes(req.user!.role);
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

  // Reverse disposition (LEAD+ only) - clears SOLD/REJECT status
  app.patch("/api/leads/:id/reverse-disposition", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // Only LEAD+ can reverse dispositions
      const canReverse = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
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

  // Assign/reassign a lead to another user (LEAD+ only)
  app.patch("/api/leads/:id/assign", auth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { targetRepId } = req.body;
      
      if (!targetRepId) {
        return res.status(400).json({ message: "targetRepId is required" });
      }
      
      // Only LEAD+ can assign leads to others
      const canAssign = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(req.user!.role);
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

  // Get lead pool - all leads with filtering and pagination (LEAD+ for all, REP for own)
  app.get("/api/leads/pool", auth, async (req: AuthRequest, res) => {
    try {
      const { repId, disposition, search, hasNotes, page, limit } = req.query;
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "LEAD"].includes(req.user!.role);
      
      const filters: { repId?: string; disposition?: string; search?: string; hasNotes?: boolean; page?: number; limit?: number } = {
        disposition: typeof disposition === "string" ? disposition : undefined,
        search: typeof search === "string" ? search : undefined,
        hasNotes: hasNotes === "true",
        page: typeof page === "string" ? parseInt(page, 10) : 1,
        limit: typeof limit === "string" ? Math.min(parseInt(limit, 10), 100) : 50, // Max 100 per page
      };
      
      // REPs can only see their own leads, LEAD+ can see all or filter by rep
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
      
      // REP can only see history for own leads, LEAD+ can see all
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "LEAD"].includes(req.user!.role);
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
  // LEAD+ can use ?targetRepId=X to import leads for another user
  app.post("/api/leads/import", auth, (req: AuthRequest, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        console.error("Multer upload error:", err);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
        }
        return res.status(400).json({ message: err.message || "File upload failed" });
      }
      next();
    });
  }, async (req: AuthRequest, res) => {
    try {
      console.log(`[Leads Import] User ${req.user?.repId} uploading file: ${req.file?.originalname} (${req.file?.size} bytes)`);
      // Validate file upload
      const validation = validateFileUpload(req.file, res);
      if (!validation.valid) return;
      
      const workbook = validation.workbook;
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const knownLeadColumns = [
        "bld no", "bld no.", "bldg no", "bldg no.", "building no", "building number",
        "house number", "housenumber", "house #", "house no", "street no", "street number",
        "addr1", "address 1", "address1", "address", "full address",
        "street", "street name", "streetname",
        "apt", "apt.", "apt #", "apartment", "unit", "unit #", "suite", "ste",
        "addr2", "address 2", "address2",
        "city", "state", "zip", "zipcode", "zip code",
        "customer name", "customername", "name", "customer",
        "account", "account number", "accountnumber", "account no", "account #", "acct",
        "phone", "customer phone", "customerphone", "telephone",
        "email", "customer email", "customeremail",
        "status", "customer status", "customerstatus",
        "rep", "repid", "rep_id", "rep id",
        "disco reason", "discoreason",
        "notes",
      ];

      let rows: Record<string, any>[];
      let headerRowOffset = 0;

      const hasEmptyColumns = (parsedRows: Record<string, any>[]): boolean => {
        if (parsedRows.length === 0) return false;
        const allKeys = new Set<string>();
        for (const r of parsedRows) { for (const k of Object.keys(r)) { allKeys.add(k); } }
        return Array.from(allKeys).some(k => k.startsWith("__EMPTY"));
      };

      const hasKnownColumns = (parsedRows: Record<string, any>[]): boolean => {
        if (parsedRows.length === 0) return false;
        const allKeys = new Set<string>();
        for (const r of parsedRows) { for (const k of Object.keys(r)) { allKeys.add(k.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()); } }
        return knownLeadColumns.some(kc => allKeys.has(kc));
      };

      rows = XLSX.utils.sheet_to_json(sheet, { blankrows: false }) as Record<string, any>[];

      if (hasEmptyColumns(rows) || !hasKnownColumns(rows)) {
        for (let skip = 1; skip <= 5; skip++) {
          const retryRows = XLSX.utils.sheet_to_json(sheet, { blankrows: false, range: skip }) as Record<string, any>[];
          if (retryRows.length > 0 && !hasEmptyColumns(retryRows) && hasKnownColumns(retryRows)) {
            rows = retryRows;
            headerRowOffset = skip;
            console.log(`[Leads Import] Detected ${skip} title row(s) before header row, re-parsed starting at row ${skip + 1}`);
            break;
          }
          if (retryRows.length > 0 && !hasEmptyColumns(retryRows)) {
            rows = retryRows;
            headerRowOffset = skip;
            console.log(`[Leads Import] Skipped ${skip} title row(s), using row ${skip + 1} as header (no known columns matched but no __EMPTY columns)`);
            break;
          }
        }
      }

      if (rows.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }
      
      // Validate row count
      if (!validateRowCount(rows, res)) return;

      const allHeaderKeys = new Set<string>();
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          allHeaderKeys.add(key);
        }
      }
      const totalColumnCount = allHeaderKeys.size;

      const errors: string[] = [];
      let success = 0;
      let failed = 0;
      let skipped = 0;

      // Get users for validation
      const users = await storage.getUsers();
      const currentUser = req.user!;
      const isRep = currentUser.role === "REP";
      const canAssignToOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(currentUser.role);
      
      // Check for targetRepId query parameter (LEAD+ only)
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

      console.log(`[Leads Import] Total rows parsed from Excel: ${rows.length}, total columns detected: ${totalColumnCount}`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        // Skip rows that are completely empty (no filled cells at all)
        const filledCount = Object.values(row).filter(v => {
          const s = v?.toString().trim();
          return s && s.length > 0;
        }).length;
        if (filledCount === 0) {
          skipped++;
          continue;
        }

        try {
          // Determine repId for this lead:
          // 1. If targetRepId is provided (LEAD+ importing for specific user), use it
          // 2. If REP, always use their own repId
          // 3. Otherwise, use from file or default to current user's repId
          let repId: string;
          
          if (targetRepId) {
            // LEAD+ importing for a specific user - all leads go to that user
            repId = targetRepId;
          } else if (isRep) {
            // REPs can only import leads for themselves
            repId = currentUser.repId;
          } else {
            // Non-REPs: check file for repId or default to their own
            repId = getRowValue(row, "repId", "rep_id", "RepId", "Rep ID") || currentUser.repId;
          }

          // Address fields - houseNumber, aptUnit, and streetName, or combined address/street
          let houseNumber = getRowValue(row, 
            "houseNumber", "house_number", "House Number", "HouseNumber", "House #",
            "Bld No.", "Bld No", "BldNo", "Bld#", "Bld #",
            "Bldg No.", "Bldg No", "BldgNo", "Bldg#", "Bldg #",
            "Building No.", "Building No", "Building Number", "Building #",
            "Address No", "Address Number", "Street No", "Street Number"
          );
          let aptUnit = getRowValue(row, "apt", "Apt", "Apt.", "Apt #", "Apartment", "Unit", "Unit #", "Suite", "Ste", "Basement", "Bsmt", "apt_unit", "aptUnit",
            "ADDR2", "Addr2", "addr2", "Address 2", "Address2"
          );
          
          let streetName = getRowValue(row, "streetName", "street_name", "Street Name", "StreetName");
          const customerAddress = getRowValue(row, "customerAddress", "customer_address", "Address", "Full Address");
          const street = getRowValue(row, "street", "Street");
          const addr1 = getRowValue(row, "ADDR1", "Addr1", "addr1", "Address 1", "Address1");
          const customerName = getRowValue(row, "customerName", "customer_name", "Customer Name", "Name", "Customer");
          
          // Skip rows that have no meaningful lead data (no address AND no customer name)
          if (!houseNumber && !streetName && !customerAddress && !street && !addr1 && !customerName) {
            skipped++;
            continue;
          }
          
          // Parse ADDR1-style combined street address (e.g., "101 W 147TH ST")
          if (!houseNumber && !streetName && addr1) {
            const fullAddr = addr1.trim();
            const match = fullAddr.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
            if (match) {
              houseNumber = match[1];
              streetName = match[2];
            } else {
              streetName = fullAddr;
            }
          }
          
          // Parse ADDR2 for apartment - strip "APT" prefix if present
          if (aptUnit) {
            aptUnit = aptUnit.replace(/^(APT\.?|APARTMENT|UNIT|STE\.?|SUITE)\s*/i, "").trim();
          }
          
          // If no separate fields, try to parse from combined address
          if (!houseNumber && !streetName && (customerAddress || street)) {
            const fullAddr = (customerAddress || street).trim();
            let match = fullAddr.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
            if (match) {
              houseNumber = match[1];
              streetName = match[2];
            } else {
              match = fullAddr.match(/^(.+)\s+(\d+[A-Za-z]?)$/);
              if (match) {
                streetName = match[1];
                houseNumber = match[2];
              } else {
                streetName = fullAddr;
              }
            }
          }
          
          if (!houseNumber && !streetName && !customerAddress && !street && !addr1) {
            errors.push(`Row ${rowNum}: Missing address (houseNumber/streetName or address required)`);
            failed++;
            continue;
          }
          const customerPhone = getRowValue(row, "customerPhone", "customer_phone", "Phone", "Phone Number", "Telephone");
          const customerEmail = getRowValue(row, "customerEmail", "customer_email", "Email", "E-mail");
          let city = getRowValue(row, "city", "City");
          let state = getRowValue(row, "state", "State");
          let zipCode = getRowValue(row, "zipCode", "zip_code", "Zip", "Zip Code", "ZIP", "Postal Code");
          const notes = getRowValue(row, "notes", "Notes", "Comments");
          
          // Parse ADDR3 for combined city/state/zip (e.g., "NEW YORK, NY 10039-436")
          if (!city && !state && !zipCode) {
            const addr3 = getRowValue(row, "ADDR3", "Addr3", "addr3", "Address 3", "Address3", "City State Zip", "CityStateZip");
            if (addr3) {
              const cityStateZipMatch = addr3.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{1,4})?)$/i);
              if (cityStateZipMatch) {
                city = cityStateZipMatch[1].trim();
                state = cityStateZipMatch[2].trim().toUpperCase();
                zipCode = cityStateZipMatch[3].trim();
              } else {
                const cityStateMatch = addr3.match(/^(.+?),\s*([A-Z]{2})$/i);
                if (cityStateMatch) {
                  city = cityStateMatch[1].trim();
                  state = cityStateMatch[2].trim().toUpperCase();
                } else {
                  city = addr3;
                }
              }
            }
          }
          
          // Additional fields from file
          const accountNumber = getRowValue(row, "accountNumber", "account_number", "Account Number", "Account No", "Account #", "Account", "Acct", "Acct No", "Acct #",
            "ACCOUNT", "ACCOUNT#", "ACCOUNT #", "ACCT", "ACCT#", "ACCT #");
          const customerStatus = getRowValue(row, "customerStatus", "customer_status", "Customer Status", "Status", "Cust Status",
            "STAT", "Stat");
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

      console.log(`[Leads Import] Results: ${success} imported, ${failed} failed, ${skipped} empty rows skipped, ${rows.length} total rows parsed`);

      // Audit log
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "leads_import",
        tableName: "leads",
        afterJson: JSON.stringify({ success, failed, skipped, totalRows: rows.length }),
      });

      res.json({ success, failed, skipped, errors: errors.slice(0, 20) });
    } catch (error: any) {
      console.error("Lead import error:", error);
      res.status(500).json({ message: error.message || "Failed to import leads" });
    }
  });

  async function saveLeadExportToStorage(buffer: Buffer, filename: string): Promise<string | null> {
    try {
      const privateDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateDir) return null;
      const parts = privateDir.replace(/^\//, "").split("/");
      const bucketName = parts[0];
      const prefix = parts.slice(1).join("/");
      const objectName = `${prefix}/lead-exports/${filename}`;
      const { objectStorageClient } = await import("./replit_integrations/object_storage");
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      await file.save(buffer, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      console.log(`[Leads] Export saved to object storage: ${objectName}`);
      return objectName;
    } catch (err) {
      console.error("[Leads] Failed to save export to object storage:", err);
      return null;
    }
  }

  async function generateLeadExportBuffer(leadsToExport: any[]): Promise<Buffer> {
    const users = await storage.getUsers();
    const getUserName = (userId: string) => users.find(u => u.id === userId)?.name || userId;
    const getRepName = (rid: string | null) => {
      if (!rid) return "";
      const user = users.find(u => u.repId === rid);
      return user ? `${user.name} (${rid})` : rid;
    };
    const buildAddress = (lead: any) => {
      if (lead.customerAddress) return lead.customerAddress;
      const parts = [lead.houseNumber, lead.street, lead.streetName, lead.aptUnit, lead.city, lead.state].filter(Boolean);
      return parts.join(" ");
    };

    const leadsData = leadsToExport.map(lead => ({
      "Lead ID": lead.id,
      "Customer Name": lead.customerName || "",
      "Phone": lead.customerPhone || "",
      "Email": lead.customerEmail || "",
      "Address": buildAddress(lead),
      "Zip Code": lead.zipCode || "",
      "Last Disposition": lead.disposition || "NONE",
      "Disposition Date": lead.dispositionAt ? new Date(lead.dispositionAt).toISOString() : "",
      "Rep ID": lead.repId || "",
      "Rep Name": getRepName(lead.repId),
      "Notes": lead.notes || "",
      "Pipeline Stage": lead.pipelineStage || "",
      "Lost Reason": lead.lostReason || "",
      "Lost Notes": lead.lostNotes || "",
      "Follow-Up Notes": lead.followUpNotes || "",
      "Contact Attempts": lead.contactAttempts || 0,
      "Imported At": lead.importedAt ? new Date(lead.importedAt).toISOString() : "",
      "Created At": lead.createdAt ? new Date(lead.createdAt).toISOString() : "",
    }));

    const leadIds = leadsToExport.map(l => l.id);
    const allHistory = await storage.getLeadDispositionHistoryBulk(leadIds);

    const historyData = allHistory.map(h => {
      const lead = leadsToExport.find(l => l.id === h.leadId);
      return {
        "Lead ID": h.leadId,
        "Customer Name": lead?.customerName || "",
        "Previous Disposition": h.previousDisposition || "NONE",
        "New Disposition": h.disposition,
        "Changed By": getUserName(h.changedByUserId || ""),
        "Notes": h.notes || "",
        "Changed At": h.createdAt ? new Date(h.createdAt).toISOString() : "",
      };
    });

    const wb = XLSX.utils.book_new();
    const leadsWs = XLSX.utils.json_to_sheet(leadsData);
    XLSX.utils.book_append_sheet(wb, leadsWs, "Deleted Leads");

    if (historyData.length > 0) {
      const historyWs = XLSX.utils.json_to_sheet(historyData);
      XLSX.utils.book_append_sheet(wb, historyWs, "Disposition History");
    }

    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }

  // Export leads before deletion - generates XLSX with lead data, disposition history, and notes
  app.post("/api/leads/export-for-delete", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { ids, mode, importDate, importedBy, repId, dateFrom, dateTo } = req.body;
      let leadsToExport: any[] = [];

      if (mode === "ids" && ids && Array.isArray(ids) && ids.length > 0) {
        leadsToExport = await storage.getLeadsByIds(ids);
      } else if (mode === "sort" && importDate && repId) {
        const allLeads = await storage.getAllLeadsForAdmin();
        const importTime = new Date(importDate).getTime();
        leadsToExport = allLeads.filter(l => {
          if (l.repId !== repId) return false;
          const leadImportTime = new Date(l.importedAt).getTime();
          return Math.abs(leadImportTime - importTime) < 60000;
        });
      } else if (mode === "by-user" && repId) {
        const allLeads = await storage.getAllLeadsForAdmin();
        leadsToExport = allLeads.filter(l => l.repId === repId);
      } else if (mode === "by-date" && dateFrom && dateTo) {
        const allLeads = await storage.getAllLeadsForAdmin();
        const from = new Date(dateFrom).getTime();
        const to = new Date(dateTo + "T23:59:59").getTime();
        leadsToExport = allLeads.filter(l => {
          const t = new Date(l.importedAt).getTime();
          return t >= from && t <= to;
        });
      } else if (mode === "all") {
        leadsToExport = await storage.getAllLeadsForAdmin();
      } else {
        return res.status(400).json({ message: "Invalid export mode or missing parameters" });
      }

      if (leadsToExport.length === 0) {
        return res.status(404).json({ message: "No leads found to export" });
      }

      const buffer = await generateLeadExportBuffer(leadsToExport);

      await storage.createAuditLog({
        action: "lead_export_before_delete",
        tableName: "leads",
        recordId: "bulk",
        userId: req.user!.id,
        afterJson: JSON.stringify({
          mode,
          leadsExported: leadsToExport.length,
        }),
      });

      res.setHeader("Content-Disposition", `attachment; filename="deleted-leads-export-${new Date().toISOString().split("T")[0]}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error: any) {
      console.error("Lead export-for-delete error:", error);
      res.status(500).json({ message: error.message || "Failed to export leads" });
    }
  });

  // Admin delete leads by date range (auto-exports before deletion)
  app.delete("/api/admin/leads/by-date", auth, requirePermission("admin:leads:manage"), async (req: AuthRequest, res) => {
    try {
      const { dateFrom, dateTo } = req.query;
      if (!dateFrom || !dateTo) {
        return res.status(400).json({ message: "dateFrom and dateTo required" });
      }
      const allLeads = await storage.getAllLeadsForAdmin();
      const from = new Date(dateFrom as string).getTime();
      const to = new Date(dateTo + "T23:59:59").getTime();
      const leadsToDelete = allLeads.filter(l => {
        const t = new Date(l.importedAt).getTime();
        return t >= from && t <= to;
      });

      const count = await storage.deleteLeadsByDateRange(dateFrom as string, dateTo as string);
      await storage.createAuditLog({ 
        action: "bulk_delete_leads", 
        tableName: "leads", 
        afterJson: JSON.stringify({ dateFrom, dateTo, count }),
        userId: req.user!.id 
      });
      res.json({ message: `Deleted ${count} leads`, count });

      if (leadsToDelete.length > 0) {
        const userId = req.user!.id;
        setImmediate(async () => {
          try {
            const exportBuffer = await generateLeadExportBuffer(leadsToDelete);
            const filename = `deleted-leads-by-date-${dateFrom}-to-${dateTo}-${Date.now()}.xlsx`;
            const storagePath = await saveLeadExportToStorage(exportBuffer, filename);
            await storage.createAuditLog({
              action: "lead_export_before_delete",
              tableName: "leads",
              recordId: "bulk",
              userId,
              afterJson: JSON.stringify({ mode: "by-date", dateFrom, dateTo, leadsExported: leadsToDelete.length, storagePath: storagePath || "local-only" }),
            });
          } catch (err) {
            console.error("Background lead export failed (by-date):", err);
          }
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Admin delete all leads (auto-exports before deletion)
  app.delete("/api/admin/leads/all", auth, requirePermission("admin:leads:manage"), async (req: AuthRequest, res) => {
    try {
      const allLeads = await storage.getAllLeadsForAdmin();

      const count = await storage.deleteAllLeads();
      await storage.createAuditLog({ 
        action: "delete_all_leads", 
        tableName: "leads", 
        afterJson: JSON.stringify({ count }),
        userId: req.user!.id 
      });
      res.json({ message: `Deleted ${count} leads`, count });

      if (allLeads.length > 0) {
        const userId = req.user!.id;
        setImmediate(async () => {
          try {
            const exportBuffer = await generateLeadExportBuffer(allLeads);
            const filename = `deleted-leads-all-${Date.now()}.xlsx`;
            const storagePath = await saveLeadExportToStorage(exportBuffer, filename);
            await storage.createAuditLog({
              action: "lead_export_before_delete",
              tableName: "leads",
              recordId: "bulk",
              userId,
              afterJson: JSON.stringify({ mode: "all", leadsExported: allLeads.length, storagePath: storagePath || "local-only" }),
            });
          } catch (err) {
            console.error("Background lead export failed (all):", err);
          }
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete leads" });
    }
  });

  // Admin fix leads with building numbers in wrong position (street suffix)
  app.post("/api/admin/leads/fix-addresses", auth, requirePermission("admin:leads:manage"), async (req: AuthRequest, res) => {
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
  app.delete("/api/admin/leads/:id", auth, requirePermission("admin:leads:manage"), async (req: AuthRequest, res) => {
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

  // Get import sorts/batches for leads management
  app.get("/api/leads/sorts", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { viewRepId } = req.query as { viewRepId?: string };
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const users = await storage.getUsers();
      
      let repIdFilter: string | undefined;
      
      if (viewRepId && viewRepId !== "__all_team__") {
        repIdFilter = viewRepId;
      } else if (!["ADMIN", "OPERATIONS"].includes(req.user!.role) && viewRepId !== "__all_team__") {
        repIdFilter = req.user!.repId;
      }
      
      const sorts = await storage.getLeadImportSorts(repIdFilter);
      
      // Filter by visibility based on role
      const visibleSorts = sorts.filter(s => {
        const owner = users.find(u => u.repId === s.repId);
        if (!owner) return true;
        if (req.user!.role === "LEAD") {
          return owner.id === req.user!.id || owner.assignedSupervisorId === req.user!.id;
        }
        const ownerLevel = ROLE_HIERARCHY[owner.role] || 0;
        return ownerLevel <= callerLevel;
      });
      
      // Enrich with user names
      const enriched = visibleSorts.map(s => {
        const importer = users.find(u => u.id === s.importedBy);
        const rep = users.find(u => u.repId === s.repId);
        return {
          ...s,
          importerName: importer ? `${importer.firstName} ${importer.lastName}` : "Unknown",
          repName: rep ? `${rep.firstName} ${rep.lastName}` : s.repId,
        };
      });
      
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch import sorts" });
    }
  });

  // Delete all leads in a specific import sort/batch
  app.post("/api/leads/sort-delete", auth, leadOrAbove, async (req: AuthRequest, res) => {
    try {
      const { importDate, importedBy, repId } = req.body;
      if (!importDate || !repId) {
        return res.status(400).json({ message: "importDate and repId are required" });
      }
      
      // Verify caller has permission for this rep's leads
      const users = await storage.getUsers();
      const callerLevel = ROLE_HIERARCHY[req.user!.role] || 0;
      const targetUser = users.find(u => u.repId === repId);
      
      if (targetUser) {
        const targetLevel = ROLE_HIERARCHY[targetUser.role] || 0;
        if (req.user!.role === "LEAD") {
          const isDirectReport = targetUser.assignedSupervisorId === req.user!.id;
          const isSelf = targetUser.id === req.user!.id;
          if (!isSelf && !isDirectReport) {
            return res.status(403).json({ message: "Not authorized to delete these leads" });
          }
        } else if (targetLevel > callerLevel) {
          return res.status(403).json({ message: "Not authorized to delete these leads" });
        }
      }
      
      const deleted = await storage.softDeleteLeadsBySort(importDate, importedBy || null, repId, req.user!.id);
      res.json({ deleted: deleted.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete sort" });
    }
  });

  // Bulk soft delete leads (LEAD+)
  // Enforces hierarchy: caller can only delete leads owned by users at or below their role level
  app.post("/api/leads/bulk-delete", auth, leadOrAbove, async (req: AuthRequest, res) => {
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
        
        if (req.user!.role === "LEAD") {
          const isSelf = leadOwner?.id === req.user!.id;
          const isDirectReport = leadOwner?.assignedSupervisorId === req.user!.id;
          if (!isSelf && !isDirectReport) {
            deniedIds.push(leadId);
            continue;
          }
        } else if (ownerLevel > callerLevel) {
          deniedIds.push(leadId);
          continue;
        }
        allowedIds.push(leadId);
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
  app.delete("/api/leads/by-user/:repId", auth, requirePermission("admin:leads:manage"), async (req: AuthRequest, res) => {
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

  // Bulk assign leads to a different rep (LEAD+)
  // Enforces hierarchy: caller can only assign leads owned by users at or below their role level
  // and can only assign to users at or below their role level
  app.post("/api/leads/bulk-assign", auth, leadOrAbove, async (req: AuthRequest, res) => {
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
        
        if (req.user!.role === "LEAD") {
          const isSelf = leadOwner?.id === req.user!.id;
          const isDirectReport = leadOwner?.assignedSupervisorId === req.user!.id;
          if (!isSelf && !isDirectReport) {
            deniedIds.push(leadId);
            continue;
          }
        } else if (ownerLevel > callerLevel) {
          deniedIds.push(leadId);
          continue;
        }
        allowedIds.push(leadId);
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
  app.get("/api/pipeline/funnel", auth, leadOrAbove, async (req: AuthRequest, res) => {
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
  app.get("/api/pipeline/aging", auth, leadOrAbove, async (req: AuthRequest, res) => {
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
  app.get("/api/pipeline/win-loss", auth, leadOrAbove, async (req: AuthRequest, res) => {
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
      const viewMode = req.query.viewMode as string | undefined; // "own", "team", "global" for EXECUTIVE
      const isRep = user.role === "REP";
      
      // Get orders based on role and viewMode
      let ordersToQuery: SalesOrder[];
      if (user.role === "EXECUTIVE" && viewMode === "global") {
        ordersToQuery = await storage.getOrders();
      } else if (user.role === "EXECUTIVE" && viewMode === "team") {
        const scope = await storage.getExecutiveScope(user.id);
        const teamRepIds = [...scope.allRepRepIds, user.repId];
        ordersToQuery = await storage.getOrders({ teamRepIds });
      } else {
        ordersToQuery = await storage.getOrders();
      }
      
      // For "own" view or default behavior, filter to user's own orders
      // For "own" view, filter to user's own orders only; for team/global, include all from the queried set
      const allOrders = ordersToQuery;
      const showGlobalOrTeam = (user.role === "EXECUTIVE" && (viewMode === "global" || viewMode === "team")) ||
                               user.role === "ADMIN" || user.role === "OPERATIONS";
      const myOrders = showGlobalOrTeam
        ? allOrders.filter((o: SalesOrder) => o.jobStatus === "COMPLETED")
        : allOrders.filter((o: SalesOrder) => o.repId === user.repId && o.jobStatus === "COMPLETED");
      
      // Batch fetch all commission line items in a single query
      const allLineItems = await storage.getCommissionLineItemsByOrderIds(myOrders.map(o => o.id));
      const lineItemsByOrder: Record<string, any[]> = {};
      for (const item of allLineItems) {
        if (!lineItemsByOrder[item.salesOrderId]) lineItemsByOrder[item.salesOrderId] = [];
        lineItemsByOrder[item.salesOrderId].push(item);
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
      
      // Get pending orders (not yet completed but still active) based on view mode
      const pendingOrders = showGlobalOrTeam
        ? allOrders.filter((o: SalesOrder) => 
            o.jobStatus !== "COMPLETED" && o.jobStatus !== "CANCELED"
          )
        : allOrders.filter((o: SalesOrder) => 
            o.repId === user.repId && 
            o.jobStatus !== "COMPLETED" &&
            o.jobStatus !== "CANCELED"
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
  // viewMode is optional and only applies to EXECUTIVE users: "own" | "team" | "global"
  async function applyRoleBasedOrderFilter(orders: SalesOrder[], user: User, viewMode?: string): Promise<{ filteredOrders: SalesOrder[]; scopeInfo: { role: string; scopeDescription: string; repCount: number } }> {
    let filteredOrders = orders;
    let scopeDescription = "All data";
    let repCount = 0;
    
    if (user.role === "REP") {
      filteredOrders = orders.filter(o => o.repId === user.repId);
      scopeDescription = "Your personal data";
      repCount = 1;
    } else if (user.role === "LEAD") {
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
      // EXECUTIVE users can switch between own/team/global views
      if (viewMode === "own") {
        filteredOrders = orders.filter(o => o.repId === user.repId);
        scopeDescription = "Your personal sales";
        repCount = 1;
      } else if (viewMode === "global") {
        const allUsers = await storage.getUsers();
        const salesReps = allUsers.filter(u => ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role) && !u.deletedAt);
        scopeDescription = `Company-wide (${salesReps.length} total sales reps)`;
        repCount = salesReps.length;
        // No filtering - show all orders
      } else {
        // Default to "team" - their organizational tree
        const scope = await storage.getExecutiveScope(user.id);
        filteredOrders = orders.filter(o => scope.allRepRepIds.includes(o.repId));
        scopeDescription = `Your division (${scope.managerIds.length} managers, ${scope.allRepRepIds.length} total reps)`;
        repCount = scope.allRepRepIds.length;
      }
    } else if (user.role === "ADMIN" || user.role === "OPERATIONS") {
      const allUsers = await storage.getUsers();
      const salesReps = allUsers.filter(u => ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role) && !u.deletedAt);
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
      const { viewMode } = req.query;
      const user = req.user!;
      const now = new Date();
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        const approvedOrders = orderSet.filter(o => o.jobStatus === "COMPLETED");
        
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
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
      // Filter by date range (using dateSold)
      const periodOrders = orders.filter(o => {
        const orderDate = new Date(o.dateSold);
        return orderDate >= start && orderDate < end;
      });
      
      const totalOrders = periodOrders.length;
      const completedOrders = periodOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const approvedOrders = periodOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const pendingOrders = periodOrders.filter(o => o.jobStatus === "PENDING").length;
      
      const totalEarned = periodOrders
        .filter(o => o.jobStatus === "COMPLETED")
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
        .filter(o => o.jobStatus === "COMPLETED")
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
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const users = await storage.getUsers();
      const { filteredOrders: orders, scopeInfo } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        if (order.jobStatus === "COMPLETED") {
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
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const providers = await storage.getProviders();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        if (order.jobStatus === "COMPLETED") {
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
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const services = await storage.getServices();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        if (order.jobStatus === "COMPLETED") {
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
      const { period = "this_month", startDate, endDate, groupBy = "day", viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        if (order.jobStatus === "COMPLETED") {
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
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      const allOrders = await storage.getOrders({});
      const users = await storage.getUsers();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        if (order.jobStatus === "COMPLETED") {
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

  // Team Production Report - For LEAD+ to view team leader production (within their scope)
  app.get("/api/reports/team-production", auth, async (req: AuthRequest, res) => {
    try {
      const { period = "this_month", startDate, endDate } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      // REPs cannot access this report - need LEAD or higher
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
          ["EXECUTIVE", "MANAGER", "LEAD"].includes(u.role) && !u.deletedAt
        );
      } else if (user.role === "EXECUTIVE") {
        // Show managers and supervisors under this executive
        userScope = await storage.getExecutiveScope(user.id);
        teamLeaders = allUsers.filter(u => 
          (["MANAGER", "LEAD"].includes(u.role) && !u.deletedAt) &&
          (userScope.managerIds?.includes(u.id) || userScope.supervisorIds?.includes(u.id))
        );
        // Also include self
        teamLeaders.unshift(user);
      } else if (user.role === "MANAGER") {
        // Show supervisors under this manager
        userScope = await storage.getManagerScope(user.id);
        teamLeaders = allUsers.filter(u => 
          u.role === "LEAD" && !u.deletedAt && userScope.supervisorIds?.includes(u.id)
        );
        // Also include self
        teamLeaders.unshift(user);
      } else if (user.role === "LEAD") {
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
        } else if (leader.role === "LEAD") {
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
      const roleOrder = { EXECUTIVE: 0, MANAGER: 1, LEAD: 2 };
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
        .filter(u => !u.deletedAt && ["REP", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role))
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
      
      // Bulk fetch all leads for the period across all reps
      const allLeads = await storage.getAllLeadsForReporting({
        dateFrom: start.toISOString().split("T")[0],
        dateTo: end.toISOString().split("T")[0],
      });
      const leadsByRepId = new Map<string, typeof allLeads>();
      for (const lead of allLeads) {
        if (!leadsByRepId.has(lead.repId)) leadsByRepId.set(lead.repId, []);
        leadsByRepId.get(lead.repId)!.push(lead);
      }
      
      for (const repId of scopedRepIds) {
        const repUser = allUsers.find(u => u.repId === repId && !u.deletedAt);
        if (!repUser) continue;
        
        const repOrders = periodOrders.filter(o => o.repId === repId);
        const ordersSold = repOrders.length;
        const ordersConnected = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const ordersPending = repOrders.filter(o => o.jobStatus === "PENDING").length;
        const ordersApproved = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
        
        const earned = repOrders
          .filter(o => o.jobStatus === "COMPLETED")
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const paid = repOrders
          .filter(o => o.paidDate)
          .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);
        
        const mobileLines = repOrders.reduce((sum, o) => sum + (o.mobileLinesQty || 0), 0);
        const tvSold = repOrders.filter(o => o.tvSold).length;
        const internetSold = repOrders.length - tvSold;
        
        const avgOrderValue = ordersSold > 0 ? earned / ordersConnected || 0 : 0;
        const approvalRate = ordersSold > 0 ? (ordersApproved / ordersSold) * 100 : 0;
        const connectionRate = ordersSold > 0 ? (ordersConnected / ordersSold) * 100 : 0;
        
        const repLeads = leadsByRepId.get(repId) || [];
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
      
      // ADMIN, OPERATIONS, and EXECUTIVE can see all override earnings
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
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
        .filter(u => ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN"].includes(u.role) && !u.deletedAt)
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
      const { period = "this_month", startDate, endDate, type = "provider", viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const providers = await storage.getProviders();
      const clients = await storage.getClients();
      const rateCards = await storage.getRateCards();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        if (order.jobStatus !== "COMPLETED") continue;
        
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
        
        const baseEarned = parseFloat(order.baseCommissionEarned) || 0;
        const incentiveEarned = parseFloat(order.incentiveEarned || "0") || 0;
        const overrideDeduction = parseFloat(order.overrideDeduction || "0") || 0;
        const totalCommissionCost = baseEarned + incentiveEarned;
        
        // Placeholder until actual MRC data is tracked
        const estimatedRevenue = totalCommissionCost * REVENUE_MULTIPLIER;
        
        entityStats[entityId].orders++;
        entityStats[entityId].revenue += estimatedRevenue;
        entityStats[entityId].commissionCost += totalCommissionCost;
        entityStats[entityId].overrideCost += overrideDeduction;
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
      const { period = "this_month", startDate, endDate, viewMode } = req.query;
      const { start, end } = getDateRange(period as string, startDate as string, endDate as string);
      const user = req.user!;
      
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const allOrders = await storage.getOrders({});
      const services = await storage.getServices();
      const providers = await storage.getProviders();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);
      
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
        if (order.jobStatus !== "COMPLETED") continue;
        
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
        
        const baseEarned = parseFloat(order.baseCommissionEarned) || 0;
        const incentiveEarned = parseFloat(order.incentiveEarned || "0") || 0;
        const overrideDeduction = parseFloat(order.overrideDeduction || "0") || 0;
        const totalCommission = baseEarned + incentiveEarned;
        
        serviceStats[serviceId].orders++;
        serviceStats[serviceId].baseCommission += baseEarned;
        serviceStats[serviceId].incentiveCommission += incentiveEarned;
        serviceStats[serviceId].overrideCommission += overrideDeduction;
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
      const providerBreakdown: Record<string, { name: string; orders: number; totalCommission: number; percentOfTotal: number }> = {};
      for (const order of periodOrders) {
        if (order.jobStatus !== "COMPLETED") continue;
        const provider = providers.find(p => p.id === order.providerId);
        if (!providerBreakdown[order.providerId]) {
          providerBreakdown[order.providerId] = {
            name: provider?.name || "Unknown",
            orders: 0,
            totalCommission: 0,
            percentOfTotal: 0,
          };
        }
        providerBreakdown[order.providerId].orders++;
        providerBreakdown[order.providerId].totalCommission += 
          (parseFloat(order.baseCommissionEarned) || 0) + (parseFloat(order.incentiveEarned || "0") || 0);
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

  app.get("/api/reports/sales-tracker", auth, requirePermission("reports:production"), async (req: AuthRequest, res) => {
    try {
      const { viewMode, view } = req.query;
      const user = req.user!;
      const now = new Date();

      const allowedGlobal = ["ADMIN", "OPERATIONS", "EXECUTIVE"];
      const allOrders = await storage.getOrders({});
      const allUsers = await storage.getUsers();
      const allServices = await storage.getServices();

      let effectiveViewMode = viewMode as string | undefined;
      if (allowedGlobal.includes(user.role) && !effectiveViewMode) {
        effectiveViewMode = "global";
      }
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, effectiveViewMode);

      const dow = now.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      const thisWeekEnd = new Date(thisWeekStart);
      thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(thisWeekStart);

      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(thisMonthStart);
      const priorMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const priorMonthEnd = new Date(lastMonthStart);

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(todayStart);

      const inRange = (o: any, s: Date, e: Date) => {
        const d = new Date(o.dateSold);
        return d >= s && d < e;
      };

      const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const getWeekLabel = (d: Date) => {
        const m = d.toLocaleString("default", { month: "short" });
        return `${m} ${d.getDate()}`;
      };

      const repIds = [...new Set(orders.map(o => o.repId))];
      const trackerData = repIds.map(repId => {
        const repUser = allUsers.find(u => u.repId === repId && !u.deletedAt);
        const repOrders = orders.filter(o => o.repId === repId);

        const todayOrders = repOrders.filter(o => inRange(o, todayStart, todayEnd));
        const yesterdayOrders = repOrders.filter(o => inRange(o, yesterdayStart, yesterdayEnd));
        const tw = repOrders.filter(o => inRange(o, thisWeekStart, thisWeekEnd));
        const lw = repOrders.filter(o => inRange(o, lastWeekStart, lastWeekEnd));
        const tm = repOrders.filter(o => inRange(o, thisMonthStart, thisMonthEnd));
        const lm = repOrders.filter(o => inRange(o, lastMonthStart, lastMonthEnd));
        const pm = repOrders.filter(o => inRange(o, priorMonthStart, priorMonthEnd));

        const stats = (arr: typeof repOrders) => ({
          submitted: arr.length,
          connected: arr.filter(o => o.jobStatus === "COMPLETED").length,
          approved: arr.filter(o => o.approvalStatus === "APPROVED").length,
        });

        const dailyBreakdown = dayLabels.map((label, i) => {
          const dayStart = new Date(thisWeekStart);
          dayStart.setDate(dayStart.getDate() + i);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const dayOrders = repOrders.filter(o => inRange(o, dayStart, dayEnd));
          return { day: label, date: dayStart.toISOString().split("T")[0], ...stats(dayOrders) };
        });

        const prevDailyBreakdown = dayLabels.map((label, i) => {
          const dayStart = new Date(lastWeekStart);
          dayStart.setDate(dayStart.getDate() + i);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const dayOrders = repOrders.filter(o => inRange(o, dayStart, dayEnd));
          return { day: label, date: dayStart.toISOString().split("T")[0], ...stats(dayOrders) };
        });

        const twStats = stats(tw);
        const lwStats = stats(lw);
        const tmStats = stats(tm);
        const lmStats = stats(lm);
        const pmStats = stats(pm);
        const todayStats = stats(todayOrders);
        const yesterdayStats = stats(yesterdayOrders);

        const delta = (curr: number, prev: number) => ({
          value: curr - prev,
          percent: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0),
        });

        return {
          repId,
          name: repUser?.name || repId,
          role: repUser?.role || "REP",
          today: todayStats,
          yesterday: yesterdayStats,
          dayOverDay: {
            submitted: delta(todayStats.submitted, yesterdayStats.submitted),
            connected: delta(todayStats.connected, yesterdayStats.connected),
          },
          thisWeek: twStats,
          lastWeek: lwStats,
          weekOverWeek: {
            submitted: delta(twStats.submitted, lwStats.submitted),
            connected: delta(twStats.connected, lwStats.connected),
          },
          thisMonth: tmStats,
          lastMonth: lmStats,
          priorMonth: pmStats,
          monthOverMonth: {
            submitted: delta(lmStats.submitted, pmStats.submitted),
            connected: delta(lmStats.connected, pmStats.connected),
          },
          dailyBreakdown,
          prevDailyBreakdown,
        };
      }).filter(u => u.today.submitted > 0 || u.yesterday.submitted > 0 || u.thisWeek.submitted > 0 || u.lastWeek.submitted > 0 || u.thisMonth.submitted > 0 || u.lastMonth.submitted > 0)
        .sort((a, b) => b.thisWeek.submitted - a.thisWeek.submitted);

      type TrackerKeys = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "priorMonth";
      const sumStats = (arr: typeof trackerData, key: TrackerKeys) => ({
        submitted: arr.reduce((s, u) => s + u[key].submitted, 0),
        connected: arr.reduce((s, u) => s + u[key].connected, 0),
        approved: arr.reduce((s, u) => s + u[key].approved, 0),
      });

      const totals = {
        today: sumStats(trackerData, "today"),
        yesterday: sumStats(trackerData, "yesterday"),
        thisWeek: sumStats(trackerData, "thisWeek"),
        lastWeek: sumStats(trackerData, "lastWeek"),
        thisMonth: sumStats(trackerData, "thisMonth"),
        lastMonth: sumStats(trackerData, "lastMonth"),
        priorMonth: sumStats(trackerData, "priorMonth"),
      };

      const dailyTotals = dayLabels.map((label, i) => {
        const submitted = trackerData.reduce((s, u) => s + u.dailyBreakdown[i].submitted, 0);
        const connected = trackerData.reduce((s, u) => s + u.dailyBreakdown[i].connected, 0);
        const approved = trackerData.reduce((s, u) => s + u.dailyBreakdown[i].approved, 0);
        const date = trackerData.length > 0 ? trackerData[0].dailyBreakdown[i].date : "";
        return { day: label, date, submitted, connected, approved };
      });

      const prevDailyTotals = dayLabels.map((label, i) => {
        const submitted = trackerData.reduce((s, u) => s + u.prevDailyBreakdown[i].submitted, 0);
        const connected = trackerData.reduce((s, u) => s + u.prevDailyBreakdown[i].connected, 0);
        const approved = trackerData.reduce((s, u) => s + u.prevDailyBreakdown[i].approved, 0);
        const date = trackerData.length > 0 ? trackerData[0].prevDailyBreakdown[i].date : "";
        return { day: label, date, submitted, connected, approved };
      });

      const serviceMap = new Map(allServices.map(s => [s.id, s.name]));
      const serviceMixByDay = dayLabels.map((label, i) => {
        const dayStart = new Date(thisWeekStart);
        dayStart.setDate(dayStart.getDate() + i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const dayOrders = orders.filter(o => inRange(o, dayStart, dayEnd));
        const mix: Record<string, number> = {};
        dayOrders.forEach(o => {
          const sName = serviceMap.get(o.serviceId) || "Unknown";
          mix[sName] = (mix[sName] || 0) + 1;
        });
        return { day: label, date: dayStart.toISOString().split("T")[0], mix };
      });

      const thisWeekOrders = orders.filter(o => inRange(o, thisWeekStart, thisWeekEnd));
      const weekServiceMix: Record<string, number> = {};
      thisWeekOrders.forEach(o => {
        const sName = serviceMap.get(o.serviceId) || "Unknown";
        weekServiceMix[sName] = (weekServiceMix[sName] || 0) + 1;
      });

      const periods = {
        today: todayStart.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
        yesterday: yesterdayStart.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
        thisWeek: { start: getWeekLabel(thisWeekStart), end: getWeekLabel(new Date(thisWeekEnd.getTime() - 86400000)) },
        lastWeek: { start: getWeekLabel(lastWeekStart), end: getWeekLabel(new Date(lastWeekEnd.getTime() - 86400000)) },
        thisMonth: now.toLocaleString("default", { month: "long", year: "numeric" }),
        lastMonth: new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString("default", { month: "long", year: "numeric" }),
        priorMonth: new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleString("default", { month: "long", year: "numeric" }),
      };

      res.json({ data: trackerData, totals, dailyTotals, prevDailyTotals, periods, serviceMixByDay, weekServiceMix });
    } catch (error) {
      console.error("Sales tracker report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  app.get("/api/reports/user-activity", auth, async (req: AuthRequest, res) => {
    try {
      const { viewMode } = req.query;
      const user = req.user!;
      const now = new Date();

      const allOrders = await storage.getOrders({});
      const allUsers = await storage.getUsers();
      const { filteredOrders: orders } = await applyRoleBasedOrderFilter(allOrders, user, viewMode as string | undefined);

      const dow = now.getDay();
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
      const thisWeekEnd = new Date(thisWeekStart);
      thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(thisWeekStart);

      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(thisMonthStart);

      const getWeekLabel = (d: Date) => {
        const m = d.toLocaleString("default", { month: "short" });
        return `${m} ${d.getDate()}`;
      };

      const periods = {
        thisWeek: { start: getWeekLabel(thisWeekStart), end: getWeekLabel(new Date(thisWeekEnd.getTime() - 86400000)) },
        lastWeek: { start: getWeekLabel(lastWeekStart), end: getWeekLabel(new Date(lastWeekEnd.getTime() - 86400000)) },
        thisMonth: now.toLocaleString("default", { month: "long", year: "numeric" }),
        lastMonth: new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString("default", { month: "long", year: "numeric" }),
      };

      const inRange = (o: any, s: Date, e: Date) => {
        const d = new Date(o.dateSold);
        return d >= s && d < e;
      };

      const repIds = [...new Set(orders.map(o => o.repId))];
      const userData = repIds.map(repId => {
        const repUser = allUsers.find(u => u.repId === repId && !u.deletedAt);
        const repOrders = orders.filter(o => o.repId === repId);

        const tw = repOrders.filter(o => inRange(o, thisWeekStart, thisWeekEnd));
        const lw = repOrders.filter(o => inRange(o, lastWeekStart, lastWeekEnd));
        const tm = repOrders.filter(o => inRange(o, thisMonthStart, thisMonthEnd));
        const lm = repOrders.filter(o => inRange(o, lastMonthStart, lastMonthEnd));

        const stats = (arr: typeof repOrders) => ({
          submitted: arr.length,
          connected: arr.filter(o => o.jobStatus === "COMPLETED").length,
        });

        const twStats = stats(tw);
        const lwStats = stats(lw);
        const tmStats = stats(tm);
        const lmStats = stats(lm);

        const delta = (curr: number, prev: number) => ({
          value: curr - prev,
          percent: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0),
        });

        return {
          repId,
          name: repUser?.name || repId,
          role: repUser?.role || "REP",
          thisWeek: twStats,
          lastWeek: lwStats,
          weekOverWeek: {
            submitted: delta(twStats.submitted, lwStats.submitted),
            connected: delta(twStats.connected, lwStats.connected),
          },
          thisMonth: tmStats,
          lastMonth: lmStats,
          monthOverMonth: {
            submitted: delta(tmStats.submitted, lmStats.submitted),
            connected: delta(tmStats.connected, lmStats.connected),
          },
        };
      }).filter(u => u.thisWeek.submitted > 0 || u.lastWeek.submitted > 0 || u.thisMonth.submitted > 0 || u.lastMonth.submitted > 0)
        .sort((a, b) => b.thisWeek.submitted - a.thisWeek.submitted);

      const totals = {
        thisWeek: { submitted: userData.reduce((s, u) => s + u.thisWeek.submitted, 0), connected: userData.reduce((s, u) => s + u.thisWeek.connected, 0) },
        lastWeek: { submitted: userData.reduce((s, u) => s + u.lastWeek.submitted, 0), connected: userData.reduce((s, u) => s + u.lastWeek.connected, 0) },
        thisMonth: { submitted: userData.reduce((s, u) => s + u.thisMonth.submitted, 0), connected: userData.reduce((s, u) => s + u.thisMonth.connected, 0) },
        lastMonth: { submitted: userData.reduce((s, u) => s + u.lastMonth.submitted, 0), connected: userData.reduce((s, u) => s + u.lastMonth.connected, 0) },
      };

      res.json({ data: userData, totals, periods });
    } catch (error) {
      console.error("User activity report error:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Register object storage routes
  registerObjectStorageRoutes(app);

  // === Knowledge Documents API ===
  
  // Role hierarchy for access control
  const ROLE_HIERARCHY: Record<string, number> = {
    "REP": 1,
    "LEAD": 2,
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
            // Only sync REP, LEAD, MANAGER, EXECUTIVE roles
            const salesRoles = ["REP", "LEAD", "MANAGER", "EXECUTIVE"];
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
  app.get("/api/admin/payroll/schedules", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getPayrollSchedules();
      res.json(schedules);
    } catch (error) { res.status(500).json({ message: "Failed to get schedules" }); }
  });

  app.post("/api/admin/payroll/schedules", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.createPayrollSchedule(req.body);
      await storage.createAuditLog({ action: "create_payroll_schedule", tableName: "payroll_schedules", recordId: schedule.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(schedule);
    } catch (error) { res.status(500).json({ message: "Failed to create schedule" }); }
  });

  app.put("/api/admin/payroll/schedules/:id", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.updatePayrollSchedule(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_payroll_schedule", tableName: "payroll_schedules", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(schedule);
    } catch (error) { res.status(500).json({ message: "Failed to update schedule" }); }
  });

  app.delete("/api/admin/payroll/schedules/:id", auth, requirePermission("admin:payruns:manage"), async (req: AuthRequest, res) => {
    try {
      await storage.deletePayrollSchedule(req.params.id);
      await storage.createAuditLog({ action: "delete_payroll_schedule", tableName: "payroll_schedules", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Schedule deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete schedule" }); }
  });

  // Deduction Types
  app.get("/api/admin/payroll/deduction-types", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
    try {
      const types = await storage.getDeductionTypes();
      res.json(types);
    } catch (error) { res.status(500).json({ message: "Failed to get deduction types" }); }
  });

  app.post("/api/admin/payroll/deduction-types", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
    try {
      const type = await storage.createDeductionType(req.body);
      await storage.createAuditLog({ action: "create_deduction_type", tableName: "deduction_types", recordId: type.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(type);
    } catch (error) { res.status(500).json({ message: "Failed to create deduction type" }); }
  });

  app.put("/api/admin/payroll/deduction-types/:id", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
    try {
      const type = await storage.updateDeductionType(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_deduction_type", tableName: "deduction_types", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(type);
    } catch (error) { res.status(500).json({ message: "Failed to update deduction type" }); }
  });

  app.delete("/api/admin/payroll/deduction-types/:id", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteDeductionType(req.params.id);
      await storage.createAuditLog({ action: "delete_deduction_type", tableName: "deduction_types", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "Deduction type deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete deduction type" }); }
  });

  // User Deductions
  app.get("/api/admin/payroll/user-deductions", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payroll/user-deductions", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
    try {
      const deduction = await storage.createUserDeduction(req.body);
      await storage.createAuditLog({ action: "create_user_deduction", tableName: "user_deductions", recordId: deduction.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(deduction);
    } catch (error) { res.status(500).json({ message: "Failed to create user deduction" }); }
  });

  app.put("/api/admin/payroll/user-deductions/:id", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
    try {
      const deduction = await storage.updateUserDeduction(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_user_deduction", tableName: "user_deductions", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(deduction);
    } catch (error) { res.status(500).json({ message: "Failed to update user deduction" }); }
  });

  app.delete("/api/admin/payroll/user-deductions/:id", auth, requirePermission("financial:manage:deductions"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteUserDeduction(req.params.id);
      await storage.createAuditLog({ action: "delete_user_deduction", tableName: "user_deductions", recordId: req.params.id, userId: req.user!.id });
      res.json({ message: "User deduction deleted" });
    } catch (error) { res.status(500).json({ message: "Failed to delete user deduction" }); }
  });

  // Advances
  app.get("/api/admin/payroll/advances", auth, requirePermission("financial:approve:advances"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/payroll/advances/:id", auth, requirePermission("financial:approve:advances"), async (req: AuthRequest, res) => {
    try {
      const advance = await storage.getAdvanceById(req.params.id);
      if (!advance) return res.status(404).json({ message: "Advance not found" });
      const repayments = await storage.getAdvanceRepayments(req.params.id);
      res.json({ ...advance, repayments });
    } catch (error) { res.status(500).json({ message: "Failed to get advance" }); }
  });

  app.post("/api/admin/payroll/advances", auth, requirePermission("financial:approve:advances"), async (req: AuthRequest, res) => {
    try {
      const advance = await storage.createAdvance(req.body);
      await storage.createAuditLog({ action: "create_advance", tableName: "advances", recordId: advance.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to create advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/approve", auth, requirePermission("financial:approve:advances"), async (req: AuthRequest, res) => {
    try {
      const { approvedAmount, notes } = req.body;
      const advance = await storage.approveAdvance(req.params.id, req.user!.id, approvedAmount, notes);
      await storage.createAuditLog({ action: "approve_advance", tableName: "advances", recordId: req.params.id, afterJson: JSON.stringify({ approvedAmount, notes }), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to approve advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/reject", auth, requirePermission("financial:approve:advances"), async (req: AuthRequest, res) => {
    try {
      const { notes } = req.body;
      const advance = await storage.rejectAdvance(req.params.id, req.user!.id, notes);
      await storage.createAuditLog({ action: "reject_advance", tableName: "advances", recordId: req.params.id, afterJson: JSON.stringify({ notes }), userId: req.user!.id });
      res.json(advance);
    } catch (error) { res.status(500).json({ message: "Failed to reject advance" }); }
  });

  app.post("/api/admin/payroll/advances/:id/mark-paid", auth, requirePermission("financial:approve:advances"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/payroll/tax-profiles", auth, requirePermission("financial:manage:taxprofiles"), async (req: AuthRequest, res) => {
    try {
      const profiles = await storage.getAllUserTaxProfiles();
      res.json(profiles);
    } catch (error) { res.status(500).json({ message: "Failed to get tax profiles" }); }
  });

  app.get("/api/admin/payroll/tax-profiles/:userId", auth, requirePermission("financial:manage:taxprofiles"), async (req: AuthRequest, res) => {
    try {
      const profile = await storage.getUserTaxProfile(req.params.userId);
      res.json(profile || {});
    } catch (error) { res.status(500).json({ message: "Failed to get tax profile" }); }
  });

  app.put("/api/admin/payroll/tax-profiles/:userId", auth, requirePermission("financial:manage:taxprofiles"), async (req: AuthRequest, res) => {
    try {
      const profile = await storage.updateUserTaxProfile(req.params.userId, req.body);
      await storage.createAuditLog({ action: "update_tax_profile", tableName: "user_tax_profiles", recordId: req.params.userId, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(profile);
    } catch (error) { res.status(500).json({ message: "Failed to update tax profile" }); }
  });

  // User Payment Methods
  app.get("/api/admin/payroll/payment-methods/:userId", auth, requirePermission("financial:manage:taxprofiles"), async (req: AuthRequest, res) => {
    try {
      const methods = await storage.getUserPaymentMethods(req.params.userId);
      res.json(methods);
    } catch (error) { res.status(500).json({ message: "Failed to get payment methods" }); }
  });

  app.post("/api/admin/payroll/payment-methods", auth, requirePermission("financial:manage:taxprofiles"), async (req: AuthRequest, res) => {
    try {
      const method = await storage.createUserPaymentMethod(req.body);
      await storage.createAuditLog({ action: "create_payment_method", tableName: "user_payment_methods", recordId: method.id, afterJson: JSON.stringify({ ...req.body, accountLastFour: req.body.accountLastFour }), userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to create payment method" }); }
  });

  app.put("/api/admin/payroll/payment-methods/:id", auth, requirePermission("financial:manage:taxprofiles"), async (req: AuthRequest, res) => {
    try {
      const method = await storage.updateUserPaymentMethod(req.params.id, req.body);
      await storage.createAuditLog({ action: "update_payment_method", tableName: "user_payment_methods", recordId: req.params.id, afterJson: JSON.stringify(req.body), userId: req.user!.id });
      res.json(method);
    } catch (error) { res.status(500).json({ message: "Failed to update payment method" }); }
  });

  app.delete("/api/admin/payroll/payment-methods/:id", auth, requirePermission("financial:manage:taxprofiles"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/payroll/statements", auth, requirePermission("paystubs:view:all"), async (req: AuthRequest, res) => {
    try {
      const payRunId = req.query.payRunId as string | undefined;
      const statements = await storage.getPayStatements(payRunId);
      res.json(statements);
    } catch (error) { res.status(500).json({ message: "Failed to get statements" }); }
  });

  app.get("/api/admin/payroll/statements/:id", auth, requirePermission("paystubs:view:all"), async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      res.json({ ...statement, lineItems, deductions });
    } catch (error) { res.status(500).json({ message: "Failed to get statement" }); }
  });

  // Generate pay statements for a pay run
  app.post("/api/admin/payroll/payruns/:payRunId/generate-statements", auth, requirePermission("paystubs:generate"), async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });
      
      // Delete existing statements for this pay run (allows regeneration)
      const existingStatements = await storage.getPayStatements(req.params.payRunId);
      for (const stmt of existingStatements) {
        if (stmt.status === "PAID" || stmt.status === "ISSUED") continue;
        await storage.deletePayStatementLineItems(stmt.id);
        await storage.deletePayStatementDeductions(stmt.id);
        await storage.deletePayStatement(stmt.id);
      }

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
      
      // Pre-fetch all deduction types once
      const allDeductionTypes = await storage.getDeductionTypes();
      const deductionTypeMap = new Map(allDeductionTypes.map(dt => [dt.id, dt]));
      
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
          const deductionType = deductionTypeMap.get(ud.deductionTypeId);
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
        
        // Calculate pay period start (7 days before week ending)
        const weekEnd = new Date(payRun.weekEndingDate + "T00:00:00");
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() - 6);
        const periodStartStr = weekStart.toISOString().split("T")[0];

        // Create pay statement
        const statement = await storage.createPayStatement({
          payRunId: req.params.payRunId,
          userId: user.id,
          periodStart: periodStartStr,
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
            description: `Order ${order.invoiceNumber || order.id} - ${order.customerName || ""}`.trim(),
            sourceType: "sales_order",
            sourceId: order.id,
            amount: order.baseCommissionEarned,
          });
          
          const incentiveAmt = parseFloat(order.incentiveEarned || "0");
          if (incentiveAmt > 0) {
            await storage.createPayStatementLineItem({
              payStatementId: statement.id,
              category: "Incentive",
              description: `Incentive - Order ${order.invoiceNumber || order.id}`,
              sourceType: "sales_order",
              sourceId: order.id,
              amount: order.incentiveEarned,
            });
          }
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

  // Generate weekly pay stubs from PAID orders
  app.post("/api/admin/payroll/generate-weekly-stubs", auth, requirePermission("paystubs:generate"), async (req: AuthRequest, res) => {
    try {
      const bodySchema = z.object({
        weekEndingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD")
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { weekEndingDate } = parsed.data;
      
      // Calculate week start (7 days before week ending)
      const endDate = new Date(weekEndingDate);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
      
      const periodStart = startDate.toISOString().split("T")[0];
      const periodEnd = endDate.toISOString().split("T")[0];
      
      // Get all PAID orders with install date within this date range
      const allOrders = await storage.getOrders({});
      const paidOrders = allOrders.filter(order => {
        if (order.paymentStatus !== "PAID") return false;
        if (!order.installDate) return false;
        const installDate = new Date(order.installDate);
        return installDate >= startDate && installDate <= endDate;
      });
      
      if (paidOrders.length === 0) {
        return res.json({ generated: 0, message: "No paid orders found in this period", statements: [] });
      }
      
      // Create a pay run for these weekly stubs
      const payRun = await storage.createPayRun({
        name: `Weekly Pay Stubs - ${periodEnd}`,
        weekEndingDate: periodEnd,
        payDate: periodEnd,
        status: "FINALIZED",
        createdByUserId: req.user!.id,
      });
      
      // Group orders by rep
      const ordersByRep: Record<string, typeof paidOrders> = {};
      for (const order of paidOrders) {
        if (!ordersByRep[order.repId]) ordersByRep[order.repId] = [];
        ordersByRep[order.repId].push(order);
      }
      
      const statements: any[] = [];
      const currentYear = new Date().getFullYear();
      
      // Fetch chargebacks filtered by date range at SQL level, then group by repId
      const periodChargebacks = await storage.getChargebacksByDateRange(periodStart, periodEnd);
      const chargebacksByRepMap = new Map<string, typeof periodChargebacks>();
      for (const cb of periodChargebacks) {
        if (!chargebacksByRepMap.has(cb.repId)) chargebacksByRepMap.set(cb.repId, []);
        chargebacksByRepMap.get(cb.repId)!.push(cb);
      }
      
      // Pre-fetch all deduction types once
      const allDeductionTypesForStubs = await storage.getDeductionTypes();
      const deductionTypeMapForStubs = new Map(allDeductionTypesForStubs.map(dt => [dt.id, dt]));
      
      for (const [repId, repOrders] of Object.entries(ordersByRep)) {
        const user = await storage.getUserByRepId(repId);
        if (!user) continue;
        
        // Calculate gross commission from paid orders
        let grossCommission = 0;
        let incentivesTotal = 0;
        for (const order of repOrders) {
          grossCommission += parseFloat(order.baseCommissionEarned);
          incentivesTotal += parseFloat(order.incentiveEarned || "0");
        }
        
        // Get chargebacks in this period for this rep from pre-fetched map
        const repChargebacksForStub = chargebacksByRepMap.get(repId) || [];
        let chargebacksTotal = 0;
        for (const cb of repChargebacksForStub) {
          chargebacksTotal += parseFloat(cb.amount || "0");
        }
        
        // Weekly pay stubs exclude override earnings - they are handled separately
        // Override deductions were already applied when calculating baseCommissionEarned on orders
        
        // Get active deductions
        const userDeductions = await storage.getActiveUserDeductions(user.id);
        let deductionsTotal = 0;
        const deductionDetails: { userDeductionId?: string; deductionTypeName: string; amount: string }[] = [];
        for (const ud of userDeductions) {
          const deductionType = deductionTypeMapForStubs.get(ud.deductionTypeId);
          const deductionAmount = parseFloat(ud.amount || "0");
          deductionsTotal += deductionAmount;
          deductionDetails.push({
            userDeductionId: ud.id,
            deductionTypeName: deductionType?.name || "Unknown",
            amount: deductionAmount.toFixed(2)
          });
        }
        
        // Get YTD totals
        const ytd = await storage.getYTDTotalsForUser(user.id, currentYear);
        
        // Calculate net pay (excluding override earnings - they are handled separately)
        const grossTotal = grossCommission + incentivesTotal;
        const netPay = grossTotal - chargebacksTotal - deductionsTotal;
        
        // Create pay statement (override earnings excluded from weekly stubs)
        const statement = await storage.createPayStatement({
          payRunId: payRun.id,
          userId: user.id,
          periodStart,
          periodEnd,
          grossCommission: grossCommission.toFixed(2),
          overrideEarningsTotal: "0",
          incentivesTotal: incentivesTotal.toFixed(2),
          chargebacksTotal: chargebacksTotal.toFixed(2),
          adjustmentsTotal: "0",
          deductionsTotal: deductionsTotal.toFixed(2),
          advancesApplied: "0",
          taxWithheld: "0",
          netPay: netPay.toFixed(2),
          status: "ISSUED",
          ytdGross: (parseFloat(ytd.totalGross) + grossTotal).toFixed(2),
          ytdDeductions: (parseFloat(ytd.totalDeductions) + deductionsTotal).toFixed(2),
          ytdNetPay: (parseFloat(ytd.totalNetPay) + netPay).toFixed(2),
        });
        
        // Issue the statement immediately
        await storage.issuePayStatement(statement.id);
        
        // Create line items for each paid order
        for (const order of repOrders) {
          await storage.createPayStatementLineItem({
            payStatementId: statement.id,
            category: "Commission",
            description: `Order ${order.invoiceNumber || order.id} - ${order.customerName}`,
            sourceType: "sales_order",
            sourceId: order.id,
            amount: order.baseCommissionEarned,
          });
          
          if (parseFloat(order.incentiveEarned || "0") > 0) {
            await storage.createPayStatementLineItem({
              payStatementId: statement.id,
              category: "Incentive",
              description: `Incentive for ${order.invoiceNumber || order.id}`,
              sourceType: "sales_order",
              sourceId: order.id,
              amount: order.incentiveEarned,
            });
          }
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
        
        statements.push({
          ...statement,
          user: { id: user.id, name: user.name, repId: user.repId }
        });
      }
      
      await storage.createAuditLog({
        action: "generate_weekly_pay_stubs",
        tableName: "pay_statements",
        recordId: payRun.id,
        afterJson: JSON.stringify({ count: statements.length, periodStart, periodEnd }),
        userId: req.user!.id,
      });
      
      res.json({ 
        generated: statements.length, 
        payRunId: payRun.id,
        periodStart,
        periodEnd,
        statements 
      });
    } catch (error: any) {
      console.error("Generate weekly stubs error:", error);
      res.status(500).json({ message: error.message || "Failed to generate weekly pay stubs" });
    }
  });

  // Export pay stub as Excel in the specific format
  app.get("/api/admin/payroll/statements/:id/export-excel", auth, requirePermission("paystubs:export:pdf"), async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      
      const user = await storage.getUserById(statement.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      
      // Get orders from line items (they store sourceId = order.id)
      const orders: SalesOrder[] = [];
      for (const item of lineItems) {
        if (item.sourceType === "sales_order" && item.sourceId) {
          const order = await storage.getOrderById(item.sourceId);
          if (order && !orders.find(o => o.id === order.id)) {
            orders.push(order);
          }
        }
      }
      
      // Get clients, providers, services for order details
      const clients = await storage.getClients();
      const services = await storage.getServices();
      const providers = await storage.getProviders();
      
      // Build Excel content as CSV
      const rows: string[][] = [];
      
      // Header section
      rows.push(["Pay Statement"]);
      rows.push(["Rep Name", user.name]);
      rows.push(["Rep ID", user.repId]);
      rows.push(["Period", `${statement.periodStart} - ${statement.periodEnd}`]);
      rows.push(["Company", "Iron Crest"]);
      rows.push([]);
      
      // Summary section
      rows.push(["Summary"]);
      const grossCommission = parseFloat(statement.grossCommission);
      const incentives = parseFloat(statement.incentivesTotal);
      const chargebacks = parseFloat(statement.chargebacksTotal);
      const deductionTotal = parseFloat(statement.deductionsTotal);
      const netPay = parseFloat(statement.netPay);
      
      rows.push(["Gross Commission", "$" + grossCommission.toFixed(2)]);
      rows.push(["Incentives", "$" + incentives.toFixed(2)]);
      rows.push(["Chargebacks", "-$" + chargebacks.toFixed(2)]);
      rows.push(["Deductions", "-$" + deductionTotal.toFixed(2)]);
      rows.push(["Net Pay", "$" + netPay.toFixed(2)]);
      rows.push([]);
      
      // Deductions breakdown
      if (deductions.length > 0) {
        rows.push(["Deductions Breakdown"]);
        rows.push(["Reason", "Amount"]);
        for (const ded of deductions) {
          rows.push([ded.deductionTypeName || "Deduction", "-$" + parseFloat(ded.amount).toFixed(2)]);
        }
        rows.push([]);
      }
      
      // Order Details section
      rows.push(["Order Details"]);
      rows.push(["Invoice Number", "Rep ID", "Account Number", "Service", "Provider", "Install Date", "Net Commission"]);
      
      for (const order of orders) {
        const service = services.find(s => s.id === order.serviceId);
        const provider = providers.find(p => p.id === order.providerId);
        const netCommission = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned || "0") - parseFloat(order.overrideDeduction || "0");
        
        rows.push([
          order.invoiceNumber,
          user.repId,
          order.accountNumber || "",
          service?.name || "N/A",
          provider?.name || "N/A",
          order.installDate || order.dateSold,
          "$" + netCommission.toFixed(2)
        ]);
      }
      
      // Convert to CSV
      const csvContent = rows.map(row => row.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="pay_statement_${user.repId}_${statement.periodEnd}.csv"`);
      res.send(csvContent);
    } catch (error: any) {
      console.error("Export pay stub error:", error);
      res.status(500).json({ message: error.message || "Failed to export pay stub" });
    }
  });

  // Issue a pay statement
  app.post("/api/admin/payroll/statements/:id/issue", auth, requirePermission("paystubs:generate"), async (req: AuthRequest, res) => {
    try {
      const statement = await storage.issuePayStatement(req.params.id);
      await storage.createAuditLog({ action: "issue_pay_statement", tableName: "pay_statements", recordId: req.params.id, userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to issue statement" }); }
  });

  // Mark statement as paid
  app.post("/api/admin/payroll/statements/:id/mark-paid", auth, requirePermission("paystubs:generate"), async (req: AuthRequest, res) => {
    try {
      const { paymentMethodId, paymentReference } = req.body;
      const statement = await storage.markPayStatementPaid(req.params.id, paymentMethodId, paymentReference);
      await storage.createAuditLog({ action: "mark_statement_paid", tableName: "pay_statements", recordId: req.params.id, afterJson: JSON.stringify({ paymentMethodId, paymentReference }), userId: req.user!.id });
      res.json(statement);
    } catch (error) { res.status(500).json({ message: "Failed to mark statement paid" }); }
  });

  // Void a pay statement
  app.post("/api/admin/payroll/statements/:id/void", auth, requirePermission("paystubs:generate"), async (req: AuthRequest, res) => {
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

  // Excel download for pay statement (rep can download their own)
  app.get("/api/payroll/my-statements/:id/excel", auth, async (req: AuthRequest, res) => {
    try {
      const statement = await storage.getPayStatementById(req.params.id);
      if (!statement) return res.status(404).json({ message: "Statement not found" });
      if (statement.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      
      const user = await storage.getUserById(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const lineItems = await storage.getPayStatementLineItems(req.params.id);
      const deductions = await storage.getPayStatementDeductions(req.params.id);
      
      // Get orders from line items (they store sourceId = order.id)
      const orders: SalesOrder[] = [];
      for (const item of lineItems) {
        if (item.sourceType === "sales_order" && item.sourceId) {
          const order = await storage.getOrderById(item.sourceId);
          if (order && !orders.find(o => o.id === order.id)) {
            orders.push(order);
          }
        }
      }
      
      // Get clients, providers, services for order details
      const clients = await storage.getClients();
      const services = await storage.getServices();
      const providers = await storage.getProviders();
      
      // Build Excel content as CSV
      const rows: string[][] = [];
      
      // Header section
      rows.push(["Pay Statement"]);
      rows.push(["Rep Name", user.name]);
      rows.push(["Rep ID", user.repId]);
      rows.push(["Period", `${statement.periodStart} - ${statement.periodEnd}`]);
      rows.push(["Company", "Iron Crest"]);
      rows.push([]);
      
      // Summary section
      rows.push(["Summary"]);
      const grossCommission = parseFloat(statement.grossCommission);
      const incentives = parseFloat(statement.incentivesTotal);
      const chargebacks = parseFloat(statement.chargebacksTotal);
      const deductionTotal = parseFloat(statement.deductionsTotal);
      const netPay = parseFloat(statement.netPay);
      
      rows.push(["Gross Commission", "$" + grossCommission.toFixed(2)]);
      rows.push(["Incentives", "$" + incentives.toFixed(2)]);
      rows.push(["Chargebacks", "-$" + chargebacks.toFixed(2)]);
      rows.push(["Deductions", "-$" + deductionTotal.toFixed(2)]);
      rows.push(["Net Pay", "$" + netPay.toFixed(2)]);
      rows.push([]);
      
      // Deductions breakdown
      if (deductions.length > 0) {
        rows.push(["Deductions Breakdown"]);
        rows.push(["Reason", "Amount"]);
        for (const ded of deductions) {
          rows.push([ded.deductionTypeName || "Deduction", "-$" + parseFloat(ded.amount).toFixed(2)]);
        }
        rows.push([]);
      }
      
      // Order Details section
      rows.push(["Order Details"]);
      rows.push(["Invoice Number", "Rep ID", "Account Number", "Service", "Provider", "Install Date", "Net Commission"]);
      
      for (const order of orders) {
        const service = services.find(s => s.id === order.serviceId);
        const provider = providers.find(p => p.id === order.providerId);
        const netCommission = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned || "0") - parseFloat(order.overrideDeduction || "0");
        
        rows.push([
          order.invoiceNumber,
          user.repId,
          order.accountNumber || "",
          service?.name || "N/A",
          provider?.name || "N/A",
          order.installDate || order.dateSold,
          "$" + netCommission.toFixed(2)
        ]);
      }
      
      // Convert to CSV
      const csvContent = rows.map(row => row.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
      
      const periodEnd = new Date(statement.periodEnd).toISOString().split("T")[0];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="PayStatement_${user.repId}_${periodEnd}.csv"`);
      res.send(csvContent);
    } catch (error: any) {
      console.error("Excel export error:", error);
      res.status(500).json({ message: error.message || "Failed to export Excel" });
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
  app.get("/api/admin/payroll/reports/summary", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/payroll/reports/by-user", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/payroll/payruns/:payRunId/approvals", auth, requirePermission("admin:payruns:approve"), async (req: AuthRequest, res) => {
    try {
      const approvals = await storage.getPayRunApprovals(req.params.payRunId);
      res.json(approvals);
    } catch (error) { res.status(500).json({ message: "Failed to get approvals" }); }
  });

  app.post("/api/admin/payroll/payruns/:payRunId/approvals", auth, requirePermission("admin:payruns:approve"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/quickbooks/status", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
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

  // Get QuickBooks OAuth authorization URL (returns JSON)
  app.get("/api/admin/quickbooks/authorize", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const userId = req.user!.id;
      const nonce = crypto.randomBytes(8).toString("hex");
      const payload = `${userId}:${nonce}`;
      const secret = process.env.QB_CLIENT_SECRET;
      if (!secret) {
        return res.status(500).json({ message: "QuickBooks not configured" });
      }
      const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex").substring(0, 16);
      const state = Buffer.from(`${payload}:${signature}`).toString("base64url");
      const authUrl = qb.getAuthorizationUrl(state);
      res.json({ authUrl, state });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get authorization URL" });
    }
  });

  // Direct redirect to QuickBooks OAuth (no auth required for redirect)
  app.get("/api/quickbooks/connect", async (req, res) => {
    try {
      const qb = await import("./quickbooks");
      const state = crypto.randomBytes(16).toString("hex");
      const authUrl = qb.getAuthorizationUrl(state);
      res.redirect(authUrl);
    } catch (error: any) {
      res.status(500).send("Failed to connect to QuickBooks: " + error.message);
    }
  });

  // QuickBooks OAuth callback
  app.get("/api/auth/quickbooks/callback", async (req, res) => {
    try {
      const { code, realmId, state } = req.query;
      console.log("QuickBooks callback received:", { code: code ? "present" : "missing", realmId, state });
      
      if (!code || !realmId || !state) {
        return res.status(400).send("Missing authorization code, realm ID, or state");
      }

      const secret = process.env.QB_CLIENT_SECRET;
      if (!secret) {
        return res.status(500).send("QuickBooks not configured");
      }

      let userId: string;
      try {
        const decoded = Buffer.from(state as string, "base64url").toString();
        console.log("Decoded state:", decoded);
        const parts = decoded.split(":");
        if (parts.length !== 3) {
          throw new Error("Invalid state format");
        }
        const [uid, nonce, receivedSig] = parts;
        const payload = `${uid}:${nonce}`;
        const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex").substring(0, 16);
        console.log("State validation:", { uid, receivedSig, expectedSig, match: receivedSig === expectedSig });
        if (receivedSig !== expectedSig) {
          throw new Error("Invalid state signature");
        }
        userId = uid;
      } catch (e: any) {
        console.error("State validation error:", e.message);
        return res.status(400).send("Invalid or tampered state parameter");
      }

      console.log("Calling exchangeCodeForTokens with userId:", userId);
      const qb = await import("./quickbooks");
      await qb.exchangeCodeForTokens(code as string, realmId as string, userId);
      
      // Redirect back to QuickBooks admin page
      res.redirect("/admin/quickbooks?connected=true");
    } catch (error: any) {
      console.error("QuickBooks callback error:", error);
      res.status(500).send(`QuickBooks connection failed: ${error.message}`);
    }
  });

  // Disconnect QuickBooks
  app.post("/api/admin/quickbooks/disconnect", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/quickbooks/accounts", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const accounts = await qb.fetchQBAccounts();
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch accounts" });
    }
  });

  // Save account mapping
  app.post("/api/admin/quickbooks/mappings", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/quickbooks/sync-invoice/:orderId", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/quickbooks/post-journal/:payRunId", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/quickbooks/sync-logs", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/quickbooks/retry/:syncLogId", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.retryFailedSync(req.params.syncLogId, req.user!.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Bulk sync approved orders to QuickBooks
  // In-memory progress tracker for bulk sync jobs
  const bulkSyncJobs = new Map<string, { total: number; synced: number; failed: number; errors: string[]; status: "running" | "completed" }>();

  app.post("/api/admin/quickbooks/bulk-sync-invoices", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const ordersToSync = await db.query.salesOrders.findMany({
        where: and(
          eq(salesOrders.jobStatus, "COMPLETED"),
          sql`${salesOrders.qbInvoiceId} IS NULL`
        ),
      });
      
      const jobId = crypto.randomUUID();
      bulkSyncJobs.set(jobId, { total: ordersToSync.length, synced: 0, failed: 0, errors: [], status: "running" });
      
      res.json({ jobId, total: ordersToSync.length, message: "Sync started" });
      
      const userId = req.user!.id;
      setImmediate(async () => {
        try {
          const qb = await import("./quickbooks");
          const job = bulkSyncJobs.get(jobId)!;
          
          for (const order of ordersToSync) {
            const result = await qb.syncInvoiceToQuickBooks(order.id, userId);
            if (result.success) {
              job.synced++;
            } else {
              job.failed++;
              job.errors.push(`Order ${order.invoiceNumber}: ${result.error}`);
            }
          }
          
          job.status = "completed";
        } catch (err) {
          console.error("Bulk sync background job error:", err);
          const job = bulkSyncJobs.get(jobId);
          if (job) job.status = "completed";
        }
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/admin/quickbooks/bulk-sync-status/:jobId", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    const job = bulkSyncJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  });

  // Get exception queue (failed syncs with enriched details)
  app.get("/api/admin/quickbooks/exception-queue", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const limit = parseInt(req.query.limit as string) || 50;
      const exceptions = await qb.getExceptionQueue(limit);
      res.json(exceptions);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get exception queue" });
    }
  });

  // Get reconciliation data
  app.get("/api/admin/quickbooks/reconciliation", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const data = await qb.getReconciliationData();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get reconciliation data" });
    }
  });

  // Get sync health metrics
  app.get("/api/admin/quickbooks/health", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const metrics = await qb.getSyncHealthMetrics();
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get health metrics" });
    }
  });

  // Get environment info
  app.get("/api/admin/quickbooks/environment", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const envInfo = qb.getEnvironmentInfo();
      res.json(envInfo);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get environment info" });
    }
  });

  // Get audit logs
  app.get("/api/admin/quickbooks/audit-logs", auth, requirePermission("system:view:auditlogs"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = qb.getQBAuditLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get audit logs" });
    }
  });

  // Fetch QB classes
  app.get("/api/admin/quickbooks/classes", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const classes = await qb.fetchQBClasses();
      res.json(classes);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch QB classes" });
    }
  });

  // Fetch QB departments
  app.get("/api/admin/quickbooks/departments", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const departments = await qb.fetchQBDepartments();
      res.json(departments);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch QB departments" });
    }
  });

  // Fetch QB items
  app.get("/api/admin/quickbooks/items", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const items = await qb.fetchQBItems();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch QB items" });
    }
  });

  // Sync payment statuses
  app.post("/api/admin/quickbooks/sync-payments", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const result = await qb.syncPaymentStatuses();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Save advanced mapping
  app.post("/api/admin/quickbooks/advanced-mappings", auth, requirePermission("admin:quickbooks"), async (req: AuthRequest, res) => {
    try {
      const qb = await import("./quickbooks");
      const { mappingType, qbId, qbName, qbAccountType } = req.body;
      await qb.saveAdvancedMapping(mappingType, qbId, qbName, { qbAccountType });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ========== NEW PAYROLL FEATURES ROUTES ==========

  // Tax Documents (1099s)
  app.get("/api/admin/tax-documents", auth, requirePermission("admin:taxdocs"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/tax-documents/:id", auth, requirePermission("admin:taxdocs"), async (req: AuthRequest, res) => {
    try {
      const doc = await storage.getTaxDocumentById(req.params.id);
      if (!doc) return res.status(404).json({ message: "Tax document not found" });
      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/tax-documents/generate-data/:year", auth, requirePermission("admin:taxdocs"), async (req: AuthRequest, res) => {
    try {
      const taxYear = parseInt(req.params.year);
      const data = await storage.generate1099DataForYear(taxYear);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/tax-documents", auth, requirePermission("admin:taxdocs"), async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/tax-documents/:id", auth, requirePermission("admin:taxdocs"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/tax-documents/bulk-generate/:year", auth, requirePermission("admin:taxdocs"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/bank-accounts", auth, requirePermission("admin:bankaccounts"), async (req: AuthRequest, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ message: "userId required" });
      const accounts = await storage.getUserBankAccounts(userId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bank-accounts", auth, requirePermission("admin:bankaccounts"), async (req: AuthRequest, res) => {
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

  app.delete("/api/admin/bank-accounts/:id", auth, requirePermission("admin:bankaccounts"), async (req: AuthRequest, res) => {
    try {
      await storage.deactivateUserBankAccount(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ACH Exports
  app.get("/api/admin/ach-exports", auth, requirePermission("financial:export:ach"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/ach-exports/:id", auth, requirePermission("financial:export:ach"), async (req: AuthRequest, res) => {
    try {
      const exp = await storage.getAchExportById(req.params.id);
      if (!exp) return res.status(404).json({ message: "ACH export not found" });
      const items = await storage.getAchExportItems(req.params.id);
      res.json({ ...exp, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/ach-exports/generate/:payRunId", auth, requirePermission("financial:export:ach"), async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/ach-exports/:id/status", auth, requirePermission("financial:export:ach"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/payment-reconciliations", auth, requirePermission("admin:reconciliations"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/payment-reconciliations", auth, requirePermission("admin:reconciliations"), async (req: AuthRequest, res) => {
    try {
      const rec = await storage.createPaymentReconciliation(req.body);
      res.status(201).json(rec);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payment-reconciliations/:id/match", auth, requirePermission("admin:reconciliations"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/bonuses", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/bonuses/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const bonus = await storage.getBonusById(req.params.id);
      if (!bonus) return res.status(404).json({ message: "Bonus not found" });
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/bonuses", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/bonuses/:id/approve", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.post("/api/admin/bonuses/:id/cancel", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      const bonus = await storage.cancelBonus(req.params.id, reason);
      res.json(bonus);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Draw Accounts
  app.get("/api/admin/draw-accounts", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/draw-accounts/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const account = await storage.getDrawAccountById(req.params.id);
      if (!account) return res.status(404).json({ message: "Draw account not found" });
      const transactions = await storage.getDrawTransactions(req.params.id);
      res.json({ ...account, transactions });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/draw-accounts", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/draw-accounts/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const account = await storage.updateDrawAccount(req.params.id, req.body);
      res.json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Split Commission Agreements
  app.get("/api/admin/split-agreements", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/split-agreements/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const agreement = await storage.getSplitAgreementById(req.params.id);
      if (!agreement) return res.status(404).json({ message: "Agreement not found" });
      const recipients = await storage.getSplitRecipients(req.params.id);
      res.json({ ...agreement, recipients });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/split-agreements", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/split-agreements/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/commission-tiers", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/commission-tiers/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const tier = await storage.getCommissionTierById(req.params.id);
      if (!tier) return res.status(404).json({ message: "Tier not found" });
      const levels = await storage.getTierLevels(req.params.id);
      res.json({ ...tier, levels });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/commission-tiers", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/commission-tiers/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/rep-tier-assignments/:userId", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      const assignments = await storage.getRepTierAssignments(req.params.userId);
      res.json(assignments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/rep-tier-assignments", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
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

  app.delete("/api/admin/rep-tier-assignments/:id", auth, requirePermission("admin:bonuses"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteRepTierAssignment(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Scheduled Pay Runs
  app.get("/api/admin/scheduled-pay-runs", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getScheduledPayRuns();
      res.json(schedules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/scheduled-pay-runs/:id", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.getScheduledPayRunById(req.params.id);
      if (!schedule) return res.status(404).json({ message: "Schedule not found" });
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/scheduled-pay-runs", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
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

  app.patch("/api/admin/scheduled-pay-runs/:id", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
    try {
      const schedule = await storage.updateScheduledPayRun(req.params.id, req.body);
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/scheduled-pay-runs/:id", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
    try {
      await storage.deleteScheduledPayRun(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Commission Forecasts
  app.get("/api/admin/commission-forecasts", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/commission-forecasts/calculate/:userId", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/payroll-reports/summary", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
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

  app.get("/api/admin/payroll-reports/deductions", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
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
        .filter(o => o.jobStatus === "PENDING")
        .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0);
      const connectedCommissions = monthOrders
        .filter(o => o.jobStatus === "COMPLETED")
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
            .filter(o => o.jobStatus === "PENDING")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          connectedCommissions: teamOrders
            .filter(o => o.jobStatus === "COMPLETED")
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
        scopedRepIds = allUsers.filter(u => ["REP", "LEAD"].includes(u.role) && u.status === "ACTIVE").map(u => u.repId);
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
      const reps = allUsers.filter(u => ["REP", "LEAD"].includes(u.role) && u.status === "ACTIVE" && scopedRepIds.includes(u.repId));

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
            .filter(o => o.jobStatus === "PENDING")
            .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned || "0"), 0),
          connectedCommissions: repOrders
            .filter(o => o.jobStatus === "COMPLETED")
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
      
      const { start: periodStart, end: periodEnd } = getPeriodRange(period);
      
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
      
      const { start: periodStart } = getPeriodRange(period);
      const now = new Date();
      
      // Get scoped users based on role
      let scopedUsers: any[] = [];
      const allUsers = await storage.getActiveUsers();
      
      if (user.role === "ADMIN" || user.role === "OPERATIONS") {
        scopedUsers = allUsers.filter(u => ["REP", "LEAD"].includes(u.role));
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
  app.get("/api/admin/scheduled-pay-runs", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
    try {
      const schedules = await storage.getScheduledPayRuns();
      res.json(schedules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create scheduled pay run
  app.post("/api/admin/scheduled-pay-runs", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
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
  app.patch("/api/admin/scheduled-pay-runs/:id", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
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
  app.delete("/api/admin/scheduled-pay-runs/:id", auth, requirePermission("admin:schedpay"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await storage.deleteScheduledPayRun(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger scheduled pay run check
  app.post("/api/admin/scheduled-pay-runs/trigger", auth, requirePermission("financial:create:payruns"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/background-jobs", auth, requirePermission("system:view:jobs"), async (req: AuthRequest, res) => {
    try {
      const jobType = req.query.type as string | undefined;
      const jobs = await storage.getRecentBackgroundJobs(jobType, 50);
      res.json(jobs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Manually trigger chargeback processing
  app.post("/api/admin/chargebacks/process", auth, requirePermission("financial:process:chargebacks"), async (req: AuthRequest, res) => {
    try {
      const { scheduler } = await import("./scheduler");
      await scheduler.processChargebacks();
      res.json({ success: true, message: "Chargeback processing triggered" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/trigger-report", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
    try {
      const { scheduler } = await import("./scheduler");
      const { type } = req.body;
      if (type === "DAILY_SALES_REPORT") {
        const result = await scheduler.generateDailySalesReport();
        res.json({ success: true, message: "Daily sales report triggered", result });
      } else if (type === "DAILY_INSTALL_REPORT") {
        const result = await scheduler.generateDailyInstallReport();
        res.json({ success: true, message: "Daily install report triggered", result });
      } else {
        res.status(400).json({ message: "Invalid type. Use DAILY_SALES_REPORT or DAILY_INSTALL_REPORT" });
      }
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
  app.get("/api/admin/notifications", auth, requirePermission("admin:notifications"), async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as string | undefined;
      const notifications = await storage.getEmailNotifications({ status });
      res.json(notifications);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin: Manually trigger notification sending
  app.post("/api/admin/notifications/send", auth, requirePermission("admin:notifications"), async (req: AuthRequest, res) => {
    try {
      const { emailService } = await import("./email");
      const results = await emailService.sendPendingEmails();
      res.json({ success: true, ...results });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ========== User Activity Tracking ==========

  app.post("/api/activity", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const { page } = req.body;
      if (!page) return res.status(400).json({ message: "Page is required" });
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      const ua = req.headers["user-agent"] || "";
      const deviceType = /Mobile|Android|iPhone|iPad/i.test(ua) ? "Mobile" : "Desktop";
      await storage.createUserActivityLog({
        userId: user.id,
        eventType: "PAGE_VIEW",
        page,
        ipAddress: ip,
        userAgent: ua,
        deviceType,
      });
      await storage.updateUserLastActive(user.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to log activity" });
    }
  });

  app.get("/api/user-activity", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const rangeDays = parseInt(req.query.range as string) || 7;
      const allUsers = await storage.getUsers();
      const logs = await storage.getUserActivityLogs(3000);

      const userMap = new Map(allUsers.map(u => [u.id, {
        name: u.name, repId: u.repId, role: u.role,
        lastLoginAt: u.lastLoginAt, lastLoginIp: u.lastLoginIp,
        lastLoginLocation: u.lastLoginLocation, lastActiveAt: u.lastActiveAt,
        status: u.status,
      }]));

      const enriched = logs.map(log => ({
        ...log,
        userName: userMap.get(log.userId)?.name || "Unknown",
        userRepId: userMap.get(log.userId)?.repId || "",
        userRole: userMap.get(log.userId)?.role || "",
      }));

      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const rangeStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
      const onlineThreshold = new Date(now.getTime() - 5 * 60 * 1000);

      const recentLogins = enriched.filter(l => l.eventType === "LOGIN" && new Date(l.createdAt) >= last24h);
      const uniqueUsersToday = new Set(recentLogins.map(l => l.userId)).size;

      const onlineUsers = allUsers
        .filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= onlineThreshold && u.status === "ACTIVE")
        .map(u => ({
          id: u.id, name: u.name, repId: u.repId, role: u.role,
          lastActiveAt: u.lastActiveAt,
        }));

      const userSummaries = allUsers
        .filter(u => u.status === "ACTIVE" && !u.deletedAt)
        .map(u => ({
          id: u.id, name: u.name, repId: u.repId, role: u.role,
          lastLoginAt: u.lastLoginAt,
          lastLoginIp: u.lastLoginIp,
          lastLoginLocation: u.lastLoginLocation,
          lastActiveAt: u.lastActiveAt,
          isOnline: u.lastActiveAt ? new Date(u.lastActiveAt) >= onlineThreshold : false,
        }))
        .sort((a, b) => {
          if (a.isOnline && !b.isOnline) return -1;
          if (!a.isOnline && b.isOnline) return 1;
          const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
          const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
          return bTime - aTime;
        });

      const rangeLogs = enriched.filter(l => new Date(l.createdAt) >= rangeStart);
      const deviceBreakdown: Record<string, number> = {};
      const locationBreakdown: Record<string, number> = {};
      const pageBreakdown: Record<string, number> = {};
      for (const log of rangeLogs) {
        if (log.deviceType) deviceBreakdown[log.deviceType] = (deviceBreakdown[log.deviceType] || 0) + 1;
        if (log.eventType === "LOGIN" && (log.city || log.region)) {
          const loc = [log.city, log.region].filter(Boolean).join(", ");
          locationBreakdown[loc] = (locationBreakdown[loc] || 0) + 1;
        }
        if (log.page) pageBreakdown[log.page] = (pageBreakdown[log.page] || 0) + 1;
      }

      res.json({
        logs: enriched.slice(0, 500),
        stats: {
          uniqueUsersToday,
          totalLogins24h: recentLogins.length,
          totalEventsRange: rangeLogs.length,
          onlineNow: onlineUsers.length,
        },
        onlineUsers,
        userSummaries,
        deviceBreakdown,
        locationBreakdown,
        pageBreakdown,
        rangeDays,
      });
    } catch (error) {
      console.error("User activity error:", error);
      res.status(500).json({ message: "Failed to fetch activity data" });
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
      // ADMIN/OPERATIONS/EXECUTIVE can see all, others see only their own
      const reports = ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)
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
      
      // Check ownership or admin/executive
      if (existing.userId !== user.id && !["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
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
      
      if (existing.userId !== user.id && !["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role)) {
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
  app.get("/api/admin/employee-credentials", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const credentials = await storage.getAllEmployeeCredentials();
      res.json(credentials);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Get specific user's credentials (all entries)
  app.get("/api/admin/employee-credentials/user/:userId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const targetUser = await storage.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      const credentials = await storage.getEmployeeCredentialsByUser(userId);
      res.json({ user: { ...targetUser, passwordHash: undefined, onboardingOtpHash: undefined }, credentials });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Admin/Executive: Create new credential entry for any user
  app.post("/api/admin/employee-credentials/user/:userId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
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
  app.patch("/api/admin/employee-credentials/:credentialId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
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
  app.delete("/api/admin/employee-credentials/:credentialId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
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
  app.get("/api/admin/mdu/pending", auth, requirePermission("mdu:review"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/mdu/orders", auth, requirePermission("mdu:review"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/mdu/:id/prefill", auth, requirePermission("mdu:review"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/mdu/:id/reject", auth, requirePermission("mdu:review"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/disputes", auth, requirePermission("admin:disputes"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/disputes/:id", auth, requirePermission("admin:disputes"), async (req: AuthRequest, res) => {
    try {
      const result = await storage.getCommissionDisputeById(req.params.id);
      if (!result) return res.status(404).json({ message: "Dispute not found" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dispute" });
    }
  });

  // Admin can update dispute status
  app.patch("/api/admin/disputes/:id/status", auth, requirePermission("admin:disputes"), async (req: AuthRequest, res) => {
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
  app.post("/api/admin/disputes/:id/resolve", auth, requirePermission("financial:resolve:disputes"), async (req: AuthRequest, res) => {
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
  app.get("/api/admin/disputes/count/pending", auth, requirePermission("admin:disputes"), async (req: AuthRequest, res) => {
    try {
      const count = await storage.getPendingDisputesCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Failed to get count" });
    }
  });

  // ===================== FINANCE MODULE ROUTES =====================

  // Get all finance imports
  app.get("/api/finance/imports", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const imports = await storage.getFinanceImports(clientId);
      res.json(imports);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get finance imports" });
    }
  });

  // Get single finance import with summary
  app.get("/api/finance/imports/:id", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }
      res.json(financeImport);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get finance import" });
    }
  });

  // Delete finance import and all related data
  app.delete("/api/finance/imports/:id", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const existing = await storage.getFinanceImportById(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Import not found" });
      }
      await storage.deleteFinanceImport(req.params.id);
      res.json({ message: "Import deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete finance import" });
    }
  });

  // Get finance import summary (counts by status)
  app.get("/api/finance/imports/:id/summary", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const counts = await storage.getFinanceImportRowCounts(req.params.id);
      const financeImport = await storage.getFinanceImportById(req.params.id);
      
      // Calculate totals
      let enrolled = 0, rejected = 0, pending = 0;
      let matched = 0, unmatched = 0, ambiguous = 0, ignored = 0;
      let totalExpectedCents = 0;

      for (const row of counts) {
        const status = row.clientStatus?.toUpperCase();
        if (status === 'ENROLLED' || status === 'ACCEPTED') enrolled += row.count;
        else if (status === 'REJECTED') rejected += row.count;
        else pending += row.count;

        if (row.matchStatus === 'MATCHED') matched += row.count;
        else if (row.matchStatus === 'UNMATCHED') unmatched += row.count;
        else if (row.matchStatus === 'AMBIGUOUS') ambiguous += row.count;
        else if (row.matchStatus === 'IGNORED') ignored += row.count;
      }

      res.json({
        financeImport,
        counts: {
          byClientStatus: { enrolled, rejected, pending },
          byMatchStatus: { matched, unmatched, ambiguous, ignored },
          totalRows: financeImport?.totalRows || 0,
          totalExpectedCents: financeImport?.totalAmountCents || 0
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get import summary" });
    }
  });

  // List sheets in an Excel file
  app.post("/api/finance/import/sheets", auth, requirePermission("admin:finance:imports"), upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const fileName = req.file.originalname;
      const isXlsx = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      if (!isXlsx) {
        return res.json({ sheets: [] });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const masterSheetNames = ['master', 'master report', 'summary', 'all reps', 'combined'];
      const sheets = workbook.SheetNames.map((name: string) => {
        const ws = workbook.Sheets[name];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        let repName = extractRepNameFromSheet(allRows);
        const repCode = extractRepCodeFromSheet(allRows);
        const dataInfo = findDataTableInSheet(allRows);
        const isMasterSheet = masterSheetNames.includes(name.toLowerCase().trim());
        if (!repName && !isMasterSheet) {
          repName = name.trim();
        }
        return {
          name,
          repName,
          repCode,
          repNameSource: repName ? (extractRepNameFromSheet(allRows) ? 'header' : 'tab_name') : null,
          rowCount: dataInfo.rows.length,
          hasData: dataInfo.rows.length > 0,
          preview: dataInfo.rows.slice(0, 3),
          columns: dataInfo.columns,
        };
      });
      res.json({ sheets });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to read sheets" });
    }
  });

  // Upload and import a finance file
  app.post("/api/finance/import", auth, requirePermission("admin:finance:imports"), upload.single("file"), async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { clientId, periodStart, periodEnd, forceReimport, sheetName: selectedSheet, repNameOverride } = req.body;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }

      // Determine source type
      const fileName = req.file.originalname;
      const isXlsx = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      const sourceType = isXlsx ? 'XLSX' : 'CSV';

      // Compute file hash (include sheet name for uniqueness)
      const hashInput = selectedSheet ? req.file.buffer.toString('base64') + '::' + selectedSheet : req.file.buffer.toString('base64');
      const fileHash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // Check for duplicate import
      const existingImport = await storage.getFinanceImportByClientAndHash(clientId, fileHash);
      if (existingImport && !forceReimport) {
        return res.status(409).json({ 
          message: "This file has already been imported for this client",
          existingImportId: existingImport.id
        });
      }

      if (existingImport && forceReimport) {
        await storage.createAuditLog({
          userId: req.user!.id,
          action: "FINANCE_IMPORT_FORCE_REIMPORT",
          tableName: "finance_imports",
          recordId: existingImport.id,
          afterJson: JSON.stringify({ fileName, clientId, reason: "forceReimport flag set by user" }),
        });
      }

      // Parse file
      let rows: any[] = [];
      let detectedRepName: string | null = repNameOverride || null;
      if (isXlsx) {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = selectedSheet || workbook.SheetNames[0];
        if (!workbook.SheetNames.includes(sheetName)) {
          return res.status(400).json({ message: `Sheet "${sheetName}" not found in file` });
        }
        const ws = workbook.Sheets[sheetName];
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        if (!detectedRepName) {
          detectedRepName = extractRepNameFromSheet(allRows);
        }
        if (!detectedRepName && selectedSheet) {
          const masterSheetNames = ['master', 'master report', 'summary', 'all reps', 'combined'];
          if (!masterSheetNames.includes(selectedSheet.toLowerCase().trim())) {
            detectedRepName = selectedSheet.trim();
          }
        }
        
        const dataInfo = findDataTableInSheet(allRows);
        if (dataInfo.columns.length > 0 && dataInfo.rows.length > 0) {
          rows = dataInfo.rows.map(row => {
            const obj: any = {};
            dataInfo.columns.forEach((col, i) => {
              obj[col] = row[i] ?? null;
            });
            return obj;
          });
        } else {
          rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        }
      } else {
        const csvParse = await import('csv-parse/sync');
        rows = csvParse.parse(req.file.buffer, { columns: true, skip_empty_lines: true });
      }

      if (rows.length === 0) {
        return res.status(400).json({ message: "File contains no data rows" });
      }

      // Inject rep name into rows if detected from sheet header
      if (detectedRepName) {
        rows.forEach(row => {
          if (!row['Rep Name'] && !row['rep_name']) {
            row['Rep Name'] = detectedRepName;
          }
        });
      }

      const importFileName = selectedSheet ? `${fileName} [${selectedSheet}]` : fileName;

      // Create finance import record
      const financeImport = await storage.createFinanceImport({
        clientId,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        sourceType: sourceType as any,
        fileName: importFileName,
        fileHash,
        importedByUserId: req.user!.id,
        status: 'IMPORTED',
        totalRows: rows.length,
        totalAmountCents: 0
      });

      // Store raw rows
      const rawRows = rows.map((row, index) => ({
        financeImportId: financeImport.id,
        rowIndex: index,
        rawJson: JSON.stringify(row),
        rawTextFingerprint: computeRowFingerprint(
          clientId,
          normalizeCustomerName(row['Customer Name'] || row['customer_name'] || ''),
          row['Date Sold'] || row['date_sold'] || '',
          0,
          row['Service Type'] || row['service_type'] || ''
        )
      }));

      await storage.createFinanceImportRowsRaw(rawRows);

      const columns = Object.keys(rows[0]);
      const preview = rows.slice(0, 20);

      const autoMapping = tryAutoDetectColumnMapping(columns, clientId, storage);
      let autoMapped = false;
      let normalizedCount = 0;

      if (autoMapping) {
        const createdRawRows = await storage.getFinanceImportRowsRaw(financeImport.id);
        const normalizedRows: any[] = [];
        let totalAmountCents = 0;
        const seenFingerprints = new Set<string>();

        for (const rawRow of createdRawRows) {
          const data = JSON.parse(rawRow.rawJson);
          const customerName = data[autoMapping.customerName] || '';
          const customerNameNorm = normalizeCustomerName(customerName);
          const repName = autoMapping.repName ? (data[autoMapping.repName] || '') : '';
          const repNameNorm = repName ? normalizeCustomerName(repName) : '';
          const serviceType = data[autoMapping.serviceType] || '';
          const utility = data[autoMapping.utility] || '';
          const saleDate = data[autoMapping.saleDate] || '';
          const clientStatus = data[autoMapping.status] || '';
          const usageUnits = parseFloat(data[autoMapping.usage]) || null;
          const rate = parseFloat(String(data[autoMapping.rate] || '0').replace(/[$,]/g, '')) || 0;
          const paidAmountCents = Math.round(rate * 100);
          const rejectionReason = data[autoMapping.rejectionReason] || null;

          const fingerprint = computeRowFingerprint(
            clientId,
            customerNameNorm,
            saleDate,
            paidAmountCents,
            serviceType
          );

          const isDuplicate = seenFingerprints.has(fingerprint);
          seenFingerprints.add(fingerprint);

          const statusUpper = clientStatus.toUpperCase();
          if (!isDuplicate && (statusUpper === 'ENROLLED' || statusUpper === 'ACCEPTED' || statusUpper === 'COMPLETED' || statusUpper === 'ACTIVE')) {
            totalAmountCents += paidAmountCents;
          }

          normalizedRows.push({
            financeImportId: financeImport.id,
            rawRowId: rawRow.id,
            customerName,
            customerNameNorm,
            repName: repName || null,
            repNameNorm: repNameNorm || null,
            serviceType,
            utility,
            saleDate: saleDate || null,
            clientStatus,
            usageUnits: usageUnits?.toString() || null,
            expectedAmountCents: 0,
            paidAmountCents,
            rejectionReason,
            matchStatus: 'UNMATCHED',
            matchConfidence: 0,
            isDuplicate
          });
        }

        await storage.createFinanceImportRows(normalizedRows);
        await storage.updateFinanceImport(financeImport.id, {
          status: 'MAPPED',
          totalAmountCents,
          columnMapping: JSON.stringify(autoMapping)
        });

        autoMapped = true;
        normalizedCount = normalizedRows.length;
      }

      const updatedImport = autoMapped ? await storage.getFinanceImportById(financeImport.id) : financeImport;

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "finance_import_created",
        tableName: "finance_imports",
        recordId: financeImport.id,
        afterJson: JSON.stringify({ fileName: importFileName, totalRows: rows.length, clientId, sheetName: selectedSheet || null, detectedRepName, autoMapped })
      });

      res.json({
        import: updatedImport || financeImport,
        columns,
        preview,
        totalRows: rows.length,
        detectedRepName,
        autoMapped,
        normalizedCount,
      });
    } catch (error: any) {
      console.error("Finance import error:", error);
      res.status(500).json({ message: error.message || "Failed to import file" });
    }
  });

  // Map columns and normalize rows
  app.post("/api/finance/imports/:id/map", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const { mapping, saveAsDefault } = req.body;
      // mapping: { customerName: 'Customer Name', saleDate: 'Date Sold', ... }

      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status === 'POSTED' || financeImport.status === 'LOCKED') {
        return res.status(400).json({ message: "Cannot remap a posted or locked import" });
      }

      // Delete existing processed rows if re-mapping
      if (financeImport.status !== 'IMPORTED') {
        await storage.deleteFinanceImportRows(req.params.id);
      }

      // Get raw rows
      const rawRows = await storage.getFinanceImportRowsRaw(req.params.id);

      // Normalize rows based on mapping
      const normalizedRows: any[] = [];
      let totalAmountCents = 0;
      const seenFingerprints = new Set<string>();

      for (const rawRow of rawRows) {
        const data = JSON.parse(rawRow.rawJson);
        
        const customerName = data[mapping.customerName] || '';
        const customerNameNorm = normalizeCustomerName(customerName);
        const repName = mapping.repName ? (data[mapping.repName] || '') : '';
        const repNameNorm = repName ? normalizeCustomerName(repName) : '';
        const serviceType = data[mapping.serviceType] || '';
        const utility = data[mapping.utility] || '';
        const saleDate = data[mapping.saleDate] || '';
        const clientStatus = data[mapping.status] || '';
        const usageUnits = parseFloat(data[mapping.usage]) || null;
        const rate = parseFloat(String(data[mapping.rate] || '0').replace(/[$,]/g, '')) || 0;
        const paidAmountCents = Math.round(rate * 100);
        const rejectionReason = data[mapping.rejectionReason] || null;

        // Dedupe by fingerprint
        const fingerprint = computeRowFingerprint(
          financeImport.clientId,
          customerNameNorm,
          saleDate,
          paidAmountCents,
          serviceType
        );

        const isDuplicate = seenFingerprints.has(fingerprint);
        seenFingerprints.add(fingerprint);

        const statusUpper = clientStatus.toUpperCase();
        if (!isDuplicate && (statusUpper === 'ENROLLED' || statusUpper === 'ACCEPTED' || statusUpper === 'COMPLETED' || statusUpper === 'ACTIVE')) {
          totalAmountCents += paidAmountCents;
        }

        normalizedRows.push({
          financeImportId: req.params.id,
          rawRowId: rawRow.id,
          customerName,
          customerNameNorm,
          repName: repName || null,
          repNameNorm: repNameNorm || null,
          serviceType,
          utility,
          saleDate: saleDate || null,
          clientStatus,
          usageUnits: usageUnits?.toString() || null,
          expectedAmountCents: 0,
          paidAmountCents,
          rejectionReason,
          matchStatus: 'UNMATCHED',
          matchConfidence: 0,
          isDuplicate
        });
      }

      await storage.createFinanceImportRows(normalizedRows);

      // Update import status and total
      await storage.updateFinanceImport(req.params.id, {
        status: 'MAPPED',
        totalAmountCents,
        columnMapping: JSON.stringify(mapping)
      });

      // Save mapping as default if requested
      if (saveAsDefault) {
        // Clear existing default for this client
        const existingMappings = await storage.getClientColumnMappings(financeImport.clientId);
        for (const m of existingMappings) {
          if (m.isDefault) {
            await storage.updateClientColumnMapping(m.id, { isDefault: false });
          }
        }
        
        await storage.createClientColumnMapping({
          clientId: financeImport.clientId,
          name: 'Default',
          mappingJson: JSON.stringify(mapping),
          isDefault: true
        });
      }

      res.json({ success: true, normalizedCount: normalizedRows.length, totalAmountCents });
    } catch (error: any) {
      console.error("Finance mapping error:", error);
      res.status(500).json({ message: error.message || "Failed to map columns" });
    }
  });

  app.get("/api/finance/imports/:id/raw-rows", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const rows = await storage.getFinanceImportRowsRaw(req.params.id);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get raw rows" });
    }
  });

  // Get normalized rows for an import
  app.get("/api/finance/imports/:id/rows", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const matchStatus = req.query.matchStatus as string | undefined;
      const rows = await storage.getFinanceImportRows(req.params.id, matchStatus);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get rows" });
    }
  });

  // Run auto-matching for an import
  app.post("/api/finance/imports/:id/auto-match", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status === 'POSTED' || financeImport.status === 'LOCKED') {
        return res.status(400).json({ message: "Cannot match a posted or locked import" });
      }

      if (financeImport.status === 'IMPORTED') {
        return res.status(400).json({ message: "Columns have not been mapped yet. Please map columns before running auto-match." });
      }

      const rows = await storage.getFinanceImportRows(req.params.id);

      if (rows.length === 0) {
        return res.status(400).json({ message: "No processed rows found. Please use 'Map Columns' first to create processed rows." });
      }

      const { force } = req.body || {};

      // Reset rows for re-matching
      for (const row of rows) {
        if (force || row.matchStatus === 'UNMATCHED' || row.matchStatus === 'AMBIGUOUS') {
          if (row.matchStatus !== 'IGNORED') {
            await storage.updateFinanceImportRow(row.id, { matchStatus: 'UNMATCHED', matchConfidence: 0, matchedOrderId: null, matchReason: null });
          }
        }
      }

      // Re-fetch after reset
      const freshRows = await storage.getFinanceImportRows(req.params.id);

      let matchedCount = 0;
      let ambiguousCount = 0;

      console.log(`[AutoMatch] Starting auto-match for import ${req.params.id} with ${freshRows.length} processed rows`);

      const matchableRows = freshRows.filter(row =>
        row.matchStatus !== 'MATCHED' && row.matchStatus !== 'IGNORED' && !row.isDuplicate && row.saleDate && !isNaN(new Date(row.saleDate).getTime())
      );
      let allCandidates: any[] = [];
      if (matchableRows.length > 0) {
        const saleDates = matchableRows.map(r => new Date(r.saleDate!).getTime());
        const minDate = new Date(Math.min(...saleDates));
        minDate.setDate(minDate.getDate() - 30);
        const maxDate = new Date(Math.max(...saleDates));
        maxDate.setDate(maxDate.getDate() + 30);
        allCandidates = await storage.findOrdersForMatching(
          null,
          minDate.toISOString().split('T')[0],
          maxDate.toISOString().split('T')[0]
        );
        console.log(`[AutoMatch] Pre-fetched ${allCandidates.length} candidate orders for date range ${minDate.toISOString().split('T')[0]} to ${maxDate.toISOString().split('T')[0]}`);
      }

      for (const row of freshRows) {
        if (row.matchStatus === 'MATCHED' || row.matchStatus === 'IGNORED' || row.isDuplicate) {
          continue;
        }

        if (!row.saleDate) continue;

        const saleDate = new Date(row.saleDate);
        if (isNaN(saleDate.getTime())) continue;
        const startDate = new Date(saleDate);
        startDate.setDate(startDate.getDate() - 30);
        const endDate = new Date(saleDate);
        endDate.setDate(endDate.getDate() + 30);

        const candidates = allCandidates.filter(o => {
          const d = new Date(o.dateSold);
          return d >= startDate && d <= endDate;
        });

        console.log(`[AutoMatch] Row "${row.customerName}" (${row.saleDate}) -> ${candidates.length} candidate orders in range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

        if (candidates.length === 0) continue;

        // Token-based name similarity helper
        const nameTokenOverlap = (a: string, b: string): number => {
          if (!a || !b) return 0;
          const tokensA = a.split(' ').filter(Boolean);
          const tokensB = b.split(' ').filter(Boolean);
          if (tokensA.length === 0 || tokensB.length === 0) return 0;
          const matched = tokensA.filter(t => tokensB.includes(t)).length;
          return matched / Math.max(tokensA.length, tokensB.length);
        };

        // Score candidates
        const scored = candidates.map(order => {
          let score = 0;
          const reasons: string[] = [];

          // Account number matching (max 25 pts) - strong unique identifier
          if (row.customerName && order.accountNumber) {
            const rowAccount = (row.customerName || '').match(/\b\d{6,}\b/)?.[0];
            if (rowAccount && order.accountNumber.includes(rowAccount)) {
              score += 25;
              reasons.push('account_match:+25');
            }
          }

          // Customer name matching (max 40 pts) - token-based for better flexibility
          const orderNameNorm = normalizeCustomerName(order.customerName);
          const rowNameNorm = row.customerNameNorm || '';
          if (orderNameNorm && rowNameNorm) {
            if (orderNameNorm === rowNameNorm) {
              score += 40;
              reasons.push('exact_name_match:+40');
            } else {
              const overlap = nameTokenOverlap(orderNameNorm, rowNameNorm);
              if (overlap >= 0.8) {
                score += 35;
                reasons.push('strong_name_match:+35');
              } else if (overlap >= 0.5) {
                score += 25;
                reasons.push('good_name_match:+25');
              } else if (orderNameNorm.includes(rowNameNorm) || rowNameNorm.includes(orderNameNorm)) {
                score += 20;
                reasons.push('partial_name_match:+20');
              } else if (overlap > 0) {
                score += 10;
                reasons.push('weak_name_match:+10');
              }
            }
          }

          // Rep name matching (max 15 pts)
          if (row.repNameNorm && order.repName) {
            const orderRepNorm = normalizeCustomerName(order.repName);
            if (orderRepNorm === row.repNameNorm) {
              score += 15;
              reasons.push('exact_rep_match:+15');
            } else {
              const repOverlap = nameTokenOverlap(orderRepNorm, row.repNameNorm);
              if (repOverlap >= 0.5) {
                score += 10;
                reasons.push('partial_rep_match:+10');
              }
            }
          }

          // Rate/amount matching (max 15 pts)
          const rowAmount = row.paidAmountCents || row.expectedAmountCents || 0;
          if (rowAmount > 0) {
            const orderGrossCents = Math.round(calcGrossCommission(order) * 100);
            if (order.expectedAmountCents && order.expectedAmountCents === rowAmount) {
              score += 15;
              reasons.push('exact_amount_match:+15');
            } else if (orderGrossCents > 0 && Math.abs(orderGrossCents - rowAmount) <= 50) {
              score += 12;
              reasons.push('close_amount_match:+12');
            } else if (orderGrossCents > 0 && Math.abs(orderGrossCents - rowAmount) <= 200) {
              score += 7;
              reasons.push('near_amount_match:+7');
            }
          }

          // Date proximity (max 10 pts) - graduated scoring
          const orderDate = new Date(order.dateSold);
          const diffDays = Math.abs(saleDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays <= 1) {
            score += 10;
            reasons.push('same_date:+10');
          } else if (diffDays <= 3) {
            score += 8;
            reasons.push('close_date:+8');
          } else if (diffDays <= 7) {
            score += 5;
            reasons.push('near_date:+5');
          } else if (diffDays <= 14) {
            score += 2;
            reasons.push('within_2wk:+2');
          }

          // Service type matching (max 5 pts) - actually compare against order service
          if (row.serviceType && order.serviceName) {
            const rowSvc = row.serviceType.toLowerCase();
            const orderSvc = (order.serviceName as string).toLowerCase();
            if (rowSvc === orderSvc) {
              score += 5;
              reasons.push('exact_service_match:+5');
            } else if (rowSvc.includes(orderSvc) || orderSvc.includes(rowSvc)) {
              score += 3;
              reasons.push('partial_service_match:+3');
            } else {
              const svcKeywords: Record<string, string[]> = {
                internet: ['internet', 'fiber', 'data', 'broadband', 'gig', 'wifi'],
                tv: ['tv', 'television', 'video', 'cable'],
                mobile: ['mobile', 'phone', 'wireless', 'cell'],
                voice: ['voice', 'phone', 'landline'],
                bundle: ['bundle', 'package', 'combo'],
              };
              for (const [, keywords] of Object.entries(svcKeywords)) {
                const rowHit = keywords.some(k => rowSvc.includes(k));
                const orderHit = keywords.some(k => orderSvc.includes(k));
                if (rowHit && orderHit) {
                  score += 3;
                  reasons.push('category_service_match:+3');
                  break;
                }
              }
            }
          }

          // Address matching (max 5 pts) - compare city/zip if available
          if (order.city && row.customerName) {
            const orderCityNorm = (order.city as string).toLowerCase().trim();
            const rowText = (row.customerName || '').toLowerCase();
            if (rowText.includes(orderCityNorm)) {
              score += 2;
              reasons.push('city_hint:+2');
            }
          }
          if (order.zipCode && row.customerName) {
            const rowText = (row.customerName || '').toLowerCase();
            if (rowText.includes(order.zipCode as string)) {
              score += 3;
              reasons.push('zip_hint:+3');
            }
          }

          return { order, score, reasons };
        });

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        if (scored.length > 0 && scored[0].score >= 50) {
          const topScore = scored[0].score;
          const closeMatches = scored.filter(s => s.score >= 50 && topScore - s.score <= 10);

          if (closeMatches.length > 1) {
            // Ambiguous
            await storage.updateFinanceImportRow(row.id, {
              matchStatus: 'AMBIGUOUS',
              matchConfidence: topScore,
              matchReason: JSON.stringify({
                candidates: closeMatches.slice(0, 5).map(c => ({
                  orderId: c.order.id,
                  score: c.score,
                  reasons: c.reasons
                }))
              })
            });
            ambiguousCount++;
          } else {
            // Matched - set expectedAmountCents from matched order's gross commission
            const matchedOrder = scored[0].order;
            const grossCommissionCents = Math.round(calcGrossCommission(matchedOrder) * 100);
            await storage.updateFinanceImportRow(row.id, {
              matchedOrderId: matchedOrder.id,
              matchStatus: 'MATCHED',
              matchConfidence: scored[0].score,
              expectedAmountCents: grossCommissionCents,
              matchReason: JSON.stringify({
                orderId: matchedOrder.id,
                score: scored[0].score,
                reasons: scored[0].reasons
              })
            });
            matchedCount++;
          }
        }
      }

      // Update import status
      await storage.updateFinanceImport(req.params.id, { status: 'MATCHED' });

      res.json({ matchedCount, ambiguousCount });
    } catch (error: any) {
      console.error("Auto-match error:", error);
      res.status(500).json({ message: error.message || "Failed to run auto-match" });
    }
  });

  // Manual match a row to an order
  app.post("/api/finance/imports/:id/manual-match", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const { rowId, orderId } = req.body;
      if (!rowId || !orderId) {
        return res.status(400).json({ message: "Row ID and Order ID are required" });
      }

      const row = await storage.getFinanceImportRowById(rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found" });
      }

      const order = await storage.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const grossCommissionCents = Math.round(calcGrossCommission(order) * 100);
      await storage.updateFinanceImportRow(rowId, {
        matchedOrderId: orderId,
        matchStatus: 'MATCHED',
        matchConfidence: 100,
        expectedAmountCents: grossCommissionCents,
        matchReason: JSON.stringify({ manual: true, matchedBy: req.user!.id })
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to manual match" });
    }
  });

  // Get matched order details for reconciliation review
  app.get("/api/finance/imports/:id/matched-order/:rowId", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const row = await storage.getFinanceImportRowById(req.params.rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found" });
      }
      if (!row.matchedOrderId) {
        return res.status(400).json({ message: "Row is not matched to an order" });
      }

      const order = await storage.getOrderById(row.matchedOrderId);
      if (!order) {
        return res.status(404).json({ message: "Matched order not found" });
      }

      const allProviders = await storage.getProviders();
      const allServices = await storage.getServices();
      const rep = order.repId ? await storage.getUserByRepId(order.repId) : null;

      const baseComm = parseFloat(order.baseCommissionEarned as string || '0') || 0;
      const incEarned = parseFloat(order.incentiveEarned as string || '0') || 0;
      const overrideDed = parseFloat(order.overrideDeduction as string || '0') || 0;
      const grossCommission = baseComm + incEarned;
      const netCommission = grossCommission - overrideDed;

      res.json({
        order: {
          id: order.id,
          customerName: order.customerName,
          invoiceNumber: order.invoiceNumber,
          dateSold: order.dateSold,
          serviceId: order.serviceId,
          providerId: order.providerId,
          repId: order.repId,
          repName: rep?.name || null,
          baseCommissionEarned: baseComm,
          incentiveEarned: incEarned,
          overrideDeduction: overrideDed,
          grossCommission,
          netCommission,
        },
        providers: allProviders,
        services: allServices,
        importRow: {
          customerName: row.customerName,
          repName: row.repName,
          serviceType: row.serviceType,
          expectedAmountCents: row.expectedAmountCents,
          paidAmountCents: row.paidAmountCents,
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get matched order details" });
    }
  });

  // Reconciliation adjustment - adjust order fields during matching
  app.patch("/api/finance/imports/:id/reconcile-order", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const { rowId, orderId, adjustments } = req.body;
      if (!rowId || !orderId) {
        return res.status(400).json({ message: "Row ID and Order ID are required" });
      }

      const row = await storage.getFinanceImportRowById(rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found in this import" });
      }

      const order = await storage.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const updateData: any = { updatedAt: new Date() };
      let commissionChanged = false;

      if (adjustments.serviceId && adjustments.serviceId !== order.serviceId) {
        updateData.serviceId = adjustments.serviceId;
      }
      if (adjustments.providerId && adjustments.providerId !== order.providerId) {
        updateData.providerId = adjustments.providerId;
      }
      if (adjustments.baseCommissionEarned !== undefined) {
        const val = parseFloat(adjustments.baseCommissionEarned);
        if (isNaN(val) || val < 0) return res.status(400).json({ message: "Invalid base commission value" });
        updateData.baseCommissionEarned = val.toString();
        commissionChanged = true;
      }
      if (adjustments.incentiveEarned !== undefined) {
        const val = parseFloat(adjustments.incentiveEarned);
        if (isNaN(val) || val < 0) return res.status(400).json({ message: "Invalid incentive value" });
        updateData.incentiveEarned = val.toString();
        commissionChanged = true;
      }
      if (adjustments.overrideDeduction !== undefined) {
        const val = parseFloat(adjustments.overrideDeduction);
        if (isNaN(val) || val < 0) return res.status(400).json({ message: "Invalid override deduction value" });
        updateData.overrideDeduction = val.toString();
        commissionChanged = true;
      }

      if (commissionChanged) {
        updateData.commissionSource = 'MANUAL_OVERRIDE';
        updateData.calcAt = new Date();

        if (order.paymentStatus === "PAID") {
          const newBase = updateData.baseCommissionEarned !== undefined
            ? parseFloat(updateData.baseCommissionEarned)
            : parseFloat(order.baseCommissionEarned);
          const newIncentive = updateData.incentiveEarned !== undefined
            ? parseFloat(updateData.incentiveEarned)
            : parseFloat(order.incentiveEarned);
          updateData.commissionPaid = (newBase + newIncentive).toFixed(2);
        }
      }

      if (Object.keys(updateData).length > 1) {
        await storage.updateOrder(orderId, updateData);

        if (commissionChanged && order.paymentStatus === "PAID") {
          const lineItems = await storage.getPayStatementLineItemsBySourceId("sales_order", orderId);
          const newBase = updateData.baseCommissionEarned !== undefined
            ? updateData.baseCommissionEarned
            : order.baseCommissionEarned;
          const newIncentive = updateData.incentiveEarned !== undefined
            ? updateData.incentiveEarned
            : order.incentiveEarned;

          const affectedStatementIds = new Set<string>();

          for (const item of lineItems) {
            if (item.category === "Commission") {
              await storage.updatePayStatementLineItem(item.id, { amount: newBase });
              affectedStatementIds.add(item.payStatementId);
            } else if (item.category === "Incentive") {
              await storage.updatePayStatementLineItem(item.id, { amount: newIncentive });
              affectedStatementIds.add(item.payStatementId);
            }
          }

          for (const statementId of affectedStatementIds) {
            const allItems = await storage.getPayStatementLineItems(statementId);
            let grossCommission = 0;
            let incentivesTotal = 0;
            let chargebacksTotal = 0;

            for (const item of allItems) {
              const amt = parseFloat(item.amount);
              if (item.category === "Commission") grossCommission += amt;
              else if (item.category === "Incentive") incentivesTotal += amt;
              else if (item.category === "Chargeback") chargebacksTotal += Math.abs(amt);
            }

            const statement = await storage.getPayStatementById(statementId);
            if (statement) {
              const overrideEarningsTotal = parseFloat(statement.overrideEarningsTotal || "0");
              const deductionsTotal = parseFloat(statement.deductionsTotal || "0");
              const advancesApplied = parseFloat(statement.advancesApplied || "0");
              const taxWithheld = parseFloat(statement.taxWithheld || "0");
              const netPay = grossCommission + incentivesTotal + overrideEarningsTotal - chargebacksTotal - deductionsTotal - advancesApplied - taxWithheld;

              await storage.updatePayStatement(statementId, {
                grossCommission: grossCommission.toFixed(2),
                incentivesTotal: incentivesTotal.toFixed(2),
                chargebacksTotal: chargebacksTotal.toFixed(2),
                netPay: netPay.toFixed(2),
              });
            }
          }
        }

        await storage.createAuditLog({
          userId: req.user!.id,
          action: 'RECONCILIATION_ADJUSTMENT',
          entityType: 'ORDER',
          entityId: orderId,
          details: JSON.stringify({
            financeImportId: req.params.id,
            rowId,
            adjustments,
            previousValues: {
              serviceId: order.serviceId,
              providerId: order.providerId,
              baseCommissionEarned: order.baseCommissionEarned,
              incentiveEarned: order.incentiveEarned,
              overrideDeduction: order.overrideDeduction,
              commissionPaid: order.commissionPaid,
              paymentStatus: order.paymentStatus,
            }
          })
        });

        // Cascade commission changes to AR expectation
        if (commissionChanged) {
          try {
            const arExpectation = await storage.getArExpectationByOrderId(orderId);
            if (arExpectation) {
              const updatedOrder = await storage.getOrderById(orderId);
              const newBase = parseFloat(updatedOrder?.baseCommissionEarned || "0");
              const newIncentive = parseFloat(updatedOrder?.incentiveEarned || "0");
              const newOverride = parseFloat(updatedOrder?.overrideDeduction || "0");
              const newExpectedCents = Math.round((newBase + newIncentive + newOverride) * 100);
              const newVarianceCents = arExpectation.actualAmountCents - newExpectedCents;
              await storage.updateArExpectation(arExpectation.id, {
                expectedAmountCents: newExpectedCents,
                varianceAmountCents: newVarianceCents,
                hasVariance: newVarianceCents !== 0,
              });
            }
          } catch (arErr) {
            console.error("[Reconcile] Failed to cascade commission change to AR:", arErr);
          }
        }
      }

      res.json({ success: true, updatedOrder: await storage.getOrderById(orderId) });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to apply reconciliation adjustment" });
    }
  });

  // Create order from unmatched finance import row
  app.post("/api/finance/imports/:id/create-order", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const { rowId, providerId, serviceId, repId } = req.body;
      if (!rowId || !providerId || !serviceId) {
        return res.status(400).json({ message: "Row ID, Provider ID, and Service ID are required" });
      }

      const row = await storage.getFinanceImportRowById(rowId);
      if (!row || row.financeImportId !== req.params.id) {
        return res.status(404).json({ message: "Row not found in this import" });
      }

      if (row.matchStatus === 'MATCHED') {
        return res.status(400).json({ message: "Row is already matched to an order" });
      }

      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      const rateCents = row.paidAmountCents || row.expectedAmountCents || 0;
      const rateDecimal = (rateCents / 100).toFixed(2);

      let assignedRepId: string | null = null;
      if (repId) {
        const rep = await storage.getUserByRepId(repId);
        if (rep) {
          assignedRepId = repId;
        }
      }

      const orderData: any = {
        clientId: financeImport.clientId,
        providerId,
        serviceId,
        dateSold: row.saleDate || new Date().toISOString().split('T')[0],
        customerName: row.customerName || 'Unknown Customer',
        repId: assignedRepId,
        baseCommissionEarned: rateDecimal,
        incentiveEarned: "0",
        overrideDeduction: "0",
        commissionPaid: "0",
        commissionSource: 'MANUAL_OVERRIDE',
        jobStatus: 'COMPLETED',
        approvalStatus: 'APPROVED',
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        calcAt: new Date(),
        paymentStatus: 'UNPAID',
        exportedToAccounting: false,
        tvSold: false,
        mobileSold: false,
        isMobileOrder: false,
        mobileLinesQty: 0,
        notes: `Created from finance import row. Service: ${row.serviceType || 'N/A'}`,
      };

      const newOrder = await storage.createOrder(orderData);

      await storage.updateFinanceImportRow(rowId, {
        matchedOrderId: newOrder.id,
        matchStatus: 'MATCHED',
        matchConfidence: 100,
        matchReason: JSON.stringify(['created_from_import:+100']),
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: 'ORDER_CREATED_FROM_IMPORT',
        entityType: 'ORDER',
        entityId: newOrder.id,
        details: JSON.stringify({
          financeImportId: req.params.id,
          rowId,
          customerName: row.customerName,
          rateCents,
        })
      });

      res.json({ success: true, order: newOrder });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create order from import row" });
    }
  });

  // Ignore a row
  app.post("/api/finance/imports/:id/ignore-row", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const { rowId, reason } = req.body;
      if (!rowId) {
        return res.status(400).json({ message: "Row ID is required" });
      }

      await storage.updateFinanceImportRow(rowId, {
        matchStatus: 'IGNORED',
        ignoreReason: reason || 'Manually ignored'
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to ignore row" });
    }
  });

  // Post an import (create AR expectations and update orders)
  app.post("/api/finance/imports/:id/post", auth, requirePermission("financial:edit:ar"), async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status === 'POSTED' || financeImport.status === 'LOCKED') {
        return res.status(400).json({ message: "Import has already been posted" });
      }

      const rows = await storage.getFinanceImportRows(req.params.id);
      let arCreated = 0;
      let ordersAccepted = 0;
      let ordersRejected = 0;

      const orderRowGroups: Record<string, typeof rows> = {};
      for (const row of rows) {
        if (row.isDuplicate) continue;
        if (row.matchStatus === 'MATCHED' && row.matchedOrderId) {
          if (!orderRowGroups[row.matchedOrderId]) {
            orderRowGroups[row.matchedOrderId] = [];
          }
          orderRowGroups[row.matchedOrderId].push(row);
        }
      }

      for (const [orderId, groupRows] of Object.entries(orderRowGroups)) {
        const enrolledRows = groupRows.filter(r => {
          const status = (r.clientStatus || '').toUpperCase();
          return status === 'ENROLLED' || status === 'ACCEPTED' || status === 'COMPLETED' || status === 'ACTIVE';
        });
        const rejectedRows = groupRows.filter(r => {
          const status = (r.clientStatus || '').toUpperCase();
          return status === 'REJECTED';
        });

        if (enrolledRows.length > 0) {
          const totalPaidCents = enrolledRows.reduce((sum, r) => sum + (r.paidAmountCents || 0), 0);

          const order = await storage.getOrderById(orderId);
          const orderBase = Math.round(parseFloat(order?.baseCommissionEarned || "0") * 100);
          const orderIncentive = Math.round(parseFloat(order?.incentiveEarned || "0") * 100);
          const orderOverride = Math.round(parseFloat(order?.overrideDeduction || "0") * 100);
          const expectedCents = orderBase + orderIncentive + orderOverride;

          await storage.setOrderClientAcceptance(
            orderId,
            'ACCEPTED',
            expectedCents || undefined
          );
          ordersAccepted++;

          const primaryRow = enrolledRows[0];
          const existingArByRow = await storage.getArExpectationByRowId(primaryRow.id);
          const existingArByOrder = existingArByRow ? existingArByRow : await storage.getArExpectationByOrderId(orderId);
          if (!existingArByOrder) {
            const varianceCents = totalPaidCents - expectedCents;
            let arStatus: string = 'OPEN';
            if (totalPaidCents > 0 && totalPaidCents >= expectedCents) {
              arStatus = 'SATISFIED';
            } else if (totalPaidCents > 0) {
              arStatus = 'PARTIAL';
            }
            await storage.createArExpectation({
              clientId: financeImport.clientId,
              orderId: orderId,
              financeImportRowId: primaryRow.id,
              expectedAmountCents: expectedCents,
              actualAmountCents: totalPaidCents,
              varianceAmountCents: varianceCents,
              expectedFromDate: primaryRow.saleDate || new Date().toISOString().split('T')[0],
              status: arStatus
            });
            arCreated++;
            
            if (arStatus === 'SATISFIED' && order) {
              const orderUpdate: Record<string, any> = {
                paymentStatus: 'PAID',
                paidDate: new Date().toISOString().split('T')[0],
              };
              if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
              if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
              await storage.updateOrder(orderId, orderUpdate);

              if (order.approvalStatus === 'APPROVED' && !order.isPayrollHeld && !order.payrollReadyAt) {
                await storage.setPayrollReady(orderId, "AR_SATISFIED");
              }
            }
          }
        } else if (rejectedRows.length > 0) {
          await storage.setOrderClientAcceptance(orderId, 'REJECTED');
          ordersRejected++;
        }
      }

      // Update import status
      await storage.updateFinanceImport(req.params.id, { status: 'POSTED' });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "finance_import_posted",
        tableName: "finance_imports",
        recordId: req.params.id,
        afterJson: JSON.stringify({ arCreated, ordersAccepted, ordersRejected })
      });

      res.json({ success: true, arCreated, ordersAccepted, ordersRejected });
    } catch (error: any) {
      console.error("Post error:", error);
      res.status(500).json({ message: error.message || "Failed to post import" });
    }
  });

  // Lock an import
  app.post("/api/finance/imports/:id/lock", auth, requirePermission("admin:finance:imports"), async (req: AuthRequest, res) => {
    try {
      const financeImport = await storage.getFinanceImportById(req.params.id);
      if (!financeImport) {
        return res.status(404).json({ message: "Import not found" });
      }

      if (financeImport.status !== 'POSTED') {
        return res.status(400).json({ message: "Only posted imports can be locked" });
      }

      await storage.updateFinanceImport(req.params.id, { status: 'LOCKED' });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to lock import" });
    }
  });

  // AR Expectations endpoints
  app.get("/api/finance/ar", auth, requirePermission("admin:finance:ar"), async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const status = req.query.status as string | undefined;
      const hasVariance = req.query.hasVariance === 'true' ? true : req.query.hasVariance === 'false' ? false : undefined;
      const expectations = await storage.getArExpectations(clientId, status, hasVariance);
      const allUsers = await storage.getUsers();
      const repMap = new Map(allUsers.map(u => [u.repId, u.name]));
      const enriched = expectations.map((ar: any) => {
        const repName = ar.order?.repId ? (repMap.get(ar.order.repId) || ar.order.repId) : null;
        return { ...ar, order: ar.order ? { ...ar.order, repName } : ar.order };
      });
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get AR expectations" });
    }
  });

  app.get("/api/finance/ar/export", auth, requirePermission("admin:finance:ar"), async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const status = req.query.status as string | undefined;
      const hasVariance = req.query.hasVariance === 'true' ? true : req.query.hasVariance === 'false' ? false : undefined;
      const expectations = await storage.getArExpectations(clientId, status, hasVariance);

      const header = "Client,Invoice Number,Customer Name,Status,Expected Amount,Amount Paid,Balance,Variance,Variance Reason,Has Variance,Expected From Date,Satisfied At,Written Off At,Written Off Reason,Created At\n";
      const rows = expectations.map((ar: any) => {
        const expectedDollars = (ar.expectedAmountCents / 100).toFixed(2);
        const actualDollars = (ar.actualAmountCents / 100).toFixed(2);
        const balanceDollars = ((ar.expectedAmountCents - ar.actualAmountCents) / 100).toFixed(2);
        const varianceDollars = (ar.varianceAmountCents / 100).toFixed(2);
        const esc = (v: string | null | undefined) => {
          if (!v) return '';
          return `"${v.replace(/"/g, '""')}"`;
        };
        return [
          esc(ar.client?.name || ar.clientId),
          esc(ar.order?.invoiceNumber || ''),
          esc(ar.order?.customerName || ''),
          ar.status,
          expectedDollars,
          actualDollars,
          balanceDollars,
          varianceDollars,
          esc(ar.varianceReason),
          ar.hasVariance ? 'Yes' : 'No',
          ar.expectedFromDate || '',
          ar.satisfiedAt ? new Date(ar.satisfiedAt).toISOString().split('T')[0] : '',
          ar.writtenOffAt ? new Date(ar.writtenOffAt).toISOString().split('T')[0] : '',
          esc(ar.writtenOffReason),
          ar.createdAt ? new Date(ar.createdAt).toISOString().split('T')[0] : '',
        ].join(',');
      });

      const csv = header + rows.join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ar-export-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to export AR" });
    }
  });

  app.get("/api/finance/ar/summary", auth, requirePermission("admin:finance:ar"), async (req: AuthRequest, res) => {
    try {
      const summary = await storage.getArSummaryByClient();
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get AR summary" });
    }
  });

  // Get single AR expectation with payments
  app.get("/api/finance/ar/:id", auth, requirePermission("admin:finance:ar"), async (req: AuthRequest, res) => {
    try {
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      const repName = ar.order?.repId ? ((await storage.getUserByRepId(ar.order.repId))?.name || ar.order.repId) : null;
      res.json({ ...ar, order: ar.order ? { ...ar.order, repName } : ar.order });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get AR expectation" });
    }
  });

  // Record a payment against an AR expectation
  app.post("/api/finance/ar/:id/payments", auth, requirePermission("financial:edit:ar"), async (req: AuthRequest, res) => {
    try {
      const { amountCents: rawAmountCents, paymentDate, paymentReference, paymentMethod, notes } = req.body;
      
      // Strict numeric validation
      const amountCents = typeof rawAmountCents === 'number' ? rawAmountCents : parseInt(rawAmountCents, 10);
      if (isNaN(amountCents) || amountCents <= 0) {
        return res.status(400).json({ message: "Valid positive payment amount is required" });
      }
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      // Create the payment
      const payment = await storage.createArPayment({
        arExpectationId: req.params.id,
        amountCents,
        paymentDate: paymentDate || new Date().toISOString().split('T')[0],
        paymentReference,
        paymentMethod,
        notes,
        recordedByUserId: req.user!.id,
      });
      
      // Calculate new totals
      const allPayments = await storage.getArPaymentsByExpectationId(req.params.id);
      const totalPaidCents = allPayments.reduce((sum, p) => sum + p.amountCents, 0);
      const varianceCents = totalPaidCents - ar.expectedAmountCents;
      const hasVariance = varianceCents !== 0;
      
      // Determine new status
      let newStatus = ar.status;
      if (totalPaidCents === 0) {
        newStatus = 'OPEN';
      } else if (totalPaidCents >= ar.expectedAmountCents) {
        newStatus = 'SATISFIED';
      } else if (totalPaidCents > 0) {
        newStatus = 'PARTIAL';
      }
      
      // Update the AR expectation
      await storage.updateArExpectation(req.params.id, {
        actualAmountCents: totalPaidCents,
        varianceAmountCents: varianceCents,
        hasVariance,
        status: newStatus,
        satisfiedAt: newStatus === 'SATISFIED' ? new Date() : null,
      });
      
      // When AR is satisfied, mark the linked order as completed, approved, and paid
      if (newStatus === 'SATISFIED' && ar.orderId) {
        const order = await storage.getOrderById(ar.orderId);
        if (order) {
          const orderUpdate: Record<string, any> = {
            paymentStatus: 'PAID',
            paidDate: new Date().toISOString().split('T')[0],
          };
          if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
          if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
          
          await storage.updateOrder(ar.orderId, orderUpdate);
          
          await storage.createAuditLog({
            action: "order_payment_status_updated",
            tableName: "sales_orders",
            recordId: ar.orderId,
            afterJson: JSON.stringify({ ...orderUpdate, reason: 'AR satisfied', arId: req.params.id }),
            userId: req.user!.id,
          });
        }
      } else if (newStatus === 'PARTIAL' && ar.orderId) {
        const order = await storage.getOrderById(ar.orderId);
        if (order && order.paymentStatus !== 'PAID') {
          await storage.updateOrder(ar.orderId, {
            paymentStatus: 'PARTIALLY_PAID',
          });
        }
      }
      
      await storage.createAuditLog({
        action: "ar_payment_recorded",
        tableName: "ar_payments",
        recordId: payment.id,
        afterJson: JSON.stringify({ payment, totalPaidCents, varianceCents, newStatus }),
        userId: req.user!.id,
      });
      
      res.json({ payment, totalPaidCents, varianceCents, newStatus });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to record payment" });
    }
  });

  // Delete an AR payment
  app.delete("/api/finance/ar/payments/:id", auth, requirePermission("financial:edit:ar"), async (req: AuthRequest, res) => {
    try {
      // Find the payment to get its AR expectation ID
      const payment = await db.query.arPayments.findFirst({
        where: eq(arPayments.id, req.params.id)
      });
      
      if (!payment) return res.status(404).json({ message: "Payment not found" });
      
      const arId = payment.arExpectationId;
      await storage.deleteArPayment(req.params.id);
      
      // Recalculate totals for the AR expectation
      const ar = await storage.getArExpectationById(arId);
      if (ar) {
        const allPayments = await storage.getArPaymentsByExpectationId(arId);
        const totalPaidCents = allPayments.reduce((sum, p) => sum + p.amountCents, 0);
        const varianceCents = totalPaidCents - ar.expectedAmountCents;
        const hasVariance = varianceCents !== 0;
        
        let newStatus = 'OPEN';
        if (totalPaidCents >= ar.expectedAmountCents) {
          newStatus = 'SATISFIED';
        } else if (totalPaidCents > 0) {
          newStatus = 'PARTIAL';
        }
        
        await storage.updateArExpectation(arId, {
          actualAmountCents: totalPaidCents,
          varianceAmountCents: varianceCents,
          hasVariance,
          status: newStatus,
          satisfiedAt: newStatus === 'SATISFIED' ? new Date() : null,
        });
        
        // Update linked order's status based on new AR status
        if (ar.orderId) {
          const order = await storage.getOrderById(ar.orderId);
          if (order) {
            const orderUpdate: Record<string, any> = {};
            if (newStatus === 'SATISFIED') {
              orderUpdate.paymentStatus = 'PAID';
              orderUpdate.paidDate = new Date().toISOString().split('T')[0];
              if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
              if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
            } else if (newStatus === 'PARTIAL') {
              orderUpdate.paymentStatus = 'PARTIALLY_PAID';
            } else if (newStatus === 'OPEN') {
              orderUpdate.paymentStatus = 'UNPAID';
            }
            
            if (Object.keys(orderUpdate).length > 0 && orderUpdate.paymentStatus !== order.paymentStatus) {
              await storage.updateOrder(ar.orderId, orderUpdate);
              
              await storage.createAuditLog({
                action: "order_payment_status_updated",
                tableName: "sales_orders",
                recordId: ar.orderId,
                afterJson: JSON.stringify({ ...orderUpdate, reason: 'AR payment deleted', arId }),
                userId: req.user!.id,
              });
            }
          }
        }
      }
      
      await storage.createAuditLog({
        action: "ar_payment_deleted",
        tableName: "ar_payments",
        recordId: req.params.id,
        beforeJson: JSON.stringify(payment),
        userId: req.user!.id,
      });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete payment" });
    }
  });

  // Update variance reason for an AR expectation
  app.patch("/api/finance/ar/:id/variance", auth, requirePermission("financial:edit:ar"), async (req: AuthRequest, res) => {
    try {
      const { varianceReason } = req.body;
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      const updated = await storage.updateArExpectation(req.params.id, {
        varianceReason,
      });
      
      await storage.createAuditLog({
        action: "ar_variance_reason_updated",
        tableName: "ar_expectations",
        recordId: req.params.id,
        beforeJson: JSON.stringify({ varianceReason: ar.varianceReason }),
        afterJson: JSON.stringify({ varianceReason }),
        userId: req.user!.id,
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update variance reason" });
    }
  });

  // Update expected amount for an AR expectation
  app.patch("/api/finance/ar/:id/expected-amount", auth, requirePermission("financial:edit:ar"), async (req: AuthRequest, res) => {
    try {
      const { expectedAmountCents, reason } = req.body;
      
      if (typeof expectedAmountCents !== 'number' || expectedAmountCents < 0) {
        return res.status(400).json({ message: "Valid expected amount is required" });
      }
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      if (ar.status === 'WRITTEN_OFF') {
        return res.status(400).json({ message: "Cannot edit written off AR expectations" });
      }
      
      const oldExpected = ar.expectedAmountCents;
      const varianceCents = ar.actualAmountCents - expectedAmountCents;
      const hasVariance = varianceCents !== 0;
      
      // Determine new status based on updated expected
      let newStatus = ar.status;
      if (ar.actualAmountCents === 0) {
        newStatus = 'OPEN';
      } else if (ar.actualAmountCents >= expectedAmountCents) {
        newStatus = 'SATISFIED';
      } else if (ar.actualAmountCents > 0) {
        newStatus = 'PARTIAL';
      }
      
      const updated = await storage.updateArExpectation(req.params.id, {
        expectedAmountCents,
        varianceAmountCents: varianceCents,
        hasVariance,
        status: newStatus,
        satisfiedAt: newStatus === 'SATISFIED' ? new Date() : null,
      });
      
      // If now satisfied, mark order as completed, approved, and paid
      if (newStatus === 'SATISFIED' && ar.orderId) {
        const order = await storage.getOrderById(ar.orderId);
        if (order) {
          const orderUpdate: Record<string, any> = {
            paymentStatus: 'PAID',
            paidDate: new Date().toISOString().split('T')[0],
          };
          if (order.jobStatus !== 'COMPLETED') orderUpdate.jobStatus = 'COMPLETED';
          if (order.approvalStatus !== 'APPROVED') orderUpdate.approvalStatus = 'APPROVED';
          await storage.updateOrder(ar.orderId, orderUpdate);
        }
      }
      
      await storage.createAuditLog({
        action: "ar_expected_amount_updated",
        tableName: "ar_expectations",
        recordId: req.params.id,
        beforeJson: JSON.stringify({ expectedAmountCents: oldExpected }),
        afterJson: JSON.stringify({ expectedAmountCents, reason, newStatus }),
        userId: req.user!.id,
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to update expected amount" });
    }
  });

  // Write off an AR expectation
  app.post("/api/finance/ar/:id/write-off", auth, requirePermission("financial:edit:ar"), async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ message: "Write-off reason is required" });
      
      const ar = await storage.getArExpectationById(req.params.id);
      if (!ar) return res.status(404).json({ message: "AR expectation not found" });
      
      const updated = await storage.updateArExpectation(req.params.id, {
        status: 'WRITTEN_OFF',
        writtenOffAt: new Date(),
        writtenOffByUserId: req.user!.id,
        writtenOffReason: reason,
      });
      
      await storage.createAuditLog({
        action: "ar_written_off",
        tableName: "ar_expectations",
        recordId: req.params.id,
        afterJson: JSON.stringify({ reason }),
        userId: req.user!.id,
      });
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to write off AR" });
    }
  });

  // Finance Reports
  app.get("/api/finance/reports/enrolled", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
    try {
      const groupBy = req.query.groupBy as string || 'global';
      const period = req.query.period as string || 'month';
      
      // Calculate date range
      const now = new Date();
      let startDate: string;
      let endDate = now.toISOString().split('T')[0];

      switch (period) {
        case 'week':
          const weekStart = new Date(now);
          const wDay = now.getDay();
          weekStart.setDate(now.getDate() + (wDay === 0 ? -6 : 1 - wDay)); // Monday start
          startDate = weekStart.toISOString().split('T')[0];
          break;
        case 'ytd':
          startDate = `${now.getFullYear()}-01-01`;
          break;
        case 'month':
        default:
          startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      }

      if (groupBy === 'rep') {
        const data = await storage.getEnrolledReportByRep(startDate, endDate);
        res.json(data);
      } else {
        const data = await storage.getEnrolledReportGlobal(startDate, endDate);
        res.json(data);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get report" });
    }
  });

  // Get client column mappings
  app.get("/api/finance/column-mappings", auth, requirePermission("admin:finance:columnmaps"), async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }
      const mappings = await storage.getClientColumnMappings(clientId);
      res.json(mappings);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get column mappings" });
    }
  });

  // Get default column mapping for a client
  app.get("/api/finance/column-mappings/default", auth, requirePermission("admin:finance:columnmaps"), async (req: AuthRequest, res) => {
    try {
      const clientId = req.query.clientId as string;
      if (!clientId) {
        return res.status(400).json({ message: "Client ID is required" });
      }
      const mapping = await storage.getDefaultClientColumnMapping(clientId);
      res.json(mapping || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get default mapping" });
    }
  });

  // ============ INSTALL SYNC ROUTES ============

  app.get("/api/admin/install-sync/history", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Only ADMIN or OPERATIONS can access install sync" });
      }
      const runs = await storage.getInstallSyncRuns(50);
      const enriched = await Promise.all(runs.map(async (run) => {
        const runByUser = await storage.getUserById(run.runByUserId);
        return { ...run, runByName: runByUser?.name || "Unknown" };
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch sync history" });
    }
  });

  app.post("/api/admin/install-sync/reverse-approvals", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { orderIds } = req.body;
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: "orderIds array is required" });
      }

      let reversedCount = 0;
      for (const orderId of orderIds) {
        const order = await storage.getOrderById(orderId);
        if (!order || order.approvalStatus !== "APPROVED") continue;

        const beforeJson = JSON.stringify(order);
        const updatedOrder = await storage.updateOrder(orderId, {
          approvalStatus: "UNAPPROVED",
          approvedByUserId: null,
          approvedAt: null,
          jobStatus: "PENDING",
        });

        await storage.createAuditLog({
          action: "install_sync_reverse_approval",
          tableName: "sales_orders",
          recordId: orderId,
          beforeJson,
          afterJson: JSON.stringify(updatedOrder),
          userId: user.id,
        });

        reversedCount++;
      }

      res.json({ message: `Reversed ${reversedCount} approvals`, reversedCount });
    } catch (error: any) {
      console.error("[Install Sync] Reversal error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  const syncUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  app.post("/api/admin/install-sync/run", auth, syncUpload.single("file"), async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!["ADMIN", "OPERATIONS"].includes(user.role)) {
        return res.status(403).json({ message: "Only ADMIN or OPERATIONS can run install sync" });
      }

      const { sheetUrl, emailTo, autoApprove } = req.body;
      const shouldAutoApprove = autoApprove === "true" || autoApprove === true;

      const syncRun = await storage.createInstallSyncRun({
        sheetUrl: sheetUrl || null,
        sourceType: req.file ? "csv_upload" : "google_sheet",
        emailTo: emailTo || null,
        runByUserId: user.id,
        status: "RUNNING",
      });

      try {
        let sheetData;
        if (req.file) {
          const csvContent = req.file.buffer.toString("utf-8");
          sheetData = await parseUploadedCsv(csvContent);
        } else if (sheetUrl) {
          sheetData = await fetchGoogleSheet(sheetUrl);
        } else {
          throw new Error("Please provide either a Google Sheet URL or upload a CSV file.");
        }

        await storage.updateInstallSyncRun(syncRun.id, { totalSheetRows: sheetData.rows.length });

        const pendingOrders = await storage.getPendingUnapprovedOrders();

        const allProviders = await storage.getProviders();
        const providerMap = new Map(allProviders.map(p => [p.id, p.name]));

        const syncUsers = await storage.getUsers();
        const syncRepMap = new Map(syncUsers.map(u => [u.repId, u.name]));
        const orderSummaries: OrderSummary[] = pendingOrders.map((order) => {
          const providerName = order.providerId ? (providerMap.get(order.providerId) || "") : "";
          return {
            id: order.id,
            invoiceNumber: order.invoiceNumber || "",
            customerName: order.customerName,
            houseNumber: order.houseNumber || "",
            streetName: order.streetName || "",
            aptUnit: order.aptUnit || "",
            city: order.city || "",
            zipCode: order.zipCode || "",
            serviceType: order.serviceType || "",
            providerName,
            repName: syncRepMap.get(order.repId) || "",
            dateSold: order.dateSold || "",
            jobStatus: order.jobStatus,
            approvalStatus: order.approvalStatus,
          };
        });

        const matchResult = await matchInstallationsToOrders(sheetData.rows, orderSummaries);

        let approvedCount = 0;
        const approvedOrders: any[] = [];
        const statusUpdatedOrders: any[] = [];

        if (matchResult.matches.length > 0) {
          const now = new Date();
          for (const match of matchResult.matches) {
            const woStatus = (match.sheetData?.WO_STATUS || "").trim().toUpperCase();

            const order = await storage.getOrderById(match.orderId);
            if (!order) continue;

            const beforeJson = JSON.stringify(order);
            const updates: Record<string, any> = {};

            if (woStatus === "CP") {
              if (order.jobStatus !== "COMPLETED") {
                updates.jobStatus = "COMPLETED";
              }
              if (shouldAutoApprove && match.confidence >= 70 && order.approvalStatus !== "APPROVED") {
                let riskScore = 0;
                try {
                  const { scoreChargebackRisk } = await import("./chargebackRiskEngine");
                  const freshRisk = await scoreChargebackRisk(order.id);
                  riskScore = freshRisk.score;
                } catch (riskErr) {
                  console.error(`[InstallSync] Failed to compute chargeback risk for order ${order.id}, skipping auto-approval:`, riskErr);
                  riskScore = 100;
                }
                if (riskScore > 75) {
                  console.log(`[InstallSync] Order ${order.id} skipped auto-approval: chargeback risk ${riskScore} > 75`);
                } else {
                  updates.approvalStatus = "APPROVED";
                  updates.approvedByUserId = user.id;
                  updates.approvedAt = now;
                  const salesRep = await storage.getUserByRepId(order.repId);
                  updates.repRoleAtSale = salesRep?.role || "REP";
                }
              }
            } else if (woStatus === "CN") {
              if (order.jobStatus !== "CANCELED") {
                updates.jobStatus = "CANCELED";
              }
              if (order.approvalStatus === "APPROVED") {
                updates.approvalStatus = "UNAPPROVED";
                updates.approvedByUserId = null;
                updates.approvedAt = null;
              }
            } else if (woStatus === "OP") {
              if (order.jobStatus !== "PENDING") {
                updates.jobStatus = "PENDING";
              }
              if (order.approvalStatus === "APPROVED") {
                updates.approvalStatus = "UNAPPROVED";
                updates.approvedByUserId = null;
                updates.approvedAt = null;
              }
            } else if (woStatus === "ND") {
              if (order.jobStatus !== "PENDING") {
                updates.jobStatus = "PENDING";
              }
              if (order.approvalStatus === "APPROVED") {
                updates.approvalStatus = "UNAPPROVED";
                updates.approvedByUserId = null;
                updates.approvedAt = null;
              }
            }

            if (Object.keys(updates).length === 0) continue;

            const updatedOrder = await storage.updateOrder(match.orderId, updates);

            if (updatedOrder && updates.approvalStatus === "APPROVED") {
              await generateOverrideEarnings(order, updatedOrder);
              approvedOrders.push(updatedOrder);
              approvedCount++;
            } else if (updatedOrder) {
              statusUpdatedOrders.push(updatedOrder);
            }

            await storage.createAuditLog({
              action: updates.approvalStatus === "APPROVED" ? "install_sync_approve" : "install_sync_status_update",
              tableName: "sales_orders",
              recordId: match.orderId,
              beforeJson,
              afterJson: JSON.stringify(updatedOrder),
              userId: user.id,
            });
          }
        }

        let emailSent = false;
        if (emailTo && approvedOrders.length > 0) {
          const allServices = await storage.getServices();
          const serviceMap = new Map(allServices.map(s => [s.id, s.name]));
          const allClients = await storage.getClients();
          const clientMap = new Map(allClients.map(c => [c.id, c.name]));

          const csvHeaders = [
            "Invoice #", "Rep ID", "Rep Name", "Customer Name", "Customer Address",
            "House Number", "Street Name", "Apt/Unit", "City", "Zip Code",
            "Customer Phone", "Customer Email", "Account Number",
            "Client", "Provider", "Service Type",
            "Date Sold", "Install Date", "Install Time", "Install Type",
            "Job Status", "Approval Status", "Approved At",
            "TV Sold", "Mobile Sold", "Mobile Lines Qty",
            "Base Commission", "Incentive", "Override Deduction",
            "Gross Commission", "Net Commission",
            "Payment Status", "Paid Date", "Commission Paid",
            "Notes", "Created At",
          ];

          const emailUsers = await storage.getUsers();
          const emailRepMap = new Map(emailUsers.map(u => [u.repId, u.name]));
          const csvRows = approvedOrders.map((o) => {
            const repName = o.repId ? (emailRepMap.get(o.repId) || "") : "";
            const grossCommission = parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0");
            const netCommission = grossCommission - parseFloat(o.overrideDeduction || "0");
            return [
              o.invoiceNumber || "",
              o.repId || "",
              repName,
              o.customerName || "",
              o.customerAddress || "",
              o.houseNumber || "",
              o.streetName || "",
              o.aptUnit || "",
              o.city || "",
              o.zipCode || "",
              o.customerPhone || "",
              o.customerEmail || "",
              o.accountNumber || "",
              o.clientId ? (clientMap.get(o.clientId) || "") : "",
              o.providerId ? (providerMap.get(o.providerId) || "") : "",
              o.serviceId ? (serviceMap.get(o.serviceId) || "") : "",
              o.dateSold || "",
              o.installDate || "",
              o.installTime || "",
              o.installType || "",
              o.jobStatus || "",
              o.approvalStatus || "",
              o.approvedAt ? new Date(o.approvedAt).toLocaleString() : "",
              o.tvSold ? "Yes" : "No",
              o.mobileSold ? "Yes" : "No",
              String(o.mobileLinesQty || 0),
              o.baseCommissionEarned || "0",
              o.incentiveEarned || "0",
              o.overrideDeduction || "0",
              grossCommission.toFixed(2),
              netCommission.toFixed(2),
              o.paymentStatus || "",
              o.paidDate || "",
              o.commissionPaid || "0",
              o.notes || "",
              o.createdAt ? new Date(o.createdAt).toLocaleString() : "",
            ];
          });

          const csvContent = [csvHeaders, ...csvRows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
          const d = new Date();
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const filename = `install-sync-approved-${dateStr}.csv`;

          const statusSummary = statusUpdatedOrders.length > 0
            ? `\n- Orders with status updated (not approved): ${statusUpdatedOrders.length}`
            : "";

          emailSent = await emailService.sendCsvExportEmail(
            emailTo,
            `Install Sync: ${approvedCount} Orders Approved - ${dateStr}`,
            `The automated install sync has approved ${approvedCount} orders based on installation confirmation data.\n\nPlease find the CSV export attached.\n\nSync Summary:\n- Sheet rows processed: ${sheetData.rows.length}\n- Orders matched: ${matchResult.matches.length}\n- Orders approved: ${approvedCount}${statusSummary}\n- Unmatched records: ${matchResult.unmatched.length}`,
            csvContent,
            filename
          );
        }

        await storage.updateInstallSyncRun(syncRun.id, {
          totalSheetRows: sheetData.rows.length,
          matchedCount: matchResult.matches.length,
          approvedCount,
          unmatchedCount: matchResult.unmatched.length,
          emailSent,
          status: "COMPLETED",
          summary: matchResult.summary,
          matchDetails: JSON.stringify({
            matches: matchResult.matches.map((m) => ({
              sheetRowIndex: m.sheetRowIndex,
              sheetData: m.sheetData,
              orderId: m.orderId,
              orderInvoice: m.orderInvoice,
              orderCustomerName: m.orderCustomerName,
              confidence: m.confidence,
              reasoning: m.reasoning,
            })),
            unmatched: matchResult.unmatched,
          }),
          completedAt: new Date(),
        });

        res.json({
          syncRunId: syncRun.id,
          totalSheetRows: sheetData.rows.length,
          matchedCount: matchResult.matches.length,
          approvedCount,
          unmatchedCount: matchResult.unmatched.length,
          emailSent,
          summary: matchResult.summary,
          matches: matchResult.matches,
          unmatched: matchResult.unmatched,
        });
      } catch (innerError: any) {
        await storage.updateInstallSyncRun(syncRun.id, {
          status: "FAILED",
          errorMessage: innerError.message,
          completedAt: new Date(),
        });
        throw innerError;
      }
    } catch (error: any) {
      console.error("[Install Sync] Error:", error.message);
      res.status(500).json({ message: error.message || "Install sync failed" });
    }
  });

  // ===== Iron Crest Commission Extension Endpoints =====

  app.post("/api/admin/seed-iron-crest-rate-cards", auth, requirePermission("admin:seeddata"), async (req: AuthRequest, res) => {
    try {
      const { rateCardIds, ironCrestRackRateCents, ironCrestProfitBaseCents, directorOverrideCents, adminOverrideCents, accountingOverrideCents } = req.body;
      if (!rateCardIds || !Array.isArray(rateCardIds) || rateCardIds.length === 0) {
        return res.status(400).json({ message: "rateCardIds array is required" });
      }
      const updated: string[] = [];
      for (const rcId of rateCardIds) {
        const rc = await storage.getRateCardById(rcId);
        if (rc) {
          await storage.updateRateCard(rcId, {
            ...(ironCrestRackRateCents !== undefined && { ironCrestRackRateCents }),
            ...(ironCrestProfitBaseCents !== undefined && { ironCrestProfitBaseCents }),
            ...(directorOverrideCents !== undefined && { directorOverrideCents }),
            ...(adminOverrideCents !== undefined && { adminOverrideCents }),
            ...(accountingOverrideCents !== undefined && { accountingOverrideCents }),
          } as any);
          updated.push(rcId);
        }
      }
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "SEED_IRON_CREST_RATE_CARDS",
        tableName: "rate_cards",
        recordId: updated.join(","),
        afterJson: JSON.stringify({ ironCrestRackRateCents, ironCrestProfitBaseCents, directorOverrideCents, adminOverrideCents, accountingOverrideCents, count: updated.length }),
      });
      res.json({ message: `Updated ${updated.length} rate cards`, updatedIds: updated });
    } catch (error: any) {
      console.error("Seed Iron Crest rate cards error:", error);
      res.status(500).json({ message: "Failed to seed rate cards" });
    }
  });

  app.get("/api/admin/reports/iron-crest-profit", auth, requirePermission("financial:view:profit"), async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 90));
      const end = endDate ? new Date(endDate as string) : new Date();

      const filtered = await db.select().from(salesOrders).where(
        and(
          eq(salesOrders.approvalStatus, "APPROVED"),
          gte(salesOrders.dateSold, start.toISOString().split("T")[0]),
          sql`${salesOrders.dateSold} <= ${end.toISOString().split("T")[0]}`
        )
      );

      let totalRepPayout = 0;
      let totalDirectorOverride = 0;
      let totalAdminOverride = 0;
      let totalAccountingOverride = 0;
      let totalRackRate = 0;
      let totalIronCrestProfit = 0;
      let orderCount = 0;

      for (const order of filtered) {
        const repPayout = parseFloat(order.baseCommissionEarned || "0");
        const directorOvr = (order.directorOverrideCents || 0) / 100;
        const adminOvr = (order.adminOverrideCents || 0) / 100;
        const accountingOvr = (order.accountingOverrideCents || 0) / 100;
        const rackRate = (order.ironCrestRackRateCents || 0) / 100;
        const profit = (order.ironCrestProfitCents || 0) / 100;

        totalRepPayout += repPayout;
        totalDirectorOverride += directorOvr;
        totalAdminOverride += adminOvr;
        totalAccountingOverride += accountingOvr;
        totalRackRate += rackRate;
        totalIronCrestProfit += profit;
        orderCount++;
      }

      res.json({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        orderCount,
        totalRackRate: totalRackRate.toFixed(2),
        totalRepPayout: totalRepPayout.toFixed(2),
        totalDirectorOverride: totalDirectorOverride.toFixed(2),
        totalAdminOverride: totalAdminOverride.toFixed(2),
        totalAccountingOverride: totalAccountingOverride.toFixed(2),
        totalIronCrestProfit: totalIronCrestProfit.toFixed(2),
        profitMarginPercent: totalRackRate > 0 ? ((totalIronCrestProfit / totalRackRate) * 100).toFixed(1) : "0.0",
      });
    } catch (error: any) {
      console.error("Iron Crest profit report error:", error);
      res.status(500).json({ message: "Failed to generate profit report" });
    }
  });

  const overrideApprovalAccess = requireRoles("EXECUTIVE", "OPERATIONS", "ACCOUNTING");

  function canApproveOverrideType(userRole: string, overrideType: string): boolean {
    if (userRole === "EXECUTIVE") return ["DIRECTOR_OVERRIDE", "ADMIN_OVERRIDE", "ACCOUNTING_OVERRIDE"].includes(overrideType);
    if (userRole === "OPERATIONS") return ["DIRECTOR_OVERRIDE", "ADMIN_OVERRIDE", "ACCOUNTING_OVERRIDE"].includes(overrideType);
    if (userRole === "ACCOUNTING") return ["ACCOUNTING_OVERRIDE"].includes(overrideType);
    return false;
  }

  app.get("/api/admin/override-earnings/pending", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const { overrideType, recipientUserId, orderId } = req.query;
      const filters: { overrideType?: string; recipientUserId?: string; orderId?: string } = {};
      if (overrideType) filters.overrideType = overrideType as string;
      if (recipientUserId) filters.recipientUserId = recipientUserId as string;
      if (orderId) filters.orderId = orderId as string;

      const pending = await storage.getPendingOverrideEarnings(filters);
      const users = await storage.getUsers();
      const userMap = new Map(users.map(u => [u.id, u]));
      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.id, s.name]));
      const allClients = await storage.getClients();
      const clientMap = new Map(allClients.map(c => [c.id, c.name]));

      const enriched = await Promise.all(pending.map(async (e) => {
        const order = await storage.getOrderById(e.salesOrderId);
        const recipient = userMap.get(e.recipientUserId);
        const rep = order ? userMap.get(Array.from(userMap.values()).find(u => u.repId === order.repId)?.id || "") : null;
        return {
          id: e.id,
          salesOrderId: e.salesOrderId,
          orderInvoiceNumber: order?.invoiceNumber || "",
          orderCustomerName: order?.customerName || "",
          orderDateSold: order?.dateSold || "",
          recipientUserId: e.recipientUserId,
          recipientName: recipient?.fullName || recipient?.name || "Unknown",
          recipientRole: recipient?.role || "Unknown",
          overrideType: e.overrideType || "STANDARD",
          amount: e.amount,
          approvalStatus: e.approvalStatus || "PENDING_APPROVAL",
          createdAt: e.createdAt,
          order: order ? {
            repId: order.repId,
            repName: rep?.fullName || rep?.name || order.repId,
            repRole: order.repRoleAtSale || rep?.role || "REP",
            serviceName: order.serviceId ? (serviceMap.get(order.serviceId) || "") : "",
            providerName: order.clientId ? (clientMap.get(order.clientId) || "") : "",
            jobStatus: order.jobStatus,
            approvalStatus: order.approvalStatus,
          } : null,
        };
      }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Get pending override earnings error:", error);
      res.status(500).json({ message: "Failed to get pending override earnings" });
    }
  });

  app.get("/api/admin/override-earnings/pending/count", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const count = await storage.getPendingOverrideEarningsCount();
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get pending count" });
    }
  });

  app.post("/api/admin/override-earnings/:id/approve", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const earning = await storage.getOverrideEarningById(req.params.id);
      if (!earning) {
        return res.status(404).json({ message: "Override earning not found" });
      }
      if (earning.approvalStatus !== "PENDING_APPROVAL") {
        return res.status(400).json({ message: `Cannot approve: status is ${earning.approvalStatus}` });
      }
      if (earning.recipientUserId === req.user!.id) {
        return res.status(403).json({ message: "Cannot approve your own override earning (self-approval not allowed)" });
      }
      if (!canApproveOverrideType(req.user!.role, earning.overrideType || "STANDARD")) {
        return res.status(403).json({ message: `Your role (${req.user!.role}) cannot approve ${earning.overrideType} overrides` });
      }
      const { note } = req.body || {};
      const updated = await storage.approveOverrideEarning(req.params.id, req.user!.id, note);
      const users = await storage.getUsers();
      const recipientUser = users.find(u => u.id === earning.recipientUserId);
      const order = await storage.getOrderById(earning.salesOrderId);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "OVERRIDE_EARNING_APPROVED",
        tableName: "override_earnings",
        recordId: req.params.id,
        afterJson: JSON.stringify({ approvedBy: req.user!.name, overrideType: earning.overrideType, amount: earning.amount, recipientName: recipientUser?.fullName || recipientUser?.name }),
      });
      if (recipientUser) {
        try {
          await storage.createEmailNotification({
            userId: recipientUser.id,
            notificationType: "OVERRIDE_APPROVED",
            subject: "Override Earning Approved",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} has been approved and will be included in your next pay run.`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Approve override earning error:", error);
      res.status(500).json({ message: "Failed to approve override earning" });
    }
  });

  app.post("/api/admin/override-earnings/:id/reject", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const earning = await storage.getOverrideEarningById(req.params.id);
      if (!earning) {
        return res.status(404).json({ message: "Override earning not found" });
      }
      if (earning.approvalStatus !== "PENDING_APPROVAL") {
        return res.status(400).json({ message: `Cannot reject: status is ${earning.approvalStatus}` });
      }
      if (earning.recipientUserId === req.user!.id) {
        return res.status(403).json({ message: "Cannot reject your own override earning" });
      }
      if (!canApproveOverrideType(req.user!.role, earning.overrideType || "STANDARD")) {
        return res.status(403).json({ message: `Your role (${req.user!.role}) cannot reject ${earning.overrideType} overrides` });
      }
      const { reason } = req.body || {};
      if (!reason) {
        return res.status(400).json({ message: "reason is required" });
      }
      const updated = await storage.rejectOverrideEarning(req.params.id, req.user!.id, reason);
      const users = await storage.getUsers();
      const recipientUser = users.find(u => u.id === earning.recipientUserId);
      const order = await storage.getOrderById(earning.salesOrderId);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "OVERRIDE_EARNING_REJECTED",
        tableName: "override_earnings",
        recordId: req.params.id,
        afterJson: JSON.stringify({ rejectedBy: req.user!.name, reason, overrideType: earning.overrideType, amount: earning.amount, recipientName: recipientUser?.fullName || recipientUser?.name }),
      });
      if (recipientUser) {
        try {
          await storage.createEmailNotification({
            userId: recipientUser.id,
            notificationType: "OVERRIDE_REJECTED",
            subject: "Override Earning Rejected",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} was rejected. Reason: ${reason}`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Reject override earning error:", error);
      res.status(500).json({ message: "Failed to reject override earning" });
    }
  });

  app.post("/api/admin/override-earnings/bulk-approve", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const { ids, note } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array is required" });
      }
      const pendingEarnings = await storage.getPendingOverrideEarnings();
      const userRole = req.user!.role;
      const userId = req.user!.id;

      const skippedIds: string[] = [];
      const skippedReasons: Record<string, string> = {};
      const approvableIds: string[] = [];

      for (const id of ids) {
        const earning = pendingEarnings.find(e => e.id === id);
        if (!earning) {
          skippedIds.push(id);
          skippedReasons[id] = "Not found or not pending";
          continue;
        }
        if (earning.recipientUserId === userId) {
          skippedIds.push(id);
          skippedReasons[id] = "Self-approval not allowed";
          continue;
        }
        if (!canApproveOverrideType(userRole, earning.overrideType || "STANDARD")) {
          skippedIds.push(id);
          skippedReasons[id] = `Role ${userRole} cannot approve ${earning.overrideType}`;
          continue;
        }
        approvableIds.push(id);
      }

      if (approvableIds.length === 0) {
        return res.json({ approved: 0, skipped: skippedIds.length, skippedIds, skippedReasons });
      }

      const updated = await storage.bulkApproveOverrideEarnings(approvableIds, userId, note);
      await storage.createAuditLog({
        userId,
        action: "BULK_APPROVE_OVERRIDE_EARNINGS",
        tableName: "override_earnings",
        recordId: approvableIds.join(","),
        afterJson: JSON.stringify({ count: updated.length, skipped: skippedIds.length }),
      });

      for (const earning of updated) {
        try {
          const order = await storage.getOrderById(earning.salesOrderId);
          await storage.createEmailNotification({
            userId: earning.recipientUserId,
            notificationType: "OVERRIDE_APPROVED",
            subject: "Override Earning Approved",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} has been approved and will be included in your next pay run.`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }

      res.json({ approved: updated.length, skipped: skippedIds.length, skippedIds, skippedReasons });
    } catch (error: any) {
      console.error("Bulk approve override earnings error:", error);
      res.status(500).json({ message: "Failed to bulk approve" });
    }
  });

  app.post("/api/admin/override-earnings/bulk-reject", auth, overrideApprovalAccess, async (req: AuthRequest, res) => {
    try {
      const { ids, reason } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array is required" });
      }
      if (!reason) {
        return res.status(400).json({ message: "reason is required" });
      }
      const pendingEarnings = await storage.getPendingOverrideEarnings();
      const userRole = req.user!.role;
      const userId = req.user!.id;

      const rejectableIds: string[] = [];
      const skippedIds: string[] = [];

      for (const id of ids) {
        const earning = pendingEarnings.find(e => e.id === id);
        if (!earning) { skippedIds.push(id); continue; }
        if (earning.recipientUserId === userId) { skippedIds.push(id); continue; }
        if (!canApproveOverrideType(userRole, earning.overrideType || "STANDARD")) { skippedIds.push(id); continue; }
        rejectableIds.push(id);
      }

      if (rejectableIds.length === 0) {
        return res.json({ rejected: 0, skipped: skippedIds.length });
      }

      const updated = await storage.bulkRejectOverrideEarnings(rejectableIds, userId, reason);
      await storage.createAuditLog({
        userId,
        action: "BULK_REJECT_OVERRIDE_EARNINGS",
        tableName: "override_earnings",
        recordId: rejectableIds.join(","),
        afterJson: JSON.stringify({ count: updated.length, reason }),
      });

      for (const earning of updated) {
        try {
          const order = await storage.getOrderById(earning.salesOrderId);
          await storage.createEmailNotification({
            userId: earning.recipientUserId,
            notificationType: "OVERRIDE_REJECTED",
            subject: "Override Earning Rejected",
            body: `Your ${earning.overrideType} override of $${earning.amount} for order ${order?.invoiceNumber || earning.salesOrderId} was rejected. Reason: ${reason}`,
            recipientEmail: "",
            status: "PENDING",
            isRead: false,
          });
        } catch (e) {}
      }

      res.json({ rejected: updated.length, skipped: skippedIds.length });
    } catch (error: any) {
      console.error("Bulk reject override earnings error:", error);
      res.status(500).json({ message: "Failed to bulk reject" });
    }
  });

  // ===== PAYROLL READINESS ENDPOINTS =====

  app.get("/api/admin/payroll/ready-orders", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING"), async (req: AuthRequest, res) => {
    try {
      const { periodStart, periodEnd } = req.query;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
      const orders = await storage.getPayrollReadyOrders(periodStart as string, periodEnd as string);
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payroll/manual-ready/:orderId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const order = await storage.getOrderById(req.params.orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.approvalStatus !== "APPROVED") return res.status(400).json({ message: "Order must be approved" });
      if (order.payrollReadyAt) return res.status(400).json({ message: "Order already payroll-ready" });

      const updated = await storage.setPayrollReady(req.params.orderId, "MANUAL");
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "payroll_manual_ready",
        tableName: "sales_orders",
        recordId: req.params.orderId,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payroll/hold/:orderId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ message: "Hold reason required" });
      const updated = await storage.setPayrollHold(req.params.orderId, reason);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "payroll_hold",
        tableName: "sales_orders",
        recordId: req.params.orderId,
        afterJson: JSON.stringify({ reason }),
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payroll/release-hold/:orderId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const updated = await storage.releasePayrollHold(req.params.orderId);
      await storage.createAuditLog({
        userId: req.user!.id,
        action: "payroll_release_hold",
        tableName: "sales_orders",
        recordId: req.params.orderId,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== AUTO-BUILD PAY RUN =====

  app.post("/api/admin/payroll/auto-build", auth, requirePermission("financial:create:payruns"), async (req: AuthRequest, res) => {
    try {
      const { periodStart, periodEnd, name } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });

      const readyOrders = await storage.getPayrollReadyOrders(periodStart, periodEnd);
      if (readyOrders.length === 0) return res.status(400).json({ message: "No payroll-ready orders for this period" });

      const weekEnd = periodEnd;
      const payRun = await storage.createPayRun({
        name: name || `Auto Pay Run ${periodStart} to ${periodEnd}`,
        weekEndingDate: weekEnd,
        periodStart,
        periodEnd,
        createdByUserId: req.user!.id,
        status: "DRAFT",
      });

      for (const { order } of readyOrders) {
        await storage.updateOrder(order.id, { payRunId: payRun.id });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "payroll_auto_build",
        tableName: "pay_runs",
        recordId: payRun.id,
        afterJson: JSON.stringify({ orderCount: readyOrders.length, periodStart, periodEnd }),
      });

      res.json({ payRun, orderCount: readyOrders.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/payroll/preview", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING"), async (req: AuthRequest, res) => {
    try {
      const { periodStart, periodEnd } = req.query;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });

      const readyOrders = await storage.getPayrollReadyOrders(periodStart as string, periodEnd as string);

      const byUser: Record<string, { orders: any[]; totalCommission: number; userId: string; userName: string }> = {};
      for (const { order, client, provider, service } of readyOrders) {
        if (!byUser[order.userId]) {
          const user = await storage.getUserById(order.userId);
          byUser[order.userId] = {
            userId: order.userId,
            userName: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Unknown",
            orders: [],
            totalCommission: 0,
          };
        }
        const comm = order.commissionAmount ? parseFloat(order.commissionAmount) : 0;
        byUser[order.userId].totalCommission += comm;
        byUser[order.userId].orders.push({
          orderId: order.id,
          invoiceNumber: order.invoiceNumber,
          clientName: client?.name,
          providerName: provider?.name,
          serviceName: service?.name,
          commissionAmount: comm,
          payrollReadyAt: order.payrollReadyAt,
        });
      }

      res.json({
        periodStart,
        periodEnd,
        totalOrders: readyOrders.length,
        totalCommission: Object.values(byUser).reduce((s, u) => s + u.totalCommission, 0),
        userBreakdown: Object.values(byUser),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== PAY STUB GENERATION =====

  app.post("/api/admin/payroll/generate-stubs/:payRunId", auth, requirePermission("financial:create:payruns"), async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });

      const periodStart = payRun.periodStart || payRun.weekEndingDate;
      const periodEnd = payRun.periodEnd || payRun.weekEndingDate;

      const results = await generatePayStubsForPayRun(req.params.payRunId, periodStart, periodEnd);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "payroll_generate_stubs",
        tableName: "pay_runs",
        recordId: req.params.payRunId,
        afterJson: JSON.stringify({ stubCount: results.length }),
      });

      res.json({ payRunId: req.params.payRunId, stubs: results });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/payroll/finalize/:payRunId", auth, requirePermission("financial:finalize:payruns"), async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });

      const stmts = await storage.getPayStatements(req.params.payRunId);
      if (stmts.length === 0) return res.status(400).json({ message: "No pay statements to finalize" });

      for (const stmt of stmts) {
        await storage.updatePayStatement(stmt.id, {
          isViewableByRep: true,
          status: "ISSUED",
          issuedAt: new Date(),
        } as any);

        if (stmt.repEmail) {
          emailService.queueEmail({
            to: stmt.repEmail,
            subject: `Pay Statement ${stmt.stubNumber} Available`,
            text: `Your pay statement ${stmt.stubNumber} for period ${stmt.periodStart} to ${stmt.periodEnd} is now available. Net Pay: $${stmt.netPay}`,
            html: `<p>Your pay statement <strong>${stmt.stubNumber}</strong> for period ${stmt.periodStart} to ${stmt.periodEnd} is now available.</p><p>Net Pay: <strong>$${stmt.netPay}</strong></p>`,
          });
        }
      }

      await storage.updatePayRun(req.params.payRunId, { status: "FINALIZED", finalizedAt: new Date() });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "payroll_finalize",
        tableName: "pay_runs",
        recordId: req.params.payRunId,
        afterJson: JSON.stringify({ statementCount: stmts.length }),
      });

      res.json({ message: "Pay run finalized", statementCount: stmts.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== FULL-CYCLE ENDPOINT =====

  app.post("/api/admin/payroll/full-cycle", auth, requirePermission("financial:create:payruns"), async (req: AuthRequest, res) => {
    try {
      const { periodStart, periodEnd, name, finalize } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });

      const readyOrders = await storage.getPayrollReadyOrders(periodStart, periodEnd);
      if (readyOrders.length === 0) return res.status(400).json({ message: "No payroll-ready orders" });

      const payRun = await storage.createPayRun({
        name: name || `Full Cycle ${periodStart} to ${periodEnd}`,
        weekEndingDate: periodEnd,
        periodStart,
        periodEnd,
        createdByUserId: req.user!.id,
        status: "DRAFT",
      });

      for (const { order } of readyOrders) {
        await storage.updateOrder(order.id, { payRunId: payRun.id });
      }

      const stubs = await generatePayStubsForPayRun(payRun.id, periodStart, periodEnd);

      if (finalize) {
        const stmts = await storage.getPayStatements(payRun.id);
        for (const stmt of stmts) {
          await storage.updatePayStatement(stmt.id, {
            isViewableByRep: true,
            status: "ISSUED",
            issuedAt: new Date(),
          } as any);

          if (stmt.repEmail) {
            emailService.queueEmail({
              to: stmt.repEmail,
              subject: `Pay Statement ${stmt.stubNumber} Available`,
              text: `Your pay statement ${stmt.stubNumber} for period ${stmt.periodStart} to ${stmt.periodEnd} is now available. Net Pay: $${stmt.netPay}`,
              html: `<p>Your pay statement <strong>${stmt.stubNumber}</strong> for period ${stmt.periodStart} to ${stmt.periodEnd} is now available.</p><p>Net Pay: <strong>$${stmt.netPay}</strong></p>`,
            });
          }
        }
        await storage.updatePayRun(payRun.id, { status: "FINALIZED", finalizedAt: new Date() });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "payroll_full_cycle",
        tableName: "pay_runs",
        recordId: payRun.id,
        afterJson: JSON.stringify({ orderCount: readyOrders.length, stubCount: stubs.length, finalized: !!finalize }),
      });

      res.json({
        payRun,
        orderCount: readyOrders.length,
        stubs,
        finalized: !!finalize,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== PDF GENERATION =====

  app.get("/api/admin/payroll/pdf/:payStatementId", auth, async (req: AuthRequest, res) => {
    try {
      const stmt = await storage.getPayStatementById(req.params.payStatementId);
      if (!stmt) return res.status(404).json({ message: "Pay statement not found" });

      const userRole = req.user!.role;
      const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING"].includes(userRole);
      if (!isAdmin && stmt.userId !== req.user!.id) return res.status(403).json({ message: "Forbidden" });
      if (!isAdmin && !stmt.isViewableByRep) return res.status(403).json({ message: "Pay stub not yet available" });

      const pdf = await generatePayStubPdf(req.params.payStatementId);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${stmt.stubNumber || "paystub"}.pdf"`);
      res.send(pdf);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/payroll/pdf-zip/:payRunId", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING"), async (req: AuthRequest, res) => {
    try {
      const payRun = await storage.getPayRunById(req.params.payRunId);
      if (!payRun) return res.status(404).json({ message: "Pay run not found" });

      const stmts = await storage.getPayStatements(req.params.payRunId);
      if (stmts.length === 0) return res.status(400).json({ message: "No pay statements in this pay run" });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="pay-run-${req.params.payRunId.substring(0, 8)}.zip"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      for (const stmt of stmts) {
        try {
          const pdf = await generatePayStubPdf(stmt.id);
          archive.append(pdf, { name: `${stmt.stubNumber || stmt.id}.pdf` });
        } catch (e) {
          console.error(`Failed to generate PDF for ${stmt.id}:`, e);
        }
      }

      await archive.finalize();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== ACCOUNTING RECONCILIATION ENDPOINTS =====

  app.get("/api/admin/accounting/summary", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
    try {
      const { periodStart, periodEnd } = req.query;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
      const summary = await storage.getAccountingSummary(periodStart as string, periodEnd as string);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/accounting/ar-payroll-reconciliation", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
    try {
      const { periodStart, periodEnd } = req.query;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
      const reconciliation = await storage.getArPayrollReconciliation(periodStart as string, periodEnd as string);
      res.json(reconciliation);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/accounting/variance-report", auth, requirePermission("reports:financial"), async (req: AuthRequest, res) => {
    try {
      const { periodStart, periodEnd } = req.query;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "periodStart and periodEnd required" });
      const report = await storage.getVarianceReport(periodStart as string, periodEnd as string);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ===== ACCOUNTING HOME DASHBOARD =====

  app.get("/api/accounting/home-summary", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING"), async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const periodEnd = now.toISOString().split("T")[0];

      const arOpen = await db.select({
        count: sql<number>`count(*)`,
        totalExpected: sql<string>`COALESCE(SUM("expected_amount_cents"), 0)`,
        totalActual: sql<string>`COALESCE(SUM("actual_amount_cents"), 0)`,
      }).from(arExpectations).where(sql`"status" IN ('OPEN', 'PARTIAL')`);

      const arOverdue = await db.select({
        count: sql<number>`count(*)`,
      }).from(arExpectations).where(sql`"status" IN ('OPEN', 'PARTIAL') AND "created_at" < NOW() - INTERVAL '30 days'`);

      const arSatisfied = await db.select({
        count: sql<number>`count(*)`,
        totalActual: sql<string>`COALESCE(SUM("actual_amount_cents"), 0)`,
      }).from(arExpectations).where(sql`"status" = 'SATISFIED' AND "created_at" >= ${periodStart}::date`);

      const payrollReady = await db.select({
        count: sql<number>`count(*)`,
        totalCommission: sql<string>`COALESCE(SUM(CAST("base_commission_earned" AS DECIMAL) * 100), 0)`,
      }).from(salesOrders).where(sql`"payroll_ready_at" IS NOT NULL AND "pay_run_id" IS NULL`);

      const pendingOverrides = await db.select({
        count: sql<number>`count(*)`,
        totalAmount: sql<string>`COALESCE(SUM(CAST("amount" AS DECIMAL) * 100), 0)`,
      }).from(overrideEarnings).where(sql`"approval_status" = 'PENDING_APPROVAL'`);

      const draftPayRuns = await db.select({ count: sql<number>`count(*)` })
        .from(payRuns).where(eq(payRuns.status, "DRAFT"));

      const scheduledRuns = await db.select().from(scheduledPayRuns)
        .where(eq(scheduledPayRuns.isActive, true))
        .orderBy(scheduledPayRuns.nextRunAt).limit(1);

      const pendingAdvances = await db.select({ count: sql<number>`count(*)` })
        .from(advances).where(sql`"status" = 'PENDING'`);

      const payrollProcessed = await db.select({
        totalNet: sql<string>`COALESCE(SUM(CAST("net_pay" AS DECIMAL) * 100), 0)`,
      }).from(payStatements)
        .innerJoin(payRuns, eq(payStatements.payRunId, payRuns.id))
        .where(sql`"pay_runs"."created_at" >= ${periodStart}::date`);

      const profitData = await db.select({
        totalProfit: sql<string>`COALESCE(SUM("iron_crest_profit_cents"), 0)`,
        totalRackRate: sql<string>`COALESCE(SUM("iron_crest_rack_rate_cents"), 0)`,
      }).from(salesOrders).where(sql`"approved_at" >= ${periodStart}::date`);

      const missingTax = await db.select({ count: sql<number>`count(*)` })
        .from(users).where(sql`"role" IN ('REP', 'LEAD', 'MANAGER') AND "deleted_at" IS NULL AND "id" NOT IN (SELECT DISTINCT "user_id" FROM "tax_documents")`);

      const expectedTotal = parseInt(arOpen[0]?.totalExpected || "0");
      const receivedTotal = parseInt(arSatisfied[0]?.totalActual || "0") + parseInt(arOpen[0]?.totalActual || "0");
      const cashReceived = receivedTotal;
      const payrollOut = parseInt(payrollProcessed[0]?.totalNet || "0");
      const profit = parseInt(profitData[0]?.totalProfit || "0");
      const rackRate = parseInt(profitData[0]?.totalRackRate || "0");

      res.json({
        moneyIn: {
          totalExpectedCents: expectedTotal,
          totalReceivedCents: receivedTotal,
          outstandingCents: Math.max(0, expectedTotal - receivedTotal),
          collectionRate: expectedTotal > 0 ? Math.round((receivedTotal / expectedTotal) * 100) : 100,
          overdueCount: arOverdue[0]?.count || 0,
        },
        moneyOut: {
          payrollReadyOrders: payrollReady[0]?.count || 0,
          payrollReadyTotalCents: parseInt(payrollReady[0]?.totalCommission || "0"),
          pendingOverrides: pendingOverrides[0]?.count || 0,
          pendingOverrideTotalCents: parseInt(pendingOverrides[0]?.totalAmount || "0"),
          nextScheduledRun: scheduledRuns[0]?.nextRunAt || null,
          draftPayRuns: draftPayRuns[0]?.count || 0,
        },
        netPosition: {
          cashReceivedCents: cashReceived,
          payrollProcessedCents: payrollOut,
          netPositionCents: cashReceived - payrollOut,
          profitMtdCents: profit,
          profitMargin: rackRate > 0 ? Math.round((profit / rackRate) * 100) : 0,
          pendingOverrides: pendingOverrides[0]?.count || 0,
          pendingAdvances: pendingAdvances[0]?.count || 0,
          missingTaxProfiles: missingTax[0]?.count || 0,
        },
      });
    } catch (error: any) {
      console.error("Failed to get accounting home summary:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ===== STALE AR ENDPOINT =====

  app.get("/api/admin/payroll/stale-ar", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING"), async (req: AuthRequest, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const staleOrders = await storage.getStaleArOrders(days);
      res.json(staleOrders);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  registerDirectorRoutes(app, storage, auth);
  registerExecutiveRoutes(app, storage, auth);

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

function stripFinancialFields(order: any) {
  const { baseCommissionEarned, incentiveEarned, commissionAmount, overrideDeduction,
    ironCrestRackRateCents, ironCrestProfitCents, directorOverrideCents, adminOverrideCents,
    accountingOverrideCents, ...safe } = order;
  return safe;
}

function registerDirectorRoutes(app: Express, storage: any, auth: any) {
  const directorAccess = requireRoles("EXECUTIVE");

  app.get("/api/director/scoreboard", auth, directorAccess, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      const today = formatDate(nyNow);
      const scope = await storage.getExecutiveScope(user.id);
      const allRepIds = scope.allRepRepIds;

      const allOrders = await db.query.salesOrders.findMany({
        where: and(
          inArray(salesOrders.repId, allRepIds.length > 0 ? allRepIds : [""]),
          gte(salesOrders.dateSold, new Date(nyNow.getFullYear(), nyNow.getMonth(), 1).toISOString().split("T")[0])
        )
      });

      const todayOrders = allOrders.filter(o => o.dateSold === today);
      const todaySales = todayOrders.length;
      const todayConnects = todayOrders.filter(o => o.jobStatus === "COMPLETED").length;
      const todayConnectRate = todaySales > 0 ? Math.round((todayConnects / todaySales) * 100) : 0;

      const weekStart = new Date(nyNow);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = formatDate(weekStart);
      const thisWeekOrders = allOrders.filter(o => o.dateSold >= weekStartStr);
      const thisWeekSales = thisWeekOrders.length;
      const thisWeekConnects = thisWeekOrders.filter(o => o.jobStatus === "COMPLETED").length;

      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekEnd = new Date(weekStart);
      prevWeekEnd.setDate(prevWeekEnd.getDate() - 1);
      const prevWeekOrders = await db.query.salesOrders.findMany({
        where: and(
          inArray(salesOrders.repId, allRepIds.length > 0 ? allRepIds : [""]),
          gte(salesOrders.dateSold, formatDate(prevWeekStart)),
          lte(salesOrders.dateSold, formatDate(prevWeekEnd))
        )
      });
      const lastWeekSales = prevWeekOrders.length;
      const lastWeekConnects = prevWeekOrders.filter(o => o.jobStatus === "COMPLETED").length;

      const mtdSales = allOrders.length;
      const mtdConnects = allOrders.filter(o => o.jobStatus === "COMPLETED").length;

      const goals = await db.query.salesGoals.findMany({
        where: and(
          eq(salesGoals.userId, user.id),
          lte(salesGoals.periodStart, today),
          gte(salesGoals.periodEnd, today)
        )
      });
      const goal = goals[0];
      const salesTarget = goal?.salesTarget || 0;
      const connectsTarget = goal?.connectsTarget || 0;

      const managers = await db.query.users.findMany({
        where: and(
          eq(users.assignedExecutiveId, user.id),
          eq(users.role, "MANAGER"),
          eq(users.status, "ACTIVE"),
          isNull(users.deletedAt)
        )
      });

      const managerLeaderboard = [];
      for (const mgr of managers) {
        const mgrScope = await storage.getManagerScope(mgr.id);
        const mgrRepIds = mgrScope.allRepRepIds;
        const mgrOrders = allOrders.filter(o => mgrRepIds.includes(o.repId));
        const mgrSales = mgrOrders.length;
        const mgrConnects = mgrOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = mgrSales > 0 ? Math.round((mgrConnects / mgrSales) * 100) : 0;

        const last7Start = formatDate(new Date(nyNow.getTime() - 7 * 24 * 60 * 60 * 1000));
        const dailySeries = await storage.getDailyProductionSeries(mgrRepIds.length > 0 ? mgrRepIds : [""], last7Start, today);

        managerLeaderboard.push({
          id: mgr.id,
          name: mgr.name,
          teamSize: mgrRepIds.length,
          sales: mgrSales,
          connects: mgrConnects,
          rate,
          sparkline: dailySeries.map((d: any) => d.connectedCount),
        });
      }
      managerLeaderboard.sort((a, b) => b.connects - a.connects);

      const sevenDaysAgo = new Date(nyNow.getTime() - 7 * 24 * 60 * 60 * 1000);
      const allUsers = await storage.getUsers();
      const teamReps = allUsers.filter((u: any) => allRepIds.includes(u.repId) && u.role === "REP" && u.status === "ACTIVE" && !u.deletedAt);

      const alerts: any[] = [];
      for (const rep of teamReps) {
        const repOrders = allOrders.filter(o => o.repId === rep.repId);
        const lastSaleDate = repOrders.length > 0 ? repOrders.sort((a: any, b: any) => b.dateSold.localeCompare(a.dateSold))[0].dateSold : null;
        const daysSinceLastSale = lastSaleDate ? Math.floor((nyNow.getTime() - new Date(lastSaleDate).getTime()) / (24 * 60 * 60 * 1000)) : 999;

        const mgr = allUsers.find((u: any) => u.id === rep.assignedManagerId);

        if (daysSinceLastSale >= 7) {
          alerts.push({ type: "no_sales", repName: rep.name, managerName: mgr?.name || "Unassigned", daysSinceLastSale, repId: rep.id });
        }

        const weekRepOrders = repOrders.filter(o => o.dateSold >= weekStartStr);
        const weekSales = weekRepOrders.length;
        const weekConnects = weekRepOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const weekRate = weekSales > 0 ? Math.round((weekConnects / weekSales) * 100) : 0;
        if (weekSales >= 2 && weekRate < 50) {
          alerts.push({ type: "low_connect_rate", repName: rep.name, managerName: mgr?.name || "Unassigned", rate: weekRate, repId: rep.id });
        }
      }

      const chargebackReps = await db.query.chargebacks.findMany({
        where: and(
          inArray(chargebacks.repId, allRepIds.length > 0 ? allRepIds : [""]),
          gte(chargebacks.createdAt, sevenDaysAgo)
        )
      });
      for (const cb of chargebackReps) {
        const rep = teamReps.find((r: any) => r.repId === cb.repId);
        const mgr = rep ? allUsers.find((u: any) => u.id === rep.assignedManagerId) : null;
        alerts.push({ type: "chargeback", repName: rep?.name || cb.repId, managerName: mgr?.name || "Unassigned", repId: rep?.id });
      }

      res.json({
        today: { sales: todaySales, connects: todayConnects, connectRate: todayConnectRate },
        thisWeek: { sales: thisWeekSales, connects: thisWeekConnects, lastWeekSales, lastWeekConnects },
        thisMonth: { sales: mtdSales, connects: mtdConnects, salesTarget, connectsTarget, salesGap: salesTarget - mtdSales, connectsGap: connectsTarget - mtdConnects },
        managerLeaderboard,
        alerts,
      });
    } catch (error: any) {
      console.error("Director scoreboard error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/director/production", auth, directorAccess, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const formatDate = (d: Date) => d.toISOString().split("T")[0];

      const startDate = (req.query.startDate as string) || new Date(nyNow.getFullYear(), nyNow.getMonth(), 1).toISOString().split("T")[0];
      const endDate = (req.query.endDate as string) || formatDate(nyNow);
      const scope = await storage.getExecutiveScope(user.id);
      const allRepIds = scope.allRepRepIds;

      const orders = await db.query.salesOrders.findMany({
        where: and(
          inArray(salesOrders.repId, allRepIds.length > 0 ? allRepIds : [""]),
          gte(salesOrders.dateSold, startDate),
          lte(salesOrders.dateSold, endDate)
        )
      });

      const allUsers = await storage.getUsers();
      const servicesList = await storage.getServices();
      const serviceMap = new Map(servicesList.map((s: any) => [s.id, s]));

      const managers = await db.query.users.findMany({
        where: and(eq(users.assignedExecutiveId, user.id), eq(users.role, "MANAGER"), eq(users.status, "ACTIVE"), isNull(users.deletedAt))
      });

      const byManager = [];
      for (const mgr of managers) {
        const mgrScope = await storage.getManagerScope(mgr.id);
        const mgrRepIds = mgrScope.allRepRepIds;
        const mgrOrders = orders.filter(o => mgrRepIds.includes(o.repId));
        const sales = mgrOrders.length;
        const connects = mgrOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = sales > 0 ? Math.round((connects / sales) * 100) : 0;

        const teamReps = allUsers.filter((u: any) => mgrRepIds.includes(u.repId) && u.role === "REP" && u.status === "ACTIVE" && !u.deletedAt);
        let bestRep = null, bestRepConnects = -1;
        let needsAttention = 0;
        const reps = [];

        for (const rep of teamReps) {
          const repOrders = mgrOrders.filter(o => o.repId === rep.repId);
          const repSales = repOrders.length;
          const repConnects = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
          const repRate = repSales > 0 ? Math.round((repConnects / repSales) * 100) : 0;
          const lastSale = repOrders.length > 0 ? repOrders.sort((a: any, b: any) => b.dateSold.localeCompare(a.dateSold))[0].dateSold : null;

          if (repConnects > bestRepConnects) {
            bestRepConnects = repConnects;
            bestRep = rep.name;
          }
          if (repSales === 0 || repRate < 50) needsAttention++;

          reps.push({ id: rep.id, name: rep.name, repId: rep.repId, role: rep.role, sales: repSales, connects: repConnects, rate: repRate, lastSale });
        }

        byManager.push({
          id: mgr.id, name: mgr.name, teamSize: teamReps.length,
          sales, connects, rate, bestRep, needsAttention, reps,
        });
      }

      const teamReps = allUsers.filter((u: any) => allRepIds.includes(u.repId) && ["REP", "LEAD"].includes(u.role) && u.status === "ACTIVE" && !u.deletedAt);
      const byRep = teamReps.map((rep: any) => {
        const repOrders = orders.filter(o => o.repId === rep.repId);
        const sales = repOrders.length;
        const connects = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = sales > 0 ? Math.round((connects / sales) * 100) : 0;
        const lastSale = repOrders.length > 0 ? repOrders.sort((a: any, b: any) => b.dateSold.localeCompare(a.dateSold))[0].dateSold : null;
        const mgr = allUsers.find((u: any) => u.id === rep.assignedManagerId);
        return { id: rep.id, name: rep.name, repId: rep.repId, role: rep.role, manager: mgr?.name || "Unassigned", sales, connects, rate, lastSale };
      }).sort((a: any, b: any) => b.connects - a.connects);

      const byService: any[] = [];
      const serviceGroups = new Map<string, { serviceId: string; name: string; orders: any[] }>();
      for (const o of orders) {
        const svc = serviceMap.get(o.serviceId) || { name: "Unknown" };
        if (!serviceGroups.has(o.serviceId)) {
          serviceGroups.set(o.serviceId, { serviceId: o.serviceId, name: svc.name, orders: [] });
        }
        serviceGroups.get(o.serviceId)!.orders.push(o);
      }
      for (const [, group] of serviceGroups) {
        const total = group.orders.length;
        const connects = group.orders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = total > 0 ? Math.round((connects / total) * 100) : 0;

        let bestMgr = null, bestMgrConnects = -1;
        for (const mgr of managers) {
          const mgrScope = await storage.getManagerScope(mgr.id);
          const mgrConnects = group.orders.filter(o => mgrScope.allRepRepIds.includes(o.repId) && o.jobStatus === "COMPLETED").length;
          if (mgrConnects > bestMgrConnects) {
            bestMgrConnects = mgrConnects;
            bestMgr = mgr.name;
          }
        }
        byService.push({ serviceId: group.serviceId, name: group.name, totalOrders: total, connects, rate, bestManager: bestMgr });
      }
      byService.sort((a, b) => b.totalOrders - a.totalOrders);

      res.json({ byManager, byRep, byService });
    } catch (error: any) {
      console.error("Director production error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/director/analytics", auth, directorAccess, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      const scope = await storage.getExecutiveScope(user.id);
      const allRepIds = scope.allRepRepIds;

      const ninetyDaysAgo = new Date(nyNow.getTime() - 90 * 24 * 60 * 60 * 1000);
      const startDate = formatDate(ninetyDaysAgo);
      const endDate = formatDate(nyNow);

      const dailySeries = await storage.getDailyProductionSeries(
        allRepIds.length > 0 ? allRepIds : [""],
        startDate,
        endDate
      );

      const trendData = dailySeries.map((d: any) => ({
        date: d.date,
        sales: d.soldCount,
        connects: d.connectedCount,
      }));

      const managers = await db.query.users.findMany({
        where: and(eq(users.assignedExecutiveId, user.id), eq(users.role, "MANAGER"), eq(users.status, "ACTIVE"), isNull(users.deletedAt))
      });

      const orders = await db.query.salesOrders.findMany({
        where: and(
          inArray(salesOrders.repId, allRepIds.length > 0 ? allRepIds : [""]),
          gte(salesOrders.dateSold, startDate),
          lte(salesOrders.dateSold, endDate)
        )
      });

      const connectRateByManager = [];
      for (const mgr of managers) {
        const mgrScope = await storage.getManagerScope(mgr.id);
        const mgrOrders = orders.filter(o => mgrScope.allRepRepIds.includes(o.repId));
        const sales = mgrOrders.length;
        const connects = mgrOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = sales > 0 ? Math.round((connects / sales) * 100) : 0;
        connectRateByManager.push({ name: mgr.name, id: mgr.id, sales, connects, rate });
      }

      const servicesList = await storage.getServices();
      const serviceMap = new Map(servicesList.map((s: any) => [s.id, s]));
      const serviceMix: any[] = [];
      const svcGroups = new Map<string, number>();
      for (const o of orders) {
        const name = serviceMap.get(o.serviceId)?.name || "Unknown";
        svcGroups.set(name, (svcGroups.get(name) || 0) + 1);
      }
      for (const [name, count] of svcGroups) {
        serviceMix.push({ name, count, percent: orders.length > 0 ? Math.round((count / orders.length) * 100) : 0 });
      }
      serviceMix.sort((a, b) => b.count - a.count);

      const dayOfWeek = [0, 0, 0, 0, 0, 0, 0];
      const dayOfWeekConnects = [0, 0, 0, 0, 0, 0, 0];
      for (const o of orders) {
        const day = new Date(o.dateSold + "T12:00:00").getDay();
        dayOfWeek[day]++;
        if (o.jobStatus === "COMPLETED") dayOfWeekConnects[day]++;
      }
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayAnalysis = dayNames.map((name, i) => ({ day: name, sales: dayOfWeek[i], connects: dayOfWeekConnects[i] }));

      res.json({ trendData, connectRateByManager, serviceMix, dayAnalysis });
    } catch (error: any) {
      console.error("Director analytics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/director/approvals", auth, directorAccess, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const scope = await storage.getExecutiveScope(user.id);
      const allRepIds = scope.allRepRepIds;

      const pendingOrders = await db.query.salesOrders.findMany({
        where: and(
          inArray(salesOrders.repId, allRepIds.length > 0 ? allRepIds : [""]),
          eq(salesOrders.approvalStatus, "UNAPPROVED")
        )
      });

      const allUsers = await storage.getUsers();
      const servicesList = await storage.getServices();
      const serviceMap = new Map(servicesList.map((s: any) => [s.id, s]));
      const now = new Date();

      const queue = pendingOrders.map(o => {
        const rep = allUsers.find((u: any) => u.repId === o.repId);
        const svc = serviceMap.get(o.serviceId);
        const daysWaiting = Math.floor((now.getTime() - new Date(o.createdAt).getTime()) / (24 * 60 * 60 * 1000));
        return {
          id: o.id,
          repName: rep?.name || o.repId,
          customerName: o.customerName,
          serviceName: svc?.name || "Unknown",
          dateSold: o.dateSold,
          daysWaiting,
          accountNumber: o.accountNumber,
          chargebackRiskScore: o.chargebackRiskScore,
        };
      }).sort((a, b) => b.daysWaiting - a.daysWaiting);

      const approvedByMe = await db.query.salesOrders.findMany({
        where: and(
          eq(salesOrders.approvedByUserId, user.id),
          eq(salesOrders.approvalStatus, "APPROVED")
        ),
        orderBy: [desc(salesOrders.approvedAt)],
        limit: 50
      });

      const history = approvedByMe.map(o => {
        const rep = allUsers.find((u: any) => u.repId === o.repId);
        return {
          id: o.id,
          repName: rep?.name || o.repId,
          approvedAt: o.approvedAt,
          customerName: o.customerName,
        };
      });

      res.json({ queue, history });
    } catch (error: any) {
      console.error("Director approvals error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}

function registerExecutiveRoutes(app: Express, storage: any, auth: any) {
  const execAccess = requireRoles("EXECUTIVE");

  app.get("/api/executive/home-summary", auth, execAccess, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      const mtdStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1).toISOString().split("T")[0];
      const today = formatDate(nyNow);
      const prevMonthStart = new Date(nyNow.getFullYear(), nyNow.getMonth() - 1, 1).toISOString().split("T")[0];
      const prevMonthEnd = new Date(nyNow.getFullYear(), nyNow.getMonth(), 0).toISOString().split("T")[0];

      const mtdProfit = await db.select({
        totalRackRate: sql<string>`COALESCE(SUM("iron_crest_rack_rate_cents"), 0)`,
        totalProfit: sql<string>`COALESCE(SUM("iron_crest_profit_cents"), 0)`,
        soldCount: sql<number>`count(*)`,
        connectedCount: sql<number>`count(*) FILTER (WHERE "job_status" = 'COMPLETED')`,
      }).from(salesOrders).where(sql`"approval_status" = 'APPROVED' AND "date_sold" >= ${mtdStart}::date AND "date_sold" <= ${today}::date`);

      const lmProfit = await db.select({
        totalRackRate: sql<string>`COALESCE(SUM("iron_crest_rack_rate_cents"), 0)`,
        totalProfit: sql<string>`COALESCE(SUM("iron_crest_profit_cents"), 0)`,
      }).from(salesOrders).where(sql`"approval_status" = 'APPROVED' AND "date_sold" >= ${prevMonthStart}::date AND "date_sold" <= ${prevMonthEnd}::date`);

      const mtdRevenue = parseInt(mtdProfit[0]?.totalRackRate || "0");
      const mtdProfitVal = parseInt(mtdProfit[0]?.totalProfit || "0");
      const lmRevenue = parseInt(lmProfit[0]?.totalRackRate || "0");
      const lmProfitVal = parseInt(lmProfit[0]?.totalProfit || "0");
      const profitMargin = mtdRevenue > 0 ? Math.round((mtdProfitVal / mtdRevenue) * 100) : 0;
      const soldCount = mtdProfit[0]?.soldCount || 0;
      const connectedCount = mtdProfit[0]?.connectedCount || 0;
      const connectRate = soldCount > 0 ? Math.round((connectedCount / soldCount) * 100) : 0;

      const revenueDelta = lmRevenue > 0 ? Math.round(((mtdRevenue - lmRevenue) / lmRevenue) * 100) : 0;
      const profitDelta = lmProfitVal > 0 ? Math.round(((mtdProfitVal - lmProfitVal) / lmProfitVal) * 100) : 0;

      const negMarginOrders = await db.select({ count: sql<number>`count(*)` })
        .from(salesOrders).where(sql`"approval_status" = 'APPROVED' AND "iron_crest_profit_cents" < 0 AND "date_sold" >= ${mtdStart}::date`);

      const overduePayRuns = await db.select({ count: sql<number>`count(*)` })
        .from(payRuns).where(sql`"status" IN ('DRAFT', 'PENDING_REVIEW') AND "created_at" < NOW() - INTERVAL '7 days'`);

      const arVariance = await db.select({
        count: sql<number>`count(*)`,
        totalOutstanding: sql<string>`COALESCE(SUM("expected_amount_cents" - "actual_amount_cents"), 0)`,
      }).from(arExpectations).where(sql`"status" IN ('OPEN', 'PARTIAL') AND "created_at" < NOW() - INTERVAL '30 days'`);

      const pendingApprovals = await db.select({ count: sql<number>`count(*)` })
        .from(salesOrders).where(eq(salesOrders.approvalStatus, "UNAPPROVED"));

      const pendingInstalls = await db.select({ count: sql<number>`count(*)` })
        .from(salesOrders).where(sql`"approval_status" = 'APPROVED' AND "job_status" != 'COMPLETED' AND "job_status" != 'CANCELLED'`);

      const pendingOverrides = await db.select({ count: sql<number>`count(*)` })
        .from(overrideEarnings).where(sql`"approval_status" = 'PENDING_APPROVAL'`);

      const draftStubs = await db.select({ count: sql<number>`count(*)` })
        .from(payStatements).where(sql`"status" = 'DRAFT'`);

      const cashReceived = await db.select({
        total: sql<string>`COALESCE(SUM("actual_amount_cents"), 0)`,
      }).from(arExpectations).where(sql`"created_at" >= ${mtdStart}::date`);

      const payrollPaid = await db.select({
        total: sql<string>`COALESCE(SUM(CAST("net_pay" AS DECIMAL) * 100), 0)`,
      }).from(payStatements)
        .innerJoin(payRuns, eq(payStatements.payRunId, payRuns.id))
        .where(sql`"pay_runs"."created_at" >= ${mtdStart}::date AND "pay_runs"."status" = 'FINALIZED'`);

      const receivedCents = parseInt(cashReceived[0]?.total || "0");
      const paidCents = parseInt(payrollPaid[0]?.total || "0");

      const largestArClient = await db.select({
        clientName: sql<string>`COALESCE("clients"."name", 'Unknown')`,
        outstanding: sql<string>`SUM("ar_expectations"."expected_amount_cents" - "ar_expectations"."actual_amount_cents")`,
      }).from(arExpectations)
        .innerJoin(clients, eq(arExpectations.clientId, clients.id))
        .where(sql`"ar_expectations"."status" IN ('OPEN', 'PARTIAL')`)
        .groupBy(sql`"clients"."name"`)
        .orderBy(sql`SUM("ar_expectations"."expected_amount_cents" - "ar_expectations"."actual_amount_cents") DESC`)
        .limit(1);

      const highRiskOrders = await db.select({ count: sql<number>`count(*)` })
        .from(salesOrders).where(sql`"chargeback_risk_score" > 75 AND "approval_status" = 'APPROVED' AND "date_sold" >= ${mtdStart}::date`);

      res.json({
        revenue: { mtdCents: mtdRevenue, deltaPercent: revenueDelta },
        profit: { mtdCents: mtdProfitVal, deltaPercent: profitDelta },
        profitMargin,
        production: { sold: soldCount, connects: connectedCount, rate: connectRate },
        exceptions: {
          critical: {
            negativeMarginOrders: negMarginOrders[0]?.count || 0,
            overduePayRuns: overduePayRuns[0]?.count || 0,
            largeArVariance: parseInt(arVariance[0]?.totalOutstanding || "0"),
            largeArClient: largestArClient[0]?.clientName || null,
            highRiskOrders: highRiskOrders[0]?.count || 0,
          },
          operational: {
            pendingApprovals: pendingApprovals[0]?.count || 0,
            pendingInstalls: pendingInstalls[0]?.count || 0,
          },
          financial: {
            pendingOverrides: pendingOverrides[0]?.count || 0,
            draftStubs: draftStubs[0]?.count || 0,
          },
        },
        cashFlow: {
          receivedCents,
          paidCents,
          netCents: receivedCents - paidCents,
        },
      });
    } catch (error: any) {
      console.error("Executive home summary error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/executive/financial-snapshot", auth, execAccess, async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const mtdStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1).toISOString().split("T")[0];
      const today = nyNow.toISOString().split("T")[0];
      const lmStart = new Date(nyNow.getFullYear(), nyNow.getMonth() - 1, 1).toISOString().split("T")[0];
      const lmEnd = new Date(nyNow.getFullYear(), nyNow.getMonth(), 0).toISOString().split("T")[0];

      async function periodMetrics(start: string, end: string) {
        const data = await db.select({
          totalRackRate: sql<string>`COALESCE(SUM("iron_crest_rack_rate_cents"), 0)`,
          totalRepPayout: sql<string>`COALESCE(SUM(CAST("base_commission_earned" AS DECIMAL) * 100), 0)`,
          totalDirectorOverride: sql<string>`COALESCE(SUM("director_override_cents"), 0)`,
          totalAdminOverride: sql<string>`COALESCE(SUM("admin_override_cents"), 0)`,
          totalAccountingOverride: sql<string>`COALESCE(SUM("accounting_override_cents"), 0)`,
          totalProfit: sql<string>`COALESCE(SUM("iron_crest_profit_cents"), 0)`,
        }).from(salesOrders).where(sql`"approval_status" = 'APPROVED' AND "date_sold" >= ${start}::date AND "date_sold" <= ${end}::date`);
        const row = data[0];
        const rr = parseInt(row?.totalRackRate || "0");
        const rp = parseInt(row?.totalRepPayout || "0");
        const dOvr = parseInt(row?.totalDirectorOverride || "0");
        const aOvr = parseInt(row?.totalAdminOverride || "0");
        const acOvr = parseInt(row?.totalAccountingOverride || "0");
        const profit = parseInt(row?.totalProfit || "0");
        return {
          revenueCents: rr,
          repPayoutsCents: rp,
          overridePayoutsCents: dOvr + aOvr + acOvr,
          profitCents: profit,
          profitMargin: rr > 0 ? Math.round((profit / rr) * 100) : 0,
        };
      }

      const thisMonth = await periodMetrics(mtdStart, today);
      const lastMonth = await periodMetrics(lmStart, lmEnd);

      const servicesList = await storage.getServices();
      const serviceMap = new Map(servicesList.map((s: any) => [s.id, s]));
      const profitOrders = await db.query.salesOrders.findMany({
        where: and(eq(salesOrders.approvalStatus, "APPROVED"), gte(salesOrders.dateSold, mtdStart), lte(salesOrders.dateSold, today))
      });
      const svcProfit = new Map<string, { name: string; profitCents: number; rackRateCents: number; count: number }>();
      for (const o of profitOrders) {
        const svc = serviceMap.get(o.serviceId);
        const name = svc?.name || "Unknown";
        const entry = svcProfit.get(name) || { name, profitCents: 0, rackRateCents: 0, count: 0 };
        entry.profitCents += o.ironCrestProfitCents || 0;
        entry.rackRateCents += o.ironCrestRackRateCents || 0;
        entry.count++;
        svcProfit.set(name, entry);
      }
      const profitByService = [...svcProfit.values()].sort((a, b) => b.profitCents - a.profitCents);

      const user = req.user!;
      const managers = await db.query.users.findMany({
        where: and(eq(users.assignedExecutiveId, user.id), eq(users.role, "MANAGER"), eq(users.status, "ACTIVE"), isNull(users.deletedAt))
      });
      const profitByManager = [];
      for (const mgr of managers) {
        const mgrScope = await storage.getManagerScope(mgr.id);
        const mgrOrders = profitOrders.filter(o => mgrScope.allRepRepIds.includes(o.repId));
        const profitCents = mgrOrders.reduce((sum: number, o: any) => sum + (o.ironCrestProfitCents || 0), 0);
        const rackRateCents = mgrOrders.reduce((sum: number, o: any) => sum + (o.ironCrestRackRateCents || 0), 0);
        profitByManager.push({ name: mgr.name, id: mgr.id, profitCents, rackRateCents, orderCount: mgrOrders.length });
      }
      profitByManager.sort((a, b) => b.profitCents - a.profitCents);

      const payrollReady = await db.select({
        count: sql<number>`count(*)`,
        totalCents: sql<string>`COALESCE(SUM(CAST("base_commission_earned" AS DECIMAL) * 100), 0)`,
      }).from(salesOrders).where(sql`"payroll_ready_at" IS NOT NULL AND "pay_run_id" IS NULL`);

      const approvedOverrides = await db.select({
        totalCents: sql<string>`COALESCE(SUM(CAST("amount" AS DECIMAL) * 100), 0)`,
      }).from(overrideEarnings).where(eq(overrideEarnings.approvalStatus, "APPROVED"));

      const outstandingAdvances = await db.select({
        totalCents: sql<string>`COALESCE(SUM(CAST("remaining_balance" AS DECIMAL) * 100), 0)`,
      }).from(advances).where(sql`"status" = 'ACTIVE'`);

      const payrollReadyCents = parseInt(payrollReady[0]?.totalCents || "0");
      const overrideCents = parseInt(approvedOverrides[0]?.totalCents || "0");
      const advanceCents = parseInt(outstandingAdvances[0]?.totalCents || "0");

      const arHealth = await db.select({
        totalExpected: sql<string>`COALESCE(SUM("expected_amount_cents"), 0)`,
        totalActual: sql<string>`COALESCE(SUM("actual_amount_cents"), 0)`,
        overdueCount: sql<number>`count(*) FILTER (WHERE "created_at" < NOW() - INTERVAL '30 days')`,
        avgDays: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - "created_at")) / 86400)::int, 0)`,
      }).from(arExpectations).where(sql`"status" IN ('OPEN', 'PARTIAL')`);

      const satisfied30d = await db.select({
        totalActual: sql<string>`COALESCE(SUM("actual_amount_cents"), 0)`,
        totalExpected: sql<string>`COALESCE(SUM("expected_amount_cents"), 0)`,
      }).from(arExpectations).where(sql`"status" = 'SATISFIED' AND "created_at" >= NOW() - INTERVAL '30 days'`);

      const satActual = parseInt(satisfied30d[0]?.totalActual || "0");
      const satExpected = parseInt(satisfied30d[0]?.totalExpected || "0");
      const collectionRate = satExpected > 0 ? Math.round((satActual / satExpected) * 100) : 100;

      const riskClient = await db.select({
        clientName: sql<string>`COALESCE("clients"."name", 'Unknown')`,
        outstanding: sql<string>`SUM("ar_expectations"."expected_amount_cents" - "ar_expectations"."actual_amount_cents")`,
        daysOld: sql<number>`MAX(EXTRACT(EPOCH FROM (NOW() - "ar_expectations"."created_at")) / 86400)::int`,
      }).from(arExpectations)
        .innerJoin(clients, eq(arExpectations.clientId, clients.id))
        .where(sql`"ar_expectations"."status" IN ('OPEN', 'PARTIAL') AND "ar_expectations"."created_at" < NOW() - INTERVAL '30 days'`)
        .groupBy(sql`"clients"."name"`)
        .orderBy(sql`SUM("ar_expectations"."expected_amount_cents" - "ar_expectations"."actual_amount_cents") DESC`)
        .limit(1);

      res.json({
        periodComparison: { thisMonth, lastMonth },
        profitByService,
        profitByManager,
        payrollObligations: {
          readyToPayCents: payrollReadyCents,
          readyToPayCount: payrollReady[0]?.count || 0,
          overrideApprovedCents: overrideCents,
          advancesOutstandingCents: advanceCents,
          totalObligationCents: payrollReadyCents + overrideCents + advanceCents,
        },
        arHealth: {
          collectionRate,
          overdueCents: parseInt(arHealth[0]?.totalExpected || "0") - parseInt(arHealth[0]?.totalActual || "0"),
          overdueCount: arHealth[0]?.overdueCount || 0,
          avgDaysToCollect: parseInt(arHealth[0]?.avgDays || "0"),
          riskClient: riskClient[0] ? {
            name: riskClient[0].clientName,
            outstandingCents: parseInt(riskClient[0].outstanding || "0"),
            daysOverdue: riskClient[0].daysOld || 0,
          } : null,
        },
      });
    } catch (error: any) {
      console.error("Executive financial snapshot error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/executive/production", auth, execAccess, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      const startDate = (req.query.startDate as string) || new Date(nyNow.getFullYear(), nyNow.getMonth(), 1).toISOString().split("T")[0];
      const endDate = (req.query.endDate as string) || formatDate(nyNow);
      const scope = await storage.getExecutiveScope(user.id);
      const allRepIds = scope.allRepRepIds;

      const orders = await db.query.salesOrders.findMany({
        where: and(
          inArray(salesOrders.repId, allRepIds.length > 0 ? allRepIds : [""]),
          gte(salesOrders.dateSold, startDate),
          lte(salesOrders.dateSold, endDate)
        )
      });

      const allUsers = await storage.getUsers();
      const servicesList = await storage.getServices();
      const serviceMap = new Map(servicesList.map((s: any) => [s.id, s]));

      const managers = await db.query.users.findMany({
        where: and(eq(users.assignedExecutiveId, user.id), eq(users.role, "MANAGER"), eq(users.status, "ACTIVE"), isNull(users.deletedAt))
      });

      const byManager = [];
      for (const mgr of managers) {
        const mgrScope = await storage.getManagerScope(mgr.id);
        const mgrRepIds = mgrScope.allRepRepIds;
        const mgrOrders = orders.filter(o => mgrRepIds.includes(o.repId));
        const sales = mgrOrders.length;
        const connects = mgrOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = sales > 0 ? Math.round((connects / sales) * 100) : 0;
        const payoutCents = mgrOrders.reduce((sum: number, o: any) => sum + Math.round(parseFloat(o.baseCommissionEarned || "0") * 100), 0);
        const profitCents = mgrOrders.reduce((sum: number, o: any) => sum + (o.ironCrestProfitCents || 0), 0);

        const teamReps = allUsers.filter((u: any) => mgrRepIds.includes(u.repId) && u.role === "REP" && u.status === "ACTIVE" && !u.deletedAt);
        const reps = teamReps.map((rep: any) => {
          const repOrders = mgrOrders.filter(o => o.repId === rep.repId);
          const repSales = repOrders.length;
          const repConnects = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
          const repRate = repSales > 0 ? Math.round((repConnects / repSales) * 100) : 0;
          const repPayout = repOrders.reduce((sum: number, o: any) => sum + Math.round(parseFloat(o.baseCommissionEarned || "0") * 100), 0);
          return { id: rep.id, name: rep.name, repId: rep.repId, sales: repSales, connects: repConnects, rate: repRate, payoutCents: repPayout };
        });

        byManager.push({ id: mgr.id, name: mgr.name, teamSize: teamReps.length, sales, connects, rate, payoutCents, profitCents, reps });
      }

      const teamReps = allUsers.filter((u: any) => allRepIds.includes(u.repId) && ["REP", "LEAD"].includes(u.role) && u.status === "ACTIVE" && !u.deletedAt);
      const byRep = teamReps.map((rep: any) => {
        const repOrders = orders.filter(o => o.repId === rep.repId);
        const sales = repOrders.length;
        const connects = repOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = sales > 0 ? Math.round((connects / sales) * 100) : 0;
        const payoutCents = repOrders.reduce((sum: number, o: any) => sum + Math.round(parseFloat(o.baseCommissionEarned || "0") * 100), 0);
        const mgr = allUsers.find((u: any) => u.id === rep.assignedManagerId);
        return { id: rep.id, name: rep.name, repId: rep.repId, manager: mgr?.name || "Unassigned", sales, connects, rate, payoutCents };
      }).sort((a: any, b: any) => b.connects - a.connects);

      const byService: any[] = [];
      const serviceGroups = new Map<string, any[]>();
      for (const o of orders) {
        const name = serviceMap.get(o.serviceId)?.name || "Unknown";
        if (!serviceGroups.has(name)) serviceGroups.set(name, []);
        serviceGroups.get(name)!.push(o);
      }
      for (const [name, svcOrders] of serviceGroups) {
        const total = svcOrders.length;
        const connects = svcOrders.filter(o => o.jobStatus === "COMPLETED").length;
        const rate = total > 0 ? Math.round((connects / total) * 100) : 0;
        const payoutCents = svcOrders.reduce((sum: number, o: any) => sum + Math.round(parseFloat(o.baseCommissionEarned || "0") * 100), 0);
        const profitCents = svcOrders.reduce((sum: number, o: any) => sum + (o.ironCrestProfitCents || 0), 0);
        byService.push({ name, totalOrders: total, connects, rate, payoutCents, profitCents });
      }
      byService.sort((a, b) => b.totalOrders - a.totalOrders);

      res.json({ byManager, byRep, byService });
    } catch (error: any) {
      console.error("Executive production error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==========================================
  // INTEGRATION 1 — Carrier File Automation
  // ==========================================

  app.get("/api/admin/carrier-schedules", auth, requirePermission("admin:integrations"), async (_req: AuthRequest, res) => {
    try {
      const schedules = await db.select().from(carrierImportSchedules).orderBy(desc(carrierImportSchedules.createdAt));
      const clientsList = await storage.getClients();
      const clientMap = new Map(clientsList.map((c: any) => [c.id, c.name]));
      const enriched = schedules.map(s => ({ ...s, clientName: clientMap.get(s.clientId) || "Unknown" }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/carrier-schedules", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const { clientId, sourceType, sftpHost, sftpPort, sftpUser, sftpPasswordEncrypted, sftpRemotePath, emailTriggerDomain, fileNamePattern, columnMappingJson, frequency } = req.body;
      const [schedule] = await db.insert(carrierImportSchedules).values({
        clientId, sourceType: sourceType || "manual",
        sftpHost, sftpPort, sftpUser, sftpPasswordEncrypted, sftpRemotePath,
        emailTriggerDomain, fileNamePattern, columnMappingJson,
        frequency: frequency || "daily",
        createdByUserId: req.user!.id,
      }).returning();
      await db.insert(integrationLogs).values({
        integrationType: "CARRIER_IMPORT", action: "SCHEDULE_CREATED",
        details: JSON.stringify({ scheduleId: schedule.id, clientId, sourceType }),
      });
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/carrier-schedules/:id", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const updates: any = { updatedAt: new Date() };
      const allowed = ["sourceType", "sftpHost", "sftpPort", "sftpUser", "sftpPasswordEncrypted", "sftpRemotePath", "emailTriggerDomain", "fileNamePattern", "columnMappingJson", "frequency", "isActive"];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const [updated] = await db.update(carrierImportSchedules).set(updates).where(eq(carrierImportSchedules.id, req.params.id)).returning();
      if (!updated) return res.status(404).json({ message: "Schedule not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/carrier-schedules/:id", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      await db.delete(carrierImportSchedules).where(eq(carrierImportSchedules.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/integrations/carrier-email-webhook", async (req, res) => {
    try {
      const webhookSecret = process.env.CARRIER_WEBHOOK_SECRET;
      if (webhookSecret) {
        const sig = req.headers["x-webhook-signature"] as string;
        if (!sig) return res.status(401).json({ message: "Missing signature" });
        const expected = crypto.createHmac("sha256", webhookSecret).update(JSON.stringify(req.body)).digest("hex");
        if (sig !== expected) return res.status(401).json({ message: "Invalid signature" });
      }

      const { from, subject, attachments } = req.body;
      if (!from || !attachments || attachments.length === 0) {
        return res.status(400).json({ message: "Missing from or attachments" });
      }
      const senderDomain = from.split("@")[1]?.toLowerCase();
      if (!senderDomain) return res.status(400).json({ message: "Invalid sender" });

      const schedules = await db.select().from(carrierImportSchedules)
        .where(and(eq(carrierImportSchedules.isActive, true), sql`LOWER("email_trigger_domain") = ${senderDomain}`));

      if (schedules.length === 0) {
        await db.insert(integrationLogs).values({
          integrationType: "CARRIER_EMAIL", action: "UNRECOGNIZED_SENDER", status: "SKIPPED",
          details: JSON.stringify({ from, subject, domain: senderDomain }),
        });
        return res.json({ status: "skipped", reason: "No matching carrier schedule" });
      }

      const schedule = schedules[0];
      const results = [];
      for (const attachment of attachments) {
        const fileBuffer = Buffer.from(attachment.content, "base64");
        const fileName = attachment.filename || `carrier-${Date.now()}.csv`;

        const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        const existing = await db.select().from(financeImports).where(and(eq(financeImports.clientId, schedule.clientId), eq(financeImports.fileHash, fileHash)));
        if (existing.length > 0) {
          results.push({ filename: fileName, status: "duplicate" });
          continue;
        }

        let rows: any[] = [];
        if (fileName.endsWith(".csv")) {
          rows = parse(fileBuffer.toString(), { columns: true, skip_empty_lines: true, relax_column_count: true });
        } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
          const wb = XLSX.read(fileBuffer, { type: "buffer" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws);
        }

        if (rows.length === 0) {
          results.push({ filename: fileName, status: "empty" });
          continue;
        }

        const totalAmount = rows.reduce((sum: number, r: any) => {
          const val = parseFloat(r["Amount"] || r["amount"] || r["Commission"] || r["commission"] || "0");
          return sum + (isNaN(val) ? 0 : val);
        }, 0);

        const [imp] = await db.insert(financeImports).values({
          clientId: schedule.clientId,
          fileName,
          fileHash,
          sourceType: "CSV",
          totalRows: rows.length,
          totalAmount: totalAmount.toString(),
          status: "IMPORTED",
          uploadedByUserId: schedule.createdByUserId,
        }).returning();

        for (let i = 0; i < rows.length; i++) {
          const rawJson = JSON.stringify(rows[i]);
          const fingerprint = crypto.createHash("md5").update(rawJson).digest("hex");
          await db.execute(sql`INSERT INTO "finance_import_rows_raw" ("id", "finance_import_id", "row_index", "raw_json", "raw_text_fingerprint", "created_at") VALUES (gen_random_uuid(), ${imp.id}, ${i + 1}, ${rawJson}, ${fingerprint}, NOW())`);
        }

        await db.update(carrierImportSchedules).set({ lastRunAt: new Date(), lastRunStatus: "SUCCESS" }).where(eq(carrierImportSchedules.id, schedule.id));
        results.push({ filename: fileName, status: "imported", importId: imp.id, rows: rows.length });
      }

      await db.insert(integrationLogs).values({
        integrationType: "CARRIER_EMAIL", action: "FILES_RECEIVED",
        details: JSON.stringify({ from, subject, results }),
      });

      const opsUsers = await db.select().from(users).where(and(eq(users.role, "OPERATIONS"), eq(users.status, "ACTIVE")));
      for (const u of opsUsers) {
        await emailService.queueEmail(u.email || "", "Carrier File Received", `A carrier file was received from ${senderDomain}. ${results.length} file(s) processed.`);
      }

      res.json({ status: "processed", results });
    } catch (error: any) {
      console.error("Carrier email webhook error:", error);
      await db.insert(integrationLogs).values({
        integrationType: "CARRIER_EMAIL", action: "WEBHOOK_ERROR", status: "ERROR",
        details: error.message,
      });
      res.status(500).json({ message: error.message });
    }
  });

  // ==========================================
  // INTEGRATION 2 — ACH Payment Processing
  // ==========================================

  app.post("/api/integrations/ach/submit", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const { achExportId } = req.body;
      if (!achExportId) return res.status(400).json({ message: "achExportId required" });

      const [achExport] = await db.select().from(sql`ach_exports`).where(sql`"id" = ${achExportId}`);
      if (!achExport) return res.status(404).json({ message: "ACH export not found" });
      if ((achExport as any).status !== "PENDING") return res.status(400).json({ message: "ACH export must be in PENDING status" });

      const items = await db.select().from(sql`ach_export_items`).where(sql`"ach_export_id" = ${achExportId}`);

      const nachaLines: string[] = [];
      const batchNum = (achExport as any).batchNumber || "0000001";
      const effectiveDate = new Date((achExport as any).effectiveDate || Date.now());
      const yymmdd = effectiveDate.toISOString().slice(2, 10).replace(/-/g, "");
      const companyName = "IRON CREST LLC".padEnd(16);
      const companyId = "1234567890";

      nachaLines.push(`101 091000019${companyId.padEnd(10)}${yymmdd}0000A094101${companyName}IRON CREST CRM         `);
      nachaLines.push(`5200${companyName}${companyId.padStart(10)}PPD PAYROLL   ${yymmdd}${yymmdd}   1091000010000001`);

      let entryCount = 0;
      let totalDebit = 0;
      let totalCredit = 0;
      let entryHash = 0;

      for (const item of items) {
        const stmt = await db.select().from(payStatements).where(eq(payStatements.id, (item as any).payStatementId));
        if (stmt.length === 0) continue;
        const s = stmt[0];
        const netPayCents = Math.round(parseFloat(s.netPay || "0") * 100);
        if (netPayCents <= 0) continue;

        const bankAcct = await db.select().from(sql`user_bank_accounts`).where(sql`"user_id" = ${s.userId} AND "is_primary" = true`).limit(1);
        if (bankAcct.length === 0) continue;
        const bank = bankAcct[0] as any;
        const routingNum = (bank.routingNumber || "").padStart(9, "0");
        const accountNum = (bank.accountNumberEncrypted || "").padEnd(17);

        entryCount++;
        entryHash += parseInt(routingNum.slice(0, 8)) || 0;
        totalCredit += netPayCents;
        const amountStr = netPayCents.toString().padStart(10, "0");
        const seqNum = entryCount.toString().padStart(7, "0");
        const acctType = bank.accountType === "SAVINGS" ? "37" : "27";
        const recvName = (s.repName || "REP").substring(0, 22).padEnd(22);

        nachaLines.push(`6${acctType}${routingNum}${accountNum}${amountStr}${s.userId?.substring(0, 15).padEnd(15)}${recvName} 0091000010${seqNum}`);
      }

      nachaLines.push(`8200${entryCount.toString().padStart(6, "0")}${(entryHash % 10000000000).toString().padStart(10, "0")}${totalDebit.toString().padStart(12, "0")}${totalCredit.toString().padStart(12, "0")}${companyId.padStart(10)}                         091000010000001`);

      const blockCount = Math.ceil((nachaLines.length + 1) / 10);
      nachaLines.push(`9000001${("000001").padStart(6, "0")}${entryCount.toString().padStart(8, "0")}${(entryHash % 10000000000).toString().padStart(10, "0")}${totalDebit.toString().padStart(12, "0")}${totalCredit.toString().padStart(12, "0")}${"".padStart(39)}`);

      while (nachaLines.length % 10 !== 0) nachaLines.push("9".repeat(94));
      const nachaContent = nachaLines.join("\n");

      await db.execute(sql`UPDATE "ach_exports" SET "status" = 'SUBMITTED', "file_path" = ${"nacha-" + achExportId + ".txt"} WHERE "id" = ${achExportId}`);

      await db.insert(integrationLogs).values({
        integrationType: "ACH", action: "NACHA_SUBMITTED",
        details: JSON.stringify({ achExportId, entryCount, totalCredit, batchNum }),
        relatedEntityId: achExportId,
      });

      res.json({
        status: "submitted",
        nachaPreview: nachaLines.slice(0, 5).join("\n") + "\n...",
        entryCount,
        totalAmountCents: totalCredit,
        message: "NACHA file generated. Submit to your banking partner to initiate ACH transfers.",
      });
    } catch (error: any) {
      console.error("ACH submit error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/integrations/ach/confirm-settlement", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const { achExportId, settlementReference } = req.body;
      if (!achExportId) return res.status(400).json({ message: "achExportId required" });

      await db.execute(sql`UPDATE "ach_exports" SET "status" = 'SETTLED' WHERE "id" = ${achExportId}`);

      const items = await db.select().from(sql`ach_export_items`).where(sql`"ach_export_id" = ${achExportId}`);
      let settled = 0;
      for (const item of items) {
        const stmtId = (item as any).payStatementId;
        await db.update(payStatements).set({
          status: "PAID",
          paidAt: new Date(),
          paymentReference: settlementReference || `ACH-${achExportId}`,
        }).where(eq(payStatements.id, stmtId));
        settled++;
      }

      await db.insert(integrationLogs).values({
        integrationType: "ACH", action: "SETTLEMENT_CONFIRMED",
        details: JSON.stringify({ achExportId, settlementReference, statementsSettled: settled }),
        relatedEntityId: achExportId,
      });

      res.json({ status: "settled", statementsUpdated: settled });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ==========================================
  // INTEGRATION 3 — Calendar Integration
  // ==========================================

  app.get("/api/admin/calendar-config", auth, requirePermission("admin:integrations"), async (_req: AuthRequest, res) => {
    try {
      const configs = await db.select().from(calendarSyncConfig);
      res.json(configs.length > 0 ? { ...configs[0], accessToken: configs[0].accessToken ? "***configured***" : null, refreshToken: configs[0].refreshToken ? "***configured***" : null } : null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/calendar-config", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const { calendarId, accessToken, refreshToken } = req.body;
      const existing = await db.select().from(calendarSyncConfig);
      if (existing.length > 0) {
        const updates: any = { updatedAt: new Date() };
        if (calendarId !== undefined) updates.calendarId = calendarId;
        if (accessToken !== undefined) updates.accessToken = accessToken;
        if (refreshToken !== undefined) updates.refreshToken = refreshToken;
        if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
        const [updated] = await db.update(calendarSyncConfig).set(updates).where(eq(calendarSyncConfig.id, existing[0].id)).returning();
        res.json({ ...updated, accessToken: "***", refreshToken: "***" });
      } else {
        const [created] = await db.insert(calendarSyncConfig).values({
          calendarId, accessToken, refreshToken,
          isActive: true, configuredByUserId: req.user!.id,
        }).returning();
        res.json({ ...created, accessToken: "***", refreshToken: "***" });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/integrations/calendar/sync-order", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const { orderId } = req.body;
      const order = await storage.getOrderById(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const configs = await db.select().from(calendarSyncConfig).where(eq(calendarSyncConfig.isActive, true));
      if (configs.length === 0) return res.json({ status: "skipped", reason: "Calendar not configured" });

      const config = configs[0];
      const eventData = {
        summary: `Install: ${order.customerName} — ${order.serviceName || "Service"}`,
        description: `Customer: ${order.customerName}\nAddress: ${order.customerAddress || "N/A"}\nService: ${order.serviceName || "N/A"}\nRep: ${order.repId}\nOrder: ${order.invoiceNumber || order.id}`,
        start: order.installDate || order.dateSold,
        location: order.customerAddress || "",
      };

      await db.insert(integrationLogs).values({
        integrationType: "CALENDAR", action: "EVENT_SYNCED",
        details: JSON.stringify({ orderId, calendarId: config.calendarId, event: eventData }),
        relatedEntityId: orderId,
      });

      res.json({ status: "synced", event: eventData, message: "Calendar event queued. Connect Google Calendar OAuth to enable live sync." });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ==========================================
  // INTEGRATION 4 — Reporting Webhooks + API Keys
  // ==========================================

  app.get("/api/admin/api-keys", auth, requirePermission("admin:integrations"), async (_req: AuthRequest, res) => {
    try {
      const keys = await db.select({
        id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt,
        usageCount: apiKeys.usageCount, expiresAt: apiKeys.expiresAt,
        isActive: apiKeys.isActive, createdAt: apiKeys.createdAt,
      }).from(apiKeys).orderBy(desc(apiKeys.createdAt));
      res.json(keys);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/api-keys", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const { name, scopes, expiresAt } = req.body;
      if (!name) return res.status(400).json({ message: "Name required" });

      const rawKey = `ic_${crypto.randomBytes(32).toString("hex")}`;
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 10) + "...";

      const [key] = await db.insert(apiKeys).values({
        name, keyHash, keyPrefix,
        scopes: scopes || "production-summary,ar-status,payroll-summary",
        createdByUserId: req.user!.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      }).returning();

      await db.insert(integrationLogs).values({
        integrationType: "API_KEY", action: "KEY_CREATED",
        details: JSON.stringify({ keyId: key.id, name, scopes: key.scopes }),
      });

      res.json({ ...key, rawKey, message: "Save this key — it will not be shown again." });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/admin/api-keys/:id", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  async function authenticateApiKey(req: Request, res: Response, scope: string): Promise<boolean> {
    const authHeader = req.headers["x-api-key"] || req.headers.authorization?.replace("Bearer ", "");
    if (!authHeader || typeof authHeader !== "string") {
      res.status(401).json({ error: "API key required. Pass via X-Api-Key header." });
      return false;
    }
    const keyHash = crypto.createHash("sha256").update(authHeader).digest("hex");
    const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));
    if (!key) { res.status(401).json({ error: "Invalid API key" }); return false; }
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) { res.status(401).json({ error: "API key expired" }); return false; }
    const allowedScopes = key.scopes.split(",").map(s => s.trim());
    if (!allowedScopes.includes(scope)) { res.status(403).json({ error: `Key not authorized for scope: ${scope}` }); return false; }
    await db.update(apiKeys).set({ lastUsedAt: new Date(), usageCount: sql`"usage_count" + 1` }).where(eq(apiKeys.id, key.id));
    return true;
  }

  app.get("/api/v1/webhooks/production-summary", async (req, res) => {
    if (!(await authenticateApiKey(req, res, "production-summary"))) return;
    try {
      const now = new Date();
      const nyNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const mtdStart = new Date(nyNow.getFullYear(), nyNow.getMonth(), 1).toISOString().split("T")[0];
      const today = nyNow.toISOString().split("T")[0];

      const metrics = await db.select({
        totalSold: sql<number>`count(*)`,
        totalConnects: sql<number>`count(*) FILTER (WHERE "job_status" = 'COMPLETED')`,
        totalRevenueCents: sql<string>`COALESCE(SUM("iron_crest_rack_rate_cents"), 0)`,
        totalProfitCents: sql<string>`COALESCE(SUM("iron_crest_profit_cents"), 0)`,
      }).from(salesOrders).where(sql`"approval_status" = 'APPROVED' AND "date_sold" >= ${mtdStart}::date AND "date_sold" <= ${today}::date`);

      const m = metrics[0];
      const format = req.query.format;
      const data = {
        period: { start: mtdStart, end: today },
        totalSold: m.totalSold || 0,
        totalConnects: m.totalConnects || 0,
        connectRate: m.totalSold > 0 ? Math.round(((m.totalConnects || 0) / m.totalSold) * 100) : 0,
        totalRevenueCents: parseInt(m.totalRevenueCents || "0"),
        totalProfitCents: parseInt(m.totalProfitCents || "0"),
        generatedAt: new Date().toISOString(),
      };

      if (format === "csv") {
        const csv = stringify([Object.values(data)], { header: true, columns: Object.keys(data) });
        res.setHeader("Content-Type", "text/csv");
        return res.send(csv);
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/webhooks/ar-status", async (req, res) => {
    if (!(await authenticateApiKey(req, res, "ar-status"))) return;
    try {
      const pipeline = await db.select({
        status: arExpectations.status,
        count: sql<number>`count(*)`,
        totalExpectedCents: sql<string>`COALESCE(SUM("expected_amount_cents"), 0)`,
        totalActualCents: sql<string>`COALESCE(SUM("actual_amount_cents"), 0)`,
      }).from(arExpectations).groupBy(arExpectations.status);

      const data = {
        pipeline: pipeline.map(p => ({
          status: p.status,
          count: p.count,
          expectedCents: parseInt(p.totalExpectedCents || "0"),
          actualCents: parseInt(p.totalActualCents || "0"),
          varianceCents: parseInt(p.totalExpectedCents || "0") - parseInt(p.totalActualCents || "0"),
        })),
        totalOpen: pipeline.filter(p => p.status === "OPEN" || p.status === "PARTIAL").reduce((sum, p) => sum + p.count, 0),
        generatedAt: new Date().toISOString(),
      };

      const format = req.query.format;
      if (format === "csv") {
        const rows = data.pipeline.map(p => [p.status, p.count, p.expectedCents, p.actualCents, p.varianceCents]);
        const csv = stringify(rows, { header: true, columns: ["status", "count", "expectedCents", "actualCents", "varianceCents"] });
        res.setHeader("Content-Type", "text/csv");
        return res.send(csv);
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/webhooks/payroll-summary", async (req, res) => {
    if (!(await authenticateApiKey(req, res, "payroll-summary"))) return;
    try {
      const recentRuns = await db.select({
        id: payRuns.id, name: payRuns.name, status: payRuns.status,
        periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd,
        totalGross: payRuns.totalGross, totalNet: payRuns.totalNet,
        repCount: payRuns.repCount, orderCount: payRuns.orderCount,
        createdAt: payRuns.createdAt,
      }).from(payRuns).orderBy(desc(payRuns.createdAt)).limit(10);

      const data = {
        payRuns: recentRuns.map(r => ({
          ...r,
          totalGross: r.totalGross ? parseFloat(r.totalGross) : 0,
          totalNet: r.totalNet ? parseFloat(r.totalNet) : 0,
        })),
        generatedAt: new Date().toISOString(),
      };

      const format = req.query.format;
      if (format === "csv") {
        const rows = data.payRuns.map(r => [r.id, r.name, r.status, r.periodStart, r.periodEnd, r.totalGross, r.totalNet, r.repCount, r.orderCount]);
        const csv = stringify(rows, { header: true, columns: ["id", "name", "status", "periodStart", "periodEnd", "totalGross", "totalNet", "repCount", "orderCount"] });
        res.setHeader("Content-Type", "text/csv");
        return res.send(csv);
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================================================
  // ONBOARDING PORTAL ROUTES
  // =====================================================

  const onboardingOtpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { message: "Too many verification attempts. Try again in an hour." },
    keyGenerator: (req) => (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown"),
  });

  const onboardingAuth = async (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ message: "Missing token" });
    try {
      const jwt = (await import("jsonwebtoken")).default;
      const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "fallback-secret";
      const payload = jwt.verify(authHeader.split(" ")[1], secret) as any;
      if (payload.purpose !== "onboarding") return res.status(401).json({ message: "Invalid token purpose" });
      req.onboardingUserId = payload.userId;
      next();
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };

  app.post("/api/onboarding/verify-otp", onboardingOtpLimiter, async (req: Request, res: Response) => {
    try {
      const { repId, otp } = req.body;
      if (!repId || !otp) return res.status(400).json({ message: "Missing repId or otp" });

      const [user] = await db.select().from(users).where(eq(users.repId, repId));
      if (!user) return res.status(404).json({ message: "Rep ID not found" });

      if (!["OTP_SENT", "OTP_VERIFIED", "IN_PROGRESS"].includes(user.onboardingStatus)) {
        return res.status(400).json({ message: "Onboarding not available for this account" });
      }

      const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
      const ua = req.headers["user-agent"] || "unknown";

      const { verifyOtp } = await import("./onboarding/verifyOtp");
      const result = await verifyOtp(user.id, otp, ip, ua);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/onboarding/rep-info", onboardingAuth as any, async (req: any, res: Response) => {
    try {
      const userId = req.onboardingUserId;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "User not found" });

      let managerName: string | null = null;
      if (user.assignedManagerId) {
        const [mgr] = await db.select({ name: users.name }).from(users).where(eq(users.id, user.assignedManagerId));
        managerName = mgr?.name || null;
      }

      const [existingSub] = await db.select().from(onboardingSubmissions)
        .where(eq(onboardingSubmissions.userId, userId))
        .orderBy(desc(onboardingSubmissions.createdAt))
        .limit(1);

      const drafts = await db.select({ documentType: onboardingDrafts.documentType })
        .from(onboardingDrafts).where(eq(onboardingDrafts.userId, userId));

      res.json({
        repId: user.repId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        managerName,
        onboardingStatus: user.onboardingStatus,
        completedDocuments: {
          backgroundCheck: existingSub?.backgroundCheckCompleted || false,
          chargebackPolicy: existingSub?.chargebackPolicyCompleted || false,
          contractorApp: existingSub?.contractorAppCompleted || false,
          directDeposit: existingSub?.directDepositCompleted || false,
          drugTest: existingSub?.drugTestCompleted || false,
          nda: existingSub?.ndaCompleted || false,
        },
        drafts: drafts.map(d => d.documentType),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const validDocTypes = ["background_check", "chargeback_policy", "contractor_app", "direct_deposit", "drug_test", "nda"];

  app.post("/api/onboarding/draft/:documentType", onboardingAuth as any, async (req: any, res: Response) => {
    try {
      const userId = req.onboardingUserId;
      const { documentType } = req.params;
      if (!validDocTypes.includes(documentType)) return res.status(400).json({ message: "Invalid document type" });

      let draftData = { ...req.body };
      if (documentType === "direct_deposit") {
        delete draftData.ssn;
        delete draftData.routingNumber;
        delete draftData.accountNumber;
      }

      const existing = await db.select().from(onboardingDrafts)
        .where(and(eq(onboardingDrafts.userId, userId), eq(onboardingDrafts.documentType, documentType)));

      if (existing.length > 0) {
        await db.update(onboardingDrafts).set({
          draftJson: JSON.stringify(draftData),
          lastSavedAt: new Date(),
        }).where(eq(onboardingDrafts.id, existing[0].id));
      } else {
        await db.insert(onboardingDrafts).values({
          userId, documentType,
          draftJson: JSON.stringify(draftData),
        });
      }

      await db.insert(onboardingAuditLog).values({
        userId, action: "DOCUMENT_SAVED",
        detail: JSON.stringify({ documentType }),
      });

      await db.update(users).set({ onboardingStatus: "IN_PROGRESS", updatedAt: new Date() })
        .where(and(eq(users.id, userId), inArray(users.onboardingStatus, ["OTP_VERIFIED", "IN_PROGRESS"])));

      res.json({ saved: true, lastSavedAt: new Date() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/onboarding/draft/:documentType", onboardingAuth as any, async (req: any, res: Response) => {
    try {
      const userId = req.onboardingUserId;
      const { documentType } = req.params;
      if (!validDocTypes.includes(documentType)) return res.status(400).json({ message: "Invalid document type" });

      const [draft] = await db.select().from(onboardingDrafts)
        .where(and(eq(onboardingDrafts.userId, userId), eq(onboardingDrafts.documentType, documentType)));

      if (!draft) return res.json({ draft: null });
      res.json({ draft: JSON.parse(draft.draftJson), lastSavedAt: draft.lastSavedAt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const onboardingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.post("/api/onboarding/submit", onboardingAuth as any, onboardingUpload.fields([
    { name: "photoId", maxCount: 1 },
    { name: "voidedCheck", maxCount: 1 },
    { name: "drugTestPhoto", maxCount: 1 },
  ]), async (req: any, res: Response) => {
    try {
      const userId = req.onboardingUserId;
      const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      const formData = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;

      const requiredSigs = ["backgroundCheckSignature", "chargebackPolicySignature", "contractorAppSignature", "directDepositSignature", "drugTestSignature", "ndaSignature"];
      const missing = requiredSigs.filter(s => !formData[s]);
      if (missing.length > 0) return res.status(400).json({ message: "Missing signatures", missing });

      if (!formData.repName) return res.status(400).json({ message: "Missing repName" });

      const ssnEncrypted = formData.ssn ? encryptSsn(formData.ssn) : null;
      const ssnLast4 = formData.ssn ? extractSsnLast4(formData.ssn) : null;
      const routingNumberEncrypted = formData.routingNumber ? encryptSsn(formData.routingNumber) : null;
      const accountNumberEncrypted = formData.accountNumber ? encryptSsn(formData.accountNumber) : null;
      const accountNumberLast4 = formData.accountNumber ? formData.accountNumber.slice(-4) : null;

      let photoIdS3Key: string | null = null;
      let voidedCheckS3Key: string | null = null;
      let drugTestPhotoS3Key: string | null = null;

      const files = req.files as { [key: string]: Express.Multer.File[] } | undefined;
      if (files?.photoId?.[0]) photoIdS3Key = `onboarding/${userId}/photo-id-${Date.now()}.jpg`;
      if (files?.voidedCheck?.[0]) voidedCheckS3Key = `onboarding/${userId}/voided-check-${Date.now()}.jpg`;
      if (files?.drugTestPhoto?.[0]) drugTestPhotoS3Key = `onboarding/${userId}/drug-test-${Date.now()}.jpg`;

      const now = new Date();
      const payloadForHash = {
        userId,
        repName: formData.repName,
        submittedAt: now.toISOString(),
        ipAddress: ip,
        userAgent: ua,
        documentsCompleted: validDocTypes,
      };
      const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payloadForHash)).digest("hex");

      const [submission] = await db.insert(onboardingSubmissions).values({
        userId,
        repName: formData.repName,
        repEmail: formData.repEmail || null,
        repPhone: formData.repPhone || null,
        ipAddress: ip,
        userAgent: ua,
        submittedAt: now,
        payloadHash,
        backgroundCheckCompleted: true,
        backgroundCheckSignedAt: now,
        chargebackPolicyCompleted: true,
        chargebackPolicySignedAt: now,
        contractorAppCompleted: true,
        contractorAppSignedAt: now,
        directDepositCompleted: true,
        directDepositSignedAt: now,
        drugTestCompleted: true,
        drugTestSignedAt: now,
        ndaCompleted: true,
        ndaSignedAt: now,
        backgroundCheckSignature: formData.backgroundCheckSignature,
        chargebackPolicySignature: formData.chargebackPolicySignature,
        contractorAppSignature: formData.contractorAppSignature,
        directDepositSignature: formData.directDepositSignature,
        drugTestSignature: formData.drugTestSignature,
        ndaSignature: formData.ndaSignature,
        ssnEncrypted,
        ssnLast4,
        routingNumberEncrypted,
        accountNumberEncrypted,
        accountNumberLast4,
        bankName: formData.bankName || null,
        accountType: formData.accountType || null,
        photoIdS3Key,
        voidedCheckS3Key,
        drugTestPhotoS3Key,
        status: "PENDING",
      }).returning();

      await db.update(users).set({
        onboardingStatus: "SUBMITTED",
        onboardingSubmittedAt: now,
        email: formData.repEmail || undefined,
        phone: formData.repPhone || undefined,
        emergencyContactName: formData.emergencyContactName || undefined,
        emergencyContactPhone: formData.emergencyContactPhone || undefined,
        dateOfBirth: formData.dateOfBirth || undefined,
        ndaSignedAt: now,
        contractorAgreementSignedAt: now,
        updatedAt: now,
      }).where(eq(users.id, userId));

      if (formData.bankName && accountNumberEncrypted) {
        try {
          await storage.createUserBankAccount({
            userId,
            bankName: formData.bankName,
            accountType: formData.accountType || "checking",
            accountNumberLast4: accountNumberLast4 || "",
            routingNumberLast4: formData.routingNumber ? formData.routingNumber.slice(-4) : "",
            accountNumberEncrypted: accountNumberEncrypted || "",
            routingNumberEncrypted: routingNumberEncrypted || "",
            isPrimary: true,
            isActive: true,
            verificationStatus: "PENDING",
            voidedCheckS3Key,
          });
        } catch (bankErr: any) {
          console.error("[Onboarding] Bank account creation failed:", bankErr.message);
        }
      }

      if (ssnEncrypted && ssnLast4) {
        try {
          await storage.updateUserTaxProfile(userId, {
            ssnLast4,
            ssnEncrypted,
            taxFilingName: formData.repName,
            contractorType: "1099",
          });
        } catch (taxErr: any) {
          console.error("[Onboarding] Tax profile update failed:", taxErr.message);
        }
      }

      try {
        const { generateOnboardingPdfs } = await import("./onboarding/pdfGenerator");
        await generateOnboardingPdfs(submission.id);
      } catch (pdfErr: any) {
        console.error("[Onboarding] PDF generation failed (non-fatal):", pdfErr.message);
      }

      try {
        const { sendOnboardingEmails, notifyOpsAndExec } = await import("./onboarding/emailService");
        await sendOnboardingEmails(submission.id);
        await notifyOpsAndExec(
          userId,
          "ONBOARDING_SUBMITTED",
          "New Contractor Onboarding Submitted",
          `${formData.repName} has completed all 6 onboarding documents and is ready for review.`
        );
      } catch (emailErr: any) {
        console.error("[Onboarding] Email notification failed (non-fatal):", emailErr.message);
      }

      await db.delete(onboardingDrafts).where(eq(onboardingDrafts.userId, userId));

      await db.insert(onboardingAuditLog).values({
        userId, action: "ONBOARDING_SUBMITTED", ipAddress: ip, userAgent: ua,
        detail: JSON.stringify({ payloadHash, documentsCompleted: 6, submissionId: submission.id }),
      });

      res.json({
        success: true,
        submissionId: submission.id,
        message: "Your onboarding is complete. You will receive a confirmation email shortly.",
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const opsOrExec = requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE");

  app.post("/api/admin/onboarding/:userId/send-otp", auth, opsOrExec, async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.phone) return res.status(400).json({ message: "User has no phone number on file" });

      if (user.onboardingOtpLockedAt) {
        await db.update(users).set({
          onboardingOtpLockedAt: null,
          onboardingOtpAttempts: 0,
          updatedAt: new Date(),
        }).where(eq(users.id, userId));
      }

      const { generateAndSendOtp } = await import("./onboarding/otpService");
      await generateAndSendOtp(userId, user.phone, user.name);

      await storage.createAuditLog({
        action: "onboarding_otp_sent", tableName: "users", recordId: userId,
        afterJson: JSON.stringify({ sentTo: user.phone.slice(-4) }),
        userId: req.user!.id,
      });

      res.json({ success: true, sentTo: user.phone.slice(-4) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/onboarding/submissions", auth, opsOrExec, async (req: AuthRequest, res) => {
    try {
      const statusFilter = req.query.status as string | undefined;
      const search = req.query.search as string | undefined;

      let subs = await db.select().from(onboardingSubmissions)
        .orderBy(desc(onboardingSubmissions.createdAt));

      if (statusFilter) {
        subs = subs.filter(s => s.status === statusFilter);
      }

      if (search) {
        const term = search.toLowerCase();
        const userList = await db.select({ id: users.id, repId: users.repId }).from(users);
        const repIdMap = new Map(userList.map(u => [u.id, u.repId]));
        subs = subs.filter(s =>
          s.repName.toLowerCase().includes(term) ||
          (repIdMap.get(s.userId) || "").toLowerCase().includes(term)
        );
      }

      const reviewerIds = [...new Set(subs.filter(s => s.reviewedByUserId).map(s => s.reviewedByUserId!))];
      const reviewers = reviewerIds.length > 0
        ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, reviewerIds))
        : [];
      const reviewerMap = new Map(reviewers.map(r => [r.id, r.name]));

      const userIds = [...new Set(subs.map(s => s.userId))];
      const userList = userIds.length > 0
        ? await db.select({ id: users.id, repId: users.repId }).from(users).where(inArray(users.id, userIds))
        : [];
      const repIdMap = new Map(userList.map(u => [u.id, u.repId]));

      const result = subs.map(s => ({
        id: s.id,
        userId: s.userId,
        repId: repIdMap.get(s.userId) || "N/A",
        repName: s.repName,
        repEmail: s.repEmail,
        submittedAt: s.submittedAt,
        status: s.status,
        documentsCompleted: [
          s.backgroundCheckCompleted, s.chargebackPolicyCompleted, s.contractorAppCompleted,
          s.directDepositCompleted, s.drugTestCompleted, s.ndaCompleted,
        ].filter(Boolean).length,
        reviewedBy: s.reviewedByUserId ? reviewerMap.get(s.reviewedByUserId) : null,
        reviewedAt: s.reviewedAt,
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/onboarding/submissions/:id", auth, opsOrExec, async (req: AuthRequest, res) => {
    try {
      const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, req.params.id));
      if (!sub) return res.status(404).json({ message: "Submission not found" });

      const [user] = await db.select().from(users).where(eq(users.id, sub.userId));
      const auditEntries = await db.select().from(onboardingAuditLog)
        .where(eq(onboardingAuditLog.userId, sub.userId))
        .orderBy(desc(onboardingAuditLog.createdAt));

      res.json({
        ...sub,
        ssnEncrypted: undefined,
        routingNumberEncrypted: undefined,
        accountNumberEncrypted: undefined,
        repId: user?.repId,
        userRole: user?.role,
        userStatus: user?.status,
        backgroundCheckStatus: user?.backgroundCheckStatus,
        drugTestStatus: user?.drugTestStatus,
        onboardingStatus: user?.onboardingStatus,
        auditLog: auditEntries,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/onboarding/submissions/:id/approve", auth, opsOrExec, async (req: AuthRequest, res) => {
    try {
      const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, req.params.id));
      if (!sub) return res.status(404).json({ message: "Submission not found" });
      if (sub.status !== "PENDING") return res.status(400).json({ message: `Cannot approve submission with status ${sub.status}` });

      const now = new Date();

      await db.update(onboardingSubmissions).set({
        status: "APPROVED",
        reviewedByUserId: req.user!.id,
        reviewedAt: now,
        reviewNotes: req.body.notes || null,
        updatedAt: now,
      }).where(eq(onboardingSubmissions.id, sub.id));

      await db.update(users).set({
        onboardingStatus: "APPROVED",
        onboardingApprovedAt: now,
        onboardingApprovedByUserId: req.user!.id,
        status: "ACTIVE",
        appAccessGrantedAt: now,
        appAccessGrantedByUserId: req.user!.id,
        updatedAt: now,
      }).where(eq(users.id, sub.userId));

      await db.insert(emailNotifications).values({
        userId: sub.userId,
        notificationType: "ONBOARDING_APPROVED",
        subject: "Your onboarding has been approved",
        body: "Congratulations! Your Iron Crest onboarding has been approved. You now have full access to the rep portal.",
        recipientEmail: sub.repEmail || "",
        status: "PENDING",
        isRead: false,
      });

      if (sub.repPhone && process.env.TWILIO_ACCOUNT_SID) {
        try {
          const twilio = (await import("twilio")).default;
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || "";
          await client.messages.create({
            body: `Congratulations! Your Iron Crest onboarding has been approved. You now have full access to the rep portal. Log in at: ${appUrl}`,
            from: process.env.TWILIO_FROM_NUMBER!,
            to: sub.repPhone,
          });
        } catch (smsErr: any) {
          console.error("[Onboarding] Approval SMS failed (non-fatal):", smsErr.message);
        }
      }

      await db.insert(onboardingAuditLog).values({
        userId: sub.userId, action: "ONBOARDING_APPROVED",
        detail: JSON.stringify({ approvedBy: req.user!.id, submissionId: sub.id }),
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/onboarding/submissions/:id/reject", auth, opsOrExec, async (req: AuthRequest, res) => {
    try {
      const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, req.params.id));
      if (!sub) return res.status(404).json({ message: "Submission not found" });
      if (sub.status !== "PENDING") return res.status(400).json({ message: `Cannot reject submission with status ${sub.status}` });

      const { reason, requestedDocuments } = req.body;
      if (!reason) return res.status(400).json({ message: "Rejection reason required" });

      const now = new Date();

      await db.update(onboardingSubmissions).set({
        status: "REJECTED",
        reviewedByUserId: req.user!.id,
        reviewedAt: now,
        reviewNotes: reason,
        updatedAt: now,
      }).where(eq(onboardingSubmissions.id, sub.id));

      await db.update(users).set({
        onboardingStatus: "REJECTED",
        onboardingRejectedAt: now,
        onboardingRejectionReason: reason,
        updatedAt: now,
      }).where(eq(users.id, sub.userId));

      await db.insert(emailNotifications).values({
        userId: sub.userId,
        notificationType: "ONBOARDING_REJECTED",
        subject: "Onboarding requires attention",
        body: `Your Iron Crest onboarding requires attention. Reason: ${reason}. Please contact your manager.`,
        recipientEmail: sub.repEmail || "",
        status: "PENDING",
        isRead: false,
      });

      const [user] = await db.select().from(users).where(eq(users.id, sub.userId));
      if (user?.assignedManagerId) {
        await db.insert(emailNotifications).values({
          userId: user.assignedManagerId,
          notificationType: "ONBOARDING_REJECTED",
          subject: `${sub.repName}'s onboarding was rejected`,
          body: `${sub.repName}'s onboarding has been rejected. Reason: ${reason}`,
          recipientEmail: "",
          status: "PENDING",
          isRead: false,
        });
      }

      if (sub.repPhone && process.env.TWILIO_ACCOUNT_SID) {
        try {
          const twilio = (await import("twilio")).default;
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          await client.messages.create({
            body: `Your Iron Crest onboarding requires attention. Reason: ${reason}. Please contact your manager.`,
            from: process.env.TWILIO_FROM_NUMBER!,
            to: sub.repPhone,
          });
        } catch (smsErr: any) {
          console.error("[Onboarding] Rejection SMS failed (non-fatal):", smsErr.message);
        }
      }

      await db.insert(onboardingAuditLog).values({
        userId: sub.userId, action: "ONBOARDING_REJECTED",
        detail: JSON.stringify({ rejectedBy: req.user!.id, reason, requestedDocuments }),
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/onboarding/:userId/update-compliance", auth, opsOrExec, async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { backgroundCheckStatus, drugTestStatus, notes } = req.body;

      const updates: any = { updatedAt: new Date() };
      if (backgroundCheckStatus) updates.backgroundCheckStatus = backgroundCheckStatus;
      if (drugTestStatus) updates.drugTestStatus = drugTestStatus;

      await db.update(users).set(updates).where(eq(users.id, userId));

      await db.insert(onboardingAuditLog).values({
        userId, action: backgroundCheckStatus ? "BACKGROUND_CHECK_UPDATED" : "DRUG_TEST_UPDATED",
        detail: JSON.stringify({ backgroundCheckStatus, drugTestStatus, notes, updatedBy: req.user!.id }),
      });

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (user && user.backgroundCheckStatus === "CLEARED" && user.drugTestStatus === "CLEARED" && user.onboardingStatus === "APPROVED") {
        const { notifyOpsAndExec } = await import("./onboarding/emailService");
        await notifyOpsAndExec(userId, "COMPLIANCE_CLEARED", "Contractor Fully Cleared", `${user.name} is fully cleared and compliant.`);
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/onboarding/audit/:userId", auth, opsOrExec, async (req: AuthRequest, res) => {
    try {
      const entries = await db.select().from(onboardingAuditLog)
        .where(eq(onboardingAuditLog.userId, req.params.userId))
        .orderBy(desc(onboardingAuditLog.createdAt));
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Integration activity log
  app.get("/api/admin/integration-logs", auth, requirePermission("admin:integrations"), async (req: AuthRequest, res) => {
    try {
      const type = req.query.type as string | undefined;
      const limit = parseInt(req.query.limit as string || "50");
      let query = db.select().from(integrationLogs).orderBy(desc(integrationLogs.createdAt)).limit(limit);
      if (type) {
        const logs = await db.select().from(integrationLogs).where(eq(integrationLogs.integrationType, type)).orderBy(desc(integrationLogs.createdAt)).limit(limit);
        return res.json(logs);
      }
      const logs = await query;
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // ROLLING RESERVE ENDPOINTS
  // ============================================================

  app.get("/api/my/reserve", auth, async (req: AuthRequest, res) => {
    try {
      const user = req.user!;
      if (!isReserveEligibleRole(user.role)) {
        return res.json({ eligible: false, message: "Rolling reserve does not apply to your role" });
      }

      const reserve = await getOrCreateReserve(user.id);

      const recentTxns = await db
        .select()
        .from(reserveTransactions)
        .where(eq(reserveTransactions.reserveId, reserve.id))
        .orderBy(desc(reserveTransactions.createdAt))
        .limit(10);

      const immatureOrders = await db
        .select({ dateSold: salesOrders.dateSold, maturityExpiresAt: salesOrders.maturityExpiresAt })
        .from(salesOrders)
        .where(and(eq(salesOrders.createdByUserId, user.id), eq(salesOrders.status, "APPROVED")));

      let oldestImmatureOrderDate: string | null = null;
      let latestMaturityDate: string | null = null;
      let ordersInMaturityWindow = 0;

      for (const o of immatureOrders) {
        if (o.maturityExpiresAt && new Date(o.maturityExpiresAt) > new Date()) {
          ordersInMaturityWindow++;
          if (!oldestImmatureOrderDate || o.dateSold < oldestImmatureOrderDate) {
            oldestImmatureOrderDate = o.dateSold;
          }
          const matStr = new Date(o.maturityExpiresAt).toISOString().split("T")[0];
          if (!latestMaturityDate || matStr > latestMaturityDate) {
            latestMaturityDate = matStr;
          }
        }
      }

      const statusLabels: Record<string, string> = {
        ACTIVE: "Active — Withholding " + reserve.withholdingPercent + "%",
        AT_CAP: "At Cap — Withholding Paused",
        DEFICIT: "Deficit — Withholding Resumed",
        HELD: "Held — Pending Maturity Release",
        RELEASED: "Released",
      };

      res.json({
        eligible: true,
        currentBalance: reserve.currentBalanceCents / 100,
        cap: reserve.capCents / 100,
        withholdingPercent: parseFloat(reserve.withholdingPercent),
        status: reserve.status,
        statusLabel: statusLabels[reserve.status] || reserve.status,
        percentFull: reserve.capCents > 0 ? Math.round((reserve.currentBalanceCents / reserve.capCents) * 100) : 0,
        totalWithheld: reserve.totalWithheldCents / 100,
        totalChargebacks: reserve.totalChargebacksCents / 100,
        recentTransactions: recentTxns.map(t => ({
          date: new Date(t.createdAt).toISOString(),
          type: t.transactionType,
          description: t.description,
          amount: t.isCredit ? t.amountCents / 100 : -(t.amountCents / 100),
          balanceAfter: t.balanceAfterCents / 100,
        })),
        maturityInfo: {
          oldestImmatureOrderDate,
          latestMaturityDate,
          ordersInMaturityWindow,
        },
      });
    } catch (error: any) {
      console.error("My reserve error:", error);
      res.status(500).json({ message: "Failed to get reserve info" });
    }
  });

  app.get("/api/admin/reserves", auth, requirePermission("reserves:view:all"), async (req: AuthRequest, res) => {
    try {
      const { status, search } = req.query;

      let conditions: any[] = [];
      if (status) {
        conditions.push(eq(rollingReserves.status, status as string));
      }

      const allReserves = await db
        .select({
          reserve: rollingReserves,
          userName: users.name,
          userRepId: users.repId,
          userRole: users.role,
        })
        .from(rollingReserves)
        .innerJoin(users, eq(rollingReserves.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(rollingReserves.currentBalanceCents));

      let filtered = allReserves;
      if (search) {
        const s = (search as string).toLowerCase();
        filtered = allReserves.filter(r =>
          r.userName.toLowerCase().includes(s) || r.userRepId.toLowerCase().includes(s)
        );
      }

      res.json(filtered.map(r => ({
        userId: r.reserve.userId,
        repName: r.userName,
        repId: r.userRepId,
        role: r.userRole,
        currentBalance: r.reserve.currentBalanceCents / 100,
        cap: r.reserve.capCents / 100,
        status: r.reserve.status,
        withholdingPercent: parseFloat(r.reserve.withholdingPercent),
        separatedAt: r.reserve.separatedAt,
        earliestReleaseAt: r.reserve.earliestReleaseAt,
        totalWithheld: r.reserve.totalWithheldCents / 100,
        totalChargebacks: r.reserve.totalChargebacksCents / 100,
      })));
    } catch (error: any) {
      console.error("Admin reserves error:", error);
      res.status(500).json({ message: "Failed to get reserves" });
    }
  });

  app.get("/api/admin/reserves/report/summary", auth, requirePermission("reserves:view:all"), async (req: AuthRequest, res) => {
    try {
      const allReserves = await db.select().from(rollingReserves);

      let totalReserveHeld = 0;
      let totalRepsWithActiveReserve = 0;
      let totalRepsAtCap = 0;
      let totalRepsInDeficit = 0;
      let totalRepsHeld = 0;
      let pendingReleaseCents = 0;
      const byStatus: Record<string, { count: number; totalCents: number }> = {};

      for (const r of allReserves) {
        totalReserveHeld += r.currentBalanceCents;
        if (!byStatus[r.status]) byStatus[r.status] = { count: 0, totalCents: 0 };
        byStatus[r.status].count++;
        byStatus[r.status].totalCents += r.currentBalanceCents;

        if (r.status === "ACTIVE" || r.status === "DEFICIT") totalRepsWithActiveReserve++;
        if (r.status === "AT_CAP") { totalRepsAtCap++; totalRepsWithActiveReserve++; }
        if (r.status === "DEFICIT") totalRepsInDeficit++;
        if (r.status === "HELD") { totalRepsHeld++; pendingReleaseCents += r.currentBalanceCents; }
      }

      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const ytdChargebacks = allReserves.reduce((sum, r) => sum + r.totalChargebacksCents, 0);
      const ytdWithheld = allReserves.reduce((sum, r) => sum + r.totalWithheldCents, 0);

      res.json({
        totalReserveHeld: totalReserveHeld / 100,
        totalRepsWithActiveReserve,
        totalRepsAtCap,
        totalRepsInDeficit,
        totalRepsHeld,
        pendingReleaseCents: pendingReleaseCents / 100,
        totalChargebacksYTD: ytdChargebacks / 100,
        totalWithheldYTD: ytdWithheld / 100,
        byStatus,
      });
    } catch (error: any) {
      console.error("Reserve summary error:", error);
      res.status(500).json({ message: "Failed to get reserve summary" });
    }
  });

  app.get("/api/admin/reserves/:userId", auth, requirePermission("reserves:view:all"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
      if (!reserve) return res.status(404).json({ message: "No reserve found for this user" });

      const [user] = await db.select({ name: users.name, repId: users.repId, role: users.role }).from(users).where(eq(users.id, userId));

      const txns = await db
        .select()
        .from(reserveTransactions)
        .where(eq(reserveTransactions.reserveId, reserve.id))
        .orderBy(desc(reserveTransactions.createdAt));

      res.json({
        reserve: {
          ...reserve,
          currentBalance: reserve.currentBalanceCents / 100,
          cap: reserve.capCents / 100,
          withholdingPercent: parseFloat(reserve.withholdingPercent),
          totalWithheld: reserve.totalWithheldCents / 100,
          totalChargebacks: reserve.totalChargebacksCents / 100,
          totalReleased: reserve.totalReleasedCents / 100,
          totalEquipmentRecovery: reserve.totalEquipmentRecoveryCents / 100,
        },
        user: user ? { name: user.name, repId: user.repId, role: user.role } : null,
        transactions: txns.map(t => ({
          id: t.id,
          date: new Date(t.createdAt).toISOString(),
          type: t.transactionType,
          description: t.description,
          amount: t.isCredit ? t.amountCents / 100 : -(t.amountCents / 100),
          balanceAfter: t.balanceAfterCents / 100,
          salesOrderId: t.salesOrderId,
          chargebackId: t.chargebackId,
          processedByUserId: t.processedByUserId,
        })),
      });
    } catch (error: any) {
      console.error("Admin reserve detail error:", error);
      res.status(500).json({ message: "Failed to get reserve detail" });
    }
  });

  app.get("/api/admin/reserves/:userId/transactions", auth, requirePermission("reserves:view:all"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { startDate, endDate, type } = req.query;

      const [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, userId));
      if (!reserve) return res.status(404).json({ message: "No reserve found" });

      let conditions: any[] = [eq(reserveTransactions.reserveId, reserve.id)];
      if (startDate) conditions.push(gte(reserveTransactions.createdAt, new Date(startDate as string)));
      if (endDate) conditions.push(lte(reserveTransactions.createdAt, new Date(endDate as string)));
      if (type) conditions.push(eq(reserveTransactions.transactionType, type as string));

      const txns = await db
        .select()
        .from(reserveTransactions)
        .where(and(...conditions))
        .orderBy(desc(reserveTransactions.createdAt));

      res.json(txns.map(t => ({
        id: t.id,
        date: new Date(t.createdAt).toISOString(),
        type: t.transactionType,
        description: t.description,
        amount: t.isCredit ? t.amountCents / 100 : -(t.amountCents / 100),
        balanceAfter: t.balanceAfterCents / 100,
        salesOrderId: t.salesOrderId,
        chargebackId: t.chargebackId,
        processedByUserId: t.processedByUserId,
      })));
    } catch (error: any) {
      console.error("Reserve transactions error:", error);
      res.status(500).json({ message: "Failed to get transactions" });
    }
  });

  app.post("/api/admin/reserves/:userId/adjust", auth, requirePermission("reserves:manual:adjust"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { amountCents, isCredit, reason } = req.body;
      const adminUser = req.user!;

      if (!amountCents || typeof amountCents !== "number" || amountCents <= 0) {
        return res.status(400).json({ message: "amountCents must be a positive integer" });
      }
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ message: "reason is required" });
      }

      if (isCredit && amountCents > 50000 && adminUser.role !== "EXECUTIVE") {
        return res.status(403).json({ message: "Credits over $500 require EXECUTIVE approval" });
      }

      const reserve = await getOrCreateReserve(userId);
      const newBalance = isCredit
        ? reserve.currentBalanceCents + amountCents
        : Math.max(0, reserve.currentBalanceCents - amountCents);

      await db.insert(reserveTransactions).values({
        reserveId: reserve.id,
        userId,
        transactionType: "MANUAL_ADJUSTMENT",
        amountCents,
        isCredit: !!isCredit,
        balanceAfterCents: newBalance,
        processedByUserId: adminUser.id,
        description: `Manual adjustment by ${adminUser.name}: ${reason}`,
      });

      let newStatus = reserve.status;
      if (newBalance >= reserve.capCents && reserve.status !== "HELD" && reserve.status !== "RELEASED") {
        newStatus = "AT_CAP";
      } else if (newBalance > 0 && reserve.status === "DEFICIT") {
        newStatus = "ACTIVE";
      }

      await db
        .update(rollingReserves)
        .set({
          currentBalanceCents: newBalance,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(rollingReserves.id, reserve.id));

      await db
        .update(users)
        .set({ reserveStatus: newStatus })
        .where(eq(users.id, userId));

      await storage.createAuditLog({
        action: "RESERVE_MANUAL_ADJUSTMENT",
        tableName: "reserve_transactions",
        recordId: reserve.id,
        afterJson: JSON.stringify({ amountCents, isCredit, reason, newBalance, newStatus }),
        userId: adminUser.id,
      });

      res.json({ message: "Adjustment applied", newBalance: newBalance / 100, status: newStatus });
    } catch (error: any) {
      console.error("Reserve adjustment error:", error);
      res.status(500).json({ message: "Failed to apply adjustment" });
    }
  });

  app.post("/api/admin/reserves/:userId/override-cap", auth, requirePermission("reserves:override:cap"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { newCapCents, newWithholdingPercent, reason } = req.body;
      const adminUser = req.user!;

      if (!newCapCents || newCapCents < 250000) {
        return res.status(400).json({ message: "Cap cannot be less than $2,500 (250000 cents)" });
      }
      if (newWithholdingPercent !== undefined && (newWithholdingPercent < 15 || newWithholdingPercent > 50)) {
        return res.status(400).json({ message: "Withholding percent must be between 15 and 50" });
      }
      if (!reason) {
        return res.status(400).json({ message: "reason is required" });
      }

      const reserve = await getOrCreateReserve(userId);

      const updates: any = {
        capCents: newCapCents,
        capOverrideReason: reason,
        capOverrideByUserId: adminUser.id,
        capOverrideAt: new Date(),
        updatedAt: new Date(),
      };
      if (newWithholdingPercent !== undefined) {
        updates.withholdingPercent = newWithholdingPercent.toFixed(2);
      }

      if (reserve.currentBalanceCents < newCapCents && reserve.status === "AT_CAP") {
        updates.status = "ACTIVE";
      }

      await db
        .update(rollingReserves)
        .set(updates)
        .where(eq(rollingReserves.id, reserve.id));

      if (updates.status) {
        await db.update(users).set({ reserveStatus: updates.status }).where(eq(users.id, userId));
      }

      await storage.createAuditLog({
        action: "RESERVE_CAP_OVERRIDE",
        tableName: "rolling_reserves",
        recordId: reserve.id,
        afterJson: JSON.stringify({ newCapCents, newWithholdingPercent, reason }),
        userId: adminUser.id,
      });

      const [targetUser] = await db.select({ name: users.name, repId: users.repId }).from(users).where(eq(users.id, userId));
      await db.insert(systemExceptions).values({
        exceptionType: "RESERVE_CAP_OVERRIDE_ACTIVE",
        severity: "INFO",
        title: `Cap override applied: ${targetUser?.name || userId}`,
        detail: `New cap: $${(newCapCents / 100).toFixed(2)}, withholding: ${newWithholdingPercent ?? parseFloat(reserve.withholdingPercent)}%. Reason: ${reason}`,
        relatedUserId: userId,
        relatedEntityId: reserve.id,
        relatedEntityType: "rolling_reserve",
      });

      res.json({ message: "Cap override applied", newCap: newCapCents / 100, withholdingPercent: newWithholdingPercent ?? parseFloat(reserve.withholdingPercent) });
    } catch (error: any) {
      console.error("Reserve cap override error:", error);
      res.status(500).json({ message: "Failed to override cap" });
    }
  });

  app.post("/api/admin/reserves/:userId/handle-separation", auth, requireRoles("OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { separationType, ipadReturned, notes } = req.body;
      const adminUser = req.user!;

      if (!separationType || !["VOLUNTARY", "TERMINATED"].includes(separationType)) {
        return res.status(400).json({ message: "separationType must be VOLUNTARY or TERMINATED" });
      }

      if (ipadReturned === true) {
        await db.update(users).set({ ipadReturnedAt: new Date() }).where(eq(users.id, userId));
      }

      const result = await handleRepSeparation(userId, separationType, adminUser.id);

      res.json({
        message: "Separation processed",
        reserveBalance: result.reserveBalance / 100,
        earliestReleaseDate: result.earliestReleaseDate.toISOString(),
        ipadRecoveryApplied: result.ipadRecoveryApplied,
      });
    } catch (error: any) {
      console.error("Handle separation error:", error);
      res.status(500).json({ message: "Failed to process separation" });
    }
  });

  app.get("/api/admin/system-exceptions", auth, requireRoles("ADMIN", "OPERATIONS", "ACCOUNTING", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const { status, type } = req.query;
      let query = db.select().from(systemExceptions);
      const conditions: any[] = [];
      if (status) conditions.push(eq(systemExceptions.status, status as string));
      if (type) conditions.push(eq(systemExceptions.exceptionType, type as string));
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      const results = await (query as any).orderBy(desc(systemExceptions.createdAt)).limit(200);
      res.json(results);
    } catch (error: any) {
      console.error("System exceptions query error:", error);
      res.status(500).json({ message: "Failed to fetch system exceptions" });
    }
  });

  app.patch("/api/admin/system-exceptions/:id/resolve", auth, requireRoles("ADMIN", "OPERATIONS", "EXECUTIVE"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { resolutionNote } = req.body;
      await db.update(systemExceptions).set({
        status: "RESOLVED",
        resolvedByUserId: req.user!.id,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote || null,
      }).where(eq(systemExceptions.id, id));
      res.json({ message: "Exception resolved" });
    } catch (error: any) {
      console.error("Resolve system exception error:", error);
      res.status(500).json({ message: "Failed to resolve exception" });
    }
  });

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error('[UNHANDLED ERROR]', err.message, req.method, req.path);
    res.status(500).json({
      message: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message,
    });
  });
}
