import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Calendar, Lock, Check, Eye, DollarSign, Users, FileText, Link, Trash2, Unlink, Send, CheckCircle, XCircle, ClipboardCheck, FileSearch, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PayRun, SalesOrder } from "@shared/schema";

interface EnrichedPayRun extends PayRun {
  orderCount: number;
  totalCommission: string;
}

interface PayRunDetails extends PayRun {
  orders: SalesOrder[];
  stats: {
    totalOrders: number;
    totalCommission: string;
    repBreakdown: { name: string; total: number; count: number }[];
  };
}

interface VarianceReport {
  payRunId: string;
  status: string;
  orderCount: number;
  statementCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNetPay: string;
  issues: string[];
  canFinalize: boolean;
  repSummaries: { repId: string; name: string; gross: number; deductions: number; net: number; hasNegative: boolean }[];
}

export default function PayRuns() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showVarianceDialog, setShowVarianceDialog] = useState(false);
  const [varianceReport, setVarianceReport] = useState<VarianceReport | null>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);
  const [selectedPayRun, setSelectedPayRun] = useState<PayRunDetails | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [unlinkOrderIds, setUnlinkOrderIds] = useState<string[]>([]);
  const [weekEndingDate, setWeekEndingDate] = useState("");
  const [payRunName, setPayRunName] = useState("");
  const [payRunToDelete, setPayRunToDelete] = useState<PayRun | null>(null);
  const [variancePayRunId, setVariancePayRunId] = useState<string | null>(null);

  const { data: payRuns, isLoading } = useQuery<EnrichedPayRun[]>({
    queryKey: ["/api/admin/payruns"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay runs");
      return res.json();
    },
  });

  const { data: unlinkedOrders } = useQuery<SalesOrder[]>({
    queryKey: ["/api/admin/payruns/unlinked-orders"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns/unlinked-orders", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showLinkDialog,
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, weekEndingDate }: { name: string; weekEndingDate: string }) => {
      const res = await fetch("/api/admin/payruns", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, weekEndingDate }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create pay run");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      setShowCreateDialog(false);
      setWeekEndingDate("");
      setPayRunName("");
      toast({ title: "Pay run created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create pay run", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete pay run");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      setShowDeleteDialog(false);
      setPayRunToDelete(null);
      toast({ title: "Pay run deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete pay run", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/finalize`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to finalize");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run finalized" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to finalize", description: error.message, variant: "destructive" });
    },
  });

  const submitReviewMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/submit-review`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to submit for review");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run submitted for review" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit", description: error.message, variant: "destructive" });
    },
  });

  const submitApprovalMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/submit-approval`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to submit for approval");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run submitted for approval" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit", description: error.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/approve`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to approve");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run approved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/reject`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reject");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run rejected and returned to draft" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject", description: error.message, variant: "destructive" });
    },
  });

  const fetchVarianceReport = async (payRunId: string) => {
    setVarianceLoading(true);
    setVariancePayRunId(payRunId);
    try {
      const res = await fetch(`/api/admin/payruns/${payRunId}/variance`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch variance report");
      const report = await res.json();
      setVarianceReport(report);
      setShowVarianceDialog(true);
    } catch (error) {
      toast({ title: "Failed to load variance report", variant: "destructive" });
    } finally {
      setVarianceLoading(false);
    }
  };

  const linkOrdersMutation = useMutation({
    mutationFn: async ({ payRunId, orderIds }: { payRunId: string; orderIds: string[] }) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/link-orders`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to link orders");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns/unlinked-orders"] });
      setShowLinkDialog(false);
      setSelectedOrderIds([]);
      toast({ title: `${data.linked} orders linked to pay run` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to link orders", description: error.message, variant: "destructive" });
    },
  });

  const unlinkOrdersMutation = useMutation({
    mutationFn: async ({ payRunId, orderIds }: { payRunId: string; orderIds: string[] }) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/unlink-orders`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to unlink orders");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      setUnlinkOrderIds([]);
      if (selectedPayRun) {
        viewPayRun(selectedPayRun.id);
      }
      toast({ title: `${data.unlinked} orders unlinked from pay run` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to unlink orders", description: error.message, variant: "destructive" });
    },
  });

  const viewPayRun = async (payRunId: string) => {
    try {
      const res = await fetch(`/api/admin/payruns/${payRunId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay run details");
      const details = await res.json();
      setSelectedPayRun(details);
      setUnlinkOrderIds([]);
      setShowDetailsDialog(true);
    } catch (error) {
      toast({ title: "Failed to load pay run details", variant: "destructive" });
    }
  };

  const openLinkDialog = (payRun: PayRun) => {
    setSelectedPayRun(payRun as PayRunDetails);
    setSelectedOrderIds([]);
    setShowLinkDialog(true);
  };

  const openDeleteDialog = (payRun: PayRun) => {
    setPayRunToDelete(payRun);
    setShowDeleteDialog(true);
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const toggleUnlinkSelection = (orderId: string) => {
    setUnlinkOrderIds(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      cell: (row: EnrichedPayRun) => (
        <span className="font-medium">{row.name || "Untitled"}</span>
      ),
    },
    {
      key: "weekEndingDate",
      header: "Week Ending",
      cell: (row: EnrichedPayRun) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span>{new Date(row.weekEndingDate).toLocaleDateString()}</span>
        </div>
      ),
    },
    {
      key: "orderCount",
      header: "Orders",
      cell: (row: EnrichedPayRun) => (
        <Badge variant="secondary">{row.orderCount}</Badge>
      ),
    },
    {
      key: "totalCommission",
      header: "Total",
      cell: (row: EnrichedPayRun) => (
        <span className="font-mono">${row.totalCommission}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row: EnrichedPayRun) => {
        const statusConfig: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string; icon?: typeof Lock }> = {
          DRAFT: { variant: "secondary", label: "Draft" },
          PENDING_REVIEW: { variant: "outline", label: "Pending Review" },
          PENDING_APPROVAL: { variant: "outline", label: "Pending Approval" },
          APPROVED: { variant: "default", label: "Approved" },
          FINALIZED: { variant: "default", label: "Finalized", icon: Lock },
        };
        const config = statusConfig[row.status] || statusConfig.DRAFT;
        return (
          <Badge variant={config.variant}>
            {config.icon && <Lock className="h-3 w-3 mr-1" />}
            {config.label}
          </Badge>
        );
      },
    },
    {
      key: "createdAt",
      header: "Created",
      cell: (row: EnrichedPayRun) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: EnrichedPayRun) => (
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => viewPayRun(row.id)}
            data-testid={`button-view-${row.id}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
          
          {row.status === "DRAFT" && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => openLinkDialog(row)}
                data-testid={`button-link-orders-${row.id}`}
              >
                <Link className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchVarianceReport(row.id)}
                disabled={varianceLoading}
                data-testid={`button-variance-${row.id}`}
              >
                <FileSearch className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => submitReviewMutation.mutate(row.id)}
                disabled={submitReviewMutation.isPending}
                data-testid={`button-submit-review-${row.id}`}
              >
                <Send className="h-4 w-4 mr-1" />
                Submit for Review
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => openDeleteDialog(row)}
                data-testid={`button-delete-${row.id}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
          
          {row.status === "PENDING_REVIEW" && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchVarianceReport(row.id)}
                disabled={varianceLoading}
                data-testid={`button-variance-review-${row.id}`}
              >
                <FileSearch className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => submitApprovalMutation.mutate(row.id)}
                disabled={submitApprovalMutation.isPending}
                data-testid={`button-submit-approval-${row.id}`}
              >
                <ClipboardCheck className="h-4 w-4 mr-1" />
                Submit for Approval
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => rejectMutation.mutate(row.id)}
                disabled={rejectMutation.isPending}
                data-testid={`button-reject-${row.id}`}
              >
                <XCircle className="h-4 w-4 mr-1 text-destructive" />
                Reject
              </Button>
            </>
          )}
          
          {row.status === "PENDING_APPROVAL" && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchVarianceReport(row.id)}
                disabled={varianceLoading}
                data-testid={`button-variance-approval-${row.id}`}
              >
                <FileSearch className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => approveMutation.mutate(row.id)}
                disabled={approveMutation.isPending}
                data-testid={`button-approve-${row.id}`}
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => rejectMutation.mutate(row.id)}
                disabled={rejectMutation.isPending}
                data-testid={`button-reject-${row.id}`}
              >
                <XCircle className="h-4 w-4 mr-1 text-destructive" />
                Reject
              </Button>
            </>
          )}
          
          {row.status === "APPROVED" && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchVarianceReport(row.id)}
                disabled={varianceLoading}
                data-testid={`button-variance-finalize-${row.id}`}
              >
                <FileSearch className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => finalizeMutation.mutate(row.id)}
                disabled={finalizeMutation.isPending}
                data-testid={`button-finalize-${row.id}`}
              >
                <Lock className="h-4 w-4 mr-1" />
                Finalize
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => rejectMutation.mutate(row.id)}
                disabled={rejectMutation.isPending}
                data-testid={`button-reject-${row.id}`}
              >
                <XCircle className="h-4 w-4 mr-1 text-destructive" />
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const orderColumns = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      cell: (row: SalesOrder) => <span className="font-mono text-sm">{row.invoiceNumber}</span>,
    },
    {
      key: "repId",
      header: "Rep",
      cell: (row: SalesOrder) => <span className="font-mono">{row.repId}</span>,
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row: SalesOrder) => <span>{row.customerName}</span>,
    },
    {
      key: "commission",
      header: "Commission",
      cell: (row: SalesOrder) => (
        <span className="font-mono">
          ${(parseFloat(row.baseCommissionEarned) + parseFloat(row.incentiveEarned)).toFixed(2)}
        </span>
      ),
      className: "text-right",
    },
  ];

  const totalStats = payRuns?.reduce(
    (acc, pr) => ({
      totalOrders: acc.totalOrders + pr.orderCount,
      totalCommission: acc.totalCommission + parseFloat(pr.totalCommission),
      draftCount: acc.draftCount + (pr.status === "DRAFT" ? 1 : 0),
      finalizedCount: acc.finalizedCount + (pr.status === "FINALIZED" ? 1 : 0),
    }),
    { totalOrders: 0, totalCommission: 0, draftCount: 0, finalizedCount: 0 }
  ) || { totalOrders: 0, totalCommission: 0, draftCount: 0, finalizedCount: 0 };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Pay Runs</h1>
          <p className="text-muted-foreground">
            Manage payment cycles and link approved orders
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-payrun">
          <Plus className="h-4 w-4 mr-2" />
          New Pay Run
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Total Pay Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{payRuns?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalStats.totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Commission
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalStats.totalCommission.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Finalized
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalStats.finalizedCount} / {payRuns?.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={payRuns || []}
            isLoading={isLoading}
            emptyMessage="No pay runs yet. Create one to get started."
            testId="table-payruns"
          />
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Pay Run</DialogTitle>
            <DialogDescription>
              Create a new pay run to group approved orders for payment processing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pay Run Name</Label>
              <Input
                placeholder="e.g., Week 2 January 2026"
                value={payRunName}
                onChange={(e) => setPayRunName(e.target.value)}
                data-testid="input-payrun-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Week Ending Date</Label>
              <Input
                type="date"
                value={weekEndingDate}
                onChange={(e) => setWeekEndingDate(e.target.value)}
                data-testid="input-week-ending-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ name: payRunName, weekEndingDate })}
              disabled={!weekEndingDate || createMutation.isPending}
              data-testid="button-confirm-create-payrun"
            >
              Create Pay Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pay Run</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this pay run? Any linked orders will be unlinked.
            </DialogDescription>
          </DialogHeader>
          {payRunToDelete && (
            <div className="py-4">
              <p><strong>Name:</strong> {payRunToDelete.name || "Untitled"}</p>
              <p><strong>Week Ending:</strong> {new Date(payRunToDelete.weekEndingDate).toLocaleDateString()}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => payRunToDelete && deleteMutation.mutate(payRunToDelete.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-payrun"
            >
              Delete Pay Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedPayRun?.name || "Pay Run"} - Week Ending {selectedPayRun && new Date(selectedPayRun.weekEndingDate).toLocaleDateString()}
            </DialogTitle>
            <DialogDescription>
              View pay run details and manage linked orders
            </DialogDescription>
          </DialogHeader>
          {selectedPayRun && (
            <div className="space-y-6">
              <div className="flex items-center justify-center gap-2 py-4 bg-muted/30 rounded-lg">
                {["DRAFT", "PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED", "FINALIZED"].map((status, idx) => {
                  const currentIdx = ["DRAFT", "PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED", "FINALIZED"].indexOf(selectedPayRun.status);
                  const isCompleted = idx < currentIdx;
                  const isCurrent = status === selectedPayRun.status;
                  const labels: Record<string, string> = {
                    DRAFT: "Draft",
                    PENDING_REVIEW: "Review",
                    PENDING_APPROVAL: "Approval",
                    APPROVED: "Approved",
                    FINALIZED: "Finalized",
                  };
                  return (
                    <div key={status} className="flex items-center gap-2">
                      <div className={`flex flex-col items-center ${isCurrent ? "text-primary" : isCompleted ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                          isCurrent ? "bg-primary text-primary-foreground" : 
                          isCompleted ? "bg-primary/20 text-primary" : 
                          "bg-muted text-muted-foreground"
                        }`}>
                          {isCompleted ? <Check className="h-4 w-4" /> : idx + 1}
                        </div>
                        <span className="text-xs mt-1">{labels[status]}</span>
                      </div>
                      {idx < 4 && (
                        <div className={`w-8 h-0.5 ${idx < currentIdx ? "bg-primary" : "bg-muted"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Total Orders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{selectedPayRun.stats.totalOrders}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Total Commission
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">${selectedPayRun.stats.totalCommission}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Reps Paid
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{selectedPayRun.stats.repBreakdown.length}</p>
                  </CardContent>
                </Card>
              </div>

              {selectedPayRun.stats.repBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Rep Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedPayRun.stats.repBreakdown.map((rep) => (
                        <div key={rep.name} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div>
                            <span className="font-mono">{rep.name}</span>
                            <span className="text-sm text-muted-foreground ml-2">({rep.count} orders)</span>
                          </div>
                          <span className="font-mono font-medium">${rep.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Linked Orders</CardTitle>
                  {selectedPayRun.status === "DRAFT" && unlinkOrderIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => unlinkOrdersMutation.mutate({ payRunId: selectedPayRun.id, orderIds: unlinkOrderIds })}
                      disabled={unlinkOrdersMutation.isPending}
                      data-testid="button-unlink-selected"
                    >
                      <Unlink className="h-4 w-4 mr-1" />
                      Unlink Selected ({unlinkOrderIds.length})
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {selectedPayRun.status === "DRAFT" ? (
                    <div className="space-y-2">
                      {selectedPayRun.orders.length === 0 ? (
                        <p className="text-muted-foreground text-center py-4">No orders linked to this pay run</p>
                      ) : (
                        selectedPayRun.orders.map((order) => (
                          <div 
                            key={order.id} 
                            className="flex items-center gap-4 p-3 border rounded-md hover-elevate cursor-pointer"
                            onClick={() => toggleUnlinkSelection(order.id)}
                          >
                            <Checkbox 
                              checked={unlinkOrderIds.includes(order.id)}
                              onCheckedChange={() => toggleUnlinkSelection(order.id)}
                              data-testid={`checkbox-unlink-${order.id}`}
                            />
                            <div className="flex-1 grid grid-cols-4 gap-2">
                              <span className="font-mono text-sm">{order.invoiceNumber}</span>
                              <span className="font-mono">{order.repId}</span>
                              <span className="truncate">{order.customerName}</span>
                              <span className="font-mono text-right">
                                ${(parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned)).toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <DataTable
                      columns={orderColumns}
                      data={selectedPayRun.orders || []}
                      isLoading={false}
                      emptyMessage="No orders linked to this pay run"
                      testId="table-payrun-orders"
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link Orders to Pay Run</DialogTitle>
            <DialogDescription>
              Select approved orders to include in this pay run.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {unlinkedOrders?.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No unlinked orders available</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {unlinkedOrders?.map((order) => (
                  <div 
                    key={order.id} 
                    className="flex items-center gap-4 p-3 border rounded-md hover-elevate cursor-pointer"
                    onClick={() => toggleOrderSelection(order.id)}
                  >
                    <Checkbox 
                      checked={selectedOrderIds.includes(order.id)}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      data-testid={`checkbox-order-${order.id}`}
                    />
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <span className="font-mono text-sm">{order.invoiceNumber}</span>
                      <span className="font-mono">{order.repId}</span>
                      <span className="truncate">{order.customerName}</span>
                      <span className="font-mono text-right">
                        ${(parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowLinkDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedPayRun && linkOrdersMutation.mutate({ 
                payRunId: selectedPayRun.id, 
                orderIds: selectedOrderIds 
              })}
              disabled={selectedOrderIds.length === 0 || linkOrdersMutation.isPending}
              data-testid="button-confirm-link-orders"
            >
              Link {selectedOrderIds.length} Orders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showVarianceDialog} onOpenChange={setShowVarianceDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5" />
              Variance Report
            </DialogTitle>
            <DialogDescription>
              Review pay run details before proceeding with workflow actions.
            </DialogDescription>
          </DialogHeader>
          {varianceReport && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-muted/30 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Orders</p>
                  <p className="text-xl font-bold">{varianceReport.orderCount}</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Total Gross</p>
                  <p className="text-xl font-bold font-mono">${varianceReport.totalGross}</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Net Pay</p>
                  <p className="text-xl font-bold font-mono">${varianceReport.totalNetPay}</p>
                </div>
              </div>

              {varianceReport.issues.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Blocking Issues Found</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-2 space-y-1">
                      {varianceReport.issues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {varianceReport.issues.length === 0 && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>No Issues Found</AlertTitle>
                  <AlertDescription>
                    This pay run is ready to proceed to the next stage.
                  </AlertDescription>
                </Alert>
              )}

              {varianceReport.repSummaries.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted px-4 py-2">
                    <h4 className="font-medium">Rep Summary</h4>
                  </div>
                  <div className="divide-y max-h-48 overflow-y-auto">
                    {varianceReport.repSummaries.map((rep) => (
                      <div key={rep.repId} className="flex items-center justify-between px-4 py-2">
                        <span className="font-mono">{rep.repId}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-muted-foreground">Gross: ${rep.gross.toFixed(2)}</span>
                          <span className="text-sm text-muted-foreground">Deductions: ${rep.deductions.toFixed(2)}</span>
                          <span className={`font-mono font-medium ${rep.hasNegative ? "text-destructive" : ""}`}>
                            Net: ${rep.net.toFixed(2)}
                          </span>
                          {rep.hasNegative && <AlertTriangle className="h-4 w-4 text-destructive" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVarianceDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
