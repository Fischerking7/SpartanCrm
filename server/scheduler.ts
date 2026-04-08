import { storage } from "./storage";
import { emailService } from "./email";
import { setForceLogoutTimestamp } from "./auth";
import { db } from "./db";
import { salesOrders, chargebacks, arExpectations, users, clients, carrierImportSchedules, integrationLogs, rollingReserves, systemExceptions } from "@shared/schema";
import { eq, sql, and, gte, lte, inArray, isNull } from "drizzle-orm";
import { checkAndReleaseMaturedReserves } from "./reserves/reserveService";

function getEasternDate(date = new Date()): { year: number; month: number; day: number; hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || "0");
  return { year: get("year"), month: get("month"), day: get("day"), hours: get("hour"), minutes: get("minute") };
}

function msUntilEasternTime(targetHour: number, targetMinute = 0): number {
  const now = new Date();
  const et = getEasternDate(now);
  const etNowMinutes = et.hours * 60 + et.minutes;
  const targetMinutes = targetHour * 60 + targetMinute;
  let diffMinutes = targetMinutes - etNowMinutes;
  if (diffMinutes <= 0) {
    diffMinutes += 24 * 60;
  }
  return diffMinutes * 60 * 1000;
}

const runningJobs = new Set<string>();

async function runJobWithLock(jobName: string, fn: () => Promise<void>): Promise<void> {
  if (runningJobs.has(jobName)) {
    console.log(`[Scheduler] ${jobName} already running, skipping`);
    return;
  }
  runningJobs.add(jobName);
  try {
    await fn();
  } catch (err: any) {
    console.error(`[Scheduler] ${jobName} failed:`, err.message);
  } finally {
    runningJobs.delete(jobName);
  }
}

export const scheduler = {
  intervalIds: [] as NodeJS.Timeout[],
  midnightTimeout: null as NodeJS.Timeout | null,
  isRunning: false,

  dailyReportTimeouts: [] as NodeJS.Timeout[],
  installReportTimeout: null as NodeJS.Timeout | null,

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[Scheduler] Starting background job scheduler...");

    const scheduleInterval = setInterval(() => runJobWithLock('checkScheduledPayRuns', () => this.checkScheduledPayRuns()), 60000);
    this.intervalIds.push(scheduleInterval);

    const chargebackInterval = setInterval(() => runJobWithLock('processChargebacks', () => this.processChargebacks()), 300000);
    this.intervalIds.push(chargebackInterval);

    const emailInterval = setInterval(() => runJobWithLock('sendPendingEmails', () => emailService.sendPendingEmails()), 60000);
    this.intervalIds.push(emailInterval);

    const pendingApprovalInterval = setInterval(() => runJobWithLock('checkPendingApprovalAlerts', () => this.checkPendingApprovalAlerts()), 6 * 60 * 60 * 1000);
    this.intervalIds.push(pendingApprovalInterval);

    const performanceInterval = setInterval(() => runJobWithLock('checkLowPerformance', () => this.checkLowPerformance()), 24 * 60 * 60 * 1000);
    this.intervalIds.push(performanceInterval);

    this.scheduleMidnightLogout();
    this.scheduleDailySalesReport();
    this.scheduleDailyInstallReport();
    this.scheduleStaleArAlert();
    this.scheduleProfitAnomalyCheck();
    this.scheduleArCollectionPrediction();
    this.scheduleRepPerformancePrediction();
    this.scheduleCarrierSftpPoll();
    this.scheduleReserveMaturityRelease();
    this.scheduleReserveDeficitCheck();

    setTimeout(() => {
      runJobWithLock('checkScheduledPayRuns', () => this.checkScheduledPayRuns());
      runJobWithLock('processChargebacks', () => this.processChargebacks());
      runJobWithLock('sendPendingEmails', () => emailService.sendPendingEmails());
    }, 5000);

    console.log("[Scheduler] Background jobs scheduled");
  },

  stop() {
    this.intervalIds.forEach(id => clearInterval(id));
    this.intervalIds = [];
    if (this.midnightTimeout) {
      clearTimeout(this.midnightTimeout);
      this.midnightTimeout = null;
    }
    for (const t of this.dailyReportTimeouts) {
      clearTimeout(t);
    }
    this.dailyReportTimeouts = [];
    if (this.installReportTimeout) {
      clearTimeout(this.installReportTimeout);
      this.installReportTimeout = null;
    }
    this.isRunning = false;
    console.log("[Scheduler] Stopped all background jobs");
  },

  scheduleMidnightLogout() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    console.log(`[Scheduler] Midnight sign-out scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`);

    this.midnightTimeout = setTimeout(() => {
      this.forceLogoutAll();
      this.scheduleMidnightLogout();
    }, msUntilMidnight);
  },

  async forceLogoutAll() {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      setForceLogoutTimestamp(timestamp);
      console.log(`[Scheduler] Midnight sign-out triggered - all sessions before ${new Date().toISOString()} invalidated`);

      await storage.createAuditLog({
        action: "midnight_force_logout",
        tableName: "users",
        recordId: "system",
        userId: "SYSTEM",
        afterJson: JSON.stringify({ timestamp, triggeredAt: new Date().toISOString() }),
      });
    } catch (error) {
      console.error("[Scheduler] Midnight force logout error:", error);
    }
  },

  async checkScheduledPayRuns() {
    try {
      const activeSchedules = await storage.getActiveScheduledPayRuns();
      const now = new Date();
      
      for (const schedule of activeSchedules) {
        if (!schedule.autoCreatePayRun) continue;
        if (!schedule.nextRunAt) continue;
        
        const nextRun = new Date(schedule.nextRunAt);
        if (now >= nextRun) {
          await this.createScheduledPayRun(schedule);
        }
      }
    } catch (error) {
      console.error("[Scheduler] Error checking scheduled pay runs:", error);
    }
  },

  derivePeriodBoundaries(schedule: any): { periodStart: string; periodEnd: string } {
    const now = new Date();
    const toDateStr = (d: Date) => d.toISOString().split("T")[0];
    
    switch (schedule.frequency) {
      case "WEEKLY": {
        const end = new Date(now);
        const start = new Date(now);
        start.setDate(start.getDate() - 7);
        return { periodStart: toDateStr(start), periodEnd: toDateStr(end) };
      }
      case "BIWEEKLY": {
        const end = new Date(now);
        const start = new Date(now);
        start.setDate(start.getDate() - 14);
        return { periodStart: toDateStr(start), periodEnd: toDateStr(end) };
      }
      case "SEMIMONTHLY": {
        const day1 = schedule.dayOfMonth || 1;
        const day2 = schedule.secondDayOfMonth || 16;
        const currentDay = now.getDate();
        let periodStart: Date;
        let periodEnd: Date;
        
        if (currentDay >= day2) {
          periodStart = new Date(now.getFullYear(), now.getMonth(), day1);
          periodEnd = new Date(now.getFullYear(), now.getMonth(), day2 - 1);
        } else if (currentDay >= day1) {
          const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          periodStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), day2);
          periodEnd = new Date(now.getFullYear(), now.getMonth(), day1 - 1);
        } else {
          const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          periodStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), day1);
          periodEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), day2 - 1);
        }
        return { periodStart: toDateStr(periodStart), periodEnd: toDateStr(periodEnd) };
      }
      case "MONTHLY":
      default: {
        const payDay = schedule.dayOfMonth || 1;
        let periodStart: Date;
        let periodEnd: Date;
        
        if (now.getDate() >= payDay) {
          periodStart = new Date(now.getFullYear(), now.getMonth() - 1, payDay);
          periodEnd = new Date(now.getFullYear(), now.getMonth(), payDay - 1);
        } else {
          periodStart = new Date(now.getFullYear(), now.getMonth() - 2, payDay);
          periodEnd = new Date(now.getFullYear(), now.getMonth() - 1, payDay - 1);
        }
        return { periodStart: toDateStr(periodStart), periodEnd: toDateStr(periodEnd) };
      }
    }
  },

  async createScheduledPayRun(schedule: any) {
    const job = await storage.createBackgroundJob({
      jobType: "SCHEDULED_PAY_RUN",
      metadata: JSON.stringify({ scheduleId: schedule.id, scheduleName: schedule.name }),
    });
    
    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });
      
      const now = new Date();
      const { periodStart, periodEnd } = this.derivePeriodBoundaries(schedule);
      
      const payRun = await storage.createPayRun({
        name: `${schedule.name} - ${now.toLocaleDateString()}`,
        weekEndingDate: periodEnd,
        periodStart,
        periodEnd,
        status: "DRAFT",
        createdByUserId: schedule.createdByUserId || "SYSTEM",
      });
      
      await storage.createAuditLog({
        action: "scheduled_payrun_created",
        tableName: "pay_runs",
        recordId: payRun.id,
        afterJson: JSON.stringify({ name: payRun.name, periodStart, periodEnd, scheduleName: schedule.name }),
        userId: schedule.createdByUserId || "SYSTEM",
      });

      if (schedule.autoLinkOrders) {
        await this.autoLinkOrders(payRun.id, periodStart, periodEnd);
      }
      
      const nextRun = this.calculateNextRunDate(schedule);
      await storage.updateScheduledPayRun(schedule.id, {
        lastRunAt: now,
        nextRunAt: nextRun,
      });
      
      await this.notifyAccountingPayRunCreated(payRun, schedule);
      
      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({ payRunId: payRun.id, payRunName: payRun.name }),
      });
      
      console.log(`[Scheduler] Created pay run: ${payRun.name}`);
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Failed to create scheduled pay run:", error);
    }
  },

  async autoLinkOrders(payRunId: string, periodStart: string, periodEnd: string) {
    const orders = await storage.getOrders({});
    const eligibleOrders = orders.filter(o => 
      o.approvalStatus === "APPROVED" &&
      o.jobStatus === "COMPLETED" &&
      !o.payRunId &&
      o.dateSold >= periodStart &&
      o.dateSold <= periodEnd
    );
    
    let linked = 0;
    for (const order of eligibleOrders) {
      await storage.updateOrder(order.id, { payRunId });
      linked++;
    }
    
    if (linked > 0) {
      await storage.createAuditLog({
        action: "link_all_orders_to_payrun",
        tableName: "pay_runs",
        recordId: payRunId,
        afterJson: JSON.stringify({ orderCount: linked, autoLinked: true }),
        userId: "SYSTEM",
      });
    }
    console.log(`[Scheduler] Linked ${linked} orders to pay run`);
    return linked;
  },

  async notifyAccountingPayRunCreated(payRun: any, schedule: any) {
    try {
      const allUsers = await storage.getUsers();
      const accountingUsers = allUsers.filter(u => 
        ["ACCOUNTING", "ADMIN"].includes(u.role) && 
        u.status === "ACTIVE" && 
        !u.deletedAt && 
        u.email
      );
      
      for (const user of accountingUsers) {
        await emailService.queueNotification({
          userId: user.id,
          notificationType: "GENERAL",
          subject: `Automated Pay Run Created: ${payRun.name}`,
          body: `An automated pay run "${payRun.name}" has been created by the "${schedule.name}" schedule and is ready for review.\n\nPay Run ID: ${payRun.id}\nStatus: DRAFT\n\nPlease review the pay run in the Pay Runs page.`,
          recipientEmail: user.email!,
          relatedEntityType: "PAY_RUN",
          relatedEntityId: payRun.id,
        });
      }
      
      console.log(`[Scheduler] Notified ${accountingUsers.length} accounting users about auto-created pay run`);
    } catch (error) {
      console.error("[Scheduler] Failed to notify accounting:", error);
    }
  },

  calculateNextRunDate(schedule: any): Date {
    const now = new Date();
    let next = new Date(now);
    
    const day1 = schedule.dayOfMonth || 1;
    const day2 = schedule.secondDayOfMonth || 16;
    
    switch (schedule.frequency) {
      case "WEEKLY":
        next.setDate(next.getDate() + 7);
        if (schedule.dayOfWeek !== null && schedule.dayOfWeek !== undefined) {
          const currentDay = next.getDay();
          const daysUntil = (schedule.dayOfWeek - currentDay + 7) % 7;
          next.setDate(next.getDate() + daysUntil);
        }
        break;
      case "BIWEEKLY":
        next.setDate(next.getDate() + 14);
        break;
      case "SEMIMONTHLY": {
        const currentDay = now.getDate();
        if (currentDay < day1) {
          next.setDate(day1);
        } else if (currentDay < day2) {
          next.setDate(day2);
        } else {
          next.setMonth(next.getMonth() + 1);
          next.setDate(Math.min(day1, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
        }
        break;
      }
      case "MONTHLY":
      default:
        next.setMonth(next.getMonth() + 1);
        if (schedule.dayOfMonth) {
          next.setDate(Math.min(schedule.dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
        }
        break;
    }
    
    return next;
  },

  async processChargebacks() {
    const job = await storage.createBackgroundJob({
      jobType: "CHARGEBACK_PROCESSOR",
    });
    
    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });
      
      const unmatched = await storage.getUnresolvedUnmatchedChargebacks();
      let matched = 0;
      let remaining = 0;
      
      for (const item of unmatched) {
        try {
          const rawData = JSON.parse(item.rawRowJson);
          const invoiceNumber = rawData.invoiceNumber || rawData.invoice_number || rawData.Invoice;
          
          if (!invoiceNumber) {
            remaining++;
            continue;
          }
          
          const order = await storage.getOrderByInvoiceNumber(invoiceNumber);
          
          if (order) {
            const rep = await storage.getUserByRepId(order.repId);
            if (rep) {
              const chargeback = await storage.createChargeback({
                invoiceNumber,
                salesOrderId: order.id,
                repId: order.repId,
                amount: rawData.amount || rawData.Amount || "0",
                reason: this.mapChargebackReason(rawData.reason || rawData.Reason),
                chargebackDate: rawData.date || rawData.Date || new Date().toISOString().split("T")[0],
                createdByUserId: "SYSTEM",
                notes: "Auto-matched by background processor",
              });
              
              await storage.resolveUnmatchedChargeback(
                item.id,
                "SYSTEM",
                `Auto-matched to order ${order.id}`
              );
              
              await emailService.notifyChargebackApplied(chargeback, rep);
              matched++;
            }
          } else {
            remaining++;
          }
        } catch (parseError) {
          remaining++;
        }
      }
      
      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({ matched, remaining, total: unmatched.length }),
      });
      
      if (matched > 0) {
        console.log(`[Scheduler] Processed chargebacks: ${matched} matched, ${remaining} remaining`);
      }
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Chargeback processing failed:", error);
    }
  },

  mapChargebackReason(reason?: string): "CANCELLATION" | "NON_PAYMENT" | "SERVICE_ISSUE" | "DUPLICATE" | "OTHER" {
    if (!reason) return "OTHER";
    const r = reason.toLowerCase();
    if (r.includes("cancel")) return "CANCELLATION";
    if (r.includes("payment") || r.includes("nonpay")) return "NON_PAYMENT";
    if (r.includes("service") || r.includes("issue")) return "SERVICE_ISSUE";
    if (r.includes("duplicate") || r.includes("dupe")) return "DUPLICATE";
    return "OTHER";
  },

  async runManualJob(jobType: "SCHEDULED_PAY_RUN" | "CHARGEBACK_PROCESSOR" | "NOTIFICATION_SENDER" | "PENDING_APPROVAL_ALERT" | "LOW_PERFORMANCE_CHECK" | "DAILY_SALES_REPORT" | "DAILY_INSTALL_REPORT") {
    switch (jobType) {
      case "SCHEDULED_PAY_RUN":
        await this.checkScheduledPayRuns();
        break;
      case "CHARGEBACK_PROCESSOR":
        await this.processChargebacks();
        break;
      case "NOTIFICATION_SENDER":
        await emailService.sendPendingEmails();
        break;
      case "PENDING_APPROVAL_ALERT":
        await this.checkPendingApprovalAlerts();
        break;
      case "LOW_PERFORMANCE_CHECK":
        await this.checkLowPerformance();
        break;
      case "DAILY_SALES_REPORT":
        await this.generateDailySalesReport();
        break;
      case "DAILY_INSTALL_REPORT":
        await this.generateDailyInstallReport();
        break;
    }
  },

  async checkPendingApprovalAlerts() {
    const job = await storage.createBackgroundJob({
      jobType: "PENDING_APPROVAL_ALERT",
    });
    
    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });
      
      // Get all managers/executives who should receive alerts
      const allUsers = await storage.getUsers();
      const managers = allUsers.filter(u => 
        ["MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(u.role) && 
        u.status === "ACTIVE" && 
        !u.deletedAt
      );
      
      // Get orders pending approval
      const allOrders = await storage.getOrders({});
      const now = new Date();
      let alertsSent = 0;
      
      for (const manager of managers) {
        // Get manager's preference for days threshold (default 3 days)
        const prefs = await storage.getNotificationPreferences(manager.id);
        const daysThreshold = prefs?.pendingApprovalDaysThreshold || 3;
        
        // Find orders pending > threshold days (UNAPPROVED = awaiting approval)
        const pendingOrders = allOrders.filter(order => {
          if (order.approvalStatus !== "UNAPPROVED") return false;
          const orderDate = new Date(order.createdAt);
          const daysPending = Math.floor((now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
          return daysPending >= daysThreshold;
        });
        
        if (pendingOrders.length > 0) {
          await emailService.notifyPendingApprovalAlert(manager, pendingOrders, daysThreshold);
          alertsSent++;
        }
      }
      
      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({ alertsSent, managersChecked: managers.length }),
      });
      
      if (alertsSent > 0) {
        console.log(`[Scheduler] Sent ${alertsSent} pending approval alerts`);
      }
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Pending approval alert check failed:", error);
    }
  },

  scheduleDailySalesReport() {
    const reportHours = [15, 17, 20, 22];
    const labels = ["3:00 PM", "5:00 PM", "8:00 PM", "10:00 PM"];

    for (let i = 0; i < reportHours.length; i++) {
      const msUntil = msUntilEasternTime(reportHours[i]);
      console.log(`[Scheduler] Daily sales report scheduled in ${Math.round(msUntil / 60000)} minutes (${labels[i]} ET)`);

      const timeout = setTimeout(() => {
        this.generateDailySalesReport();
        if (i === reportHours.length - 1) {
          this.dailyReportTimeouts = [];
          this.scheduleDailySalesReport();
        }
      }, msUntil);
      this.dailyReportTimeouts.push(timeout);
    }
  },

  async generateDailySalesReport() {
    const job = await storage.createBackgroundJob({
      jobType: "DAILY_SALES_REPORT",
    });

    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });

      const et = getEasternDate();
      const reportDate = `${et.month}/${et.day}/${et.year}`;
      const todayStr = `${et.year}-${String(et.month).padStart(2, "0")}-${String(et.day).padStart(2, "0")}`;

      const allOrders = await storage.getOrders({});
      const todaysOrders = allOrders.filter(o => o.dateSold === todayStr);

      const allUsers = await storage.getUsers();
      const userMap = new Map(allUsers.map(u => [u.repId, u.name]));

      const allProviders = await storage.getProviders();
      const providerMap = new Map(allProviders.map(p => [p.id, p.name]));

      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.id, s.name]));

      const salesRows = todaysOrders.map(o => ({
        repId: o.repId || "",
        repName: userMap.get(o.repId || "") || o.repId || "Unknown",
        accountNumber: o.accountNumber || "",
        provider: providerMap.get(o.providerId) || "Unknown",
        service: serviceMap.get(o.serviceId) || "Unknown",
        grossCommission: ((Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0)).toFixed(2),
      }));

      const totalGross = salesRows.reduce((sum, r) => sum + parseFloat(r.grossCommission), 0);

      const providerCounts = new Map<string, number>();
      for (const row of salesRows) {
        providerCounts.set(row.provider, (providerCounts.get(row.provider) || 0) + 1);
      }
      const totalCount = salesRows.length;
      const providerMix = Array.from(providerCounts.entries())
        .map(([provider, count]) => ({
          provider,
          count,
          percent: totalCount > 0 ? (count / totalCount) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      const FIXED_OPS_EMAIL = "ironcrestoperations@ironcrestai.com";
      const recipients = allUsers
        .filter(u =>
          ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(u.role) &&
          u.status === "ACTIVE" &&
          !u.deletedAt &&
          u.email
        )
        .map(u => u.email!);
      if (!recipients.includes(FIXED_OPS_EMAIL)) {
        recipients.push(FIXED_OPS_EMAIL);
      }

      let emailResults = { sent: 0, failed: 0 };
      if (recipients.length > 0) {
        emailResults = await emailService.sendDailySalesReport(
          recipients,
          reportDate,
          salesRows,
          totalGross,
          providerMix
        );
      }

      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({
          reportDate,
          totalOrders: salesRows.length,
          totalGross: totalGross.toFixed(2),
          providerMix,
          recipientCount: recipients.length,
          emailsSent: emailResults.sent,
          emailsFailed: emailResults.failed,
        }),
      });

      console.log(`[Scheduler] Daily sales report: ${salesRows.length} orders, $${totalGross.toFixed(2)} gross, sent to ${emailResults.sent} recipients`);
      return { sent: emailResults.sent, failed: emailResults.failed, orders: salesRows.length, gross: totalGross.toFixed(2) };
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Daily sales report failed:", error);
      return { sent: 0, failed: 1, error: error.message };
    }
  },

  scheduleDailyInstallReport() {
    const msUntil = msUntilEasternTime(15);

    console.log(`[Scheduler] Daily install report scheduled in ${Math.round(msUntil / 60000)} minutes (3:00 PM ET)`);

    this.installReportTimeout = setTimeout(() => {
      this.generateDailyInstallReport();
      this.scheduleDailyInstallReport();
    }, msUntil);
  },

  async generateDailyInstallReport() {
    const job = await storage.createBackgroundJob({
      jobType: "DAILY_INSTALL_REPORT",
    });

    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });

      const et = getEasternDate();
      const reportDate = `${et.month}/${et.day}/${et.year}`;

      const monthStart = `${et.year}-${String(et.month).padStart(2, "0")}-01`;
      const lastDay = new Date(et.year, et.month, 0).getDate();
      const monthEnd = `${et.year}-${String(et.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const allUsers = await storage.getUsers();
      const userMap = new Map(allUsers.map(u => [u.repId, u.name]));
      const allProviders = await storage.getProviders();
      const providerMap = new Map(allProviders.map(p => [p.id, p.name]));
      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.id, s.name]));

      const allOrders = await storage.getOrders({});
      const monthOrders = allOrders.filter(o =>
        o.installDate && o.installDate >= monthStart && o.installDate <= monthEnd
      );

      const orderHasMobile = new Set<string>();
      for (const o of monthOrders) {
        const mobileLines = await storage.getMobileLineItemsByOrderId(o.id);
        if (mobileLines.length > 0) {
          orderHasMobile.add(o.id);
        }
      }

      const installRows = monthOrders.map(o => {
        let statusLabel: string;
        if (o.jobStatus === "COMPLETED" && o.approvalStatus === "APPROVED") {
          statusLabel = "COMPLETED";
        } else if (o.jobStatus === "CANCELED") {
          statusLabel = "CANCELLED";
        } else {
          statusLabel = "PENDING";
        }

        return {
          repId: o.repId || "",
          repName: userMap.get(o.repId || "") || o.repId || "Unknown",
          accountNumber: o.accountNumber || "",
          invoiceNumber: o.invoiceNumber || "",
          customerName: o.customerName || "",
          provider: providerMap.get(o.providerId) || "Unknown",
          service: serviceMap.get(o.serviceId) || "Unknown",
          jobStatus: statusLabel,
          dateSold: o.dateSold || "",
          installDate: o.installDate || "",
          orderType: orderHasMobile.has(o.id) ? "Mobile" : "Data",
        };
      });

      const installed = installRows.filter(r => r.jobStatus === "COMPLETED");
      const cancelled = installRows.filter(r => r.jobStatus === "CANCELLED");
      const pending = installRows.filter(r => r.jobStatus === "PENDING");

      const FIXED_OPS_EMAIL = "ironcrestoperations@ironcrestai.com";
      const emailResult = await emailService.sendDailyInstallReport(
        [FIXED_OPS_EMAIL],
        reportDate,
        installed,
        cancelled,
        pending
      );

      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({
          reportDate,
          totalOrders: installRows.length,
          installed: installed.length,
          cancelled: cancelled.length,
          pending: pending.length,
          emailsSent: emailResult.sent,
          emailsFailed: emailResult.failed,
        }),
      });

      console.log(`[Scheduler] Daily install report: ${installed.length} installed, ${cancelled.length} cancelled, ${pending.length} pending, sent to ${emailResult.sent} recipients`);
      return { sent: emailResult.sent, failed: emailResult.failed, installed: installed.length, cancelled: cancelled.length, pending: pending.length };
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Daily install report failed:", error);
      return { sent: 0, failed: 1, error: error.message };
    }
  },

  async checkLowPerformance() {
    const job = await storage.createBackgroundJob({
      jobType: "LOW_PERFORMANCE_CHECK",
    });
    
    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });
      
      const allUsers = await storage.getUsers();
      const reps = allUsers.filter(u => 
        ["REP", "MDU"].includes(u.role) && 
        u.status === "ACTIVE" && 
        !u.deletedAt
      );
      
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
      
      const allOrders = await storage.getOrders({});
      let repWarnings = 0;
      const lowPerformers: { name: string; repId: string; percentage: number; supervisorId: string | null }[] = [];
      const warningThreshold = 0.5; // 50% of quota
      
      for (const rep of reps) {
        // Get rep's sales goal for current period
        const goals = await storage.getSalesGoalsByUser(rep.id);
        const currentGoal = goals.find((g: { periodStart: string; periodEnd: string }) => 
          g.periodStart <= periodEnd && g.periodEnd >= periodStart
        );
        
        if (!currentGoal || currentGoal.salesTarget === 0) continue;
        
        // Count rep's approved orders in period
        const repOrders = allOrders.filter(o => 
          o.repId === rep.repId &&
          o.approvalStatus === "APPROVED" &&
          o.dateSold >= periodStart &&
          o.dateSold <= periodEnd
        );
        
        const current = repOrders.length;
        const target = currentGoal.salesTarget;
        const percentage = (current / target) * 100;
        
        // Calculate expected progress based on day of month
        const dayOfMonth = now.getDate();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const expectedProgress = (dayOfMonth / daysInMonth) * 100;
        
        // Alert if significantly below expected progress (less than 50% of expected)
        if (percentage < expectedProgress * warningThreshold && dayOfMonth > 7) {
          await emailService.notifyLowPerformanceWarning(rep, {
            current,
            target,
            percentage,
            periodType: currentGoal.periodType || "MONTHLY",
          });
          
          lowPerformers.push({
            name: rep.name,
            repId: rep.repId || "",
            percentage,
            supervisorId: rep.assignedSupervisorId,
          });
          repWarnings++;
        }
      }
      
      // Notify managers about their team members' low performance
      const managers = allUsers.filter(u => 
        ["LEAD", "MANAGER", "EXECUTIVE"].includes(u.role) && 
        u.status === "ACTIVE" && 
        !u.deletedAt
      );
      
      let managerAlerts = 0;
      for (const manager of managers) {
        const teamLowPerformers = lowPerformers.filter(lp => lp.supervisorId === manager.id);
        if (teamLowPerformers.length > 0) {
          await emailService.notifyManagerLowPerformance(manager, teamLowPerformers);
          managerAlerts++;
        }
      }
      
      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({ repWarnings, managerAlerts, repsChecked: reps.length }),
      });
      
      if (repWarnings > 0) {
        console.log(`[Scheduler] Sent ${repWarnings} low performance warnings`);
      }
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Low performance check failed:", error);
    }
  },

  scheduleStaleArAlert() {
    const ms = msUntilEasternTime(8, 0);
    setTimeout(() => {
      this.checkStaleAr();
      setInterval(() => this.checkStaleAr(), 24 * 60 * 60 * 1000);
    }, ms);
    console.log(`[Scheduler] Stale AR alert scheduled in ${Math.round(ms / 60000)} minutes`);
  },

  async checkStaleAr() {
    try {
      const staleOrders = await storage.getStaleArOrders(30);
      if (staleOrders.length === 0) return;

      const adminUsers = await storage.getUsers();
      const admins = adminUsers.filter(u => ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(u.role) && !u.deletedAt);

      for (const admin of admins) {
        const orderList = staleOrders.slice(0, 20).map(({ order, client }) =>
          `• ${order.invoiceNumber || order.id} - ${client?.name || "Unknown"}`
        ).join("\n");

        emailService.queueEmail({
          to: admin.email,
          subject: `[Alert] ${staleOrders.length} Orders with Stale AR (30+ days)`,
          text: `There are ${staleOrders.length} approved orders that have not received AR satisfaction for 30+ days:\n\n${orderList}`,
          html: `<p>There are <strong>${staleOrders.length}</strong> approved orders that have not received AR satisfaction for 30+ days:</p><ul>${staleOrders.slice(0, 20).map(({ order, client }) => `<li>${order.invoiceNumber || order.id} - ${client?.name || "Unknown"}</li>`).join("")}</ul>`,
        });
      }
      console.log(`[Scheduler] Stale AR alert: ${staleOrders.length} orders, notified ${admins.length} admins`);
    } catch (error) {
      console.error("[Scheduler] Stale AR check failed:", error);
    }
  },

  scheduleProfitAnomalyCheck() {
    const ms = msUntilEasternTime(7, 0);
    setTimeout(() => {
      this.checkProfitAnomalies();
      setInterval(() => this.checkProfitAnomalies(), 24 * 60 * 60 * 1000);
    }, ms);
    console.log(`[Scheduler] Profit anomaly check scheduled in ${Math.round(ms / 60000)} minutes`);
  },

  async checkProfitAnomalies() {
    try {
      const job = await storage.createBackgroundJob({
        jobType: "PROFIT_ANOMALY_CHECK",
        metadata: JSON.stringify({ triggeredAt: new Date().toISOString() }),
      });

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysStr = sevenDaysAgo.toISOString().split("T")[0];

      const recentOrders = await db.query.salesOrders.findMany({
        where: and(
          eq(salesOrders.approvalStatus, "APPROVED"),
          gte(salesOrders.dateSold, sevenDaysStr)
        ),
      });

      const avgByService = await db.select({
        serviceId: salesOrders.serviceId,
        avgProfit: sql<string>`AVG("iron_crest_profit_cents")`,
      }).from(salesOrders)
        .where(eq(salesOrders.approvalStatus, "APPROVED"))
        .groupBy(salesOrders.serviceId);
      const avgMap = new Map(avgByService.map(r => [r.serviceId, parseFloat(r.avgProfit || "0")]));

      const anomalies: { orderId: string; type: string; detail: string }[] = [];

      for (const order of recentOrders) {
        const profit = order.ironCrestProfitCents || 0;
        const expectedAvg = avgMap.get(order.serviceId) || 0;

        if (profit < 0) {
          anomalies.push({ orderId: order.id, type: "NEGATIVE_MARGIN", detail: `Profit: $${(profit / 100).toFixed(2)}` });
        } else if (profit === 0 && expectedAvg > 0) {
          anomalies.push({ orderId: order.id, type: "ZERO_MARGIN", detail: "Profit is $0.00 — possible calculation error" });
        } else if (expectedAvg > 0 && profit < expectedAvg * 0.8) {
          anomalies.push({ orderId: order.id, type: "PROFIT_BELOW_EXPECTED", detail: `Profit $${(profit / 100).toFixed(2)} is ${Math.round((1 - profit / expectedAvg) * 100)}% below avg $${(expectedAvg / 100).toFixed(2)}` });
        }
      }

      if (anomalies.length > 0) {
        const allUsers = await storage.getUsers();
        const recipients = allUsers.filter(u => ["EXECUTIVE", "ACCOUNTING"].includes(u.role) && u.status === "ACTIVE" && !u.deletedAt);

        const anomalyList = anomalies.slice(0, 15).map(a => `• ${a.type}: Order ${a.orderId.slice(0, 8)}... — ${a.detail}`).join("\n");
        for (const user of recipients) {
          emailService.queueEmail({
            to: user.email,
            subject: `[Alert] ${anomalies.length} Profit Anomalies Detected`,
            text: `${anomalies.length} profit anomalies found in orders from the last 7 days:\n\n${anomalyList}`,
            html: `<p><strong>${anomalies.length}</strong> profit anomalies detected:</p><ul>${anomalies.slice(0, 15).map(a => `<li><strong>${a.type}</strong>: ${a.orderId.slice(0, 8)}... — ${a.detail}</li>`).join("")}</ul>`,
          });
        }
      }

      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({ anomaliesFound: anomalies.length }),
      });
      if (anomalies.length > 0) {
        console.log(`[Scheduler] Profit anomaly check: ${anomalies.length} anomalies found`);
      }
    } catch (error: any) {
      console.error("[Scheduler] Profit anomaly check failed:", error);
    }
  },

  scheduleArCollectionPrediction() {
    const ms = msUntilEasternTime(6, 30);
    setTimeout(() => {
      this.predictArCollections();
      setInterval(() => this.predictArCollections(), 24 * 60 * 60 * 1000);
    }, ms);
    console.log(`[Scheduler] AR collection prediction scheduled in ${Math.round(ms / 60000)} minutes`);
  },

  async predictArCollections() {
    try {
      const job = await storage.createBackgroundJob({
        jobType: "AR_COLLECTION_PREDICTION",
        metadata: JSON.stringify({ triggeredAt: new Date().toISOString() }),
      });

      const openAr = await db.query.arExpectations.findMany({
        where: sql`"status" IN ('OPEN', 'PARTIAL')`,
      });

      const historicalAvg = await db.select({
        clientId: arExpectations.clientId,
        avgDays: sql<string>`AVG(EXTRACT(EPOCH FROM ("satisfied_at" - "created_at")) / 86400)`,
        satisfiedCount: sql<number>`count(*)`,
      }).from(arExpectations)
        .where(sql`"status" = 'SATISFIED' AND "satisfied_at" IS NOT NULL`)
        .groupBy(arExpectations.clientId);
      const clientAvgDays = new Map(historicalAvg.map(r => [r.clientId, { avgDays: parseFloat(r.avgDays || "30"), count: r.satisfiedCount || 0 }]));

      let lowProbCount = 0;
      let overdueCount = 0;

      const allUsers = await storage.getUsers();
      const acctUsers = allUsers.filter(u => ["ACCOUNTING", "ADMIN"].includes(u.role) && u.status === "ACTIVE" && !u.deletedAt);
      const clientsList = await storage.getClients();
      const clientMap = new Map(clientsList.map((c: any) => [c.id, c.name]));

      for (const ar of openAr) {
        const daysElapsed = (Date.now() - new Date(ar.createdAt).getTime()) / (24 * 60 * 60 * 1000);
        const clientHistory = clientAvgDays.get(ar.clientId);
        const expectedDays = clientHistory ? clientHistory.avgDays : 30;

        let probability: number;
        if (daysElapsed <= expectedDays * 0.5) probability = 95;
        else if (daysElapsed <= expectedDays) probability = 80;
        else if (daysElapsed <= expectedDays * 1.5) probability = 50;
        else if (daysElapsed <= expectedDays * 2) probability = 25;
        else probability = 10;

        const expectedCollectionDate = new Date(ar.createdAt);
        expectedCollectionDate.setDate(expectedCollectionDate.getDate() + Math.ceil(expectedDays));
        const isOverdue = expectedCollectionDate < new Date();

        if (probability < 50) lowProbCount++;
        if (isOverdue) overdueCount++;

        if (probability < 50 || isOverdue) {
          const clientName = clientMap.get(ar.clientId) || "Unknown";
          const outstanding = (ar.expectedAmountCents - ar.actualAmountCents) / 100;
          for (const user of acctUsers) {
            emailService.queueEmail({
              to: user.email,
              subject: `[AR Alert] Low collection probability: ${clientName}`,
              text: `AR expectation for ${clientName} has ${probability}% collection probability. Outstanding: $${outstanding.toFixed(2)}. Days elapsed: ${Math.round(daysElapsed)}.`,
              html: `<p>AR for <strong>${clientName}</strong>: <strong>${probability}%</strong> probability, $${outstanding.toFixed(2)} outstanding, ${Math.round(daysElapsed)} days elapsed.</p>`,
            });
          }
        }
      }

      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({ total: openAr.length, lowProbability: lowProbCount, overdue: overdueCount }),
      });
      if (lowProbCount > 0 || overdueCount > 0) {
        console.log(`[Scheduler] AR prediction: ${lowProbCount} low probability, ${overdueCount} overdue`);
      }
    } catch (error: any) {
      console.error("[Scheduler] AR collection prediction failed:", error);
    }
  },

  scheduleRepPerformancePrediction() {
    const weeklyMs = 7 * 24 * 60 * 60 * 1000;
    const ms = msUntilEasternTime(9, 0);
    setTimeout(() => {
      this.predictRepPerformance();
      setInterval(() => this.predictRepPerformance(), weeklyMs);
    }, ms);
    console.log(`[Scheduler] Rep performance prediction scheduled in ${Math.round(ms / 60000)} minutes`);
  },

  async predictRepPerformance() {
    try {
      const job = await storage.createBackgroundJob({
        jobType: "REP_PERFORMANCE_PREDICTION",
        metadata: JSON.stringify({ triggeredAt: new Date().toISOString() }),
      });

      const activeReps = await db.query.users.findMany({
        where: and(
          sql`"role" IN ('REP', 'LEAD')`,
          eq(users.status, "ACTIVE"),
          isNull(users.deletedAt)
        ),
      });

      const now = new Date();
      const formatDate = (d: Date) => d.toISOString().split("T")[0];
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const fourWeeksAgo = new Date(now);
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      const oneWeekAgo = new Date(now);
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const fiveDaysAgo = new Date(now);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const allUsers = await storage.getUsers();
      const alerts: { repId: string; repName: string; managerId: string | null; executiveId: string | null; type: string; detail: string }[] = [];

      for (const rep of activeReps) {
        if (!rep.repId) continue;

        const ninetyDayOrders = await db.select({ count: sql<number>`count(*)` })
          .from(salesOrders)
          .where(and(eq(salesOrders.repId, rep.repId), gte(salesOrders.dateSold, formatDate(ninetyDaysAgo))));
        const totalNinety = ninetyDayOrders[0]?.count || 0;
        const weeklyAvg = totalNinety / 13;

        const thisWeekOrders = await db.select({ count: sql<number>`count(*)` })
          .from(salesOrders)
          .where(and(eq(salesOrders.repId, rep.repId), gte(salesOrders.dateSold, formatDate(oneWeekAgo))));
        const thisWeek = thisWeekOrders[0]?.count || 0;

        if (weeklyAvg > 0 && thisWeek < weeklyAvg * 0.7) {
          alerts.push({
            repId: rep.repId, repName: rep.name, managerId: rep.assignedManagerId, executiveId: rep.assignedExecutiveId,
            type: "VELOCITY_DECLINING",
            detail: `${thisWeek} sales this week vs ${weeklyAvg.toFixed(1)} avg/week (${Math.round((1 - thisWeek / weeklyAvg) * 100)}% below)`,
          });
        }

        const fourWeekConnects = await db.select({
          total: sql<number>`count(*)`,
          completed: sql<number>`count(*) FILTER (WHERE "job_status" = 'COMPLETED')`,
        }).from(salesOrders)
          .where(and(eq(salesOrders.repId, rep.repId), gte(salesOrders.dateSold, formatDate(fourWeeksAgo)), lte(salesOrders.dateSold, formatDate(oneWeekAgo))));
        const prevTotal = fourWeekConnects[0]?.total || 0;
        const prevCompleted = fourWeekConnects[0]?.completed || 0;
        const prevRate = prevTotal > 0 ? (prevCompleted / prevTotal) * 100 : 0;

        const weekConnects = await db.select({
          total: sql<number>`count(*)`,
          completed: sql<number>`count(*) FILTER (WHERE "job_status" = 'COMPLETED')`,
        }).from(salesOrders)
          .where(and(eq(salesOrders.repId, rep.repId), gte(salesOrders.dateSold, formatDate(oneWeekAgo))));
        const weekTotal = weekConnects[0]?.total || 0;
        const weekCompleted = weekConnects[0]?.completed || 0;
        const weekRate = weekTotal > 0 ? (weekCompleted / weekTotal) * 100 : 0;

        if (prevRate > 0 && weekRate < prevRate * 0.85) {
          alerts.push({
            repId: rep.repId, repName: rep.name, managerId: rep.assignedManagerId, executiveId: rep.assignedExecutiveId,
            type: "CONNECT_RATE_DROPPING",
            detail: `Connect rate ${weekRate.toFixed(0)}% vs prior ${prevRate.toFixed(0)}% (down ${Math.round(prevRate - weekRate)}pp)`,
          });
        }

        const recentSale = await db.select({
          latest: sql<string>`MAX("date_sold")`,
        }).from(salesOrders).where(eq(salesOrders.repId, rep.repId));
        const lastSaleDate = recentSale[0]?.latest ? new Date(recentSale[0].latest) : null;
        const daysSinceLastSale = lastSaleDate ? Math.floor((now.getTime() - lastSaleDate.getTime()) / (24 * 60 * 60 * 1000)) : 999;

        if (daysSinceLastSale >= 5 && weeklyAvg >= 1) {
          alerts.push({
            repId: rep.repId, repName: rep.name, managerId: rep.assignedManagerId, executiveId: rep.assignedExecutiveId,
            type: "POTENTIAL_CHURN",
            detail: `No sale in ${daysSinceLastSale} days, was averaging ${weeklyAvg.toFixed(1)}/week`,
          });
        }
      }

      if (alerts.length > 0) {
        const managerAlerts = new Map<string, typeof alerts>();
        for (const alert of alerts) {
          const mgrId = alert.managerId || alert.executiveId || "unassigned";
          if (!managerAlerts.has(mgrId)) managerAlerts.set(mgrId, []);
          managerAlerts.get(mgrId)!.push(alert);
        }

        for (const [mgrId, mgrAlertList] of managerAlerts) {
          const mgr = allUsers.find(u => u.id === mgrId);
          if (!mgr || !["MANAGER", "EXECUTIVE"].includes(mgr.role)) continue;

          const alertText = mgrAlertList.map(a => `• ${a.repName}: ${a.type} — ${a.detail}`).join("\n");
          emailService.queueEmail({
            to: mgr.email,
            subject: `[Intelligence] ${mgrAlertList.length} Rep Performance Alerts`,
            text: `Rep performance alerts for your team:\n\n${alertText}`,
            html: `<p>Rep performance alerts:</p><ul>${mgrAlertList.map(a => `<li><strong>${a.repName}</strong>: ${a.type} — ${a.detail}</li>`).join("")}</ul>`,
          });
        }
      }

      await storage.updateBackgroundJob(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({ repsAnalyzed: activeReps.length, alertsGenerated: alerts.length }),
      });
      if (alerts.length > 0) {
        console.log(`[Scheduler] Rep performance: ${alerts.length} alerts for ${activeReps.length} reps`);
      }
    } catch (error: any) {
      console.error("[Scheduler] Rep performance prediction failed:", error);
    }
  },

  scheduleCarrierSftpPoll() {
    const ms = msUntilEasternTime(5, 0);
    setTimeout(() => {
      this.pollCarrierSftp();
      const interval = setInterval(() => this.pollCarrierSftp(), 24 * 60 * 60 * 1000);
      this.intervalIds.push(interval);
    }, ms);
    console.log(`[Scheduler] Carrier SFTP poll scheduled in ${Math.round(ms / 60000)} minutes`);
  },

  async pollCarrierSftp() {
    try {
      const schedules = await db.select().from(carrierImportSchedules)
        .where(and(eq(carrierImportSchedules.isActive, true), eq(carrierImportSchedules.sourceType, "sftp")));

      if (schedules.length === 0) return;

      for (const schedule of schedules) {
        if (!schedule.sftpHost || !schedule.sftpUser) continue;

        await db.insert(integrationLogs).values({
          integrationType: "CARRIER_SFTP", action: "POLL_ATTEMPTED",
          details: JSON.stringify({
            scheduleId: schedule.id,
            host: schedule.sftpHost,
            path: schedule.sftpRemotePath,
            message: "SFTP polling infrastructure ready. Configure SFTP credentials and install ssh2-sftp-client to activate live polling.",
          }),
          relatedEntityId: schedule.id,
        });

        await db.update(carrierImportSchedules).set({
          lastRunAt: new Date(),
          lastRunStatus: "INFRASTRUCTURE_READY",
        }).where(eq(carrierImportSchedules.id, schedule.id));
      }

      if (schedules.length > 0) {
        console.log(`[Scheduler] Carrier SFTP: checked ${schedules.length} schedules`);
      }
    } catch (error: any) {
      console.error("[Scheduler] Carrier SFTP poll failed:", error);
    }
  },

  scheduleReserveMaturityRelease() {
    const ms = msUntilEasternTime(6, 0);
    console.log(`[Scheduler] Reserve maturity release scheduled in ${Math.round(ms / 60000)} minutes (6:00 AM ET)`);
    const releaseJob = async () => {
      try {
        const result = await checkAndReleaseMaturedReserves();
        if (result.released > 0) {
          console.log(`[Scheduler] Reserve maturity: released ${result.released} reserves, $${(result.totalReleasedCents / 100).toFixed(2)} total`);
          await db.insert(systemExceptions).values({
            exceptionType: "RESERVE_MATURITY_RELEASE_DUE",
            severity: "INFO",
            title: `Maturity release processed: ${result.released} reserves`,
            detail: `Released $${(result.totalReleasedCents / 100).toFixed(2)} across ${result.released} reserves per Section 7 maturity schedule.`,
            relatedEntityType: "rolling_reserve",
          });
        }
      } catch (error: any) {
        console.error("[Scheduler] Reserve maturity release failed:", error);
      }
    };
    setTimeout(() => {
      runJobWithLock("reserveMaturityRelease", releaseJob);
      setInterval(() => runJobWithLock("reserveMaturityRelease", releaseJob), 24 * 60 * 60 * 1000);
    }, ms);
  },

  scheduleReserveDeficitCheck() {
    const ms = msUntilEasternTime(8, 0);
    console.log(`[Scheduler] Reserve deficit check scheduled in ${Math.round(ms / 60000)} minutes (8:00 AM ET)`);
    const deficitJob = async () => {
      try {
        const deficitReserves = await db.select({
          id: rollingReserves.id,
          userId: rollingReserves.userId,
          balance: rollingReserves.currentBalanceCents,
        }).from(rollingReserves).where(eq(rollingReserves.status, "DEFICIT"));

        for (const r of deficitReserves) {
          const [user] = await db.select({ name: users.name, repId: users.repId }).from(users).where(eq(users.id, r.userId));
          if (user) {
            console.log(`[Scheduler] Reserve deficit alert: ${user.name} (${user.repId}) — balance: $${(r.balance / 100).toFixed(2)}`);
            await db.insert(systemExceptions).values({
              exceptionType: "RESERVE_DEFICIT",
              severity: "WARNING",
              title: `Reserve deficit: ${user.name} (${user.repId})`,
              detail: `Rolling reserve balance is $${(r.balance / 100).toFixed(2)}, below the $2,500 cap. Withholding will resume per Section 3.`,
              relatedUserId: r.userId,
              relatedEntityId: r.id,
              relatedEntityType: "rolling_reserve",
            });
          }
        }

        if (deficitReserves.length > 0) {
          console.log(`[Scheduler] Reserve deficit: ${deficitReserves.length} reps in deficit`);
        }
      } catch (error: any) {
        console.error("[Scheduler] Reserve deficit check failed:", error);
      }
    };
    setTimeout(() => {
      runJobWithLock("reserveDeficitCheck", deficitJob);
      setInterval(() => runJobWithLock("reserveDeficitCheck", deficitJob), 24 * 60 * 60 * 1000);
    }, ms);
  },
};
