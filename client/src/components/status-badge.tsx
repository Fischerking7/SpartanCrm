import { Badge } from "@/components/ui/badge";
import { Check, Clock, DollarSign, AlertTriangle, X, FileText } from "lucide-react";

type StatusType = "earned" | "paid" | "pending" | "chargeback" | "approved" | "rejected" | "unapproved" | "completed" | "canceled";

interface StatusBadgeProps {
  status: StatusType;
  showIcon?: boolean;
  className?: string;
}

const statusConfig: Record<StatusType, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof Check }> = {
  earned: { label: "Earned", variant: "default", icon: Check },
  paid: { label: "Paid", variant: "default", icon: DollarSign },
  pending: { label: "Pending", variant: "secondary", icon: Clock },
  chargeback: { label: "Chargeback", variant: "destructive", icon: AlertTriangle },
  approved: { label: "Approved", variant: "default", icon: Check },
  rejected: { label: "Rejected", variant: "destructive", icon: X },
  unapproved: { label: "Pending Approval", variant: "secondary", icon: Clock },
  completed: { label: "Completed", variant: "default", icon: FileText },
  canceled: { label: "Canceled", variant: "destructive", icon: X },
};

export function StatusBadge({ status, showIcon = true, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={className}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {config.label}
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase() as StatusType;
  if (normalizedStatus === "pending" || normalizedStatus === "completed" || normalizedStatus === "canceled") {
    return <StatusBadge status={normalizedStatus} />;
  }
  return <Badge variant="outline">{status}</Badge>;
}

export function ApprovalStatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase() as StatusType;
  if (normalizedStatus === "approved" || normalizedStatus === "rejected" || normalizedStatus === "unapproved") {
    return <StatusBadge status={normalizedStatus} />;
  }
  return <Badge variant="outline">{status}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "PAID":
      return <StatusBadge status="paid" />;
    case "PARTIALLY_PAID":
      return <Badge variant="secondary"><DollarSign className="h-3 w-3 mr-1" />Partial</Badge>;
    case "UNPAID":
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Unpaid</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
