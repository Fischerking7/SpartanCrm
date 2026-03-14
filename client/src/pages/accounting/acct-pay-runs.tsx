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
  Play, FileText, Download, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, AlertTriangle, Flag
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
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
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
                      <p className="text-muted-foreground">Total Gross</p>
                      <p className="font-medium" data-testid="text-total-gross">{fmt(selected.totalGross || detail?.totalGross || 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Net</p>
                      <p className="font-medium" data-testid="text-total-net">{fmt(selected.totalNet || detail?.totalNet || 0)}</p>
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

              <Tabs defaultValue="by-rep">
                <TabsList>
                  <TabsTrigger value="by-rep" data-testid="tab-by-rep">By Rep</TabsTrigger>
                  <TabsTrigger value="by-service" data-testid="tab-by-service">By Service</TabsTrigger>
                  <TabsTrigger value="exceptions" data-testid="tab-exceptions">Exceptions</TabsTrigger>
                </TabsList>
                <TabsContent value="by-rep">
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-3"></th>
                              <th className="text-left p-3">Rep</th>
                              <th className="text-right p-3">Gross</th>
                              <th className="text-right p-3">Net Pay</th>
                              <th className="text-right p-3">Status</th>
                              <th className="text-right p-3">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statements.length === 0 && (
                              <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">No statements yet. Link orders and generate stubs.</td></tr>
                            )}
                            {statements.map((s: any) => (
                              <tr key={s.id} className="border-b hover:bg-muted/30" data-testid={`row-statement-${s.id}`}>
                                <td className="p-3">
                                  <button onClick={() => setExpandedRep(expandedRep === s.id ? null : s.id)} data-testid={`button-expand-rep-${s.id}`}>
                                    {expandedRep === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </button>
                                </td>
                                <td className="p-3 font-medium">{s.repName || s.userId}</td>
                                <td className="p-3 text-right">{fmt(s.grossCommission || 0)}</td>
                                <td className="p-3 text-right font-medium">{fmt(s.netPay || 0)}</td>
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
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="by-service">
                  <Card>
                    <CardContent className="p-6">
                      <p className="text-sm text-muted-foreground text-center">Service breakdown available after orders are linked to this pay run.</p>
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
              <Label>Period Start</Label>
              <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} data-testid="input-period-start" />
            </div>
            <div>
              <Label>Period End</Label>
              <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} data-testid="input-period-end" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuildOpen(false)} data-testid="button-cancel-build">Cancel</Button>
            <Button onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending} data-testid="button-confirm-build">
              {buildMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Build Pay Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
