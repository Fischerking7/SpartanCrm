import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Search, ArrowLeft, Link2, Loader2, Check
} from "lucide-react";

const statusColors: Record<string, string> = {
  IMPORTED: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  MAPPED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  MATCHED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  POSTED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  LOCKED: "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-200",
};

export default function OpsFinanceImports() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clientId, setClientId] = useState("");
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [manualMatchRow, setManualMatchRow] = useState<any>(null);
  const [orderSearchTerm, setOrderSearchTerm] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");

  const { data: imports, isLoading: importsLoading } = useQuery<any[]>({
    queryKey: ["/api/finance/imports"],
  });

  const { data: clients } = useQuery<any[]>({
    queryKey: ["/api/admin/clients"],
  });

  const { data: importDetail, isLoading: detailLoading } = useQuery<any>({
    queryKey: ["/api/finance/imports", selectedImportId, "summary"],
    enabled: !!selectedImportId,
  });

  const { data: importRows } = useQuery<any[]>({
    queryKey: ["/api/finance/imports", selectedImportId, "rows"],
    enabled: !!selectedImportId,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile || !clientId) throw new Error("File and client are required");
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("clientId", clientId);

      const res = await fetch("/api/finance/import", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
      setSelectedFile(null);
      toast({ title: "File imported successfully" });
      if (data?.id) setSelectedImportId(data.id);
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const autoMatchMutation = useMutation({
    mutationFn: async (importId: string) => {
      return apiRequest("POST", `/api/finance/imports/${importId}/auto-match`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
      toast({ title: "Auto-match completed" });
    },
    onError: () => toast({ title: "Auto-match failed", variant: "destructive" }),
  });

  const ignoreRowMutation = useMutation({
    mutationFn: async ({ importId, rowId, reason }: { importId: string; rowId: string; reason: string }) => {
      return apiRequest("POST", `/api/finance/imports/${importId}/ignore-row`, { rowId, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
      toast({ title: "Row ignored" });
    },
  });

  const { data: searchOrders } = useQuery<any[]>({
    queryKey: ["/api/orders/search", orderSearchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orderSearchTerm) params.set("search", orderSearchTerm);
      params.set("limit", "20");
      const res = await fetch(`/api/orders?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to search orders");
      return res.json();
    },
    enabled: !!manualMatchRow && orderSearchTerm.length >= 2,
  });

  const manualMatchMutation = useMutation({
    mutationFn: async ({ rowId, orderId }: { rowId: string; orderId: string }) => {
      const res = await fetch(`/api/finance/imports/${selectedImportId}/manual-match`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, orderId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to match");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
      toast({ title: "Row matched successfully" });
      setManualMatchRow(null);
      setOrderSearchTerm("");
      setSelectedOrderId("");
    },
    onError: (error: Error) => {
      toast({ title: "Match failed", description: error.message, variant: "destructive" });
    },
  });

  const matchedRows = (importRows || []).filter((r: any) => r.matchStatus === "MATCHED");
  const unmatchedRows = (importRows || []).filter((r: any) => r.matchStatus === "UNMATCHED");
  const ambiguousRows = (importRows || []).filter((r: any) => r.matchStatus === "AMBIGUOUS");
  const ignoredRows = (importRows || []).filter((r: any) => r.matchStatus === "IGNORED");

  const matchRate = importRows?.length ? Math.round((matchedRows.length / importRows.length) * 100) : 0;
  const gaugeColor = matchRate >= 90 ? "text-green-500" : matchRate >= 70 ? "text-yellow-500" : "text-red-500";

  if (selectedImportId) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="import-detail">
        <Button variant="ghost" onClick={() => setSelectedImportId(null)} data-testid="btn-back">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Imports
        </Button>

        <div className="flex items-center gap-6">
          <div className="relative w-28 h-28">
            <svg className="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
              <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8"
                className={gaugeColor}
                strokeDasharray={`${matchRate * 2.51} 251`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-2xl font-bold ${gaugeColor}`}>{matchRate}%</span>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold">Match Rate</h2>
            <p className="text-sm text-muted-foreground">
              {matchedRows.length} of {importRows?.length || 0} rows matched
            </p>
            {matchRate >= 90 && <p className="text-xs text-green-600 mt-1">Eligible for auto-posting</p>}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={() => autoMatchMutation.mutate(selectedImportId)} disabled={autoMatchMutation.isPending} data-testid="btn-auto-match">
            Run Auto-Match
          </Button>
        </div>

        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All ({importRows?.length || 0})</TabsTrigger>
            <TabsTrigger value="matched">Matched ({matchedRows.length})</TabsTrigger>
            <TabsTrigger value="unmatched">Unmatched ({unmatchedRows.length})</TabsTrigger>
            <TabsTrigger value="ambiguous">Ambiguous ({ambiguousRows.length})</TabsTrigger>
            <TabsTrigger value="ignored">Ignored ({ignoredRows.length})</TabsTrigger>
          </TabsList>

          {["all", "matched", "unmatched", "ambiguous", "ignored"].map(tab => (
            <TabsContent key={tab} value={tab} className="mt-4">
              <div className="border rounded-lg overflow-auto max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Customer</th>
                      <th className="text-left p-2 hidden md:table-cell">Date</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-right p-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === "all" ? importRows : tab === "matched" ? matchedRows : tab === "unmatched" ? unmatchedRows : tab === "ambiguous" ? ambiguousRows : ignoredRows)?.map((row: any) => (
                      <tr key={row.id} className="border-t">
                        <td className="p-2">{row.customerName || row.normalizedCustomerName || "—"}</td>
                        <td className="p-2 hidden md:table-cell">{row.serviceDate || "—"}</td>
                        <td className="p-2 text-right">${parseFloat(row.amount || "0").toFixed(2)}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={`text-xs ${statusColors[row.matchStatus] || ""}`}>
                            {row.matchStatus}
                          </Badge>
                        </td>
                        <td className="p-2 text-right">
                          {(row.matchStatus === "UNMATCHED" || row.matchStatus === "AMBIGUOUS") && (
                            <>
                              <Button size="sm" variant="ghost" className="text-xs"
                                onClick={() => {
                                  setManualMatchRow(row);
                                  setOrderSearchTerm(row.customerName || row.normalizedCustomerName || "");
                                  setSelectedOrderId("");
                                }}
                                data-testid={`btn-find-match-${row.id}`}
                              >
                                <Link2 className="h-3 w-3 mr-1" /> Find Match
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs text-muted-foreground"
                                onClick={() => ignoreRowMutation.mutate({ importId: selectedImportId, rowId: row.id, reason: "Manual ignore" })}
                                data-testid={`btn-ignore-${row.id}`}
                              >
                                Ignore
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <Dialog open={!!manualMatchRow} onOpenChange={(open) => { if (!open) { setManualMatchRow(null); setOrderSearchTerm(""); setSelectedOrderId(""); } }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Manual Match</DialogTitle>
              <DialogDescription>
                Match "{manualMatchRow?.customerName || manualMatchRow?.normalizedCustomerName}" to an existing order
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Import Row Details</div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                  <div><strong>Customer:</strong> {manualMatchRow?.customerName || manualMatchRow?.normalizedCustomerName || "—"}</div>
                  <div><strong>Service:</strong> {manualMatchRow?.serviceType || "—"}</div>
                  <div><strong>Date:</strong> {manualMatchRow?.serviceDate || manualMatchRow?.saleDate ? new Date(manualMatchRow.serviceDate || manualMatchRow.saleDate).toLocaleDateString() : "—"}</div>
                  <div><strong>Amount:</strong> ${parseFloat(manualMatchRow?.amount || "0").toFixed(2)}</div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Search Orders</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={orderSearchTerm}
                    onChange={(e) => setOrderSearchTerm(e.target.value)}
                    placeholder="Search by customer name, invoice #, or account #..."
                    className="pl-10"
                    data-testid="input-order-search"
                  />
                </div>
              </div>

              {orderSearchTerm.length >= 2 && (
                <div className="border rounded-lg max-h-[300px] overflow-auto">
                  {searchOrders && searchOrders.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="w-8 p-2"></th>
                          <th className="text-left p-2">Customer</th>
                          <th className="text-left p-2">Invoice #</th>
                          <th className="text-left p-2">Account #</th>
                          <th className="text-left p-2">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchOrders.map((order: any) => (
                          <tr
                            key={order.id}
                            className={`border-t cursor-pointer hover:bg-muted/50 ${selectedOrderId === order.id ? "bg-[#C9A84C]/10" : ""}`}
                            onClick={() => setSelectedOrderId(order.id)}
                            data-testid={`order-result-${order.id}`}
                          >
                            <td className="p-2 text-center">
                              <input type="radio" checked={selectedOrderId === order.id} readOnly />
                            </td>
                            <td className="p-2 font-medium">{order.customerName}</td>
                            <td className="p-2">{order.invoiceNumber || "—"}</td>
                            <td className="p-2">{order.accountNumber || "—"}</td>
                            <td className="p-2">{order.dateSold ? new Date(order.dateSold).toLocaleDateString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-center text-muted-foreground">
                      No orders found. Try a different search term.
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setManualMatchRow(null); setOrderSearchTerm(""); setSelectedOrderId(""); }}>Cancel</Button>
              <Button
                onClick={() => manualMatchRow && manualMatchMutation.mutate({ rowId: manualMatchRow.id, orderId: selectedOrderId })}
                disabled={!selectedOrderId || manualMatchMutation.isPending}
                className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
                data-testid="btn-confirm-match"
              >
                {manualMatchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Confirm Match
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="ops-finance-imports">
      <h1 className="text-2xl font-bold">Finance Imports</h1>

      <Card data-testid="upload-area">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Import File
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-foreground/50 transition-colors"
            onClick={() => fileRef.current?.click()}
            data-testid="dropzone-finance"
          >
            <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">
              {selectedFile ? selectedFile.name : "Click to upload CSV or XLSX"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Supports CSV and Excel files</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={e => setSelectedFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Client (required)</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger data-testid="select-client">
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent>
                  {(clients || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={!selectedFile || !clientId || uploadMutation.isPending}
            data-testid="btn-upload-import"
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploadMutation.isPending ? "Uploading..." : "Upload and Import"}
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="imports-list">
        <CardHeader>
          <CardTitle>Import History</CardTitle>
        </CardHeader>
        <CardContent>
          {importsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12" />)}</div>
          ) : (imports || []).length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No imports yet</p>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 font-medium">Client</th>
                    <th className="text-left p-3 font-medium hidden sm:table-cell">File</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-right p-3 font-medium hidden md:table-cell">Rows</th>
                    <th className="text-left p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(imports || []).map((imp: any) => (
                    <tr
                      key={imp.id}
                      className="border-t hover:bg-muted/50 cursor-pointer"
                      onClick={() => setSelectedImportId(imp.id)}
                      data-testid={`import-row-${imp.id}`}
                    >
                      <td className="p-3">{imp.clientName || imp.clientId || "—"}</td>
                      <td className="p-3 hidden sm:table-cell truncate max-w-[200px]">{imp.fileName || "—"}</td>
                      <td className="p-3">{new Date(imp.createdAt).toLocaleDateString()}</td>
                      <td className="p-3 text-right hidden md:table-cell">{imp.totalRows || 0}</td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-xs ${statusColors[imp.status] || ""}`}>
                          {imp.status}
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
