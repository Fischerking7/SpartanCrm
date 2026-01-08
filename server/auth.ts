import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import type { User } from "@shared/schema";

const JWT_SECRET = process.env.SESSION_SECRET || "fallback-secret-key";

export interface AuthRequest extends Request {
  user?: User;
}

export function generateToken(user: User): string {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: string; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
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
  if (req.user?.role !== "ADMIN" && req.user?.role !== "FOUNDER") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export function executiveOrAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const allowedRoles = ["ADMIN", "FOUNDER", "EXECUTIVE"];
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "Executive or admin access required" });
  }
  next();
}

export function managerOrAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const allowedRoles = ["ADMIN", "FOUNDER", "MANAGER", "EXECUTIVE"];
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "Manager or admin access required" });
  }
  next();
}

export function supervisorOrAbove(req: AuthRequest, res: Response, next: NextFunction) {
  const allowedRoles = ["ADMIN", "FOUNDER", "EXECUTIVE", "MANAGER", "SUPERVISOR"];
  if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: "Supervisor or above access required" });
  }
  next();
}
