import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DollarSign, AlertTriangle, CheckCircle2, Clock, Search, BarChart3, TrendingUp, Pencil
} from "lucide-react";

function centsToStr(cents: number) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrency(cents: number) {
  return "$" + centsToStr(cents);
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const statusColors: Record<string, string> = {
  OPEN: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  PARTIAL: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  SATISFIED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  OVERDUE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  WRITTEN_OFF: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

function aggregateSummary(rows: any[]) {
  const buckets: Record<string, { count: number; totalCents: number }> = {
    OPEN: { count: 0, totalCents: 0 },
    PARTIAL: { count: 0, totalCents: 0 },
    SATISFIED: { count: 0, totalCents: 0 },
    OVERDUE: { count: 0, totalCents: 0 },
  };
  if (!Array.isArray(rows)) return buckets;
  for (const row of rows) {
    const key = (row.status || "OPEN").toUpperCase();
    if (buckets[key]) {
      buckets[key].count += row.count || 0;
      buckets[key].totalCents += row.totalCents || 0;
    }
  }
  return buckets;
}

export default function OpsAR() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [paymentDialog, setPaymentDialog] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [editDialog, setEditDialog] = useState<any>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editReason, setEditReason] = useState("");
  const [satisfyDialog, setSatisfyDialog] = useState<any>(null);
  const [satisfyReason, setSatisfyReason] = useState("");

  const { data: arData, isLoading: arLoading } = useQuery<any>({
    queryKey: ["/api/finance/ar"],
  });

  const { data: summaryRaw, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ["/api/finance/ar/summary"],
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async ({ id, amountCents }: { id: string; amountCents: number }) => {
      const res = await apiRequest("POST", `/api/finance/ar/${id}/payments`, { amountCents });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar/summary"] });
      toast({ title: "Payment recorded" });
      setPaymentDialog(null);
      setPaymentAmount("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const editExpectedMutation = useMutation({
    mutationFn: async ({ id, expectedAmountCents, reason }: { id: string; expectedAmountCents: number; reason: string }) => {
      const res = await apiRequest("PATCH", `/api/finance/ar/${id}/expected-amount`, { expectedAmountCents, reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar/summary"] });
      toast({ title: "Expected amount updated" });
      setEditDialog(null);
      setEditAmount("");
      setEditReason("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const markSatisfiedMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/finance/ar/${id}/mark-satisfied`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar/summary"] });
      toast({ title: "AR marked as satisfied" });
      setSatisfyDialog(null);
      setSatisfyReason("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const items = arData?.arExpectations || arData || [];
  const arList = Array.isArray(items) ? items : [];

  const filtered = arList.filter((ar: any) => {
    const q = search.toLowerCase();
    const matchSearch = !search 
      || (ar.order?.invoiceNumber || ar.invoiceNumber || "").toLowerCase().includes(q)
      || (ar.order?.customerName || ar.customerName || "").toLowerCase().includes(q)
      || (ar.order?.repName || ar.repName || "").toLowerCase().includes(q)
      || (ar.client?.name || "").toLowerCase().includes(q);
    const matchTab = tab === "all" || ar.status?.toUpperCase() === tab.toUpperCase();
    return matchSearch && matchTab;
  });

  const summary = aggregateSummary(summaryRaw);

  const summaryCards = [
    { label: "Open", value: summary.OPEN.count, amount: summary.OPEN.totalCents, icon: Clock, color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/30" },
    { label: "Partial", value: summary.PARTIAL.count, amount: summary.PARTIAL.totalCents, icon: TrendingUp, color: "text-yellow-600", bg: "bg-yellow-100 dark:bg-yellow-900/30" },
    { label: "Satisfied", value: summary.SATISFIED.count, amount: summary.SATISFIED.totalCents, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
    { label: "Overdue", value: summary.OVERDUE.count, amount: summary.OVERDUE.totalCents, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
  ];

  const dialogExpectedCents = paymentDialog?.expectedAmountCents || 0;
  const dialogReceivedCents = paymentDialog?.actualAmountCents || 0;
  const dialogBalanceCents = dialogExpectedCents - dialogReceivedCents;

  const openEditDialog = (ar: any) => {
    setEditDialog(ar);
    setEditAmount(((ar.expectedAmountCents || 0) / 100).toFixed(2));
    setEditReason("");
  };

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-ar">
      <div>
        <h1 className="text-2xl font-bold">AR Management</h1>
        <p className="text-sm text-muted-foreground">Accounts receivable tracking and reconciliation</p>
      </div>

      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="ar-summary-cards">
          {summaryCards.map(card => (
            <Card key={card.label} className="border-0 shadow-sm" data-testid={`ar-summary-${card.label.toLowerCase()}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${card.bg} flex items-center justify-center`}>
                    <card.icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{card.value}</p>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </div>
                </div>
                {card.amount > 0 && (
                  <p className="text-sm font-medium text-[#C9A84C] mt-2">{formatCurrency(card.amount)}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by invoice, customer, or rep..."
            className="pl-10"
            data-testid="input-search-ar"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList data-testid="ar-tabs">
          <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
          <TabsTrigger value="OPEN" data-testid="tab-open">Open</TabsTrigger>
          <TabsTrigger value="PARTIAL" data-testid="tab-partial">Partial</TabsTrigger>
          <TabsTrigger value="SATISFIED" data-testid="tab-satisfied">Satisfied</TabsTrigger>
          <TabsTrigger value="OVERDUE" data-testid="tab-overdue">Overdue</TabsTrigger>
        </TabsList>
      </Tabs>

      {arLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No AR items found</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Order Info</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">Service</th>
                  <th className="text-left p-3 font-medium">Rep</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">Client</th>
                  <th className="text-right p-3 font-medium">Expected</th>
                  <th className="text-right p-3 font-medium">Received</th>
                  <th className="text-right p-3 font-medium">Balance</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ar: any) => {
                  const expectedCents = ar.expectedAmountCents || 0;
                  const receivedCents = ar.actualAmountCents || 0;
                  const balanceCents = expectedCents - receivedCents;
                  const customerName = ar.order?.customerName || ar.customerName || "";
                  const invoiceLabel = ar.order?.invoiceNumber || ar.invoiceNumber || `AR-${ar.id}`;
                  const repLabel = ar.order?.repName || ar.repName || ar.order?.repId || ar.repId || "—";
                  const clientLabel = ar.client?.name || "—";
                  const createdDate = ar.createdAt ? formatDate(ar.createdAt) : "";
                  return (
                    <tr key={ar.id} className="border-b hover:bg-muted/30" data-testid={`ar-row-${ar.id}`}>
                      <td className="p-3">
                        <div className="font-medium">{invoiceLabel}</div>
                        {customerName && <div className="text-xs text-muted-foreground">{customerName}</div>}
                        {createdDate && <div className="text-xs text-muted-foreground">{createdDate}</div>}
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        {ar.serviceType ? (
                          <Badge variant="outline" className="text-xs">{ar.serviceType}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">All</span>
                        )}
                        {ar.serviceInstallDate && (
                          <div className="text-xs text-muted-foreground mt-0.5">{formatDate(ar.serviceInstallDate)}</div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">{repLabel}</td>
                      <td className="p-3 hidden lg:table-cell text-muted-foreground">{clientLabel}</td>
                      <td className="p-3 text-right">{formatCurrency(expectedCents)}</td>
                      <td className="p-3 text-right text-emerald-600">{formatCurrency(receivedCents)}</td>
                      <td className="p-3 text-right font-medium">{formatCurrency(balanceCents)}</td>
                      <td className="p-3 text-center">
                        <Badge className={`text-xs ${statusColors[ar.status] || ""}`}>
                          {ar.status || "OPEN"}
                        </Badge>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          {ar.status !== "SATISFIED" && ar.status !== "WRITTEN_OFF" && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => openEditDialog(ar)} data-testid={`btn-edit-expected-${ar.id}`}>
                                <Pencil className="h-3 w-3 mr-1" /> Edit
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs"
                                onClick={() => setPaymentDialog(ar)} data-testid={`btn-record-payment-${ar.id}`}>
                                <DollarSign className="h-3 w-3 mr-1" /> Record
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                onClick={() => { setSatisfyDialog(ar); setSatisfyReason(""); }} data-testid={`btn-mark-satisfied-${ar.id}`}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Satisfy
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={!!paymentDialog} onOpenChange={() => { setPaymentDialog(null); setPaymentAmount(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {paymentDialog?.order?.invoiceNumber || paymentDialog?.invoiceNumber || `AR-${paymentDialog?.id}`}
              {paymentDialog?.order?.customerName ? ` — ${paymentDialog.order.customerName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground">Expected</p>
                <p className="font-medium">{formatCurrency(dialogExpectedCents)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Received</p>
                <p className="font-medium text-emerald-600">{formatCurrency(dialogReceivedCents)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Balance</p>
                <p className="font-medium">{formatCurrency(dialogBalanceCents)}</p>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Payment Amount ($)</p>
              <Input
                type="number"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-payment-amount"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPaymentDialog(null); setPaymentAmount(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || recordPaymentMutation.isPending}
              onClick={() => recordPaymentMutation.mutate({
                id: paymentDialog.id,
                amountCents: Math.round(parseFloat(paymentAmount) * 100),
              })}
              className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
              data-testid="btn-submit-payment"
            >
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editDialog} onOpenChange={() => { setEditDialog(null); setEditAmount(""); setEditReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Expected Amount</DialogTitle>
            <DialogDescription>
              {editDialog?.order?.invoiceNumber || editDialog?.invoiceNumber || `AR-${editDialog?.id}`}
              {editDialog?.order?.customerName ? ` — ${editDialog.order.customerName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground">Current Expected</p>
                <p className="font-medium">{formatCurrency(editDialog?.expectedAmountCents || 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Received</p>
                <p className="font-medium text-emerald-600">{formatCurrency(editDialog?.actualAmountCents || 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge className={`text-xs ${statusColors[editDialog?.status] || ""}`}>
                  {editDialog?.status || "OPEN"}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">New Expected Amount ($)</p>
              <Input
                type="number"
                step="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-edit-expected"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Reason for change</p>
              <Textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g., Rate adjustment, service downgrade..."
                rows={2}
                data-testid="input-edit-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditDialog(null); setEditAmount(""); setEditReason(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!editAmount || parseFloat(editAmount) < 0 || !editReason.trim() || editExpectedMutation.isPending}
              onClick={() => editExpectedMutation.mutate({
                id: editDialog.id,
                expectedAmountCents: Math.round(parseFloat(editAmount) * 100),
                reason: editReason.trim(),
              })}
              className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
              data-testid="btn-save-expected"
            >
              {editExpectedMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!satisfyDialog} onOpenChange={() => { setSatisfyDialog(null); setSatisfyReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Satisfied</DialogTitle>
            <DialogDescription>
              {satisfyDialog?.order?.invoiceNumber || satisfyDialog?.invoiceNumber || `AR-${satisfyDialog?.id}`}
              {satisfyDialog?.order?.customerName ? ` — ${satisfyDialog.order.customerName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground">Expected</p>
                <p className="font-medium">{formatCurrency(satisfyDialog?.expectedAmountCents || 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Received</p>
                <p className="font-medium text-emerald-600">{formatCurrency(satisfyDialog?.actualAmountCents || 0)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Balance</p>
                <p className="font-medium">{formatCurrency((satisfyDialog?.expectedAmountCents || 0) - (satisfyDialog?.actualAmountCents || 0))}</p>
              </div>
            </div>
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
              This will mark the AR as satisfied regardless of the current balance. The linked order will also be updated to Paid status.
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Reason for manual satisfaction</p>
              <Textarea
                value={satisfyReason}
                onChange={(e) => setSatisfyReason(e.target.value)}
                placeholder="e.g., Payment confirmed outside system, credit applied..."
                rows={2}
                data-testid="input-satisfy-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSatisfyDialog(null); setSatisfyReason(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!satisfyReason.trim() || markSatisfiedMutation.isPending}
              onClick={() => markSatisfiedMutation.mutate({
                id: satisfyDialog.id,
                reason: satisfyReason.trim(),
              })}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="btn-confirm-satisfy"
            >
              {markSatisfiedMutation.isPending ? "Saving..." : "Mark Satisfied"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
