import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, Search, CalendarDays, RefreshCw, Lock, RotateCcw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format, differenceInDays, isBefore } from "date-fns";

interface RepCompliance {
  id: string;
  name: string;
  repId: string;
  role: string;
  status: string;
  contractorAgreementSignedAt: string | null;
  contractorAgreementExpiresAt: string | null;
  ndaSignedAt: string | null;
  ndaExpiresAt: string | null;
  backgroundCheckStatus: string;
  backgroundCheckExpiresAt: string | null;
  drugTestStatus: string;
  drugTestExpiresAt: string | null;
  commissionBlockedDueToExpiry: boolean;
  commissionBlockedReason: string | null;
  onboardingStatus: string;
}

function getExpiryStatus(expiresAt: string | null, signedAt: string | null): "expired" | "critical" | "warning" | "notice" | "ok" | "missing" {
  if (!expiresAt) {
    if (!signedAt) return "missing";
    return "ok";
  }
  const now = new Date();
  const exp = new Date(expiresAt);
  if (isBefore(exp, now)) return "expired";
  const days = differenceInDays(exp, now);
  if (days <= 30) return "critical";
  if (days <= 60) return "warning";
  if (days <= 90) return "notice";
  return "ok";
}

function ExpiryBadge({ expiresAt, signedAt }: { expiresAt: string | null; signedAt: string | null }) {
  const status = getExpiryStatus(expiresAt, signedAt);
  if (status === "missing") {
    return <Badge variant="outline" className="text-muted-foreground text-xs gap-1"><Clock className="h-3 w-3" />Not Signed</Badge>;
  }
  if (status === "expired") {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <XCircle className="h-3 w-3" />
        Expired {expiresAt ? format(new Date(expiresAt), "MM/dd/yy") : ""}
      </Badge>
    );
  }
  if (status === "critical") {
    const days = differenceInDays(new Date(expiresAt!), new Date());
    return (
      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs gap-1">
        <AlertTriangle className="h-3 w-3" />
        {days}d (30-day)
      </Badge>
    );
  }
  if (status === "warning") {
    const days = differenceInDays(new Date(expiresAt!), new Date());
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs gap-1">
        <AlertTriangle className="h-3 w-3" />
        {days}d (60-day)
      </Badge>
    );
  }
  if (status === "notice") {
    const days = differenceInDays(new Date(expiresAt!), new Date());
    return (
      <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs gap-1">
        <Clock className="h-3 w-3" />
        {days}d (90-day)
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-green-600 text-xs gap-1">
      <CheckCircle className="h-3 w-3" />
      {expiresAt ? format(new Date(expiresAt), "MM/dd/yy") : "Valid"}
    </Badge>
  );
}

function RequestRecertificationDialog({ rep }: { rep: RepCompliance }) {
  const [open, setOpen] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const { toast } = useToast();

  const docOptions = [
    { value: "CONTRACTOR_AGREEMENT", label: "Contractor Agreement" },
    { value: "NDA", label: "NDA" },
    { value: "BACKGROUND_CHECK", label: "Background Check" },
    { value: "DRUG_TEST", label: "Drug Test" },
  ];

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/compliance/${rep.id}/recertification`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ documentTypes: selectedDocs, requestNote: note || null }),
      });
      if (!res.ok) throw new Error("Failed to create recertification request");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Re-certification request sent", description: `${rep.name} will be notified to re-sign the selected documents.` });
      setOpen(false);
      setSelectedDocs([]);
      setNote("");
    },
    onError: () => toast({ title: "Request failed", variant: "destructive" }),
  });

  const toggleDoc = (val: string) => {
    setSelectedDocs(prev => prev.includes(val) ? prev.filter(d => d !== val) : [...prev, val]);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-amber-600 border-amber-300" data-testid={`button-recertify-${rep.id}`}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Re-Certify
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request Re-Certification — {rep.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Select which documents the rep must re-sign. They will be notified and commission payouts will remain blocked until completed.</p>
          <div className="space-y-2">
            {docOptions.map(doc => (
              <label key={doc.value} className="flex items-center gap-2 cursor-pointer" data-testid={`checkbox-doc-${doc.value}`}>
                <Checkbox
                  checked={selectedDocs.includes(doc.value)}
                  onCheckedChange={() => toggleDoc(doc.value)}
                />
                <span className="text-sm">{doc.label}</span>
              </label>
            ))}
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Input className="mt-1" placeholder="Reason or instructions..." value={note} onChange={e => setNote(e.target.value)} data-testid="input-recert-note" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || selectedDocs.length === 0} data-testid="button-send-recertification">
              {mutation.isPending ? "Sending..." : "Send Request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UpdateExpirationsDialog({ rep }: { rep: RepCompliance }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [form, setForm] = useState({
    contractorAgreementExpiresAt: rep.contractorAgreementExpiresAt ? rep.contractorAgreementExpiresAt.split("T")[0] : "",
    ndaExpiresAt: rep.ndaExpiresAt ? rep.ndaExpiresAt.split("T")[0] : "",
    backgroundCheckExpiresAt: rep.backgroundCheckExpiresAt ? rep.backgroundCheckExpiresAt.split("T")[0] : "",
    drugTestExpiresAt: rep.drugTestExpiresAt ? rep.drugTestExpiresAt.split("T")[0] : "",
    commissionBlockedDueToExpiry: rep.commissionBlockedDueToExpiry,
    commissionBlockedReason: rep.commissionBlockedReason || "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/compliance/${rep.id}/expirations`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          contractorAgreementExpiresAt: form.contractorAgreementExpiresAt || null,
          ndaExpiresAt: form.ndaExpiresAt || null,
          backgroundCheckExpiresAt: form.backgroundCheckExpiresAt || null,
          drugTestExpiresAt: form.drugTestExpiresAt || null,
          commissionBlockedDueToExpiry: form.commissionBlockedDueToExpiry,
          commissionBlockedReason: form.commissionBlockedReason || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/compliance-calendar"] });
      toast({ title: "Document expirations updated" });
      setOpen(false);
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-edit-compliance-${rep.id}`}>
          <CalendarDays className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update Document Expirations — {rep.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Contractor Agreement Expires</Label>
              <Input type="date" value={form.contractorAgreementExpiresAt} onChange={e => setForm({ ...form, contractorAgreementExpiresAt: e.target.value })} className="mt-1" data-testid="input-contractor-expires" />
            </div>
            <div>
              <Label className="text-xs">NDA Expires</Label>
              <Input type="date" value={form.ndaExpiresAt} onChange={e => setForm({ ...form, ndaExpiresAt: e.target.value })} className="mt-1" data-testid="input-nda-expires" />
            </div>
            <div>
              <Label className="text-xs">Background Check Expires</Label>
              <Input type="date" value={form.backgroundCheckExpiresAt} onChange={e => setForm({ ...form, backgroundCheckExpiresAt: e.target.value })} className="mt-1" data-testid="input-bg-expires" />
            </div>
            <div>
              <Label className="text-xs">Drug Test Expires</Label>
              <Input type="date" value={form.drugTestExpiresAt} onChange={e => setForm({ ...form, drugTestExpiresAt: e.target.value })} className="mt-1" data-testid="input-drug-expires" />
            </div>
          </div>

          <div className="border-t pt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.commissionBlockedDueToExpiry}
                onChange={e => setForm({ ...form, commissionBlockedDueToExpiry: e.target.checked })}
                className="h-4 w-4"
                data-testid="checkbox-commission-blocked"
              />
              <span className="text-sm font-medium">Block commission payouts</span>
            </label>
            {form.commissionBlockedDueToExpiry && (
              <Input
                className="mt-2"
                placeholder="Reason for blocking..."
                value={form.commissionBlockedReason}
                onChange={e => setForm({ ...form, commissionBlockedReason: e.target.value })}
                data-testid="input-block-reason"
              />
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-save-compliance">
              {mutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ComplianceCalendar() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const { data: reps, isLoading } = useQuery<RepCompliance[]>({
    queryKey: ["/api/admin/compliance-calendar"],
    queryFn: async () => {
      const res = await fetch("/api/admin/compliance-calendar", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const filtered = (reps || []).filter(rep => {
    const matchSearch = !search || rep.name.toLowerCase().includes(search.toLowerCase()) || rep.repId.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;

    if (filter === "expired") {
      const statuses = [
        getExpiryStatus(rep.contractorAgreementExpiresAt, rep.contractorAgreementSignedAt),
        getExpiryStatus(rep.ndaExpiresAt, rep.ndaSignedAt),
        getExpiryStatus(rep.backgroundCheckExpiresAt, rep.backgroundCheckStatus !== "PENDING" ? "signed" : null),
        getExpiryStatus(rep.drugTestExpiresAt, rep.drugTestStatus !== "PENDING" ? "signed" : null),
      ];
      return statuses.some(s => s === "expired");
    }
    if (filter === "expiring_soon") {
      const statuses = [
        getExpiryStatus(rep.contractorAgreementExpiresAt, rep.contractorAgreementSignedAt),
        getExpiryStatus(rep.ndaExpiresAt, rep.ndaSignedAt),
        getExpiryStatus(rep.backgroundCheckExpiresAt, rep.backgroundCheckStatus !== "PENDING" ? "signed" : null),
        getExpiryStatus(rep.drugTestExpiresAt, rep.drugTestStatus !== "PENDING" ? "signed" : null),
      ];
      return statuses.some(s => s === "critical" || s === "warning" || s === "notice");
    }
    if (filter === "blocked") return rep.commissionBlockedDueToExpiry;
    return true;
  });

  const expiredCount = (reps || []).filter(rep => {
    const statuses = [
      getExpiryStatus(rep.contractorAgreementExpiresAt, rep.contractorAgreementSignedAt),
      getExpiryStatus(rep.ndaExpiresAt, rep.ndaSignedAt),
      getExpiryStatus(rep.backgroundCheckExpiresAt, rep.backgroundCheckStatus !== "PENDING" ? "signed" : null),
      getExpiryStatus(rep.drugTestExpiresAt, rep.drugTestStatus !== "PENDING" ? "signed" : null),
    ];
    return statuses.some(s => s === "expired");
  }).length;

  const expiringCount = (reps || []).filter(rep => {
    const statuses = [
      getExpiryStatus(rep.contractorAgreementExpiresAt, rep.contractorAgreementSignedAt),
      getExpiryStatus(rep.ndaExpiresAt, rep.ndaSignedAt),
      getExpiryStatus(rep.backgroundCheckExpiresAt, rep.backgroundCheckStatus !== "PENDING" ? "signed" : null),
      getExpiryStatus(rep.drugTestExpiresAt, rep.drugTestStatus !== "PENDING" ? "signed" : null),
    ];
    return statuses.some(s => s === "critical" || s === "warning" || s === "notice");
  }).length;

  const blockedCount = (reps || []).filter(r => r.commissionBlockedDueToExpiry).length;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <Shield className="h-6 w-6" />
          Compliance Calendar
        </h1>
        <p className="text-muted-foreground">Track document expirations and manage re-certification requirements for all reps</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="cursor-pointer hover:border-foreground/30 transition-colors" onClick={() => setFilter(filter === "expired" ? "all" : "expired")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              Expired Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{expiredCount}</p>
            <p className="text-xs text-muted-foreground">Reps with 1+ expired document</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-foreground/30 transition-colors" onClick={() => setFilter(filter === "expiring_soon" ? "all" : "expiring_soon")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Expiring Within 60 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{expiringCount}</p>
            <p className="text-xs text-muted-foreground">Reps needing renewal soon</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-foreground/30 transition-colors" onClick={() => setFilter(filter === "blocked" ? "all" : "blocked")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Lock className="h-4 w-4 text-purple-500" />
              Commission Blocked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-purple-600">{blockedCount}</p>
            <p className="text-xs text-muted-foreground">Payouts blocked due to expiry</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Rep Document Status</CardTitle>
              <CardDescription>Contractor agreements, NDAs, background checks, and drug tests</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search by name or Rep ID..."
                  className="pl-8 w-48"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  data-testid="input-search-compliance"
                />
              </div>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-40" data-testid="select-compliance-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Reps</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
                  <SelectItem value="blocked">Commission Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No reps match the current filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rep</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Contractor Agmt</TableHead>
                    <TableHead>NDA</TableHead>
                    <TableHead>Background Check</TableHead>
                    <TableHead>Drug Test</TableHead>
                    <TableHead>Commission</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(rep => (
                    <TableRow key={rep.id} data-testid={`row-compliance-${rep.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{rep.name}</p>
                          <p className="text-xs text-muted-foreground">{rep.repId}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{rep.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <ExpiryBadge expiresAt={rep.contractorAgreementExpiresAt} signedAt={rep.contractorAgreementSignedAt} />
                      </TableCell>
                      <TableCell>
                        <ExpiryBadge expiresAt={rep.ndaExpiresAt} signedAt={rep.ndaSignedAt} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className={`text-xs ${rep.backgroundCheckStatus === "CLEARED" ? "text-green-600" : rep.backgroundCheckStatus === "FAILED" ? "text-red-600" : "text-muted-foreground"}`}>
                            {rep.backgroundCheckStatus}
                          </Badge>
                          {rep.backgroundCheckExpiresAt && (
                            <ExpiryBadge expiresAt={rep.backgroundCheckExpiresAt} signedAt="done" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className={`text-xs ${rep.drugTestStatus === "CLEARED" ? "text-green-600" : rep.drugTestStatus === "FAILED" ? "text-red-600" : "text-muted-foreground"}`}>
                            {rep.drugTestStatus}
                          </Badge>
                          {rep.drugTestExpiresAt && (
                            <ExpiryBadge expiresAt={rep.drugTestExpiresAt} signedAt="done" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {rep.commissionBlockedDueToExpiry ? (
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs gap-1">
                            <Lock className="h-3 w-3" />
                            Blocked
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-600 text-xs">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <UpdateExpirationsDialog rep={rep} />
                          <RequestRecertificationDialog rep={rep} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
