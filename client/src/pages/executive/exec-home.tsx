import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, AlertTriangle, Clock, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";

function cents(val: number) {
  return "$" + (val / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DeltaBadge({ value, label }: { value: number; label: string }) {
  const positive = value >= 0;
  return (
    <span className={`flex items-center gap-1 text-sm ${positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {positive ? "+" : ""}{value}% {label}
    </span>
  );
}

export default function ExecHome() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/executive/home-summary"] });

  if (isLoading) return (
    <div className="p-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );

  if (!data) return <div className="p-6 text-center text-muted-foreground">No data available</div>;

  const { revenue, profit, profitMargin, production, exceptions, cashFlow } = data;

  const criticalItems = [];
  if (exceptions.critical.negativeMarginOrders > 0) criticalItems.push(`Negative margin detected on ${exceptions.critical.negativeMarginOrders} orders`);
  if (exceptions.critical.overduePayRuns > 0) criticalItems.push(`Pay run overdue for finalization`);
  if (exceptions.critical.largeArVariance > 0 && exceptions.critical.largeArClient) criticalItems.push(`Large AR variance: ${cents(exceptions.critical.largeArVariance)} outstanding from ${exceptions.critical.largeArClient}`);

  const opsItems = [];
  if (exceptions.operational.pendingApprovals > 0) opsItems.push(`${exceptions.operational.pendingApprovals} orders pending approval`);
  if (exceptions.operational.pendingInstalls > 0) opsItems.push(`${exceptions.operational.pendingInstalls} installs to sync`);

  const finItems = [];
  if (exceptions.financial.pendingOverrides > 0) finItems.push(`${exceptions.financial.pendingOverrides} overrides pending approval`);
  if (exceptions.financial.draftStubs > 0) finItems.push(`${exceptions.financial.draftStubs} pay stubs in draft`);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="grid gap-4 md:grid-cols-3" data-testid="exec-kpi-grid">
        <Card className="border-2" data-testid="card-mtd-revenue">
          <CardContent className="p-6 text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">MTD Revenue</p>
            <p className="text-4xl font-bold font-mono mt-2" data-testid="text-mtd-revenue">{cents(revenue.mtdCents)}</p>
            <DeltaBadge value={revenue.deltaPercent} label="vs last month" />
          </CardContent>
        </Card>

        <Card className="border-2" data-testid="card-mtd-profit">
          <CardContent className="p-6 text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">MTD Profit</p>
            <p className="text-4xl font-bold font-mono mt-2" data-testid="text-mtd-profit">{cents(profit.mtdCents)}</p>
            <DeltaBadge value={profit.deltaPercent} label="vs last month" />
          </CardContent>
        </Card>

        <Card className="border-2" data-testid="card-profit-margin">
          <CardContent className="p-6 text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Profit Margin</p>
            <p className="text-4xl font-bold font-mono mt-2" data-testid="text-profit-margin">{profitMargin}%</p>
            <span className="text-sm text-muted-foreground">Target: 30%</span>
          </CardContent>
        </Card>
      </div>

      <div className="text-center text-sm text-muted-foreground" data-testid="text-production-summary">
        Production: <span className="font-semibold text-foreground">{production.connects}</span> connects | <span className="font-semibold text-foreground">{production.sold}</span> sold | <span className="font-semibold text-foreground">{production.rate}%</span> rate
      </div>

      <Card data-testid="card-exceptions">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Exception Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {criticalItems.length > 0 && (
            <div data-testid="section-critical-exceptions">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">Critical — Requires Executive Decision</p>
              <ul className="space-y-1.5">
                {criticalItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {opsItems.length > 0 && (
            <div data-testid="section-operational-exceptions">
              <p className="text-xs font-semibold uppercase tracking-wider text-yellow-600 dark:text-yellow-400 mb-2">Operational — Being Handled by Operations</p>
              <ul className="space-y-1.5">
                {opsItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Clock className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {finItems.length > 0 && (
            <div data-testid="section-financial-exceptions">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">Financial — Being Handled by Accounting</p>
              <ul className="space-y-1.5">
                {finItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <DollarSign className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {criticalItems.length === 0 && opsItems.length === 0 && finItems.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No active exceptions — all systems healthy</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-cash-flow">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cash Flow Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-green-500" />
                Received from carriers this month
              </span>
              <span className="font-mono font-semibold" data-testid="text-cash-received">{cents(cashFlow.receivedCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-red-500" />
                Paid to reps this month
              </span>
              <span className="font-mono font-semibold" data-testid="text-cash-paid">{cents(cashFlow.paidCents)}</span>
            </div>
            <div className="border-t pt-3 flex items-center justify-between">
              <span className="text-sm font-medium">Net cash position</span>
              <span className={`font-mono text-lg font-bold ${cashFlow.netCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-cash-net">
                {cents(cashFlow.netCents)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
