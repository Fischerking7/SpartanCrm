export type SimplifiedOrderStatus =
  | "Charged Back"
  | "Disputed"
  | "Paid"
  | "Pay Ready"
  | "Approved"
  | "Connected"
  | "Pending Connect"
  | "Cancelled"
  | "Rejected";

interface OrderStatusInput {
  jobStatus: string;
  approvalStatus: string;
  paymentStatus: string;
  payrollReadyAt?: string | Date | null;
  hasActiveChargeback?: boolean | null;
  hasDisputedChargeback?: boolean | null;
}

export function getSimplifiedOrderStatus(order: OrderStatusInput): SimplifiedOrderStatus {
  if (order.hasDisputedChargeback) return "Disputed";
  if (order.hasActiveChargeback) return "Charged Back";
  if (order.approvalStatus === "REJECTED") return "Rejected";
  if (order.jobStatus === "CANCELED") return "Cancelled";
  if (order.paymentStatus === "PAID") return "Paid";
  if (order.payrollReadyAt) return "Pay Ready";
  if (order.approvalStatus === "APPROVED") {
    if (order.jobStatus === "COMPLETED") return "Connected";
    return "Approved";
  }
  if (order.jobStatus === "COMPLETED") return "Connected";
  return "Pending Connect";
}
