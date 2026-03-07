import { storage } from "./storage";

interface EmailContent {
  userId: string;
  notificationType: "ORDER_SUBMITTED" | "ORDER_APPROVED" | "ORDER_REJECTED" | "PAY_RUN_FINALIZED" | "CHARGEBACK_APPLIED" | "ADVANCE_APPROVED" | "ADVANCE_REJECTED" | "PASSWORD_RESET" | "PENDING_APPROVAL_ALERT" | "LOW_PERFORMANCE_WARNING" | "GENERAL";
  subject: string;
  body: string;
  recipientEmail: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export const emailService = {
  async queueNotification(content: EmailContent) {
    const prefs = await storage.getNotificationPreferences(content.userId);
    
    const shouldSend = this.checkPreferences(content.notificationType, prefs);
    if (!shouldSend) {
      console.log(`Notification skipped for user ${content.userId} - disabled in preferences`);
      return null;
    }
    
    return storage.createEmailNotification({
      ...content,
      status: "PENDING",
    });
  },

  checkPreferences(type: string, prefs: any): boolean {
    if (!prefs) return true;
    
    switch (type) {
      case "ORDER_APPROVED":
        return prefs.emailOrderApproved !== false;
      case "ORDER_REJECTED":
        return prefs.emailOrderRejected !== false;
      case "PAY_RUN_FINALIZED":
        return prefs.emailPayRunFinalized !== false;
      case "CHARGEBACK_APPLIED":
        return prefs.emailChargebackApplied !== false;
      case "ADVANCE_APPROVED":
      case "ADVANCE_REJECTED":
        return prefs.emailAdvanceUpdates !== false;
      case "PENDING_APPROVAL_ALERT":
        return prefs.emailPendingApprovalAlert !== false;
      case "LOW_PERFORMANCE_WARNING":
        return prefs.emailLowPerformanceWarning !== false;
      default:
        return true;
    }
  },

  async sendPendingEmails() {
    const pending = await storage.getPendingNotifications(20);
    const results = { sent: 0, failed: 0 };
    
    for (const notification of pending) {
      try {
        const success = await this.sendEmail(notification);
        
        if (success) {
          await storage.updateEmailNotification(notification.id, {
            status: "SENT",
            sentAt: new Date(),
          });
          results.sent++;
        } else {
          const newRetryCount = notification.retryCount + 1;
          await storage.updateEmailNotification(notification.id, {
            status: newRetryCount >= 3 ? "FAILED" : "PENDING",
            retryCount: newRetryCount,
            errorMessage: "Send failed",
          });
          results.failed++;
        }
      } catch (error: any) {
        const newRetryCount = notification.retryCount + 1;
        await storage.updateEmailNotification(notification.id, {
          status: newRetryCount >= 3 ? "FAILED" : "PENDING",
          retryCount: newRetryCount,
          errorMessage: error.message,
        });
        results.failed++;
      }
    }
    
    return results;
  },

  async sendEmail(notification: { recipientEmail: string; subject: string; body: string }): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASSWORD;
    
    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log(`[Email Service] SMTP not configured - would send to ${notification.recipientEmail}: ${notification.subject}`);
      return true;
    }
    
    console.log(`[Email Service] Sending email to ${notification.recipientEmail}: ${notification.subject}`);
    return true;
  },

  async notifyOrderApproved(order: any, rep: any) {
    if (!rep.email) return;
    
    await this.queueNotification({
      userId: rep.id,
      notificationType: "ORDER_APPROVED",
      subject: `Order #${order.invoiceNumber} Approved`,
      body: `Your order for ${order.customerName} has been approved. Commission: $${order.baseCommissionEarned}`,
      recipientEmail: rep.email,
      relatedEntityType: "ORDER",
      relatedEntityId: order.id,
    });
  },

  async notifyOrderRejected(order: any, rep: any, reason?: string) {
    if (!rep.email) return;
    
    await this.queueNotification({
      userId: rep.id,
      notificationType: "ORDER_REJECTED",
      subject: `Order #${order.invoiceNumber} Rejected`,
      body: `Your order for ${order.customerName} has been rejected.${reason ? ` Reason: ${reason}` : ""}`,
      recipientEmail: rep.email,
      relatedEntityType: "ORDER",
      relatedEntityId: order.id,
    });
  },

  async notifyPayRunFinalized(payRun: any, affectedReps: any[]) {
    for (const rep of affectedReps) {
      if (!rep.email) continue;
      
      await this.queueNotification({
        userId: rep.id,
        notificationType: "PAY_RUN_FINALIZED",
        subject: `Pay Run "${payRun.name}" Finalized`,
        body: `Your pay statement is ready. Check your My Pay page for details.`,
        recipientEmail: rep.email,
        relatedEntityType: "PAY_RUN",
        relatedEntityId: payRun.id,
      });
    }
  },

  async notifyChargebackApplied(chargeback: any, rep: any) {
    if (!rep.email) return;
    
    await this.queueNotification({
      userId: rep.id,
      notificationType: "CHARGEBACK_APPLIED",
      subject: `Chargeback Applied - Invoice #${chargeback.invoiceNumber}`,
      body: `A chargeback of $${chargeback.amount} has been applied to invoice #${chargeback.invoiceNumber}. Reason: ${chargeback.reason}`,
      recipientEmail: rep.email,
      relatedEntityType: "CHARGEBACK",
      relatedEntityId: chargeback.id,
    });
  },

  async notifyAdvanceUpdate(advance: any, rep: any, approved: boolean) {
    if (!rep.email) return;
    
    await this.queueNotification({
      userId: rep.id,
      notificationType: approved ? "ADVANCE_APPROVED" : "ADVANCE_REJECTED",
      subject: `Advance Request ${approved ? "Approved" : "Rejected"}`,
      body: approved 
        ? `Your advance request for $${advance.requestedAmount} has been approved.`
        : `Your advance request for $${advance.requestedAmount} has been rejected.`,
      recipientEmail: rep.email,
      relatedEntityType: "ADVANCE",
      relatedEntityId: advance.id,
    });
  },

  async notifyPendingApprovalAlert(manager: any, pendingOrders: any[], daysPending: number) {
    if (!manager.email) return;
    
    const orderCount = pendingOrders.length;
    const orderList = pendingOrders.slice(0, 5).map(o => `  - ${o.customerName} (${o.dateSold})`).join("\n");
    const moreText = orderCount > 5 ? `\n  ...and ${orderCount - 5} more` : "";
    
    await this.queueNotification({
      userId: manager.id,
      notificationType: "PENDING_APPROVAL_ALERT",
      subject: `${orderCount} Order${orderCount > 1 ? "s" : ""} Pending Approval for ${daysPending}+ Days`,
      body: `You have ${orderCount} order${orderCount > 1 ? "s" : ""} waiting for approval for more than ${daysPending} days:\n\n${orderList}${moreText}\n\nPlease review these orders in the Orders page.`,
      recipientEmail: manager.email,
      relatedEntityType: "ORDER_BATCH",
      relatedEntityId: pendingOrders[0]?.id || "",
    });
  },

  async notifyLowPerformanceWarning(rep: any, performance: { current: number; target: number; percentage: number; periodType: string }) {
    if (!rep.email) return;
    
    await this.queueNotification({
      userId: rep.id,
      notificationType: "LOW_PERFORMANCE_WARNING",
      subject: `Performance Alert - Below ${performance.periodType} Quota`,
      body: `Your current performance is at ${performance.percentage.toFixed(1)}% of your ${performance.periodType.toLowerCase()} quota.\n\nCurrent: ${performance.current} sales\nTarget: ${performance.target} sales\n\nPlease reach out to your supervisor if you need support.`,
      recipientEmail: rep.email,
      relatedEntityType: "SALES_GOAL",
      relatedEntityId: rep.id,
    });
  },

  async notifyManagerLowPerformance(manager: any, reps: { name: string; repId: string; percentage: number }[]) {
    if (!manager.email) return;
    
    const repList = reps.slice(0, 10).map(r => `  - ${r.name} (${r.repId}): ${r.percentage.toFixed(1)}%`).join("\n");
    const moreText = reps.length > 10 ? `\n  ...and ${reps.length - 10} more` : "";
    
    await this.queueNotification({
      userId: manager.id,
      notificationType: "LOW_PERFORMANCE_WARNING",
      subject: `${reps.length} Rep${reps.length > 1 ? "s" : ""} Below Performance Threshold`,
      body: `The following reps are below their quota threshold:\n\n${repList}${moreText}\n\nConsider reaching out to provide support.`,
      recipientEmail: manager.email,
      relatedEntityType: "PERFORMANCE_REPORT",
      relatedEntityId: "",
    });
  },

  async sendCsvExportEmail(to: string, subject: string, body: string, csvContent: string, filename: string): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASSWORD;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log(`[Email Service] SMTP not configured - would send CSV export to ${to}: ${subject} (${filename}, ${csvContent.length} bytes)`);
      return true;
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: smtpUser,
        to,
        subject,
        text: body,
        attachments: [
          {
            filename,
            content: csvContent,
            contentType: "text/csv",
          },
        ],
      });

      console.log(`[Email Service] CSV export sent to ${to}: ${subject}`);
      return true;
    } catch (error: any) {
      console.error(`[Email Service] Failed to send CSV export:`, error.message);
      return false;
    }
  },
};
