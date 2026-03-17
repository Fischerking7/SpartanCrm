import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DollarSign, Plus, CheckCircle2, Clock, AlertTriangle,
  ChevronRight, ArrowRight, Users, FileText, Trash2
} from "lucide-react";

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: "Draft", color: "text-gray-700 dark:text-gray-300", bg: "bg-gray-100 dark:bg-gray-800" },
  PENDING_REVIEW: { label: "Pending Review", color: "text-blue-700 dark:text-blue-300", bg: "bg-blue-100 dark:bg-blue-900/30" },
  PENDING_APPROVAL: { label: "Pending Approval", color: "text-amber-700 dark:text-amber-300", bg: "bg-amber-100 dark:bg-amber-900/30" },
  APPROVED: { label: "Approved", color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  REJECTED: { label: "Rejected", color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-900/30" },
  FINALIZED: { label: "Finalized", color: "text-[#C9A84C]", bg: "bg-[#C9A84C]/20" },
  PAID: { label: "Paid", color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
};

const workflowSteps = [
  { step: 1, label: "Draft", description: "Initialize pay run" },
  { step: 2, label: "Review", description: "Verify amounts" },
  { step: 3, label: "Approval", description: "Management sign-off" },
  { step: 4, label: "Approved", description: "Ready to finalize" },
  { step: 5, label: "Finalize", description: "Lock & confirm" },
  { step: 6, label: "Paid", description: "Payments processed" },
];

function getStepFromStatus(status: string): number {
  switch (status) {
    case "DRAFT": return 1;
    case "PENDING_REVIEW": return 2;
    case "PENDING_APPROVAL": return 3;
    case "APPROVED": return 4;
    case "FINALIZED": return 5;
    case "PAID": return 6;
    default: return 1;
  }
}

function formatCurrency(v: number | string) {
  const num = typeof v === "string" ? parseFloat(v) : v;
  return "$" + (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function defaultDates() {
  const today = new Date();
  const end = today.toISOString().split("T")[0];
  const start = new Date(today.getTime() - 14 * 86400000).toISOString().split("T")[0];
  return { start, end };
}

export default function OpsPayRuns() {
  const { toast } = useToast();
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [finalizeConfirm, setFinalizeConfirm] = useState("");
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [weekEndingDate, setWeekEndingDate] = useState("");

  const { data: payRuns, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/payruns"],
  });

  const openCreateDialog = () => {
    const d = defaultDates();
    setPeriodStart(d.start);
    setPeriodEnd(d.end);
    setWeekEndingDate(d.end);
    setShowCreateDialog(true);
  };

  const createMutation = useMutation({
    mutationFn: async ({ periodStart, periodEnd, weekEndingDate }: { periodStart: string; periodEnd: string; weekEndingDate: string }) => {
      const res = await apiRequest("POST", "/api/admin/payruns", {
        periodStart,
        periodEnd,
        weekEndingDate,
        name: `Pay Run ${periodStart} to ${periodEnd}`,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      const orderCount = data.orderCount || 0;
      toast({ title: "Pay run created", description: `${orderCount} order${orderCount !== 1 ? 's' : ''} collected for this period` });
      setShowCreateDialog(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const submitReviewMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/payruns/${id}/submit-review`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Submitted for review" });
      setSelectedRun(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const submitApprovalMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/payruns/${id}/submit-approval`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Submitted for approval" });
      setSelectedRun(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/payruns/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run approved" });
      setSelectedRun(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/payruns/${id}/reject`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run rejected and returned to draft" });
      setSelectedRun(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/payruns/${id}/finalize`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run finalized" });
      setSelectedRun(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/payruns/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run deleted" });
      setSelectedRun(null);
      setShowDeleteDialog(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/payroll/backfill-ready");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Backfill complete", description: `${data.ordersUpdated} orders marked payroll-ready` });
    },
    onError: (err: any) => {
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    },
  });

  const runs = payRuns?.payRuns || payRuns || [];

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-payruns">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pay Runs</h1>
          <p className="text-sm text-muted-foreground">Manage payroll processing workflow</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending} data-testid="btn-backfill-ready">
            {backfillMutation.isPending ? "Processing..." : "Sync Payroll-Ready Orders"}
          </Button>
          <Button onClick={openCreateDialog} data-testid="btn-create-payrun">
            <Plus className="h-4 w-4 mr-2" />
            New Pay Run
          </Button>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Workflow Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {workflowSteps.map((ws, i) => (
              <div key={ws.step} className="flex items-center shrink-0">
                <div className="flex flex-col items-center">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    selectedRun && getStepFromStatus(selectedRun.status) >= ws.step
                      ? "bg-[#C9A84C] text-white"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {ws.step}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 text-center w-16">{ws.label}</p>
                </div>
                {i < workflowSteps.length - 1 && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (Array.isArray(runs) ? runs : []).length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No pay runs yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(Array.isArray(runs) ? runs : []).map((run: any) => {
            const cfg = statusConfig[run.status] || statusConfig.DRAFT;
            const currentStep = getStepFromStatus(run.status);
            return (
              <Card
                key={run.id}
                className={`border-0 shadow-sm cursor-pointer transition-shadow hover:shadow-md ${
                  selectedRun?.id === run.id ? "ring-2 ring-[#C9A84C]" : ""
                }`}
                onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}
                data-testid={`payrun-card-${run.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold">Pay Run #{run.id}</p>
                        <Badge className={`${cfg.bg} ${cfg.color} text-xs`} data-testid={`payrun-status-${run.id}`}>
                          {cfg.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {run.periodStart && run.periodEnd
                          ? `${formatDate(run.periodStart)} — ${formatDate(run.periodEnd)}`
                          : `Created ${formatDate(run.createdAt)}`}
                      </p>
                      {run.totalAmount && (
                        <p className="text-sm font-medium text-[#C9A84C] mt-1">
                          Total: {formatCurrency(run.totalAmount)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        <span>{run.repCount || 0} reps</span>
                      </div>
                      <span>{run.orderCount || 0} orders</span>
                    </div>
                  </div>

                  {selectedRun?.id === run.id && (
                    <div className="mt-4 pt-4 border-t space-y-3">
                      <div className="flex items-center gap-1">
                        {workflowSteps.map((ws, i) => (
                          <div key={ws.step} className="flex items-center">
                            <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              currentStep >= ws.step ? "bg-[#C9A84C] text-white" : "bg-muted text-muted-foreground"
                            }`}>
                              {currentStep > ws.step ? <CheckCircle2 className="h-3.5 w-3.5" /> : ws.step}
                            </div>
                            {i < workflowSteps.length - 1 && (
                              <div className={`h-0.5 w-4 ${currentStep > ws.step ? "bg-[#C9A84C]" : "bg-muted"}`} />
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        {run.status === "DRAFT" && (
                          <Button size="sm" onClick={(e) => { e.stopPropagation(); submitReviewMutation.mutate(run.id); }}
                            disabled={submitReviewMutation.isPending} data-testid={`btn-submit-review-${run.id}`}>
                            <ArrowRight className="h-3.5 w-3.5 mr-1" /> Submit for Review
                          </Button>
                        )}
                        {run.status === "PENDING_REVIEW" && (
                          <>
                            <Button size="sm" onClick={(e) => { e.stopPropagation(); submitApprovalMutation.mutate(run.id); }}
                              disabled={submitApprovalMutation.isPending} data-testid={`btn-submit-approval-${run.id}`}>
                              <ArrowRight className="h-3.5 w-3.5 mr-1" /> Submit for Approval
                            </Button>
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); rejectMutation.mutate(run.id); }}
                              disabled={rejectMutation.isPending} data-testid={`btn-reject-review-${run.id}`}>
                              Return to Draft
                            </Button>
                          </>
                        )}
                        {["DRAFT", "PENDING_REVIEW", "REJECTED"].includes(run.status) && (
                          <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); setSelectedRun(run); setShowDeleteDialog(true); }}
                            data-testid={`btn-delete-${run.id}`}>
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                          </Button>
                        )}
                        {run.status === "PENDING_APPROVAL" && (
                          <>
                            <Button size="sm" onClick={(e) => { e.stopPropagation(); approveMutation.mutate(run.id); }}
                              disabled={approveMutation.isPending} data-testid={`btn-approve-${run.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); rejectMutation.mutate(run.id); }}
                              disabled={rejectMutation.isPending} data-testid={`btn-reject-approval-${run.id}`}>
                              Reject
                            </Button>
                          </>
                        )}
                        {run.status === "APPROVED" && (
                          <Button size="sm" className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
                            onClick={(e) => { e.stopPropagation(); setShowFinalizeDialog(true); }}
                            data-testid={`btn-finalize-${run.id}`}>
                            Finalize Pay Run
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Pay Run</DialogTitle>
            <DialogDescription>Select the date range for this pay run.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Period Start</p>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  data-testid="input-period-start"
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Period End</p>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => {
                    setPeriodEnd(e.target.value);
                    setWeekEndingDate(e.target.value);
                  }}
                  data-testid="input-period-end"
                />
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Week Ending Date</p>
              <Input
                type="date"
                value={weekEndingDate}
                onChange={(e) => setWeekEndingDate(e.target.value)}
                data-testid="input-week-ending"
              />
            </div>
            {periodStart && periodEnd && (
              <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                Pay run will cover <span className="font-medium text-foreground">{formatDate(periodStart)}</span> through <span className="font-medium text-foreground">{formatDate(periodEnd)}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              disabled={!periodStart || !periodEnd || !weekEndingDate || periodStart > periodEnd || createMutation.isPending}
              onClick={() => createMutation.mutate({ periodStart, periodEnd, weekEndingDate })}
              className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
              data-testid="btn-confirm-create-payrun"
            >
              {createMutation.isPending ? "Creating..." : "Create Pay Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize Pay Run</DialogTitle>
            <DialogDescription>
              This action is irreversible. Type "FINALIZE" to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={finalizeConfirm}
            onChange={(e) => setFinalizeConfirm(e.target.value)}
            placeholder='Type "FINALIZE" to confirm'
            data-testid="input-finalize-confirm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowFinalizeDialog(false); setFinalizeConfirm(""); }}>
              Cancel
            </Button>
            <Button
              disabled={finalizeConfirm !== "FINALIZE" || finalizeMutation.isPending}
              className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
              onClick={() => {
                if (selectedRun) {
                  finalizeMutation.mutate(selectedRun.id);
                }
                setShowFinalizeDialog(false);
                setFinalizeConfirm("");
              }}
              data-testid="btn-confirm-finalize"
            >
              Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pay Run</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this pay run? This will unlink all associated orders and remove any generated pay statements. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} data-testid="btn-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (selectedRun) {
                  deleteMutation.mutate(selectedRun.id);
                }
              }}
              data-testid="btn-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Pay Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
