import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { ProductionMetricsModule } from "@/components/production-metrics-card";
import { DashboardChartsModule } from "@/components/dashboard-charts";
import { NextDayInstallsCard } from "@/components/next-day-installs";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge, PaymentStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Upload, TrendingUp, Wallet, ArrowDownCircle } from "lucide-react";
import type { SalesOrder } from "@shared/schema";

interface YTDTotals {
  ytdGross: number;
  ytdNet: number;
  ytdDeductions: number;
  statementsCount: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

interface DashboardSummary {
  weekly: {
    personal: {
      soldCount: number;
      connectedCount: number;
      earnedDollars: number;
      deltas: {
        soldCount: { value: number; percent: number | null };
        connectedCount: { value: number; percent: number | null };
        earnedDollars: { value: number; percent: number | null };
      };
      sparklineSeries: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>;
    };
    team: null;
  };
  mtd: {
    personal: {
      soldCount: number;
      connectedCount: number;
      earnedDollars: number;
      deltas: {
        soldCount: { value: number; percent: number | null };
        connectedCount: { value: number; percent: number | null };
        earnedDollars: { value: number; percent: number | null };
      };
      sparklineSeries: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>;
    };
    team: null;
  };
  breakdowns: {
    teamByRep: null;
    teamByManager: null;
  };
}

export default function RepDashboard() {
  const { user } = useAuth();

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: recentOrders, isLoading: ordersLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/orders", { limit: 10 }],
    queryFn: async () => {
      const res = await fetch("/api/orders?limit=10", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });

  const { data: ytdData } = useQuery<YTDTotals>({
    queryKey: ["/api/payroll/my-ytd"],
    queryFn: async () => {
      const res = await fetch("/api/payroll/my-ytd", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch YTD totals");
      return res.json();
    },
  });

  const orderColumns = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-sm">{row.invoiceNumber || "-"}</span>
      ),
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row: SalesOrder) => <span className="font-medium">{row.customerName}</span>,
    },
    {
      key: "dateSold",
      header: "Date Sold",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "jobStatus",
      header: "Job Status",
      cell: (row: SalesOrder) => <JobStatusBadge status={row.jobStatus} />,
    },
    {
      key: "baseCommissionEarned",
      header: "Commission",
      cell: (row: SalesOrder) => {
        const net = parseFloat(row.baseCommissionEarned) + parseFloat(row.incentiveEarned || "0");
        return (
          <span className="font-mono text-right block">
            ${net.toFixed(2)}
          </span>
        );
      },
      className: "text-right",
    },
    {
      key: "paymentStatus",
      header: "Payment",
      cell: (row: SalesOrder) => <PaymentStatusBadge status={row.paymentStatus} />,
    },
  ];

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {user?.name}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" data-testid="button-export-orders">
            <Download className="h-4 w-4 mr-2" />
            Export Orders
          </Button>
          <Button variant="outline" data-testid="button-import-leads">
            <Upload className="h-4 w-4 mr-2" />
            Import Leads
          </Button>
        </div>
      </div>

      {summaryLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-4" />
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        <>
          {ytdData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                  <CardTitle className="text-sm font-medium">YTD Net Earnings</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-dashboard-ytd-gross">
                    {formatCurrency(ytdData.ytdNet || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">After overrides</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                  <CardTitle className="text-sm font-medium">YTD Deductions</CardTitle>
                  <ArrowDownCircle className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-dashboard-ytd-deductions">
                    -{formatCurrency(ytdData.ytdDeductions || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Total withheld</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                  <CardTitle className="text-sm font-medium">YTD Net Pay</CardTitle>
                  <Wallet className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold" data-testid="text-dashboard-ytd-net">
                    {formatCurrency(ytdData.ytdNet || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Take-home pay ({ytdData.statementsCount || 0} pay periods)</p>
                </CardContent>
              </Card>
            </div>
          )}
          <NextDayInstallsCard />
          <ProductionMetricsModule
            personalWeekly={summary.weekly.personal}
            personalMtd={summary.mtd.personal}
            teamWeekly={null}
            teamMtd={null}
          />
          <DashboardChartsModule
            personalWeekly={summary.weekly.personal.sparklineSeries}
            personalMtd={summary.mtd.personal.sparklineSeries}
            teamWeekly={null}
            teamMtd={null}
          />
        </>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
          <div>
            <CardTitle className="text-lg font-medium">Recent Orders</CardTitle>
            <CardDescription>Your last 10 orders</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/orders" data-testid="link-view-all-orders">View All</a>
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={orderColumns}
            data={recentOrders || []}
            isLoading={ordersLoading}
            emptyMessage="No orders yet"
            testId="table-recent-orders"
          />
        </CardContent>
      </Card>
    </div>
  );
}
