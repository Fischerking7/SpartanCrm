import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, CheckCircle2, RefreshCw, ShoppingCart,
  FileText, Zap, Clock, ArrowRight, XCircle
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const severityConfig: Record<string, { color: string; bg: string; border: string; label: string }> = {
  URGENT: { color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950", border: "border-red-200 dark:border-red-800", label: "Urgent" },
  HIGH: { color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950", border: "border-orange-200 dark:border-orange-800", label: "High" },
  MEDIUM: { color: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950", border: "border-yellow-200 dark:border-yellow-800", label: "Medium" },
};

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
  };

  const getActionRoute = (exception: any) => {
    switch (exception.type) {
      case "APPROVAL_OVERDUE": return "/ops/orders";
      case "UNMATCHED_PAYMENT":
      case "UNMATCHED_CHARGEBACK": return "/queues";
      case "RATE_ISSUE": return "/queues";
      case "ORDER_EXCEPTION": return "/queues";
      default: return "/ops/orders";
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="ops-home">
      <div className="flex items-center justify-between">
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
          {(["URGENT", "HIGH", "MEDIUM"] as const).map(severity => {
            const items = grouped[severity];
            if (items.length === 0) return null;
            const config = severityConfig[severity];
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
                              Review
                              <ArrowRight className="h-3 w-3 ml-1" />
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

      {activityLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : activity ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card data-testid="strip-today">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Today's Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Orders Submitted</p>
                  <p className="text-xl font-bold">{activity.today?.ordersSubmitted || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Approvals Pending</p>
                  <p className="text-xl font-bold">{activity.today?.approvalsPending || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Auto-Approvals</p>
                  <p className="text-xl font-bold">{activity.today?.autoApprovals || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Manual Review</p>
                  <p className="text-xl font-bold">{activity.today?.manualReviewNeeded || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="strip-install-sync">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Install Sync
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activity.installSync ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">Matched</p>
                      <p className="text-lg font-bold">{activity.installSync.matched}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Approved</p>
                      <p className="text-lg font-bold">{activity.installSync.approved}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Unmatched</p>
                      <p className="text-lg font-bold text-orange-600">{activity.installSync.unmatched}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last sync: {new Date(activity.installSync.lastRun).toLocaleString()}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setLocation("/ops/install-sync")} data-testid="btn-run-sync">
                    Run Sync
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No sync runs yet</p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="strip-finance">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Finance Imports
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Pending Imports</p>
                  <p className="text-xl font-bold">{activity.financeImports?.pendingImports || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Unmatched Rows</p>
                  <p className="text-xl font-bold text-orange-600">{activity.financeImports?.unmatchedRows || 0}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setLocation("/ops/finance-imports")} data-testid="btn-view-imports">
                View Imports
              </Button>
            </CardContent>
          </Card>

          <Card data-testid="strip-jobs">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Background Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                <p className="text-muted-foreground">System is running normally</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-sm">All jobs healthy</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
