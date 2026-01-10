import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Plus, FileText, Clock, CheckCircle, XCircle, Eye } from "lucide-react";
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

function CreateDisputeDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    disputeType: "",
    title: "",
    description: "",
    expectedAmount: "",
    actualAmount: "",
  });
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await fetch("/api/disputes", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create dispute");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes/my"] });
      toast({ title: "Dispute submitted", description: "Your dispute has been submitted for review" });
      setOpen(false);
      setForm({ disputeType: "", title: "", description: "", expectedAmount: "", actualAmount: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create dispute", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.disputeType || !form.title || !form.description) {
      toast({ title: "Missing fields", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    createMutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-dispute">
          <Plus className="h-4 w-4 mr-2" />
          Submit Dispute
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit Commission Dispute</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disputeType">Dispute Type *</Label>
            <Select value={form.disputeType} onValueChange={(v) => setForm({ ...form, disputeType: v })}>
              <SelectTrigger id="disputeType" data-testid="select-dispute-type">
                <SelectValue placeholder="Select dispute type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MISSING_COMMISSION">Missing Commission</SelectItem>
                <SelectItem value="INCORRECT_AMOUNT">Incorrect Amount</SelectItem>
                <SelectItem value="INCORRECT_SERVICE">Incorrect Service Type</SelectItem>
                <SelectItem value="CHARGEBACK_DISPUTE">Chargeback Dispute</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Brief summary of the issue"
              data-testid="input-dispute-title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Provide details about your dispute..."
              rows={4}
              data-testid="input-dispute-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expectedAmount">Expected Amount</Label>
              <Input
                id="expectedAmount"
                type="number"
                step="0.01"
                value={form.expectedAmount}
                onChange={(e) => setForm({ ...form, expectedAmount: e.target.value })}
                placeholder="$0.00"
                data-testid="input-expected-amount"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="actualAmount">Actual Amount</Label>
              <Input
                id="actualAmount"
                type="number"
                step="0.01"
                value={form.actualAmount}
                onChange={(e) => setForm({ ...form, actualAmount: e.target.value })}
                placeholder="$0.00"
                data-testid="input-actual-amount"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-dispute">
              {createMutation.isPending ? "Submitting..." : "Submit Dispute"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DisputeDetailsDialog({ dispute }: { dispute: CommissionDispute }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`button-view-dispute-${dispute.id}`}>
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

export default function MyDisputes() {
  const { data: disputes, isLoading } = useQuery<CommissionDispute[]>({
    queryKey: ["/api/disputes/my"],
    queryFn: async () => {
      const res = await fetch("/api/disputes/my", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch disputes");
      return res.json();
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

  const pendingDisputes = disputes?.filter(d => ["PENDING", "UNDER_REVIEW"].includes(d.status)) || [];
  const resolvedDisputes = disputes?.filter(d => ["APPROVED", "REJECTED", "CLOSED"].includes(d.status)) || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Commission Disputes</h1>
          <p className="text-muted-foreground">Submit and track disputes about your commissions</p>
        </div>
        <CreateDisputeDialog />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{pendingDisputes.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{resolvedDisputes.length}</p>
          </CardContent>
        </Card>
      </div>

      {pendingDisputes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Pending Disputes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingDisputes.map((dispute) => (
                  <TableRow key={dispute.id}>
                    <TableCell className="font-medium">{dispute.title}</TableCell>
                    <TableCell><DisputeTypeBadge type={dispute.disputeType} /></TableCell>
                    <TableCell>{formatDate(dispute.createdAt)}</TableCell>
                    <TableCell><DisputeStatusBadge status={dispute.status} /></TableCell>
                    <TableCell><DisputeDetailsDialog dispute={dispute} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            All Disputes
          </CardTitle>
          <CardDescription>History of all your submitted disputes</CardDescription>
        </CardHeader>
        <CardContent>
          {disputes?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No disputes submitted</p>
              <p className="text-sm">Submit a dispute if you have questions about your commissions</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disputes?.map((dispute) => (
                  <TableRow key={dispute.id}>
                    <TableCell className="font-medium">{dispute.title}</TableCell>
                    <TableCell><DisputeTypeBadge type={dispute.disputeType} /></TableCell>
                    <TableCell>{formatCurrency(dispute.expectedAmount)}</TableCell>
                    <TableCell>{formatCurrency(dispute.actualAmount)}</TableCell>
                    <TableCell>{formatDate(dispute.createdAt)}</TableCell>
                    <TableCell><DisputeStatusBadge status={dispute.status} /></TableCell>
                    <TableCell><DisputeDetailsDialog dispute={dispute} /></TableCell>
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
