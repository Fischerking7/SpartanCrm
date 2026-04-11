import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Target, Flame, Trophy, BarChart2, Zap, ArrowUp, ArrowDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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

  const streakEmoji = data.currentStreak >= 7 ? "🔥" : data.currentStreak >= 3 ? "⚡" : "";

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-lg md:text-2xl font-bold" data-testid="text-performance-title">My Performance</h1>
        <p className="text-sm text-muted-foreground">Track your sales metrics and goals</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          title="MTD Sales"
          value={data.mtd.sold}
          subtitle={`${data.mtd.connected} connected`}
          icon={BarChart2}
          trend={data.mtd.monthOverMonthDelta}
        />
        <MetricCard
          title="MTD Earned"
          value={`$${data.mtd.earned.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          subtitle={`Prev: $${data.prevMonth.earned.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          icon={TrendingUp}
        />
        <MetricCard
          title="Connect Rate"
          value={`${data.mtd.connectRate}%`}
          subtitle={`${data.mtd.connected} of ${data.mtd.sold} sold`}
          icon={Target}
        />
        <MetricCard
          title="This Week"
          value={data.weekly.connected}
          subtitle={`$${data.weekly.earned.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} earned`}
          icon={Zap}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        {data.goals.monthly && (
          <Card>
            <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-[hsl(var(--sidebar-primary))]" />
                Monthly Goal
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-4">
              <div className="flex items-end justify-between mb-2">
                <span className="text-xl md:text-2xl font-bold">{data.goals.monthly.current}</span>
                <span className="text-sm text-muted-foreground">of {data.goals.monthly.target}</span>
              </div>
              <Progress value={Math.min(data.goals.monthly.percentage, 100)} className="h-2" />
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                {data.goals.monthly.percentage}% complete
                {data.goals.monthly.percentage >= 100 && " — Goal reached!"}
              </p>
            </CardContent>
          </Card>
        )}

        {data.goals.weekly && (
          <Card>
            <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-500" />
                Weekly Goal
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-4">
              <div className="flex items-end justify-between mb-2">
                <span className="text-xl md:text-2xl font-bold">{data.goals.weekly.current}</span>
                <span className="text-sm text-muted-foreground">of {data.goals.weekly.target}</span>
              </div>
              <Progress value={Math.min(data.goals.weekly.percentage, 100)} className="h-2" />
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                {data.goals.weekly.percentage}% complete
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              Streak & Ranking
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-4 space-y-3">
            <div>
              <p className="text-sm text-muted-foreground">Daily Selling Streak</p>
              <p className="text-xl md:text-2xl font-bold">
                {data.currentStreak} day{data.currentStreak !== 1 ? "s" : ""} {streakEmoji}
              </p>
            </div>
            {data.ranking && (
              <div>
                <p className="text-sm text-muted-foreground">MTD Ranking</p>
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-[hsl(var(--sidebar-primary))]" />
                  <span className="text-xl md:text-2xl font-bold">#{data.ranking.rank}</span>
                  <span className="text-sm text-muted-foreground">of {data.ranking.total} reps</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="px-3 pt-3 pb-2 md:px-6 md:pt-6 md:pb-2">
          <CardTitle className="text-xs md:text-sm">Last 7 Days</CardTitle>
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
                    return d.toLocaleDateString("en-US", { weekday: "short" });
                  }}
                />
                <YAxis tick={{ fontSize: isMobile ? 10 : 12 }} allowDecimals={false} />
                <Tooltip
                  labelFormatter={v => {
                    const d = new Date(v + "T12:00:00");
                    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  }}
                />
                <Bar dataKey="sold" name="Sold" fill="hsl(var(--sidebar-primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="connected" name="Connected" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
