import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, Link2, Play, CheckCircle2, XCircle, Clock, FileSpreadsheet, Mail, AlertTriangle, ChevronDown, ChevronUp, BarChart3, ArrowRightLeft, Search, Zap, Plus, LinkIcon, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface CarrierInsights {
  autoFilled: Array<{
    orderId: string;
    orderInvoice: string;
    customerName: string;
    fields: string[];
  }>;
  mismatches: Array<{
    orderId: string;
    orderInvoice: string;
    customerName: string;
    crmService: string;
    carrierSpeed: string;
    carrierSpeedLabel: string;
  }>;
  missingOrders: Array<{
    customerName: string;
    address: string;
    city: string;
    repName: string;
    acctNbr: string;
    woStatus: string;
    woType: string;
    internetSpeed: string;
    rawData?: Record<string, string>;
  }>;
  carrierStats: {
    totalRows: number;
    completedCount: number;
    canceledCount: number;
    openCount: number;
    noDispatchCount: number;
    completionRate: number;
    cancelRate: number;
    byRep: Record<string, { total: number; completed: number; canceled: number; open: number }>;
    bySpeedTier: Record<string, number>;
    ironCrestRows: number;
    otherOfficeRows: number;
  };
}

interface ScoreBreakdown {
  nameScore: number;
  addressScore: number;
  cityScore: number;
  zipScore: number;
  repScore: number;
  acctScore: number;
  confidenceTier: "definitive" | "high" | "medium" | "low";
}

interface SyncResult {
  syncRunId: string;
  carrierProfileId?: string;
  totalSheetRows: number;
  matchedCount: number;
  approvedCount: number;
  unmatchedCount: number;
  dedupSkippedCount: number;
  emailSent: boolean;
  summary: string;
  matches: Array<{
    sheetRowIndex: number;
    sheetData: Record<string, string>;
    orderId: string;
    orderInvoice: string;
    orderCustomerName: string;
    confidence: number;
    reasoning: string;
    scoreBreakdown?: ScoreBreakdown;
    serviceLineType?: string;
    workOrderNumber?: string;
    isUpgrade?: boolean;
  }>;
  unmatched: Array<{
    rowIndex: number;
    data: Record<string, string>;
    reason: string;
  }>;
  dedupSkipped: Array<{
    rowIndex: number;
    data: Record<string, string>;
    workOrderNumber: string;
    previousSyncRunId: string;
    matchedOrderId: string;
  }>;
  carrierInsights?: CarrierInsights;
}

interface SyncRun {
  id: string;
  sheetUrl: string | null;
  sourceType: string;
  emailTo: string | null;
  totalSheetRows: number;
  matchedCount: number;
  approvedCount: number;
  unmatchedCount: number;
  emailSent: boolean;
  status: string;
  summary: string | null;
  errorMessage: string | null;
  runByName: string;
  createdAt: string;
  completedAt: string | null;
}

export default function InstallSync() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem("installSync_sheetUrl") || "");
  const [emailTo, setEmailTo] = useState(() => localStorage.getItem("installSync_emailTo") || "ironcrestoperations@ironcrestai.com");
  const [autoApprove, setAutoApprove] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourceMode, setSourceMode] = useState<"sheet" | "upload">("sheet");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [expandedDetails, setExpandedDetails] = useState(false);
  const [expandedInsights, setExpandedInsights] = useState(true);

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkRow, setLinkRow] = useState<SyncResult["unmatched"][0] | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createRow, setCreateRow] = useState<CarrierInsights["missingOrders"][0] | null>(null);
  const [createFormData, setCreateFormData] = useState<{
    customerName: string; address: string; city: string; repName: string;
    acctNbr: string; woStatus: string; internetSpeed: string;
  }>({ customerName: "", address: "", city: "", repName: "", acctNbr: "", woStatus: "", internetSpeed: "" });

  const [bulkMode, setBulkMode] = useState(false);
  const [selectedUnmatched, setSelectedUnmatched] = useState<Set<number>>(new Set());
  const [bulkLinkDialogOpen, setBulkLinkDialogOpen] = useState(false);
  const [bulkLinkSearch, setBulkLinkSearch] = useState("");
  const [bulkSearchResults, setBulkSearchResults] = useState<any[]>([]);
  const [bulkSearchLoading, setBulkSearchLoading] = useState(false);

  const historyQuery = useQuery<SyncRun[]>({
    queryKey: ["/api/admin/install-sync/history"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (sourceMode === "upload" && selectedFile) {
        formData.append("file", selectedFile);
      } else if (sourceMode === "sheet" && sheetUrl) {
        formData.append("sheetUrl", sheetUrl);
      }
      if (emailTo) formData.append("emailTo", emailTo);
      formData.append("autoApprove", String(autoApprove));

      const response = await fetch("/api/admin/install-sync/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem("token")}`,
        },
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Sync failed");
      }
      return response.json() as Promise<SyncResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (sheetUrl) localStorage.setItem("installSync_sheetUrl", sheetUrl);
      if (emailTo) localStorage.setItem("installSync_emailTo", emailTo);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/install-sync/history"] });
      const ci = data.carrierInsights;
      const parts: string[] = [];
      parts.push(`${data.matchedCount}/${data.totalSheetRows} matched`);
      if (data.approvedCount > 0) parts.push(`${data.approvedCount} approved`);
      if (ci?.autoFilled?.length) parts.push(`${ci.autoFilled.length} orders updated`);
      if (ci?.mismatches?.length) parts.push(`${ci.mismatches.length} speed mismatches`);
      if (ci?.missingOrders?.length) parts.push(`${ci.missingOrders.length} missing from CRM`);
      toast({
        title: "Sync Complete",
        description: parts.join(" · "),
      });
    },
    onError: (error: Error) => {
      toast({ title: "Sync Failed", description: error.message, variant: "destructive" });
    },
  });

  const searchOrders = useCallback(async (query: string, setResults: (r: any[]) => void, setLoading: (b: boolean) => void) => {
    if (query.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/install-sync/search-orders?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      });
      if (res.ok) setResults(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const manualLinkMutation = useMutation({
    mutationFn: async ({ orderId, carrierRowData }: { orderId: string; carrierRowData: Record<string, string> }) => {
      const res = await apiRequest("POST", "/api/admin/install-sync/manual-link", {
        syncRunId: result?.syncRunId,
        orderId,
        carrierRowData,
        carrierProfileId: result?.carrierProfileId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Linked", description: `Order linked. ${data.autoFilledFields?.length ? `Updated: ${data.autoFilledFields.join(", ")}` : ""}` });
      if (result && linkRow) {
        setResult({
          ...result,
          matchedCount: result.matchedCount + 1,
          unmatchedCount: Math.max(0, result.unmatchedCount - 1),
          unmatched: result.unmatched.filter(u => u.rowIndex !== linkRow.rowIndex),
        });
      }
      setLinkDialogOpen(false);
      setLinkRow(null);
      setLinkSearch("");
      setSearchResults([]);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/install-sync/history"] });
    },
    onError: (e: Error) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const bulkLinkMutation = useMutation({
    mutationFn: async ({ orderId, rows }: { orderId: string; rows: SyncResult["unmatched"] }) => {
      const results = [];
      for (const row of rows) {
        const res = await apiRequest("POST", "/api/admin/install-sync/manual-link", {
          syncRunId: result?.syncRunId,
          orderId,
          carrierRowData: row.data,
          carrierProfileId: result?.carrierProfileId,
        });
        results.push(await res.json());
      }
      return results;
    },
    onSuccess: (data) => {
      toast({ title: "Bulk Link Complete", description: `${data.length} row(s) linked` });
      if (result) {
        const linkedIndexes = new Set(Array.from(selectedUnmatched));
        setResult({
          ...result,
          matchedCount: result.matchedCount + data.length,
          unmatchedCount: Math.max(0, result.unmatchedCount - data.length),
          unmatched: result.unmatched.filter((_, i) => !linkedIndexes.has(i)),
        });
      }
      setBulkLinkDialogOpen(false);
      setSelectedUnmatched(new Set());
      setBulkMode(false);
      setBulkLinkSearch("");
      setBulkSearchResults([]);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/install-sync/history"] });
    },
    onError: (e: Error) => toast({ title: "Bulk link failed", description: e.message, variant: "destructive" }),
  });

  const createOrderMutation = useMutation({
    mutationFn: async (carrierRowData: Record<string, string>) => {
      const res = await apiRequest("POST", "/api/admin/install-sync/create-order", {
        syncRunId: result?.syncRunId,
        carrierRowData,
        carrierProfileId: result?.carrierProfileId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Order Created", description: `Invoice: ${data.order?.invoiceNumber || "N/A"}` });
      if (result && createRow) {
        const ci2 = result.carrierInsights;
        if (ci2) {
          setResult({
            ...result,
            matchedCount: result.matchedCount + 1,
            carrierInsights: {
              ...ci2,
              missingOrders: ci2.missingOrders.filter(mo => mo !== createRow),
            },
          });
        }
      }
      setCreateDialogOpen(false);
      setCreateRow(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/install-sync/history"] });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const canRun = (sourceMode === "sheet" && sheetUrl.trim()) || (sourceMode === "upload" && selectedFile);

  const ci = result?.carrierInsights;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Install Sync</h1>
        <p className="text-muted-foreground mt-1">
          Match installation confirmations against pending orders using AI, then auto-approve matches.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Data Source
          </CardTitle>
          <CardDescription>
            Provide installation data from a public Google Sheet or upload a CSV file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={sourceMode === "sheet" ? "default" : "outline"}
              size="sm"
              onClick={() => setSourceMode("sheet")}
              data-testid="button-source-sheet"
            >
              <Link2 className="h-4 w-4 mr-1" />
              Google Sheet URL
            </Button>
            <Button
              variant={sourceMode === "upload" ? "default" : "outline"}
              size="sm"
              onClick={() => setSourceMode("upload")}
              data-testid="button-source-upload"
            >
              <Upload className="h-4 w-4 mr-1" />
              Upload CSV
            </Button>
          </div>

          {sourceMode === "sheet" ? (
            <div className="space-y-2">
              <Label htmlFor="sheetUrl">Google Sheet URL</Label>
              <Input
                id="sheetUrl"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                data-testid="input-sheet-url"
              />
              <p className="text-xs text-muted-foreground">
                The sheet must be shared as "Anyone with the link can view"
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="csvFile">CSV File</Label>
              <div className="flex items-center gap-2">
                <Input
                  ref={fileInputRef}
                  id="csvFile"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  data-testid="input-csv-file"
                />
              </div>
              {selectedFile && (
                <p className="text-xs text-muted-foreground">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="emailTo">Email CSV Export To (optional)</Label>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="emailTo"
                  type="email"
                  placeholder="manager@company.com"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  data-testid="input-email-to"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Auto-Approve Matches</Label>
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={autoApprove}
                  onCheckedChange={setAutoApprove}
                  data-testid="switch-auto-approve"
                />
                <span className="text-sm text-muted-foreground">
                  {autoApprove
                    ? "Orders with 70%+ confidence will be approved automatically"
                    : "Preview matches only (no approvals)"}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={!canRun || syncMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-run-sync"
            >
              {syncMutation.isPending ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Running Sync...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run Install Sync
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Sync Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold" data-testid="text-total-rows">{result.totalSheetRows}</div>
                <div className="text-xs text-muted-foreground">Sheet Rows</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-blue-600" data-testid="text-matched-count">{result.matchedCount}</div>
                <div className="text-xs text-muted-foreground">Matched</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-green-600" data-testid="text-approved-count">{result.approvedCount}</div>
                <div className="text-xs text-muted-foreground">Approved</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-amber-600" data-testid="text-unmatched-count">{result.unmatchedCount}</div>
                <div className="text-xs text-muted-foreground">Unmatched</div>
              </div>
              {(result.dedupSkippedCount > 0) && (
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-gray-500" data-testid="text-dedup-count">{result.dedupSkippedCount}</div>
                  <div className="text-xs text-muted-foreground">Dedup Skipped</div>
                </div>
              )}
            </div>

            <div className="space-y-2" data-testid="text-summary">
              <p className="text-sm">{result.summary}</p>

              {(() => {
                const ci2 = result.carrierInsights;
                const lines: { icon: typeof CheckCircle2; color: string; text: string }[] = [];
                if (result.approvedCount > 0)
                  lines.push({ icon: CheckCircle2, color: "text-green-600", text: `${result.approvedCount} order${result.approvedCount !== 1 ? "s" : ""} auto-approved (completed installs with 70%+ confidence)` });
                if (ci2?.autoFilled?.length) {
                  const fieldCounts: Record<string, number> = {};
                  ci2.autoFilled.forEach(af => af.fields.forEach(f => { fieldCounts[f] = (fieldCounts[f] || 0) + 1; }));
                  const fieldSummary = Object.entries(fieldCounts).map(([f, c]) => `${c} ${f}`).join(", ");
                  lines.push({ icon: Zap, color: "text-blue-600", text: `${ci2.autoFilled.length} order${ci2.autoFilled.length !== 1 ? "s" : ""} updated from carrier data (${fieldSummary})` });
                }
                if (ci2?.mismatches?.length)
                  lines.push({ icon: ArrowRightLeft, color: "text-amber-600", text: `${ci2.mismatches.length} speed tier mismatch${ci2.mismatches.length !== 1 ? "es" : ""} detected — sold service differs from carrier install` });
                if (ci2?.missingOrders?.length)
                  lines.push({ icon: Search, color: "text-red-600", text: `${ci2.missingOrders.length} carrier record${ci2.missingOrders.length !== 1 ? "s" : ""} for Iron Crest reps not found in CRM — may need to be entered` });
                const cancelCount = ci2?.carrierStats?.canceledCount || 0;
                if (cancelCount > 0)
                  lines.push({ icon: XCircle, color: "text-red-500", text: `${cancelCount} carrier cancellation${cancelCount !== 1 ? "s" : ""} in this batch (${ci2?.carrierStats?.cancelRate || 0}% cancel rate)` });
                if (result.unmatchedCount > 0 && !ci2?.missingOrders?.length)
                  lines.push({ icon: AlertTriangle, color: "text-amber-500", text: `${result.unmatchedCount} sheet row${result.unmatchedCount !== 1 ? "s" : ""} could not be matched to any CRM order` });

                if (lines.length === 0) return null;
                return (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                    {lines.map((line, idx) => {
                      const Icon = line.icon;
                      return (
                        <div key={idx} className={`flex items-start gap-2 text-sm ${line.color}`}>
                          <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>{line.text}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {result.emailSent && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Mail className="h-4 w-4" />
                CSV export emailed to {emailTo}
              </div>
            )}

            {(result.matches.length > 0 || result.unmatched.length > 0 || (result.dedupSkipped && result.dedupSkipped.length > 0)) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpandedDetails(!expandedDetails)}
                data-testid="button-toggle-details"
              >
                {expandedDetails ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                {expandedDetails ? "Hide Details" : "Show Details"}
              </Button>
            )}

            {expandedDetails && result.matches.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Matched Records</h4>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Matched Order</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Score Breakdown</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Reasoning</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.matches.map((match, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{match.sheetRowIndex}</TableCell>
                          <TableCell>
                            <div className="text-xs">
                              <div className="font-medium">{match.orderCustomerName}</div>
                              <div className="text-muted-foreground font-mono">{match.orderInvoice || match.orderId.slice(0, 8)}</div>
                              {match.workOrderNumber && <div className="text-muted-foreground">WO#{match.workOrderNumber}</div>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <Badge variant={match.confidence >= 80 ? "default" : match.confidence >= 70 ? "secondary" : "outline"}>
                                {match.confidence}%
                              </Badge>
                              {match.scoreBreakdown && (
                                <Badge variant="outline" className="text-[10px]">
                                  {match.scoreBreakdown.confidenceTier}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-[10px] font-mono whitespace-nowrap">
                            {match.scoreBreakdown ? (
                              <div className="space-y-0.5">
                                <div>Name: {match.scoreBreakdown.nameScore}%</div>
                                <div>Addr: {match.scoreBreakdown.addressScore}%</div>
                                <div>City: {match.scoreBreakdown.cityScore}%</div>
                                <div>ZIP: {match.scoreBreakdown.zipScore}%</div>
                                <div>Rep: {match.scoreBreakdown.repScore}%</div>
                                <div>Acct: {match.scoreBreakdown.acctScore}%</div>
                              </div>
                            ) : <span className="text-muted-foreground">N/A</span>}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-col gap-0.5">
                              {match.serviceLineType && <Badge variant="outline" className="text-[10px]">{match.serviceLineType}</Badge>}
                              {match.isUpgrade && <Badge variant="secondary" className="text-[10px]">Upgrade</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs max-w-[200px]">{match.reasoning}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {expandedDetails && result.dedupSkipped && result.dedupSkipped.length > 0 && (
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500" />
                  Previously Synced (Dedup Skipped) ({result.dedupSkipped.length})
                </h4>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Work Order</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.dedupSkipped.slice(0, 20).map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{item.rowIndex}</TableCell>
                          <TableCell className="text-xs font-mono">{item.workOrderNumber}</TableCell>
                          <TableCell className="text-xs max-w-[300px] truncate">
                            {Object.entries(item.data).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {expandedDetails && result.unmatched.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Unmatched Records ({result.unmatched.length})
                  </h4>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={bulkMode ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setBulkMode(!bulkMode); setSelectedUnmatched(new Set()); }}
                      data-testid="button-bulk-mode"
                    >
                      <LinkIcon className="h-3 w-3 mr-1" />
                      {bulkMode ? "Cancel Bulk" : "Bulk Link"}
                    </Button>
                    {bulkMode && selectedUnmatched.size > 0 && (
                      <Button
                        size="sm"
                        onClick={() => { setBulkLinkDialogOpen(true); setBulkLinkSearch(""); setBulkSearchResults([]); }}
                        data-testid="button-bulk-link-selected"
                      >
                        Link {selectedUnmatched.size} Selected
                      </Button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {bulkMode && <TableHead className="w-8"></TableHead>}
                        <TableHead>Row</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="w-24"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.unmatched.slice(0, 30).map((item, i) => (
                        <TableRow key={i}>
                          {bulkMode && (
                            <TableCell>
                              <Checkbox
                                checked={selectedUnmatched.has(i)}
                                onCheckedChange={(checked) => {
                                  const next = new Set(selectedUnmatched);
                                  if (checked) next.add(i); else next.delete(i);
                                  setSelectedUnmatched(next);
                                }}
                                data-testid={`checkbox-unmatched-${i}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">{item.rowIndex}</TableCell>
                          <TableCell className="text-xs max-w-[250px] truncate">
                            {Object.entries(item.data).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ")}
                          </TableCell>
                          <TableCell className="text-xs">{item.reason}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7"
                              onClick={() => { setLinkRow(item); setLinkDialogOpen(true); setLinkSearch(""); setSearchResults([]); }}
                              data-testid={`button-link-order-${i}`}
                            >
                              <LinkIcon className="h-3 w-3 mr-1" />
                              Link
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {ci && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 cursor-pointer" onClick={() => setExpandedInsights(!expandedInsights)}>
              <BarChart3 className="h-5 w-5 text-blue-600" />
              Carrier Insights
              {expandedInsights ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
            </CardTitle>
            <CardDescription>
              Enriched data extracted from carrier sheet: stats, mismatches, missing orders, and auto-filled fields.
            </CardDescription>
          </CardHeader>
          {expandedInsights && (
            <CardContent className="space-y-6">
              <div>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Carrier Statistics
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="text-center p-3 rounded-lg border bg-green-50 dark:bg-green-950/30" data-testid="stat-completed">
                    <div className="text-xl font-bold text-green-700 dark:text-green-400">{ci.carrierStats.completedCount}</div>
                    <div className="text-xs text-green-600 dark:text-green-500">Completed</div>
                    <div className="text-xs text-muted-foreground">{ci.carrierStats.completionRate}%</div>
                  </div>
                  <div className="text-center p-3 rounded-lg border bg-red-50 dark:bg-red-950/30" data-testid="stat-canceled">
                    <div className="text-xl font-bold text-red-700 dark:text-red-400">{ci.carrierStats.canceledCount}</div>
                    <div className="text-xs text-red-600 dark:text-red-500">Canceled</div>
                    <div className="text-xs text-muted-foreground">{ci.carrierStats.cancelRate}%</div>
                  </div>
                  <div className="text-center p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/30" data-testid="stat-open">
                    <div className="text-xl font-bold text-blue-700 dark:text-blue-400">{ci.carrierStats.openCount}</div>
                    <div className="text-xs text-blue-600 dark:text-blue-500">Open</div>
                  </div>
                  <div className="text-center p-3 rounded-lg border bg-amber-50 dark:bg-amber-950/30" data-testid="stat-no-dispatch">
                    <div className="text-xl font-bold text-amber-700 dark:text-amber-400">{ci.carrierStats.noDispatchCount}</div>
                    <div className="text-xs text-amber-600 dark:text-amber-500">No Dispatch</div>
                  </div>
                  <div className="text-center p-3 rounded-lg border bg-purple-50 dark:bg-purple-950/30" data-testid="stat-iron-crest">
                    <div className="text-xl font-bold text-purple-700 dark:text-purple-400">{ci.carrierStats.ironCrestRows}</div>
                    <div className="text-xs text-purple-600 dark:text-purple-500">Iron Crest</div>
                    {ci.carrierStats.otherOfficeRows > 0 && (
                      <div className="text-xs text-muted-foreground">{ci.carrierStats.otherOfficeRows} other</div>
                    )}
                  </div>
                </div>

                {Object.keys(ci.carrierStats.bySpeedTier).length > 0 && (
                  <div className="mt-4">
                    <h5 className="text-sm font-medium mb-2">By Speed Tier</h5>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(ci.carrierStats.bySpeedTier)
                        .sort(([, a], [, b]) => b - a)
                        .map(([tier, count]) => (
                          <Badge key={tier} variant="outline" className="text-xs" data-testid={`badge-tier-${tier}`}>
                            {tier}: {count}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}

                {Object.keys(ci.carrierStats.byRep).length > 0 && (
                  <div className="mt-4">
                    <h5 className="text-sm font-medium mb-2">By Rep (Carrier Data)</h5>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Rep Name</TableHead>
                            <TableHead className="text-center">Total</TableHead>
                            <TableHead className="text-center">Completed</TableHead>
                            <TableHead className="text-center">Canceled</TableHead>
                            <TableHead className="text-center">Open</TableHead>
                            <TableHead className="text-center">Completion %</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(ci.carrierStats.byRep)
                            .sort(([, a], [, b]) => b.total - a.total)
                            .map(([name, data]) => (
                              <TableRow key={name}>
                                <TableCell className="text-sm font-medium">{name}</TableCell>
                                <TableCell className="text-center text-sm">{data.total}</TableCell>
                                <TableCell className="text-center text-sm text-green-600">{data.completed}</TableCell>
                                <TableCell className="text-center text-sm text-red-600">{data.canceled}</TableCell>
                                <TableCell className="text-center text-sm text-blue-600">{data.open}</TableCell>
                                <TableCell className="text-center text-sm">
                                  {data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0}%
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>

              {ci.autoFilled.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-green-600" />
                    Auto-Filled Fields ({ci.autoFilled.length} orders)
                  </h4>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Fields Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ci.autoFilled.map((af, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{af.orderInvoice || af.orderId.slice(0, 8)}</TableCell>
                            <TableCell className="text-sm">{af.customerName}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {af.fields.map((f) => (
                                  <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {ci.mismatches.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                    Speed Tier Mismatches ({ci.mismatches.length})
                  </h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    The service sold in the CRM doesn't match what the carrier shows as installed.
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>CRM Service</TableHead>
                          <TableHead>Carrier Installed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ci.mismatches.map((mm, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{mm.orderInvoice || mm.orderId.slice(0, 8)}</TableCell>
                            <TableCell className="text-sm">{mm.customerName}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{mm.crmService}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="destructive" className="text-xs">{mm.carrierSpeedLabel}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {ci.missingOrders.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Search className="h-4 w-4 text-red-600" />
                    Potential Missing CRM Orders ({ci.missingOrders.length})
                  </h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    Iron Crest rep entries in the carrier sheet that could not be matched to any CRM order.
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Rep</TableHead>
                          <TableHead>Acct #</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Speed</TableHead>
                          <TableHead className="w-24"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ci.missingOrders.map((mo, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm font-medium">{mo.customerName || "-"}</TableCell>
                            <TableCell className="text-xs max-w-[180px] truncate">
                              {mo.address ? `${mo.address}${mo.city ? `, ${mo.city}` : ""}` : "-"}
                            </TableCell>
                            <TableCell className="text-sm">{mo.repName}</TableCell>
                            <TableCell className="font-mono text-xs">{mo.acctNbr || "-"}</TableCell>
                            <TableCell>
                              <Badge
                                variant={mo.woStatus === "CP" ? "default" : mo.woStatus === "CN" ? "destructive" : "secondary"}
                                className="text-xs"
                              >
                                {mo.woStatus || "?"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{mo.woType === "IN" ? "Install" : mo.woType === "UP" ? "Upgrade" : mo.woType || "-"}</TableCell>
                            <TableCell className="text-xs">{mo.internetSpeed ? `${mo.internetSpeed} Mbps` : "-"}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => {
                                  setCreateRow(mo);
                                  setCreateFormData({
                                    customerName: mo.customerName || "",
                                    address: mo.address || "",
                                    city: mo.city || "",
                                    repName: mo.repName || "",
                                    acctNbr: mo.acctNbr || "",
                                    woStatus: mo.woStatus || "",
                                    internetSpeed: mo.internetSpeed || "",
                                  });
                                  setCreateDialogOpen(true);
                                }}
                                data-testid={`button-create-order-${i}`}
                              >
                                <Plus className="h-3 w-3 mr-1" />
                                Create
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {ci.autoFilled.length === 0 && ci.mismatches.length === 0 && ci.missingOrders.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No auto-fills, mismatches, or missing orders detected.
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sync History</CardTitle>
          <CardDescription>Previous install sync runs</CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !historyQuery.data || historyQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No sync runs yet</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Run By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyQuery.data.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(run.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {run.sourceType === "csv_upload" ? "CSV" : "Sheet"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{run.totalSheetRows}</TableCell>
                      <TableCell className="text-sm">{run.matchedCount}</TableCell>
                      <TableCell className="text-sm font-medium text-green-600">{run.approvedCount}</TableCell>
                      <TableCell>
                        <Badge
                          variant={run.status === "COMPLETED" ? "default" : run.status === "FAILED" ? "destructive" : "secondary"}
                        >
                          {run.status === "COMPLETED" ? <CheckCircle2 className="h-3 w-3 mr-1" /> : run.status === "FAILED" ? <XCircle className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{run.runByName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link to Existing Order</DialogTitle>
            <DialogDescription>
              {linkRow && (
                <span className="text-xs">
                  Row {linkRow.rowIndex}: {Object.entries(linkRow.data).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ")}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name, address, account #, or invoice..."
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchOrders(linkSearch, setSearchResults, setSearchLoading); }}
                data-testid="input-link-search"
              />
              <Button
                size="sm"
                onClick={() => searchOrders(linkSearch, setSearchResults, setSearchLoading)}
                disabled={searchLoading || linkSearch.trim().length < 2}
                data-testid="button-link-search"
              >
                {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {searchResults.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto rounded-md border divide-y">
                {searchResults.map((order: any) => (
                  <div
                    key={order.id}
                    className="p-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between"
                    onClick={() => {
                      if (linkRow) {
                        manualLinkMutation.mutate({ orderId: order.id, carrierRowData: linkRow.data });
                      }
                    }}
                    data-testid={`link-result-${order.id}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{order.customerName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {order.invoiceNumber} · {order.customerAddress || [order.houseNumber, order.streetName].filter(Boolean).join(" ")}{order.city ? `, ${order.city}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Rep: {order.repName || "—"} · Acct: {order.accountNumber || "—"} · {order.approvalStatus || order.jobStatus || "—"}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="shrink-0 ml-2" disabled={manualLinkMutation.isPending}>
                      {manualLinkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <LinkIcon className="h-3 w-3" />}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {searchResults.length === 0 && linkSearch.trim().length >= 2 && !searchLoading && (
              <p className="text-xs text-muted-foreground text-center py-4">No orders found. Try a different search term.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkLinkDialogOpen} onOpenChange={setBulkLinkDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Link {selectedUnmatched.size} Row(s)</DialogTitle>
            <DialogDescription>
              All selected rows will be linked to the same order. Search for the target order below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name, address, account #, or invoice..."
                value={bulkLinkSearch}
                onChange={(e) => setBulkLinkSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchOrders(bulkLinkSearch, setBulkSearchResults, setBulkSearchLoading); }}
                data-testid="input-bulk-link-search"
              />
              <Button
                size="sm"
                onClick={() => searchOrders(bulkLinkSearch, setBulkSearchResults, setBulkSearchLoading)}
                disabled={bulkSearchLoading || bulkLinkSearch.trim().length < 2}
                data-testid="button-bulk-link-search"
              >
                {bulkSearchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {bulkSearchResults.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto rounded-md border divide-y">
                {bulkSearchResults.map((order: any) => (
                  <div
                    key={order.id}
                    className="p-2 hover:bg-muted/50 cursor-pointer flex items-center justify-between"
                    onClick={() => {
                      if (result) {
                        const rows = result.unmatched.filter((_, i) => selectedUnmatched.has(i));
                        bulkLinkMutation.mutate({ orderId: order.id, rows });
                      }
                    }}
                    data-testid={`bulk-link-result-${order.id}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{order.customerName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {order.invoiceNumber} · {order.customerAddress || [order.houseNumber, order.streetName].filter(Boolean).join(" ")}{order.city ? `, ${order.city}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Rep: {order.repName || "—"} · Acct: {order.accountNumber || "—"} · {order.approvalStatus || order.jobStatus || "—"}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="shrink-0 ml-2" disabled={bulkLinkMutation.isPending}>
                      {bulkLinkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-xs">Link All</span>}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {bulkSearchResults.length === 0 && bulkLinkSearch.trim().length >= 2 && !bulkSearchLoading && (
              <p className="text-xs text-muted-foreground text-center py-4">No orders found.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Order from Carrier Data</DialogTitle>
            <DialogDescription>
              Review and adjust the pre-filled fields below, then create the order. The system will auto-map rep, service, and provider.
            </DialogDescription>
          </DialogHeader>
          {createRow && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Customer Name</Label>
                  <Input
                    value={createFormData.customerName}
                    onChange={(e) => setCreateFormData(prev => ({ ...prev, customerName: e.target.value }))}
                    data-testid="input-create-customer-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Address</Label>
                    <Input
                      value={createFormData.address}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, address: e.target.value }))}
                      data-testid="input-create-address"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">City</Label>
                    <Input
                      value={createFormData.city}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, city: e.target.value }))}
                      data-testid="input-create-city"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Rep Name</Label>
                    <Input
                      value={createFormData.repName}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, repName: e.target.value }))}
                      data-testid="input-create-rep-name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Account #</Label>
                    <Input
                      value={createFormData.acctNbr}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, acctNbr: e.target.value }))}
                      data-testid="input-create-account"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Speed (Mbps)</Label>
                    <Input
                      value={createFormData.internetSpeed}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, internetSpeed: e.target.value }))}
                      data-testid="input-create-speed"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">WO Status</Label>
                    <Input
                      value={createFormData.woStatus}
                      onChange={(e) => setCreateFormData(prev => ({ ...prev, woStatus: e.target.value }))}
                      data-testid="input-create-status"
                    />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  WO Type: {createRow.woType === "IN" ? "Install" : createRow.woType === "UP" ? "Upgrade" : createRow.woType || "—"}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create">
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (createRow.rawData) {
                      const mergedData = { ...createRow.rawData };
                      if (createFormData.customerName !== createRow.customerName) {
                        const nameKeys = Object.keys(mergedData).filter(k => k.toLowerCase().includes("customer") || k.toLowerCase().includes("name"));
                        if (nameKeys.length > 0) mergedData[nameKeys[0]] = createFormData.customerName;
                      }
                      createOrderMutation.mutate(mergedData);
                    }
                  }}
                  disabled={createOrderMutation.isPending || !createFormData.customerName.trim()}
                  data-testid="button-confirm-create"
                >
                  {createOrderMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Create Order
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
