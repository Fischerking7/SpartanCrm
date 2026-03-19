import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { KpiCard } from "@/components/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, CheckCircle, Clock } from "lucide-react";

interface SyncRun {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  matchedCount: number | null;
  unmatchedCount: number | null;
  totalSheetRows: number | null;
}

interface OpsData {
  openExceptions: number;
  unmatchedPayments: number;
  unmatchedChargebacks: number;
  rateIssues: number;
  pendingPayRuns: number;
  systemExceptions: number;
  latestSyncRun: SyncRun | null;
  alerts: { severity: "error" | "warning"; message: string }[];
}

export default function OperationsReportDashboard() {
  const { data, isLoading } = useQuery<OpsData>({
    queryKey: ["/api/reports/operations/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/reports/operations/dashboard", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="operations-report-dashboard">
      <h1 className="text-xl font-bold" data-testid="text-dashboard-title">Operations Dashboard</h1>

      {data.alerts.length > 0 && (
        <div className="space-y-2" data-testid="alert-banners">
          {data.alerts.map((alert, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 p-3 rounded-md border ${
                alert.severity === "error"
                  ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                  : "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800"
              }`}
              data-testid={`alert-${i}`}
            >
              {alert.severity === "error" ? (
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
              )}
              <span className={`text-sm font-medium ${
                alert.severity === "error" ? "text-red-800 dark:text-red-200" : "text-yellow-800 dark:text-yellow-200"
              }`}>
                {alert.message}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard
          label="Open Exceptions"
          value={data.openExceptions}
          variant={data.openExceptions > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Unmatched Payments"
          value={data.unmatchedPayments}
          variant={data.unmatchedPayments > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Unmatched Chargebacks"
          value={data.unmatchedChargebacks}
          variant={data.unmatchedChargebacks > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Rate Issues"
          value={data.rateIssues}
          variant={data.rateIssues > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Pending Pay Runs"
          value={data.pendingPayRuns}
          variant={data.pendingPayRuns > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="System Exceptions"
          value={data.systemExceptions}
          variant={data.systemExceptions > 0 ? "danger" : "success"}
        />
      </div>

      <Card data-testid="card-latest-sync">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="w-4 h-4" /> Latest Install Sync Run
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.latestSyncRun ? (
            <div className="flex flex-wrap items-center gap-4">
              <Badge
                variant={data.latestSyncRun.status === "COMPLETED" ? "default" : data.latestSyncRun.status === "FAILED" ? "destructive" : "secondary"}
                data-testid="badge-sync-status"
              >
                {data.latestSyncRun.status === "COMPLETED" && <CheckCircle className="w-3 h-3 mr-1" />}
                {data.latestSyncRun.status === "FAILED" && <AlertCircle className="w-3 h-3 mr-1" />}
                {data.latestSyncRun.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {new Date(data.latestSyncRun.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" })}
              </span>
              <span className="text-sm">
                <span className="font-medium">{data.latestSyncRun.matchedCount ?? 0}</span> matched
                {" · "}
                <span className="font-medium">{data.latestSyncRun.unmatchedCount ?? 0}</span> unmatched
                {data.latestSyncRun.totalSheetRows != null && (
                  <span> · <span className="font-medium">{data.latestSyncRun.totalSheetRows}</span> total rows</span>
                )}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No sync runs recorded</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
