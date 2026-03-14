import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

function cents(val: number) {
  return "$" + (val / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ComparisonRow({ label, thisCents, lastCents }: { label: string; thisCents: number; lastCents: number }) {
  const delta = lastCents > 0 ? Math.round(((thisCents - lastCents) / lastCents) * 100) : 0;
  const positive = delta >= 0;
  return (
    <tr className="border-b last:border-b-0">
      <td className="py-3 text-sm">{label}</td>
      <td className="py-3 font-mono text-sm text-right">{cents(thisCents)}</td>
      <td className="py-3 font-mono text-sm text-right text-muted-foreground">{cents(lastCents)}</td>
      <td className="py-3 text-right">
        <span className={`inline-flex items-center gap-1 text-xs ${positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {positive ? "+" : ""}{delta}%
        </span>
      </td>
    </tr>
  );
}

export default function ExecFinancials() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/executive/financial-snapshot"] });

  if (isLoading) return (
    <div className="p-6 space-y-6">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-60 w-full" />)}
    </div>
  );

  if (!data) return <div className="p-6 text-center text-muted-foreground">No data available</div>;

  const { periodComparison, profitByService, profitByManager, payrollObligations, arHealth } = data;
  const { thisMonth: tm, lastMonth: lm } = periodComparison;

  const maxServiceProfit = Math.max(...profitByService.map((s: any) => s.profitCents), 1);
  const maxMgrProfit = Math.max(...profitByManager.map((m: any) => m.profitCents), 1);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <Card data-testid="card-period-comparison">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Period Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full" data-testid="table-period-comparison">
            <thead>
              <tr className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                <th className="py-2 text-left font-medium">Metric</th>
                <th className="py-2 text-right font-medium">This Month</th>
                <th className="py-2 text-right font-medium">Last Month</th>
                <th className="py-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              <ComparisonRow label="Revenue (Rack Rate)" thisCents={tm.revenueCents} lastCents={lm.revenueCents} />
              <ComparisonRow label="Rep Payouts" thisCents={tm.repPayoutsCents} lastCents={lm.repPayoutsCents} />
              <ComparisonRow label="Override Payouts" thisCents={tm.overridePayoutsCents} lastCents={lm.overridePayoutsCents} />
              <ComparisonRow label="Iron Crest Profit" thisCents={tm.profitCents} lastCents={lm.profitCents} />
              <tr>
                <td className="py-3 text-sm font-medium">Profit Margin</td>
                <td className="py-3 font-mono text-sm text-right font-medium">{tm.profitMargin}%</td>
                <td className="py-3 font-mono text-sm text-right text-muted-foreground">{lm.profitMargin}%</td>
                <td className="py-3 text-right">
                  <span className={`text-xs ${tm.profitMargin >= lm.profitMargin ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {tm.profitMargin >= lm.profitMargin ? "+" : ""}{tm.profitMargin - lm.profitMargin}pp
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="card-profit-by-service">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Profit by Service</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profitByService.length === 0 && <p className="text-sm text-muted-foreground">No service data</p>}
            {profitByService.map((svc: any) => {
              const margin = svc.rackRateCents > 0 ? Math.round((svc.profitCents / svc.rackRateCents) * 100) : 0;
              const barColor = margin >= 30 ? "bg-green-500" : margin >= 15 ? "bg-yellow-500" : "bg-red-500";
              return (
                <div key={svc.name} data-testid={`bar-service-${svc.name}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm truncate">{svc.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{cents(svc.profitCents)}</span>
                      <Badge variant="outline" className="text-xs">{margin}%</Badge>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(2, (svc.profitCents / maxServiceProfit) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card data-testid="card-profit-by-manager">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Profit by Manager</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profitByManager.length === 0 && <p className="text-sm text-muted-foreground">No manager data</p>}
            {profitByManager.map((mgr: any) => {
              const margin = mgr.rackRateCents > 0 ? Math.round((mgr.profitCents / mgr.rackRateCents) * 100) : 0;
              return (
                <div key={mgr.id} data-testid={`bar-manager-${mgr.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm truncate">{mgr.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{cents(mgr.profitCents)}</span>
                      <Badge variant="outline" className="text-xs">{mgr.orderCount} orders</Badge>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(2, (mgr.profitCents / maxMgrProfit) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="card-payroll-obligations">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payroll Obligations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Ready-to-pay orders</span>
                <span className="font-mono" data-testid="text-ready-to-pay">
                  {cents(payrollObligations.readyToPayCents)} <span className="text-muted-foreground text-xs">({payrollObligations.readyToPayCount})</span>
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Override earnings approved</span>
                <span className="font-mono" data-testid="text-override-approved">{cents(payrollObligations.overrideApprovedCents)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Advances outstanding</span>
                <span className="font-mono" data-testid="text-advances">{cents(payrollObligations.advancesOutstandingCents)}</span>
              </div>
              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-sm font-medium">Total obligation</span>
                <span className="font-mono font-bold" data-testid="text-total-obligation">{cents(payrollObligations.totalObligationCents)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ar-health">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">AR Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Collection rate (30 days)</span>
                <span className={`font-mono font-semibold ${arHealth.collectionRate >= 90 ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400"}`} data-testid="text-collection-rate">
                  {arHealth.collectionRate}%
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Overdue from carriers</span>
                <span className="font-mono" data-testid="text-overdue-ar">{cents(arHealth.overdueCents)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Average days to collect</span>
                <span className="font-mono" data-testid="text-avg-days">{arHealth.avgDaysToCollect} days</span>
              </div>
              {arHealth.riskClient && (
                <div className="border-t pt-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm" data-testid="text-risk-client">
                    <span className="font-medium">{arHealth.riskClient.name}</span> — {cents(arHealth.riskClient.outstandingCents)} overdue {arHealth.riskClient.daysOverdue} days
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
