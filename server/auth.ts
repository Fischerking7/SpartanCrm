import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import type { User } from "@shared/schema";

function getJwtSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required for production security");
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

let forceLogoutTimestamp: number = 0;

export function setForceLogoutTimestamp(timestamp: number) {
  forceLogoutTimestamp = timestamp;
}

export function getForceLogoutTimestamp(): number {
  return forceLogoutTimestamp;
}

export async function initForceLogoutFromDb(storage: any) {
  try {
    const logs = await storage.getAuditLogsByAction("midnight_force_logout");
    if (logs && logs.length > 0) {
      const latest = logs[0];
      const data = JSON.parse(latest.afterJson || "{}");
      if (data.timestamp) {
        forceLogoutTimestamp = data.timestamp;
        console.log(`[Auth] Recovered force logout timestamp from DB: ${new Date(forceLogoutTimestamp * 1000).toISOString()}`);
      }
    }
  } catch (err) {
    console.error("[Auth] Failed to recover force logout timestamp:", err);
  }
}

export interface AuthRequest extends Request {
  user?: User;
}

export function generateToken(user: User): string {
  return jwt.sign({ userId: user.id, role: user.role, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: string; role: string; iat?: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string; role: string; iat?: number };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function authMiddleware(db: any) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ message: "Invalid token" });
    }

    if ((payload as any).purpose === "onboarding") {
      return res.status(401).json({ message: "Invalid token" });
    }

    if (forceLogoutTimestamp > 0 && payload.iat && payload.iat < forceLogoutTimestamp) {
      return res.status(401).json({ message: "Session expired. Please log in again.", forceLogout: true });
    }
    
    const user = await db.query.users.findFirst({
      where: (users: any, { eq }: any) => eq(users.id, payload.userId),
    });
    
    if (!user || user.status !== "ACTIVE") {
      return res.status(401).json({ message: "User not found or inactive" });
    }
    
    req.user = user;
    next();
  };
}

export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "OPERATIONS" && req.user?.role !== "ACCOUNTING") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export function executiveOrAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const allowedRoles = ["ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING"];
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "Executive or admin access required" });
  }
  next();
}

export function managerOrAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const allowedRoles = ["ADMIN", "OPERATIONS", "MANAGER", "EXECUTIVE"];
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "Manager or admin access required" });
  }
  next();
}

export function leadOrAbove(req: AuthRequest, res: Response, next: NextFunction) {
  const allowedRoles = ["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "LEAD"];
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "Lead or above access required" });
  }
  next();
}
