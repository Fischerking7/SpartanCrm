import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { StatsCard } from "@/components/stats-card";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge, ApprovalStatusBadge, PaymentStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, FileText, Clock, AlertTriangle, Download, Upload, Calendar } from "lucide-react";
import type { SalesOrder } from "@shared/schema";

interface DashboardStats {
  earnedMTD: number;
  paidMTD: number;
  paidWeek: number;
  chargebacksMTD: number;
  outstanding: number;
  pendingApproval: number;
  todayInstalls: number;
}

export default function RepDashboard() {
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/stats", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch stats");
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
      key: "approvalStatus",
      header: "Approval",
      cell: (row: SalesOrder) => <ApprovalStatusBadge status={row.approvalStatus} />,
    },
    {
      key: "baseCommissionEarned",
      header: "Commission",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-right block">
          ${parseFloat(row.baseCommissionEarned).toFixed(2)}
        </span>
      ),
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

      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Earned MTD"
            value={stats?.earnedMTD || 0}
            icon={DollarSign}
            testId="stat-earned-mtd"
          />
          <StatsCard
            title="Paid This Week"
            value={stats?.paidWeek || 0}
            icon={DollarSign}
            testId="stat-paid-week"
          />
          <StatsCard
            title="Pending Approval"
            value={stats?.pendingApproval || 0}
            icon={Clock}
            testId="stat-pending-approval"
          />
          <StatsCard
            title="Today's Installs"
            value={stats?.todayInstalls || 0}
            icon={Calendar}
            testId="stat-today-installs"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">Commission Summary</CardTitle>
              <CardDescription>Current month overview</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">Earned MTD</span>
                <span className="font-mono font-semibold">
                  ${(stats?.earnedMTD || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">Paid MTD</span>
                <span className="font-mono font-semibold text-green-600">
                  ${(stats?.paidMTD || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">Chargebacks MTD</span>
                <span className="font-mono font-semibold text-red-600">
                  -${Math.abs(stats?.chargebacksMTD || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium">Outstanding</span>
                <span className="font-mono font-bold text-lg">
                  ${(stats?.outstanding || 0).toFixed(2)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Needs Attention
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Pending Approval</span>
                  <span className="font-mono font-semibold">{stats?.pendingApproval || 0}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
