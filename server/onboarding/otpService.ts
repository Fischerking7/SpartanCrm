import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { users, onboardingAuditLog } from "@shared/schema";
import { eq } from "drizzle-orm";

function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export async function generateAndSendOtp(
  userId: string,
  phoneNumber: string,
  repName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    await db.update(users).set({
      onboardingOtpHash: otpHash,
      onboardingOtpExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      onboardingOtpAttempts: 0,
      onboardingOtpLockedAt: null,
      onboardingStatus: "OTP_SENT",
      updatedAt: new Date(),
    }).where(eq(users.id, userId));

    await db.insert(onboardingAuditLog).values({
      userId,
      action: "OTP_GENERATED",
      detail: JSON.stringify({ repName, phoneLastFour: phoneNumber.slice(-4) }),
    });

    const normalizedPhone = normalizePhoneE164(phoneNumber);
    let smsSent = false;

    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
      try {
        const twilio = (await import("twilio")).default;
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const frontendUrl = process.env.ONBOARDING_URL || process.env.FRONTEND_URL || "";
        await client.messages.create({
          body: `Your Iron Crest onboarding code is: ${otp}. Valid for 48 hours. Visit: ${frontendUrl}/onboarding`,
          from: process.env.TWILIO_FROM_NUMBER,
          to: normalizedPhone,
        });
        smsSent = true;

        await db.insert(onboardingAuditLog).values({
          userId,
          action: "OTP_SENT_SMS",
          detail: JSON.stringify({ phoneLastFour: phoneNumber.slice(-4) }),
        });
      } catch (twilioErr: any) {
        console.error("[Onboarding] Twilio SMS failed (non-fatal):", twilioErr.message);
        await db.insert(onboardingAuditLog).values({
          userId,
          action: "OTP_SENT_SMS",
          detail: JSON.stringify({ error: "SMS delivery failed", reason: twilioErr.message }),
        });
      }
    } else {
      console.log(`[Onboarding] Twilio not configured. OTP for ${repName}: ${otp} (DEV ONLY)`);
      await db.insert(onboardingAuditLog).values({
        userId,
        action: "OTP_SENT_SMS",
        detail: JSON.stringify({ fallback: "Twilio not configured, OTP logged to console (dev mode)" }),
      });
    }

    return { success: true };
  } catch (err: any) {
    console.error("[Onboarding] OTP generation failed:", err.message);
    return { success: false, error: err.message };
  }
}
