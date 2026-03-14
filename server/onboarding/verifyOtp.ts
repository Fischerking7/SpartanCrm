import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { users, onboardingAuditLog, emailNotifications } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function verifyOtp(
  userId: string,
  submittedOtp: string,
  ipAddress: string,
  userAgent: string
): Promise<{
  success: boolean;
  token?: string;
  error?: string;
  locked?: boolean;
}> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { success: false, error: "User not found" };

  if (user.onboardingOtpLockedAt) {
    await db.insert(onboardingAuditLog).values({
      userId, action: "OTP_FAILED_ATTEMPT", ipAddress, userAgent,
      detail: JSON.stringify({ locked: true }),
    });
    return { success: false, locked: true, error: "Account locked. Contact your manager." };
  }

  if (!user.onboardingOtpExpiresAt || new Date() > user.onboardingOtpExpiresAt) {
    return { success: false, error: "Code expired. Ask your manager to resend." };
  }

  if (!user.onboardingOtpHash) {
    return { success: false, error: "No OTP set. Ask your manager to send a new code." };
  }

  const valid = await bcrypt.compare(submittedOtp, user.onboardingOtpHash);

  if (valid) {
    await db.update(users).set({
      onboardingOtpHash: null,
      onboardingOtpExpiresAt: null,
      onboardingOtpAttempts: 0,
      onboardingStatus: "OTP_VERIFIED",
      onboardingStartedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, userId));

    const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "fallback-secret";
    const token = jwt.sign(
      { userId, purpose: "onboarding" },
      secret,
      { expiresIn: "4h" }
    );

    await db.insert(onboardingAuditLog).values({
      userId, action: "OTP_VERIFIED", ipAddress, userAgent,
      detail: JSON.stringify({ success: true }),
    });

    return { success: true, token };
  }

  const attempts = user.onboardingOtpAttempts + 1;

  if (attempts >= 5) {
    await db.update(users).set({
      onboardingOtpAttempts: attempts,
      onboardingOtpLockedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, userId));

    if (user.assignedManagerId) {
      await db.insert(emailNotifications).values({
        userId: user.assignedManagerId,
        notificationType: "ONBOARDING_OTP_LOCKED",
        subject: "Onboarding Access Locked",
        body: `${user.name}'s onboarding access has been locked after 5 failed attempts. Please generate a new OTP from the rep management screen.`,
        recipientEmail: "",
        status: "PENDING",
        isRead: false,
      });
    }

    await db.insert(onboardingAuditLog).values({
      userId, action: "OTP_LOCKED", ipAddress, userAgent,
      detail: JSON.stringify({ attempts }),
    });

    return { success: false, locked: true, error: "Too many attempts. Contact your manager." };
  }

  await db.update(users).set({
    onboardingOtpAttempts: attempts,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  await db.insert(onboardingAuditLog).values({
    userId, action: "OTP_FAILED_ATTEMPT", ipAddress, userAgent,
    detail: JSON.stringify({ attempts }),
  });

  return { success: false, error: `Invalid code. ${5 - attempts} attempts remaining.` };
}
