import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell, Plus, List, DollarSign, AlertTriangle, Info, CheckCircle,
  Calendar, Shield, FileText
} from "lucide-react";
import { useState } from "react";

interface SummaryData {
  greeting: string;
  userName: string;
  period: {
    label: string;
    soldCount: number;
    connectedCount: number;
    connectRate: number;
    earnedDollars: number;
    payrollReadyAmount: number;
  };
  nextPay?: {
    estimatedDate: string;
    estimatedAmount: number;
    breakdown?: Array<{ label: string; amount: number }>;
  };
  alerts: Array<{ type: string; severity: string; message: string; link?: string }>;
  recentOrders: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    service?: string;
    dateSold: string;
    approvalStatus: string;
    jobStatus: string;
    paymentStatus: string;
    commissionAmount: string | null;
  }>;
}

function formatCurrency(v: number) {
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function getStatusColor(order: SummaryData["recentOrders"][0]) {
  if (order.paymentStatus === "PAID") return "bg-emerald-500";
  if (order.paymentStatus === "CHARGEBACK") return "bg-red-500";
  if (order.approvalStatus === "APPROVED") return "bg-blue-500";
  if (order.jobStatus === "COMPLETED") return "bg-sky-500";
  return "bg-amber-500";
}

function getStatusLabel(order: SummaryData["recentOrders"][0]) {
  if (order.paymentStatus === "PAID") return "Paid";
  if (order.paymentStatus === "CHARGEBACK") return "Chargeback";
  if (order.approvalStatus === "APPROVED") return "Approved";
  if (order.jobStatus === "COMPLETED") return "Installed";
  return "Pending";
}

const alertStyles: Record<string, { bg: string; text: string; icon: typeof AlertTriangle }> = {
  red: { bg: "bg-red-500/10", text: "text-red-700 dark:text-red-400", icon: AlertTriangle },
  yellow: { bg: "bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", icon: Info },
  blue: { bg: "bg-blue-500/10", text: "text-blue-700 dark:text-blue-400", icon: FileText },
  orange: { bg: "bg-orange-500/10", text: "text-orange-700 dark:text-orange-400", icon: Shield },
};

export default function RepHome() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [nextPayExpanded, setNextPayExpanded] = useState(false);

  const { data, isLoading } = useQuery<SummaryData>({
    queryKey: ["/api/my/summary"],
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4" data-testid="rep-home-loading">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3 overflow-x-auto pb-2">
          <Skeleton className="h-28 w-40 flex-shrink-0 rounded-2xl" />
          <Skeleton className="h-28 w-40 flex-shrink-0 rounded-2xl" />
          <Skeleton className="h-28 w-40 flex-shrink-0 rounded-2xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const firstName = data.userName?.split(" ")[0] || "there";
  const connectRate = data.period.connectRate;

  return (
    <div className="p-4 space-y-5 max-w-lg mx-auto" data-testid="rep-home">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" data-testid="text-greeting">
          {data.greeting}, {firstName}
        </h1>
        <button
          onClick={() => setLocation("/notifications")}
          className="relative p-2 rounded-full hover:bg-muted transition-colors"
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
        <Card className={`flex-shrink-0 w-[140px] snap-start rounded-2xl border-2 ${
          connectRate >= 70 ? "border-emerald-500/30 bg-emerald-500/5" :
          connectRate >= 50 ? "border-amber-500/30 bg-amber-500/5" :
          "border-red-500/30 bg-red-500/5"
        }`} data-testid="card-period-stats">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">This Period</p>
            <p className="text-3xl font-bold mt-1">{data.period.connectedCount}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {data.period.soldCount} sold · {connectRate}% rate
            </p>
          </CardContent>
        </Card>

        <Card className="flex-shrink-0 w-[140px] snap-start rounded-2xl" data-testid="card-earned">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Earned</p>
            <p className="text-2xl font-bold mt-1 text-[#C9A84C]">
              {formatCurrency(data.period.earnedDollars)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {formatCurrency(data.period.payrollReadyAmount)} payroll ready
            </p>
          </CardContent>
        </Card>

        <button
          className="flex-shrink-0 w-[140px] snap-start text-left"
          onClick={() => setNextPayExpanded(!nextPayExpanded)}
          data-testid="card-next-pay"
        >
          <Card className="rounded-2xl h-full">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground font-medium">Next Pay</p>
              {data.nextPay ? (
                <>
                  <p className="text-lg font-bold mt-1">
                    {formatDate(data.nextPay.estimatedDate)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    ~{formatCurrency(data.nextPay.estimatedAmount)}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-bold mt-1">
                    <Calendar className="h-5 w-5 inline text-muted-foreground" />
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">Tap for details</p>
                </>
              )}
            </CardContent>
          </Card>
        </button>
      </div>

      {nextPayExpanded && data.nextPay?.breakdown && (
        <Card className="rounded-2xl border-[#C9A84C]/20 bg-[#C9A84C]/5" data-testid="next-pay-breakdown">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-semibold text-[#C9A84C] uppercase tracking-wide">Pay Breakdown</p>
            {data.nextPay.breakdown.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium">{formatCurrency(item.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.alerts.length > 0 && (
        <div className="space-y-2" data-testid="alerts-section">
          {data.alerts.map((alert, i) => {
            const style = alertStyles[alert.severity] || alertStyles.blue;
            const Icon = style.icon;
            return (
              <button
                key={i}
                onClick={() => alert.link && setLocation(alert.link)}
                className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${style.bg} ${style.text}`}
                data-testid={`alert-${alert.type}-${i}`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="text-sm font-medium">{alert.message}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Recent Orders
          </h2>
          <button
            onClick={() => setLocation("/my-orders")}
            className="text-xs text-[#C9A84C] font-medium"
            data-testid="link-view-all-orders"
          >
            View All
          </button>
        </div>
        {data.recentOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No orders yet</p>
        ) : (
          data.recentOrders.slice(0, 5).map(order => (
            <button
              key={order.id}
              onClick={() => setLocation(`/my-orders?detail=${order.id}`)}
              className="w-full text-left"
              data-testid={`order-card-${order.id}`}
            >
              <Card className="rounded-2xl hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{order.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.invoiceNumber}{order.service ? ` · ${order.service}` : ""}
                      </p>
                    </div>
                    <Badge variant="secondary" className={`text-white text-[10px] px-2 ml-2 ${getStatusColor(order)}`}>
                      {getStatusLabel(order)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-muted-foreground">{formatDate(order.dateSold)}</p>
                    {order.commissionAmount && (
                      <p className="text-sm font-semibold text-[#C9A84C]">
                        {formatCurrency(parseFloat(order.commissionAmount))}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </button>
          ))
        )}
      </div>

      <div className="pt-2 pb-20">
        <Button
          className="w-full h-14 text-base rounded-2xl bg-[#C9A84C] hover:bg-[#b8973e] text-white font-semibold"
          onClick={() => setLocation("/orders/new")}
          data-testid="button-new-order"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Order
        </Button>
      </div>
    </div>
  );
}
