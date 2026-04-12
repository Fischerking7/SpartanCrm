import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, FileText, Clock, CheckCircle, XCircle, Eye, Plus, ChevronUp, Shield, Upload, Paperclip, History } from "lucide-react";
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/config";

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
  commissionFrozen: boolean;
  autoEscalated: boolean;
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
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string) {
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit" }).format(new Date(date));
}

function formatDateTime(date: string) {
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" }).format(new Date(date));
}

function DisputeStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const variants: Record<string, { className: string; icon: React.ComponentType<{ className?: string }>; labelKey: string }> = {
    PENDING: { className: "border text-muted-foreground", icon: Clock, labelKey: "disputes.statusPending" },
    UNDER_REVIEW: { className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0", icon: Eye, labelKey: "disputes.statusUnderReview" },
    ESCALATED: { className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-0", icon: ChevronUp, labelKey: "disputes.statusEscalated" },
    LEGAL_HOLD: { className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-0", icon: Shield, labelKey: "disputes.statusLegalHold" },
    APPROVED: { className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0", icon: CheckCircle, labelKey: "disputes.statusApproved" },
    REJECTED: { className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0", icon: XCircle, labelKey: "disputes.statusRejected" },
    CLOSED: { className: "border text-muted-foreground", icon: CheckCircle, labelKey: "disputes.statusClosed" },
  };
  const config = variants[status] || { className: "border", icon: AlertCircle, labelKey: "" };
  const Icon = config.icon;
  return (
    <Badge className={`gap-1 ${config.className}`}>
      <Icon className="h-3 w-3" />
      {config.labelKey ? t(config.labelKey) : status}
    </Badge>
  );
}

function EscalationTimeline({ disputeId }: { disputeId: string }) {
  const { t } = useTranslation();
  const { data: events, isLoading } = useQuery<EscalationEvent[]>({
    queryKey: ["/api/disputes", disputeId, "timeline"],
    queryFn: async () => {
      const res = await fetch(`/api/disputes/${disputeId}/timeline`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load timeline");
      return res.json();
    },
  });

  const eventTypeLabel: Record<string, string> = {
    STATUS_CHANGED: t("disputes.eventStatusChanged"),
    ESCALATED: t("disputes.eventEscalated"),
    LEGAL_HOLD_PLACED: t("disputes.eventLegalHoldPlaced"),
    LEGAL_HOLD_RELEASED: t("disputes.eventLegalHoldReleased"),
    RESOLVED: t("disputes.eventResolved"),
    EVIDENCE_UPLOADED: t("disputes.eventEvidenceUploaded"),
    CREATED: t("disputes.eventCreated"),
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
    return <p className="text-sm text-muted-foreground py-2">{t("disputes.noUpdatesYet")}</p>;
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
              <span className="text-xs text-muted-foreground ml-auto">{formatDateTime(event.createdAt)}</span>
            </div>
            {event.note && <p className="text-sm mt-0.5 text-muted-foreground">{event.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidencePanel({ disputeId, status }: { disputeId: string; status: string }) {
  const { t } = useTranslation();
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
  const canUpload = !["APPROVED", "REJECTED", "CLOSED"].includes(status);

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
      toast({ title: t("disputes.evidenceUploaded") });
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: Error) => toast({ title: t("disputes.uploadFailed"), description: e.message, variant: "destructive" }),
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
      {canUpload && (
        <div className="flex items-center gap-2">
          <Input
            placeholder={t("disputes.evidenceDescriptionPlaceholder")}
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
            {uploadMutation.isPending ? t("disputes.uploading") : t("disputes.upload")}
          </Button>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !attachments || attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">{canUpload ? t("disputes.noEvidenceCanUpload") : t("disputes.noEvidenceCannotUpload")}</p>
      ) : (
        <div className="space-y-2">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-2 p-2 border rounded-lg text-sm" data-testid={`evidence-${att.id}`}>
              <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{att.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(att.fileSize)} · {formatDate(att.createdAt)}
                  {att.description && ` · ${att.description}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewDisputeDialog({ dispute }: { dispute: CommissionDispute }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "evidence" | "timeline">("details");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`button-view-dispute-${dispute.id}`}>
          <Eye className="h-4 w-4 mr-1" />
          {t("disputes.view")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("disputes.disputeDetails")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <DisputeStatusBadge status={dispute.status} />
            {dispute.commissionFrozen && (
              <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 gap-1 text-xs">
                <Shield className="h-3 w-3" />
                {t("disputes.commissionFrozen")}
              </Badge>
            )}
          </div>

          {dispute.status === "LEGAL_HOLD" && (
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-xs font-medium text-purple-700 dark:text-purple-400">{t("disputes.legalHoldActiveLabel")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("disputes.legalHoldFrozenNote")}</p>
              {dispute.legalHoldReason && <p className="text-sm mt-1">{dispute.legalHoldReason}</p>}
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground">{t("disputes.titleField")}</p>
            <p className="font-medium">{dispute.title}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("disputes.descriptionField")}</p>
            <p className="text-sm">{dispute.description}</p>
          </div>

          {(dispute.expectedAmount || dispute.actualAmount) && (
            <div className="grid grid-cols-3 gap-4 pt-2 border-t">
              <div><p className="text-xs text-muted-foreground">{t("disputes.expected")}</p><p className="font-medium">{formatCurrency(dispute.expectedAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("disputes.actual")}</p><p className="font-medium">{formatCurrency(dispute.actualAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t("disputes.difference")}</p><p className="font-medium text-red-600">{formatCurrency(dispute.differenceAmount)}</p></div>
            </div>
          )}

          {dispute.resolution && (
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">{t("disputes.adminResolution")}</p>
              <p className="text-sm mt-1">{dispute.resolution}</p>
              {dispute.resolvedAmount && <p className="text-sm font-medium mt-1">{t("disputes.adjustment", { amount: formatCurrency(dispute.resolvedAmount) })}</p>}
              {dispute.resolvedAt && <p className="text-xs text-muted-foreground mt-1">{t("disputes.resolvedOn", { date: formatDate(dispute.resolvedAt) })}</p>}
            </div>
          )}

          <div className="border-t pt-2">
            <div className="flex gap-2 border-b mb-3">
              {(["details", "evidence", "timeline"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2 text-sm font-medium border-b-2 capitalize transition-colors ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} data-testid={`tab-${tab}`}>
                  {tab === "evidence" ? <><Paperclip className="inline h-3.5 w-3.5 mr-1" />{t("disputes.evidenceTab")}</> : tab === "timeline" ? <><History className="inline h-3.5 w-3.5 mr-1" />{t("disputes.timelineTab")}</> : t("disputes.detailsTab")}
                </button>
              ))}
            </div>

            {activeTab === "details" && (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t("disputes.submittedOn", { date: formatDate(dispute.createdAt) })}</p>
                {dispute.escalatedAt && <p className="text-orange-600">{t("disputes.escalatedOn", { date: formatDate(dispute.escalatedAt) })}</p>}
                {dispute.autoEscalated && <Badge className="bg-orange-100 text-orange-700 text-xs">{t("disputes.autoEscalated")}</Badge>}
              </div>
            )}
            {activeTab === "evidence" && <EvidencePanel disputeId={dispute.id} status={dispute.status} />}
            {activeTab === "timeline" && <EscalationTimeline disputeId={dispute.id} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewDisputeDialog({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({
    disputeType: "",
    title: "",
    description: "",
    expectedAmount: "",
    actualAmount: "",
    salesOrderId: "",
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const body: { disputeType: string; title: string; description: string; expectedAmount?: number; actualAmount?: number; salesOrderId?: string } = {
        disputeType: data.disputeType,
        title: data.title,
        description: data.description,
      };
      if (data.expectedAmount) body.expectedAmount = parseFloat(data.expectedAmount);
      if (data.actualAmount) body.actualAmount = parseFloat(data.actualAmount);
      if (data.salesOrderId) body.salesOrderId = data.salesOrderId;

      const res = await fetch("/api/disputes", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to submit dispute");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("disputes.disputeSubmitted"), description: t("disputes.disputeSubmittedDesc") });
      setOpen(false);
      setForm({ disputeType: "", title: "", description: "", expectedAmount: "", actualAmount: "", salesOrderId: "" });
      onCreated();
    },
    onError: (error: Error) => toast({ title: t("disputes.failedToSubmit"), description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-dispute">
          <Plus className="h-4 w-4 mr-2" />
          {t("disputes.submitDispute")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t("disputes.submitDialogTitle")}</DialogTitle></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (!form.disputeType || !form.title || !form.description) return; createMutation.mutate(form); }} className="space-y-4">
          <div>
            <Label>{t("disputes.disputeTypeRequired")}</Label>
            <Select value={form.disputeType} onValueChange={v => setForm({ ...form, disputeType: v })}>
              <SelectTrigger data-testid="select-dispute-type"><SelectValue placeholder={t("disputes.selectType")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MISSING_COMMISSION">{t("disputes.missingCommission")}</SelectItem>
                <SelectItem value="INCORRECT_AMOUNT">{t("disputes.incorrectAmount")}</SelectItem>
                <SelectItem value="INCORRECT_SERVICE">{t("disputes.incorrectService")}</SelectItem>
                <SelectItem value="CHARGEBACK_DISPUTE">{t("disputes.chargebackDispute")}</SelectItem>
                <SelectItem value="OTHER">{t("disputes.other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("disputes.titleLabel")}</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t("disputes.titlePlaceholder")} data-testid="input-dispute-title" />
          </div>
          <div>
            <Label>{t("disputes.descriptionLabel")}</Label>
            <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t("disputes.descriptionPlaceholder")} rows={3} data-testid="input-dispute-description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("disputes.expectedAmount")}</Label>
              <Input type="number" step="0.01" value={form.expectedAmount} onChange={e => setForm({ ...form, expectedAmount: e.target.value })} placeholder="$0.00" data-testid="input-expected-amount" />
            </div>
            <div>
              <Label>{t("disputes.actualAmount")}</Label>
              <Input type="number" step="0.01" value={form.actualAmount} onChange={e => setForm({ ...form, actualAmount: e.target.value })} placeholder="$0.00" data-testid="input-actual-amount" />
            </div>
          </div>
          <div>
            <Label>{t("disputes.relatedOrderId")}</Label>
            <Input value={form.salesOrderId} onChange={e => setForm({ ...form, salesOrderId: e.target.value })} placeholder={t("disputes.orderIdPlaceholder")} data-testid="input-sales-order-id" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("disputes.cancel")}</Button>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-dispute">
              {createMutation.isPending ? t("disputes.submitting") : t("disputes.submitDispute")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MyDisputes() {
  const { t } = useTranslation();
  const { data: disputes, isLoading, refetch } = useQuery<CommissionDispute[]>({
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
        <Skeleton className="h-8 w-48" />
        <div className="space-y-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  const legalHoldCount = disputes?.filter(d => d.status === "LEGAL_HOLD").length || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">{t("disputes.title")}</h1>
          <p className="text-muted-foreground">{t("disputes.subtitle")}</p>
        </div>
        <NewDisputeDialog onCreated={() => refetch()} />
      </div>

      {legalHoldCount > 0 && (
        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg flex items-start gap-3">
          <Shield className="h-5 w-5 text-purple-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-purple-700 dark:text-purple-400">{t("disputes.legalHoldActive")}</p>
            <p className="text-sm text-muted-foreground">
              {legalHoldCount > 1
                ? t("disputes.legalHoldBannerPlural", { count: legalHoldCount })
                : t("disputes.legalHoldBanner", { count: legalHoldCount })}
            </p>
          </div>
        </div>
      )}

      {!disputes || disputes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">{t("disputes.noDisputes")}</p>
          <p className="text-sm mt-1">{t("disputes.noDisputesHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {disputes.map(dispute => (
            <Card key={dispute.id} data-testid={`card-dispute-${dispute.id}`} className={dispute.status === "LEGAL_HOLD" ? "border-purple-200 dark:border-purple-800" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <DisputeStatusBadge status={dispute.status} />
                      {dispute.autoEscalated && (
                        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 text-xs">{t("disputes.autoEscalated")}</Badge>
                      )}
                      {dispute.commissionFrozen && (
                        <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 text-xs gap-1">
                          <Shield className="h-3 w-3" />
                          {t("disputes.commissionFrozen")}
                        </Badge>
                      )}
                    </div>
                    <p className="font-medium truncate">{dispute.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("disputes.submittedOn", { date: formatDate(dispute.createdAt) })}
                      {dispute.differenceAmount && ` · ${t("disputes.disputed", { amount: formatCurrency(dispute.differenceAmount) })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <ViewDisputeDialog dispute={dispute} />
                  </div>
                </div>

                {dispute.status === "LEGAL_HOLD" && dispute.legalHoldReason && (
                  <div className="mt-3 p-2 bg-purple-50 dark:bg-purple-900/20 rounded text-xs text-muted-foreground">
                    <strong className="text-purple-700 dark:text-purple-400">{t("disputes.legalHoldReason")}</strong> {dispute.legalHoldReason}
                  </div>
                )}

                {dispute.resolution && (
                  <div className="mt-3 p-2 bg-muted rounded text-xs">
                    <strong>{t("disputes.resolution")}</strong> {dispute.resolution}
                    {dispute.resolvedAmount && <span className="ml-2 text-green-600">{t("disputes.adjustment", { amount: formatCurrency(dispute.resolvedAmount) })}</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
