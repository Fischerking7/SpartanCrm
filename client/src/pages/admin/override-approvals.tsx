import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CheckCircle, XCircle, Filter, Clock, DollarSign, Users, AlertTriangle } from "lucide-react";

type PendingOverride = {
  id: string;
  salesOrderId: string;
  orderInvoiceNumber: string;
  orderCustomerName: string;
  orderDateSold: string;
  recipientUserId: string;
  recipientName: string;
  recipientRole: string;
  overrideType: string;
  amount: string;
  approvalStatus: string;
  createdAt: string;
  order: {
    repId: string;
    repName: string;
    repRole: string;
    serviceName: string;
    providerName: string;
    jobStatus: string;
    approvalStatus: string;
  } | null;
};

const OVERRIDE_TYPE_LABELS: Record<string, string> = {
  LEADER_OVERRIDE: "Leader Override",
  MANAGER_OVERRIDE: "Manager Override",
  DIRECTOR_OVERRIDE: "Director Override",
  ADMIN_OVERRIDE: "Operations Override",
  ACCOUNTING_OVERRIDE: "Accounting Override",
  STANDARD: "Standard",
};

const OVERRIDE_TYPE_COLORS: Record<string, string> = {
  LEADER_OVERRIDE: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  MANAGER_OVERRIDE: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  DIRECTOR_OVERRIDE: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  ADMIN_OVERRIDE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  ACCOUNTING_OVERRIDE: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
};

export default function OverrideApprovals() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [filterType, setFilterType] = useState<string>("ALL");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bulkRejectDialogOpen, setBulkRejectDialogOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  const { data: pendingOverrides = [], isLoading } = useQuery<PendingOverride[]>({
    queryKey: ["/api/admin/override-earnings/pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/override-earnings/pending", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/override-earnings/${id}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      toast({ title: "Override approved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await apiRequest("POST", `/api/admin/override-earnings/${id}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      setRejectDialogOpen(false);
      setRejectingId(null);
      setRejectReason("");
      toast({ title: "Override rejected" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to reject", description: err.message, variant: "destructive" });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/admin/override-earnings/bulk-approve", { ids });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      setSelectedIds(new Set());
      toast({ title: `${data.approved} overrides approved`, description: data.skipped > 0 ? `${data.skipped} skipped` : undefined });
    },
    onError: (err: any) => {
      toast({ title: "Bulk approve failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
      const res = await apiRequest("POST", "/api/admin/override-earnings/bulk-reject", { ids, reason });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/override-earnings/pending"] });
      setSelectedIds(new Set());
      setBulkRejectDialogOpen(false);
      setBulkRejectReason("");
      toast({ title: `${data.rejected} overrides rejected` });
    },
    onError: (err: any) => {
      toast({ title: "Bulk reject failed", description: err.message, variant: "destructive" });
    },
  });

  const filtered = filterType === "ALL"
    ? pendingOverrides
    : pendingOverrides.filter(o => o.overrideType === filterType);

  const typeCounts = pendingOverrides.reduce<Record<string, number>>((acc, o) => {
    acc[o.overrideType] = (acc[o.overrideType] || 0) + 1;
    return acc;
  }, {});

  const totalPendingAmount = filtered.reduce((sum, o) => sum + parseFloat(o.amount || "0"), 0);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(o => o.id)));
    }
  };

  const canApproveType = (overrideType: string): boolean => {
    const role = user?.role;
    if (!role) return false;
    if (role === "EXECUTIVE" || role === "OPERATIONS") return true;
    if (role === "ADMIN") return ["LEADER_OVERRIDE", "MANAGER_OVERRIDE", "DIRECTOR_OVERRIDE", "ADMIN_OVERRIDE", "ACCOUNTING_OVERRIDE"].includes(overrideType);
    if (role === "ACCOUNTING") return overrideType === "ACCOUNTING_OVERRIDE";
    return false;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Override Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">Review and approve pending override earnings</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm px-3 py-1" data-testid="badge-pending-count">
            <Clock className="w-3 h-3 mr-1" />
            {pendingOverrides.length} Pending
          </Badge>
          <Badge variant="outline" className="text-sm px-3 py-1" data-testid="badge-pending-total">
            <DollarSign className="w-3 h-3 mr-1" />
            ${totalPendingAmount.toFixed(2)}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {Object.entries(OVERRIDE_TYPE_LABELS).filter(([key]) => key !== "STANDARD").map(([key, label]) => {
          const count = typeCounts[key] || 0;
          return (
            <Card
              key={key}
              className={`cursor-pointer transition-all ${filterType === key ? "ring-2 ring-[#C9A84C]" : ""}`}
              onClick={() => setFilterType(filterType === key ? "ALL" : key)}
              data-testid={`card-filter-${key}`}
            >
              <CardContent className="p-3 text-center">
                <p className="text-xs text-muted-foreground truncate">{label}</p>
                <p className="text-2xl font-bold mt-1">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-lg" data-testid="bulk-actions-bar">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            size="sm"
            onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
            disabled={bulkApproveMutation.isPending}
            data-testid="button-bulk-approve"
          >
            <CheckCircle className="w-4 h-4 mr-1" />
            Approve All
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setBulkRejectDialogOpen(true)}
            disabled={bulkRejectMutation.isPending}
            data-testid="button-bulk-reject"
          >
            <XCircle className="w-4 h-4 mr-1" />
            Reject All
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">
            Clear
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-type">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="LEADER_OVERRIDE">Leader Override</SelectItem>
            <SelectItem value="MANAGER_OVERRIDE">Manager Override</SelectItem>
            <SelectItem value="DIRECTOR_OVERRIDE">Director Override</SelectItem>
            <SelectItem value="ADMIN_OVERRIDE">Operations Override</SelectItem>
            <SelectItem value="ACCOUNTING_OVERRIDE">Accounting Override</SelectItem>
          </SelectContent>
        </Select>
        {filtered.length > 0 && (
          <Button variant="ghost" size="sm" onClick={toggleSelectAll} data-testid="button-select-all">
            {selectedIds.size === filtered.length ? "Deselect All" : "Select All"}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-muted border-t-foreground rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <CheckCircle className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-lg font-medium">No pending overrides</p>
            <p className="text-sm">All override earnings have been processed</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((override) => {
            const canApprove = canApproveType(override.overrideType);
            const isSelf = override.recipientUserId === user?.id;

            return (
              <Card key={override.id} className="overflow-hidden" data-testid={`card-override-${override.id}`}>
                <div className="flex items-start gap-4 p-4">
                  <div className="pt-1">
                    <Checkbox
                      checked={selectedIds.has(override.id)}
                      onCheckedChange={() => toggleSelect(override.id)}
                      disabled={!canApprove || isSelf}
                      data-testid={`checkbox-override-${override.id}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${OVERRIDE_TYPE_COLORS[override.overrideType] || "bg-gray-100 text-gray-800"}`}>
                        {OVERRIDE_TYPE_LABELS[override.overrideType] || override.overrideType}
                      </span>
                      <span className="text-lg font-bold text-green-600 dark:text-green-400" data-testid={`text-amount-${override.id}`}>
                        ${parseFloat(override.amount).toFixed(2)}
                      </span>
                      {isSelf && (
                        <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Your Override
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                      <div>
                        <span className="text-muted-foreground">Recipient: </span>
                        <span className="font-medium" data-testid={`text-recipient-${override.id}`}>{override.recipientName}</span>
                        <Badge variant="secondary" className="ml-1 text-xs">{override.recipientRole}</Badge>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Order: </span>
                        <span className="font-medium" data-testid={`text-order-${override.id}`}>
                          {override.orderInvoiceNumber || override.salesOrderId.slice(0, 8)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Customer: </span>
                        <span className="font-medium">{override.orderCustomerName}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Date Sold: </span>
                        <span className="font-medium">{override.orderDateSold}</span>
                      </div>
                      {override.order && (
                        <>
                          <div>
                            <span className="text-muted-foreground">Rep: </span>
                            <span className="font-medium">{override.order.repName}</span>
                            <Badge variant="secondary" className="ml-1 text-xs">{override.order.repRole}</Badge>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Service: </span>
                            <span className="font-medium">{override.order.serviceName || "Mobile Only"}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(override.id)}
                      disabled={!canApprove || isSelf || approveMutation.isPending}
                      data-testid={`button-approve-${override.id}`}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setRejectingId(override.id);
                        setRejectReason("");
                        setRejectDialogOpen(true);
                      }}
                      disabled={!canApprove || isSelf}
                      data-testid={`button-reject-${override.id}`}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Override</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this override earning.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="min-h-[100px]"
            data-testid="input-reject-reason"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectDialogOpen(false)} data-testid="button-cancel-reject">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (rejectingId && rejectReason.trim()) {
                  rejectMutation.mutate({ id: rejectingId, reason: rejectReason.trim() });
                }
              }}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              Reject Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkRejectDialogOpen} onOpenChange={setBulkRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {selectedIds.size} Overrides</DialogTitle>
            <DialogDescription>Provide a reason for rejecting these override earnings.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter rejection reason..."
            value={bulkRejectReason}
            onChange={(e) => setBulkRejectReason(e.target.value)}
            className="min-h-[100px]"
            data-testid="input-bulk-reject-reason"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkRejectDialogOpen(false)} data-testid="button-cancel-bulk-reject">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (bulkRejectReason.trim()) {
                  bulkRejectMutation.mutate({ ids: Array.from(selectedIds), reason: bulkRejectReason.trim() });
                }
              }}
              disabled={!bulkRejectReason.trim() || bulkRejectMutation.isPending}
              data-testid="button-confirm-bulk-reject"
            >
              Reject {selectedIds.size} Overrides
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
