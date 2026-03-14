import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  Upload, Link2, Zap, CheckCircle2, AlertTriangle, Clock, FileSpreadsheet
} from "lucide-react";

export default function OpsInstallSync() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [autoApprove, setAutoApprove] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: history, isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/install-sync/history"],
  });

  const runSyncMutation = useMutation({
    mutationFn: async () => {
      setIsRunning(true);
      const formData = new FormData();
      if (selectedFile) {
        formData.append("file", selectedFile);
      }
      if (sheetUrl) {
        formData.append("sheetUrl", sheetUrl);
      }
      formData.append("autoApprove", String(autoApprove));
      if (emailTo) formData.append("emailTo", emailTo);

      const res = await fetch("/api/admin/install-sync/run", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      setIsRunning(false);
      setSyncResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/install-sync/history"] });
      toast({ title: "Sync completed successfully" });
    },
    onError: (err: any) => {
      setIsRunning(false);
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const lastSync = history?.[0];
  const selectedRun = selectedRunId ? history?.find(h => h.id === selectedRunId) : null;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="ops-install-sync">
      <h1 className="text-2xl font-bold">Install Sync</h1>

      {lastSync && (
        <Card data-testid="last-sync-summary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Last Sync Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Run Date</p>
                <p className="font-medium">{new Date(lastSync.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Rows Processed</p>
                <p className="font-medium">{lastSync.totalRows || 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Matched</p>
                <p className="font-medium text-green-600">{lastSync.matchedCount || 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Approved</p>
                <p className="font-medium text-blue-600">{lastSync.approvedCount || 0}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Unmatched</p>
                <p className="font-medium text-orange-600">{lastSync.unmatchedCount || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="run-sync-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Run Install Sync
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Upload CSV</Label>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-foreground/50 transition-colors"
                onClick={() => fileRef.current?.click()}
                data-testid="dropzone-csv"
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {selectedFile ? selectedFile.name : "Click to upload CSV"}
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Or Google Sheet URL</Label>
              <div className="space-y-3">
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="pl-9"
                    value={sheetUrl}
                    onChange={e => setSheetUrl(e.target.value)}
                    data-testid="input-sheet-url"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Sheet must be shared as "Anyone with the link"</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex items-center gap-2">
              <Switch checked={autoApprove} onCheckedChange={setAutoApprove} data-testid="toggle-auto-approve" />
              <Label>Auto-approve high confidence matches</Label>
            </div>

            <div className="flex-1">
              <Input
                placeholder="Email results to..."
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                data-testid="input-email-to"
              />
            </div>
          </div>

          {isRunning && (
            <div className="space-y-2">
              <Progress value={50} className="h-2" />
              <p className="text-sm text-muted-foreground animate-pulse">Running sync... Matching installations to orders using AI</p>
            </div>
          )}

          <Button
            onClick={() => runSyncMutation.mutate()}
            disabled={isRunning || (!selectedFile && !sheetUrl)}
            className="w-full sm:w-auto"
            data-testid="btn-run-sync"
          >
            <Zap className="h-4 w-4 mr-2" />
            {isRunning ? "Running..." : "Run Install Sync"}
          </Button>
        </CardContent>
      </Card>

      {syncResult && (
        <Card data-testid="sync-results">
          <CardHeader>
            <CardTitle>Sync Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="matched">
              <TabsList>
                <TabsTrigger value="matched">Matched ({syncResult.matched?.length || 0})</TabsTrigger>
                <TabsTrigger value="approved">Approved ({syncResult.approved?.length || 0})</TabsTrigger>
                <TabsTrigger value="unmatched">Unmatched ({syncResult.unmatched?.length || 0})</TabsTrigger>
              </TabsList>

              <TabsContent value="matched" className="mt-4">
                <div className="border rounded-lg overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2">Sheet Row</th>
                        <th className="text-left p-2">Order</th>
                        <th className="text-left p-2">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(syncResult.matched || []).map((m: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{m.sheetCustomer || m.sheetRow?.customerName || `Row ${i + 1}`}</td>
                          <td className="p-2">{m.orderInvoice || m.orderId || "—"}</td>
                          <td className="p-2">
                            <Badge variant="outline" className={m.confidence >= 90 ? "text-green-600" : m.confidence >= 70 ? "text-yellow-600" : "text-orange-600"}>
                              {m.confidence}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="approved" className="mt-4">
                <div className="border rounded-lg overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2">Invoice</th>
                        <th className="text-left p-2">Customer</th>
                        <th className="text-right p-2">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(syncResult.approved || []).map((a: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="p-2 font-mono text-xs">{a.invoiceNumber || "—"}</td>
                          <td className="p-2">{a.customerName || "—"}</td>
                          <td className="p-2 text-right">${parseFloat(a.commission || "0").toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="unmatched" className="mt-4">
                <div className="border rounded-lg overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2">Customer</th>
                        <th className="text-left p-2">Address</th>
                        <th className="text-right p-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(syncResult.unmatched || []).map((u: any, i: number) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{u.customerName || u.sheetRow?.customerName || `Row ${i + 1}`}</td>
                          <td className="p-2 text-muted-foreground">{u.address || "—"}</td>
                          <td className="p-2 text-right">
                            <Button size="sm" variant="ghost">Find Order</Button>
                            <Button size="sm" variant="ghost" className="text-muted-foreground">Ignore</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <Card data-testid="sync-history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Sync History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium hidden sm:table-cell">Source</th>
                    <th className="text-right p-3 font-medium">Rows</th>
                    <th className="text-right p-3 font-medium">Matched</th>
                    <th className="text-right p-3 font-medium">Approved</th>
                    <th className="text-left p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(history || []).map((run: any) => (
                    <tr
                      key={run.id}
                      className="border-t hover:bg-muted/50 cursor-pointer"
                      onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                      data-testid={`sync-run-${run.id}`}
                    >
                      <td className="p-3">{new Date(run.createdAt).toLocaleDateString()}</td>
                      <td className="p-3 hidden sm:table-cell">{run.sourceType || "CSV"}</td>
                      <td className="p-3 text-right">{run.totalRows || 0}</td>
                      <td className="p-3 text-right text-green-600">{run.matchedCount || 0}</td>
                      <td className="p-3 text-right text-blue-600">{run.approvedCount || 0}</td>
                      <td className="p-3">
                        <Badge variant="outline" className={run.status === "COMPLETED" ? "text-green-600" : run.status === "FAILED" ? "text-red-600" : ""}>
                          {run.status || "COMPLETED"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
