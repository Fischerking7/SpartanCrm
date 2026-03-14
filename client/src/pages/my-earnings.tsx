import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Download, FileText } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";

function formatCurrency(v: number) {
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MyEarnings() {
  const [, setLocation] = useLocation();

  const { data: earnings, isLoading: earningsLoading } = useQuery<any>({
    queryKey: ["/api/my/earnings"],
  });

  const { data: statementsData, isLoading: statementsLoading } = useQuery<any>({
    queryKey: ["/api/payroll/my-statements"],
  });

  const statements = Array.isArray(statementsData) ? statementsData : statementsData?.statements || [];

  const downloadPdf = async (id: string) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/payroll/my-statements/${id}/pdf`, { headers });
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paystub-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PDF download error:", e);
    }
  };

  const maxBarValue = earnings?.monthlyHistory?.reduce((max: number, m: any) => Math.max(max, m.netPaid), 0) || 1;

  return (
    <div className="p-4 max-w-lg mx-auto pb-20" data-testid="my-earnings-page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setLocation("/")} className="p-1" data-testid="button-back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">My Earnings</h1>
      </div>

      <Tabs defaultValue="period">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="period" data-testid="tab-period">This Period</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
          <TabsTrigger value="stubs" data-testid="tab-stubs">Pay Stubs</TabsTrigger>
        </TabsList>

        <TabsContent value="period" className="mt-4 space-y-4">
          {earningsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : earnings ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">{earnings.period.label}</p>
              <Card className="rounded-xl">
                <CardContent className="p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Gross Commission</span>
                    <span className="font-medium">{formatCurrency(earnings.currentPeriod.grossCommission)}</span>
                  </div>
                  {earnings.currentPeriod.overridesEarned > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Overrides Earned</span>
                      <span className="font-medium">{formatCurrency(earnings.currentPeriod.overridesEarned)}</span>
                    </div>
                  )}
                  {earnings.currentPeriod.chargebacks > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-red-600 dark:text-red-400">Chargebacks</span>
                      <span className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(earnings.currentPeriod.chargebacks)}</span>
                    </div>
                  )}
                  <div className="border-t pt-3 flex justify-between items-center">
                    <span className="font-semibold">Estimated Net</span>
                    <span className="text-xl font-bold">{formatCurrency(earnings.currentPeriod.estimatedNet)}</span>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground text-center italic">
                Estimates until your pay stub is issued
              </p>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-sm text-muted-foreground">Orders this period</p>
                <p className="text-2xl font-bold">{earnings.currentPeriod.orderCount}</p>
              </div>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          {earningsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : earnings?.monthlyHistory ? (
            <>
              <div className="flex items-end gap-1 h-36" data-testid="earnings-chart">
                {earnings.monthlyHistory.map((m: any, i: number) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-foreground/80 rounded-t-sm transition-all"
                      style={{ height: `${Math.max(2, (m.netPaid / maxBarValue) * 100)}%` }}
                      title={`${m.month}: ${formatCurrency(m.netPaid)}`}
                    />
                    <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                      {m.month.split(" ")[0].slice(0, 3)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {earnings.monthlyHistory.slice().reverse().map((m: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-muted/50">
                    <span className="text-sm font-medium">{m.month}</span>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{m.orders} orders</span>
                      <span>{m.connects} connects</span>
                      <span className="font-medium text-foreground">{formatCurrency(m.netPaid)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="stubs" className="mt-4 space-y-3">
          {statementsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : !statements.length ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="empty-stubs">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No pay stubs yet</p>
            </div>
          ) : (
            statements.map((stmt: any) => (
              <Card key={stmt.id} className="rounded-xl" data-testid={`stub-${stmt.id}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{stmt.stubNumber || "Processing"}</p>
                    <p className="text-xs text-muted-foreground">
                      {stmt.periodStart && stmt.periodEnd
                        ? `${new Date(stmt.periodStart).toLocaleDateString()} - ${new Date(stmt.periodEnd).toLocaleDateString()}`
                        : "Period pending"}
                    </p>
                    {stmt.isViewableByRep ? (
                      <p className="text-sm font-semibold mt-1">{formatCurrency(parseFloat(stmt.netPay || "0"))}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1 italic">Processing</p>
                    )}
                  </div>
                  {stmt.isViewableByRep && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadPdf(stmt.id)}
                      data-testid={`button-download-pdf-${stmt.id}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
