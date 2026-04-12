import { useState } from "react";
import i18n from "i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  UserCheck, Clock, CheckCircle, XCircle, Search, FileText,
  Send, Shield, AlertTriangle, Eye, ChevronRight
} from "lucide-react";

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString(i18n.language === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusBadge(status: string) {
  const map: Record<string, { color: string; icon: any }> = {
    PENDING: { color: "text-yellow-600", icon: Clock },
    UNDER_REVIEW: { color: "text-blue-600", icon: Eye },
    APPROVED: { color: "text-green-600", icon: CheckCircle },
    REJECTED: { color: "text-red-600", icon: XCircle },
  };
  const s = map[status] || map.PENDING;
  const Icon = s.icon;
  return <Badge variant="outline" className={s.color}><Icon className="h-3 w-3 mr-1" />{status}</Badge>;
}

function complianceBadge(status: string) {
  if (status === "CLEARED") return <Badge variant="outline" className="text-green-600">Cleared</Badge>;
  if (status === "FAILED") return <Badge variant="outline" className="text-red-600">Failed</Badge>;
  if (status === "SUBMITTED") return <Badge variant="outline" className="text-blue-600">Submitted</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
}

function onboardingStatusBadge(status: string) {
  const colors: Record<string, string> = {
    NOT_STARTED: "text-muted-foreground",
    OTP_SENT: "text-blue-600",
    OTP_VERIFIED: "text-blue-700",
    IN_PROGRESS: "text-yellow-600",
    SUBMITTED: "text-orange-600",
    UNDER_REVIEW: "text-purple-600",
    APPROVED: "text-green-600",
    REJECTED: "text-red-600",
  };
  return <Badge variant="outline" className={colors[status] || "text-muted-foreground"}>{status.replace(/_/g, " ")}</Badge>;
}

export default function OnboardingReview() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [complianceUserId, setComplianceUserId] = useState<string | null>(null);
  const [complianceForm, setComplianceForm] = useState({ backgroundCheckStatus: "", drugTestStatus: "", notes: "" });

  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search) params.set("search", search);

  const { data: submissions, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/onboarding/submissions", statusFilter, search],
    queryFn: async () => {
      const res = await fetch(`/api/admin/onboarding/submissions?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load submissions");
      return res.json();
    },
    staleTime: Infinity,
  });

  const { data: detail } = useQuery<any>({
    queryKey: ["/api/admin/onboarding/submissions", selectedId],
    queryFn: async () => {
      if (!selectedId) return null;
      const res = await fetch(`/api/admin/onboarding/submissions/${selectedId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load detail");
      return res.json();
    },
    enabled: !!selectedId,
    staleTime: Infinity,
  });

  const approve = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/admin/onboarding/submissions/${id}/approve`, {}); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/onboarding/submissions"] });
      setSelectedId(null);
      toast({ title: "Onboarding approved — rep now has app access" });
    },
    onError: () => toast({ title: "Approval failed", variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/admin/onboarding/submissions/${id}/reject`, { reason: rejectReason }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/onboarding/submissions"] });
      setShowReject(false);
      setSelectedId(null);
      setRejectReason("");
      toast({ title: "Onboarding rejected — rep and manager notified" });
    },
    onError: () => toast({ title: "Rejection failed", variant: "destructive" }),
  });

  const updateCompliance = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/onboarding/${userId}/update-compliance`, complianceForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/onboarding/submissions"] });
      setComplianceUserId(null);
      setComplianceForm({ backgroundCheckStatus: "", drugTestStatus: "", notes: "" });
      toast({ title: "Compliance status updated" });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const sendOtp = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("POST", `/api/admin/onboarding/${userId}/send-otp`, {}); },
    onSuccess: () => toast({ title: "OTP sent" }),
    onError: () => toast({ title: "Failed to send OTP", variant: "destructive" }),
  });

  const pending = submissions?.filter(s => s.status === "PENDING") || [];
  const reviewed = submissions?.filter(s => s.status !== "PENDING") || [];

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" data-testid="onboarding-review-page">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <UserCheck className="h-5 w-5" /> Contractor Onboarding
        </h1>
        {pending.length > 0 && (
          <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            {pending.length} pending review
          </Badge>
        )}
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search by name or Rep ID..."
            className="pl-8"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-onboarding"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" data-testid="tab-queue">
            Review Queue {pending.length > 0 && `(${pending.length})`}
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all">All Submissions</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          {pending.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-10 w-10 mx-auto text-green-500 mb-3" />
                <p className="text-sm text-muted-foreground">No pending submissions</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pending.map((s: any) => (
                <Card key={s.id} className="cursor-pointer hover:border-foreground/20 transition-colors" onClick={() => setSelectedId(s.id)} data-testid={`submission-${s.id}`}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                        <FileText className="h-5 w-5 text-orange-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{s.repName}</p>
                        <p className="text-xs text-muted-foreground">Rep ID: {s.repId} · {s.documentsCompleted}/7 docs · Submitted {fmt(s.submittedAt)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(s.status)}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all">
          {(!submissions || submissions.length === 0) ? (
            <Card><CardContent className="py-12 text-center"><p className="text-sm text-muted-foreground">No submissions yet</p></CardContent></Card>
          ) : (
            <div className="space-y-2">
              {submissions.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/50" onClick={() => setSelectedId(s.id)} data-testid={`submission-all-${s.id}`}>
                  <div>
                    <p className="text-sm font-medium">{s.repName} <span className="text-muted-foreground">({s.repId})</span></p>
                    <p className="text-xs text-muted-foreground">{s.documentsCompleted}/7 docs · Submitted {fmt(s.submittedAt)} {s.reviewedBy && `· Reviewed by ${s.reviewedBy}`}</p>
                  </div>
                  {statusBadge(s.status)}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedId && !showReject} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submission Detail</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Rep Name</Label>
                  <p className="text-sm font-medium">{detail.repName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Rep ID</Label>
                  <p className="text-sm font-medium">{detail.repId}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="text-sm">{detail.repEmail || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  <p className="text-sm">{detail.repPhone || "—"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Submitted</Label>
                  <p className="text-sm">{fmt(detail.submittedAt)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  {statusBadge(detail.status)}
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Documents Completed</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {[
                    { key: "backgroundCheckCompleted", label: "Background Check" },
                    { key: "chargebackPolicyCompleted", label: "Chargeback Policy" },
                    { key: "contractorAppCompleted", label: "Contractor Application" },
                    { key: "directDepositCompleted", label: "Direct Deposit" },
                    { key: "drugTestCompleted", label: "Drug Test Consent" },
                    { key: "ndaCompleted", label: "NDA" },
                    { key: "w9Completed", label: "IRS Form W-9" },
                  ].map(doc => (
                    <div key={doc.key} className="flex items-center gap-1.5 text-xs">
                      {detail[doc.key] ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                      {doc.label}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Banking Info</Label>
                <p className="text-sm">Bank: {detail.bankName || "—"} · {detail.accountType || "—"} · ****{detail.accountNumberLast4 || "—"}</p>
                <p className="text-sm">SSN: ***-**-{detail.ssnLast4 || "—"}</p>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Compliance</Label>
                <div className="flex gap-3 mt-1">
                  <div className="text-xs">Background: {complianceBadge(detail.backgroundCheckStatus)}</div>
                  <div className="text-xs">Drug Test: {complianceBadge(detail.drugTestStatus)}</div>
                </div>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => { setComplianceUserId(detail.userId); setSelectedId(null); }} data-testid="button-update-compliance">
                  <Shield className="h-3.5 w-3.5 mr-1" /> Update Compliance
                </Button>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">E-Sign Details</Label>
                <p className="text-xs text-muted-foreground">IP: {detail.ipAddress} · Hash: {detail.payloadHash?.substring(0, 16)}...</p>
              </div>

              {detail.auditLog && detail.auditLog.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Audit Trail</Label>
                  <div className="max-h-40 overflow-y-auto mt-1 space-y-1">
                    {detail.auditLog.slice(0, 10).map((entry: any) => (
                      <div key={entry.id} className="text-xs flex items-center gap-2">
                        <span className="text-muted-foreground w-24 shrink-0">{fmt(entry.createdAt)}</span>
                        <Badge variant="outline" className="text-[10px]">{entry.action}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.status === "PENDING" && (
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => { setShowReject(true); }} data-testid="button-reject">
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                  </Button>
                  <Button onClick={() => { if (confirm("Approve this contractor? They will gain app access immediately.")) approve.mutate(detail.id); }} disabled={approve.isPending} data-testid="button-approve">
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                </DialogFooter>
              )}
            </div>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showReject} onOpenChange={setShowReject}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Onboarding</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason for rejection</Label>
              <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Provide details..." data-testid="input-reject-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReject(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (selectedId) reject.mutate(selectedId); }} disabled={!rejectReason || reject.isPending} data-testid="button-confirm-reject">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!complianceUserId} onOpenChange={(open) => { if (!open) setComplianceUserId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Compliance Status</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Background Check</Label>
              <Select value={complianceForm.backgroundCheckStatus} onValueChange={v => setComplianceForm({ ...complianceForm, backgroundCheckStatus: v })}>
                <SelectTrigger data-testid="select-bg-check"><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="SUBMITTED">Submitted</SelectItem>
                  <SelectItem value="CLEARED">Cleared</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Drug Test</Label>
              <Select value={complianceForm.drugTestStatus} onValueChange={v => setComplianceForm({ ...complianceForm, drugTestStatus: v })}>
                <SelectTrigger data-testid="select-drug-test"><SelectValue placeholder="No change" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="SUBMITTED">Submitted</SelectItem>
                  <SelectItem value="CLEARED">Cleared</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={complianceForm.notes} onChange={e => setComplianceForm({ ...complianceForm, notes: e.target.value })} data-testid="input-compliance-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComplianceUserId(null)}>Cancel</Button>
            <Button onClick={() => { if (complianceUserId) updateCompliance.mutate(complianceUserId); }} disabled={updateCompliance.isPending} data-testid="button-save-compliance">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
