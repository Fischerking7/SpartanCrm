import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "./auth";

export const PERMISSIONS = {
  'orders:view:own': ['REP', 'LEAD', 'MANAGER', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:view:team': ['LEAD', 'MANAGER', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:view:all': ['DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'orders:create': ['REP', 'LEAD', 'MANAGER', 'OPERATIONS', 'EXECUTIVE'],
  'orders:edit': ['OPERATIONS', 'EXECUTIVE'],
  'orders:approve': ['MANAGER', 'DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],
  'orders:reject': ['MANAGER', 'DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],
  'orders:delete': ['OPERATIONS', 'EXECUTIVE'],

  'financial:view:commission': ['REP', 'LEAD', 'MANAGER', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:profit': ['ACCOUNTING', 'EXECUTIVE'],
  'financial:view:ar': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:edit:ar': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:payruns': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:create:payruns': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:finalize:payruns': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:stubs:own': ['REP', 'LEAD', 'MANAGER', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:stubs:all': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:approve:advances': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:manage:deductions': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:manage:taxprofiles': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:export:ach': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:view:reserves': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:manage:reserves': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:override:reserve:cap': ['EXECUTIVE'],

  'overrides:approve:director': ['OPERATIONS', 'EXECUTIVE'],
  'overrides:approve:admin': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'overrides:approve:accounting': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'overrides:view': ['MANAGER', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'production:view:own': ['REP', 'LEAD', 'MANAGER', 'DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],
  'production:view:team': ['LEAD', 'MANAGER', 'DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],
  'production:view:all': ['DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],
  'production:view:dollars': ['REP', 'LEAD', 'MANAGER', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'users:view': ['ADMIN', 'MANAGER', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'users:create': ['OPERATIONS', 'EXECUTIVE'],
  'users:edit': ['OPERATIONS', 'EXECUTIVE'],
  'users:deactivate': ['OPERATIONS', 'EXECUTIVE'],
  'users:create:executive': ['EXECUTIVE'],
  'users:create:accounting': ['OPERATIONS', 'EXECUTIVE'],
  'users:create:director': ['OPERATIONS', 'EXECUTIVE'],
  'users:create:operations': ['EXECUTIVE'],

  'finance:import:upload': ['OPERATIONS', 'EXECUTIVE'],
  'finance:import:view': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'finance:import:post': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'installs:sync': ['OPERATIONS', 'EXECUTIVE'],
  'installs:view': ['DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],

  'system:settings:operational': ['OPERATIONS', 'EXECUTIVE'],
  'system:settings:financial': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'system:settings:all': ['OPERATIONS', 'EXECUTIVE'],
  'system:ratecards:view': ['ADMIN', 'DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'system:ratecards:edit': ['ADMIN', 'EXECUTIVE'],
  'system:automation': ['OPERATIONS', 'EXECUTIVE'],

  'exceptions:operational': ['DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],
  'exceptions:financial': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'exceptions:all': ['OPERATIONS', 'EXECUTIVE'],

  'mdu:submit': ['MDU'],
  'mdu:review': ['OPERATIONS', 'EXECUTIVE'],

  'disputes:view:own': ['REP', 'LEAD', 'MANAGER'],
  'disputes:view:all': ['DIRECTOR', 'OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'disputes:resolve': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'reports:production': ['DIRECTOR', 'OPERATIONS', 'EXECUTIVE'],
  'reports:financial': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'reports:all': ['OPERATIONS', 'EXECUTIVE'],

  'onboarding:review': ['OPERATIONS', 'EXECUTIVE'],
  'onboarding:approve': ['OPERATIONS', 'EXECUTIVE'],
  'onboarding:reject': ['OPERATIONS', 'EXECUTIVE'],
  'onboarding:send:otp': ['OPERATIONS', 'EXECUTIVE'],

  'paystubs:view:all': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'paystubs:generate': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'paystubs:export:pdf': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'reserves:view:all': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'reserves:manual:adjust': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'reserves:handle:separation': ['OPERATIONS', 'EXECUTIVE'],
  'reserves:override:cap': ['EXECUTIVE'],

  'audit:view': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'system:view:jobs': ['OPERATIONS', 'EXECUTIVE'],
  'system:view:auditlogs': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'financial:process:chargebacks': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'financial:resolve:disputes': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],

  'jobs:view': ['OPERATIONS', 'EXECUTIVE'],
  'jobs:trigger': ['OPERATIONS', 'EXECUTIVE'],

  'banking:view': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'banking:export': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'banking:manage:accounts': ['ACCOUNTING', 'EXECUTIVE'],

  'admin:providers': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:clients': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:services': ['ADMIN', 'OPERATIONS', 'EXECUTIVE'],
  'admin:incentives': ['OPERATIONS', 'EXECUTIVE'],
  'admin:overrides:manage': ['OPERATIONS', 'EXECUTIVE'],
  'admin:overridepool': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:payruns:manage': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:payruns:approve': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:export:approved': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:import:payments': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:import:chargebacks': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:recalculate': ['OPERATIONS', 'EXECUTIVE'],
  'admin:queues:resolve': ['OPERATIONS', 'EXECUTIVE'],
  'admin:leads:manage': ['OPERATIONS', 'EXECUTIVE'],
  'admin:quickbooks': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:taxdocs': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:bankaccounts': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:reconciliations': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:bonuses': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:notifications': ['OPERATIONS', 'EXECUTIVE'],
  'admin:disputes': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:finance:imports': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:finance:ar': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:finance:columnmaps': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
  'admin:integrations': ['OPERATIONS', 'EXECUTIVE'],
  'admin:seeddata': ['EXECUTIVE'],
  'admin:schedpay': ['OPERATIONS', 'ACCOUNTING', 'EXECUTIVE'],
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
  'EXECUTIVE': ['EXECUTIVE'],
  'OPERATIONS': ['EXECUTIVE'],
  'ADMIN': ['OPERATIONS', 'EXECUTIVE'],
  'DIRECTOR': ['OPERATIONS', 'EXECUTIVE'],
  'ACCOUNTING': ['OPERATIONS', 'EXECUTIVE'],
  'MANAGER': ['OPERATIONS', 'EXECUTIVE'],
  'LEAD': ['OPERATIONS', 'EXECUTIVE', 'MANAGER'],
  'REP': ['OPERATIONS', 'EXECUTIVE', 'MANAGER'],
  'MDU': ['OPERATIONS', 'EXECUTIVE'],
};
