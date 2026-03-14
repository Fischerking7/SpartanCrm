import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Download, FileText, Shield } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";

function formatCurrency(v: number) {
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export default function MyEarnings() {
  const [, setLocation] = useLocation();
  const [selectedMonth, setSelectedMonth] = useState<any>(null);

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
        <button onClick={() => setLocation("/dashboard")} className="p-1" data-testid="button-back">
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
              <p className="text-sm font-medium text-muted-foreground">{earnings.period?.label || "Current Period"}</p>
              <Card className="rounded-2xl">
                <CardContent className="p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Gross Commission</span>
                    <span className="font-medium">{formatCurrency(earnings.currentPeriod?.grossCommission || 0)}</span>
                  </div>
                  {(earnings.currentPeriod?.overridesEarned || 0) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Overrides Earned</span>
                      <span className="font-medium">{formatCurrency(earnings.currentPeriod.overridesEarned)}</span>
                    </div>
                  )}
                  {(earnings.currentPeriod?.reserveWithheld || 0) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-orange-600 dark:text-orange-400">Reserve Withheld</span>
                      <span className="font-medium text-orange-600 dark:text-orange-400">-{formatCurrency(earnings.currentPeriod.reserveWithheld)}</span>
                    </div>
                  )}
                  {(earnings.currentPeriod?.chargebacks || 0) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-red-600 dark:text-red-400">Chargebacks</span>
                      <span className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(earnings.currentPeriod.chargebacks)}</span>
                    </div>
                  )}
                  {(earnings.currentPeriod?.deductions || 0) > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Deductions</span>
                      <span className="font-medium">-{formatCurrency(earnings.currentPeriod.deductions)}</span>
                    </div>
                  )}
                  <div className="border-t pt-3 flex justify-between items-center">
                    <span className="font-semibold">Estimated Net</span>
                    <span className="text-xl font-bold" data-testid="text-estimated-net">
                      {formatCurrency(earnings.currentPeriod?.estimatedNet || 0)}
                    </span>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground text-center italic">
                Estimated until pay stub is issued
              </p>

              <button
                onClick={() => setLocation("/reserve")}
                className="w-full"
                data-testid="link-reserve"
              >
                <Card className="rounded-2xl border-[#C9A84C]/20 bg-[#C9A84C]/5 hover:shadow-sm transition-shadow">
                  <CardContent className="p-3 flex items-center gap-3">
                    <Shield className="h-5 w-5 text-[#C9A84C]" />
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium">Rolling Reserve</p>
                      <p className="text-xs text-muted-foreground">View your reserve balance & history</p>
                    </div>
                    <ChevronLeft className="h-4 w-4 text-muted-foreground rotate-180" />
                  </CardContent>
                </Card>
              </button>

              <div className="bg-muted/50 rounded-2xl p-3 text-center">
                <p className="text-sm text-muted-foreground">Orders this period</p>
                <p className="text-2xl font-bold">{earnings.currentPeriod?.orderCount || 0}</p>
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
                  <button
                    key={i}
                    className="flex-1 flex flex-col items-center gap-1"
                    onClick={() => setSelectedMonth(selectedMonth === i ? null : i)}
                  >
                    <div
                      className={`w-full rounded-t-sm transition-all ${
                        selectedMonth === i ? "bg-[#C9A84C]" : "bg-[#1B2A4A]/70 dark:bg-white/70"
                      }`}
                      style={{ height: `${Math.max(4, (m.netPaid / maxBarValue) * 100)}%` }}
                      title={`${m.month}: ${formatCurrency(m.netPaid)}`}
                    />
                    <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                      {m.month.split(" ")[0].slice(0, 3)}
                    </span>
                  </button>
                ))}
              </div>

              {selectedMonth !== null && earnings.monthlyHistory[selectedMonth] && (
                <Card className="rounded-2xl border-[#C9A84C]/20 bg-[#C9A84C]/5" data-testid="month-detail">
                  <CardContent className="p-3">
                    <p className="text-sm font-semibold text-[#C9A84C]">{earnings.monthlyHistory[selectedMonth].month}</p>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                      <div>
                        <p className="text-lg font-bold">{earnings.monthlyHistory[selectedMonth].orders}</p>
                        <p className="text-[10px] text-muted-foreground">Orders</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold">{earnings.monthlyHistory[selectedMonth].connects}</p>
                        <p className="text-[10px] text-muted-foreground">Connects</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold">{formatCurrency(earnings.monthlyHistory[selectedMonth].netPaid)}</p>
                        <p className="text-[10px] text-muted-foreground">Net Paid</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

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
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
            </div>
          ) : !statements.length ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="empty-stubs">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No pay stubs yet</p>
            </div>
          ) : (
            statements.map((stmt: any) => (
              <Card key={stmt.id} className="rounded-2xl" data-testid={`stub-${stmt.id}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{stmt.stubNumber || "Processing"}</p>
                    <p className="text-xs text-muted-foreground">
                      {stmt.periodStart && stmt.periodEnd
                        ? `${formatDate(stmt.periodStart)} - ${formatDate(stmt.periodEnd)}`
                        : "Period pending"}
                    </p>
                    {stmt.isViewableByRep ? (
                      <p className="text-sm font-semibold mt-1 text-[#C9A84C]">{formatCurrency(parseFloat(stmt.netPay || "0"))}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1 italic">Processing</p>
                    )}
                  </div>
                  {stmt.isViewableByRep && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
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
