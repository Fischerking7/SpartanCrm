import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Shield, Loader2 } from "lucide-react";

function cents(val: number) {
  const dollars = typeof val === "string" ? parseFloat(val) : val;
  return "$" + dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function OverrideCard({ item, userId, onApprove, onReject, isApproving, isRejecting }: {
  item: any; userId: string; onApprove: () => void; onReject: () => void; isApproving: boolean; isRejecting: boolean;
}) {
  const isSelf = item.recipientUserId === userId;
  const daysWaiting = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (24 * 60 * 60 * 1000));

  return (
    <Card className={isSelf ? "opacity-50" : ""} data-testid={`card-override-${item.id}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge variant="outline" className="text-xs mb-1">{item.overrideType?.replace(/_/g, " ")}</Badge>
            <p className="font-mono text-lg font-bold">{cents(item.amount)}</p>
          </div>
          <Badge variant="secondary" className="text-xs">{daysWaiting}d waiting</Badge>
        </div>
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p>Recipient: <span className="text-foreground">{item.recipientName || "Unknown"}</span></p>
          <p>Source Rep: <span className="text-foreground">{item.sourceRepName || item.sourceRepId || "N/A"}</span></p>
          {item.customerName && <p>Customer: <span className="text-foreground">{item.customerName}</span></p>}
          {item.serviceName && <p>Service: <span className="text-foreground">{item.serviceName}</span></p>}
        </div>
        {!isSelf && (
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={onApprove} disabled={isApproving} className="flex-1" data-testid={`button-approve-override-${item.id}`}>
              {isApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5 mr-1" />}
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={onReject} disabled={isRejecting} className="flex-1" data-testid={`button-reject-override-${item.id}`}>
              {isRejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5 mr-1" />}
              Reject
            </Button>
          </div>
        )}
        {isSelf && <p className="text-xs text-muted-foreground italic pt-1">Cannot approve own override</p>}
      </CardContent>
    </Card>
  );
}

export default function ExecOverrides() {
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: overrides, isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/override-earnings/pending"] });
  const { data: countData } = useQuery<any>({ queryKey: ["/api/admin/override-earnings/pending/count"] });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/admin/override-earnings/${id}/approve`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending/count"] });
      toast({ title: "Override approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/admin/override-earnings/${id}/reject`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending/count"] });
      toast({ title: "Override rejected" });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => { await apiRequest("POST", "/api/admin/override-earnings/bulk-approve", { ids }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending/count"] });
      toast({ title: "Bulk approval complete" });
    },
    onError: () => toast({ title: "Bulk approval failed", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  const all = overrides || [];
  const userId = user?.id || "";
  const directorOverrides = all.filter((o: any) => o.overrideType === "DIRECTOR_OVERRIDE");
  const accountingOverrides = all.filter((o: any) => o.overrideType === "ACCOUNTING_OVERRIDE");
  const adminOverrides = all.filter((o: any) => o.overrideType === "ADMIN_OVERRIDE");

  const eligibleForBulk = all.filter((o: any) => o.recipientUserId !== userId).map((o: any) => o.id);

  function renderGrid(items: any[]) {
    if (items.length === 0) return <p className="text-center text-sm text-muted-foreground py-8">No pending overrides</p>;
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item: any) => (
          <OverrideCard
            key={item.id}
            item={item}
            userId={userId}
            onApprove={() => approveMutation.mutate(item.id)}
            onReject={() => rejectMutation.mutate(item.id)}
            isApproving={approveMutation.isPending}
            isRejecting={rejectMutation.isPending}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Override Approvals</h2>
          {countData?.count > 0 && <Badge variant="destructive" className="text-xs">{countData.count}</Badge>}
        </div>
        {eligibleForBulk.length > 0 && (
          <Button
            onClick={() => bulkApproveMutation.mutate(eligibleForBulk)}
            disabled={bulkApproveMutation.isPending}
            data-testid="button-bulk-approve-all"
          >
            {bulkApproveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Bulk Approve All ({eligibleForBulk.length})
          </Button>
        )}
      </div>

      <Tabs defaultValue="all">
        <TabsList data-testid="tabs-override-type">
          <TabsTrigger value="all" data-testid="tab-all-overrides">All Pending ({all.length})</TabsTrigger>
          <TabsTrigger value="director" data-testid="tab-director-overrides">Director ({directorOverrides.length})</TabsTrigger>
          <TabsTrigger value="accounting" data-testid="tab-accounting-overrides">Accounting ({accountingOverrides.length})</TabsTrigger>
          <TabsTrigger value="admin" data-testid="tab-admin-overrides">Admin ({adminOverrides.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">{renderGrid(all)}</TabsContent>
        <TabsContent value="director">{renderGrid(directorOverrides)}</TabsContent>
        <TabsContent value="accounting">{renderGrid(accountingOverrides)}</TabsContent>
        <TabsContent value="admin">{renderGrid(adminOverrides)}</TabsContent>
      </Tabs>
    </div>
  );
}
