import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Target, Flame, Trophy, BarChart2, Zap, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PayPeriodTrend {
  periodStart: string;
  periodEnd: string;
  grossCommission: number;
  netPay: number;
  deductions: number;
  status: string;
  ordersSold: number;
  ordersConnected: number;
  connectionRate: number;
  chargebacks: number;
  rank: number;
  totalReps: number;
}

interface PerformanceData {
  mtd: { sold: number; connected: number; earned: number; connectRate: number; monthOverMonthDelta: number };
  prevMonth: { connected: number; earned: number };
  weekly: { sold: number; connected: number; earned: number };
  goals: {
    monthly: { target: number; current: number; percentage: number } | null;
    weekly: { target: number; current: number; percentage: number } | null;
  };
  dailyChart: Array<{ date: string; sold: number; connected: number }>;
  currentStreak: number;
  ranking: { rank: number; total: number } | null;
  payPeriodTrends: PayPeriodTrend[];
  mtdChargebacks: number;
}

function MetricCard({ title, value, subtitle, icon: Icon, trend, trendLabel, className }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: number;
  trendLabel?: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="px-3 pt-3 md:px-6 md:pt-6 pb-3 md:pb-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs md:text-sm text-muted-foreground">{title}</p>
            <p className="text-lg md:text-2xl font-bold mt-0.5">{value}</p>
            {subtitle && <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
            {trend !== undefined && (
              <div className="flex items-center gap-1 mt-1">
                {trend >= 0 ? (
                  <ArrowUp className="h-3 w-3 text-green-600" />
                ) : (
                  <ArrowDown className="h-3 w-3 text-red-600" />
                )}
                <span className={`text-[10px] md:text-xs font-medium ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {Math.abs(trend)}% {trendLabel || "vs last month"}
                </span>
              </div>
            )}
          </div>
          <div className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            <Icon className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyPerformance() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";

  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/my/performance"],
    queryFn: async () => {
      const res = await fetch("/api/my/performance", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch performance");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-lg md:text-2xl font-bold" data-testid="text-performance-title">{t("performance.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("performance.dailyActivity")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title={t("performance.mtdSold")}
          value={data.mtd.sold}
          subtitle={`${data.mtd.connected} ${t("performance.connected").toLowerCase()}`}
          icon={BarChart2}
          trend={data.mtd.monthOverMonthDelta}
          trendLabel={t("performance.vsLastMonth")}
        />
        <MetricCard
          title={t("performance.mtdEarned")}
          value={new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(data.mtd.earned)}
          subtitle={t("performance.prevEarned", { amount: new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(data.prevMonth.earned) })}
          icon={TrendingUp}
        />
        <MetricCard
          title={t("performance.connectRate")}
          value={`${data.mtd.connectRate}%`}
          subtitle={t("performance.ofSold", { connected: data.mtd.connected, sold: data.mtd.sold })}
          icon={Target}
        />
        <MetricCard
          title={t("performance.weeklyConnected")}
          value={data.weekly.connected}
          subtitle={`${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(data.weekly.earned)} ${t("commissions.earned").toLowerCase()}`}
          icon={Zap}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {data.goals.monthly && (
          <Card>
            <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-[hsl(var(--sidebar-primary))]" />
                {t("performance.monthlyGoal")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-4">
              <div className="flex items-end justify-between mb-2">
                <span className="text-xl md:text-2xl font-bold">{data.goals.monthly.current}</span>
                <span className="text-sm text-muted-foreground">{t("performance.ofTarget", { target: data.goals.monthly.target })}</span>
              </div>
              <Progress value={Math.min(data.goals.monthly.percentage, 100)} className="h-2" />
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                {data.goals.monthly.percentage >= 100
                  ? t("performance.goalReached", { pct: data.goals.monthly.percentage })
                  : t("performance.percentComplete", { pct: data.goals.monthly.percentage })}
              </p>
            </CardContent>
          </Card>
        )}

        {data.goals.weekly && (
          <Card>
            <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-500" />
                {t("performance.weeklyGoal")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-4">
              <div className="flex items-end justify-between mb-2">
                <span className="text-xl md:text-2xl font-bold">{data.goals.weekly.current}</span>
                <span className="text-sm text-muted-foreground">{t("performance.ofTarget", { target: data.goals.weekly.target })}</span>
              </div>
              <Progress value={Math.min(data.goals.weekly.percentage, 100)} className="h-2" />
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                {data.goals.weekly.percentage >= 100
                  ? t("performance.goalReached", { pct: data.goals.weekly.percentage })
                  : t("performance.percentComplete", { pct: data.goals.weekly.percentage })}
              </p>
            </CardContent>
          </Card>
        )}

        {data.ranking && (
          <Card>
            <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm flex items-center gap-2">
                <Trophy className="h-4 w-4 text-[hsl(var(--sidebar-primary))]" />
                {t("performance.ranking")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl md:text-2xl font-bold">#{data.ranking.rank}</span>
                <span className="text-sm text-muted-foreground">{t("performance.ofReps", { total: data.ranking.total })}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          title={t("performance.chargebacks")}
          value={new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(data.mtdChargebacks)}
          icon={AlertTriangle}
          className={data.mtdChargebacks > 0 ? "border-red-200 dark:border-red-900" : ""}
        />
        <MetricCard
          title={t("performance.currentStreak")}
          value={`${data.currentStreak} ${t("performance.days")}`}
          icon={Flame}
        />
      </div>

      <Card>
        <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
          <CardTitle className="text-xs md:text-sm">{t("performance.dailyActivity")}</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 md:px-6 md:pb-4">
          <div className={`${isMobile ? "h-48" : "h-64"}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.dailyChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: isMobile ? 10 : 12 }}
                  tickFormatter={v => {
                    const d = new Date(v + "T12:00:00");
                    return d.toLocaleDateString(locale, { weekday: "short" });
                  }}
                />
                <YAxis tick={{ fontSize: isMobile ? 10 : 12 }} allowDecimals={false} />
                <Tooltip
                  labelFormatter={v => {
                    const d = new Date(v + "T12:00:00");
                    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
                  }}
                />
                <Bar dataKey="sold" name={t("performance.sold")} fill="hsl(var(--sidebar-primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="connected" name={t("performance.connected")} fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {data.payPeriodTrends.length > 0 && (
        <Card>
          <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[hsl(var(--sidebar-primary))]" />
              {t("performance.payPeriodTrends")} {t("performance.lastNPeriods", { count: data.payPeriodTrends.length })}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-4">
            <div className={`${isMobile ? "h-48" : "h-64"} mb-4`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.payPeriodTrends}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="periodEnd"
                    tick={{ fontSize: isMobile ? 9 : 12 }}
                    tickFormatter={v => {
                      const d = new Date(v + "T12:00:00");
                      return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
                    }}
                  />
                  <YAxis tick={{ fontSize: isMobile ? 10 : 12 }} tickFormatter={v => `$${v}`} />
                  <Tooltip
                    labelFormatter={v => {
                      const d = new Date(v + "T12:00:00");
                      return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
                    }}
                    formatter={(value: number) => [`$${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, undefined]}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="grossCommission" name={t("payHistory.grossCommission")} stroke="hsl(var(--sidebar-primary))" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="netPay" name={t("payHistory.netPay")} stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="deductions" name={t("payHistory.deductions")} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("earningsSimulator.periodStart")}</TableHead>
                    <TableHead className="text-right">{t("performance.sold")}</TableHead>
                    <TableHead className="text-right">{t("performance.connected")}</TableHead>
                    <TableHead className="text-right">{t("performance.connectRate")}</TableHead>
                    <TableHead className="text-right">{t("payHistory.grossCommission")}</TableHead>
                    <TableHead className="text-right">{t("payHistory.netPay")}</TableHead>
                    {!isMobile && <TableHead className="text-right">{t("performance.chargebacks")}</TableHead>}
                    {!isMobile && <TableHead className="text-center">{t("performance.ranking")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payPeriodTrends.map((p, i) => {
                    const prev = i > 0 ? data.payPeriodTrends[i - 1] : null;
                    const netDelta = prev ? p.netPay - prev.netPay : 0;
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(p.periodStart + "T12:00:00").toLocaleDateString(locale, { month: "short", day: "numeric" })} - {new Date(p.periodEnd + "T12:00:00").toLocaleDateString(locale, { month: "short", day: "numeric" })}
                        </TableCell>
                        <TableCell className="text-right">{p.ordersSold}</TableCell>
                        <TableCell className="text-right">{p.ordersConnected}</TableCell>
                        <TableCell className="text-right">{p.connectionRate}%</TableCell>
                        <TableCell className="text-right text-green-600 dark:text-green-400">{new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(p.grossCommission)}</TableCell>
                        <TableCell className="text-right font-semibold">
                          <span>{new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(p.netPay)}</span>
                          {prev && netDelta !== 0 && (
                            <span className={`ml-1 text-[10px] ${netDelta > 0 ? "text-green-600" : "text-red-600"}`}>
                              {netDelta > 0 ? "+" : ""}{Math.round(netDelta)}
                            </span>
                          )}
                        </TableCell>
                        {!isMobile && <TableCell className={`text-right ${p.chargebacks > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(p.chargebacks)}</TableCell>}
                        {!isMobile && <TableCell className="text-center">
                          <Badge variant="outline" className="text-[10px]">#{p.rank}/{p.totalReps}</Badge>
                        </TableCell>}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
