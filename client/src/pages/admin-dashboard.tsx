import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { StatsCard } from "@/components/stats-card";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge } from "@/components/status-badge";
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
  Download,
  RefreshCw,
} from "lucide-react";
import { Link } from "wouter";
import type { SalesOrder } from "@shared/schema";

interface AdminStats {
  totalEarnedMTD: number;
  totalPaidMTD: number;
  pendingInstalls: number;
  activeReps: number;
  unmatchedPayments: number;
  unmatchedChargebacks: number;
  rateIssues: number;
  pendingAdjustments: number;
  installedAwaitingPayment: number;
}

export default function AdminDashboard({ hideHeader = false }: { hideHeader?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const isFounder = user?.role === "OPERATIONS";

  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedReferenceData = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch("/api/admin/seed-reference-data", { 
        method: "POST",
        headers: getAuthHeaders() 
      });
      if (!res.ok) throw new Error("Failed to seed");
      const data = await res.json();
      toast({ 
        title: t("adminDashboard.referenceDataSynced"), 
        description: t("adminDashboard.syncResults", { 
          users: data.results.users || 0,
          providers: data.results.providers,
          clients: data.results.clients,
          services: data.results.services,
          rateCards: data.results.rateCards
        })
      });
    } catch {
      toast({ title: t("adminDashboard.seedFailed"), variant: "destructive" });
    } finally {
      setIsSeeding(false);
    }
  };

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
      toast({ title: t("adminDashboard.exportDownloaded"), description: t("adminDashboard.exportDownloadedDesc") });
    } catch {
      toast({ title: t("adminDashboard.exportFailed"), variant: "destructive" });
    }
  };

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/dashboard/admin-stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/admin-stats", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("adminDashboard.failedToFetchStats"));
      return res.json();
    },
  });

  const { data: pendingOrders, isLoading: pendingLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/orders"],
    queryFn: async () => {
      const res = await fetch("/api/orders", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("adminDashboard.failedToFetchOrders"));
      const orders = await res.json();
      return orders.filter((o: SalesOrder) => o.jobStatus === "PENDING").slice(0, 5);
    },
  });

  const queueColumns = [
    {
      key: "repId",
      header: t("adminDashboard.rep"),
      cell: (row: SalesOrder) => <span className="font-mono text-sm">{row.repId}</span>,
    },
    {
      key: "customerName",
      header: t("adminDashboard.customer"),
      cell: (row: SalesOrder) => <span className="font-medium truncate block max-w-[150px]">{row.customerName}</span>,
    },
    {
      key: "dateSold",
      header: t("adminDashboard.date"),
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "jobStatus",
      header: t("adminDashboard.job"),
      cell: (row: SalesOrder) => <JobStatusBadge status={row.jobStatus} />,
    },
    {
      key: "baseCommissionEarned",
      header: t("adminDashboard.commission"),
      cell: (row: SalesOrder) => (
        <span className="font-mono text-right block">
          ${parseFloat(row.baseCommissionEarned).toFixed(2)}
        </span>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="p-6 space-y-8">
      {!hideHeader && (
        <div>
          <h1 className="text-2xl font-semibold">{t("adminDashboard.title")}</h1>
          <p className="text-muted-foreground">
            {t("adminDashboard.subtitle")}
          </p>
        </div>
      )}

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
            title={t("adminDashboard.totalEarnedMtd")}
            value={stats?.totalEarnedMTD || 0}
            icon={DollarSign}
            testId="stat-total-earned"
          />
          <StatsCard
            title={t("adminDashboard.totalPaidMtd")}
            value={stats?.totalPaidMTD || 0}
            icon={DollarSign}
            testId="stat-total-paid"
          />
          <StatsCard
            title={t("adminDashboard.activeReps")}
            value={stats?.activeReps || 0}
            icon={Users}
            testId="stat-active-reps"
            isCurrency={false}
          />
          <StatsCard
            title={t("adminDashboard.pendingConnects")}
            value={stats?.pendingInstalls || 0}
            icon={CheckSquare}
            testId="stat-pending-installs"
            isCurrency={false}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <div>
              <CardTitle className="text-lg font-medium">{t("adminDashboard.pendingOrders")}</CardTitle>
              <CardDescription>{t("adminDashboard.pendingOrdersDesc")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/orders" data-testid="link-view-all-orders">
                {t("adminDashboard.viewAll")}
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={queueColumns}
              data={pendingOrders || []}
              isLoading={pendingLoading}
              emptyMessage={t("adminDashboard.noPendingOrders")}
              testId="table-pending-orders"
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                {t("adminDashboard.exceptionQueues")}
              </CardTitle>
              <CardDescription>{t("adminDashboard.exceptionQueuesDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/queues?tab=payments">
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{t("adminDashboard.unmatchedPayments")}</span>
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
                    <span className="text-sm">{t("adminDashboard.unmatchedChargebacks")}</span>
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
                    <span className="text-sm">{t("adminDashboard.rateIssues")}</span>
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
                    <span className="text-sm">{t("adminDashboard.pendingAdjustments")}</span>
                  </div>
                  <Badge variant={stats?.pendingAdjustments ? "secondary" : "outline"}>
                    {stats?.pendingAdjustments || 0}
                  </Badge>
                </div>
              </Link>
              <Link href="/orders?tab=aging">
                <div className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer" data-testid="link-installed-awaiting-payment">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    <span className="text-sm">{t("adminDashboard.connectedAwaitingPayment")}</span>
                  </div>
                  <Badge variant={stats?.installedAwaitingPayment ? "destructive" : "secondary"}>
                    {stats?.installedAwaitingPayment || 0}
                  </Badge>
                </div>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">{t("adminDashboard.quickActions")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/orders" data-testid="link-view-orders">
                  <CheckSquare className="h-4 w-4 mr-2" />
                  {t("adminDashboard.manageOrders")}
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/accounting" data-testid="link-export-accounting">
                  <FileText className="h-4 w-4 mr-2" />
                  {t("adminDashboard.exportToAccounting")}
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/payruns" data-testid="link-manage-payruns">
                  <Clock className="h-4 w-4 mr-2" />
                  {t("adminDashboard.managePayRuns")}
                </Link>
              </Button>
              {isFounder && (
                <Button 
                  variant="outline" 
                  className="w-full justify-start" 
                  onClick={handleSeedReferenceData}
                  disabled={isSeeding}
                  data-testid="button-seed-reference-data"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isSeeding ? 'animate-spin' : ''}`} />
                  {isSeeding ? t("adminDashboard.syncing") : t("adminDashboard.syncReferenceData")}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
