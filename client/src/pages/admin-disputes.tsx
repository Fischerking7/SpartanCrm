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
import { AlertCircle, FileText, Clock, CheckCircle, XCircle, Eye, Gavel, Shield, ChevronUp, Upload, Paperclip, History } from "lucide-react";
import { useState, useRef } from "react";
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
  escalatedAt: string | null;
  legalHoldAt: string | null;
  legalHoldReason: string | null;
  legalHoldReleasedAt: string | null;
  commissionFrozen: boolean;
  autoEscalated: boolean;
}

interface DisputeWithUser {
  dispute: CommissionDispute;
  user: { id: string; name: string; repId: string } | null;
}

interface EscalationEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
  actor: { id: string; name: string; role: string } | null;
}

interface EvidenceAttachment {
  id: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  description: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string; role: string } | null;
}

function formatCurrency(amount: string | number | null) {
  if (amount === null) return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string) {
  return format(new Date(date), "MMM dd, yyyy");
}

function formatDateTime(date: string) {
  return format(new Date(date), "MMM dd, yyyy h:mm a");
}

function DisputeStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { className: string; icon: React.ComponentType<{ className?: string }> }> = {
    PENDING: { className: "border text-muted-foreground", icon: Clock },
    UNDER_REVIEW: { className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0", icon: Eye },
    ESCALATED: { className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-0", icon: ChevronUp },
    LEGAL_HOLD: { className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-0", icon: Shield },
    APPROVED: { className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0", icon: CheckCircle },
    REJECTED: { className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0", icon: XCircle },
    CLOSED: { className: "border text-muted-foreground", icon: CheckCircle },
  };
  const config = variants[status] || { className: "border", icon: AlertCircle };
  const Icon = config.icon;
  return (
    <Badge className={`gap-1 ${config.className}`}>
      <Icon className="h-3 w-3" />
      {status.replace(/_/g, " ")}
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

function EscalationTimeline({ disputeId }: { disputeId: string }) {
  const { data: events, isLoading } = useQuery<EscalationEvent[]>({
    queryKey: ["/api/disputes", disputeId, "timeline"],
    queryFn: async () => {
      const res = await fetch(`/api/disputes/${disputeId}/timeline`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load timeline");
      return res.json();
    },
  });

  const eventTypeLabel: Record<string, string> = {
    STATUS_CHANGED: "Status Changed",
    ESCALATED: "Escalated",
    LEGAL_HOLD_PLACED: "Legal Hold Placed",
    LEGAL_HOLD_RELEASED: "Legal Hold Released",
    RESOLVED: "Resolved",
    EVIDENCE_UPLOADED: "Evidence Uploaded",
    CREATED: "Dispute Created",
  };

  const eventTypeColor: Record<string, string> = {
    ESCALATED: "text-orange-600",
    LEGAL_HOLD_PLACED: "text-purple-600",
    LEGAL_HOLD_RELEASED: "text-blue-600",
    RESOLVED: "text-green-600",
    EVIDENCE_UPLOADED: "text-blue-500",
  };

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">No timeline events yet.</p>;
  }

  return (
    <div className="space-y-3">
      {events.map(event => (
        <div key={event.id} className="flex gap-3 text-sm" data-testid={`timeline-event-${event.id}`}>
          <div className="flex flex-col items-center">
            <div className="h-2 w-2 rounded-full bg-border mt-1.5 flex-shrink-0" />
            <div className="w-px bg-border flex-1 mt-1" />
          </div>
          <div className="pb-3 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-medium ${eventTypeColor[event.eventType] || ""}`}>{eventTypeLabel[event.eventType] || event.eventType}</span>
              {event.fromStatus && event.toStatus && event.fromStatus !== event.toStatus && (
                <span className="text-xs text-muted-foreground">
                  {event.fromStatus.replace(/_/g, " ")} → {event.toStatus.replace(/_/g, " ")}
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">{formatDateTime(event.createdAt)}</span>
            </div>
            {event.actor && (
              <p className="text-xs text-muted-foreground">by {event.actor.name} ({event.actor.role})</p>
            )}
            {event.note && <p className="text-sm mt-0.5 text-muted-foreground">{event.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidencePanel({ disputeId }: { disputeId: string }) {
  const { data: attachments, isLoading } = useQuery<EvidenceAttachment[]>({
    queryKey: ["/api/disputes", disputeId, "evidence"],
    queryFn: async () => {
      const res = await fetch(`/api/disputes/${disputeId}/evidence`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load evidence");
      return res.json();
    },
  });

  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("description", description);
      const res = await fetch(`/api/disputes/${disputeId}/evidence`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes", disputeId, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/disputes", disputeId, "timeline"] });
      toast({ title: "Evidence uploaded" });
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (attachmentId: string) => {
      const res = await fetch(`/api/disputes/${disputeId}/evidence/${attachmentId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disputes", disputeId, "evidence"] });
      toast({ title: "Attachment removed" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
  };

  function formatFileSize(bytes: number | null) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="flex-1"
          data-testid="input-evidence-description"
        />
        <input type="file" ref={fileRef} onChange={handleFileChange} className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploadMutation.isPending}
          data-testid="button-upload-evidence"
        >
          <Upload className="h-4 w-4 mr-1" />
          {uploadMutation.isPending ? "Uploading..." : "Upload"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !attachments || attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No evidence attached yet.</p>
      ) : (
        <div className="space-y-2">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-2 p-2 border rounded-lg text-sm" data-testid={`evidence-${att.id}`}>
              <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{att.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {att.uploadedBy?.name} · {formatFileSize(att.fileSize)} · {formatDate(att.createdAt)}
                  {att.description && ` · ${att.description}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500 hover:text-red-700"
                onClick={() => deleteMutation.mutate(att.id)}
                disabled={deleteMutation.isPending}
                data-testid={`button-delete-evidence-${att.id}`}
              >
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResolveDisputeDialog({ dispute, userName }: { dispute: CommissionDispute; userName: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ status: "", resolution: "", resolvedAmount: "" });
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
      toast({ title: "Dispute resolved" });
      setOpen(false);
      setForm({ status: "", resolution: "", resolvedAmount: "" });
    },
    onError: (error: Error) => toast({ title: "Failed to resolve", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-resolve-dispute-${dispute.id}`}>
          <Gavel className="h-4 w-4 mr-1" />
          Resolve
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Resolve Dispute</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="p-3 bg-muted rounded-lg text-sm">
            <p className="text-muted-foreground">Rep: <span className="text-foreground font-medium">{userName}</span></p>
            <p className="text-muted-foreground mt-1">Title: <span className="text-foreground">{dispute.title}</span></p>
          </div>
          <form onSubmit={e => { e.preventDefault(); if (!form.status || !form.resolution) return; resolveMutation.mutate(form); }} className="space-y-3">
            <div>
              <Label>Resolution Status *</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-resolution-status"><SelectValue placeholder="Select resolution" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED">Approved - Issue Valid</SelectItem>
                  <SelectItem value="REJECTED">Rejected - Issue Invalid</SelectItem>
                  <SelectItem value="CLOSED">Closed - No Action Needed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Resolved Amount (if applicable)</Label>
              <Input type="number" step="0.01" value={form.resolvedAmount} onChange={e => setForm({ ...form, resolvedAmount: e.target.value })} placeholder="$0.00" data-testid="input-resolved-amount" />
            </div>
            <div>
              <Label>Resolution Notes *</Label>
              <Textarea value={form.resolution} onChange={e => setForm({ ...form, resolution: e.target.value })} placeholder="Explain the resolution..." rows={3} data-testid="input-resolution" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
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

function LegalHoldDialog({ dispute }: { dispute: CommissionDispute }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const isOnHold = dispute.status === "LEGAL_HOLD";

  const holdMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/disputes/${dispute.id}/legal-hold`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
      toast({ title: "Legal hold placed — commission frozen" });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/disputes/${dispute.id}/release-hold`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Legal hold released" }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
      toast({ title: "Legal hold released" });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={isOnHold ? "text-purple-600 border-purple-300" : ""} data-testid={`button-legal-hold-${dispute.id}`}>
          <Shield className="h-4 w-4 mr-1" />
          {isOnHold ? "Release Hold" : "Legal Hold"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isOnHold ? "Release Legal Hold" : "Place Legal Hold"}</DialogTitle>
        </DialogHeader>
        {isOnHold ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">This will release the legal hold and restore the dispute to review. Commission will be unfrozen.</p>
            {dispute.legalHoldReason && (
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <p className="text-xs text-muted-foreground">Original hold reason:</p>
                <p className="text-sm">{dispute.legalHoldReason}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => releaseMutation.mutate()} disabled={releaseMutation.isPending} data-testid="button-confirm-release-hold">
                {releaseMutation.isPending ? "Releasing..." : "Release Hold"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Placing a legal hold will freeze all related commission and payroll until the hold is released. This action is logged and audited.</p>
            <div>
              <Label>Reason for Legal Hold *</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe why this dispute requires a legal hold..." rows={3} data-testid="input-hold-reason" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => holdMutation.mutate()} disabled={!reason || holdMutation.isPending} data-testid="button-confirm-hold">
                {holdMutation.isPending ? "Placing Hold..." : "Place Legal Hold"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EscalateDialog({ dispute }: { dispute: CommissionDispute }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { toast } = useToast();

  const escalateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/disputes/${dispute.id}/escalate`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/disputes"] });
      toast({ title: "Dispute escalated to senior reviewer" });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-orange-600 border-orange-300" data-testid={`button-escalate-${dispute.id}`}>
          <ChevronUp className="h-4 w-4 mr-1" />
          Escalate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Escalate Dispute</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Escalating this dispute will flag it for senior reviewer attention.</p>
          <div>
            <Label>Escalation Note</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for escalation..." rows={3} data-testid="input-escalation-note" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-orange-600 hover:bg-orange-700" onClick={() => escalateMutation.mutate()} disabled={escalateMutation.isPending} data-testid="button-confirm-escalate">
              {escalateMutation.isPending ? "Escalating..." : "Escalate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewDisputeDialog({ dispute, userName }: { dispute: CommissionDispute; userName: string }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "evidence" | "timeline">("details");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`button-view-admin-dispute-${dispute.id}`}>
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Dispute Details
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DisputeTypeBadge type={dispute.disputeType} />
            <div className="flex items-center gap-2">
              {dispute.commissionFrozen && (
                <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 gap-1 text-xs">
                  <Shield className="h-3 w-3" />
                  Commission Frozen
                </Badge>
              )}
              <DisputeStatusBadge status={dispute.status} />
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Submitted By</p>
            <p className="font-medium">{userName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Title</p>
            <p className="font-medium">{dispute.title}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Description</p>
            <p className="text-sm">{dispute.description}</p>
          </div>

          {(dispute.expectedAmount || dispute.actualAmount) && (
            <div className="grid grid-cols-3 gap-4 pt-2 border-t">
              <div><p className="text-xs text-muted-foreground">Expected</p><p className="font-medium">{formatCurrency(dispute.expectedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Actual</p><p className="font-medium">{formatCurrency(dispute.actualAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Difference</p><p className="font-medium text-red-600">{formatCurrency(dispute.differenceAmount)}</p></div>
            </div>
          )}

          {dispute.legalHoldAt && (
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-xs font-medium text-purple-700 dark:text-purple-400 flex items-center gap-1">
                <Shield className="h-3 w-3" /> Legal Hold Active
              </p>
              <p className="text-xs text-muted-foreground mt-1">Since {formatDate(dispute.legalHoldAt)}</p>
              {dispute.legalHoldReason && <p className="text-sm mt-1">{dispute.legalHoldReason}</p>}
            </div>
          )}

          {dispute.resolution && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">Resolution</p>
              <p className="text-sm">{dispute.resolution}</p>
              {dispute.resolvedAmount && <p className="text-sm font-medium mt-1">Resolved: {formatCurrency(dispute.resolvedAmount)}</p>}
              {dispute.resolvedAt && <p className="text-xs text-muted-foreground mt-1">On {formatDate(dispute.resolvedAt)}</p>}
            </div>
          )}

          <div className="border-t pt-2">
            <div className="flex gap-2 border-b mb-3">
              {(["details", "evidence", "timeline"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2 text-sm font-medium border-b-2 capitalize transition-colors ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} data-testid={`tab-${tab}`}>
                  {tab === "evidence" ? <><Paperclip className="inline h-3.5 w-3.5 mr-1" />Evidence</> : tab === "timeline" ? <><History className="inline h-3.5 w-3.5 mr-1" />Timeline</> : "Details"}
                </button>
              ))}
            </div>

            {activeTab === "details" && (
              <div className="text-xs text-muted-foreground">
                Submitted on {formatDate(dispute.createdAt)}
                {dispute.autoEscalated && (
                  <Badge className="ml-2 bg-orange-100 text-orange-700 dark:bg-orange-900/30 text-xs">Auto-escalated</Badge>
                )}
              </div>
            )}
            {activeTab === "evidence" && <EvidencePanel disputeId={dispute.id} />}
            {activeTab === "timeline" && <EscalationTimeline disputeId={dispute.id} />}
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
  const escalatedCount = disputes?.filter(d => ["ESCALATED", "LEGAL_HOLD"].includes(d.dispute.status)).length || 0;
  const resolvedCount = disputes?.filter(d => ["APPROVED", "REJECTED", "CLOSED"].includes(d.dispute.status)).length || 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Commission Disputes</h1>
        <p className="text-muted-foreground">Review, escalate, and resolve commission disputes from reps</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{disputes?.length || 0}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Pending</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-amber-600">{pendingCount}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Escalated / Hold</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-orange-600">{escalatedCount}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Resolved</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-green-600">{resolvedCount}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />All Disputes</CardTitle>
            <CardDescription>Manage commission dispute submissions</CardDescription>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="select-status-filter"><SelectValue placeholder="Filter by status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="ESCALATED">Escalated</SelectItem>
              <SelectItem value="LEGAL_HOLD">Legal Hold</SelectItem>
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
                  <TableRow key={dispute.id} data-testid={`row-dispute-${dispute.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{user?.name || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{user?.repId}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{dispute.title}</TableCell>
                    <TableCell><DisputeTypeBadge type={dispute.disputeType} /></TableCell>
                    <TableCell className="text-red-600 dark:text-red-400 font-medium">{formatCurrency(dispute.differenceAmount)}</TableCell>
                    <TableCell>{formatDate(dispute.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <DisputeStatusBadge status={dispute.status} />
                        {dispute.commissionFrozen && (
                          <span className="text-xs text-purple-600">Commission frozen</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 flex-wrap">
                        <ViewDisputeDialog dispute={dispute} userName={user?.name || "Unknown"} />
                        {["PENDING", "UNDER_REVIEW", "ESCALATED", "LEGAL_HOLD"].includes(dispute.status) && (
                          <>
                            {dispute.status === "PENDING" && (
                              <Button size="sm" variant="ghost" onClick={() => updateStatusMutation.mutate({ id: dispute.id, status: "UNDER_REVIEW" })} data-testid={`button-start-review-${dispute.id}`}>
                                Start Review
                              </Button>
                            )}
                            {["PENDING", "UNDER_REVIEW"].includes(dispute.status) && (
                              <EscalateDialog dispute={dispute} />
                            )}
                            <LegalHoldDialog dispute={dispute} />
                            {dispute.status !== "LEGAL_HOLD" && (
                              <ResolveDisputeDialog dispute={dispute} userName={user?.name || "Unknown"} />
                            )}
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
