import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Search, CheckCircle, XCircle, CheckSquare, AlertTriangle } from "lucide-react";
import type { SalesOrder } from "@shared/schema";

export default function Approvals() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectingOrder, setRejectingOrder] = useState<SalesOrder | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");

  const { data: orders, isLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/admin/approvals/queue"],
    queryFn: async () => {
      const res = await fetch("/api/admin/approvals/queue", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch approvals");
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/admin/orders/${orderId}/approve`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to approve");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals/queue"] });
      toast({ title: "Order approved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ orderId, note }: { orderId: string; note: string }) => {
      const res = await fetch(`/api/admin/orders/${orderId}/reject`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionNote: note }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reject");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals/queue"] });
      setRejectingOrder(null);
      setRejectionNote("");
      toast({ title: "Order rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Rejection failed", description: error.message, variant: "destructive" });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const res = await fetch("/api/admin/orders/bulk-approve", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Bulk approve failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approvals/queue"] });
      setSelectedIds(new Set());
      toast({
        title: "Bulk approval completed",
        description: `Approved ${data.approved || 0} orders. ${data.skipped || 0} skipped due to rate issues.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk approval failed", description: error.message, variant: "destructive" });
    },
  });

  const filteredOrders = orders?.filter((order) =>
    order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.repId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders?.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOrders?.map((o) => o.id) || []));
    }
  };

  const columns = [
    {
      key: "select",
      header: () => (
        <Checkbox
          checked={selectedIds.size === filteredOrders?.length && filteredOrders?.length > 0}
          onCheckedChange={toggleSelectAll}
          data-testid="checkbox-select-all"
        />
      ),
      cell: (row: SalesOrder) => (
        <Checkbox
          checked={selectedIds.has(row.id)}
          onCheckedChange={() => toggleSelect(row.id)}
          data-testid={`checkbox-select-${row.id}`}
        />
      ),
    },
    {
      key: "repId",
      header: "Rep",
      cell: (row: SalesOrder) => <span className="font-mono text-sm">{row.repId}</span>,
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row: SalesOrder) => (
        <span className="font-medium truncate block max-w-[200px]">{row.customerName}</span>
      ),
    },
    {
      key: "dateSold",
      header: "Date Sold",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "jobStatus",
      header: "Job Status",
      cell: (row: SalesOrder) => <JobStatusBadge status={row.jobStatus} />,
    },
    {
      key: "baseCommissionEarned",
      header: "Commission",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-right block">
          ${parseFloat(row.baseCommissionEarned).toFixed(2)}
        </span>
      ),
      className: "text-right",
    },
    {
      key: "rateIssue",
      header: "Rate Status",
      cell: (row: SalesOrder) => (
        row.appliedRateCardId ? (
          <Badge variant="outline">OK</Badge>
        ) : (
          <Badge variant="destructive">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Missing
          </Badge>
        )
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (row: SalesOrder) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => approveMutation.mutate(row.id)}
            disabled={approveMutation.isPending}
            data-testid={`button-approve-${row.id}`}
          >
            <CheckCircle className="h-4 w-4 text-green-600" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => setRejectingOrder(row)}
            data-testid={`button-reject-${row.id}`}
          >
            <XCircle className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Approvals Queue</h1>
          <p className="text-muted-foreground">
            Review and approve pending orders
          </p>
        </div>
        {selectedIds.size > 0 && (
          <Button
            onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
            disabled={bulkApproveMutation.isPending}
            data-testid="button-bulk-approve"
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            Approve Selected ({selectedIds.size})
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer or rep..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-approvals"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredOrders || []}
            isLoading={isLoading}
            emptyMessage="No orders pending approval"
            testId="table-approvals"
          />
        </CardContent>
      </Card>

      <Dialog open={!!rejectingOrder} onOpenChange={() => setRejectingOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Order</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this order.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rejection Note</Label>
              <Textarea
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                placeholder="Enter reason for rejection..."
                data-testid="input-rejection-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingOrder(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectingOrder && rejectMutation.mutate({ orderId: rejectingOrder.id, note: rejectionNote })}
              disabled={!rejectionNote.trim() || rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              Reject Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
