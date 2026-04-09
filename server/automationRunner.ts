import { storage } from "./storage";
import { db } from "./db";
import { salesOrders, financeImports } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { AutomationRule, SalesOrder, FinanceImport } from "@shared/schema";

type RuleCondition = {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "not_contains";
  value: string | number | boolean;
};

type RuleAction = {
  type: string;
  message?: string;
  [key: string]: unknown;
};

type EvalResult = {
  matched: boolean;
  actions: string[];
  error?: string;
};

function evaluateCondition(condition: RuleCondition, data: Record<string, unknown>): boolean {
  const actual = data[condition.field];
  const expected = condition.value;

  switch (condition.op) {
    case "eq":
      // eslint-disable-next-line eqeqeq
      return actual == expected;
    case "ne":
      // eslint-disable-next-line eqeqeq
      return actual != expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "contains":
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case "not_contains":
      return !String(actual).toLowerCase().includes(String(expected).toLowerCase());
    default:
      return false;
  }
}

function evaluateConditions(conditions: RuleCondition[], data: Record<string, unknown>): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, data));
}

async function executeOrderAction(action: RuleAction, orderId: string, dryRun: boolean): Promise<string> {
  switch (action.type) {
    case "AUTO_APPROVE": {
      if (!dryRun) {
        // Use null for approvedByUserId since FK only allows valid users (system has no user row)
        await storage.updateOrder(orderId, {
          approvalStatus: "APPROVED",
          approvedAt: new Date(),
          approvedByUserId: null,
        });
        await storage.createAuditLog({
          action: "automation_auto_approve",
          tableName: "sales_orders",
          recordId: orderId,
          userId: null,
          afterJson: JSON.stringify({ triggeredBy: "automation_rule" }),
        });
      }
      return `Would auto-approve order ${orderId}`;
    }
    case "SET_PAYROLL_READY": {
      if (!dryRun) {
        await storage.setPayrollReady(orderId, "AUTOMATION");
        await storage.createAuditLog({
          action: "automation_payroll_ready",
          tableName: "sales_orders",
          recordId: orderId,
          userId: null,
          afterJson: JSON.stringify({ triggeredBy: "automation_rule" }),
        });
      }
      return `Would set payroll ready for order ${orderId}`;
    }
    case "CREATE_EXCEPTION": {
      if (!dryRun) {
        // Find a valid OPERATIONS or ADMIN user to flag with (required FK)
        const users = await storage.getActiveUsers();
        const systemUser = users.find(u => u.role === "OPERATIONS" || u.role === "ADMIN");
        if (systemUser) {
          await storage.createOrderException({
            salesOrderId: orderId,
            reason: String(action.message || "Triggered by automation rule"),
            flaggedByUserId: systemUser.id,
          });
        } else {
          // Log to audit if no admin user found
          await storage.createAuditLog({
            action: "automation_exception_skipped",
            tableName: "sales_orders",
            recordId: orderId,
            userId: null,
            afterJson: JSON.stringify({ reason: "No admin user found for flaggedByUserId", message: action.message }),
          });
        }
      }
      return `Would create exception for order ${orderId}: ${action.message || "Automation alert"}`;
    }
    case "ESCALATE": {
      if (!dryRun) {
        const users = await storage.getActiveUsers();
        const systemUser = users.find(u => u.role === "OPERATIONS" || u.role === "ADMIN");
        if (systemUser) {
          await storage.createOrderException({
            salesOrderId: orderId,
            reason: String(action.message || "Order escalated by automation rule"),
            flaggedByUserId: systemUser.id,
          });
        } else {
          await storage.createAuditLog({
            action: "automation_escalate_skipped",
            tableName: "sales_orders",
            recordId: orderId,
            userId: null,
            afterJson: JSON.stringify({ reason: "No admin user found for flaggedByUserId", message: action.message }),
          });
        }
      }
      return `Would escalate order ${orderId}`;
    }
    default:
      return `Unknown action type: ${action.type}`;
  }
}

async function executeImportAction(action: RuleAction, importId: string, dryRun: boolean): Promise<string> {
  switch (action.type) {
    case "AUTO_POST": {
      if (!dryRun) {
        await db.update(financeImports).set({ status: "POSTED" }).where(eq(financeImports.id, importId));
        await storage.createAuditLog({
          action: "automation_auto_post",
          tableName: "finance_imports",
          recordId: importId,
          userId: null,
          afterJson: JSON.stringify({ triggeredBy: "automation_rule" }),
        });
      }
      return `Would auto-post import ${importId}`;
    }
    default:
      return `Unknown action type: ${action.type}`;
  }
}

function buildOrderData(order: SalesOrder): Record<string, unknown> {
  const data: Record<string, unknown> = { ...order };
  const created = order.createdAt ? new Date(order.createdAt) : new Date();
  data.daysOld = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
  return data;
}

function buildImportData(importRecord: FinanceImport): Record<string, unknown> {
  return { ...importRecord } as Record<string, unknown>;
}

// Evaluate a single rule against an order entity (dry-run, returns result without executing)
export async function evaluateSingleRuleForOrder(rule: AutomationRule, orderId: string): Promise<EvalResult> {
  try {
    const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
    if (!order) return { matched: false, actions: [], error: "Order not found" };

    const conditions = (rule.conditions as RuleCondition[]) || [];
    const actions = (rule.actions as RuleAction[]) || [];
    const data = buildOrderData(order);
    const matched = evaluateConditions(conditions, data);
    const actionResults: string[] = [];

    if (matched) {
      for (const action of actions) {
        const msg = await executeOrderAction(action, orderId, true);
        actionResults.push(msg);
      }
    }

    return { matched, actions: actionResults };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { matched: false, actions: [], error: msg };
  }
}

// Evaluate a single rule against an import entity (dry-run, returns result without executing)
export async function evaluateSingleRuleForImport(rule: AutomationRule, importId: string): Promise<EvalResult> {
  try {
    const [importRecord] = await db.select().from(financeImports).where(eq(financeImports.id, importId));
    if (!importRecord) return { matched: false, actions: [], error: "Import not found" };

    const conditions = (rule.conditions as RuleCondition[]) || [];
    const actions = (rule.actions as RuleAction[]) || [];
    const data = buildImportData(importRecord);
    const matched = evaluateConditions(conditions, data);
    const actionResults: string[] = [];

    if (matched) {
      for (const action of actions) {
        const msg = await executeImportAction(action, importId, true);
        actionResults.push(msg);
      }
    }

    return { matched, actions: actionResults };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { matched: false, actions: [], error: msg };
  }
}

// Evaluate all enabled rules for an order (called at trigger points)
export async function evaluateRulesForOrder(orderId: string): Promise<void> {
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  if (!order) return;

  const relevantTypes = ["AUTO_APPROVE_ORDER", "AUTO_PAYROLL_READY", "ALERT_ON_EXCEPTION", "ESCALATE_AFTER_DAYS"];
  const data = buildOrderData(order);

  for (const ruleType of relevantTypes) {
    const rules = await storage.getEnabledAutomationRulesByType(ruleType);
    for (const rule of rules) {
      try {
        const conditions = (rule.conditions as RuleCondition[]) || [];
        const actions = (rule.actions as RuleAction[]) || [];
        const matched = evaluateConditions(conditions, data);

        if (matched) {
          const actionErrors: string[] = [];
          for (const action of actions) {
            try {
              await executeOrderAction(action, orderId, false);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[AutomationRunner] Action "${action.type}" failed for order ${orderId}:`, msg);
              actionErrors.push(`${action.type}: ${msg}`);
            }
          }
          // Record trigger; propagate any action-level errors to lastError for observability
          const triggerError = actionErrors.length > 0 ? actionErrors.join("; ") : undefined;
          await storage.recordAutomationRuleTrigger(rule.id, triggerError);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AutomationRunner] Rule "${rule.name}" failed for order ${orderId}:`, msg);
        await storage.recordAutomationRuleTrigger(rule.id, msg);
      }
    }
  }
}

// Evaluate all enabled rules for an import (called at trigger points)
export async function evaluateRulesForImport(importId: string): Promise<void> {
  const [importRecord] = await db.select().from(financeImports).where(eq(financeImports.id, importId));
  if (!importRecord) return;

  const rules = await storage.getEnabledAutomationRulesByType("AUTO_POST_IMPORT");
  const data = buildImportData(importRecord);

  for (const rule of rules) {
    try {
      const conditions = (rule.conditions as RuleCondition[]) || [];
      const actions = (rule.actions as RuleAction[]) || [];
      const matched = evaluateConditions(conditions, data);

      if (matched) {
        const actionErrors: string[] = [];
        for (const action of actions) {
          try {
            await executeImportAction(action, importId, false);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[AutomationRunner] Action "${action.type}" failed for import ${importId}:`, msg);
            actionErrors.push(`${action.type}: ${msg}`);
          }
        }
        const triggerError = actionErrors.length > 0 ? actionErrors.join("; ") : undefined;
        await storage.recordAutomationRuleTrigger(rule.id, triggerError);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AutomationRunner] Rule "${rule.name}" failed for import ${importId}:`, msg);
      await storage.recordAutomationRuleTrigger(rule.id, msg);
    }
  }
}
