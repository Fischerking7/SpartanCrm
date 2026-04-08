import { storage } from "./storage";
import { emailService } from "./email";
import { generatePayStubPdf } from "./payStubPdf";

function buildPayStubHtml(repName: string, periodLabel: string, netPay: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
    <div style="background:#1B2A4A;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h2 style="margin:0;font-size:20px;">Pay Statement Ready</h2>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:14px;">Iron Crest</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
      <p style="margin:0 0 16px;">Hi ${repName},</p>
      <p style="margin:0 0 16px;">Your pay statement for <strong>${periodLabel}</strong> is ready.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin-bottom:16px;">
        <p style="margin:0;font-size:14px;color:#166534;">Net Pay: <strong style="font-size:18px;">${netPay}</strong></p>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Your detailed pay stub PDF is attached. You can also view your full pay history by logging into Iron Crest CRM.</p>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">This is an automated notification from Iron Crest CRM.</p>
    </div>
  </div>`;
}

interface DeliveryResult {
  statementId: string;
  status: "SENT" | "FAILED" | "SKIPPED";
  error?: string;
}

export async function deliverPayStubEmail(
  stmt: { id: string; userId: string; repName: string | null; repEmail: string | null; periodStart: string; periodEnd: string; netPay: string; grossCommission: string; deductionsTotal: string; stubNumber: string | null },
  userEmail?: string | null,
  userName?: string | null
): Promise<DeliveryResult> {
  const email = stmt.repEmail || userEmail;
  if (!email) {
    await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "SKIPPED", emailDeliveryError: "No email address on file" });
    return { statementId: stmt.id, status: "SKIPPED", error: "No email address on file" };
  }

  const prefs = await storage.getNotificationPreferences(stmt.userId);
  if (prefs?.emailPayStubDelivery === false) {
    await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "SKIPPED", emailDeliveryError: "Opted out of pay stub emails" });
    return { statementId: stmt.id, status: "SKIPPED", error: "Opted out" };
  }

  try {
    const pdfBuffer = await generatePayStubPdf(stmt.id);
    const periodLabel = `${stmt.periodStart} to ${stmt.periodEnd}`;
    const netPayFormatted = `$${parseFloat(stmt.netPay).toFixed(2)}`;
    const stubNum = stmt.stubNumber || stmt.id.slice(0, 8);
    const subject = `Your Pay Statement - ${periodLabel}`;
    const htmlBody = buildPayStubHtml(stmt.repName || userName || "Team Member", periodLabel, netPayFormatted);
    const filename = `PayStub_${stubNum}_${stmt.periodStart}_${stmt.periodEnd}.pdf`;

    const sent = await emailService.sendPayStubEmail(email, subject, htmlBody, pdfBuffer, filename);

    if (sent) {
      await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "SENT", emailSentAt: new Date(), emailDeliveryError: null });
      return { statementId: stmt.id, status: "SENT" };
    } else {
      await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "FAILED", emailDeliveryError: "Email send failed" });
      return { statementId: stmt.id, status: "FAILED", error: "Email send failed" };
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[PayStub Email] Failed for statement ${stmt.id}:`, errMsg);
    await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "FAILED", emailDeliveryError: errMsg });
    return { statementId: stmt.id, status: "FAILED", error: errMsg };
  }
}

export async function deliverPayStubsForPayRun(payRunId: string): Promise<DeliveryResult[]> {
  const statements = await storage.getPayStatements(payRunId);
  const allUsers = await storage.getUsers();
  const userMap = new Map(allUsers.map(u => [u.id, u]));
  const results: DeliveryResult[] = [];

  for (const stmt of statements) {
    const user = userMap.get(stmt.userId);
    const result = await deliverPayStubEmail(stmt, user?.email, user?.name);
    results.push(result);
  }

  console.log(`[PayStub Email] Delivery complete for pay run ${payRunId}: ${results.filter(r => r.status === "SENT").length} sent, ${results.filter(r => r.status === "FAILED").length} failed, ${results.filter(r => r.status === "SKIPPED").length} skipped`);
  return results;
}

export async function retryFailedPayStubEmails(): Promise<{ retried: number; stillFailed: number }> {
  const failedStatements = await storage.getPayStatementsByDeliveryStatus("FAILED");
  if (failedStatements.length === 0) return { retried: 0, stillFailed: 0 };

  const allUsers = await storage.getUsers();
  const userMap = new Map(allUsers.map(u => [u.id, u]));
  let retried = 0;
  let stillFailed = 0;

  for (const stmt of failedStatements) {
    const user = userMap.get(stmt.userId);
    const result = await deliverPayStubEmail(stmt, user?.email, user?.name);
    if (result.status === "SENT") retried++;
    else if (result.status === "FAILED") stillFailed++;
  }

  if (retried > 0 || stillFailed > 0) {
    console.log(`[PayStub Email] Auto-retry: ${retried} sent, ${stillFailed} still failed`);
  }
  return { retried, stillFailed };
}
