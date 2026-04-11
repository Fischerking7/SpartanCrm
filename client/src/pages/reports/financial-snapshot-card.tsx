import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, DollarSign, AlertCircle } from "lucide-react";

interface PeriodMetrics {
  grossRevenueCents: number;
  repPayoutsCents: number;
  overridePayoutsCents: number;
  ironCrestProfitCents: number;
  profitMargin: number;
  ordersCompleted: number;
  totalOrders: number;
  arReceivedCents: number;
  arOutstandingCents: number;
}

interface MonthOverMonth {
  grossRevenue: number;
  repPayouts: number;
  overridePayouts: number;
  ironCrestProfit: number;
  profitMargin: number;
  ordersCompleted: number;
  arReceived: number;
  arOutstanding: number;
}

interface PayrollObligations {
  nextPayRunEstimateCents: number;
  overridesPendingApprovalCents: number;
  advancesOutstandingCents: number;
  totalObligationCents: number;
  readyToPayCount: number;
}

interface ArHealth {
  collectionRate30d: number;
  openBalanceCents: number;
  overdueBalanceCents: number;
  avgDaysToCollection: number;
  riskClient: { name: string; outstandingCents: number; daysOverdue: number } | null;
}

interface FinancialSnapshotData {
  thisMonth: PeriodMetrics;
  lastMonth: PeriodMetrics;
  monthOverMonth: MonthOverMonth;
  payrollObligations: PayrollObligations;
  arHealth: ArHealth;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function MomBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="w-3 h-3" />0%</span>;
  if (pct > 0) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-green-600 font-medium">
      <TrendingUp className="w-3 h-3" />+{pct}%
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-red-500 font-medium">
      <TrendingDown className="w-3 h-3" />{pct}%
    </span>
  );
}

interface ComparisonRowProps {
  label: string;
  thisMonth: string | number;
  lastMonth: string | number;
  momPct: number;
  highlight?: boolean;
}

function ComparisonRow({ label, thisMonth, lastMonth, momPct, highlight }: ComparisonRowProps) {
  return (
    <div className={`grid grid-cols-4 gap-2 py-2 border-b last:border-0 items-center ${highlight ? "font-semibold" : ""}`}>
      <span className="col-span-1 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{thisMonth}</span>
      <span className="text-sm text-right text-muted-foreground">{lastMonth}</span>
      <div className="text-right"><MomBadge pct={momPct} /></div>
    </div>
  );
}

export default function FinancialSnapshotCard() {
  const { data, isLoading } = useQuery<FinancialSnapshotData>({
    queryKey: ["/api/executive/financial-snapshot"],
    queryFn: async () => {
      const res = await fetch("/api/executive/financial-snapshot", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load financial snapshot");
      return res.json();
    },
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { thisMonth, lastMonth, monthOverMonth: mom, payrollObligations, arHealth } = data;

  return (
    <div className="space-y-4" data-testid="financial-snapshot-card">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Month-over-Month Financial Comparison
          </CardTitle>
          <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground pt-1">
            <span></span>
            <span className="text-right font-medium">This Month</span>
            <span className="text-right">Last Month</span>
            <span className="text-right">Change</span>
          </div>
        </CardHeader>
        <CardContent>
          <ComparisonRow
            label="Gross Revenue"
            thisMonth={formatCents(thisMonth.grossRevenueCents)}
            lastMonth={formatCents(lastMonth.grossRevenueCents)}
            momPct={mom.grossRevenue}
            highlight
          />
          <ComparisonRow
            label="Rep Payouts"
            thisMonth={formatCents(thisMonth.repPayoutsCents)}
            lastMonth={formatCents(lastMonth.repPayoutsCents)}
            momPct={mom.repPayouts}
          />
          <ComparisonRow
            label="Override Payouts"
            thisMonth={formatCents(thisMonth.overridePayoutsCents)}
            lastMonth={formatCents(lastMonth.overridePayoutsCents)}
            momPct={mom.overridePayouts}
          />
          <ComparisonRow
            label="IronCrest Profit"
            thisMonth={formatCents(thisMonth.ironCrestProfitCents)}
            lastMonth={formatCents(lastMonth.ironCrestProfitCents)}
            momPct={mom.ironCrestProfit}
            highlight
          />
          <ComparisonRow
            label="Profit Margin"
            thisMonth={`${thisMonth.profitMargin}%`}
            lastMonth={`${lastMonth.profitMargin}%`}
            momPct={mom.profitMargin}
          />
          <ComparisonRow
            label="Orders Connected"
            thisMonth={thisMonth.ordersCompleted}
            lastMonth={lastMonth.ordersCompleted}
            momPct={mom.ordersCompleted}
          />
          <ComparisonRow
            label="AR Received"
            thisMonth={formatCents(thisMonth.arReceivedCents)}
            lastMonth={formatCents(lastMonth.arReceivedCents)}
            momPct={mom.arReceived}
          />
          <ComparisonRow
            label="AR Outstanding"
            thisMonth={formatCents(thisMonth.arOutstandingCents)}
            lastMonth={formatCents(lastMonth.arOutstandingCents)}
            momPct={mom.arOutstanding}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-payroll-obligations">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Payroll Obligations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-sm text-muted-foreground">Next Pay Run Est.</span>
              <span className="text-sm font-medium" data-testid="text-next-pay-run">{formatCents(payrollObligations.nextPayRunEstimateCents)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-sm text-muted-foreground">Overrides Pending Approval</span>
              <span className="text-sm font-medium" data-testid="text-overrides-pending">{formatCents(payrollObligations.overridesPendingApprovalCents)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-sm text-muted-foreground">Advances Outstanding</span>
              <span className="text-sm font-medium" data-testid="text-advances-outstanding">{formatCents(payrollObligations.advancesOutstandingCents)}</span>
            </div>
            <div className="flex justify-between py-2 bg-muted/30 rounded px-2">
              <span className="text-sm font-semibold">Total Obligation</span>
              <span className="text-sm font-bold" data-testid="text-total-obligation">{formatCents(payrollObligations.totalObligationCents)}</span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-ar-health">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">AR Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-sm text-muted-foreground">Collection Rate (30d)</span>
              <Badge
                variant={arHealth.collectionRate30d >= 90 ? "default" : arHealth.collectionRate30d >= 70 ? "secondary" : "destructive"}
                data-testid="badge-collection-rate"
              >
                {arHealth.collectionRate30d}%
              </Badge>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-sm text-muted-foreground">Avg Days to Collection</span>
              <span className="text-sm font-medium" data-testid="text-avg-days-collection">{arHealth.avgDaysToCollection} days</span>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-sm text-muted-foreground">Open Balance</span>
              <span className="text-sm font-medium" data-testid="text-open-balance">{formatCents(arHealth.openBalanceCents)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b">
              <span className="text-sm text-muted-foreground">Overdue Balance</span>
              <span className={`text-sm font-medium ${arHealth.overdueBalanceCents > 0 ? "text-red-500" : ""}`} data-testid="text-overdue-balance">
                {formatCents(arHealth.overdueBalanceCents)}
              </span>
            </div>
            {arHealth.riskClient && (
              <div className="p-2 rounded border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <span className="font-medium">{arHealth.riskClient.name}</span>
                  <span className="text-muted-foreground"> — {formatCents(arHealth.riskClient.outstandingCents)} overdue ({arHealth.riskClient.daysOverdue}d)</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
