import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BookMarked, Play, Pencil, Trash2, Plus, Download, Globe, Lock } from "lucide-react";
import type { SavedReport } from "@shared/schema";

const REPORT_TYPES = [
  { value: "orders", label: "Orders" },
  { value: "pay-stubs", label: "Pay Stubs" },
  { value: "ar-reconciliation", label: "AR Reconciliation" },
  { value: "override-earnings", label: "Override Earnings" },
  { value: "commission-variance", label: "Commission Variance" },
  { value: "iron-crest-profit", label: "IronCrest Profit" },
  { value: "rep-summary", label: "Rep Summary" },
];

function reportTypeLabel(type: string) {
  return REPORT_TYPES.find(r => r.value === type)?.label || type;
}

interface ReportParams {
  startDate?: string;
  endDate?: string;
  repId?: string;
  repIds?: string;
  clientId?: string;
  providerId?: string;
  format?: string;
}

interface SaveReportDialogProps {
  open: boolean;
  onClose: () => void;
  existing?: SavedReport;
}

function SaveReportDialog({ open, onClose, existing }: SaveReportDialogProps) {
  const { toast } = useToast();
  const isEdit = !!existing;

  const defaultParams: ReportParams = (existing?.paramsJson as ReportParams) || {};
  const [name, setName] = useState(existing?.name || "");
  const [reportType, setReportType] = useState(existing?.reportType || "");
  const [isShared, setIsShared] = useState(existing?.isShared || false);
  const [startDate, setStartDate] = useState(defaultParams.startDate || "");
  const [endDate, setEndDate] = useState(defaultParams.endDate || "");
  const [repId, setRepId] = useState(defaultParams.repId || "");
  const [clientId, setClientId] = useState(defaultParams.clientId || "");
  const [providerId, setProviderId] = useState(defaultParams.providerId || "");
  const [format, setFormat] = useState(defaultParams.format || "csv");

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/admin/saved-reports", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/saved-reports"] });
      toast({ title: "Report saved", description: `"${name}" has been saved.` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save report", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/admin/saved-reports/${existing?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/saved-reports"] });
      toast({ title: "Report updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update report", description: err.message, variant: "destructive" });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit() {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!reportType) {
      toast({ title: "Report type is required", variant: "destructive" });
      return;
    }
    const paramsJson: ReportParams = {};
    if (startDate) paramsJson.startDate = startDate;
    if (endDate) paramsJson.endDate = endDate;
    if (repId) paramsJson.repId = repId;
    if (clientId) paramsJson.clientId = clientId;
    if (providerId) paramsJson.providerId = providerId;
    paramsJson.format = format;

    const payload = { name: name.trim(), reportType, paramsJson, isShared };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Saved Report" : "Save Report Configuration"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="report-name">Report Name</Label>
            <Input
              id="report-name"
              data-testid="input-report-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Monthly Commission Summary"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-type">Report Type</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger id="report-type" data-testid="select-report-type">
                <SelectValue placeholder="Select report type" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map(rt => (
                  <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                data-testid="input-start-date"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                data-testid="input-end-date"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rep-id">Rep ID (optional)</Label>
            <Input
              id="rep-id"
              data-testid="input-rep-id"
              value={repId}
              onChange={e => setRepId(e.target.value)}
              placeholder="Filter by rep ID"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="format">Export Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger id="format" data-testid="select-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Shared with all admins</Label>
              <p className="text-xs text-muted-foreground">Other admin users can see and run this report</p>
            </div>
            <Switch
              data-testid="switch-is-shared"
              checked={isShared}
              onCheckedChange={setIsShared}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-dialog">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="button-save-report">
            {isPending ? "Saving..." : isEdit ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminSavedReports() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<SavedReport | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<SavedReport | undefined>();
  const [runningId, setRunningId] = useState<string | null>(null);

  const { data: reports, isLoading } = useQuery<SavedReport[]>({
    queryKey: ["/api/admin/saved-reports"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/saved-reports/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/saved-reports"] });
      toast({ title: "Report deleted" });
      setDeleteTarget(undefined);
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  async function handleRun(report: SavedReport) {
    setRunningId(report.id);
    try {
      const res = await fetch(`/api/admin/saved-reports/${report.id}/run`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message || "Export failed");
      }

      const contentType = res.headers.get("content-type") || "";
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const ext = contentType.includes("json") ? "json" : "csv";
      a.download = `${report.name.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().split("T")[0]}.${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
      toast({ title: "Export downloaded", description: `${report.name} exported successfully` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setRunningId(null);
    }
  }

  function openNew() {
    setEditTarget(undefined);
    setShowDialog(true);
  }

  function openEdit(report: SavedReport) {
    setEditTarget(report);
    setShowDialog(true);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookMarked className="h-6 w-6" />
            Saved Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Save and re-run common report configurations. Run any report to export data as CSV or JSON.
          </p>
        </div>
        <Button onClick={openNew} data-testid="button-new-saved-report">
          <Plus className="h-4 w-4 mr-2" />
          New Saved Report
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Quick Export</CardTitle>
          <CardDescription>Run a one-off export without saving a configuration</CardDescription>
        </CardHeader>
        <CardContent>
          <QuickExport />
        </CardContent>
      </Card>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-8 w-24" />
                </div>
              </CardContent>
            </Card>
          ))
        ) : reports && reports.length > 0 ? (
          reports.map(report => (
            <Card key={report.id} data-testid={`card-saved-report-${report.id}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate" data-testid={`text-report-name-${report.id}`}>
                        {report.name}
                      </span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {reportTypeLabel(report.reportType)}
                      </Badge>
                      {report.isShared ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-shared-${report.id}`}>
                          <Globe className="h-3 w-3" /> Shared
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="h-3 w-3" /> Private
                        </span>
                      )}
                    </div>
                    <ReportParamsSummary params={(report.paramsJson as ReportParams) || {}} />
                    <p className="text-xs text-muted-foreground mt-1">
                      Saved {new Date(report.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(report)}
                      data-testid={`button-edit-report-${report.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(report)}
                      data-testid={`button-delete-report-${report.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleRun(report)}
                      disabled={runningId === report.id}
                      data-testid={`button-run-report-${report.id}`}
                    >
                      {runningId === report.id ? (
                        <>Running...</>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 mr-1.5" />
                          Run
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <BookMarked className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground font-medium">No saved reports yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Save a report configuration to quickly re-run it later.
              </p>
              <Button className="mt-4" onClick={openNew} data-testid="button-create-first-report">
                <Plus className="h-4 w-4 mr-2" />
                Create First Report
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {showDialog && (
        <SaveReportDialog
          open={showDialog}
          onClose={() => { setShowDialog(false); setEditTarget(undefined); }}
          existing={editTarget}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Saved Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ReportParamsSummary({ params }: { params: ReportParams }) {
  const parts: string[] = [];
  if (params.startDate && params.endDate) {
    parts.push(`${params.startDate} → ${params.endDate}`);
  } else if (params.startDate) {
    parts.push(`From ${params.startDate}`);
  } else if (params.endDate) {
    parts.push(`Until ${params.endDate}`);
  }
  if (params.repId) parts.push(`Rep: ${params.repId}`);
  if (params.repIds) parts.push(`Reps: ${params.repIds}`);
  if (params.clientId) parts.push(`Client ID filter`);
  if (params.providerId) parts.push(`Provider ID filter`);
  if (params.format && params.format !== "csv") parts.push(`Format: ${params.format.toUpperCase()}`);

  if (parts.length === 0) return <p className="text-xs text-muted-foreground">No filters — exports all data</p>;
  return <p className="text-xs text-muted-foreground mt-0.5">{parts.join(" · ")}</p>;
}

function QuickExport() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState("orders");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [repId, setRepId] = useState("");
  const [format, setFormat] = useState("csv");
  const [isRunning, setIsRunning] = useState(false);

  async function handleExport() {
    setIsRunning(true);
    try {
      const qs = new URLSearchParams();
      if (startDate) qs.set("startDate", startDate);
      if (endDate) qs.set("endDate", endDate);
      if (repId) qs.set("repId", repId);
      qs.set("format", format);

      const url = `/api/admin/export/${reportType}?${qs.toString()}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message || "Export failed");
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const ext = format === "json" ? "json" : "csv";
      a.download = `${reportType}-${(startDate || "all")}-to-${(endDate || "now")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
      toast({ title: "Export downloaded" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label htmlFor="quick-type">Report Type</Label>
          <Select value={reportType} onValueChange={setReportType}>
            <SelectTrigger id="quick-type" data-testid="select-quick-report-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map(rt => (
                <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="quick-start">Start Date</Label>
          <Input
            id="quick-start"
            data-testid="input-quick-start-date"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="quick-end">End Date</Label>
          <Input
            id="quick-end"
            data-testid="input-quick-end-date"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="quick-rep">Rep ID (optional)</Label>
          <Input
            id="quick-rep"
            data-testid="input-quick-rep-id"
            value={repId}
            onChange={e => setRepId(e.target.value)}
            placeholder="All reps"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="space-y-1 w-32">
          <Label htmlFor="quick-format">Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger id="quick-format" data-testid="select-quick-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        <Button onClick={handleExport} disabled={isRunning} data-testid="button-quick-export" className="self-end">
          {isRunning ? (
            "Exporting..."
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Export Now
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
