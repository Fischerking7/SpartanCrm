import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CheckCircle, XCircle, Shield, Loader2, Clock
} from "lucide-react";

function fmt(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export default function AcctOverrides() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [tab, setTab] = useState("admin");

  const { data: pendingData, isLoading } = useQuery<any>({ queryKey: ["/api/admin/override-earnings/pending"] });
  const { data: countData } = useQuery<any>({ queryKey: ["/api/admin/override-earnings/pending/count"] });

  const pending = pendingData?.overrides || pendingData || [];
  const adminOverrides = pending.filter((o: any) => o.overrideType === "ADMIN_OVERRIDE");
  const accountingOverrides = pending.filter((o: any) => o.overrideType === "ACCOUNTING_OVERRIDE");

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/override-earnings/${id}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending/count"] });
      toast({ title: "Override approved" });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/override-earnings/${id}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending/count"] });
      toast({ title: "Override rejected" });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to reject", variant: "destructive" }),
  });

  const bulkApprove = useMutation({
    mutationFn: async (type: string) => {
      const eligible = (type === "admin" ? adminOverrides : accountingOverrides)
        .filter((o: any) => o.recipientUserId !== user?.id);
      if (eligible.length === 0) { toast({ title: "No eligible overrides to approve" }); return; }
      await apiRequest("POST", "/api/admin/override-earnings/bulk-approve", {
        ids: eligible.map((o: any) => o.id),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending/count"] });
      toast({ title: "Bulk approval completed" });
    },
    onError: () => toast({ title: "Bulk approval failed", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  const renderOverrideCard = (o: any) => {
    const isSelf = o.recipientUserId === user?.id;
    return (
      <Card key={o.id} className={`${isSelf ? "opacity-60" : ""}`} data-testid={`card-override-${o.id}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{o.overrideType?.replace(/_/g, " ")} — {fmt(o.amount || 0)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Rep: {o.sourceRepName || o.sourceRepId || "Unknown"} | {o.serviceName || "Service"}
              </p>
              <p className="text-xs text-muted-foreground">
                Customer: {o.customerName || "Unknown"} | Inv: {o.invoiceNumber || "N/A"}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Waiting: {daysSince(o.createdAt)} days
                </span>
                <span>Recipient: {o.recipientName || o.recipientUserId?.slice(0, 8)}</span>
              </div>
              {isSelf && (
                <p className="text-xs text-amber-600 mt-1">You are the recipient — cannot self-approve</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge variant="outline">${parseFloat(o.amount || "0").toFixed(2)} Impact</Badge>
              {!isSelf && (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => approveMutation.mutate(o.id)} disabled={approveMutation.isPending} data-testid={`button-approve-${o.id}`}>
                    {approveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5 mr-1" />}
                    Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => rejectMutation.mutate(o.id)} disabled={rejectMutation.isPending} data-testid={`button-reject-${o.id}`}>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-overrides">
      <h1 className="text-xl font-semibold">Override Approvals</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="admin" data-testid="tab-admin-overrides">
            Admin Overrides ({adminOverrides.length})
          </TabsTrigger>
          <TabsTrigger value="accounting" data-testid="tab-accounting-overrides">
            Accounting Overrides ({accountingOverrides.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="admin">
          <div className="space-y-3">
            {adminOverrides.length > 0 && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => bulkApprove.mutate("admin")} disabled={bulkApprove.isPending} data-testid="button-bulk-approve-admin">
                  {bulkApprove.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Bulk Approve All Eligible
                </Button>
              </div>
            )}
            {adminOverrides.length === 0 && (
              <Card><CardContent className="p-6 text-center text-muted-foreground">No pending admin overrides</CardContent></Card>
            )}
            {adminOverrides.map(renderOverrideCard)}
          </div>
        </TabsContent>

        <TabsContent value="accounting">
          <div className="space-y-3">
            {accountingOverrides.length > 0 && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => bulkApprove.mutate("accounting")} disabled={bulkApprove.isPending} data-testid="button-bulk-approve-accounting">
                  {bulkApprove.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Bulk Approve All Eligible
                </Button>
              </div>
            )}
            {accountingOverrides.length === 0 && (
              <Card><CardContent className="p-6 text-center text-muted-foreground">No pending accounting overrides</CardContent></Card>
            )}
            {accountingOverrides.map(renderOverrideCard)}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
