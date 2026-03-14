import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, CheckCircle2, RefreshCw, ShoppingCart,
  FileText, Zap, Clock, ArrowRight, XCircle, Users, DollarSign
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const severityConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  URGENT: { color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950", border: "border-red-200 dark:border-red-800", label: "Urgent" },
  HIGH: { color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950", border: "border-orange-200 dark:border-orange-800", label: "High" },
  MEDIUM: { color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950", border: "border-yellow-200 dark:border-yellow-800", label: "Medium" },
  LOW: { color: "text-gray-600 dark:text-gray-400", bg: "bg-gray-50 dark:bg-gray-900", border: "border-gray-200 dark:border-gray-700", label: "Low" },
};

const healthItems = [
  { label: "Database", key: "db" },
  { label: "Email", key: "email" },
  { label: "Storage", key: "storage" },
  { label: "Scheduler", key: "scheduler" },
];

export default function OpsHome() {
  const [, setLocation] = useLocation();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const { data: exceptions, isLoading: exceptionsLoading, refetch: refetchExceptions } = useQuery<any>({
    queryKey: ["/api/ops/exceptions"],
    refetchInterval: 60000,
  });

  const { data: activity, isLoading: activityLoading } = useQuery<any>({
    queryKey: ["/api/ops/activity-summary"],
    refetchInterval: 60000,
  });

  const [lastRefresh, setLastRefresh] = useState(new Date());

  const handleRefresh = () => {
    refetchExceptions();
    queryClient.invalidateQueries({ queryKey: ["/api/ops/activity-summary"] });
    setLastRefresh(new Date());
  };

  const handleDismiss = (id: string) => {
    setDismissedIds(prev => new Set([...prev, id]));
  };

  const visibleExceptions = (exceptions?.exceptions || []).filter(
    (e: any) => !dismissedIds.has(e.id)
  );

  const grouped = {
    URGENT: visibleExceptions.filter((e: any) => e.severity === "URGENT"),
    HIGH: visibleExceptions.filter((e: any) => e.severity === "HIGH"),
    MEDIUM: visibleExceptions.filter((e: any) => e.severity === "MEDIUM"),
    LOW: visibleExceptions.filter((e: any) => !["URGENT", "HIGH", "MEDIUM"].includes(e.severity)),
  };

  const getActionRoute = (exception: any) => {
    switch (exception.type) {
      case "APPROVAL_OVERDUE": return "/ops/orders";
      case "UNMATCHED_PAYMENT":
      case "UNMATCHED_CHARGEBACK": return "/ops/ar";
      case "RATE_ISSUE": return "/ops/orders";
      case "ORDER_EXCEPTION": return "/ops/orders";
      case "RESERVE_DEFICIT":
      case "RESERVE_MATURITY_RELEASE_DUE": return "/ops/reps";
      case "RESERVE_CAP_OVERRIDE_ACTIVE": return "/ops/reps";
      default: return "/ops/orders";
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-home">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="ops-title">Operations Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Last synced: {lastRefresh.toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} data-testid="btn-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 p-3 rounded-lg border bg-card" data-testid="system-health-strip">
        {healthItems.map(item => (
          <div key={item.key} className="flex items-center gap-2 text-sm" data-testid={`health-${item.key}`}>
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>

      {activityLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="quick-stats-row">
          <Card className="border-0 shadow-sm" data-testid="stat-pending-approvals">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activity?.today?.approvalsPending || 0}</p>
                <p className="text-xs text-muted-foreground">Pending Approvals</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm" data-testid="stat-draft-payruns">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activity?.payRuns?.draft || 0}</p>
                <p className="text-xs text-muted-foreground">Draft Pay Runs</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm" data-testid="stat-open-ar">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#C9A84C]/20 flex items-center justify-center">
                <FileText className="h-5 w-5 text-[#C9A84C]" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activity?.financeImports?.unmatchedRows || 0}</p>
                <p className="text-xs text-muted-foreground">Open AR</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm" data-testid="stat-onboarding">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activity?.onboarding?.pending || 0}</p>
                <p className="text-xs text-muted-foreground">Onboarding Pending</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {exceptionsLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : visibleExceptions.length === 0 ? (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
          <CardContent className="flex items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500 mr-4" />
            <div>
              <h3 className="text-lg font-semibold text-green-700 dark:text-green-400">No exceptions</h3>
              <p className="text-green-600 dark:text-green-500">All systems clear.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map(severity => {
            const items = grouped[severity];
            if (items.length === 0) return null;
            const config = severityConfig[severity];

            if (severity === "MEDIUM" || severity === "LOW") {
              return (
                <div key={severity}>
                  <div className={`flex items-center gap-2 mb-2 ${config.color}`}>
                    <AlertTriangle className="h-4 w-4" />
                    <h2 className="font-semibold text-sm uppercase tracking-wide">
                      {config.label} ({items.length})
                    </h2>
                  </div>
                  <div className={`rounded-lg border ${config.border} ${config.bg} divide-y`}>
                    {items.map((exc: any) => (
                      <div key={exc.id} className="flex items-center justify-between px-4 py-2.5 gap-3" data-testid={`exception-row-${exc.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${config.color}`}>{exc.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{exc.description}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLocation(getActionRoute(exc))} data-testid={`btn-view-${exc.id}`}>
                            View
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-1" onClick={() => handleDismiss(exc.id)} data-testid={`btn-dismiss-${exc.id}`}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <div key={severity}>
                <div className={`flex items-center gap-2 mb-3 ${config.color}`}>
                  <AlertTriangle className="h-4 w-4" />
                  <h2 className="font-semibold text-sm uppercase tracking-wide">
                    {config.label} ({items.length})
                  </h2>
                </div>
                <div className="space-y-3">
                  {items.map((exc: any) => (
                    <Card key={exc.id} className={`${config.border} ${config.bg}`} data-testid={`exception-card-${exc.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h3 className={`font-semibold ${config.color}`}>{exc.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1">{exc.description}</p>
                            {exc.details?.daysPending && (
                              <p className="text-xs text-muted-foreground mt-1">
                                <Clock className="h-3 w-3 inline mr-1" />
                                Waiting {exc.details.daysPending} days
                                {exc.details.estimatedCommission > 0 && ` | Est. impact: $${exc.details.estimatedCommission.toFixed(0)}`}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" variant="default" onClick={() => setLocation(getActionRoute(exc))} data-testid={`btn-review-${exc.id}`}>
                              Review <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDismiss(exc.id)} data-testid={`btn-dismiss-${exc.id}`}>
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
