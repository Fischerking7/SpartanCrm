import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DollarSign, Clock, CheckCircle, AlertTriangle, Search, ChevronLeft, ChevronRight, Download
} from "lucide-react";

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function fmtDollars(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export default function AcctAR() {
  const { toast } = useToast();
  const [view, setView] = useState<"table" | "reconciliation" | "variance">("table");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedAR, setSelectedAR] = useState<any>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const perPage = 25;

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const periodEnd = now.toISOString().split("T")[0];

  const { data: arData, isLoading } = useQuery<any[]>({ queryKey: ["/api/finance/ar"] });
  const { data: reconciliation } = useQuery<any>({
    queryKey: ["/api/admin/accounting/ar-payroll-reconciliation", periodStart, periodEnd],
    queryFn: async () => {
      const res = await fetch(`/api/admin/accounting/ar-payroll-reconciliation?periodStart=${periodStart}&periodEnd=${periodEnd}`, {
        credentials: "include", headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: view === "reconciliation",
  });
  const { data: varianceData } = useQuery<any[]>({
    queryKey: ["/api/admin/accounting/variance-report", periodStart, periodEnd],
    queryFn: async () => {
      const res = await fetch(`/api/admin/accounting/variance-report?periodStart=${periodStart}&periodEnd=${periodEnd}`, {
        credentials: "include", headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: view === "variance",
  });

  const arList = arData || [];
  const open = arList.filter((a: any) => a.status === "OPEN");
  const partial = arList.filter((a: any) => a.status === "PARTIAL");
  const satisfied = arList.filter((a: any) => a.status === "SATISFIED");
  const overdue = arList.filter((a: any) => ["OPEN", "PARTIAL"].includes(a.status) && daysSince(a.createdAt) > 30);

  const sumCents = (list: any[]) => list.reduce((t: number, a: any) => t + (a.expectedAmountCents || 0), 0);

  const filtered = arList.filter((a: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (a.invoiceNumber || "").toLowerCase().includes(q) ||
      (a.customerName || "").toLowerCase().includes(q) ||
      (a.orderId || "").toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const rowColor = (ar: any) => {
    if (ar.status === "SATISFIED") return "";
    const days = daysSince(ar.createdAt);
    if (days > 45) return "bg-red-50 dark:bg-red-950/30";
    if (days > 30) return "bg-red-50/50 dark:bg-red-950/20";
    if (ar.status === "PARTIAL") return "bg-yellow-50 dark:bg-yellow-950/20";
    return "";
  };

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-ar">
      <h1 className="text-xl font-semibold">Accounts Receivable</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground">Open</p>
              <p className="text-sm font-medium" data-testid="text-ar-open-count">{open.length} / {fmt(sumCents(open))}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Partial</p>
              <p className="text-sm font-medium" data-testid="text-ar-partial-count">{partial.length} / {fmt(sumCents(partial))}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground">Satisfied</p>
              <p className="text-sm font-medium" data-testid="text-ar-satisfied-count">{satisfied.length} / {fmt(sumCents(satisfied))}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <div>
              <p className="text-xs text-muted-foreground">Overdue (30+ days)</p>
              <p className="text-sm font-medium text-red-600" data-testid="text-ar-overdue-count">{overdue.length} / {fmt(sumCents(overdue))}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={view === "table" ? "default" : "outline"} onClick={() => setView("table")} data-testid="button-ar-table">AR Table</Button>
        <Button size="sm" variant={view === "reconciliation" ? "default" : "outline"} onClick={() => setView("reconciliation")} data-testid="button-ar-recon">AR-Payroll Reconciliation</Button>
        <Button size="sm" variant={view === "variance" ? "default" : "outline"} onClick={() => setView("variance")} data-testid="button-ar-variance">Variance Report</Button>
      </div>

      {view === "table" && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by invoice, customer, or order..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9" data-testid="input-search-ar" />
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3">Invoice #</th>
                      <th className="text-right p-3">Expected</th>
                      <th className="text-right p-3">Received</th>
                      <th className="text-right p-3">Balance</th>
                      <th className="text-center p-3">Status</th>
                      <th className="text-right p-3">Days Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.length === 0 && (
                      <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">No AR expectations found</td></tr>
                    )}
                    {paginated.map((ar: any) => (
                      <tr key={ar.id} className={`border-b hover:bg-muted/30 cursor-pointer ${rowColor(ar)}`}
                        onClick={() => setSelectedAR(ar)} data-testid={`row-ar-${ar.id}`}>
                        <td className="p-3 font-medium">{ar.invoiceNumber || ar.orderId?.slice(0, 8)}</td>
                        <td className="p-3 text-right">{fmt(ar.expectedAmountCents || 0)}</td>
                        <td className="p-3 text-right text-green-600">{fmt(ar.actualAmountCents || 0)}</td>
                        <td className="p-3 text-right font-medium">{fmt((ar.expectedAmountCents || 0) - (ar.actualAmountCents || 0))}</td>
                        <td className="p-3 text-center">
                          <Badge variant="outline" className={ar.status === "SATISFIED" ? "text-green-600" : ar.status === "PARTIAL" ? "text-amber-600" : "text-red-600"}>
                            {ar.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{daysSince(ar.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t">
                  <span className="text-xs text-muted-foreground">{filtered.length} records</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-ar-prev-page"><ChevronLeft className="h-4 w-4" /></Button>
                    <span className="text-xs">{page} / {totalPages}</span>
                    <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-ar-next-page"><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {view === "reconciliation" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AR-Payroll Reconciliation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {reconciliation ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium mb-2">AR Satisfied</h3>
                  <p>Count: {reconciliation.arSatisfied?.count || 0}</p>
                  <p>Expected: {fmtDollars((reconciliation.arSatisfied?.totalExpected || 0) / 100)}</p>
                  <p>Actual: {fmtDollars((reconciliation.arSatisfied?.totalActual || 0) / 100)}</p>
                </div>
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium mb-2">Payroll Ready</h3>
                  <p>Count: {reconciliation.payrollReady?.count || 0}</p>
                  <p>Commission: {fmtDollars(reconciliation.payrollReady?.totalCommission || 0)}</p>
                </div>
                <div className="border rounded-lg p-4">
                  <h3 className="font-medium mb-2">Pay Run Totals</h3>
                  <p>Statements: {reconciliation.payRunTotals?.count || 0}</p>
                  <p>Gross: {fmtDollars(reconciliation.payRunTotals?.totalGross || 0)}</p>
                  <p>Net: {fmtDollars(reconciliation.payRunTotals?.totalNetPay || 0)}</p>
                </div>
              </div>
            ) : (
              <Skeleton className="h-32 w-full" />
            )}
          </CardContent>
        </Card>
      )}

      {view === "variance" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Variance Report</CardTitle>
            <Button size="sm" variant="outline" onClick={() => {
              if (!varianceData?.length) return;
              const csv = ["Order ID,Invoice,Commission,Rack Rate Cents,Profit Cents,AR Expected,AR Actual,AR Variance,AR Status"]
                .concat(varianceData.map((r: any) => `${r.orderId},${r.invoiceNumber},${r.commissionAmount},${r.rackRateCents},${r.profitCents},${r.arExpectedCents},${r.arActualCents},${r.arVarianceCents},${r.arStatus}`))
                .join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "variance-report.csv"; a.click();
            }} data-testid="button-export-variance">
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3">Invoice</th>
                    <th className="text-right p-3">Commission</th>
                    <th className="text-right p-3">AR Expected</th>
                    <th className="text-right p-3">AR Actual</th>
                    <th className="text-right p-3">Variance</th>
                    <th className="text-center p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(!varianceData || varianceData.length === 0) && (
                    <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">No variance data for this period</td></tr>
                  )}
                  {varianceData?.map((r: any) => (
                    <tr key={r.orderId} className="border-b hover:bg-muted/30">
                      <td className="p-3">{r.invoiceNumber || r.orderId?.slice(0, 8)}</td>
                      <td className="p-3 text-right">{fmtDollars(r.commissionAmount || 0)}</td>
                      <td className="p-3 text-right">{fmt(r.arExpectedCents || 0)}</td>
                      <td className="p-3 text-right">{fmt(r.arActualCents || 0)}</td>
                      <td className="p-3 text-right font-medium">{fmt(r.arVarianceCents || 0)}</td>
                      <td className="p-3 text-center"><Badge variant="outline">{r.arStatus || "—"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedAR} onOpenChange={() => setSelectedAR(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AR Detail</DialogTitle>
          </DialogHeader>
          {selectedAR && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-muted-foreground">Order</p><p className="font-medium">{selectedAR.orderId?.slice(0, 8)}</p></div>
                <div><p className="text-muted-foreground">Status</p><Badge variant="outline">{selectedAR.status}</Badge></div>
                <div><p className="text-muted-foreground">Expected</p><p className="font-medium">{fmt(selectedAR.expectedAmountCents || 0)}</p></div>
                <div><p className="text-muted-foreground">Received</p><p className="font-medium text-green-600">{fmt(selectedAR.actualAmountCents || 0)}</p></div>
                <div><p className="text-muted-foreground">Balance</p><p className="font-medium">{fmt((selectedAR.expectedAmountCents || 0) - (selectedAR.actualAmountCents || 0))}</p></div>
                <div><p className="text-muted-foreground">Days Open</p><p className="font-medium">{daysSince(selectedAR.createdAt)}</p></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
