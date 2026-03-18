import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  Play, FileText, Download, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, AlertTriangle, Flag, TrendingUp, ArrowUpRight, ArrowDownRight
} from "lucide-react";

function fmt(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const stepLabels = ["Build", "Review", "Approve", "Stubs", "Finalize", "Export"];
const statusStep: Record<string, number> = {
  DRAFT: 0, PENDING_REVIEW: 1, PENDING_APPROVAL: 2, APPROVED: 3, FINALIZED: 4
};

function StepBar({ status }: { status: string }) {
  const current = statusStep[status] ?? 0;
  return (
    <div className="flex items-center gap-1 w-full" data-testid="step-bar">
      {stepLabels.map((label, i) => (
        <div key={label} className="flex items-center gap-1 flex-1">
          <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium shrink-0 ${
            i <= current ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
          }`}>{i + 1}</div>
          <span className={`text-xs truncate hidden md:inline ${i <= current ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
          {i < stepLabels.length - 1 && <div className={`flex-1 h-0.5 ${i < current ? "bg-foreground" : "bg-muted"}`} />}
        </div>
      ))}
    </div>
  );
}

export default function AcctPayRuns() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedRep, setExpandedRep] = useState<string | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().split("T")[0]);

  const { data: payRuns, isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/payruns"] });
  const selected = payRuns?.find((r: any) => r.id === selectedId);

  const { data: detail } = useQuery<any>({
    queryKey: ["/api/admin/payruns", selectedId],
    enabled: !!selectedId,
  });

  const { data: statementsData } = useQuery<any[]>({
    queryKey: ["/api/admin/payroll/statements", selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/payroll/statements?payRunId=${selectedId}`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedId,
  });

  const { data: cashProjection } = useQuery<any>({
    queryKey: ["/api/admin/payruns", selectedId, "cash-projection"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/payruns/${selectedId}/cash-projection`, { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedId,
  });

  const buildMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/payruns", {
        name: `Pay Run ${periodEnd}`,
        periodStart, periodEnd, weekEndingDate: periodEnd,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      setSelectedId(data.id);
      setBuildOpen(false);
      toast({ title: "Pay run created" });
    },
    onError: () => toast({ title: "Failed to create pay run", variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: async ({ action }: { action: string }) => {
      await apiRequest("POST", `/api/admin/payruns/${selectedId}/${action}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns", selectedId] });
      toast({ title: "Action completed" });
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const generateStubs = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/payroll/generate-stubs/${selectedId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Stubs generated" });
    },
    onError: () => toast({ title: "Failed to generate stubs", variant: "destructive" }),
  });

  const linkAll = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/payruns/${selectedId}/link-all-orders`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns", selectedId] });
      toast({ title: "Orders linked" });
    },
    onError: () => toast({ title: "Failed to link orders", variant: "destructive" }),
  });

  const statusColor: Record<string, string> = {
    DRAFT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
    PENDING_REVIEW: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
    PENDING_APPROVAL: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
    APPROVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
    FINALIZED: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  };

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  const statements = statementsData || [];
  const repMap = new Map<string, any[]>();
  statements.forEach((s: any) => {
    const key = s.userId || s.repId || "unknown";
    if (!repMap.has(key)) repMap.set(key, []);
    repMap.get(key)!.push(s);
  });

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-pay-runs">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pay Runs</h1>
        <Button size="sm" onClick={() => setBuildOpen(true)} data-testid="button-new-pay-run">
          <Play className="h-3.5 w-3.5 mr-1" /> Auto-Build Pay Run
        </Button>
      </div>

      {selected && <StepBar status={selected.status} />}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">All Pay Runs</p>
          {payRuns?.map((pr: any) => (
            <Card
              key={pr.id}
              className={`cursor-pointer transition-colors ${selectedId === pr.id ? "ring-2 ring-foreground" : "hover:bg-muted/50"}`}
              onClick={() => setSelectedId(pr.id)}
              data-testid={`card-pay-run-${pr.id}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{pr.name}</span>
                  <Badge variant="outline" className={statusColor[pr.status] || ""}>{pr.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {pr.periodStart ? new Date(pr.periodStart).toLocaleDateString() : ""} – {pr.periodEnd ? new Date(pr.periodEnd).toLocaleDateString() : ""}
                </p>
                {pr.orderCount != null && (
                  <p className="text-xs text-muted-foreground">{pr.orderCount} orders · {pr.repCount || 0} reps</p>
                )}
              </CardContent>
            </Card>
          ))}
          {(!payRuns || payRuns.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">No pay runs yet</p>
          )}
        </div>

        <div className="lg:col-span-3">
          {!selected ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p>Select a pay run or create a new one to get started</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card data-testid="card-pay-run-summary">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{selected.name}</span>
                    <Badge variant="outline" className={statusColor[selected.status] || ""}>{selected.status}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Period</p>
                      <p className="font-medium">{selected.periodStart ? new Date(selected.periodStart).toLocaleDateString() : "N/A"} – {selected.periodEnd ? new Date(selected.periodEnd).toLocaleDateString() : "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Reps</p>
                      <p className="font-medium" data-testid="text-rep-count">{selected.repCount || repMap.size || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Orders</p>
                      <p className="font-medium" data-testid="text-order-count">{selected.orderCount || detail?.orders?.length || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Commission Total</p>
                      <p className="font-medium" data-testid="text-total-commission">{fmt(detail?.stats?.totalCommission || selected.totalAmount || 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Gross</p>
                      <p className="font-medium" data-testid="text-total-gross">{fmt(detail?.totalGross || selected.totalGross || 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Net</p>
                      <p className="font-medium" data-testid="text-total-net">{fmt(detail?.totalNet || selected.totalNet || 0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap gap-2">
                {selected.status === "DRAFT" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => linkAll.mutate()} disabled={linkAll.isPending} data-testid="button-link-orders">
                      {linkAll.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null} Link All Orders
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => generateStubs.mutate()} disabled={generateStubs.isPending} data-testid="button-generate-stubs">
                      <FileText className="h-3.5 w-3.5 mr-1" /> Generate Stubs
                    </Button>
                    <Button size="sm" onClick={() => actionMutation.mutate({ action: "submit-review" })} disabled={actionMutation.isPending} data-testid="button-submit-review">
                      Submit for Review
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => {
                      if (confirm("Delete this pay run?")) apiRequest("DELETE", `/api/admin/payruns/${selectedId}`).then(() => {
                        queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
                        setSelectedId(null);
                      });
                    }} data-testid="button-cancel-run">
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel Run
                    </Button>
                  </>
                )}
                {selected.status === "PENDING_REVIEW" && (
                  <Button size="sm" onClick={() => actionMutation.mutate({ action: "submit-approval" })} disabled={actionMutation.isPending} data-testid="button-submit-approval">
                    Submit for Approval
                  </Button>
                )}
                {selected.status === "PENDING_APPROVAL" && (
                  <>
                    <Button size="sm" onClick={() => actionMutation.mutate({ action: "approve" })} disabled={actionMutation.isPending} data-testid="button-approve-run">
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => actionMutation.mutate({ action: "reject" })} disabled={actionMutation.isPending} data-testid="button-reject-run">
                      Reject
                    </Button>
                  </>
                )}
                {selected.status === "APPROVED" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => generateStubs.mutate()} disabled={generateStubs.isPending} data-testid="button-gen-stubs-approved">
                      <FileText className="h-3.5 w-3.5 mr-1" /> Generate Stubs
                    </Button>
                    <Button size="sm" onClick={() => actionMutation.mutate({ action: "finalize" })} disabled={actionMutation.isPending} data-testid="button-finalize-run">
                      Finalize Pay Run
                    </Button>
                  </>
                )}
                {selected.status === "FINALIZED" && (
                  <>
                    <Button size="sm" variant="outline" onClick={async () => {
                      const res = await fetch(`/api/admin/payroll/pdf-zip/${selectedId}`, { headers: getAuthHeaders() });
                      if (res.ok) {
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a"); a.href = url; a.download = `pay-stubs-${selectedId}.zip`; a.click();
                      }
                    }} data-testid="button-download-pdfs">
                      <Download className="h-3.5 w-3.5 mr-1" /> Download All PDFs
                    </Button>
                  </>
                )}
              </div>

              <Tabs defaultValue="orders">
                <TabsList>
                  <TabsTrigger value="orders" data-testid="tab-orders">Orders</TabsTrigger>
                  <TabsTrigger value="by-rep" data-testid="tab-by-rep">Rep Payouts</TabsTrigger>
                  <TabsTrigger value="exceptions" data-testid="tab-exceptions">Exceptions</TabsTrigger>
                  <TabsTrigger value="cash-projection" data-testid="tab-cash-projection">
                    <TrendingUp className="h-3.5 w-3.5 mr-1" /> Cash Projection
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="orders">
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        {detail?.orders?.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left p-3">Customer</th>
                                <th className="text-left p-3">Rep</th>
                                <th className="text-left p-3">Provider</th>
                                <th className="text-left p-3">Service</th>
                                <th className="text-left p-3">Date Sold</th>
                                <th className="text-right p-3">Commission</th>
                                <th className="text-right p-3">Incentive</th>
                                <th className="text-right p-3">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.orders.map((o: any) => {
                                const comm = parseFloat(o.baseCommissionEarned || 0);
                                const inc = parseFloat(o.incentiveEarned || 0);
                                return (
                                  <tr key={o.id} className="border-b hover:bg-muted/30" data-testid={`row-order-${o.id}`}>
                                    <td className="p-3 font-medium">{o.customerName}</td>
                                    <td className="p-3">{o.repId}</td>
                                    <td className="p-3">{o.provider?.name || o.providerId || ""}</td>
                                    <td className="p-3">{o.service?.name || o.serviceType || ""}</td>
                                    <td className="p-3">{o.dateSold ? new Date(o.dateSold).toLocaleDateString() : ""}</td>
                                    <td className="p-3 text-right font-mono">{fmt(comm)}</td>
                                    <td className="p-3 text-right font-mono">{fmt(inc)}</td>
                                    <td className="p-3 text-right font-mono font-medium">{fmt(comm + inc)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 bg-muted/30 font-medium">
                                <td colSpan={5} className="p-3">{detail.orders.length} orders</td>
                                <td className="p-3 text-right font-mono">{fmt(detail.orders.reduce((s: number, o: any) => s + parseFloat(o.baseCommissionEarned || 0), 0))}</td>
                                <td className="p-3 text-right font-mono">{fmt(detail.orders.reduce((s: number, o: any) => s + parseFloat(o.incentiveEarned || 0), 0))}</td>
                                <td className="p-3 text-right font-mono">{fmt(detail.orders.reduce((s: number, o: any) => s + parseFloat(o.baseCommissionEarned || 0) + parseFloat(o.incentiveEarned || 0), 0))}</td>
                              </tr>
                            </tfoot>
                          </table>
                        ) : (
                          <div className="p-6 text-center text-muted-foreground">No orders linked to this pay run yet. Click "Link All Orders" to collect eligible orders.</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="by-rep">
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        {statements.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left p-3"></th>
                                <th className="text-left p-3">Rep</th>
                                <th className="text-right p-3">Orders</th>
                                <th className="text-right p-3">Gross</th>
                                <th className="text-right p-3">Deductions</th>
                                <th className="text-right p-3">Net Pay</th>
                                <th className="text-right p-3">Status</th>
                                <th className="text-right p-3">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {statements.map((s: any) => (
                                <tr key={s.id} className="border-b hover:bg-muted/30" data-testid={`row-statement-${s.id}`}>
                                  <td className="p-3">
                                    <button onClick={() => setExpandedRep(expandedRep === s.id ? null : s.id)} data-testid={`button-expand-rep-${s.id}`}>
                                      {expandedRep === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                  </td>
                                  <td className="p-3 font-medium">{s.repName || s.userId}</td>
                                  <td className="p-3 text-right">{s.orderCount || "—"}</td>
                                  <td className="p-3 text-right font-mono">{fmt(s.grossCommission || 0)}</td>
                                  <td className="p-3 text-right font-mono text-red-600 dark:text-red-400">
                                    {parseFloat(s.chargebacksTotal || 0) + parseFloat(s.deductionsTotal || 0) > 0
                                      ? `-${fmt(parseFloat(s.chargebacksTotal || 0) + parseFloat(s.deductionsTotal || 0))}`
                                      : fmt(0)}
                                  </td>
                                  <td className="p-3 text-right font-mono font-medium">{fmt(s.netPay || 0)}</td>
                                  <td className="p-3 text-right">
                                    <Badge variant="outline">{s.status}</Badge>
                                  </td>
                                  <td className="p-3 text-right">
                                    {s.stubNumber && (
                                      <Button size="sm" variant="ghost" onClick={async () => {
                                        const res = await fetch(`/api/admin/payroll/pdf/${s.id}`, { headers: getAuthHeaders() });
                                        if (res.ok) {
                                          const blob = await res.blob();
                                          const url = URL.createObjectURL(blob);
                                          window.open(url);
                                        }
                                      }} data-testid={`button-view-stub-${s.id}`}>
                                        <FileText className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 bg-muted/30 font-medium">
                                <td colSpan={3} className="p-3">{statements.length} reps</td>
                                <td className="p-3 text-right font-mono">{fmt(statements.reduce((s: number, st: any) => s + parseFloat(st.grossCommission || 0), 0))}</td>
                                <td className="p-3 text-right font-mono text-red-600 dark:text-red-400">
                                  {fmt(statements.reduce((s: number, st: any) => s + parseFloat(st.chargebacksTotal || 0) + parseFloat(st.deductionsTotal || 0), 0))}
                                </td>
                                <td className="p-3 text-right font-mono">{fmt(statements.reduce((s: number, st: any) => s + parseFloat(st.netPay || 0), 0))}</td>
                                <td colSpan={2}></td>
                              </tr>
                            </tfoot>
                          </table>
                        ) : detail?.stats?.repBreakdown?.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left p-3">Rep</th>
                                <th className="text-right p-3">Orders</th>
                                <th className="text-right p-3">Estimated Payout</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.stats.repBreakdown.map((r: any) => (
                                <tr key={r.name} className="border-b hover:bg-muted/30" data-testid={`row-rep-${r.name}`}>
                                  <td className="p-3 font-medium">{r.name}</td>
                                  <td className="p-3 text-right">{r.count}</td>
                                  <td className="p-3 text-right font-mono">{fmt(r.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 bg-muted/30 font-medium">
                                <td className="p-3">{detail.stats.repBreakdown.length} reps</td>
                                <td className="p-3 text-right">{detail.stats.repBreakdown.reduce((s: number, r: any) => s + r.count, 0)}</td>
                                <td className="p-3 text-right font-mono">{fmt(detail.stats.repBreakdown.reduce((s: number, r: any) => s + r.total, 0))}</td>
                              </tr>
                            </tfoot>
                          </table>
                        ) : (
                          <div className="p-6 text-center text-muted-foreground">No payout data yet. Link orders first, then generate stubs.</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="exceptions">
                  <Card>
                    <CardContent className="p-6">
                      {statements.filter((s: any) => s.hasExceptions || parseFloat(s.netPay || "0") < 0).length === 0 ? (
                        <p className="text-sm text-green-600 text-center">No exceptions found</p>
                      ) : (
                        <div className="space-y-2">
                          {statements.filter((s: any) => parseFloat(s.netPay || "0") < 0).map((s: any) => (
                            <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
                              <Flag className="h-4 w-4 text-amber-600 shrink-0" />
                              <div>
                                <p className="text-sm font-medium">{s.repName || s.userId}</p>
                                <p className="text-xs text-muted-foreground">Negative net pay: {fmt(s.netPay)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="cash-projection">
                  <Card data-testid="card-cash-projection">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> Cash Flow Projection
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {!cashProjection ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Loading projection data...</p>
                      ) : (
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-4 rounded-lg border bg-red-50/50 dark:bg-red-950/30" data-testid="section-payouts">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Rep Payouts</p>
                              <p className="text-2xl font-bold font-mono" data-testid="text-total-payouts">{fmt(cashProjection.payRunTotalCents / 100)}</p>
                            </div>
                            <div className="p-4 rounded-lg border bg-orange-50/50 dark:bg-orange-950/30" data-testid="section-overrides">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Override Obligations</p>
                              <p className="text-2xl font-bold font-mono" data-testid="text-total-overrides">{fmt(cashProjection.overrideCents / 100)}</p>
                            </div>
                            <div className="p-4 rounded-lg border bg-blue-50/50 dark:bg-blue-950/30" data-testid="section-total-outgoing">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Total Outgoing</p>
                              <p className="text-2xl font-bold font-mono" data-testid="text-total-outgoing">{fmt(cashProjection.totalOutgoingCents / 100)}</p>
                            </div>
                          </div>

                          {cashProjection.arPipeline?.length > 0 && (
                            <div>
                              <p className="text-sm font-medium mb-2">AR Collection Forecast</p>
                              <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/50">
                                    <tr>
                                      <th className="text-left p-2.5">Client</th>
                                      <th className="text-right p-2.5">Remaining</th>
                                      <th className="text-center p-2.5">Probability</th>
                                      <th className="text-right p-2.5">Weighted</th>
                                      <th className="text-right p-2.5">Expected By</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {cashProjection.arPipeline.map((c: any, i: number) => (
                                      <tr key={i} className="border-t">
                                        <td className="p-2.5">{c.clientName}</td>
                                        <td className="p-2.5 text-right font-mono">{fmt(c.remainingCents / 100)}</td>
                                        <td className="p-2.5 text-center">
                                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                                            c.probability >= 70 ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                                            : c.probability >= 50 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                                            : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                                          }`}>{c.probability}%</span>
                                        </td>
                                        <td className="p-2.5 text-right font-mono">{fmt(Math.round(c.remainingCents * c.probability / 100) / 100)}</td>
                                        <td className="p-2.5 text-right text-muted-foreground">{c.expectedDate}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <p className="text-xs text-muted-foreground mt-2">
                                Total expected AR (weighted): {fmt(cashProjection.totalIncomingCents / 100)}
                              </p>
                            </div>
                          )}

                          <div className="border-t pt-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {cashProjection.projectedNetCents >= 0
                                  ? <ArrowUpRight className="h-5 w-5 text-green-500" />
                                  : <ArrowDownRight className="h-5 w-5 text-red-500" />}
                                <span className="font-medium">Projected Net Cash Position</span>
                              </div>
                              <span className={`text-xl font-bold font-mono ${cashProjection.projectedNetCents >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-projected-net">
                                {fmt(cashProjection.projectedNetCents / 100)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">AR weighted total minus payout &amp; override obligations</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>

      <Dialog open={buildOpen} onOpenChange={setBuildOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Build Pay Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Week Ending Date (Sunday)</Label>
              <Input type="date" value={periodEnd} onChange={e => {
                const val = e.target.value;
                setPeriodEnd(val);
                if (val) {
                  const d = new Date(val + "T00:00:00");
                  const dow = d.getDay();
                  const toMon = dow === 0 ? 6 : dow - 1;
                  const monday = new Date(d);
                  monday.setDate(d.getDate() - toMon);
                  setPeriodStart(monday.toISOString().split("T")[0]);
                }
              }} data-testid="input-period-end" />
            </div>
            {periodStart && periodEnd && (
              <p className="text-sm text-muted-foreground">
                Pay period: <span className="font-medium text-foreground">{new Date(periodStart + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span> – <span className="font-medium text-foreground">{new Date(periodEnd + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span> (Mon–Sun)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuildOpen(false)} data-testid="button-cancel-build">Cancel</Button>
            <Button onClick={() => buildMutation.mutate()} disabled={!periodEnd || buildMutation.isPending} data-testid="button-confirm-build">
              {buildMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Build Pay Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
