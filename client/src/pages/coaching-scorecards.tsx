import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Users, ClipboardList, ChevronRight, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Period = "WEEK" | "MONTH" | "QUARTER";

interface Scorecard {
  repId: string;
  name: string;
  role: string;
  sold: number;
  approved: number;
  conversionRate: string;
  avgDeal: string;
  commission: string;
  chargebackRate: string;
  compositeScore: number;
  trend: "up" | "down" | "stable";
  alerts: Array<{ type: string; severity: string; message: string }>;
}

interface ScorecardsData {
  scorecards: Scorecard[];
  needsAttention: Scorecard[];
  period: string;
}

interface RepPrepData {
  rep: { id: string; name: string; repId: string; role: string };
  last30Days: { sold: number; approved: number; conversionRate: string; commission: string };
  priorPeriod: { sold: number; approved: number; conversionRate: string };
  trend: "improving" | "declining" | "stable";
  talkingPoints: string[];
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-green-500" : score >= 45 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-2">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-bold w-8 text-right">{score}</span>
    </div>
  );
}

function TrendBadge({ trend }: { trend: "up" | "down" | "stable" }) {
  const { t } = useTranslation();
  if (trend === "up") return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs"><TrendingUp className="h-3 w-3 mr-0.5" />{t("coachingScorecards.up")}</Badge>;
  if (trend === "down") return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 text-xs"><TrendingDown className="h-3 w-3 mr-0.5" />{t("coachingScorecards.down")}</Badge>;
  return <Badge variant="secondary" className="text-xs"><Minus className="h-3 w-3 mr-0.5" />{t("coachingScorecards.stable")}</Badge>;
}

function RepPrepDialog({ repUserId, repName }: { repUserId: string; repName: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { data: prep, isLoading } = useQuery<RepPrepData>({
    queryKey: ["/api/coaching/rep-prep", repUserId],
    queryFn: async () => {
      const res = await fetch(`/api/coaching/rep-prep/${repUserId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" data-testid={`button-prep-${repUserId}`}>
          <ClipboardList className="h-4 w-4 mr-1" />
          {t("coachingScorecards.prep1on1")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("coachingScorecards.prepDialogTitle", { name: repName })}</DialogTitle>
          <DialogDescription>{t("coachingScorecards.prepDialogDesc")}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : prep ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Card className="border-primary/20">
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs text-muted-foreground">{t("coachingScorecards.last30Days")}</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="text-xl font-bold">{t("coachingScorecards.soldCount", { count: prep.last30Days.sold })}</div>
                  <div className="text-sm text-muted-foreground">{t("coachingScorecards.approvalRate", { count: prep.last30Days.conversionRate })}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 pt-3 px-3">
                  <CardTitle className="text-xs text-muted-foreground">{t("coachingScorecards.priorMonth")}</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="text-xl font-bold">{t("coachingScorecards.soldCount", { count: prep.priorPeriod.sold })}</div>
                  <div className="text-sm text-muted-foreground">{t("coachingScorecards.approvalRate", { count: prep.priorPeriod.conversionRate })}</div>
                </CardContent>
              </Card>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t("coachingScorecards.trend")}</span>
              <Badge className={prep.trend === "improving" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0" : prep.trend === "declining" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0" : ""}>
                {prep.trend.charAt(0).toUpperCase() + prep.trend.slice(1)}
              </Badge>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">{t("coachingScorecards.talkingPoints")}</div>
              <ul className="space-y-2">
                {prep.talkingPoints.map((tp, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm" data-testid={`text-talking-point-${idx}`}>
                    <ChevronRight className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <span>{tp}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-6">{t("coachingScorecards.noData")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ScorecardWeights {
  volume: number;
  conversion: number;
  avgDeal: number;
  quality: number;
}

function WeightsDialog() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [localWeights, setLocalWeights] = useState<ScorecardWeights>({ volume: 30, conversion: 35, avgDeal: 20, quality: 15 });

  const { data: weights } = useQuery<ScorecardWeights>({
    queryKey: ["/api/coaching/scorecard-weights"],
    queryFn: async () => {
      const res = await fetch("/api/coaching/scorecard-weights", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("coachingScorecards.failedToLoadWeights"));
      return res.json();
    },
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async (w: ScorecardWeights) => {
      const res = await fetch("/api/coaching/scorecard-weights", {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(w),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ message: t("coachingScorecards.failedToSave") }));
        throw new Error(e.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coaching/scorecard-weights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coaching/scorecards"] });
      toast({ title: t("coachingScorecards.weightsSaved"), description: t("coachingScorecards.weightsSavedDesc") });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: t("coachingScorecards.error"), description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (weights) setLocalWeights(weights);
  }, [weights]);

  const openDialog = () => {
    setOpen(true);
  };

  const total = localWeights.volume + localWeights.conversion + localWeights.avgDeal + localWeights.quality;
  const valid = Math.abs(total - 100) < 0.01;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={openDialog} data-testid="button-configure-weights">
          <Settings2 className="h-4 w-4 mr-1" />
          {t("coachingScorecards.weights")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("coachingScorecards.weightsTitle")}</DialogTitle>
          <DialogDescription>{t("coachingScorecards.weightsDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {([
            { key: "volume", label: t("coachingScorecards.salesVolume") },
            { key: "conversion", label: t("coachingScorecards.conversionRate") },
            { key: "avgDeal", label: t("coachingScorecards.avgDealSize") },
            { key: "quality", label: t("coachingScorecards.qualityChargebacks") },
          ] as { key: keyof ScorecardWeights; label: string }[]).map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3">
              <Label className="w-40 text-sm">{label}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={localWeights[key]}
                onChange={(e) => setLocalWeights(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                className="w-20 h-8"
                data-testid={`input-weight-${key}`}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          ))}
          <div className={`text-sm font-medium ${valid ? "text-green-600" : "text-red-500"}`}>
            {t("coachingScorecards.total", { count: total.toFixed(0) })} {valid ? "✓" : t("coachingScorecards.mustBe100")}
          </div>
          <Button
            className="w-full"
            disabled={!valid || saveMutation.isPending}
            onClick={() => saveMutation.mutate(localWeights)}
            data-testid="button-save-weights"
          >
            {saveMutation.isPending ? t("coachingScorecards.saving") : t("coachingScorecards.saveWeights")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CoachingScorecards() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("MONTH");

  const { data, isLoading } = useQuery<ScorecardsData>({
    queryKey: ["/api/coaching/scorecards", period],
    queryFn: async () => {
      const res = await fetch(`/api/coaching/scorecards?period=${period}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("coachingScorecards.failedToLoadScorecards"));
      return res.json();
    },
  });

  const isAdmin = ["ADMIN", "OPERATIONS", "DIRECTOR", "EXECUTIVE"].includes(user?.role || "");

  const severityConfig: Record<string, string> = {
    high: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300",
    medium: "bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/30 dark:border-yellow-800 dark:text-yellow-300",
    low: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">{t("coachingScorecards.title")}</h1>
          <p className="text-muted-foreground">{t("coachingScorecards.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <WeightsDialog />}
          <div className="flex gap-1 bg-muted p-1 rounded-md">
            {(["WEEK", "MONTH", "QUARTER"] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? "default" : "ghost"}
                size="sm"
                onClick={() => setPeriod(p)}
                data-testid={`button-period-${p.toLowerCase()}`}
              >
                {p === "WEEK" ? t("coachingScorecards.week") : p === "MONTH" ? t("coachingScorecards.month") : t("coachingScorecards.quarter")}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Coaching Alerts */}
      {data && data.needsAttention.length > 0 && (
        <Card data-testid="card-coaching-alerts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              {t("coachingScorecards.coachingAlerts", { count: data.needsAttention.length })}
            </CardTitle>
            <CardDescription>{t("coachingScorecards.coachingAlertsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.needsAttention.map((rep) => (
              <div key={rep.repId} className="border rounded-lg p-3 space-y-2" data-testid={`alert-rep-${rep.repId}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{rep.name}</span>
                    <TrendBadge trend={rep.trend} />
                  </div>
                  <RepPrepDialog repUserId={rep.repId} repName={rep.name} />
                </div>
                {rep.alerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className={`text-xs px-3 py-1.5 rounded border ${severityConfig[alert.severity] || severityConfig.low}`}
                    data-testid={`alert-${alert.type}-${idx}`}
                  >
                    {alert.message}
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Scorecards Table */}
      <Card data-testid="card-scorecards-table">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {t("coachingScorecards.repPerformanceScorecards")}
          </CardTitle>
          <CardDescription>{t("coachingScorecards.repPerformanceScorecardsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data && data.scorecards.length > 0 ? (
            <div className="space-y-1">
              <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-3 text-xs text-muted-foreground font-medium pb-2 border-b px-2">
                <span>{t("coachingScorecards.rep")}</span>
                <span className="text-right w-12">{t("coachingScorecards.sold")}</span>
                <span className="text-right w-14">{t("coachingScorecards.rate")}</span>
                <span className="text-right w-20">{t("coachingScorecards.avgDeal")}</span>
                <span className="text-right w-14">{t("coachingScorecards.chgbk")}</span>
                <span className="text-right w-24">{t("coachingScorecards.score")}</span>
                <span className="w-20"></span>
              </div>
              {data.scorecards.map((sc) => (
                <div
                  key={sc.repId}
                  className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-2 md:gap-3 items-center p-2 rounded-lg hover:bg-muted/30 border border-transparent hover:border-border"
                  data-testid={`scorecard-row-${sc.repId}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{sc.name}</span>
                    <TrendBadge trend={sc.trend} />
                    {sc.alerts.length > 0 && (
                      <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                    )}
                  </div>
                  <div className="flex md:block items-center gap-2">
                    <span className="text-xs text-muted-foreground md:hidden">{t("coachingScorecards.sold")}:</span>
                    <span className="font-mono text-sm md:text-right md:block w-12" data-testid={`text-sold-${sc.repId}`}>{sc.sold}</span>
                  </div>
                  <div className="flex md:block items-center gap-2">
                    <span className="text-xs text-muted-foreground md:hidden">{t("coachingScorecards.rate")}:</span>
                    <span className="font-mono text-sm md:text-right md:block w-14">{sc.conversionRate}%</span>
                  </div>
                  <div className="flex md:block items-center gap-2">
                    <span className="text-xs text-muted-foreground md:hidden">{t("coachingScorecards.avgDeal")}:</span>
                    <span className="font-mono text-sm md:text-right md:block w-20">${parseFloat(sc.avgDeal).toFixed(0)}</span>
                  </div>
                  <div className="flex md:block items-center gap-2">
                    <span className="text-xs text-muted-foreground md:hidden">{t("coachingScorecards.chargeback")}</span>
                    <span className={`font-mono text-sm md:text-right md:block w-14 ${parseFloat(sc.chargebackRate) > 10 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {sc.chargebackRate}%
                    </span>
                  </div>
                  <div className="w-24">
                    <ScoreBar score={sc.compositeScore} />
                  </div>
                  <div className="flex justify-end">
                    <RepPrepDialog repUserId={sc.repId} repName={sc.name} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>{t("coachingScorecards.noRepData")}</p>
              <p className="text-xs mt-1">{t("coachingScorecards.scorecardsActivityHint")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.scorecards.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("coachingScorecards.scoreMethodology")}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <p>{t("coachingScorecards.scoreMethodologyDesc")}</p>
            <p>{t("coachingScorecards.scoreMethodologyAlerts")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
