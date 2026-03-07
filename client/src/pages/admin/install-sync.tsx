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
import { Upload, Link2, Play, CheckCircle2, XCircle, Clock, FileSpreadsheet, Mail, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
      toast({
        title: "Sync Complete",
        description: `Matched ${data.matchedCount} of ${data.totalSheetRows} records. ${data.approvedCount} orders approved.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Sync Failed", description: error.message, variant: "destructive" });
    },
  });

  const canRun = (sourceMode === "sheet" && sheetUrl.trim()) || (sourceMode === "upload" && selectedFile);

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

            <p className="text-sm" data-testid="text-summary">{result.summary}</p>

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
