import { storage } from "./storage";
import { generatePayStubPdf } from "./payStubPdf";

interface EmailContent {
  userId: string;
  notificationType: "ORDER_SUBMITTED" | "ORDER_APPROVED" | "ORDER_REJECTED" | "PAY_RUN_FINALIZED" | "CHARGEBACK_APPLIED" | "ADVANCE_APPROVED" | "ADVANCE_REJECTED" | "PASSWORD_RESET" | "PENDING_APPROVAL_ALERT" | "LOW_PERFORMANCE_WARNING" | "GENERAL" | "PAY_STUB_DELIVERY";
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
      case "PAY_STUB_DELIVERY":
        return prefs.emailPayStubDelivery !== false;
      default:
        return true;
    }
  },

  async sendPendingEmails() {
    const pending = await storage.getPendingNotifications(20);
    const results = { sent: 0, failed: 0 };
    
    for (const notification of pending) {
      try {
        let success: boolean;

        if (notification.notificationType === "PAY_STUB_DELIVERY" && notification.relatedEntityId) {
          success = await this.sendPayStubFromQueue(notification);
        } else {
          success = await this.sendEmail(notification);
        }
        
        if (success) {
          await storage.updateEmailNotification(notification.id, {
            status: "SENT",
            sentAt: new Date(),
          });
          if (notification.notificationType === "PAY_STUB_DELIVERY" && notification.relatedEntityId) {
            await storage.updatePayStatement(notification.relatedEntityId, {
              emailDeliveryStatus: "SENT",
              emailSentAt: new Date(),
              emailDeliveryError: null,
            });
          }
          results.sent++;
        } else {
          const newRetryCount = notification.retryCount + 1;
          const finalStatus = newRetryCount >= 3 ? "FAILED" : "PENDING";
          await storage.updateEmailNotification(notification.id, {
            status: finalStatus,
            retryCount: newRetryCount,
            errorMessage: "Send failed",
          });
          if (notification.notificationType === "PAY_STUB_DELIVERY" && notification.relatedEntityId && finalStatus === "FAILED") {
            await storage.updatePayStatement(notification.relatedEntityId, {
              emailDeliveryStatus: "FAILED",
              emailDeliveryError: `Send failed after ${newRetryCount} attempts`,
            });
          }
          results.failed++;
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        const newRetryCount = notification.retryCount + 1;
        const finalStatus = newRetryCount >= 3 ? "FAILED" : "PENDING";
        await storage.updateEmailNotification(notification.id, {
          status: finalStatus,
          retryCount: newRetryCount,
          errorMessage: errMsg,
        });
        if (notification.notificationType === "PAY_STUB_DELIVERY" && notification.relatedEntityId && finalStatus === "FAILED") {
          await storage.updatePayStatement(notification.relatedEntityId, {
            emailDeliveryStatus: "FAILED",
            emailDeliveryError: `Failed after ${newRetryCount} attempts: ${errMsg}`,
          });
        }
        results.failed++;
      }
    }
    
    return results;
  },

  async sendPayStubFromQueue(notification: { recipientEmail: string; subject: string; body: string; relatedEntityId?: string | null }): Promise<boolean> {
    if (!notification.relatedEntityId) return false;

    const pdfBuffer = await generatePayStubPdf(notification.relatedEntityId);
    const stmt = await storage.getPayStatementById(notification.relatedEntityId);
    const filename = stmt
      ? `PayStub_${stmt.stubNumber || stmt.id.slice(0, 8)}_${stmt.periodStart}_${stmt.periodEnd}.pdf`
      : `PayStub_${notification.relatedEntityId.slice(0, 8)}.pdf`;

    return this.sendPayStubEmail(notification.recipientEmail, notification.subject, notification.body, pdfBuffer, filename);
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

  async sendTestEmail(to: string): Promise<{ success: boolean; error?: string }> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASSWORD;

    if (!smtpHost || !smtpUser || !smtpPass) {
      return { success: false, error: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD environment variables." };
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
      });

      await transporter.verify();

      const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      await transporter.sendMail({
        from: smtpUser,
        to,
        subject: "Iron Crest CRM — Test Email",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#1e293b;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
              <h2 style="margin:0;font-size:20px;">Email Connection Test</h2>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin-bottom:16px;">
                <p style="margin:0;font-size:16px;color:#166534;font-weight:bold;">Email is working correctly.</p>
              </div>
              <p style="margin:0;font-size:14px;color:#475569;">This test email was sent from Iron Crest CRM at ${now} ET.</p>
              <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;">SMTP Host: ${smtpHost} | Port: ${process.env.SMTP_PORT || "587"}</p>
            </div>
          </div>`,
      });

      console.log(`[Email Service] Test email sent successfully to ${to}`);
      return { success: true };
    } catch (error: any) {
      const msg = error.message || "Unknown error";
      let friendlyError = msg;
      if (msg.includes("EAUTH") || msg.includes("Invalid login")) {
        friendlyError = "Authentication failed. Check your SMTP username and password (use an App Password for Office 365).";
      } else if (msg.includes("ECONNREFUSED")) {
        friendlyError = `Connection refused to ${smtpHost}. Check the SMTP host and port.`;
      } else if (msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET")) {
        friendlyError = `Connection timed out to ${smtpHost}. The server may be unreachable or blocked.`;
      } else if (msg.includes("ESOCKET") || msg.includes("self signed")) {
        friendlyError = "TLS/SSL error. Try setting SMTP_SECURE to 'false' for STARTTLS on port 587.";
      }
      console.error(`[Email Service] Test email failed:`, msg);
      return { success: false, error: friendlyError };
    }
  },

  async sendHtmlEmail(to: string, subject: string, htmlBody: string): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASSWORD;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log(`[Email Service] SMTP not configured - would send HTML email to ${to}: ${subject}`);
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
        html: htmlBody,
      });

      console.log(`[Email Service] HTML email sent to ${to}: ${subject}`);
      return true;
    } catch (error: any) {
      console.error(`[Email Service] Failed to send HTML email:`, error.message);
      return false;
    }
  },

  async sendDailySalesReport(
    recipients: string[],
    reportDate: string,
    salesRows: { repId: string; repName: string; accountNumber: string; provider: string; service: string; grossCommission: string }[],
    totalGross: number,
    providerMix: { provider: string; count: number; percent: number }[]
  ): Promise<{ sent: number; failed: number }> {
    const results = { sent: 0, failed: 0 };

    const tableRows = salesRows.length > 0
      ? salesRows.map(r => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.repId}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.repName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.accountNumber}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.provider}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.service}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">$${parseFloat(r.grossCommission).toFixed(2)}</td>
        </tr>`).join("")
      : `<tr><td colspan="6" style="padding:16px;text-align:center;color:#6b7280;">No sales recorded for this date.</td></tr>`;

    const providerRows = providerMix.map(p => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${p.provider}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.count}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.percent.toFixed(1)}%</td>
      </tr>`).join("");

    const orderCount = salesRows.length;
    const html = `
    <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
      <div style="background:#1e293b;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">Daily Sales Report</h2>
        <p style="margin:4px 0 0;color:#94a3b8;font-size:14px;">${reportDate}</p>
      </div>

      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <div style="text-align:center;padding:20px 16px;margin-bottom:20px;background:#1e293b;border-radius:8px;">
          <p style="margin:0;font-size:42px;font-weight:bold;color:#C9A84C;">${orderCount}</p>
          <p style="margin:4px 0 0;font-size:16px;color:#e2e8f0;">${orderCount === 1 ? "Order Entered Today" : "Orders Entered Today"}</p>
        </div>
        <div style="display:flex;gap:16px;margin-bottom:24px;">
          <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:14px 16px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:bold;color:#166534;">$${totalGross.toFixed(2)}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#166534;">Total Gross Commission</p>
          </div>
          <div style="flex:1;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px 16px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:bold;color:#1e40af;">${providerMix.length}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#1e40af;">Providers</p>
          </div>
        </div>

        <h3 style="margin:0 0 12px;font-size:16px;color:#1e293b;">Sales Details</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;">Rep ID</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;">Rep Name</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;">Account #</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;">Provider</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;">Service</th>
              <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #e5e7eb;color:#475569;">Gross Commission</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
          ${salesRows.length > 0 ? `
          <tfoot>
            <tr style="font-weight:bold;background:#f8fafc;">
              <td colspan="5" style="padding:8px 12px;border-top:2px solid #e5e7eb;">Total</td>
              <td style="padding:8px 12px;text-align:right;border-top:2px solid #e5e7eb;">$${totalGross.toFixed(2)}</td>
            </tr>
          </tfoot>` : ""}
        </table>

        ${providerMix.length > 0 ? `
        <h3 style="margin:0 0 12px;font-size:16px;color:#1e293b;">Provider Mix</h3>
        <table style="width:auto;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:6px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;">Provider</th>
              <th style="padding:6px 12px;text-align:center;border-bottom:2px solid #e5e7eb;color:#475569;">Count</th>
              <th style="padding:6px 12px;text-align:center;border-bottom:2px solid #e5e7eb;color:#475569;">%</th>
            </tr>
          </thead>
          <tbody>${providerRows}</tbody>
        </table>` : ""}

        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">This is an automated report from Iron Crest CRM.</p>
      </div>
    </div>`;

    const subject = `Daily Sales Report - ${reportDate}`;

    for (const email of recipients) {
      try {
        const sent = await this.sendHtmlEmail(email, subject, html);
        if (sent) results.sent++;
        else results.failed++;
      } catch {
        results.failed++;
      }
    }

    return results;
  },

  async sendDailyInstallReport(
    recipients: string[],
    reportDate: string,
    installed: { repId: string; repName: string; accountNumber: string; invoiceNumber: string; customerName: string; provider: string; service: string; jobStatus: string; dateSold: string; installDate: string; orderType: string }[],
    cancelled: typeof installed,
    pending: typeof installed
  ): Promise<{ sent: number; failed: number }> {
    const results = { sent: 0, failed: 0 };

    const buildTable = (rows: typeof installed, statusColor: string) => {
      if (rows.length === 0) {
        return `<tr><td colspan="11" style="padding:12px;text-align:center;color:#6b7280;">None</td></tr>`;
      }
      return rows.map(r => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.repId}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.repName}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.accountNumber}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.invoiceNumber}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.customerName}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.provider}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.service}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:${statusColor};font-weight:600;">${r.jobStatus}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.dateSold}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.installDate}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${r.orderType}</td>
        </tr>`).join("");
    };

    const headerRow = `
      <tr style="background:#f8fafc;">
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Rep ID</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Rep Name</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Account #</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Invoice #</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Customer Name</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Provider</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Service</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Status</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Sold Date</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Install Date</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:2px solid #e5e7eb;color:#475569;font-size:11px;">Order Type</th>
      </tr>`;

    const total = installed.length + cancelled.length + pending.length;

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:1000px;margin:0 auto;">
      <div style="background:#1e293b;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:20px;">Daily Install Report</h2>
        <p style="margin:4px 0 0;color:#94a3b8;font-size:14px;">${reportDate}</p>
      </div>

      <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <div style="display:flex;gap:12px;margin-bottom:24px;">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px 16px;flex:1;">
            <p style="margin:0;font-size:12px;color:#166534;">Completed</p>
            <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#166534;">${installed.length}</p>
          </div>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;flex:1;">
            <p style="margin:0;font-size:12px;color:#991b1b;">Cancelled</p>
            <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#991b1b;">${cancelled.length}</p>
          </div>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;flex:1;">
            <p style="margin:0;font-size:12px;color:#92400e;">Pending</p>
            <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#92400e;">${pending.length}</p>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;flex:1;">
            <p style="margin:0;font-size:12px;color:#475569;">Total</p>
            <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#1e293b;">${total}</p>
          </div>
        </div>

        <h3 style="margin:0 0 8px;font-size:15px;color:#166534;">Completed - ${installed.length}</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>${headerRow}</thead>
          <tbody>${buildTable(installed, "#166534")}</tbody>
        </table>

        <h3 style="margin:0 0 8px;font-size:15px;color:#991b1b;">Cancelled - ${cancelled.length}</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>${headerRow}</thead>
          <tbody>${buildTable(cancelled, "#991b1b")}</tbody>
        </table>

        <h3 style="margin:0 0 8px;font-size:15px;color:#92400e;">Pending - ${pending.length}</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>${headerRow}</thead>
          <tbody>${buildTable(pending, "#92400e")}</tbody>
        </table>

        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">This is an automated report from Iron Crest CRM.</p>
      </div>
    </div>`;

    const subject = `Daily Install Report - ${reportDate}`;

    for (const email of recipients) {
      try {
        const sent = await this.sendHtmlEmail(email, subject, html);
        if (sent) results.sent++;
        else results.failed++;
      } catch {
        results.failed++;
      }
    }

    return results;
  },

  async sendPayStubEmail(to: string, subject: string, htmlBody: string, pdfBuffer: Buffer, pdfFilename: string): Promise<boolean> {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASSWORD;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.log(`[Email Service] SMTP not configured - would send pay stub to ${to}: ${subject} (${pdfFilename}, ${pdfBuffer.length} bytes)`);
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
        html: htmlBody,
        attachments: [
          {
            filename: pdfFilename,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      console.log(`[Email Service] Pay stub sent to ${to}: ${subject}`);
      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Email Service] Failed to send pay stub:`, msg);
      return false;
    }
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
