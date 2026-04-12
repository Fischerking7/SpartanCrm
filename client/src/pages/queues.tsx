import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { AlertTriangle, DollarSign, FileText, Check, Flag } from "lucide-react";
import type { UnmatchedPayment, UnmatchedChargeback, RateIssue, OrderException } from "@shared/schema";

export default function Queues() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [resolvingItem, setResolvingItem] = useState<{ type: string; id: string } | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  const searchParams = new URLSearchParams(window.location.search);
  const defaultTab = searchParams.get("tab") || "payments";

  const { data: unmatchedPayments, isLoading: paymentsLoading } = useQuery<UnmatchedPayment[]>({
    queryKey: ["/api/admin/queues/unmatched-payments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/queues/unmatched-payments", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("queues.failedToFetch"));
      return res.json();
    },
  });

  const { data: unmatchedChargebacks, isLoading: chargebacksLoading } = useQuery<UnmatchedChargeback[]>({
    queryKey: ["/api/admin/queues/unmatched-chargebacks"],
    queryFn: async () => {
      const res = await fetch("/api/admin/queues/unmatched-chargebacks", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("queues.failedToFetch"));
      return res.json();
    },
  });

  const { data: rateIssues, isLoading: ratesLoading } = useQuery<RateIssue[]>({
    queryKey: ["/api/admin/queues/rate-issues"],
    queryFn: async () => {
      const res = await fetch("/api/admin/queues/rate-issues", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("queues.failedToFetch"));
      return res.json();
    },
  });

  const { data: orderExceptions, isLoading: exceptionsLoading } = useQuery<OrderException[]>({
    queryKey: ["/api/admin/queues/order-exceptions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/queues/order-exceptions", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(t("queues.failedToFetch"));
      return res.json();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ type, id, note }: { type: string; id: string; note: string }) => {
      const res = await fetch(`/api/admin/queues/${type}/${id}/resolve`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNote: note }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || t("queues.failedToResolve"));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues/unmatched-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues/unmatched-chargebacks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues/rate-issues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues/order-exceptions"] });
      setResolvingItem(null);
      setResolutionNote("");
      toast({ title: t("queues.issueResolved") });
    },
    onError: (error: Error) => {
      toast({ title: t("queues.failedToResolve"), description: error.message, variant: "destructive" });
    },
  });

  const paymentColumns = [
    {
      key: "reason",
      header: t("queues.reason"),
      cell: (row: UnmatchedPayment) => <span className="text-sm">{row.reason}</span>,
    },
    {
      key: "rawRowJson",
      header: t("queues.rawData"),
      cell: (row: UnmatchedPayment) => (
        <code className="text-xs bg-muted px-2 py-1 rounded block max-w-[300px] truncate">
          {row.rawRowJson}
        </code>
      ),
    },
    {
      key: "createdAt",
      header: t("queues.created"),
      cell: (row: UnmatchedPayment) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "status",
      header: t("queues.status"),
      cell: (row: UnmatchedPayment) => (
        row.resolvedAt ? (
          <Badge variant="default">{t("queues.resolved")}</Badge>
        ) : (
          <Badge variant="secondary">{t("queues.pending")}</Badge>
        )
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: UnmatchedPayment) => (
        !row.resolvedAt && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResolvingItem({ type: "unmatched-payments", id: row.id })}
            data-testid={`button-resolve-payment-${row.id}`}
          >
            <Check className="h-4 w-4 mr-1" />
            {t("queues.resolve")}
          </Button>
        )
      ),
    },
  ];

  const chargebackColumns = [
    {
      key: "reason",
      header: t("queues.reason"),
      cell: (row: UnmatchedChargeback) => <span className="text-sm">{row.reason}</span>,
    },
    {
      key: "rawRowJson",
      header: t("queues.rawData"),
      cell: (row: UnmatchedChargeback) => (
        <code className="text-xs bg-muted px-2 py-1 rounded block max-w-[300px] truncate">
          {row.rawRowJson}
        </code>
      ),
    },
    {
      key: "createdAt",
      header: t("queues.created"),
      cell: (row: UnmatchedChargeback) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "status",
      header: t("queues.status"),
      cell: (row: UnmatchedChargeback) => (
        row.resolvedAt ? (
          <Badge variant="default">{t("queues.resolved")}</Badge>
        ) : (
          <Badge variant="secondary">{t("queues.pending")}</Badge>
        )
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: UnmatchedChargeback) => (
        !row.resolvedAt && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResolvingItem({ type: "unmatched-chargebacks", id: row.id })}
            data-testid={`button-resolve-chargeback-${row.id}`}
          >
            <Check className="h-4 w-4 mr-1" />
            {t("queues.resolve")}
          </Button>
        )
      ),
    },
  ];

  const rateColumns = [
    {
      key: "salesOrderId",
      header: t("queues.order"),
      cell: (row: RateIssue) => (
        <span className="font-mono text-sm">{row.salesOrderId.slice(0, 8)}...</span>
      ),
    },
    {
      key: "type",
      header: t("queues.issueType"),
      cell: (row: RateIssue) => (
        <Badge variant={row.type === "MISSING_RATE" ? "destructive" : "secondary"}>
          {row.type === "MISSING_RATE" ? t("queues.missingRate") : t("queues.rateConflict")}
        </Badge>
      ),
    },
    {
      key: "details",
      header: t("queues.details"),
      cell: (row: RateIssue) => <span className="text-sm">{row.details}</span>,
    },
    {
      key: "createdAt",
      header: t("queues.created"),
      cell: (row: RateIssue) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "status",
      header: t("queues.status"),
      cell: (row: RateIssue) => (
        row.resolvedAt ? (
          <Badge variant="default">{t("queues.resolved")}</Badge>
        ) : (
          <Badge variant="secondary">{t("queues.pending")}</Badge>
        )
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: RateIssue) => (
        !row.resolvedAt && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResolvingItem({ type: "rate-issues", id: row.id })}
            data-testid={`button-resolve-rate-${row.id}`}
          >
            <Check className="h-4 w-4 mr-1" />
            {t("queues.resolve")}
          </Button>
        )
      ),
    },
  ];

  const exceptionColumns = [
    {
      key: "salesOrderId",
      header: t("queues.order"),
      cell: (row: any) => (
        <div>
          <div className="font-medium text-sm">{row.invoiceNumber || row.salesOrderId.slice(0, 8) + "..."}</div>
          {row.customerName && <div className="text-xs text-muted-foreground">{row.customerName}</div>}
          {row.repId && <div className="text-xs text-muted-foreground">{t("queues.rep", { repId: row.repId })}</div>}
        </div>
      ),
    },
    {
      key: "reason",
      header: t("queues.reason"),
      cell: (row: any) => <span className="text-sm">{row.reason}</span>,
    },
    {
      key: "flaggedBy",
      header: t("queues.flaggedBy"),
      cell: (row: any) => (
        <span className="text-sm text-muted-foreground">{row.flaggedByName || row.flaggedByUserId.slice(0, 8) + "..."}</span>
      ),
    },
    {
      key: "createdAt",
      header: t("queues.flagged"),
      cell: (row: any) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "status",
      header: t("queues.status"),
      cell: (row: any) => (
        row.resolvedAt ? (
          <Badge variant="default">{t("queues.resolved")}</Badge>
        ) : (
          <Badge variant="secondary">{t("queues.pending")}</Badge>
        )
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: any) => (
        !row.resolvedAt && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setResolvingItem({ type: "order-exceptions", id: row.id })}
            data-testid={`button-resolve-exception-${row.id}`}
          >
            <Check className="h-4 w-4 mr-1" />
            {t("queues.resolve")}
          </Button>
        )
      ),
    },
  ];

  const unresolvedPayments = unmatchedPayments?.filter(p => !p.resolvedAt) || [];
  const unresolvedChargebacks = unmatchedChargebacks?.filter(c => !c.resolvedAt) || [];
  const unresolvedRates = rateIssues?.filter(r => !r.resolvedAt) || [];
  const unresolvedExceptions = orderExceptions?.filter(e => !e.resolvedAt) || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("queues.title")}</h1>
        <p className="text-muted-foreground">
          {t("queues.subtitle")}
        </p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="payments" data-testid="tab-payments">
            <DollarSign className="h-4 w-4 mr-2" />
            {t("queues.unmatchedPayments")}
            {unresolvedPayments.length > 0 && (
              <Badge variant="destructive" className="ml-2">{unresolvedPayments.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="chargebacks" data-testid="tab-chargebacks">
            <AlertTriangle className="h-4 w-4 mr-2" />
            {t("queues.unmatchedChargebacks")}
            {unresolvedChargebacks.length > 0 && (
              <Badge variant="destructive" className="ml-2">{unresolvedChargebacks.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="rates" data-testid="tab-rates">
            <FileText className="h-4 w-4 mr-2" />
            {t("queues.rateIssues")}
            {unresolvedRates.length > 0 && (
              <Badge variant="destructive" className="ml-2">{unresolvedRates.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="flagged" data-testid="tab-flagged">
            <Flag className="h-4 w-4 mr-2" />
            {t("queues.flaggedOrders")}
            {unresolvedExceptions.length > 0 && (
              <Badge variant="destructive" className="ml-2">{unresolvedExceptions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={paymentColumns}
                data={unresolvedPayments}
                isLoading={paymentsLoading}
                emptyMessage={t("queues.noUnmatchedPayments")}
                testId="table-unmatched-payments"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chargebacks">
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={chargebackColumns}
                data={unresolvedChargebacks}
                isLoading={chargebacksLoading}
                emptyMessage={t("queues.noUnmatchedChargebacks")}
                testId="table-unmatched-chargebacks"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rates">
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={rateColumns}
                data={unresolvedRates}
                isLoading={ratesLoading}
                emptyMessage={t("queues.noRateIssues")}
                testId="table-rate-issues"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flagged">
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={exceptionColumns}
                data={unresolvedExceptions}
                isLoading={exceptionsLoading}
                emptyMessage={t("queues.noFlaggedOrders")}
                testId="table-flagged-orders"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!resolvingItem} onOpenChange={() => setResolvingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("queues.resolveIssue")}</DialogTitle>
            <DialogDescription>
              {t("queues.resolutionNoteDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("queues.resolutionNote")}</Label>
              <Textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder={t("queues.resolutionNotePlaceholder")}
                data-testid="input-resolution-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolvingItem(null)}>
              {t("queues.cancel")}
            </Button>
            <Button
              onClick={() => resolvingItem && resolveMutation.mutate({ ...resolvingItem, note: resolutionNote })}
              disabled={!resolutionNote.trim() || resolveMutation.isPending}
              data-testid="button-confirm-resolve"
            >
              {t("queues.markResolved")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
