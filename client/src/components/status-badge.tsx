import { Badge } from "@/components/ui/badge";
import { Check, Clock, DollarSign, AlertTriangle, X, FileText, Wrench, Ban, ThumbsDown } from "lucide-react";
import type { SimplifiedOrderStatus } from "@shared/order-status";

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

const simplifiedStatusConfig: Record<SimplifiedOrderStatus, { variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof Check; colorClass?: string }> = {
  "Paid": { variant: "default", icon: DollarSign, colorClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0" },
  "Pay Ready": { variant: "default", icon: Check, colorClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0" },
  "Approved": { variant: "default", icon: Check, colorClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border-0" },
  "Installed": { variant: "default", icon: Wrench, colorClass: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200 border-0" },
  "Pending Install": { variant: "secondary", icon: Clock },
  "Charged Back": { variant: "destructive", icon: AlertTriangle },
  "Disputed": { variant: "destructive", icon: AlertTriangle, colorClass: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-0" },
  "Cancelled": { variant: "destructive", icon: Ban },
  "Rejected": { variant: "destructive", icon: ThumbsDown },
};

export function SimplifiedStatusBadge({ status }: { status: SimplifiedOrderStatus }) {
  const config = simplifiedStatusConfig[status] || { variant: "outline" as const, icon: FileText };
  const Icon = config.icon;
  if (config.colorClass) {
    return (
      <Badge variant="outline" className={`${config.colorClass} text-xs font-medium`} data-testid={`badge-simplified-status-${status.toLowerCase().replace(/\s+/g, "-")}`}>
        <Icon className="h-3 w-3 mr-1" />
        {status}
      </Badge>
    );
  }
  return (
    <Badge variant={config.variant} className="text-xs font-medium" data-testid={`badge-simplified-status-${status.toLowerCase().replace(/\s+/g, "-")}`}>
      <Icon className="h-3 w-3 mr-1" />
      {status}
    </Badge>
  );
}

export function AgingBadge({ carrierConfirmedAt }: { carrierConfirmedAt: string | Date | null }) {
  if (!carrierConfirmedAt) return null;
  const now = new Date();
  const confirmed = new Date(carrierConfirmedAt);
  const daysSince = Math.floor((now.getTime() - confirmed.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince < 1) return null;

  let colorClass = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
  if (daysSince >= 21) {
    colorClass = "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  } else if (daysSince >= 14) {
    colorClass = "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
  } else if (daysSince >= 7) {
    colorClass = "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  }

  return (
    <Badge variant="outline" className={`${colorClass} border-0 text-xs font-medium`} data-testid="badge-aging">
      <AlertTriangle className="h-3 w-3 mr-1" />
      {daysSince}d aging
    </Badge>
  );
}
