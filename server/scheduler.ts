import { storage } from "./storage";
import { emailService } from "./email";

export const scheduler = {
  intervalIds: [] as NodeJS.Timeout[],
  isRunning: false,

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
    this.isRunning = false;
    console.log("[Scheduler] Stopped all background jobs");
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

  async runManualJob(jobType: "SCHEDULED_PAY_RUN" | "CHARGEBACK_PROCESSOR" | "NOTIFICATION_SENDER") {
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
    }
  },
};
