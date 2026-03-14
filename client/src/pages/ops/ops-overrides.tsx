import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Scale, CheckCircle2, XCircle, AlertTriangle, DollarSign, User
} from "lucide-react";

function formatCurrency(v: number | string) {
  const num = typeof v === "string" ? parseFloat(v) : v;
  return "$" + (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function OpsOverrides() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [tab, setTab] = useState("pending");

  const { data: overridesData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/overrides"],
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/overrides/approve-earning/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: "Override approved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const overrides = overridesData?.overrides || overridesData?.earnings || overridesData || [];
  const list = Array.isArray(overrides) ? overrides : [];

  const pending = list.filter((o: any) => o.approvalStatus === "PENDING" || o.status === "PENDING");
  const approved = list.filter((o: any) => o.approvalStatus === "APPROVED" || o.status === "APPROVED");
  const rejected = list.filter((o: any) => o.approvalStatus === "REJECTED" || o.status === "REJECTED");

  const getDisplayList = () => {
    switch (tab) {
      case "pending": return pending;
      case "approved": return approved;
      case "rejected": return rejected;
      default: return list;
    }
  };

  const bulkApprove = () => {
    const approvable = pending.filter((o: any) => o.recipientUserId !== user?.id);
    if (approvable.length === 0) {
      toast({ title: "No overrides to approve" });
      return;
    }
    approvable.forEach((o: any) => approveMutation.mutate(o.id));
  };

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-overrides">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Override Approvals</h1>
          <p className="text-sm text-muted-foreground">Review and approve override earnings</p>
        </div>
        {pending.length > 0 && (
          <Button onClick={bulkApprove} disabled={approveMutation.isPending}
            className="bg-[#C9A84C] hover:bg-[#b8973e] text-white" data-testid="btn-bulk-approve">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Bulk Approve ({pending.filter((o: any) => o.recipientUserId !== user?.id).length})
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList data-testid="override-tabs">
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Approved ({approved.length})
          </TabsTrigger>
          <TabsTrigger value="rejected" data-testid="tab-rejected">
            Rejected ({rejected.length})
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">
            All ({list.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : getDisplayList().length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <Scale className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No overrides in this category</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {getDisplayList().map((override: any) => {
            const isSelfOwned = override.recipientUserId === user?.id;
            const isPending = override.approvalStatus === "PENDING" || override.status === "PENDING";
            return (
              <Card
                key={override.id}
                className={`border-0 shadow-sm ${isSelfOwned ? "opacity-60" : ""}`}
                data-testid={`override-card-${override.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-[#1B2A4A] flex items-center justify-center shrink-0">
                        <User className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">{override.recipientName || override.repName || "—"}</p>
                          <Badge variant="secondary" className="text-xs">
                            {override.overrideType || override.type || "Override"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {override.description || `Tier ${override.tier || 1}`}
                          {override.orderInvoice && ` · ${override.orderInvoice}`}
                        </p>
                        <p className="text-lg font-bold text-[#C9A84C] mt-1">
                          {formatCurrency(override.amount || override.overrideAmount || 0)}
                        </p>
                        {override.createdAt && (
                          <p className="text-xs text-muted-foreground">{formatDate(override.createdAt)}</p>
                        )}
                        {isSelfOwned && (
                          <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Cannot approve your own override
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {isPending && !isSelfOwned && (
                        <>
                          <Button size="sm" onClick={() => approveMutation.mutate(override.id)}
                            disabled={approveMutation.isPending}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            data-testid={`btn-approve-${override.id}`}>
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                          </Button>
                        </>
                      )}
                      {!isPending && (
                        <Badge className={`text-xs ${
                          override.approvalStatus === "APPROVED" || override.status === "APPROVED"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }`}>
                          {override.approvalStatus || override.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
