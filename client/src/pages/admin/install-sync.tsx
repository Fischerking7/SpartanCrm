import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Upload, Link2, Play, CheckCircle2, XCircle, Clock, FileSpreadsheet, Mail, AlertTriangle, ChevronDown, ChevronUp, BarChart3, ArrowRightLeft, Search, Zap } from "lucide-react";
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

interface SyncResult {
  syncRunId: string;
  totalSheetRows: number;
  matchedCount: number;
  approvedCount: number;
  unmatchedCount: number;
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
  }>;
  unmatched: Array<{
    rowIndex: number;
    data: Record<string, string>;
    reason: string;
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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

            {(result.matches.length > 0 || result.unmatched.length > 0) && (
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
                        <TableHead>Sheet Data</TableHead>
                        <TableHead>Matched Order</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead>Reasoning</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.matches.map((match, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{match.sheetRowIndex}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">
                            {Object.entries(match.sheetData).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(", ")}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs">
                              <div className="font-medium">{match.orderCustomerName}</div>
                              <div className="text-muted-foreground font-mono">{match.orderInvoice || match.orderId.slice(0, 8)}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={match.confidence >= 80 ? "default" : match.confidence >= 70 ? "secondary" : "outline"}>
                              {match.confidence}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[200px]">{match.reasoning}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {expandedDetails && result.unmatched.length > 0 && (
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Unmatched Records ({result.unmatched.length})
                </h4>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.unmatched.slice(0, 20).map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{item.rowIndex}</TableCell>
                          <TableCell className="text-xs max-w-[300px] truncate">
                            {Object.entries(item.data).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(", ")}
                          </TableCell>
                          <TableCell className="text-xs">{item.reason}</TableCell>
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
    </div>
  );
}
