import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Users, Target, ArrowRight, ChevronRight, Filter } from "lucide-react";
import { Link } from "wouter";

type Period = "WEEK" | "MONTH" | "QUARTER";

interface FunnelData {
  period: { type: string; start: string; end: string };
  funnel: Array<{ stage: string; count: number; label: string }>;
  metrics: {
    installRate: string;
    approvalRate: string;
    paymentRate: string;
    totalCommission: string;
    paidCommission: string;
  };
}

interface TrendsData {
  trends: Array<{ month: string; monthKey: string; sold: number; approved: number; paid: number; winRate: string; revenue: number }>;
  projection: { month: string; estimatedSold: number; estimatedWinRate: string; estimatedRevenue: string };
}

interface RepPerformanceData {
  reps: Array<{ repId: string; name: string; sold: number; approved: number; approvalRate: string; commission: string; avgDeal: string }>;
  period: string;
}

interface Provider {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  repId: string;
}

interface TeamsData {
  teams: Team[];
}

function formatCurrency(val: string | number) {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export default function PipelineForecast() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("MONTH");
  const [trendMonths, setTrendMonths] = useState("6");
  const [repIdFilter, setRepIdFilter] = useState<string>("all");
  const [providerIdFilter, setProviderIdFilter] = useState<string>("all");
  const [teamIdFilter, setTeamIdFilter] = useState<string>("all");

  const { data: repPerf, isLoading: repPerfLoading } = useQuery<RepPerformanceData>({
    queryKey: ["/api/pipeline-forecast/rep-performance", period],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline-forecast/rep-performance?period=${period}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load rep performance");
      return res.json();
    },
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load providers");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data: teamsData } = useQuery<TeamsData>({
    queryKey: ["/api/pipeline-forecast/teams"],
    queryFn: async () => {
      const res = await fetch("/api/pipeline-forecast/teams", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load teams");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const funnelParams = new URLSearchParams({ period });
  if (repIdFilter !== "all") funnelParams.set("repId", repIdFilter);
  if (providerIdFilter !== "all") funnelParams.set("providerId", providerIdFilter);
  if (teamIdFilter !== "all") funnelParams.set("teamId", teamIdFilter);

  const trendsParams = new URLSearchParams({ months: trendMonths });
  if (repIdFilter !== "all") trendsParams.set("repId", repIdFilter);
  if (teamIdFilter !== "all") trendsParams.set("teamId", teamIdFilter);

  const { data: funnel, isLoading: funnelLoading } = useQuery<FunnelData>({
    queryKey: ["/api/pipeline-forecast/funnel", period, repIdFilter, providerIdFilter, teamIdFilter],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline-forecast/funnel?${funnelParams}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load funnel");
      return res.json();
    },
  });

  const { data: trends, isLoading: trendsLoading } = useQuery<TrendsData>({
    queryKey: ["/api/pipeline-forecast/win-rate-trends", trendMonths, repIdFilter, teamIdFilter],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline-forecast/win-rate-trends?${trendsParams}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load trends");
      return res.json();
    },
  });

  const funnelStageColors = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd"];
  const isLeadOrAbove = ["LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE", "ADMIN"].includes(user?.role || "");
  const providerList = providers || [];

  const resetFilters = () => {
    setRepIdFilter("all");
    setProviderIdFilter("all");
    setTeamIdFilter("all");
  };
  const hasActiveFilters = repIdFilter !== "all" || providerIdFilter !== "all" || teamIdFilter !== "all";
  const teamList = teamsData?.teams || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Pipeline Forecasting</h1>
          <p className="text-muted-foreground">Conversion funnel, win-rate trends, and projected revenue</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-muted p-1 rounded-md">
            {(["WEEK", "MONTH", "QUARTER"] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? "default" : "ghost"}
                size="sm"
                onClick={() => setPeriod(p)}
                data-testid={`button-period-${p.toLowerCase()}`}
              >
                {p === "WEEK" ? "Week" : p === "MONTH" ? "Month" : "Quarter"}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Drill-down Filters */}
      {isLeadOrAbove && (
        <Card data-testid="card-filters">
          <CardContent className="p-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              {teamList.length > 0 && (
                <Select value={teamIdFilter} onValueChange={(v) => { setTeamIdFilter(v); setRepIdFilter("all"); }}>
                  <SelectTrigger className="w-44 h-8" data-testid="select-team-filter">
                    <SelectValue placeholder="All Teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {teamList.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={repIdFilter} onValueChange={setRepIdFilter}>
                <SelectTrigger className="w-44 h-8" data-testid="select-rep-filter">
                  <SelectValue placeholder="All Reps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Reps</SelectItem>
                  {repPerf?.reps.map(rep => (
                    <SelectItem key={rep.repId} value={rep.repId}>{rep.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {providerList.length > 0 && (
                <Select value={providerIdFilter} onValueChange={setProviderIdFilter}>
                  <SelectTrigger className="w-44 h-8" data-testid="select-provider-filter">
                    <SelectValue placeholder="All Providers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Providers</SelectItem>
                    {providerList.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 text-xs" data-testid="button-clear-filters">
                  Clear Filters
                </Button>
              )}
              {hasActiveFilters && (
                <Badge variant="secondary" className="text-xs">
                  Filtered view
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conversion Funnel */}
      <Card data-testid="card-conversion-funnel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Conversion Funnel
          </CardTitle>
          <CardDescription>Orders progressing from Sold to Paid commission</CardDescription>
        </CardHeader>
        <CardContent>
          {funnelLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : funnel ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                {funnel.funnel.map((stage, idx) => (
                  <div key={stage.stage} className="flex items-center gap-2">
                    <div className="text-center">
                      <div
                        className="text-2xl font-bold"
                        style={{ color: funnelStageColors[idx] }}
                        data-testid={`text-funnel-${stage.stage.toLowerCase()}`}
                      >
                        {stage.count}
                      </div>
                      <div className="text-xs text-muted-foreground">{stage.label}</div>
                    </div>
                    {idx < funnel.funnel.length - 1 && (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>

              <div className="relative h-8 bg-muted rounded-full overflow-hidden">
                {funnel.funnel.map((stage, idx) => {
                  const pct = funnel.funnel[0].count > 0 ? (stage.count / funnel.funnel[0].count) * 100 : 0;
                  return (
                    <div
                      key={stage.stage}
                      className="absolute top-0 bottom-0 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: funnelStageColors[idx],
                        opacity: 1 - idx * 0.15,
                      }}
                      data-testid={`bar-funnel-${stage.stage.toLowerCase()}`}
                    />
                  );
                })}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Install Rate</div>
                  <div className="font-bold text-lg" data-testid="text-install-rate">{funnel.metrics.installRate}%</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Approval Rate</div>
                  <div className="font-bold text-lg" data-testid="text-approval-rate">{funnel.metrics.approvalRate}%</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Total Commission</div>
                  <div className="font-bold text-lg text-green-600 dark:text-green-400" data-testid="text-total-commission">
                    {formatCurrency(funnel.metrics.totalCommission)}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Paid Commission</div>
                  <div className="font-bold text-lg text-blue-600 dark:text-blue-400" data-testid="text-paid-commission">
                    {formatCurrency(funnel.metrics.paidCommission)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">No funnel data available</p>
          )}
        </CardContent>
      </Card>

      {/* Win-Rate Trends */}
      <Card data-testid="card-win-rate-trends">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Win-Rate Trends
              </CardTitle>
              <CardDescription>Approval rates and revenue over time</CardDescription>
            </div>
            <Select value={trendMonths} onValueChange={setTrendMonths}>
              <SelectTrigger className="w-32" data-testid="select-trend-months">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 months</SelectItem>
                <SelectItem value="6">6 months</SelectItem>
                <SelectItem value="12">12 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {trendsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : trends && trends.trends.length > 0 ? (
            <div className="space-y-6">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">Win Rate (%)</div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={trends.trends}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip formatter={(val: any) => [`${parseFloat(val).toFixed(1)}%`, "Win Rate"]} />
                    <Line type="monotone" dataKey="winRate" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="Win Rate %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">Sales Volume</div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={trends.trends}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="sold" name="Sold" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="approved" name="Approved" fill="#6366f1" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {trends.projection && (
                <div className="border rounded-lg p-4 bg-primary/5">
                  <div className="text-sm font-medium mb-2">Projected Next Month ({trends.projection.month})</div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-xl font-bold" data-testid="text-projected-sold">{trends.projection.estimatedSold}</div>
                      <div className="text-xs text-muted-foreground">Est. Sales</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-primary" data-testid="text-projected-win-rate">{trends.projection.estimatedWinRate}%</div>
                      <div className="text-xs text-muted-foreground">Est. Win Rate</div>
                    </div>
                    <div>
                      <div className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-projected-revenue">
                        {formatCurrency(trends.projection.estimatedRevenue)}
                      </div>
                      <div className="text-xs text-muted-foreground">Est. Revenue</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">No trend data available</p>
          )}
        </CardContent>
      </Card>

      {/* Rep Performance Breakdown */}
      {repPerf && repPerf.reps.length > 0 && (
        <Card data-testid="card-rep-performance">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Rep Performance Breakdown
            </CardTitle>
            <CardDescription>Sales volume and approval rates by rep</CardDescription>
          </CardHeader>
          <CardContent>
            {repPerfLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left pb-2 font-medium">Rep</th>
                      <th className="text-right pb-2 font-medium">Sold</th>
                      <th className="text-right pb-2 font-medium">Approved</th>
                      <th className="text-right pb-2 font-medium">Rate</th>
                      <th className="text-right pb-2 font-medium">Commission</th>
                      <th className="text-right pb-2 font-medium">Avg Deal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repPerf.reps.slice(0, 15).map((rep) => (
                      <tr
                        key={rep.repId}
                        className={`border-b last:border-0 hover:bg-muted/30 cursor-pointer ${repIdFilter === rep.repId ? "bg-primary/5" : ""}`}
                        onClick={() => setRepIdFilter(repIdFilter === rep.repId ? "all" : rep.repId)}
                        data-testid={`row-rep-${rep.repId}`}
                      >
                        <td className="py-2 font-medium">{rep.name}</td>
                        <td className="py-2 text-right font-mono">{rep.sold}</td>
                        <td className="py-2 text-right font-mono">{rep.approved}</td>
                        <td className="py-2 text-right">
                          <Badge variant={parseFloat(rep.approvalRate) >= 60 ? "default" : "secondary"} className="text-xs">
                            {rep.approvalRate}%
                          </Badge>
                        </td>
                        <td className="py-2 text-right font-mono text-green-600 dark:text-green-400">{formatCurrency(rep.commission)}</td>
                        <td className="py-2 text-right font-mono text-muted-foreground">{formatCurrency(rep.avgDeal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-2">Click a rep row to drill down into their funnel data</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Link to coaching */}
      {["LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE"].includes(user?.role || "") && (
        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link href="/coaching-scorecards" data-testid="link-coaching-scorecards">
              View Coaching Scorecards
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
