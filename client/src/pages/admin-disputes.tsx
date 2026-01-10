import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, FileText, Clock, CheckCircle, XCircle, Eye, Gavel } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

interface CommissionDispute {
  id: string;
  userId: string;
  salesOrderId: string | null;
  payStatementId: string | null;
  disputeType: string;
  status: string;
  title: string;
  description: string;
  expectedAmount: string | null;
  actualAmount: string | null;
  differenceAmount: string | null;
  resolution: string | null;
  resolvedAmount: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface DisputeWithUser {
  dispute: CommissionDispute;
  user: { id: string; name: string; repId: string } | null;
}

function formatCurrency(amount: string | number | null) {
  if (amount === null) return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string) {
  return format(new Date(date), "MMM dd, yyyy");
}

function DisputeStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
    PENDING: { variant: "outline", icon: Clock },
    UNDER_REVIEW: { variant: "secondary", icon: Eye },
    APPROVED: { variant: "default", icon: CheckCircle },
    REJECTED: { variant: "destructive", icon: XCircle },
    CLOSED: { variant: "outline", icon: CheckCircle },
  };
  const config = variants[status] || { variant: "outline" as const, icon: AlertCircle };
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {status.replace("_", " ")}
    </Badge>
  );
}

function DisputeTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    MISSING_COMMISSION: "Missing Commission",
    INCORRECT_AMOUNT: "Incorrect Amount",
    INCORRECT_SERVICE: "Incorrect Service",
    CHARGEBACK_DISPUTE: "Chargeback Dispute",
    OTHER: "Other",
  };
  return <Badge variant="outline">{labels[type] || type}</Badge>;
}

function ResolveDisputeDialog({ dispute, userName }: { dispute: CommissionDispute; userName: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    status: "",
    resolution: "",
    resolvedAmount: "",
  });
  const { toast } = useToast();

  const resolveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch(`/api/admin/disputes/${dispute.id}/resolve`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to resolve dispute");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
      toast({ title: "Dispute resolved", description: "The dispute has been resolved" });
      setOpen(false);
      setForm({ status: "", resolution: "", resolvedAmount: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to resolve dispute", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.status || !form.resolution) {
      toast({ title: "Missing fields", description: "Please select a resolution status and provide a note", variant: "destructive" });
      return;
    }
    resolveMutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-resolve-dispute-${dispute.id}`}>
          <Gavel className="h-4 w-4 mr-1" />
          Resolve
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve Dispute</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">Submitted by</p>
            <p className="font-medium">{userName}</p>
            <p className="text-sm text-muted-foreground mt-2">Title</p>
            <p className="font-medium">{dispute.title}</p>
            <p className="text-sm text-muted-foreground mt-2">Description</p>
            <p className="text-sm">{dispute.description}</p>
            {dispute.expectedAmount && (
              <div className="flex gap-4 mt-2">
                <div>
                  <p className="text-xs text-muted-foreground">Expected</p>
                  <p className="text-sm font-medium">{formatCurrency(dispute.expectedAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Actual</p>
                  <p className="text-sm font-medium">{formatCurrency(dispute.actualAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Difference</p>
                  <p className="text-sm font-medium text-red-600">{formatCurrency(dispute.differenceAmount)}</p>
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="status">Resolution Status *</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger id="status" data-testid="select-resolution-status">
                  <SelectValue placeholder="Select resolution" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED">Approved - Issue Valid</SelectItem>
                  <SelectItem value="REJECTED">Rejected - Issue Invalid</SelectItem>
                  <SelectItem value="CLOSED">Closed - No Action Needed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resolvedAmount">Resolved Amount (if applicable)</Label>
              <Input
                id="resolvedAmount"
                type="number"
                step="0.01"
                value={form.resolvedAmount}
                onChange={(e) => setForm({ ...form, resolvedAmount: e.target.value })}
                placeholder="$0.00"
                data-testid="input-resolved-amount"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resolution">Resolution Notes *</Label>
              <Textarea
                id="resolution"
                value={form.resolution}
                onChange={(e) => setForm({ ...form, resolution: e.target.value })}
                placeholder="Explain the resolution..."
                rows={3}
                data-testid="input-resolution"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={resolveMutation.isPending} data-testid="button-confirm-resolve">
                {resolveMutation.isPending ? "Resolving..." : "Resolve Dispute"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewDisputeDialog({ dispute, userName }: { dispute: CommissionDispute; userName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`button-view-admin-dispute-${dispute.id}`}>
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Dispute Details
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DisputeTypeBadge type={dispute.disputeType} />
            <DisputeStatusBadge status={dispute.status} />
          </div>

          <div>
            <p className="text-sm text-muted-foreground">Submitted By</p>
            <p className="font-medium">{userName}</p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">Title</p>
            <p className="font-medium">{dispute.title}</p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">Description</p>
            <p className="text-sm">{dispute.description}</p>
          </div>

          {(dispute.expectedAmount || dispute.actualAmount) && (
            <div className="grid grid-cols-3 gap-4 pt-2 border-t">
              <div>
                <p className="text-sm text-muted-foreground">Expected</p>
                <p className="font-medium">{formatCurrency(dispute.expectedAmount)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Actual</p>
                <p className="font-medium">{formatCurrency(dispute.actualAmount)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Difference</p>
                <p className="font-medium text-red-600 dark:text-red-400">{formatCurrency(dispute.differenceAmount)}</p>
              </div>
            </div>
          )}

          {dispute.resolution && (
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground">Resolution</p>
              <p className="text-sm">{dispute.resolution}</p>
              {dispute.resolvedAmount && (
                <p className="text-sm font-medium mt-1">
                  Resolved Amount: {formatCurrency(dispute.resolvedAmount)}
                </p>
              )}
              {dispute.resolvedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Resolved on {formatDate(dispute.resolvedAt)}
                </p>
              )}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Submitted on {formatDate(dispute.createdAt)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminDisputes() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();

  const { data: disputes, isLoading } = useQuery<DisputeWithUser[]>({
    queryKey: ["/api/admin/disputes", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/admin/disputes?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch disputes");
      return res.json();
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/admin/disputes/${id}/status`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
      toast({ title: "Status updated" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const pendingCount = disputes?.filter(d => d.dispute.status === "PENDING").length || 0;
  const underReviewCount = disputes?.filter(d => d.dispute.status === "UNDER_REVIEW").length || 0;
  const resolvedCount = disputes?.filter(d => ["APPROVED", "REJECTED", "CLOSED"].includes(d.dispute.status)).length || 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Commission Disputes</h1>
        <p className="text-muted-foreground">Review and resolve commission disputes from reps</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Disputes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{disputes?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Under Review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">{underReviewCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{resolvedCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              All Disputes
            </CardTitle>
            <CardDescription>Manage commission dispute submissions</CardDescription>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {disputes?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No disputes found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rep</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Difference</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disputes?.map(({ dispute, user }) => (
                  <TableRow key={dispute.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{user?.name || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{user?.repId}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{dispute.title}</TableCell>
                    <TableCell><DisputeTypeBadge type={dispute.disputeType} /></TableCell>
                    <TableCell className="text-red-600 dark:text-red-400 font-medium">
                      {formatCurrency(dispute.differenceAmount)}
                    </TableCell>
                    <TableCell>{formatDate(dispute.createdAt)}</TableCell>
                    <TableCell><DisputeStatusBadge status={dispute.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <ViewDisputeDialog dispute={dispute} userName={user?.name || "Unknown"} />
                        {["PENDING", "UNDER_REVIEW"].includes(dispute.status) && (
                          <>
                            {dispute.status === "PENDING" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => updateStatusMutation.mutate({ id: dispute.id, status: "UNDER_REVIEW" })}
                                data-testid={`button-start-review-${dispute.id}`}
                              >
                                Start Review
                              </Button>
                            )}
                            <ResolveDisputeDialog dispute={dispute} userName={user?.name || "Unknown"} />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
