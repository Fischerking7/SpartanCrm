import { useState, useEffect } from "react";
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
import { Plus, Calendar, Lock, Check, Eye, DollarSign, Users, FileText, Link, Trash2, Unlink, Send, CheckCircle, XCircle, ClipboardCheck, FileSearch, AlertTriangle, Split, Percent, TrendingUp, ArrowDown, ArrowUp, Shield, Loader2, Timer, Mail, History, User } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PayRun, SalesOrder } from "@shared/schema";

interface EnrichedPayRun extends PayRun {
  orderCount: number;
  totalCommission: string;
  totalIncentives: string;
}

interface PayRunDetails extends PayRun {
  orders: SalesOrder[];
  stats: {
    totalOrders: number;
    totalCommission: string;
    repBreakdown: { name: string; total: number; count: number }[];
  };
}

interface PayRunSummary {
  payRunId: string;
  status: string;
  orderCount: number;
  repCount: number;
  statementCount: number;
  totalGross: string;
  totalNet: string;
  totalDeductions: string;
  totalChargebacks: string;
  totalReserveWithheld: string;
  totalIncentives: string;
  totalOverrides: string;
  avgPay: string;
  minPayout: string;
  maxPayout: string;
  flaggedItems: { type: string; severity: "warning" | "error"; message: string; repId?: string }[];
  preFlightChecks: { label: string; status: "pass" | "warn" | "fail"; detail?: string }[];
  canFinalize: boolean;
}

interface VarianceReport {
  payRunId: string;
  status: string;
  orderCount: number;
  statementCount: number;
  totalGross: string;
  totalDeductions: string;
  totalNetPay: string;
  totalIncentives: string;
  issues: string[];
  warnings?: string[];
  canFinalize: boolean;
  repSummaries: { repId: string; name: string; gross: number; deductions: number; net: number; incentives: number; hasNegative: boolean; hasCarryForward?: boolean }[];
}

interface PoolEntry {
  id: string;
  payRunId: string | null;
  salesOrderId: string;
  rateCardId: string;
  amount: string;
  status: "PENDING" | "DISTRIBUTED" | "NO_UPLINE";
  invoiceNumber?: string;
  repId?: string;
  dateSold?: string;
  distributions?: PoolDistribution[];
  distributedTotal?: string;
  remainingAmount?: string;
}

interface PoolDistribution {
  id: string;
  poolEntryId: string;
  recipientUserId: string;
  allocationType: "PERCENT" | "FIXED";
  allocationValue: string;
  calculatedAmount: string;
  status: "PENDING" | "APPLIED";
  recipientName?: string;
  recipientRepId?: string;
}

interface User {
  id: string;
  name: string;
  repId: string;
  role: string;
}

interface EmailStatusData {
  counts: { total: number; sent: number; failed: number; pending: number; skipped: number };
  statements: {
    statementId: string;
    userId: string;
    repName: string | null;
    repEmail: string | null;
    netPay: string;
    emailDeliveryStatus: string;
    emailDeliveryError: string | null;
    emailSentAt: string | null;
  }[];
}

function EmailDeliveryStatus({ payRunId }: { payRunId: string }) {
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);

  const { data: emailStatus, refetch } = useQuery<EmailStatusData>({
    queryKey: ["/api/admin/payruns", payRunId, "email-status"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/email-status`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const retryFailed = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/admin/payruns/${payRunId}/retry-emails`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.message || "Retry failed", variant: "destructive" });
      } else {
        toast({ title: data.message || "Retry complete" });
        refetch();
      }
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
    setRetrying(false);
  };

  if (!emailStatus) return null;

  const { counts } = emailStatus;
  const statusIcon = (status: string) => {
    switch (status) {
      case "SENT": return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
      case "FAILED": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      case "PENDING": return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
      case "SKIPPED": return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
      default: return null;
    }
  };

  return (
    <Card data-testid="email-delivery-status">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Pay Stub Email Delivery
        </CardTitle>
        {counts.failed > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={retryFailed}
            disabled={retrying}
            data-testid="button-retry-emails"
          >
            {retrying ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
            Retry Failed ({counts.failed})
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="flex gap-4 mb-3">
          <div className="flex items-center gap-1.5 text-sm">
            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            <span data-testid="text-email-sent-count">{counts.sent} sent</span>
          </div>
          {counts.failed > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <XCircle className="h-3.5 w-3.5" />
              <span data-testid="text-email-failed-count">{counts.failed} failed</span>
            </div>
          )}
          {counts.pending > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span data-testid="text-email-pending-count">{counts.pending} pending</span>
            </div>
          )}
          {counts.skipped > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span data-testid="text-email-skipped-count">{counts.skipped} skipped</span>
            </div>
          )}
        </div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {emailStatus.statements.map((s) => (
            <div key={s.statementId} className="flex items-center justify-between text-sm py-1 border-b last:border-0" data-testid={`email-row-${s.statementId}`}>
              <div className="flex items-center gap-2">
                {statusIcon(s.emailDeliveryStatus)}
                <span className="font-medium">{s.repName || "Unknown"}</span>
                <span className="text-xs text-muted-foreground">{s.repEmail || "no email"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">${parseFloat(s.netPay).toFixed(2)}</span>
                {s.emailDeliveryError && s.emailDeliveryStatus !== "SENT" && (
                  <span className="text-xs text-red-500 max-w-[200px] truncate" title={s.emailDeliveryError}>
                    {s.emailDeliveryError}
                  </span>
                )}
                {s.emailSentAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.emailSentAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface AuditEntry {
  id: string;
  action: string;
  actionLabel: string;
  actorName: string;
  actorRepId: string | null;
  details: string;
  tableName: string;
  timestamp: string;
}

function PayRunAuditTrail({ payRunId }: { payRunId: string }) {
  const { data: auditEntries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["/api/admin/payruns", payRunId, "audit-trail"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/audit-trail`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const actionIcon = (action: string) => {
    if (action.includes("create") || action.includes("auto_build")) return <Plus className="h-3.5 w-3.5 text-green-500" />;
    if (action.includes("unlink")) return <Unlink className="h-3.5 w-3.5 text-orange-500" />;
    if (action.includes("link")) return <Link className="h-3.5 w-3.5 text-blue-500" />;
    if (action.includes("submit")) return <Send className="h-3.5 w-3.5 text-blue-500" />;
    if (action.includes("approve")) return <Check className="h-3.5 w-3.5 text-green-500" />;
    if (action.includes("reject")) return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    if (action.includes("finalize")) return <Lock className="h-3.5 w-3.5 text-purple-500" />;
    if (action.includes("paid") || action.includes("mark")) return <DollarSign className="h-3.5 w-3.5 text-green-600" />;
    if (action.includes("delete")) return <Trash2 className="h-3.5 w-3.5 text-red-500" />;
    if (action.includes("generate") || action.includes("stubs")) return <FileText className="h-3.5 w-3.5 text-blue-500" />;
    if (action.includes("override") || action.includes("distribution")) return <Split className="h-3.5 w-3.5 text-indigo-500" />;
    if (action.includes("scheduled") || action.includes("full_cycle")) return <Timer className="h-3.5 w-3.5 text-teal-500" />;
    return <History className="h-3.5 w-3.5 text-gray-500" />;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8" data-testid="payrun-audit-trail">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auditEntries || auditEntries.length === 0) {
    return (
      <div className="text-center py-8" data-testid="payrun-audit-trail">
        <History className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No audit history yet</p>
      </div>
    );
  }

  return (
    <div data-testid="payrun-audit-trail">
      <div className="relative space-y-0">
        <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />
        {auditEntries.map((entry, idx) => (
          <div key={entry.id} className="relative flex gap-3 py-2" data-testid={`audit-entry-${idx}`}>
            <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-background border">
              {actionIcon(entry.action)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm font-medium" data-testid={`audit-action-${idx}`}>{entry.actionLabel}</span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {entry.actorName}
                  {entry.actorRepId && <span className="font-mono">({entry.actorRepId})</span>}
                </span>
              </div>
              {entry.details && (
                <p className="text-xs text-muted-foreground mt-0.5" data-testid={`audit-details-${idx}`}>{entry.details}</p>
              )}
              <p className="text-xs text-muted-foreground/60 mt-0.5" data-testid={`audit-time-${idx}`}>
                {new Date(entry.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PayRuns() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "history">("details");
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showVarianceDialog, setShowVarianceDialog] = useState(false);
  const [varianceReport, setVarianceReport] = useState<VarianceReport | null>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);
  const [payRunSummary, setPayRunSummary] = useState<PayRunSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedPayRun, setSelectedPayRun] = useState<PayRunDetails | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [unlinkOrderIds, setUnlinkOrderIds] = useState<string[]>([]);
  const [weekEndingDate, setWeekEndingDate] = useState("");
  const [payRunName, setPayRunName] = useState("");
  const [payRunToDelete, setPayRunToDelete] = useState<PayRun | null>(null);
  const [variancePayRunId, setVariancePayRunId] = useState<string | null>(null);
  const [showDistributionDialog, setShowDistributionDialog] = useState(false);
  const [distributionPayRunId, setDistributionPayRunId] = useState<string | null>(null);
  const [selectedPoolEntry, setSelectedPoolEntry] = useState<PoolEntry | null>(null);
  const [newDistRecipientId, setNewDistRecipientId] = useState("");
  const [newDistType, setNewDistType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [newDistValue, setNewDistValue] = useState("");

  const { data: payRuns, isLoading } = useQuery<EnrichedPayRun[]>({
    queryKey: ["/api/admin/payruns"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay runs");
      return res.json();
    },
  });

  const { data: scheduledRuns } = useQuery<{ id: string; name: string; frequency: string; nextRunAt: string | null; isActive: boolean }[]>({
    queryKey: ["/api/admin/scheduled-pay-runs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/scheduled-pay-runs", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const nextScheduledRun = scheduledRuns
    ?.filter(s => s.isActive && s.nextRunAt)
    ?.sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())?.[0] || null;

  const { data: unlinkedOrders } = useQuery<SalesOrder[]>({
    queryKey: ["/api/admin/payruns/unlinked-orders", selectedPayRun?.weekEndingDate],
    queryFn: async () => {
      const url = selectedPayRun?.weekEndingDate
        ? `/api/admin/payruns/unlinked-orders?weekEndingDate=${selectedPayRun.weekEndingDate}`
        : "/api/admin/payruns/unlinked-orders";
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showLinkDialog && !!selectedPayRun,
  });

  const { data: poolEntries, refetch: refetchPool } = useQuery<PoolEntry[]>({
    queryKey: ["/api/admin/payruns", distributionPayRunId, "override-pool"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/payruns/${distributionPayRunId}/override-pool`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showDistributionDialog && !!distributionPayRunId,
  });

  const { data: eligibleRecipients } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const users = await res.json();
      return users.filter((u: User) => ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(u.role));
    },
    enabled: showDistributionDialog,
  });

  const createDistributionMutation = useMutation({
    mutationFn: async ({ poolEntryId, recipientUserId, allocationType, allocationValue }: {
      poolEntryId: string;
      recipientUserId: string;
      allocationType: "PERCENT" | "FIXED";
      allocationValue: string;
    }) => {
      const res = await fetch(`/api/admin/payruns/${distributionPayRunId}/distributions`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ poolEntryId, recipientUserId, allocationType, allocationValue }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create distribution");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchPool();
      setNewDistRecipientId("");
      setNewDistValue("");
      toast({ title: "Distribution added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add distribution", description: error.message, variant: "destructive" });
    },
  });

  const deleteDistributionMutation = useMutation({
    mutationFn: async (distributionId: string) => {
      const res = await fetch(`/api/admin/payruns/${distributionPayRunId}/distributions/${distributionId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete distribution");
      }
      return res.json();
    },
    onSuccess: () => {
      refetchPool();
      toast({ title: "Distribution removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove distribution", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (selectedPoolEntry && poolEntries) {
      const updatedEntry = poolEntries.find(e => e.id === selectedPoolEntry.id);
      if (updatedEntry) {
        setSelectedPoolEntry(updatedEntry);
      }
    }
  }, [poolEntries]);

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
      if (selectedPayRun) {
        viewPayRun(selectedPayRun.id);
      }
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

  const fetchPayRunSummary = async (payRunId: string) => {
    setPayRunSummary(null);
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/admin/payruns/${payRunId}/summary`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.payRunId === payRunId) {
          setPayRunSummary(data);
        }
      }
    } catch { /* summary is non-blocking */ }
    setSummaryLoading(false);
  };

  const viewPayRun = async (payRunId: string) => {
    try {
      const res = await fetch(`/api/admin/payruns/${payRunId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay run details");
      const details = await res.json();
      setSelectedPayRun(details);
      setUnlinkOrderIds([]);
      setDetailTab("details");
      setShowDetailsDialog(true);
      fetchPayRunSummary(payRunId);
    } catch (error) {
      toast({ title: "Failed to load pay run details", variant: "destructive" });
    }
  };

  const linkAllOrders = async (payRunId: string) => {
    try {
      const res = await fetch(`/api/admin/payruns/${payRunId}/link-all-orders`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Orders Linked", description: data.message || `Linked ${data.linked} orders` });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to link orders", variant: "destructive" });
    }
  };

  const autoLinkAndGenerate = async (payRunId: string) => {
    try {
      // Step 1: Link all eligible orders
      const linkRes = await fetch(`/api/admin/payruns/${payRunId}/link-all-orders`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok) {
        toast({ title: "Error", description: linkData.message, variant: "destructive" });
        return;
      }

      // Step 2: Generate pay statements
      const genRes = await fetch(`/api/admin/payroll/payruns/${payRunId}/generate-statements`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const genData = await genRes.json();
      if (genRes.ok) {
        toast({ 
          title: "Pay Run Ready", 
          description: `Linked ${linkData.linked} orders and generated ${genData.generated} pay statements` 
        });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      } else {
        toast({ title: "Error generating statements", description: genData.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Auto-generate failed", variant: "destructive" });
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
      header: "Total Earnings",
      cell: (row: EnrichedPayRun) => (
        <span className="font-mono">${row.totalCommission}</span>
      ),
    },
    {
      key: "totalIncentives",
      header: "Incentives",
      cell: (row: EnrichedPayRun) => (
        <span className="font-mono text-green-600 dark:text-green-400" data-testid={`text-incentives-${row.id}`}>${row.totalIncentives}</span>
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
                size="sm"
                variant="outline"
                onClick={() => linkAllOrders(row.id)}
                data-testid={`button-link-all-${row.id}`}
              >
                <Link className="h-4 w-4 mr-1" />
                Link All
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => openLinkDialog(row)}
                data-testid={`button-link-orders-${row.id}`}
                title="Select specific orders to link"
              >
                <Link className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => autoLinkAndGenerate(row.id)}
                data-testid={`button-auto-generate-${row.id}`}
              >
                <FileText className="h-4 w-4 mr-1" />
                Auto-Generate
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
                variant="outline"
                onClick={() => {
                  setDistributionPayRunId(row.id);
                  setShowDistributionDialog(true);
                }}
                data-testid={`button-distribute-${row.id}`}
              >
                <Split className="h-4 w-4 mr-1" />
                Distribute
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
      totalIncentives: acc.totalIncentives + parseFloat(pr.totalIncentives || "0"),
      draftCount: acc.draftCount + (pr.status === "DRAFT" ? 1 : 0),
      finalizedCount: acc.finalizedCount + (pr.status === "FINALIZED" ? 1 : 0),
    }),
    { totalOrders: 0, totalCommission: 0, totalIncentives: 0, draftCount: 0, finalizedCount: 0 }
  ) || { totalOrders: 0, totalCommission: 0, totalIncentives: 0, draftCount: 0, finalizedCount: 0 };

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

      {nextScheduledRun && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" data-testid="next-scheduled-run-indicator">
          <Timer className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
              Next Scheduled Pay Run: <span className="font-semibold">{nextScheduledRun.name}</span>
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              {(() => {
                const nextDate = new Date(nextScheduledRun.nextRunAt!);
                const now = new Date();
                const diffMs = nextDate.getTime() - now.getTime();
                const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                const dateStr = nextDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
                if (diffDays <= 0) return `Scheduled for today (${dateStr})`;
                if (diffDays === 1) return `Tomorrow (${dateStr})`;
                return `In ${diffDays} days (${dateStr})`;
              })()}
              {" \u00B7 "}
              {nextScheduledRun.frequency === "BIWEEKLY" ? "Bi-Weekly" :
               nextScheduledRun.frequency === "SEMIMONTHLY" ? "Semi-Monthly" :
               nextScheduledRun.frequency.charAt(0) + nextScheduledRun.frequency.slice(1).toLowerCase()}
            </p>
          </div>
        </div>
      )}

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
              <TrendingUp className="h-4 w-4" />
              Total Incentives
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-incentives">${totalStats.totalIncentives.toFixed(2)}</p>
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
              <div className="flex border-b">
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${detailTab === "details" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setDetailTab("details")}
                  data-testid="tab-details"
                >
                  Details
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${detailTab === "history" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setDetailTab("history")}
                  data-testid="tab-history"
                >
                  <History className="h-3.5 w-3.5" />
                  History
                </button>
              </div>
              {detailTab === "details" && (<>
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
              
              {summaryLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground text-sm">Loading summary...</span>
                </div>
              ) : payRunSummary ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card data-testid="summary-total-gross">
                      <CardHeader className="pb-1 pt-3 px-3">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          Total Gross
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3">
                        <p className="text-xl font-bold font-mono">${payRunSummary.totalGross}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="summary-total-net">
                      <CardHeader className="pb-1 pt-3 px-3">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          Total Net Pay
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3">
                        <p className="text-xl font-bold font-mono text-green-600 dark:text-green-400">${payRunSummary.totalNet}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="summary-rep-count">
                      <CardHeader className="pb-1 pt-3 px-3">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          Reps Paid
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3">
                        <p className="text-xl font-bold">{payRunSummary.repCount}</p>
                        <p className="text-xs text-muted-foreground">{payRunSummary.orderCount} orders</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="summary-avg-pay">
                      <CardHeader className="pb-1 pt-3 px-3">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          Avg Net Pay
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3">
                        <p className="text-xl font-bold font-mono">${payRunSummary.avgPay}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <Card className="border-dashed" data-testid="summary-min-payout">
                      <CardContent className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <ArrowDown className="h-3 w-3" />
                          Min Payout
                        </div>
                        <p className="text-sm font-mono font-medium">${payRunSummary.minPayout}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-dashed" data-testid="summary-max-payout">
                      <CardContent className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <ArrowUp className="h-3 w-3" />
                          Max Payout
                        </div>
                        <p className="text-sm font-mono font-medium">${payRunSummary.maxPayout}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-dashed" data-testid="summary-chargebacks">
                      <CardContent className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <AlertTriangle className="h-3 w-3" />
                          Chargebacks
                        </div>
                        <p className={`text-sm font-mono font-medium ${parseFloat(payRunSummary.totalChargebacks) > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                          ${payRunSummary.totalChargebacks}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-dashed" data-testid="summary-reserve">
                      <CardContent className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <Shield className="h-3 w-3" />
                          Reserve Withheld
                        </div>
                        <p className="text-sm font-mono font-medium">${payRunSummary.totalReserveWithheld}</p>
                      </CardContent>
                    </Card>
                    <Card className="border-dashed" data-testid="summary-deductions">
                      <CardContent className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <Percent className="h-3 w-3" />
                          Deductions
                        </div>
                        <p className="text-sm font-mono font-medium">${payRunSummary.totalDeductions}</p>
                      </CardContent>
                    </Card>
                  </div>

                  {payRunSummary.preFlightChecks.length > 0 && (
                    <Card data-testid="preflight-checks">
                      <CardHeader className="pb-2 pt-3 px-4">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <ClipboardCheck className="h-4 w-4" />
                          Pre-Flight Checks
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-3">
                        <div className="space-y-1.5">
                          {payRunSummary.preFlightChecks.map((check, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-sm" data-testid={`preflight-check-${idx}`}>
                              {check.status === "pass" && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
                              {check.status === "warn" && <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />}
                              {check.status === "fail" && <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                              <span className={check.status === "fail" ? "text-red-600 dark:text-red-400 font-medium" : check.status === "warn" ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}>
                                {check.label}
                              </span>
                              {check.detail && (
                                <span className="text-xs text-muted-foreground ml-auto">{check.detail}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {payRunSummary.flaggedItems.length > 0 && (
                    <Alert variant="destructive" className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20" data-testid="flagged-items">
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      <AlertTitle className="text-yellow-800 dark:text-yellow-400">Flagged Items ({payRunSummary.flaggedItems.length})</AlertTitle>
                      <AlertDescription>
                        <ul className="mt-2 space-y-1">
                          {payRunSummary.flaggedItems.map((item, idx) => (
                            <li key={idx} className="text-sm text-yellow-700 dark:text-yellow-300 flex items-start gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
                              {item.message}
                            </li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
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
              )}

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

              {(selectedPayRun.status === "FINALIZED" || selectedPayRun.status === "PAID") && (
                <EmailDeliveryStatus payRunId={selectedPayRun.id} />
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
              </>)}

              {detailTab === "history" && (
                <PayRunAuditTrail payRunId={selectedPayRun.id} />
              )}
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
              {selectedPayRun && (() => {
                const weekEnd = new Date(selectedPayRun.weekEndingDate);
                const weekStart = new Date(selectedPayRun.weekEndingDate);
                weekStart.setDate(weekStart.getDate() - 6);
                return `Showing orders approved between ${weekStart.toLocaleDateString()} and ${weekEnd.toLocaleDateString()}`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {unlinkedOrders?.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No orders were approved during this pay week</p>
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
                    <div className="flex-1 grid grid-cols-5 gap-2">
                      <span className="font-mono text-sm">{order.invoiceNumber}</span>
                      <span className="font-mono">{order.repId}</span>
                      <span className="truncate">{order.customerName}</span>
                      <span className="text-sm text-muted-foreground">
                        {order.approvedAt ? new Date(order.approvedAt).toLocaleDateString() : '-'}
                      </span>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-muted/30 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Orders</p>
                  <p className="text-xl font-bold">{varianceReport.orderCount}</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Total Gross</p>
                  <p className="text-xl font-bold font-mono">${varianceReport.totalGross}</p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg text-center" data-testid="text-variance-incentives">
                  <p className="text-sm text-muted-foreground">Incentives</p>
                  <p className="text-xl font-bold font-mono text-green-600 dark:text-green-400">${varianceReport.totalIncentives}</p>
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

              {varianceReport.warnings && varianceReport.warnings.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <AlertTitle>Carry-Forward Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-2 space-y-1">
                      {varianceReport.warnings.map((warning: string, idx: number) => (
                        <li key={idx} className="text-orange-600">{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {varianceReport.issues.length === 0 && (!varianceReport.warnings || varianceReport.warnings.length === 0) && (
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
                          {rep.incentives > 0 && (
                            <span className="text-sm text-green-600 dark:text-green-400">Incentives: ${rep.incentives.toFixed(2)}</span>
                          )}
                          <span className="text-sm text-muted-foreground">Deductions: ${rep.deductions.toFixed(2)}</span>
                          <span className={`font-mono font-medium ${rep.hasNegative || rep.hasCarryForward ? "text-destructive" : ""}`}>
                            Net: ${rep.net.toFixed(2)}
                          </span>
                          {(rep.hasNegative || rep.hasCarryForward) && (
                            <Badge variant="outline" className="text-xs text-orange-600" data-testid={`badge-cf-${rep.repId}`}>
                              <AlertTriangle className="h-3 w-3 mr-1" /> Carry-forward
                            </Badge>
                          )}
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

      <Dialog open={showDistributionDialog} onOpenChange={(open) => {
        setShowDistributionDialog(open);
        if (!open) {
          setDistributionPayRunId(null);
          setSelectedPoolEntry(null);
          setNewDistRecipientId("");
          setNewDistValue("");
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Split className="h-5 w-5" />
              Override Distribution Manager
            </DialogTitle>
            <DialogDescription>
              Configure how override earnings are distributed to supervisors, managers, and executives for this pay run.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden flex gap-4">
            <div className="w-1/2 border rounded-lg overflow-hidden flex flex-col">
              <div className="bg-muted px-4 py-2 border-b">
                <h4 className="font-medium">Override Pool</h4>
                <p className="text-xs text-muted-foreground">Orders with eligible override amounts</p>
              </div>
              <ScrollArea className="flex-1">
                <div className="divide-y">
                  {poolEntries?.length === 0 && (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                      No override-eligible orders in this pay run.
                    </div>
                  )}
                  {poolEntries?.map((entry) => {
                    const remaining = parseFloat(entry.remainingAmount || entry.amount);
                    
                    return (
                      <div
                        key={entry.id}
                        className={`p-3 cursor-pointer hover-elevate ${selectedPoolEntry?.id === entry.id ? "bg-accent" : ""}`}
                        onClick={() => setSelectedPoolEntry(entry)}
                        data-testid={`pool-entry-${entry.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-mono text-sm">{entry.invoiceNumber || "Unknown"}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono text-sm font-medium">${parseFloat(entry.amount).toFixed(2)}</span>
                            {entry.distributions && entry.distributions.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                ${remaining.toFixed(2)} remaining
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={entry.status === "DISTRIBUTED" ? "default" : entry.status === "NO_UPLINE" ? "secondary" : "outline"} className="text-xs">
                            {entry.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Rep: {entry.repId || "Unknown"}
                          </span>
                          {entry.distributions && entry.distributions.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({entry.distributions.length} dist.)
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <div className="w-1/2 border rounded-lg overflow-hidden flex flex-col">
              <div className="bg-muted px-4 py-2 border-b">
                <h4 className="font-medium">
                  {selectedPoolEntry ? "Configure Distribution" : "Select an Entry"}
                </h4>
              </div>
              
              {!selectedPoolEntry ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
                  Select an order from the pool to configure its distribution.
                </div>
              ) : (
                <div className="flex-1 overflow-auto p-4 space-y-4">
                  <div className="bg-muted/30 p-3 rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium">{selectedPoolEntry.invoiceNumber}</span>
                      <span className="font-mono font-medium">${parseFloat(selectedPoolEntry.amount).toFixed(2)}</span>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Rep: {selectedPoolEntry.repId}</p>
                      {selectedPoolEntry.remainingAmount && (
                        <p>Remaining: <span className="font-mono">${selectedPoolEntry.remainingAmount}</span></p>
                      )}
                    </div>
                  </div>

                  {selectedPoolEntry.distributions && selectedPoolEntry.distributions.length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-sm font-medium">Current Distributions</h5>
                      {selectedPoolEntry.distributions.map((dist) => (
                        <div key={dist.id} className="flex items-center justify-between p-2 border rounded">
                          <div>
                            <span className="text-sm font-medium">{dist.recipientName || "Unknown"}</span>
                            <p className="text-xs text-muted-foreground">
                              {dist.allocationType === "PERCENT" ? `${dist.allocationValue}%` : `$${dist.allocationValue}`}
                              {" → "}
                              <span className="font-mono">${parseFloat(dist.calculatedAmount).toFixed(2)}</span>
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteDistributionMutation.mutate(dist.id)}
                            disabled={deleteDistributionMutation.isPending || dist.status === "APPLIED"}
                            data-testid={`button-delete-dist-${dist.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedPoolEntry.status !== "NO_UPLINE" && (
                    <div className="space-y-3 border-t pt-3">
                      <h5 className="text-sm font-medium">Add Distribution</h5>
                      <div className="space-y-2">
                        <Label className="text-xs">Recipient</Label>
                        <Select value={newDistRecipientId} onValueChange={setNewDistRecipientId}>
                          <SelectTrigger data-testid="select-recipient">
                            <SelectValue placeholder="Select recipient..." />
                          </SelectTrigger>
                          <SelectContent>
                            {eligibleRecipients?.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.name} ({user.repId}) - {user.role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Type</Label>
                          <Select value={newDistType} onValueChange={(v) => setNewDistType(v as "PERCENT" | "FIXED")}>
                            <SelectTrigger data-testid="select-dist-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PERCENT">Percentage</SelectItem>
                              <SelectItem value="FIXED">Fixed Amount</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">{newDistType === "PERCENT" ? "%" : "$"}</Label>
                          <div className="relative">
                            <Input
                              type="number"
                              step={newDistType === "PERCENT" ? "1" : "0.01"}
                              value={newDistValue}
                              onChange={(e) => setNewDistValue(e.target.value)}
                              placeholder={newDistType === "PERCENT" ? "e.g. 60" : "e.g. 25.00"}
                              className="pr-8"
                              data-testid="input-dist-value"
                            />
                            {newDistType === "PERCENT" ? (
                              <Percent className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            ) : (
                              <DollarSign className="h-4 w-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        className="w-full"
                        onClick={() => {
                          if (!newDistRecipientId || !newDistValue) return;
                          createDistributionMutation.mutate({
                            poolEntryId: selectedPoolEntry.id,
                            recipientUserId: newDistRecipientId,
                            allocationType: newDistType,
                            allocationValue: newDistValue,
                          });
                        }}
                        disabled={!newDistRecipientId || !newDistValue || createDistributionMutation.isPending}
                        data-testid="button-add-distribution"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Distribution
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <DialogFooter className="gap-2">
            <div className="flex-1 text-sm text-muted-foreground">
              {poolEntries && (
                <>
                  {poolEntries.filter(p => p.status === "PENDING").length} pending,{" "}
                  {poolEntries.filter(p => p.status === "DISTRIBUTED").length} distributed
                </>
              )}
            </div>
            <Button variant="outline" onClick={() => setShowDistributionDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
