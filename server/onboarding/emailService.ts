import { db } from "../db";
import { onboardingSubmissions, onboardingAuditLog, users, emailNotifications } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { emailService } from "../email";

export async function sendOnboardingEmails(submissionId: string): Promise<void> {
  try {
    const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, submissionId));
    if (!sub) return;

    const opsEmail = process.env.OPS_EMAIL || "ironcrestoperations@ironcrestai.com";

    emailService.queueEmail({
      to: opsEmail,
      subject: `New Contractor Onboarding Submitted — ${sub.repName}`,
      text: `${sub.repName} has completed all 7 onboarding documents (including IRS Form W-9) and is ready for review.\n\nDocuments: Background Check, Chargeback Policy, Contractor Application, Direct Deposit, Drug Test Consent, NDA, IRS Form W-9\nW-9 Status: ${sub.w9Completed ? "Signed" : "Pending"}\nSubmitted: ${new Date(sub.submittedAt).toLocaleString("en-US")}\nIP: ${sub.ipAddress}\n\nPlease review the submission in the admin portal.`,
      html: `<h2>New Contractor Onboarding Submitted</h2><p><strong>${sub.repName}</strong> has completed all 7 onboarding documents (including IRS Form W-9) and is ready for review.</p><p><strong>W-9 Status:</strong> ${sub.w9Completed ? "Signed" : "Pending"}</p><p>Submitted: ${new Date(sub.submittedAt).toLocaleString("en-US")}<br/>IP: ${sub.ipAddress}</p><p>Please review the submission in the admin portal.</p>`,
    });

    await db.insert(onboardingAuditLog).values({
      userId: sub.userId,
      action: "EMAIL_SENT_OPS",
      detail: JSON.stringify({ to: opsEmail, submissionId }),
    });

    if (sub.repEmail) {
      emailService.queueEmail({
        to: sub.repEmail,
        subject: "Iron Crest Onboarding — Submission Received",
        text: `Hi ${sub.repName},\n\nThank you for completing your onboarding documents. Your submission is under review.\n\nYou will receive a notification once your onboarding is approved.\n\nIron Crest Solutions LLC`,
        html: `<h2>Onboarding Submission Received</h2><p>Hi ${sub.repName},</p><p>Thank you for completing your onboarding documents. Your submission is under review.</p><p>You will receive a notification once your onboarding is approved.</p><p>Iron Crest Solutions LLC</p>`,
      });

      await db.insert(onboardingAuditLog).values({
        userId: sub.userId,
        action: "EMAIL_SENT_REP",
        detail: JSON.stringify({ to: sub.repEmail, submissionId }),
      });
    }
  } catch (err: any) {
    console.error("[Onboarding] Email send failed (non-fatal):", err.message);
  }
}

export async function notifyOpsAndExec(
  userId: string,
  notificationType: string,
  subject: string,
  body: string
): Promise<void> {
  try {
    const opsAndExec = await db.select().from(users)
      .where(inArray(users.role, ["OPERATIONS", "EXECUTIVE"]));

    for (const u of opsAndExec) {
      if (u.deletedAt) continue;
      await db.insert(emailNotifications).values({
        userId: u.id,
        notificationType,
        subject,
        body,
        recipientEmail: u.email || "",
        status: "PENDING",
        isRead: false,
      });
    }
  } catch (err: any) {
    console.error("[Onboarding] Notification failed (non-fatal):", err.message);
  }
}
