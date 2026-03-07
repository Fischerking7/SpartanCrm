import { storage } from "./storage";
import { emailService } from "./email";
import { setForceLogoutTimestamp } from "./auth";

export const scheduler = {
  intervalIds: [] as NodeJS.Timeout[],
  midnightTimeout: null as NodeJS.Timeout | null,
  isRunning: false,

  dailyReportTimeout: null as NodeJS.Timeout | null,
  installReportTimeout: null as NodeJS.Timeout | null,

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[Scheduler] Starting background job scheduler...");

    const scheduleInterval = setInterval(() => this.checkScheduledPayRuns(), 60000);
    this.intervalIds.push(scheduleInterval);

    const chargebackInterval = setInterval(() => this.processChargebacks(), 300000);
    this.intervalIds.push(chargebackInterval);

    const emailInterval = setInterval(() => emailService.sendPendingEmails(), 60000);
    this.intervalIds.push(emailInterval);

    // Run pending approval alerts every 6 hours
    const pendingApprovalInterval = setInterval(() => this.checkPendingApprovalAlerts(), 6 * 60 * 60 * 1000);
    this.intervalIds.push(pendingApprovalInterval);

    // Run low performance checks daily
    const performanceInterval = setInterval(() => this.checkLowPerformance(), 24 * 60 * 60 * 1000);
    this.intervalIds.push(performanceInterval);

    this.scheduleMidnightLogout();
    this.scheduleDailySalesReport();
    this.scheduleDailyInstallReport();

    setTimeout(() => {
      this.checkScheduledPayRuns();
      this.processChargebacks();
      emailService.sendPendingEmails();
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
    if (this.dailyReportTimeout) {
      clearTimeout(this.dailyReportTimeout);
      this.dailyReportTimeout = null;
    }
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

  async createScheduledPayRun(schedule: any) {
    const job = await storage.createBackgroundJob({
      jobType: "SCHEDULED_PAY_RUN",
      metadata: JSON.stringify({ scheduleId: schedule.id, scheduleName: schedule.name }),
    });
    
    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });
      
      const now = new Date();
      const weekEndingDate = now.toISOString().split("T")[0];
      let periodStart: string;
      
      switch (schedule.frequency) {
        case "WEEKLY":
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          periodStart = weekAgo.toISOString().split("T")[0];
          break;
        case "BIWEEKLY":
          const twoWeeksAgo = new Date(now);
          twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
          periodStart = twoWeeksAgo.toISOString().split("T")[0];
          break;
        case "SEMIMONTHLY":
          const halfMonthAgo = new Date(now);
          halfMonthAgo.setDate(halfMonthAgo.getDate() - 15);
          periodStart = halfMonthAgo.toISOString().split("T")[0];
          break;
        case "MONTHLY":
        default:
          const monthAgo = new Date(now);
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          periodStart = monthAgo.toISOString().split("T")[0];
          break;
      }
      
      const payRun = await storage.createPayRun({
        name: `${schedule.name} - ${now.toLocaleDateString()}`,
        weekEndingDate,
        status: "DRAFT",
        createdByUserId: schedule.createdByUserId || "SYSTEM",
      });
      
      if (schedule.autoLinkOrders) {
        await this.autoLinkOrders(payRun.id, periodStart, weekEndingDate);
      }
      
      const nextRun = this.calculateNextRunDate(schedule);
      await storage.updateScheduledPayRun(schedule.id, {
        lastRunAt: now,
        nextRunAt: nextRun,
      });
      
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
    
    console.log(`[Scheduler] Linked ${linked} orders to pay run`);
    return linked;
  },

  calculateNextRunDate(schedule: any): Date {
    const now = new Date();
    let next = new Date(now);
    
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
    const now = new Date();
    const tenPM = new Date(now);
    tenPM.setHours(22, 0, 0, 0);
    if (now >= tenPM) {
      tenPM.setDate(tenPM.getDate() + 1);
    }
    const msUntil = tenPM.getTime() - now.getTime();

    console.log(`[Scheduler] Daily sales report scheduled in ${Math.round(msUntil / 60000)} minutes (10:00 PM)`);

    this.dailyReportTimeout = setTimeout(() => {
      this.generateDailySalesReport();
      this.scheduleDailySalesReport();
    }, msUntil);
  },

  async generateDailySalesReport() {
    const job = await storage.createBackgroundJob({
      jobType: "DAILY_SALES_REPORT",
    });

    try {
      await storage.updateBackgroundJob(job.id, { status: "RUNNING", startedAt: new Date() });

      const today = new Date();
      const reportDate = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const todayStr = `${yyyy}-${mm}-${dd}`;

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

      const FIXED_OPS_EMAIL = "ironcrestoperations@ironcrest.ai";
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
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Daily sales report failed:", error);
    }
  },

  scheduleDailyInstallReport() {
    const now = new Date();
    const threePM = new Date(now);
    threePM.setHours(15, 0, 0, 0);
    if (now >= threePM) {
      threePM.setDate(threePM.getDate() + 1);
    }
    const msUntil = threePM.getTime() - now.getTime();

    console.log(`[Scheduler] Daily install report scheduled in ${Math.round(msUntil / 60000)} minutes (3:00 PM)`);

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

      const today = new Date();
      const reportDate = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;

      const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const monthEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const syncRuns = await storage.getInstallSyncRuns(200);
      const orderWoStatusMap = new Map<string, string>();

      for (const run of syncRuns) {
        if (!run.matchDetails) continue;
        try {
          const details = JSON.parse(run.matchDetails);
          if (details.matches && Array.isArray(details.matches)) {
            for (const m of details.matches) {
              if (m.orderId) {
                const woStatus = (m.sheetData?.WO_STATUS || "").trim().toUpperCase();
                if (woStatus) {
                  orderWoStatusMap.set(m.orderId, woStatus);
                }
              }
            }
          }
        } catch {}
      }

      const allUsers = await storage.getUsers();
      const userMap = new Map(allUsers.map(u => [u.repId, u.name]));
      const allProviders = await storage.getProviders();
      const providerMap = new Map(allProviders.map(p => [p.id, p.name]));
      const allServices = await storage.getServices();
      const serviceMap = new Map(allServices.map(s => [s.id, s.name]));

      const allOrders = orderWoStatusMap.size > 0 ? await storage.getOrders({}) : [];
      const syncedOrders = allOrders.filter(o =>
        orderWoStatusMap.has(o.id) &&
        o.dateSold >= monthStart &&
        o.dateSold <= monthEnd
      );

      const installRows = syncedOrders.map(o => {
        const woStatus = orderWoStatusMap.get(o.id) || "";
        let statusLabel: string;
        if (woStatus === "CP") {
          statusLabel = "INSTALLED";
        } else if (woStatus === "CN") {
          statusLabel = "CANCELLED";
        } else if (woStatus === "OP" || woStatus === "ND") {
          statusLabel = "PENDING";
        } else {
          statusLabel = "PENDING";
        }

        return {
          repId: o.repId || "",
          repName: userMap.get(o.repId || "") || o.repId || "Unknown",
          provider: providerMap.get(o.providerId) || "Unknown",
          service: serviceMap.get(o.serviceId) || "Unknown",
          customerName: o.customerName || "",
          accountNumber: o.accountNumber || "",
          jobStatus: statusLabel,
          dateSold: o.dateSold || "",
          installDate: o.installDate || "",
          installTime: o.installTime || "",
          installType: o.installType || "",
        };
      });

      const installed = installRows.filter(r => r.jobStatus === "INSTALLED");
      const cancelled = installRows.filter(r => r.jobStatus === "CANCELLED");
      const pending = installRows.filter(r => r.jobStatus === "PENDING");

      const FIXED_OPS_EMAIL = "ironcrestoperations@ironcrest.ai";
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
    } catch (error: any) {
      await storage.updateBackgroundJob(job.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error.message,
      });
      console.error("[Scheduler] Daily install report failed:", error);
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
};
