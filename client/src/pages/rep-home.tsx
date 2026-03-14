import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Plus, List, DollarSign, AlertTriangle, Info, CheckCircle } from "lucide-react";

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
  alerts: Array<{ type: string; severity: string; message: string; link?: string }>;
  recentOrders: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    dateSold: string;
    approvalStatus: string;
    jobStatus: string;
    paymentStatus: string;
    commissionAmount: string | null;
  }>;
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

export default function RepHome() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<SummaryData>({
    queryKey: ["/api/my/summary"],
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4" data-testid="rep-home-loading">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-3 overflow-x-auto pb-2">
          <Skeleton className="h-28 w-40 flex-shrink-0 rounded-xl" />
          <Skeleton className="h-28 w-40 flex-shrink-0 rounded-xl" />
          <Skeleton className="h-28 w-40 flex-shrink-0 rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-lg" />
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const firstName = data.userName?.split(" ")[0] || "there";

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
        <Card className={`flex-shrink-0 w-40 snap-start rounded-xl border-2 ${
          data.period.connectRate >= 70 ? "border-emerald-500/30 bg-emerald-500/5" :
          data.period.connectRate >= 50 ? "border-amber-500/30 bg-amber-500/5" :
          "border-red-500/30 bg-red-500/5"
        }`} data-testid="card-period-stats">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">This Period</p>
            <p className="text-3xl font-bold mt-1">{data.period.connectedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.period.soldCount} sold, {data.period.connectRate}% rate
            </p>
          </CardContent>
        </Card>

        <Card className="flex-shrink-0 w-40 snap-start rounded-xl" data-testid="card-earned">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Earned</p>
            <p className="text-3xl font-bold mt-1">
              ${data.period.earnedDollars.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              ready: ${data.period.payrollReadyAmount.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card className="flex-shrink-0 w-40 snap-start rounded-xl" data-testid="card-period-label">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">{data.period.label}</p>
            <p className="text-3xl font-bold mt-1">{data.period.soldCount}</p>
            <p className="text-xs text-muted-foreground mt-1">orders sold</p>
          </CardContent>
        </Card>
      </div>

      {data.alerts.length > 0 && (
        <div className="space-y-2" data-testid="alerts-section">
          {data.alerts.map((alert, i) => (
            <button
              key={i}
              onClick={() => alert.link && setLocation(alert.link)}
              className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${
                alert.severity === "red" ? "bg-red-500/10 text-red-700 dark:text-red-400" :
                alert.severity === "yellow" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" :
                "bg-blue-500/10 text-blue-700 dark:text-blue-400"
              }`}
              data-testid={`alert-${alert.type}-${i}`}
            >
              {alert.severity === "red" ? <AlertTriangle className="h-4 w-4 flex-shrink-0" /> :
               alert.severity === "yellow" ? <Info className="h-4 w-4 flex-shrink-0" /> :
               <CheckCircle className="h-4 w-4 flex-shrink-0" />}
              <span className="text-sm font-medium">{alert.message}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent Orders
        </h2>
        {data.recentOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No orders yet</p>
        ) : (
          data.recentOrders.map(order => (
            <button
              key={order.id}
              onClick={() => setLocation(`/my-orders?detail=${order.id}`)}
              className="w-full text-left"
              data-testid={`order-card-${order.id}`}
            >
              <Card className="rounded-xl hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{order.customerName}</p>
                      <p className="text-xs text-muted-foreground">{order.invoiceNumber}</p>
                    </div>
                    <Badge variant="secondary" className={`text-white text-[10px] px-2 ${getStatusColor(order)}`}>
                      {getStatusLabel(order)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-muted-foreground">{order.dateSold}</p>
                    {(order.approvalStatus === "APPROVED" || order.paymentStatus === "PAID") && order.commissionAmount && (
                      <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        ${parseFloat(order.commissionAmount).toFixed(2)}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </button>
          ))
        )}
      </div>

      <div className="flex gap-3 pt-2 pb-20">
        <Button
          className="flex-1 h-14 text-base rounded-xl"
          onClick={() => setLocation("/orders/new")}
          data-testid="button-new-order"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Order
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-14 text-base rounded-xl"
          onClick={() => setLocation("/my-orders")}
          data-testid="button-view-orders"
        >
          <List className="h-5 w-5 mr-2" />
          All Orders
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-14 text-base rounded-xl"
          onClick={() => setLocation("/my-earnings")}
          data-testid="button-my-pay"
        >
          <DollarSign className="h-5 w-5 mr-2" />
          Pay
        </Button>
      </div>
    </div>
  );
}
