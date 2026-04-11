export type CategoryKey = "orders" | "pay" | "compliance" | "system";
export type CategoryKeyWithAll = "all" | CategoryKey;

export const NOTIFICATION_NAV_MAP: Record<string, string> = {
  ORDER_APPROVED: "/order-tracker",
  ORDER_REJECTED: "/order-tracker",
  ORDER_SUBMITTED: "/orders",
  PAY_RUN_FINALIZED: "/my-pay",
  ADVANCE_APPROVED: "/my-pay",
  ADVANCE_REJECTED: "/my-pay",
  PAY_STUB_DELIVERY: "/my-pay",
  CHARGEBACK_ALERT: "/commissions",
  CHARGEBACK_APPLIED: "/commissions",
  DISPUTE_RESOLVED: "/my-disputes",
  PENDING_APPROVAL_ALERT: "/orders",
  LOW_PERFORMANCE_WARNING: "/dashboard",
  COMPLIANCE_EXPIRING: "/my-credentials",
};

export const CATEGORY_TYPES: Record<CategoryKey, string[]> = {
  orders: ["ORDER_APPROVED", "ORDER_REJECTED", "ORDER_SUBMITTED", "PENDING_APPROVAL_ALERT"],
  pay: ["PAY_RUN_FINALIZED", "ADVANCE_APPROVED", "ADVANCE_REJECTED", "PAY_STUB_DELIVERY", "CHARGEBACK_ALERT", "CHARGEBACK_APPLIED", "DISPUTE_RESOLVED"],
  compliance: ["COMPLIANCE_EXPIRING", "LOW_PERFORMANCE_WARNING"],
  system: [],
};

export const ALL_KNOWN_TYPES = Object.values(CATEGORY_TYPES).flat();

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  orders: "Orders",
  pay: "Pay",
  compliance: "Compliance",
  system: "System",
};

export function getCategoryForType(type: string): CategoryKey {
  for (const [key, types] of Object.entries(CATEGORY_TYPES)) {
    if (types.includes(type)) return key as CategoryKey;
  }
  return "system";
}

export function filterByCategory<T extends { type: string }>(items: T[], category: CategoryKeyWithAll): T[] {
  if (category === "all") return items;
  if (category === "system") return items.filter(n => !ALL_KNOWN_TYPES.includes(n.type));
  return items.filter(n => CATEGORY_TYPES[category].includes(n.type));
}

export const HIGH_PRIORITY_TYPES = ["PAY_RUN_FINALIZED", "COMPLIANCE_EXPIRING", "DISPUTE_RESOLVED"];
