import { storage } from "./storage";
import { emailService } from "./email";

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

interface QueueResult {
  statementId: string;
  status: "QUEUED" | "SKIPPED";
  error?: string;
}

export async function queuePayStubEmail(
  stmt: { id: string; userId: string; repName: string | null; repEmail: string | null; periodStart: string; periodEnd: string; netPay: string },
  userEmail?: string | null,
  userName?: string | null
): Promise<QueueResult> {
  const email = stmt.repEmail || userEmail;
  if (!email) {
    await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "SKIPPED", emailDeliveryError: "No email address on file" });
    return { statementId: stmt.id, status: "SKIPPED", error: "No email address on file" };
  }

  const periodLabel = `${stmt.periodStart} to ${stmt.periodEnd}`;
  const netPayFormatted = `$${parseFloat(stmt.netPay).toFixed(2)}`;
  const subject = `Your Pay Statement - ${periodLabel}`;
  const htmlBody = buildPayStubHtml(stmt.repName || userName || "Team Member", periodLabel, netPayFormatted);

  const queued = await emailService.queueNotification({
    userId: stmt.userId,
    notificationType: "PAY_STUB_DELIVERY",
    subject,
    body: htmlBody,
    recipientEmail: email,
    relatedEntityType: "PAY_STATEMENT",
    relatedEntityId: stmt.id,
  });

  if (!queued) {
    await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "SKIPPED", emailDeliveryError: "Opted out of pay stub emails" });
    return { statementId: stmt.id, status: "SKIPPED", error: "Opted out" };
  }

  await storage.updatePayStatement(stmt.id, { emailDeliveryStatus: "PENDING" });
  return { statementId: stmt.id, status: "QUEUED" };
}

export async function deliverPayStubsForPayRun(payRunId: string): Promise<QueueResult[]> {
  const statements = await storage.getPayStatements(payRunId);
  const allUsers = await storage.getUsers();
  const userMap = new Map(allUsers.map(u => [u.id, u]));
  const results: QueueResult[] = [];

  for (const stmt of statements) {
    const user = userMap.get(stmt.userId);
    const result = await queuePayStubEmail(stmt, user?.email, user?.name);
    results.push(result);
  }

  const queued = results.filter(r => r.status === "QUEUED").length;
  const skipped = results.filter(r => r.status === "SKIPPED").length;
  console.log(`[PayStub Email] Queued for pay run ${payRunId}: ${queued} queued, ${skipped} skipped`);
  return results;
}
