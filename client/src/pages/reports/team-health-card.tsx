import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingUp, TrendingDown, Users, CheckCircle } from "lucide-react";

interface TeamHealthMetrics {
  connectRate7d: number;
  connectRateTarget: number;
  avgDaysToApproval: number;
  pendingApprovals: number;
  openChargebacks: number;
  repsWithNoSales7d: number;
  repsWithOpenDisputes: number;
}

interface RepAlert {
  id: string;
  name: string;
  repId: string;
  alerts: string[];
}

interface RepSummary {
  id: string;
  name: string;
  repId: string;
  sales7d: number;
  connectRate7d: number;
  alerts?: string[];
}

interface TeamHealthData {
  overallScore: number;
  scoreLabel: "Healthy" | "At Risk" | "Critical";
  metrics: TeamHealthMetrics;
  repAlerts: RepAlert[];
  topPerformers: RepSummary[];
  needsAttention: RepSummary[];
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const arc = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1" data-testid="gauge-team-health-score">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r={radius} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/20" />
          <circle
            cx="64" cy="64" r={radius} fill="none"
            stroke={color} strokeWidth="10"
            strokeDasharray={`${arc} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      <Badge
        variant={label === "Healthy" ? "default" : label === "At Risk" ? "secondary" : "destructive"}
        data-testid="badge-health-label"
      >
        {label}
      </Badge>
    </div>
  );
}

function MetricRow({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${alert ? "text-red-500" : ""}`}>{value}</span>
    </div>
  );
}

export default function TeamHealthCard() {
  const { data, isLoading } = useQuery<TeamHealthData>({
    queryKey: ["/api/my/team-health"],
    queryFn: async () => {
      const res = await fetch("/api/my/team-health", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load team health");
      return res.json();
    },
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!data) return null;

  const { overallScore, scoreLabel, metrics, repAlerts, topPerformers, needsAttention } = data;

  return (
    <div className="space-y-4" data-testid="team-health-card">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1 flex flex-col items-center justify-center p-6">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Team Health Score</h2>
          <ScoreGauge score={overallScore} label={scoreLabel} />
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Breakdown Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <MetricRow
              label="Connect Rate (7d)"
              value={`${metrics.connectRate7d}% (target: ${metrics.connectRateTarget}%)`}
              alert={metrics.connectRate7d < 60}
            />
            <MetricRow
              label="Avg Days to Approval"
              value={`${metrics.avgDaysToApproval.toFixed(1)} days`}
              alert={metrics.avgDaysToApproval > 3}
            />
            <MetricRow
              label="Pending Approvals"
              value={metrics.pendingApprovals}
              alert={metrics.pendingApprovals > 0}
            />
            <MetricRow
              label="Open Chargebacks"
              value={metrics.openChargebacks}
              alert={metrics.openChargebacks > 0}
            />
            <MetricRow
              label="Reps w/ No Sales (7d)"
              value={metrics.repsWithNoSales7d}
              alert={metrics.repsWithNoSales7d > 0}
            />
            <MetricRow
              label="Reps w/ Open Disputes"
              value={metrics.repsWithOpenDisputes}
              alert={metrics.repsWithOpenDisputes > 0}
            />
          </CardContent>
        </Card>
      </div>

      {repAlerts.length > 0 && (
        <Card data-testid="card-rep-alerts">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              Rep Alerts ({repAlerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {repAlerts.map(rep => (
              <div key={rep.id} className="flex items-start justify-between p-2.5 rounded-md border bg-yellow-50/50 dark:bg-yellow-900/10" data-testid={`alert-rep-${rep.repId}`}>
                <div>
                  <span className="font-medium text-sm">{rep.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{rep.repId}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {rep.alerts.map((a, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{a}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-top-performers">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-500" />
              Top Performers (7d)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topPerformers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data available</p>
            ) : topPerformers.map((rep, i) => (
              <div key={rep.id} className="flex items-center justify-between" data-testid={`row-top-${rep.repId}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                  <div>
                    <span className="text-sm font-medium">{rep.name}</span>
                    <span className="text-xs text-muted-foreground ml-1">{rep.repId}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-green-600">{rep.connectRate7d}%</span>
                  <span className="text-xs text-muted-foreground ml-1">({rep.sales7d} sales)</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="card-needs-attention">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Needs Attention (7d)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsAttention.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle className="w-4 h-4" />
                All reps performing well
              </div>
            ) : needsAttention.map((rep) => (
              <div key={rep.id} className="flex items-center justify-between" data-testid={`row-attention-${rep.repId}`}>
                <div>
                  <span className="text-sm font-medium">{rep.name}</span>
                  <span className="text-xs text-muted-foreground ml-1">{rep.repId}</span>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-medium ${rep.sales7d === 0 ? "text-red-500" : rep.connectRate7d < 60 ? "text-yellow-500" : "text-muted-foreground"}`}>
                    {rep.sales7d === 0 ? "0 sales" : `${rep.connectRate7d}%`}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
