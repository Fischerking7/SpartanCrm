import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, FileText, DollarSign, BarChart3, ArrowRight, Link2, Loader2, RefreshCw, Eye, Check, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Client } from "@shared/schema";

interface FinanceImport {
  id: string;
  clientId: string;
  periodStart: string | null;
  periodEnd: string | null;
  sourceType: string;
  fileName: string;
  status: string;
  totalRows: number;
  totalAmountCents: number;
  importedAt: string;
  client?: { name: string };
  importedBy?: { name: string };
}

interface FinanceImportRow {
  id: string;
  financeImportId: string;
  customerName: string;
  customerNameNorm: string;
  serviceType: string | null;
  utility: string | null;
  saleDate: string | null;
  clientStatus: string | null;
  expectedAmountCents: number | null;
  matchStatus: string;
  matchedOrderId: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
  isDuplicate: boolean | null;
  ignoreReason: string | null;
}

interface ColumnMapping {
  customerName: string;
  saleDate: string;
  serviceType: string;
  utility: string;
  status: string;
  usage: string;
  rate: string;
  rejectionReason: string;
}

export default function Finance() {
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedImportId, setSelectedImportId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("import");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadPreview, setUploadPreview] = useState<{ columns: string[]; preview: any[]; totalRows: number; importId: string } | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    customerName: "",
    saleDate: "",
    serviceType: "",
    utility: "",
    status: "",
    usage: "",
    rate: "",
    rejectionReason: "",
  });
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [matchFilter, setMatchFilter] = useState<string>("ALL");
  const [reportPeriod, setReportPeriod] = useState<string>("month");

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: imports, isLoading: importsLoading } = useQuery<FinanceImport[]>({
    queryKey: ["/api/finance/imports", selectedClientId],
    queryFn: async () => {
      const url = selectedClientId 
        ? `/api/finance/imports?clientId=${selectedClientId}` 
        : "/api/finance/imports";
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch imports");
      return res.json();
    },
  });

  const { data: selectedImport } = useQuery<FinanceImport>({
    queryKey: ["/api/finance/imports", selectedImportId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/imports/${selectedImportId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch import");
      return res.json();
    },
    enabled: !!selectedImportId,
  });

  const { data: importRows, isLoading: rowsLoading } = useQuery<FinanceImportRow[]>({
    queryKey: ["/api/finance/imports", selectedImportId, "rows", matchFilter],
    queryFn: async () => {
      const url = matchFilter === "ALL" 
        ? `/api/finance/imports/${selectedImportId}/rows`
        : `/api/finance/imports/${selectedImportId}/rows?matchStatus=${matchFilter}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch rows");
      return res.json();
    },
    enabled: !!selectedImportId,
  });

  const { data: importSummary } = useQuery<{
    financeImport: FinanceImport;
    counts: {
      byClientStatus: { enrolled: number; rejected: number; pending: number };
      byMatchStatus: { matched: number; unmatched: number; ambiguous: number; ignored: number };
      totalRows: number;
      totalExpectedCents: number;
    };
  }>({
    queryKey: ["/api/finance/imports", selectedImportId, "summary"],
    queryFn: async () => {
      const res = await fetch(`/api/finance/imports/${selectedImportId}/summary`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
    enabled: !!selectedImportId,
  });

  const { data: arSummary } = useQuery<Array<{ clientId: string; status: string; totalCents: number; count: number }>>({
    queryKey: ["/api/finance/ar/summary"],
    queryFn: async () => {
      const res = await fetch("/api/finance/ar/summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch AR summary");
      return res.json();
    },
  });

  const { data: enrolledReport } = useQuery<any>({
    queryKey: ["/api/finance/reports/enrolled", reportPeriod],
    queryFn: async () => {
      const res = await fetch(`/api/finance/reports/enrolled?period=${reportPeriod}&groupBy=global`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
  });

  const { data: defaultMapping } = useQuery<{ mappingJson: string } | null>({
    queryKey: ["/api/finance/column-mappings/default", selectedClientId],
    queryFn: async () => {
      const res = await fetch(`/api/finance/column-mappings/default?clientId=${selectedClientId}`, { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedClientId && !!uploadPreview,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", selectedClientId);
      const res = await fetch("/api/finance/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setUploadPreview({
        columns: data.columns,
        preview: data.preview,
        totalRows: data.totalRows,
        importId: data.import.id,
      });
      toast({ title: "File uploaded", description: `${data.totalRows} rows found. Please map columns.` });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const mapColumnsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/finance/imports/${uploadPreview?.importId}/map`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ mapping: columnMapping, saveAsDefault }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Mapping failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
      setSelectedImportId(uploadPreview?.importId || "");
      setUploadPreview(null);
      setActiveTab("match");
      toast({ title: "Columns mapped", description: `${data.normalizedCount} rows normalized.` });
    },
    onError: (error: Error) => {
      toast({ title: "Mapping failed", description: error.message, variant: "destructive" });
    },
  });

  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/finance/imports/${selectedImportId}/auto-match`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Auto-match failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports", selectedImportId] });
      toast({ title: "Auto-match complete", description: `Matched: ${data.matchedCount}, Ambiguous: ${data.ambiguousCount}` });
    },
    onError: (error: Error) => {
      toast({ title: "Auto-match failed", description: error.message, variant: "destructive" });
    },
  });

  const ignoreRowMutation = useMutation({
    mutationFn: async ({ rowId, reason }: { rowId: string; reason: string }) => {
      const res = await fetch(`/api/finance/imports/${selectedImportId}/ignore-row`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to ignore row");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports", selectedImportId] });
      toast({ title: "Row ignored" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to ignore row", description: error.message, variant: "destructive" });
    },
  });

  const postImportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/finance/imports/${selectedImportId}/post`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Post failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setActiveTab("ar");
      toast({ title: "Import posted", description: `AR created: ${data.arCreated}, Orders accepted: ${data.ordersAccepted}, Rejected: ${data.ordersRejected}` });
    },
    onError: (error: Error) => {
      toast({ title: "Post failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedClientId) {
      uploadMutation.mutate(file);
    } else if (!selectedClientId) {
      toast({ title: "Select a client", description: "Please select a client before uploading.", variant: "destructive" });
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case "MATCHED":
        return <Badge variant="default" className="bg-green-600">Matched</Badge>;
      case "UNMATCHED":
        return <Badge variant="secondary">Unmatched</Badge>;
      case "AMBIGUOUS":
        return <Badge variant="outline" className="border-amber-500 text-amber-600">Ambiguous</Badge>;
      case "IGNORED":
        return <Badge variant="outline">Ignored</Badge>;
      default:
        return <Badge variant="secondary">{status || "Unknown"}</Badge>;
    }
  };

  const getClientStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case "ENROLLED":
      case "ACCEPTED":
        return <Badge variant="default" className="bg-green-600">Enrolled</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">{status || "Pending"}</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Finance & AR</h1>
        <p className="text-muted-foreground">
          Import client files, match to orders, track accounts receivable
        </p>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label>Client</Label>
          <Select value={selectedClientId || "__ALL__"} onValueChange={(v) => setSelectedClientId(v === "__ALL__" ? "" : v)}>
            <SelectTrigger className="w-[200px]" data-testid="select-client">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All Clients</SelectItem>
              {clients?.map((client) => (
                <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {imports && imports.length > 0 && (
          <div className="space-y-1">
            <Label>Select Import</Label>
            <Select value={selectedImportId || "__NONE__"} onValueChange={(v) => setSelectedImportId(v === "__NONE__" ? "" : v)}>
              <SelectTrigger className="w-[300px]" data-testid="select-import">
                <SelectValue placeholder="Select an import" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__">Select an import...</SelectItem>
                {imports.map((imp) => (
                  <SelectItem key={imp.id} value={imp.id}>
                    {imp.fileName} - {new Date(imp.importedAt).toLocaleDateString()} ({imp.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="import" data-testid="tab-import">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </TabsTrigger>
          <TabsTrigger value="match" data-testid="tab-match" disabled={!selectedImportId}>
            <Link2 className="h-4 w-4 mr-2" />
            Match
          </TabsTrigger>
          <TabsTrigger value="post" data-testid="tab-post" disabled={!selectedImportId}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Post
          </TabsTrigger>
          <TabsTrigger value="ar" data-testid="tab-ar">
            <DollarSign className="h-4 w-4 mr-2" />
            AR
          </TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">
            <BarChart3 className="h-4 w-4 mr-2" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Upload Client Finance File
              </CardTitle>
              <CardDescription>
                Upload CSV or XLSX files from clients containing enrollment/rejection data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedClientId && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <p className="text-amber-800 dark:text-amber-200">Please select a client above before uploading a file.</p>
                </div>
              )}
              
              <div className="flex gap-4 items-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                  data-testid="input-file-upload"
                />
                <Button 
                  onClick={() => fileInputRef.current?.click()} 
                  disabled={!selectedClientId || uploadMutation.isPending}
                  data-testid="button-upload-file"
                >
                  {uploadMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Upload File
                </Button>
              </div>

              {uploadPreview && (
                <div className="space-y-4 mt-4 border rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-medium">Column Mapping</h3>
                    <Badge>{uploadPreview.totalRows} rows</Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <Label>Customer Name *</Label>
                      <Select value={columnMapping.customerName} onValueChange={(v) => setColumnMapping({ ...columnMapping, customerName: v })}>
                        <SelectTrigger data-testid="map-customer-name">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {uploadPreview.columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Sale Date *</Label>
                      <Select value={columnMapping.saleDate} onValueChange={(v) => setColumnMapping({ ...columnMapping, saleDate: v })}>
                        <SelectTrigger data-testid="map-sale-date">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {uploadPreview.columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Service Type</Label>
                      <Select value={columnMapping.serviceType} onValueChange={(v) => setColumnMapping({ ...columnMapping, serviceType: v })}>
                        <SelectTrigger data-testid="map-service-type">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {uploadPreview.columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Status *</Label>
                      <Select value={columnMapping.status} onValueChange={(v) => setColumnMapping({ ...columnMapping, status: v })}>
                        <SelectTrigger data-testid="map-status">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {uploadPreview.columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Rate/Amount</Label>
                      <Select value={columnMapping.rate} onValueChange={(v) => setColumnMapping({ ...columnMapping, rate: v })}>
                        <SelectTrigger data-testid="map-rate">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {uploadPreview.columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Rejection Reason</Label>
                      <Select value={columnMapping.rejectionReason} onValueChange={(v) => setColumnMapping({ ...columnMapping, rejectionReason: v })}>
                        <SelectTrigger data-testid="map-rejection-reason">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {uploadPreview.columns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox 
                      checked={saveAsDefault} 
                      onCheckedChange={(c) => setSaveAsDefault(!!c)}
                      id="save-default"
                      data-testid="checkbox-save-default"
                    />
                    <Label htmlFor="save-default">Save as default mapping for this client</Label>
                  </div>

                  <div className="mt-4">
                    <h4 className="font-medium mb-2">Preview (first 5 rows)</h4>
                    <div className="border rounded overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {uploadPreview.columns.slice(0, 6).map((col) => (
                              <TableHead key={col}>{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {uploadPreview.preview.slice(0, 5).map((row, i) => (
                            <TableRow key={i}>
                              {uploadPreview.columns.slice(0, 6).map((col) => (
                                <TableCell key={col}>{row[col]}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setUploadPreview(null)} data-testid="button-cancel-mapping">
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => mapColumnsMutation.mutate()} 
                      disabled={!columnMapping.customerName || !columnMapping.saleDate || !columnMapping.status || mapColumnsMutation.isPending}
                      data-testid="button-apply-mapping"
                    >
                      {mapColumnsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                      Apply Mapping & Continue
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {!uploadPreview && imports && imports.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Imports</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Imported</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {imports.map((imp) => (
                      <TableRow key={imp.id}>
                        <TableCell className="font-medium">{imp.fileName}</TableCell>
                        <TableCell>{imp.client?.name || "—"}</TableCell>
                        <TableCell>{imp.totalRows}</TableCell>
                        <TableCell>
                          <Badge variant={imp.status === "POSTED" ? "default" : "secondary"}>{imp.status}</Badge>
                        </TableCell>
                        <TableCell>{new Date(imp.importedAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => { setSelectedImportId(imp.id); setActiveTab("match"); }}
                            data-testid={`button-view-import-${imp.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="match" className="space-y-4">
          {selectedImportId && importSummary && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-green-600">{importSummary.counts.byMatchStatus.matched}</div>
                    <div className="text-sm text-muted-foreground">Matched</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">{importSummary.counts.byMatchStatus.unmatched}</div>
                    <div className="text-sm text-muted-foreground">Unmatched</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-amber-600">{importSummary.counts.byMatchStatus.ambiguous}</div>
                    <div className="text-sm text-muted-foreground">Ambiguous</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold text-muted-foreground">{importSummary.counts.byMatchStatus.ignored}</div>
                    <div className="text-sm text-muted-foreground">Ignored</div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle>Match Rows to Orders</CardTitle>
                    <CardDescription>Review and confirm matches between imported rows and existing orders</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Select value={matchFilter} onValueChange={setMatchFilter}>
                      <SelectTrigger className="w-[150px]" data-testid="filter-match-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All</SelectItem>
                        <SelectItem value="MATCHED">Matched</SelectItem>
                        <SelectItem value="UNMATCHED">Unmatched</SelectItem>
                        <SelectItem value="AMBIGUOUS">Ambiguous</SelectItem>
                        <SelectItem value="IGNORED">Ignored</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button 
                      onClick={() => autoMatchMutation.mutate()} 
                      disabled={autoMatchMutation.isPending || selectedImport?.status === "POSTED"}
                      data-testid="button-auto-match"
                    >
                      {autoMatchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                      Run Auto-Match
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {rowsLoading ? (
                    <div className="flex items-center justify-center p-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <ScrollArea className="h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Customer</TableHead>
                            <TableHead>Service</TableHead>
                            <TableHead>Sale Date</TableHead>
                            <TableHead>Client Status</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Match Status</TableHead>
                            <TableHead>Confidence</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importRows?.map((row) => (
                            <TableRow key={row.id} className={row.isDuplicate ? "opacity-50" : ""}>
                              <TableCell>
                                <div>{row.customerName}</div>
                                {row.isDuplicate && <Badge variant="outline" className="text-xs">Duplicate</Badge>}
                              </TableCell>
                              <TableCell>{row.serviceType || "—"}</TableCell>
                              <TableCell>{row.saleDate ? new Date(row.saleDate).toLocaleDateString() : "—"}</TableCell>
                              <TableCell>{getClientStatusBadge(row.clientStatus || "")}</TableCell>
                              <TableCell>{row.expectedAmountCents ? formatCurrency(row.expectedAmountCents) : "—"}</TableCell>
                              <TableCell>{getStatusBadge(row.matchStatus)}</TableCell>
                              <TableCell>{row.matchConfidence ? `${row.matchConfidence}%` : "—"}</TableCell>
                              <TableCell>
                                {row.matchStatus !== "MATCHED" && row.matchStatus !== "IGNORED" && !row.isDuplicate && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => ignoreRowMutation.mutate({ rowId: row.id, reason: "Manually ignored" })}
                                    data-testid={`button-ignore-row-${row.id}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="post" className="space-y-4">
          {selectedImportId && importSummary && (
            <Card>
              <CardHeader>
                <CardTitle>Post Import</CardTitle>
                <CardDescription>
                  Review the summary and post to update orders and create AR expectations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">Total Rows</div>
                    <div className="text-2xl font-bold">{importSummary.counts.totalRows}</div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">Enrolled</div>
                    <div className="text-2xl font-bold text-green-600">{importSummary.counts.byClientStatus.enrolled}</div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">Rejected</div>
                    <div className="text-2xl font-bold text-red-600">{importSummary.counts.byClientStatus.rejected}</div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">Matched Orders</div>
                    <div className="text-2xl font-bold">{importSummary.counts.byMatchStatus.matched}</div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">Expected AR</div>
                    <div className="text-2xl font-bold">{formatCurrency(importSummary.counts.totalExpectedCents)}</div>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div className="text-xl font-bold">
                      <Badge variant={selectedImport?.status === "POSTED" ? "default" : "secondary"}>
                        {selectedImport?.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                {selectedImport?.status !== "POSTED" && selectedImport?.status !== "LOCKED" && (
                  <div className="flex gap-4">
                    <Button
                      onClick={() => postImportMutation.mutate()}
                      disabled={postImportMutation.isPending || importSummary.counts.byMatchStatus.matched === 0}
                      data-testid="button-post-import"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {postImportMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                      Post Import
                    </Button>
                    {importSummary.counts.byMatchStatus.unmatched > 0 && (
                      <p className="text-sm text-muted-foreground self-center">
                        {importSummary.counts.byMatchStatus.unmatched} unmatched rows will be skipped
                      </p>
                    )}
                  </div>
                )}

                {selectedImport?.status === "POSTED" && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="font-medium text-green-800 dark:text-green-200">This import has been posted.</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ar" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Accounts Receivable Summary
              </CardTitle>
              <CardDescription>
                Track expected payments from clients based on enrolled orders
              </CardDescription>
            </CardHeader>
            <CardContent>
              {arSummary && arSummary.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead className="text-right">Total Expected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arSummary.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell>{clients?.find(c => c.id === item.clientId)?.name || item.clientId}</TableCell>
                        <TableCell><Badge variant={item.status === "OPEN" ? "default" : "secondary"}>{item.status}</Badge></TableCell>
                        <TableCell>{item.count}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(item.totalCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No AR expectations yet. Post a finance import to create AR records.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Enrollment Reports
                </CardTitle>
                <CardDescription>Track enrolled and rejected orders by period</CardDescription>
              </div>
              <Select value={reportPeriod} onValueChange={setReportPeriod}>
                <SelectTrigger className="w-[150px]" data-testid="select-report-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {enrolledReport ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 border rounded-lg text-center">
                    <div className="text-3xl font-bold text-green-600">{enrolledReport.enrolledCount || 0}</div>
                    <div className="text-sm text-muted-foreground">Enrolled</div>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <div className="text-3xl font-bold text-red-600">{enrolledReport.rejectedCount || 0}</div>
                    <div className="text-sm text-muted-foreground">Rejected</div>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <div className="text-3xl font-bold">{enrolledReport.pendingCount || 0}</div>
                    <div className="text-sm text-muted-foreground">Pending</div>
                  </div>
                  <div className="p-4 border rounded-lg text-center">
                    <div className="text-3xl font-bold">{formatCurrency(enrolledReport.totalExpectedCents || 0)}</div>
                    <div className="text-sm text-muted-foreground">Expected AR</div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No data available for the selected period.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
