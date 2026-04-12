import { Badge } from "@/components/ui/badge";
import { Check, Clock, DollarSign, AlertTriangle, X, FileText, Wrench, Ban, ThumbsDown } from "lucide-react";
import type { SimplifiedOrderStatus } from "@shared/order-status";
import { useTranslation } from "react-i18next";

type StatusType = "earned" | "paid" | "pending" | "chargeback" | "approved" | "rejected" | "unapproved" | "completed" | "canceled";

interface StatusBadgeProps {
  status: StatusType;
  showIcon?: boolean;
  className?: string;
}

const statusConfig: Record<StatusType, { labelKey: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof Check }> = {
  earned: { labelKey: "statusBadge.earned", variant: "default", icon: Check },
  paid: { labelKey: "statusBadge.paid", variant: "default", icon: DollarSign },
  pending: { labelKey: "statusBadge.pending", variant: "secondary", icon: Clock },
  chargeback: { labelKey: "statusBadge.chargeback", variant: "destructive", icon: AlertTriangle },
  approved: { labelKey: "statusBadge.approved", variant: "default", icon: Check },
  rejected: { labelKey: "statusBadge.rejected", variant: "destructive", icon: X },
  unapproved: { labelKey: "statusBadge.pendingApproval", variant: "secondary", icon: Clock },
  completed: { labelKey: "statusBadge.connected", variant: "default", icon: FileText },
  canceled: { labelKey: "statusBadge.cancelled", variant: "destructive", icon: X },
};

export function StatusBadge({ status, showIcon = true, className }: StatusBadgeProps) {
  const { t } = useTranslation();
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={className}>
      {showIcon && <Icon className="h-3 w-3 mr-1" />}
      {t(config.labelKey)}
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
  const { t } = useTranslation();
  switch (status) {
    case "PAID":
      return <StatusBadge status="paid" />;
    case "PARTIALLY_PAID":
      return <Badge variant="secondary"><DollarSign className="h-3 w-3 mr-1" />{t("statusBadge.partial")}</Badge>;
    case "UNPAID":
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />{t("statusBadge.unpaid")}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

const simplifiedStatusConfig: Record<SimplifiedOrderStatus, { labelKey: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof Check; colorClass?: string }> = {
  "Paid": { labelKey: "statusBadge.paid", variant: "default", icon: DollarSign, colorClass: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0" },
  "Pay Ready": { labelKey: "statusBadge.payReady", variant: "default", icon: Check, colorClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0" },
  "Approved": { labelKey: "statusBadge.approved", variant: "default", icon: Check, colorClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border-0" },
  "Connected": { labelKey: "statusBadge.connected", variant: "default", icon: Wrench, colorClass: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200 border-0" },
  "Pending Connect": { labelKey: "statusBadge.pendingConnect", variant: "secondary", icon: Clock },
  "Charged Back": { labelKey: "statusBadge.chargedBack", variant: "destructive", icon: AlertTriangle },
  "Disputed": { labelKey: "statusBadge.disputed", variant: "destructive", icon: AlertTriangle, colorClass: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-0" },
  "Cancelled": { labelKey: "statusBadge.cancelled", variant: "destructive", icon: Ban },
  "Rejected": { labelKey: "statusBadge.rejected", variant: "destructive", icon: ThumbsDown },
};

export function SimplifiedStatusBadge({ status }: { status: SimplifiedOrderStatus }) {
  const { t } = useTranslation();
  const config = simplifiedStatusConfig[status] || { labelKey: status, variant: "outline" as const, icon: FileText };
  const Icon = config.icon;
  const label = t(config.labelKey);
  if (config.colorClass) {
    return (
      <Badge variant="outline" className={`${config.colorClass} text-xs font-medium`} data-testid={`badge-simplified-status-${status.toLowerCase().replace(/\s+/g, "-")}`}>
        <Icon className="h-3 w-3 mr-1" />
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant={config.variant} className="text-xs font-medium" data-testid={`badge-simplified-status-${status.toLowerCase().replace(/\s+/g, "-")}`}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}

export function AgingBadge({ carrierConfirmedAt }: { carrierConfirmedAt: string | Date | null }) {
  const { t } = useTranslation();
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
      {t("statusBadge.aging", { days: daysSince })}
    </Badge>
  );
}
