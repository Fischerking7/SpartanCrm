import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Bell, TrendingUp, TrendingDown, Users, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";

function rateColor(rate: number) {
  if (rate >= 75) return "text-green-600 dark:text-green-400";
  if (rate >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function rateBg(rate: number) {
  if (rate >= 75) return "bg-green-500";
  if (rate >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const h = 24;
  const w = 60;
  const step = w / Math.max(data.length - 1, 1);
  const points = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-500" />
    </svg>
  );
}

export default function DirHome() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/director/scoreboard"],
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (!data) return <div className="p-6 text-center text-muted-foreground">No data available</div>;

  const { today, thisWeek, thisMonth, managerLeaderboard, alerts } = data;
  const weekSalesDelta = thisWeek.lastWeekSales > 0
    ? Math.round(((thisWeek.sales - thisWeek.lastWeekSales) / thisWeek.lastWeekSales) * 100)
    : 0;
  const monthProgress = thisMonth.salesTarget > 0
    ? Math.round((thisMonth.sales / thisMonth.salesTarget) * 100)
    : 0;
  const connectProgress = thisMonth.connectsTarget > 0
    ? Math.round((thisMonth.connects / thisMonth.connectsTarget) * 100)
    : 0;

  const noSalesAlerts = alerts.filter((a: any) => a.type === "no_sales");
  const lowRateAlerts = alerts.filter((a: any) => a.type === "low_connect_rate");
  const cbAlerts = alerts.filter((a: any) => a.type === "chargeback");

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="dir-home">
      <Card className="border-2">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Today's Numbers</p>
              <div className="flex items-center justify-center gap-6">
                <div>
                  <p className="text-3xl font-bold" data-testid="text-today-sales">{today.sales}</p>
                  <p className="text-xs text-muted-foreground">Sales</p>
                </div>
                <div>
                  <p className="text-3xl font-bold" data-testid="text-today-connects">{today.connects}</p>
                  <p className="text-xs text-muted-foreground">Connects</p>
                </div>
                <div>
                  <p className={`text-3xl font-bold ${rateColor(today.connectRate)}`} data-testid="text-today-rate">{today.connectRate}%</p>
                  <p className="text-xs text-muted-foreground">Connect Rate</p>
                </div>
              </div>
            </div>

            <div className="text-center space-y-2 border-l border-r px-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Week</p>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>Sales: <strong>{thisWeek.sales}</strong></span>
                  <span className="text-muted-foreground">vs last week: {thisWeek.lastWeekSales}</span>
                  <span className={`flex items-center gap-0.5 text-xs font-medium ${weekSalesDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {weekSalesDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {weekSalesDelta >= 0 ? "+" : ""}{weekSalesDelta}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Connects: <strong>{thisWeek.connects}</strong></span>
                  <span className="text-muted-foreground">vs last week: {thisWeek.lastWeekConnects}</span>
                </div>
              </div>
            </div>

            <div className="text-center space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Month</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Sales: <strong>{thisMonth.sales}</strong></span>
                  {thisMonth.salesTarget > 0 && (
                    <span className="text-muted-foreground">Target: {thisMonth.salesTarget} | Gap: {thisMonth.salesGap > 0 ? thisMonth.salesGap : 0}</span>
                  )}
                </div>
                {thisMonth.salesTarget > 0 && (
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(monthProgress, 100)}%` }} />
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span>Connects: <strong>{thisMonth.connects}</strong></span>
                  {thisMonth.connectsTarget > 0 && (
                    <span className="text-muted-foreground">Target: {thisMonth.connectsTarget} | Gap: {thisMonth.connectsGap > 0 ? thisMonth.connectsGap : 0}</span>
                  )}
                </div>
                {thisMonth.connectsTarget > 0 && (
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(connectProgress, 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Manager Leaderboard
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/director/production")} data-testid="link-view-production">
                  View All <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 w-10">#</th>
                      <th className="text-left p-3">Manager</th>
                      <th className="text-center p-3">Team</th>
                      <th className="text-right p-3">Sales</th>
                      <th className="text-right p-3">Connects</th>
                      <th className="text-right p-3">Rate</th>
                      <th className="text-center p-3">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managerLeaderboard.length === 0 && (
                      <tr><td colSpan={7} className="text-center p-6 text-muted-foreground">No managers in your organization</td></tr>
                    )}
                    {managerLeaderboard.map((m: any, i: number) => (
                      <tr
                        key={m.id}
                        className="border-b hover:bg-muted/30 cursor-pointer"
                        onClick={() => navigate("/director/production")}
                        data-testid={`row-manager-${m.id}`}
                      >
                        <td className="p-3 font-medium text-muted-foreground">{i + 1}</td>
                        <td className="p-3 font-medium">{m.name}</td>
                        <td className="p-3 text-center">{m.teamSize}</td>
                        <td className="p-3 text-right">{m.sales}</td>
                        <td className="p-3 text-right font-medium">{m.connects}</td>
                        <td className="p-3 text-right">
                          <span className={`font-medium ${rateColor(m.rate)}`}>{m.rate}%</span>
                        </td>
                        <td className="p-3 text-center">
                          <Sparkline data={m.sparkline} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Rep Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {alerts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No alerts - all reps performing well</p>
              )}

              {noSalesAlerts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase">No Sales in 7+ Days</p>
                  {noSalesAlerts.map((a: any, i: number) => (
                    <div key={`ns-${i}`} className="flex items-center justify-between p-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800" data-testid={`alert-no-sales-${i}`}>
                      <div>
                        <p className="text-sm font-medium">{a.repName}</p>
                        <p className="text-xs text-muted-foreground">{a.managerName} · {a.daysSinceLastSale}d since last sale</p>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0" data-testid={`button-notify-${a.repId}`}>
                        <Bell className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {lowRateAlerts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Connect Rate {"<"} 50%</p>
                  {lowRateAlerts.map((a: any, i: number) => (
                    <div key={`lr-${i}`} className="flex items-center justify-between p-2 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800" data-testid={`alert-low-rate-${i}`}>
                      <div>
                        <p className="text-sm font-medium">{a.repName}</p>
                        <p className="text-xs text-muted-foreground">{a.managerName} · {a.rate}% connect rate</p>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0" data-testid={`button-notify-rate-${a.repId}`}>
                        <Bell className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {cbAlerts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Open Chargebacks</p>
                  {cbAlerts.map((a: any, i: number) => (
                    <div key={`cb-${i}`} className="flex items-center justify-between p-2 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950 dark:border-orange-800" data-testid={`alert-chargeback-${i}`}>
                      <div>
                        <p className="text-sm font-medium">{a.repName}</p>
                        <p className="text-xs text-muted-foreground">{a.managerName}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="shrink-0" data-testid={`button-notify-cb-${a.repId}`}>
                        <Bell className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
