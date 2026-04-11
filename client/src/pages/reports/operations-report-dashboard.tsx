import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { KpiCard } from "@/components/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertTriangle, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronRight, ClipboardCheck, Search } from "lucide-react";

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

interface RepIssue {
  orderId: string;
  invoiceNumber: string | null;
  customerName: string;
  issue: string;
}

interface RepScore {
  repId: string;
  repName: string;
  totalOrders: number;
  cleanOrders: number;
  issues: { category: string; count: number }[];
  orderIssues: RepIssue[];
}

interface ScorecardData {
  scorecard: RepScore[];
  startDate: string;
  endDate: string;
}

const CLEAN_THRESHOLD = 80;

function getMonthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function OrderQualityScorecard() {
  const [startDate, setStartDate] = useState(getMonthStart());
  const [endDate, setEndDate] = useState(getToday());
  const [expandedRep, setExpandedRep] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading, isError } = useQuery<ScorecardData>({
    queryKey: ["/api/admin/order-quality-scorecard", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/admin/order-quality-scorecard?startDate=${startDate}&endDate=${endDate}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load scorecard");
      return res.json();
    },
  });

  const filteredScorecard = (data?.scorecard || []).filter(
    (rep) => rep.repName.toLowerCase().includes(searchTerm.toLowerCase()) || rep.repId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card data-testid="card-order-quality-scorecard">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4" /> Order Quality Scorecard
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Per-rep data quality metrics · Reps below {CLEAN_THRESHOLD}% clean rate are highlighted
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-xs w-[130px]"
              data-testid="input-scorecard-start-date"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-8 text-xs w-[130px]"
              data-testid="input-scorecard-end-date"
            />
          </div>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by rep name or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 text-xs pl-7"
            data-testid="input-scorecard-search"
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 p-4 text-sm text-red-600 dark:text-red-400" data-testid="text-scorecard-error">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Failed to load scorecard data. Please try again.
          </div>
        ) : filteredScorecard.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-scorecard-empty">
            No orders found for this period
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_80px_100px_1fr] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b">
              <span>Rep</span>
              <span className="text-center">Orders</span>
              <span className="text-center">Clean Rate</span>
              <span>Top Issues</span>
            </div>
            {filteredScorecard.map((rep) => {
              const cleanRate = rep.totalOrders > 0 ? Math.round((rep.cleanOrders / rep.totalOrders) * 100) : 100;
              const isBelowThreshold = cleanRate < CLEAN_THRESHOLD;
              const isExpanded = expandedRep === rep.repId;

              return (
                <div key={rep.repId} data-testid={`scorecard-row-${rep.repId}`}>
                  <button
                    className={`w-full text-left grid grid-cols-1 md:grid-cols-[1fr_80px_100px_1fr] gap-1 md:gap-2 px-3 py-2.5 border-b hover:bg-muted/30 transition-colors ${
                      isBelowThreshold ? "bg-red-50/50 dark:bg-red-950/10" : ""
                    }`}
                    onClick={() => setExpandedRep(isExpanded ? null : rep.repId)}
                    data-testid={`button-expand-${rep.repId}`}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
                      <span className="font-medium text-sm truncate">{rep.repName}</span>
                      <span className="text-xs text-muted-foreground hidden md:inline">({rep.repId})</span>
                    </div>
                    <div className="flex items-center gap-2 md:justify-center">
                      <span className="text-xs text-muted-foreground md:hidden">Orders:</span>
                      <span className="text-sm font-medium" data-testid={`text-order-count-${rep.repId}`}>{rep.totalOrders}</span>
                    </div>
                    <div className="flex items-center gap-2 md:justify-center">
                      <span className="text-xs text-muted-foreground md:hidden">Clean Rate:</span>
                      {rep.totalOrders === 0 ? (
                        <Badge variant="secondary" className="text-xs" data-testid={`badge-clean-rate-${rep.repId}`}>—</Badge>
                      ) : (
                        <Badge
                          variant={isBelowThreshold ? "destructive" : "default"}
                          className={`text-xs ${!isBelowThreshold ? "bg-green-600 hover:bg-green-700" : ""}`}
                          data-testid={`badge-clean-rate-${rep.repId}`}
                        >
                          {cleanRate}%
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1 md:mt-0">
                      {rep.issues.slice(0, 3).map((issue) => (
                        <Badge key={issue.category} variant="outline" className="text-[10px] px-1.5 py-0 h-5" data-testid={`badge-issue-${rep.repId}`}>
                          {issue.category} ({issue.count})
                        </Badge>
                      ))}
                      {rep.issues.length > 3 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                          +{rep.issues.length - 3} more
                        </Badge>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="bg-muted/20 border-b px-4 py-3" data-testid={`detail-panel-${rep.repId}`}>
                      <div className="flex flex-wrap gap-3 mb-3">
                        {rep.issues.map((issue) => (
                          <div key={issue.category} className="flex items-center gap-1.5 text-xs">
                            <span className="font-medium">{issue.count}</span>
                            <span className="text-muted-foreground">{issue.category}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border rounded-md overflow-hidden bg-background">
                        <div className="hidden md:grid grid-cols-[120px_1fr_1fr] gap-2 px-3 py-1.5 bg-muted/50 text-[10px] font-medium text-muted-foreground border-b uppercase tracking-wider">
                          <span>Order</span>
                          <span>Customer</span>
                          <span>Issue</span>
                        </div>
                        {rep.orderIssues.slice(0, 20).map((oi, idx) => (
                          <div
                            key={`${oi.orderId}-${idx}`}
                            className="grid grid-cols-1 md:grid-cols-[120px_1fr_1fr] gap-1 md:gap-2 px-3 py-1.5 border-b last:border-b-0 text-xs"
                            data-testid={`order-issue-row-${oi.orderId}-${idx}`}
                          >
                            <span className="font-mono text-muted-foreground">
                              {oi.invoiceNumber || oi.orderId.slice(0, 8) + "..."}
                            </span>
                            <span className="truncate">{oi.customerName}</span>
                            <Badge variant="outline" className="text-[10px] w-fit">{oi.issue}</Badge>
                          </div>
                        ))}
                        {rep.orderIssues.length > 20 && (
                          <div className="px-3 py-1.5 text-xs text-muted-foreground text-center">
                            +{rep.orderIssues.length - 20} more issues
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
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

      <OrderQualityScorecard />
    </div>
  );
}
