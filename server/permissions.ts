import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "./auth";

export const PERMISSIONS = {
  'orders:view:own': ['REP', 'LEAD', 'MANAGER', 'DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:view:team': ['LEAD', 'MANAGER', 'DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:view:all': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:create': ['REP', 'LEAD', 'MANAGER', 'OPERATIONS', 'EXECUTIVE'],
  'orders:edit': ['OPERATIONS', 'EXECUTIVE'],
  'orders:approve': ['MANAGER', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:reject': ['MANAGER', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:delete': ['OPERATIONS', 'EXECUTIVE'],

  'financial:view:commission': ['REP', 'LEAD', 'MANAGER', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:profit': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:ar': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:edit:ar': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:payruns': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:create:payruns': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:finalize:payruns': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:stubs:own': ['REP', 'LEAD', 'MANAGER', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:stubs:all': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:approve:advances': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:manage:deductions': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:manage:taxprofiles': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:export:ach': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:reserves': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:manage:reserves': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:override:reserve:cap': ['OPERATIONS', 'EXECUTIVE'],

  'overrides:approve:director': ['DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'overrides:approve:admin': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'overrides:approve:accounting': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'overrides:view': ['MANAGER', 'DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'production:view:own': ['REP', 'LEAD', 'MANAGER', 'DIRECTOR', 'ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'production:view:team': ['LEAD', 'MANAGER', 'DIRECTOR', 'ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'production:view:all': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'production:view:dollars': ['REP', 'LEAD', 'MANAGER', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'users:view': ['ADMIN', 'MANAGER', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'users:create': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'users:edit': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'users:deactivate': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'users:create:executive': ['OPERATIONS', 'EXECUTIVE'],
  'users:create:accounting': ['OPERATIONS', 'EXECUTIVE'],
  'users:create:director': ['OPERATIONS', 'EXECUTIVE'],
  'users:create:operations': ['OPERATIONS', 'EXECUTIVE'],

  'finance:import:upload': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'finance:import:view': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'finance:import:post': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'installs:sync': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'installs:view': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'EXECUTIVE'],

  'system:settings:operational': ['OPERATIONS', 'EXECUTIVE'],
  'system:settings:financial': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'system:settings:all': ['OPERATIONS', 'EXECUTIVE'],
  'system:ratecards:view': ['ADMIN', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'system:ratecards:edit': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'system:automation': ['OPERATIONS', 'EXECUTIVE'],

  'exceptions:operational': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'exceptions:financial': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'exceptions:all': ['OPERATIONS', 'EXECUTIVE'],

  'mdu:submit': ['MDU'],
  'mdu:review': ['OPERATIONS', 'EXECUTIVE'],

  'disputes:view:own': ['REP', 'LEAD', 'MANAGER'],
  'disputes:view:all': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'disputes:resolve': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'reports:production': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'reports:financial': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'reports:all': ['DIRECTOR', 'ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'onboarding:review': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'onboarding:approve': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'onboarding:reject': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'onboarding:send:otp': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],

  'paystubs:view:all': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'paystubs:generate': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'paystubs:export:pdf': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'reserves:view:all': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'reserves:manual:adjust': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'reserves:handle:separation': ['OPERATIONS', 'EXECUTIVE'],
  'reserves:override:cap': ['OPERATIONS', 'EXECUTIVE'],

  'audit:view': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'system:view:jobs': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'system:view:auditlogs': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'financial:process:chargebacks': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:resolve:disputes': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'jobs:view': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'jobs:trigger': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],

  'banking:view': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'banking:export': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'banking:manage:accounts': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'admin:providers': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:clients': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:services': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:incentives': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:overrides:manage': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:overridepool': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:payruns:manage': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:payruns:delete': ['OPERATIONS', 'ADMIN', 'EXECUTIVE'],
  'admin:payruns:approve': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:export:approved': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:import:payments': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:import:chargebacks': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:recalculate': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:queues:resolve': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:leads:manage': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:quickbooks': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:taxdocs': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:bankaccounts': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:reconciliations': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:bonuses': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:notifications': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:disputes': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:finance:imports': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:finance:ar': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:finance:columnmaps': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:integrations': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:seeddata': ['OPERATIONS', 'EXECUTIVE'],
  'admin:schedpay': ['ADMIN', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export function requirePermission(permission: PermissionKey) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;
    if (!userRole) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const allowedRoles = PERMISSIONS[permission] as readonly string[];
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: `Insufficient permissions: ${permission} required` });
    }
    next();
  };
}

export function hasPermission(role: string, permission: PermissionKey): boolean {
  const allowedRoles = PERMISSIONS[permission] as readonly string[];
  return allowedRoles.includes(role);
}

export const canCreateRole: Record<string, string[]> = {
  'EXECUTIVE': ['OPERATIONS', 'EXECUTIVE'],
  'OPERATIONS': ['OPERATIONS', 'EXECUTIVE'],
  'ADMIN': ['OPERATIONS', 'EXECUTIVE'],
  'DIRECTOR': ['OPERATIONS', 'EXECUTIVE'],
  'ACCOUNTING': ['OPERATIONS', 'EXECUTIVE'],
  'MANAGER': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'LEAD': ['ADMIN', 'OPERATIONS', 'EXECUTIVE', 'MANAGER'],
  'REP': ['ADMIN', 'OPERATIONS', 'EXECUTIVE', 'MANAGER'],
  'MDU': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
};
