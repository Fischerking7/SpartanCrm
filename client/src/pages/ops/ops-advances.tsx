import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CreditCard, CheckCircle2, Clock, DollarSign, User, Banknote
} from "lucide-react";

function formatCurrency(v: number | string) {
  const num = typeof v === "string" ? parseFloat(v) : v;
  return "$" + (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: "Pending", color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-900/30" },
  APPROVED: { label: "Approved", color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30" },
  PAID: { label: "Paid", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  REJECTED: { label: "Rejected", color: "text-red-700 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30" },
  REPAID: { label: "Repaid", color: "text-gray-700 dark:text-gray-400", bg: "bg-gray-100 dark:bg-gray-800" },
};

export default function OpsAdvances() {
  const { toast } = useToast();
  const [tab, setTab] = useState("pending");

  const { data: advancesData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/payroll/advances"],
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/payroll/advances/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      toast({ title: "Advance approved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/admin/payroll/advances/${id}/mark-paid`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      toast({ title: "Advance marked as paid" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const advances = advancesData?.advances || advancesData || [];
  const list = Array.isArray(advances) ? advances : [];

  const pending = list.filter((a: any) => a.status === "PENDING");
  const approved = list.filter((a: any) => a.status === "APPROVED");
  const completed = list.filter((a: any) => ["PAID", "REPAID", "REJECTED"].includes(a.status));

  const getDisplayList = () => {
    switch (tab) {
      case "pending": return pending;
      case "approved": return approved;
      case "completed": return completed;
      default: return list;
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-advances">
      <div>
        <h1 className="text-2xl font-bold">Advances</h1>
        <p className="text-sm text-muted-foreground">Manage advance requests and payments</p>
      </div>

      <div className="grid grid-cols-3 gap-3" data-testid="advances-summary">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <Clock className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pending.length}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{approved.length}</p>
              <p className="text-xs text-muted-foreground">Approved</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[#C9A84C]/20 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-[#C9A84C]" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {formatCurrency(list.filter((a: any) => a.status !== "REJECTED").reduce((sum: number, a: any) => sum + parseFloat(a.amount || "0"), 0))}
              </p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList data-testid="advances-tabs">
          <TabsTrigger value="pending" data-testid="tab-pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">Approved ({approved.length})</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">Completed ({completed.length})</TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">All ({list.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : getDisplayList().length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No advances in this category</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {getDisplayList().map((advance: any) => {
            const cfg = statusConfig[advance.status] || statusConfig.PENDING;
            return (
              <Card key={advance.id} className="border-0 shadow-sm" data-testid={`advance-card-${advance.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-[#1B2A4A] flex items-center justify-center shrink-0">
                        <User className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">{advance.repName || "—"}</p>
                          <Badge className={`text-xs ${cfg.bg} ${cfg.color}`}>{cfg.label}</Badge>
                        </div>
                        <p className="text-lg font-bold text-[#C9A84C] mt-1">{formatCurrency(advance.amount || 0)}</p>
                        {advance.reason && (
                          <p className="text-sm text-muted-foreground mt-0.5">{advance.reason}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Requested: {formatDate(advance.createdAt || advance.requestDate || new Date())}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {advance.status === "PENDING" && (
                        <Button size="sm" onClick={() => approveMutation.mutate(advance.id)}
                          disabled={approveMutation.isPending}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          data-testid={`btn-approve-advance-${advance.id}`}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                        </Button>
                      )}
                      {advance.status === "APPROVED" && (
                        <Button size="sm" onClick={() => markPaidMutation.mutate(advance.id)}
                          disabled={markPaidMutation.isPending}
                          className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
                          data-testid={`btn-mark-paid-${advance.id}`}>
                          <Banknote className="h-3.5 w-3.5 mr-1" /> Mark Paid
                        </Button>
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
