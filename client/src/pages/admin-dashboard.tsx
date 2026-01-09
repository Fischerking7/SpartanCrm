import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { StatsCard } from "@/components/stats-card";
import { DataTable } from "@/components/data-table";
import { ApprovalStatusBadge, JobStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  Users,
  CheckSquare,
  AlertTriangle,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  Download,
} from "lucide-react";
import { Link } from "wouter";
import type { SalesOrder } from "@shared/schema";

interface AdminStats {
  totalEarnedMTD: number;
  totalPaidMTD: number;
  pendingApprovals: number;
  activeReps: number;
  unmatchedPayments: number;
  unmatchedChargebacks: number;
  rateIssues: number;
  pendingAdjustments: number;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isFounder = user?.role === "FOUNDER";

  const handleExportReferenceData = async () => {
    try {
      const res = await fetch("/api/admin/export-reference-data", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to export");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reference-data-export.sql";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "Export downloaded", description: "Paste this SQL in the Production database panel" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/dashboard/admin-stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/admin-stats", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data: approvalQueue, isLoading: queueLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/admin/approvals/queue", { limit: 5 }],
    queryFn: async () => {
      const res = await fetch("/api/admin/approvals/queue?limit=5", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch approvals");
      return res.json();
    },
  });

  const queueColumns = [
    {
      key: "repId",
      header: "Rep",
      cell: (row: SalesOrder) => <span className="font-mono text-sm">{row.repId}</span>,
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row: SalesOrder) => <span className="font-medium truncate block max-w-[150px]">{row.customerName}</span>,
    },
    {
      key: "dateSold",
      header: "Date",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "jobStatus",
      header: "Job",
      cell: (row: SalesOrder) => <JobStatusBadge status={row.jobStatus} />,
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
      key: "actions",
      header: "",
      cell: (row: SalesOrder) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2" data-testid={`button-approve-${row.id}`}>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" data-testid={`button-reject-${row.id}`}>
            <XCircle className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          System overview and quick actions
        </p>
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
            title="Total Earned MTD"
            value={stats?.totalEarnedMTD || 0}
            icon={DollarSign}
            testId="stat-total-earned"
          />
          <StatsCard
            title="Total Paid MTD"
            value={stats?.totalPaidMTD || 0}
            icon={DollarSign}
            testId="stat-total-paid"
          />
          <StatsCard
            title="Active Reps"
            value={stats?.activeReps || 0}
            icon={Users}
            testId="stat-active-reps"
            isCurrency={false}
          />
          <StatsCard
            title="Pending Approvals"
            value={stats?.pendingApprovals || 0}
            icon={CheckSquare}
            testId="stat-pending-approvals"
            isCurrency={false}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <div>
              <CardTitle className="text-lg font-medium">Approval Queue</CardTitle>
              <CardDescription>Orders awaiting approval</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/approvals" data-testid="link-view-all-approvals">
                View All
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={queueColumns}
              data={approvalQueue || []}
              isLoading={queueLoading}
              emptyMessage="No orders pending approval"
              testId="table-approval-queue"
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Exception Queues
              </CardTitle>
              <CardDescription>Items requiring attention</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/queues?tab=payments">
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Unmatched Payments</span>
                  </div>
                  <Badge variant={stats?.unmatchedPayments ? "destructive" : "secondary"}>
                    {stats?.unmatchedPayments || 0}
                  </Badge>
                </div>
              </Link>
              <Link href="/queues?tab=chargebacks">
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Unmatched Chargebacks</span>
                  </div>
                  <Badge variant={stats?.unmatchedChargebacks ? "destructive" : "secondary"}>
                    {stats?.unmatchedChargebacks || 0}
                  </Badge>
                </div>
              </Link>
              <Link href="/queues?tab=rates">
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Rate Issues</span>
                  </div>
                  <Badge variant={stats?.rateIssues ? "destructive" : "secondary"}>
                    {stats?.rateIssues || 0}
                  </Badge>
                </div>
              </Link>
              <Link href="/adjustments">
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Pending Adjustments</span>
                  </div>
                  <Badge variant={stats?.pendingAdjustments ? "secondary" : "outline"}>
                    {stats?.pendingAdjustments || 0}
                  </Badge>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/approvals" data-testid="link-bulk-approve">
                  <CheckSquare className="h-4 w-4 mr-2" />
                  Bulk Approve Orders
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/accounting" data-testid="link-export-accounting">
                  <FileText className="h-4 w-4 mr-2" />
                  Export to Accounting
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/payruns" data-testid="link-manage-payruns">
                  <Clock className="h-4 w-4 mr-2" />
                  Manage Pay Runs
                </Link>
              </Button>
              {isFounder && (
                <Button 
                  variant="outline" 
                  className="w-full justify-start" 
                  onClick={handleExportReferenceData}
                  data-testid="button-export-reference-data"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export Reference Data (SQL)
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
