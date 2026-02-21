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
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, FileText, DollarSign, BarChart3, ArrowRight, Link2, Loader2, RefreshCw, Eye, Check, X, Pencil, Search, Download, Trash2, Plus } from "lucide-react";
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
  repName: string | null;
  repNameNorm: string | null;
  serviceType: string | null;
  utility: string | null;
  saleDate: string | null;
  clientStatus: string | null;
  expectedAmountCents: number | null;
  paidAmountCents: number | null;
  matchStatus: string;
  matchedOrderId: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
  isDuplicate: boolean | null;
  ignoreReason: string | null;
}

interface ColumnMapping {
  customerName: string;
  repName: string;
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
    repName: "",
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sheetList, setSheetList] = useState<Array<{ name: string; repName: string | null; repCode: string | null; repNameSource: string | null; rowCount: number; hasData: boolean; columns: string[] }>>([]);
  const [showSheetPicker, setShowSheetPicker] = useState(false);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [batchImportProgress, setBatchImportProgress] = useState<{ current: number; total: number; results: Array<{ sheet: string; success: boolean; error?: string }> } | null>(null);
  const [createOrderRow, setCreateOrderRow] = useState<FinanceImportRow | null>(null);
  const [createOrderProviderId, setCreateOrderProviderId] = useState("");
  const [createOrderServiceId, setCreateOrderServiceId] = useState("");
  const [createOrderRepId, setCreateOrderRepId] = useState("");

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: providers } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/providers"],
  });

  const { data: services } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/services"],
  });

  const { data: allUsers } = useQuery<Array<{ id: string; name: string; repId: string | null; role: string }>>({
    queryKey: ["/api/users"],
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

  const { data: arSummary } = useQuery<Array<{ 
    clientId: string; 
    status: string; 
    totalCents: number; 
    totalActualCents: number;
    totalVarianceCents: number;
    varianceCount: number;
    count: number 
  }>>({
    queryKey: ["/api/finance/ar/summary"],
    queryFn: async () => {
      const res = await fetch("/api/finance/ar/summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch AR summary");
      return res.json();
    },
  });

  const [arFilter, setArFilter] = useState<string>("ALL");
  const [selectedAr, setSelectedAr] = useState<any | null>(null);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [manualMatchRow, setManualMatchRow] = useState<FinanceImportRow | null>(null);
  const [orderSearchTerm, setOrderSearchTerm] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [editingExpected, setEditingExpected] = useState(false);
  const [newExpectedAmount, setNewExpectedAmount] = useState("");
  const [expectedChangeReason, setExpectedChangeReason] = useState("");
  const [reconcileRow, setReconcileRow] = useState<FinanceImportRow | null>(null);
  const [reconcileData, setReconcileData] = useState<any>(null);
  const [reconcileAdjustments, setReconcileAdjustments] = useState({
    serviceId: "",
    providerId: "",
    baseCommissionEarned: "",
    incentiveEarned: "",
    overrideDeduction: "",
  });

  interface ArExpectation {
    id: string;
    clientId: string;
    orderId: string | null;
    expectedAmountCents: number;
    actualAmountCents: number;
    varianceAmountCents: number;
    varianceReason: string | null;
    expectedFromDate: string;
    status: string;
    hasVariance: boolean;
    client?: { name: string };
    order?: { invoiceNumber: string; customerName: string };
    payments?: Array<{
      id: string;
      amountCents: number;
      paymentDate: string;
      paymentReference: string | null;
      paymentMethod: string | null;
      notes: string | null;
      recordedBy?: { name: string };
    }>;
  }

  const { data: arExpectations, refetch: refetchAr } = useQuery<ArExpectation[]>({
    queryKey: ["/api/finance/ar", arFilter],
    queryFn: async () => {
      let url = "/api/finance/ar";
      if (arFilter === "VARIANCE") url += "?hasVariance=true";
      else if (arFilter !== "ALL") url += `?status=${arFilter}`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch AR");
      return res.json();
    },
  });

  // Helper to fetch and refresh a single AR
  const fetchSingleAr = async (id: string): Promise<ArExpectation | null> => {
    const res = await fetch(`/api/finance/ar/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  };

  // Open AR detail dialog with fresh data
  const openArDetail = async (ar: ArExpectation) => {
    const fresh = await fetchSingleAr(ar.id);
    setSelectedAr(fresh || ar);
    setVarianceReason(fresh?.varianceReason || ar.varianceReason || "");
  };

  const deleteImportMutation = useMutation({
    mutationFn: async (importId: string) => {
      const res = await fetch(`/api/finance/imports/${importId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to delete import");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      toast({ title: "Import deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAr) throw new Error("No AR selected");
      const amountCents = Math.round(parseFloat(paymentAmount) * 100);
      const res = await fetch(`/api/finance/ar/${selectedAr.id}/payments`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, paymentDate, paymentReference, paymentMethod, notes: paymentNotes }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Payment Recorded", description: "Payment has been recorded against this AR" });
      setShowPaymentDialog(false);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentMethod("");
      setPaymentNotes("");
      // Refresh the selected AR
      if (selectedAr) {
        const fresh = await fetchSingleAr(selectedAr.id);
        setSelectedAr(fresh);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar/summary"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateVarianceReasonMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/finance/ar/${id}/variance`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ varianceReason: reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reason Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateExpectedAmountMutation = useMutation({
    mutationFn: async ({ id, amountCents, reason }: { id: string; amountCents: number; reason: string }) => {
      const res = await fetch(`/api/finance/ar/${id}/expected-amount`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ expectedAmountCents: amountCents, reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Expected Amount Updated" });
      setEditingExpected(false);
      setNewExpectedAmount("");
      setExpectedChangeReason("");
      if (selectedAr) {
        const fresh = await fetchSingleAr(selectedAr.id);
        setSelectedAr(fresh);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar/summary"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const writeOffMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/finance/ar/${id}/write-off`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "AR Written Off" });
      setSelectedAr(null);
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/ar/summary"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
    mutationFn: async ({ file, sheetName, repNameOverride }: { file: File; sheetName?: string; repNameOverride?: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", selectedClientId);
      if (sheetName) formData.append("sheetName", sheetName);
      if (repNameOverride) formData.append("repNameOverride", repNameOverride);
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
      if (data.autoMapped) {
        queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });
        setSelectedImportId(data.import.id);
        setActiveTab("match");
        const repMsg = data.detectedRepName ? ` Rep: ${data.detectedRepName}.` : '';
        toast({ title: "File imported & columns auto-mapped", description: `${data.normalizedCount} rows processed.${repMsg} Ready for matching.` });
      } else {
        setUploadPreview({
          columns: data.columns,
          preview: data.preview,
          totalRows: data.totalRows,
          importId: data.import.id,
        });
        const repMsg = data.detectedRepName ? ` Rep: ${data.detectedRepName}.` : '';
        toast({ title: "File uploaded", description: `${data.totalRows} rows found.${repMsg} Please map columns.` });
      }
      setPendingFile(null);
      setShowSheetPicker(false);
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
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
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

  const createOrderFromRowMutation = useMutation({
    mutationFn: async ({ rowId, providerId, serviceId, repId }: { rowId: string; providerId: string; serviceId: string; repId?: string }) => {
      const res = await fetch(`/api/finance/imports/${selectedImportId}/create-order`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, providerId, serviceId, repId: repId || undefined }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports", selectedImportId] });
      setCreateOrderRow(null);
      setCreateOrderProviderId("");
      setCreateOrderServiceId("");
      setCreateOrderRepId("");
      toast({ title: "Order created and matched" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create order", description: error.message, variant: "destructive" });
    },
  });

  const { data: searchOrders } = useQuery<Array<{ id: string; customerName: string; invoiceNumber: string; dateSold: string; accountNumber: string | null }>>({
    queryKey: ["/api/orders/search", orderSearchTerm, selectedImport?.clientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orderSearchTerm) params.set("search", orderSearchTerm);
      if (selectedImport?.clientId) params.set("clientId", selectedImport.clientId);
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
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports", selectedImportId] });
      toast({ title: "Row matched successfully" });
      setManualMatchRow(null);
      setOrderSearchTerm("");
      setSelectedOrderId("");
    },
    onError: (error: Error) => {
      toast({ title: "Match failed", description: error.message, variant: "destructive" });
    },
  });

  const openReconcileDialog = async (row: FinanceImportRow) => {
    if (!row.matchedOrderId) return;
    try {
      const res = await fetch(`/api/finance/imports/${selectedImportId}/matched-order/${row.id}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch order details");
      const data = await res.json();
      setReconcileData(data);
      setReconcileRow(row);
      setReconcileAdjustments({
        serviceId: data.order.serviceId,
        providerId: data.order.providerId,
        baseCommissionEarned: data.order.baseCommissionEarned.toFixed(2),
        incentiveEarned: data.order.incentiveEarned.toFixed(2),
        overrideDeduction: data.order.overrideDeduction.toFixed(2),
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const reconcileAdjustMutation = useMutation({
    mutationFn: async () => {
      if (!reconcileRow || !reconcileData) throw new Error("No row selected");
      const adjustments: any = {};
      if (reconcileAdjustments.serviceId !== reconcileData.order.serviceId) {
        adjustments.serviceId = reconcileAdjustments.serviceId;
      }
      if (reconcileAdjustments.providerId !== reconcileData.order.providerId) {
        adjustments.providerId = reconcileAdjustments.providerId;
      }
      const baseComm = parseFloat(reconcileAdjustments.baseCommissionEarned);
      if (!isNaN(baseComm) && baseComm !== reconcileData.order.baseCommissionEarned) {
        adjustments.baseCommissionEarned = baseComm;
      }
      const incEarned = parseFloat(reconcileAdjustments.incentiveEarned);
      if (!isNaN(incEarned) && incEarned !== reconcileData.order.incentiveEarned) {
        adjustments.incentiveEarned = incEarned;
      }
      const overrideDed = parseFloat(reconcileAdjustments.overrideDeduction);
      if (!isNaN(overrideDed) && overrideDed !== reconcileData.order.overrideDeduction) {
        adjustments.overrideDeduction = overrideDed;
      }
      if (Object.keys(adjustments).length === 0) {
        throw new Error("No changes to apply");
      }
      const res = await fetch(`/api/finance/imports/${selectedImportId}/reconcile-order`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          rowId: reconcileRow.id,
          orderId: reconcileData.order.id,
          adjustments,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to apply");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Adjustments Applied", description: "Order updated with reconciliation adjustments" });
      setReconcileRow(null);
      setReconcileData(null);
      queryClient.invalidateQueries({ queryKey: ["/api/finance/imports", selectedImportId] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedClientId) {
      toast({ title: "Select a client", description: "Please select a client before uploading.", variant: "destructive" });
      return;
    }

    const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (isXlsx) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/finance/import/sheets", {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
          body: formData,
        });
        if (!res.ok) throw new Error("Failed to read sheets");
        const data = await res.json();
        if (data.sheets && data.sheets.length > 1) {
          setPendingFile(file);
          setSheetList(data.sheets);
          const sheetsWithData = new Set<string>(data.sheets.filter((s: any) => s.hasData).map((s: any) => s.name));
          setSelectedSheets(sheetsWithData);
          setBatchImportProgress(null);
          setShowSheetPicker(true);
          return;
        }
      } catch {
        // Fall through to normal upload
      }
    }

    uploadMutation.mutate({ file });
  };

  const handleBatchImport = async () => {
    if (!pendingFile || selectedSheets.size === 0) return;
    const sheetsToImport = sheetList.filter(s => selectedSheets.has(s.name));
    setBatchImportProgress({ current: 0, total: sheetsToImport.length, results: [] });

    const results: Array<{ sheet: string; success: boolean; error?: string }> = [];
    for (let i = 0; i < sheetsToImport.length; i++) {
      const sheet = sheetsToImport[i];
      setBatchImportProgress({ current: i + 1, total: sheetsToImport.length, results: [...results] });
      try {
        const formData = new FormData();
        formData.append("file", pendingFile);
        formData.append("clientId", selectedClientId);
        formData.append("sheetName", sheet.name);
        if (sheet.repName) formData.append("repNameOverride", sheet.repName);
        const res = await fetch("/api/finance/import", {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json();
          results.push({ sheet: sheet.name, success: false, error: err.message });
        } else {
          results.push({ sheet: sheet.name, success: true });
        }
      } catch (err: any) {
        results.push({ sheet: sheet.name, success: false, error: err.message || "Unknown error" });
      }
    }

    setBatchImportProgress({ current: sheetsToImport.length, total: sheetsToImport.length, results });
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    queryClient.invalidateQueries({ queryKey: ["/api/finance/imports"] });

    if (failCount === 0) {
      toast({ title: "Import complete", description: `${successCount} sheet(s) imported successfully.` });
      setPendingFile(null);
      setShowSheetPicker(false);
      setBatchImportProgress(null);
    } else {
      toast({ title: "Import partially complete", description: `${successCount} succeeded, ${failCount} failed.`, variant: "destructive" });
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
                      <Label>Rep Name</Label>
                      <Select value={columnMapping.repName} onValueChange={(v) => setColumnMapping({ ...columnMapping, repName: v })}>
                        <SelectTrigger data-testid="map-rep-name">
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
                        <TableCell className="flex gap-1">
                          {imp.status !== 'POSTED' && imp.status !== 'LOCKED' && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={async () => {
                                try {
                                  const rawRes = await fetch(`/api/finance/imports/${imp.id}/raw-rows`, { headers: getAuthHeaders() });
                                  if (!rawRes.ok) throw new Error("Failed to load raw data");
                                  const rawRows = await rawRes.json();
                                  if (rawRows.length > 0) {
                                    const firstRow = JSON.parse(rawRows[0].rawJson);
                                    const cols = Object.keys(firstRow);
                                    const colLower = cols.map(c => c.toLowerCase().trim());
                                    const findCol = (patterns: string[]) => {
                                      for (const p of patterns) {
                                        const idx = colLower.findIndex(c => c === p || c.includes(p));
                                        if (idx >= 0) return cols[idx];
                                      }
                                      return "";
                                    };
                                    const detected = {
                                      customerName: findCol(["customer name", "customer_name", "customername"]),
                                      repName: findCol(["rep name", "rep_name", "repname", "sales rep", "representative"]),
                                      saleDate: findCol(["date sold", "date_sold", "sale date", "sale_date", "install date"]),
                                      serviceType: findCol(["service type", "service_type", "service", "product"]),
                                      utility: findCol(["utility", "provider", "vendor"]),
                                      status: findCol(["status", "client status"]),
                                      usage: findCol(["usage", "usage units", "units"]),
                                      rate: findCol(["rate", "amount", "commission", "price", "payment"]),
                                      rejectionReason: findCol(["rejection reason", "rejection_reason", "reason"])
                                    };
                                    setColumnMapping(detected);
                                    setUploadPreview({ columns: cols, preview: rawRows.slice(0, 5).map((r: any) => JSON.parse(r.rawJson)), totalRows: rawRows.length, importId: imp.id });
                                  }
                                } catch (e: any) {
                                  toast({ title: "Error", description: e.message, variant: "destructive" });
                                }
                              }}
                              data-testid={`button-map-import-${imp.id}`}
                            >
                              <FileSpreadsheet className="h-4 w-4 mr-1" /> Map Columns
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => { setSelectedImportId(imp.id); setActiveTab("match"); }}
                            data-testid={`button-view-import-${imp.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={deleteImportMutation.isPending}
                            onClick={() => {
                              if (window.confirm("Delete this import and all its matched data? This cannot be undone.")) {
                                deleteImportMutation.mutate(imp.id);
                              }
                            }}
                            data-testid={`button-delete-import-${imp.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-1" /> Delete
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
                            <TableHead>Rep</TableHead>
                            <TableHead>Service</TableHead>
                            <TableHead>Sale Date</TableHead>
                            <TableHead>Client Status</TableHead>
                            <TableHead>Expected</TableHead>
                            <TableHead>Paid</TableHead>
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
                              <TableCell>{row.repName || "—"}</TableCell>
                              <TableCell>{row.serviceType || "—"}</TableCell>
                              <TableCell>{row.saleDate ? new Date(row.saleDate).toLocaleDateString() : "—"}</TableCell>
                              <TableCell>{getClientStatusBadge(row.clientStatus || "")}</TableCell>
                              <TableCell>{row.expectedAmountCents ? formatCurrency(row.expectedAmountCents) : "—"}</TableCell>
                              <TableCell>{row.paidAmountCents ? formatCurrency(row.paidAmountCents) : "—"}</TableCell>
                              <TableCell>{getStatusBadge(row.matchStatus)}</TableCell>
                              <TableCell>{row.matchConfidence ? `${row.matchConfidence}%` : "—"}</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  {row.matchStatus === "MATCHED" && selectedImport?.status !== "POSTED" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openReconcileDialog(row)}
                                      data-testid={`button-reconcile-${row.id}`}
                                    >
                                      <Pencil className="h-4 w-4 mr-1" />
                                      Reconcile
                                    </Button>
                                  )}
                                  {row.matchStatus !== "MATCHED" && row.matchStatus !== "IGNORED" && !row.isDuplicate && (
                                    <>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setManualMatchRow(row);
                                          setOrderSearchTerm(row.customerName || "");
                                        }}
                                        disabled={selectedImport?.status === "POSTED"}
                                        data-testid={`button-manual-match-${row.id}`}
                                      >
                                        <Link2 className="h-4 w-4 mr-1" />
                                        Match
                                      </Button>
                                      {(row.paidAmountCents || row.expectedAmountCents) && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => {
                                            setCreateOrderRow(row);
                                            setCreateOrderProviderId("");
                                            setCreateOrderServiceId("");
                                            setCreateOrderRepId("");
                                          }}
                                          disabled={selectedImport?.status === "POSTED"}
                                          data-testid={`button-create-order-${row.id}`}
                                        >
                                          <Plus className="h-4 w-4 mr-1" />
                                          Create Order
                                        </Button>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => ignoreRowMutation.mutate({ rowId: row.id, reason: "Manually ignored" })}
                                        disabled={selectedImport?.status === "POSTED"}
                                        data-testid={`button-ignore-row-${row.id}`}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>

              {/* Manual Match Dialog */}
              <Dialog open={!!manualMatchRow} onOpenChange={(open) => !open && setManualMatchRow(null)}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Manual Match</DialogTitle>
                    <DialogDescription>
                      Match "{manualMatchRow?.customerName}" to an existing order
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="text-sm text-muted-foreground">Import Row Details</div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div><strong>Customer:</strong> {manualMatchRow?.customerName}</div>
                        <div><strong>Service:</strong> {manualMatchRow?.serviceType || "—"}</div>
                        <div><strong>Sale Date:</strong> {manualMatchRow?.saleDate ? new Date(manualMatchRow.saleDate).toLocaleDateString() : "—"}</div>
                        <div><strong>Status:</strong> {manualMatchRow?.clientStatus || "—"}</div>
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
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-8"></TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Invoice #</TableHead>
                                <TableHead>Account #</TableHead>
                                <TableHead>Date</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {searchOrders.map((order) => (
                                <TableRow 
                                  key={order.id} 
                                  className={`cursor-pointer hover-elevate ${selectedOrderId === order.id ? "bg-primary/10" : ""}`}
                                  onClick={() => setSelectedOrderId(order.id)}
                                >
                                  <TableCell>
                                    <Checkbox 
                                      checked={selectedOrderId === order.id}
                                      onCheckedChange={() => setSelectedOrderId(order.id)}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">{order.customerName}</TableCell>
                                  <TableCell>{order.invoiceNumber}</TableCell>
                                  <TableCell>{order.accountNumber || "—"}</TableCell>
                                  <TableCell>{new Date(order.dateSold).toLocaleDateString()}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <div className="p-4 text-center text-muted-foreground">
                            No orders found. Try a different search term.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setManualMatchRow(null)}>Cancel</Button>
                    <Button
                      onClick={() => manualMatchRow && manualMatchMutation.mutate({ rowId: manualMatchRow.id, orderId: selectedOrderId })}
                      disabled={!selectedOrderId || manualMatchMutation.isPending}
                      data-testid="button-confirm-match"
                    >
                      {manualMatchMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                      Confirm Match
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Create Order from Import Row Dialog */}
              <Dialog open={!!createOrderRow} onOpenChange={(open) => { if (!open) setCreateOrderRow(null); }}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create Order from Import</DialogTitle>
                    <DialogDescription>
                      Create a new order for "{createOrderRow?.customerName}" using the import data
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="p-3 bg-muted rounded-lg">
                      <div className="text-sm text-muted-foreground mb-2">Import Row Details</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><strong>Customer:</strong> {createOrderRow?.customerName}</div>
                        <div><strong>Service:</strong> {createOrderRow?.serviceType || "—"}</div>
                        <div><strong>Sale Date:</strong> {createOrderRow?.saleDate ? new Date(createOrderRow.saleDate).toLocaleDateString() : "—"}</div>
                        <div><strong>Rate:</strong> {createOrderRow?.paidAmountCents ? formatCurrency(createOrderRow.paidAmountCents) : createOrderRow?.expectedAmountCents ? formatCurrency(createOrderRow.expectedAmountCents) : "—"}</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Provider *</Label>
                      <Select value={createOrderProviderId} onValueChange={setCreateOrderProviderId}>
                        <SelectTrigger data-testid="select-create-order-provider">
                          <SelectValue placeholder="Select provider..." />
                        </SelectTrigger>
                        <SelectContent>
                          {providers?.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Service *</Label>
                      <Select value={createOrderServiceId} onValueChange={setCreateOrderServiceId}>
                        <SelectTrigger data-testid="select-create-order-service">
                          <SelectValue placeholder="Select service..." />
                        </SelectTrigger>
                        <SelectContent>
                          {services?.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Assign to Rep (optional)</Label>
                      <Select value={createOrderRepId} onValueChange={setCreateOrderRepId}>
                        <SelectTrigger data-testid="select-create-order-rep">
                          <SelectValue placeholder="Select rep..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Rep</SelectItem>
                          {allUsers?.filter(u => u.repId).map((u) => (
                            <SelectItem key={u.id} value={u.repId!}>{u.name} ({u.repId})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateOrderRow(null)}>Cancel</Button>
                    <Button
                      onClick={() => createOrderRow && createOrderFromRowMutation.mutate({
                        rowId: createOrderRow.id,
                        providerId: createOrderProviderId,
                        serviceId: createOrderServiceId,
                        repId: createOrderRepId && createOrderRepId !== "none" ? createOrderRepId : undefined,
                      })}
                      disabled={!createOrderProviderId || !createOrderServiceId || createOrderFromRowMutation.isPending}
                      data-testid="button-confirm-create-order"
                    >
                      {createOrderFromRowMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                      Create Order
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Reconciliation Adjustment Dialog */}
              <Dialog open={!!reconcileRow && !!reconcileData} onOpenChange={(open) => { if (!open) { setReconcileRow(null); setReconcileData(null); } }}>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Reconciliation Adjustment</DialogTitle>
                    <DialogDescription>
                      Adjust order details to match client finance data before posting
                    </DialogDescription>
                  </DialogHeader>
                  {reconcileData && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-lg">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Import Row</div>
                          <div><strong>Customer:</strong> {reconcileData.importRow.customerName}</div>
                          <div><strong>Rep:</strong> {reconcileData.importRow.repName || "—"}</div>
                          <div><strong>Service:</strong> {reconcileData.importRow.serviceType || "—"}</div>
                          <div><strong>Paid (Rate):</strong> {reconcileData.importRow.paidAmountCents ? formatCurrency(reconcileData.importRow.paidAmountCents) : (reconcileData.importRow.expectedAmountCents ? formatCurrency(reconcileData.importRow.expectedAmountCents) : "—")}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Matched Order</div>
                          <div><strong>Customer:</strong> {reconcileData.order.customerName}</div>
                          <div><strong>Rep:</strong> {reconcileData.order.repName || "—"}</div>
                          <div><strong>Invoice:</strong> {reconcileData.order.invoiceNumber || "—"}</div>
                          <div><strong>Date:</strong> {new Date(reconcileData.order.dateSold).toLocaleDateString()}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label>Provider</Label>
                          <Select value={reconcileAdjustments.providerId} onValueChange={(v) => setReconcileAdjustments({ ...reconcileAdjustments, providerId: v })}>
                            <SelectTrigger data-testid="reconcile-provider">
                              <SelectValue placeholder="Select provider" />
                            </SelectTrigger>
                            <SelectContent>
                              {reconcileData.providers?.map((p: any) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Service</Label>
                          <Select value={reconcileAdjustments.serviceId} onValueChange={(v) => setReconcileAdjustments({ ...reconcileAdjustments, serviceId: v })}>
                            <SelectTrigger data-testid="reconcile-service">
                              <SelectValue placeholder="Select service" />
                            </SelectTrigger>
                            <SelectContent>
                              {reconcileData.services?.map((s: any) => (
                                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <Label>Base Commission ($)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={reconcileAdjustments.baseCommissionEarned}
                            onChange={(e) => setReconcileAdjustments({ ...reconcileAdjustments, baseCommissionEarned: e.target.value })}
                            data-testid="reconcile-base-commission"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Incentive ($)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={reconcileAdjustments.incentiveEarned}
                            onChange={(e) => setReconcileAdjustments({ ...reconcileAdjustments, incentiveEarned: e.target.value })}
                            data-testid="reconcile-incentive"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Override ($)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={reconcileAdjustments.overrideDeduction}
                            onChange={(e) => setReconcileAdjustments({ ...reconcileAdjustments, overrideDeduction: e.target.value })}
                            data-testid="reconcile-override"
                          />
                        </div>
                      </div>

                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <div className="text-xs text-muted-foreground">Gross Commission</div>
                            <div className="font-bold text-lg">
                              ${((parseFloat(reconcileAdjustments.baseCommissionEarned) || 0) + (parseFloat(reconcileAdjustments.incentiveEarned) || 0)).toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Override</div>
                            <div className="font-bold text-lg text-orange-600">
                              -${(parseFloat(reconcileAdjustments.overrideDeduction) || 0).toFixed(2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Net Commission</div>
                            <div className="font-bold text-lg text-green-600">
                              ${(
                                (parseFloat(reconcileAdjustments.baseCommissionEarned) || 0) +
                                (parseFloat(reconcileAdjustments.incentiveEarned) || 0) -
                                (parseFloat(reconcileAdjustments.overrideDeduction) || 0)
                              ).toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setReconcileRow(null); setReconcileData(null); }}>Cancel</Button>
                    <Button
                      onClick={() => reconcileAdjustMutation.mutate()}
                      disabled={reconcileAdjustMutation.isPending}
                      data-testid="button-apply-reconcile"
                    >
                      {reconcileAdjustMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                      Apply Adjustments
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
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
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{arExpectations?.length || 0}</div>
                <div className="text-sm text-muted-foreground">Total AR Items</div>
              </CardContent>
            </Card>
            <Card className="border-2 border-primary/20">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{formatCurrency(arExpectations?.reduce((s, a) => s + a.expectedAmountCents, 0) || 0)}</div>
                <div className="text-sm font-medium text-primary">Total Expected</div>
              </CardContent>
            </Card>
            <Card className="border-2 border-green-500/30 bg-green-50/50 dark:bg-green-950/20">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(arExpectations?.reduce((s, a) => s + a.actualAmountCents, 0) || 0)}
                </div>
                <div className="text-sm font-medium text-green-700 dark:text-green-300">Total Paid</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-orange-600">
                  {formatCurrency(Math.abs(arExpectations?.reduce((s, a) => s + a.varianceAmountCents, 0) || 0))}
                </div>
                <div className="text-sm text-muted-foreground">Total Variance</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-red-600">
                  {arExpectations?.filter(a => a.hasVariance).length || 0}
                </div>
                <div className="text-sm text-muted-foreground">Discrepancies</div>
              </CardContent>
            </Card>
          </div>

          {/* AR List */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Accounts Receivable
                </CardTitle>
                <CardDescription>
                  Track expected payments from clients and record actual receipts
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={arFilter} onValueChange={setArFilter}>
                  <SelectTrigger className="w-[150px]" data-testid="select-ar-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="PARTIAL">Partial</SelectItem>
                    <SelectItem value="SATISFIED">Satisfied</SelectItem>
                    <SelectItem value="WRITTEN_OFF">Written Off</SelectItem>
                    <SelectItem value="VARIANCE">With Variance</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      let url = "/api/finance/ar/export";
                      if (arFilter === "VARIANCE") url += "?hasVariance=true";
                      else if (arFilter !== "ALL") url += `?status=${arFilter}`;
                      const res = await fetch(url, { headers: getAuthHeaders() });
                      if (!res.ok) throw new Error("Export failed");
                      const blob = await res.blob();
                      const link = document.createElement("a");
                      link.href = URL.createObjectURL(blob);
                      link.download = `ar-export-${new Date().toISOString().split("T")[0]}.csv`;
                      document.body.appendChild(link);
                      link.click();
                      URL.revokeObjectURL(link.href);
                      document.body.removeChild(link);
                      toast({ title: "AR Exported", description: "CSV file downloaded successfully" });
                    } catch {
                      toast({ title: "Export failed", variant: "destructive" });
                    }
                  }}
                  data-testid="button-export-ar"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {arExpectations && arExpectations.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Expected Amount</TableHead>
                      <TableHead className="text-right">Amount Paid</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arExpectations.map((ar) => (
                      <TableRow 
                        key={ar.id} 
                        className={ar.hasVariance ? "bg-orange-50 dark:bg-orange-900/20" : ""}
                      >
                        <TableCell>{ar.client?.name || ar.clientId}</TableCell>
                        <TableCell>
                          {ar.order?.invoiceNumber || "-"}
                          {ar.order?.customerName && (
                            <div className="text-xs text-muted-foreground">{ar.order.customerName}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={
                              ar.status === "SATISFIED" ? "default" :
                              ar.status === "PARTIAL" ? "secondary" :
                              ar.status === "WRITTEN_OFF" ? "destructive" : "outline"
                            }
                          >
                            {ar.status}
                          </Badge>
                          {ar.hasVariance && (
                            <Badge variant="destructive" className="ml-1">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Variance
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-semibold text-base">{formatCurrency(ar.expectedAmountCents)}</div>
                          <div className="text-xs text-muted-foreground">Expected</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-semibold text-base text-green-600 dark:text-green-400">
                            {formatCurrency(ar.actualAmountCents)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {ar.expectedAmountCents > 0 
                              ? `${Math.round((ar.actualAmountCents / ar.expectedAmountCents) * 100)}% paid`
                              : "Paid"
                            }
                          </div>
                        </TableCell>
                        <TableCell className={`text-right font-medium ${ar.varianceAmountCents > 0 ? "text-green-600" : ar.varianceAmountCents < 0 ? "text-red-600" : ""}`}>
                          {ar.varianceAmountCents > 0 && "+"}
                          {formatCurrency(ar.varianceAmountCents)}
                          {ar.varianceReason && (
                            <div className="text-xs text-muted-foreground">{ar.varianceReason}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={async () => { await openArDetail(ar); setShowPaymentDialog(true); }}
                              disabled={ar.status === "WRITTEN_OFF"}
                              data-testid={`button-record-payment-${ar.id}`}
                            >
                              <DollarSign className="h-4 w-4" />
                            </Button>
                            <Button 
                              size="sm" 
                              variant="ghost"
                              onClick={() => openArDetail(ar)}
                              data-testid={`button-view-ar-${ar.id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
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

          {/* AR Detail Dialog */}
          <Dialog open={!!selectedAr && !showPaymentDialog} onOpenChange={(open) => !open && setSelectedAr(null)}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>AR Details</DialogTitle>
                <DialogDescription>
                  {selectedAr?.order?.invoiceNumber} - {selectedAr?.client?.name}
                </DialogDescription>
              </DialogHeader>
              {selectedAr && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 border rounded-lg text-center relative">
                      <div className="text-lg font-bold">{formatCurrency(selectedAr.expectedAmountCents)}</div>
                      <div className="text-sm text-muted-foreground">Expected</div>
                      {selectedAr.status !== "WRITTEN_OFF" && (
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="absolute top-1 right-1 h-6 w-6"
                          onClick={() => {
                            setEditingExpected(true);
                            setNewExpectedAmount((selectedAr.expectedAmountCents / 100).toFixed(2));
                          }}
                          data-testid="button-edit-expected"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="p-3 border rounded-lg text-center">
                      <div className="text-lg font-bold text-blue-600">{formatCurrency(selectedAr.actualAmountCents)}</div>
                      <div className="text-sm text-muted-foreground">Received</div>
                    </div>
                    <div className={`p-3 border rounded-lg text-center ${selectedAr.hasVariance ? "border-orange-400 bg-orange-50 dark:bg-orange-900/20" : ""}`}>
                      <div className={`text-lg font-bold ${selectedAr.varianceAmountCents > 0 ? "text-green-600" : selectedAr.varianceAmountCents < 0 ? "text-red-600" : ""}`}>
                        {selectedAr.varianceAmountCents > 0 && "+"}{formatCurrency(selectedAr.varianceAmountCents)}
                      </div>
                      <div className="text-sm text-muted-foreground">Variance</div>
                    </div>
                  </div>

                  <Tabs defaultValue="order-details" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="order-details" data-testid="tab-order-details">Order Details</TabsTrigger>
                      <TabsTrigger value="financials" data-testid="tab-financials">Financials</TabsTrigger>
                      <TabsTrigger value="payments" data-testid="tab-payments">
                        Payments {selectedAr.payments?.length ? `(${selectedAr.payments.length})` : ""}
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="order-details" className="space-y-3 mt-3">
                      {selectedAr.order ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div>
                              <div className="text-muted-foreground">Invoice Number</div>
                              <div className="font-medium" data-testid="text-ar-invoice">{selectedAr.order.invoiceNumber || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Customer Name</div>
                              <div className="font-medium" data-testid="text-ar-customer">{selectedAr.order.customerName}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Sales Rep</div>
                              <div className="font-medium" data-testid="text-ar-rep">{(selectedAr.order as any).repName || selectedAr.order.repId || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Client</div>
                              <div className="font-medium" data-testid="text-ar-client">{selectedAr.client?.name || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Provider</div>
                              <div className="font-medium" data-testid="text-ar-provider">{(selectedAr.order as any).provider?.name || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Service Type</div>
                              <div className="font-medium" data-testid="text-ar-service">{(selectedAr.order as any).service?.name || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Date Sold</div>
                              <div className="font-medium" data-testid="text-ar-date-sold">{selectedAr.order.dateSold ? new Date(selectedAr.order.dateSold).toLocaleDateString() : "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Install Date</div>
                              <div className="font-medium" data-testid="text-ar-install-date">{selectedAr.order.installDate ? new Date(selectedAr.order.installDate).toLocaleDateString() : "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Job Status</div>
                              <div className="font-medium" data-testid="text-ar-job-status">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  selectedAr.order.jobStatus === "COMPLETED" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
                                  selectedAr.order.jobStatus === "PENDING" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" :
                                  "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                                }`}>{selectedAr.order.jobStatus}</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Approval Status</div>
                              <div className="font-medium" data-testid="text-ar-approval-status">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  selectedAr.order.approvalStatus === "APPROVED" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
                                  selectedAr.order.approvalStatus === "REJECTED" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" :
                                  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                                }`}>{selectedAr.order.approvalStatus}</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Account Number</div>
                              <div className="font-medium" data-testid="text-ar-account">{selectedAr.order.accountNumber || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Customer Address</div>
                              <div className="font-medium" data-testid="text-ar-address">{selectedAr.order.customerAddress || "-"}</div>
                            </div>
                          </div>
                          {(selectedAr.order.tvSold || selectedAr.order.mobileSold) && (
                            <div className="flex gap-2 mt-2">
                              {selectedAr.order.tvSold && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">TV Sold</span>}
                              {selectedAr.order.mobileSold && <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Mobile Sold ({selectedAr.order.mobileLinesQty} lines)</span>}
                            </div>
                          )}
                          {selectedAr.order.notes && (
                            <div className="mt-2">
                              <div className="text-sm text-muted-foreground">Notes</div>
                              <div className="text-sm bg-muted/30 p-2 rounded">{selectedAr.order.notes}</div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-4">No order linked to this AR record</div>
                      )}
                    </TabsContent>

                    <TabsContent value="financials" className="space-y-3 mt-3">
                      {selectedAr.order ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div>
                              <div className="text-muted-foreground">Base Commission</div>
                              <div className="font-medium" data-testid="text-ar-base-comm">${parseFloat(selectedAr.order.baseCommissionEarned || "0").toFixed(2)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Incentive Earned</div>
                              <div className="font-medium" data-testid="text-ar-incentive">${parseFloat(selectedAr.order.incentiveEarned || "0").toFixed(2)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Override Deduction</div>
                              <div className="font-medium" data-testid="text-ar-override">${parseFloat(selectedAr.order.overrideDeduction || "0").toFixed(2)}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Gross Commission</div>
                              <div className="font-medium text-green-600" data-testid="text-ar-gross">
                                ${(parseFloat(selectedAr.order.baseCommissionEarned || "0") + parseFloat(selectedAr.order.incentiveEarned || "0") + parseFloat(selectedAr.order.overrideDeduction || "0")).toFixed(2)}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Net Commission (Rep Payout)</div>
                              <div className="font-medium" data-testid="text-ar-net">
                                ${(parseFloat(selectedAr.order.baseCommissionEarned || "0") + parseFloat(selectedAr.order.incentiveEarned || "0")).toFixed(2)}
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Commission Source</div>
                              <div className="font-medium" data-testid="text-ar-source">{selectedAr.order.commissionSource || "-"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Payment Status</div>
                              <div className="font-medium" data-testid="text-ar-pay-status">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  selectedAr.order.paymentStatus === "PAID" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
                                  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                                }`}>{selectedAr.order.paymentStatus}</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-muted-foreground">Commission Paid</div>
                              <div className="font-medium" data-testid="text-ar-comm-paid">${parseFloat(selectedAr.order.commissionPaid || "0").toFixed(2)}</div>
                            </div>
                          </div>

                          {editingExpected && (
                            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                              <div className="font-medium">Edit Expected Amount</div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <Label>New Amount ($)</Label>
                                  <Input 
                                    type="number" 
                                    step="0.01"
                                    value={newExpectedAmount}
                                    onChange={(e) => setNewExpectedAmount(e.target.value)}
                                    placeholder="0.00"
                                    data-testid="input-new-expected-amount"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label>Reason for Change</Label>
                                  <Input 
                                    value={expectedChangeReason}
                                    onChange={(e) => setExpectedChangeReason(e.target.value)}
                                    placeholder="e.g., Client correction, rate adjustment"
                                    data-testid="input-expected-change-reason"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => {
                                    setEditingExpected(false);
                                    setNewExpectedAmount("");
                                    setExpectedChangeReason("");
                                  }}
                                  data-testid="button-cancel-edit-expected"
                                >
                                  Cancel
                                </Button>
                                <Button 
                                  size="sm"
                                  onClick={() => {
                                    const amountCents = Math.round(parseFloat(newExpectedAmount) * 100);
                                    if (isNaN(amountCents) || amountCents < 0) {
                                      toast({ title: "Invalid Amount", description: "Please enter a valid amount", variant: "destructive" });
                                      return;
                                    }
                                    updateExpectedAmountMutation.mutate({ 
                                      id: selectedAr.id, 
                                      amountCents, 
                                      reason: expectedChangeReason 
                                    });
                                  }}
                                  disabled={updateExpectedAmountMutation.isPending || !newExpectedAmount}
                                  data-testid="button-save-expected"
                                >
                                  {updateExpectedAmountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                                </Button>
                              </div>
                            </div>
                          )}

                          {selectedAr.hasVariance && (
                            <div className="space-y-2">
                              <Label>Variance Reason</Label>
                              <div className="flex gap-2">
                                <Input 
                                  value={varianceReason || selectedAr.varianceReason || ""} 
                                  onChange={(e) => setVarianceReason(e.target.value)}
                                  placeholder="Explain the variance..."
                                  data-testid="input-variance-reason"
                                />
                                <Button 
                                  onClick={() => updateVarianceReasonMutation.mutate({ id: selectedAr.id, reason: varianceReason })}
                                  disabled={updateVarianceReasonMutation.isPending}
                                  data-testid="button-save-variance-reason"
                                >
                                  Save
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-4">No order linked to this AR record</div>
                      )}
                    </TabsContent>

                    <TabsContent value="payments" className="space-y-3 mt-3">
                      {selectedAr.payments && selectedAr.payments.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Amount</TableHead>
                              <TableHead>Reference</TableHead>
                              <TableHead>Recorded By</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedAr.payments.map((p) => (
                              <TableRow key={p.id}>
                                <TableCell>{new Date(p.paymentDate).toLocaleDateString()}</TableCell>
                                <TableCell>{formatCurrency(p.amountCents)}</TableCell>
                                <TableCell>{p.paymentReference || "-"}</TableCell>
                                <TableCell>{p.recordedBy?.name || "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-4">No payments recorded yet</div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              )}
              <DialogFooter className="flex-wrap gap-2">
                {selectedAr?.status !== "WRITTEN_OFF" && selectedAr?.status !== "SATISFIED" && (
                  <Button 
                    variant="destructive"
                    onClick={() => {
                      const reason = prompt("Enter write-off reason:");
                      if (reason) writeOffMutation.mutate({ id: selectedAr!.id, reason });
                    }}
                    disabled={writeOffMutation.isPending}
                    data-testid="button-write-off"
                  >
                    Write Off
                  </Button>
                )}
                <Button 
                  onClick={() => { setShowPaymentDialog(true); }}
                  disabled={selectedAr?.status === "WRITTEN_OFF"}
                  data-testid="button-add-payment"
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  Record Payment
                </Button>
                <Button variant="outline" onClick={() => setSelectedAr(null)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Payment Dialog */}
          <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Payment</DialogTitle>
                <DialogDescription>
                  Recording payment for {selectedAr?.order?.invoiceNumber || "AR"} - Balance: {formatCurrency((selectedAr?.expectedAmountCents || 0) - (selectedAr?.actualAmountCents || 0))}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Payment Amount ($)</Label>
                  <Input 
                    type="number" 
                    step="0.01"
                    value={paymentAmount} 
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="0.00"
                    data-testid="input-payment-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Date</Label>
                  <Input 
                    type="date" 
                    value={paymentDate} 
                    onChange={(e) => setPaymentDate(e.target.value)}
                    data-testid="input-payment-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Reference Number (optional)</Label>
                  <Input 
                    value={paymentReference} 
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Check #, Wire ID, etc."
                    data-testid="input-payment-reference"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Method (optional)</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger data-testid="select-payment-method">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACH">ACH</SelectItem>
                      <SelectItem value="WIRE">Wire</SelectItem>
                      <SelectItem value="CHECK">Check</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Input 
                    value={paymentNotes} 
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Any additional notes..."
                    data-testid="input-payment-notes"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
                <Button 
                  onClick={() => recordPaymentMutation.mutate()}
                  disabled={!paymentAmount || recordPaymentMutation.isPending}
                  data-testid="button-confirm-payment"
                >
                  {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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

      <Dialog open={showSheetPicker} onOpenChange={(open) => { if (!open && !batchImportProgress) { setShowSheetPicker(false); setPendingFile(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select Sheets to Import</DialogTitle>
            <DialogDescription>Choose one or more sheets to import. Sheets with data are pre-selected.</DialogDescription>
          </DialogHeader>

          {batchImportProgress && batchImportProgress.results.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              <div className="text-sm text-muted-foreground mb-2">
                Importing {batchImportProgress.current} of {batchImportProgress.total}...
              </div>
              {batchImportProgress.results.map((r) => (
                <div key={r.sheet} className="flex items-center gap-2 p-2 rounded border text-sm">
                  {r.success ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                  <span className="font-medium">{r.sheet}</span>
                  {r.error && <span className="text-red-500 text-xs ml-auto">{r.error}</span>}
                </div>
              ))}
              {batchImportProgress.current === batchImportProgress.total && (
                <div className="pt-2">
                  <Button onClick={() => { setShowSheetPicker(false); setPendingFile(null); setBatchImportProgress(null); }} className="w-full" data-testid="button-close-batch-results">
                    Done
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">{selectedSheets.size} of {sheetList.length} selected</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedSheets(new Set(sheetList.map(s => s.name)))} data-testid="button-select-all-sheets">
                    Select All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedSheets(new Set())} data-testid="button-deselect-all-sheets">
                    Clear
                  </Button>
                </div>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {sheetList.map((sheet) => (
                  <label
                    key={sheet.name}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedSheets.has(sheet.name) ? 'bg-accent border-primary/30' : 'hover:bg-accent/50'}`}
                    data-testid={`label-sheet-${sheet.name}`}
                  >
                    <Checkbox
                      checked={selectedSheets.has(sheet.name)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedSheets);
                        if (checked) next.add(sheet.name); else next.delete(sheet.name);
                        setSelectedSheets(next);
                      }}
                      data-testid={`checkbox-sheet-${sheet.name}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{sheet.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {sheet.rowCount} rows
                        {sheet.repName && (
                          <span className="ml-2">· Rep: <span className="font-medium text-foreground">{sheet.repName}</span>
                            {sheet.repNameSource === 'tab_name' && <span className="text-xs ml-1">(from tab name)</span>}
                          </span>
                        )}
                        {sheet.repCode && <span className="ml-1">({sheet.repCode})</span>}
                      </div>
                    </div>
                    {sheet.hasData && <Badge variant="secondary" className="shrink-0">Has Data</Badge>}
                  </label>
                ))}
              </div>
            </>
          )}

          {!batchImportProgress && (
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => { setShowSheetPicker(false); setPendingFile(null); }} data-testid="button-cancel-sheet-picker">
                Cancel
              </Button>
              <Button onClick={handleBatchImport} disabled={selectedSheets.size === 0} data-testid="button-import-selected-sheets">
                {selectedSheets.size === 1 ? 'Import 1 Sheet' : `Import ${selectedSheets.size} Sheets`}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
