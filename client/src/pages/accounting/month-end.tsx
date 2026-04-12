import i18n from "i18next";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { CalendarCheck, RefreshCw, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "wouter";

interface ChecklistItem {
  id: string; label: string; description: string; complete: boolean; blocker: boolean;
  count: number; completedCount?: number; href?: string;
}

interface MonthEndData {
  checklist: ChecklistItem[];
  completedCount: number;
  totalCount: number;
  completionPct: number;
  blockers: ChecklistItem[];
  monthStart: string;
  today: string;
  isMonthEndPeriod: boolean;
}

export default function MonthEnd() {
  const { data, isLoading, error, refetch } = useQuery<MonthEndData>({
    queryKey: ["/api/accounting/month-end-status"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/month-end-status", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load month-end status");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const monthLabel = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleString(i18n.language === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric" });
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarCheck className="h-6 w-6 text-primary" />
            Month-End Close Checklist
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data ? `${monthLabel(data.monthStart)} close status` : "Loading..."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-monthend">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load month-end checklist.</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          {data.isMonthEndPeriod && (
            <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-300">
                Month-end period is active. Please complete all items before closing.
              </AlertDescription>
            </Alert>
          )}

          <Card data-testid="card-completion-progress">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Overall Completion</CardTitle>
                <span className="text-2xl font-bold" data-testid="text-completion-pct">
                  {data.completionPct}%
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={data.completionPct} className="h-3" />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{data.completedCount} of {data.totalCount} items complete</span>
                {data.completionPct === 100 ? (
                  <Badge variant="outline" className="text-green-600 border-green-300">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Ready to Close
                  </Badge>
                ) : (
                  <Badge variant="secondary">{data.totalCount - data.completedCount} remaining</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {data.blockers.length > 0 && (
            <Alert variant="destructive" data-testid="alert-blockers">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>{data.blockers.length} blocking issue{data.blockers.length !== 1 ? "s" : ""}</strong> must be resolved before month-end close.
                <ul className="mt-2 space-y-1 list-disc list-inside">
                  {data.blockers.map(b => (
                    <li key={b.id} className="text-sm">{b.label}: {b.description}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            {data.checklist.map((item) => (
              <Card
                key={item.id}
                className={item.complete ? "border-green-200 dark:border-green-800" : item.blocker ? "border-destructive/50" : ""}
                data-testid={`card-checklist-${item.id}`}
              >
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {item.complete ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : item.blocker ? (
                        <XCircle className="h-5 w-5 text-destructive" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="font-medium text-sm">{item.label}</div>
                        <div className="flex items-center gap-2 shrink-0">
                          {item.blocker && !item.complete && (
                            <Badge variant="destructive" className="text-xs">Blocker</Badge>
                          )}
                          {item.complete ? (
                            <Badge variant="outline" className="text-xs text-green-600 border-green-300">Complete</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">{item.count} pending</Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{item.description}</div>
                      {item.href && !item.complete && (
                        <Link href={item.href}>
                          <Button variant="link" className="h-auto p-0 text-xs mt-1 text-primary" data-testid={`link-checklist-${item.id}`}>
                            View &rarr;
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-xs text-muted-foreground text-right">
            Data as of {new Date().toLocaleString()}
          </div>
        </>
      )}
    </div>
  );
}
