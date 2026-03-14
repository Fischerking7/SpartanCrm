import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import {
  DollarSign, TrendingUp, AlertTriangle, ArrowRight, Wallet, Shield, Landmark, Clock
} from "lucide-react";

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function AcctHome() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/accounting/home-summary"] });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-80" />)}
      </div>
    );
  }

  const mi = data?.moneyIn || {};
  const mo = data?.moneyOut || {};
  const np = data?.netPosition || {};

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-home">
      <h1 className="text-xl font-semibold" data-testid="text-acct-title">Accounting Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-money-in">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-green-600" />
              Carrier Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Expected</span>
                <span className="font-medium" data-testid="text-ar-expected">{fmt(mi.totalExpectedCents || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Received</span>
                <span className="font-medium text-green-600" data-testid="text-ar-received">{fmt(mi.totalReceivedCents || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Outstanding</span>
                <span className={`font-medium ${(mi.outstandingCents || 0) > 0 ? "text-red-600" : ""}`} data-testid="text-ar-outstanding">
                  {fmt(mi.outstandingCents || 0)}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Collection Rate</span>
                <span className="font-medium" data-testid="text-collection-rate">{mi.collectionRate || 0}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 mt-1">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(mi.collectionRate || 0, 100)}%` }}
                />
              </div>
            </div>

            {(mi.overdueCount || 0) > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{mi.overdueCount} overdue expectations</span>
              </div>
            )}

            <Button variant="outline" size="sm" className="w-full" onClick={() => setLocation("/accounting/ar")} data-testid="button-view-ar">
              View AR <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-money-out">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-blue-600" />
              Payroll Obligations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payroll-Ready Orders</span>
                <span className="font-medium" data-testid="text-payroll-ready">
                  {mo.payrollReadyOrders || 0} / {fmt(mo.payrollReadyTotalCents || 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Overrides Pending</span>
                <span className="font-medium" data-testid="text-overrides-pending">
                  {mo.pendingOverrides || 0} / {fmt(mo.pendingOverrideTotalCents || 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Next Pay Run</span>
                <span className="font-medium" data-testid="text-next-pay-run">
                  {mo.nextScheduledRun ? new Date(mo.nextScheduledRun).toLocaleDateString() : "None scheduled"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Draft Pay Runs</span>
                <span className="font-medium" data-testid="text-draft-runs">{mo.draftPayRuns || 0}</span>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <Button size="sm" className="w-full" onClick={() => setLocation("/accounting/pay-runs")} data-testid="button-build-pay-run">
                Build Pay Run
              </Button>
              <Button variant="outline" size="sm" className="w-full" onClick={() => setLocation("/accounting/pay-runs")} data-testid="button-view-pay-runs">
                View Pay Runs <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-net-position">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-purple-600" />
              Period Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cash Received</span>
                <span className="font-medium text-green-600" data-testid="text-cash-received">{fmt(np.cashReceivedCents || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payroll Processed</span>
                <span className="font-medium" data-testid="text-payroll-processed">{fmt(np.payrollProcessedCents || 0)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium pt-1 border-t">
                <span>Net Position</span>
                <span className={(np.netPositionCents || 0) >= 0 ? "text-green-600" : "text-red-600"} data-testid="text-net-position">
                  {fmt(np.netPositionCents || 0)}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Iron Crest Profit MTD</span>
                <span className="font-medium" data-testid="text-profit-mtd">{fmt(np.profitMtdCents || 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Profit Margin</span>
                <span className="font-medium" data-testid="text-profit-margin">{np.profitMargin || 0}%</span>
              </div>
            </div>

            <div className="pt-2 border-t space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Pending Actions</p>
              {(np.pendingOverrides || 0) > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="h-3.5 w-3.5 text-amber-500" />
                  <span>{np.pendingOverrides} overrides awaiting approval</span>
                </div>
              )}
              {(np.pendingAdvances || 0) > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Landmark className="h-3.5 w-3.5 text-amber-500" />
                  <span>{np.pendingAdvances} advances awaiting approval</span>
                </div>
              )}
              {(np.missingTaxProfiles || 0) > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                  <span>{np.missingTaxProfiles} tax profiles missing</span>
                </div>
              )}
              {!np.pendingOverrides && !np.pendingAdvances && !np.missingTaxProfiles && (
                <p className="text-sm text-green-600">All clear — no pending actions</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
