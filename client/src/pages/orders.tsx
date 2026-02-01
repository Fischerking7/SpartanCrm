import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge, PaymentStatusBadge, ApprovalStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, NativeSelect, useIsTouchDevice } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Filter, Download, Eye, Upload, FileSpreadsheet, AlertCircle, CheckCircle, Trash2, Flag, Smartphone, ThumbsUp, ThumbsDown, DollarSign } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { SalesOrder, Client, Provider, Service, User, CommissionLineItem, RateCard } from "@shared/schema";

interface MobileLineEntry {
  mobileProductType: string;
  mobilePortedStatus: string;
}

// Parse date string as local date to avoid timezone issues
function formatLocalDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts.map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
    const [providerFilter, setProviderFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [dateFromFilter, setDateFromFilter] = useState<string>("");
  const [dateToFilter, setDateToFilter] = useState<string>("");
  const [dateFilterType, setDateFilterType] = useState<string>("installDate");
  const [exportFilter, setExportFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("createdAt_desc");
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fromLeadId, setFromLeadId] = useState<string | null>(null);
  const [flaggingOrder, setFlaggingOrder] = useState<SalesOrder | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [activeTab, setActiveTab] = useState<"orders" | "mobile" | "approval-queue" | "approved" | "paid">("orders");
  const [showMobileOrderDialog, setShowMobileOrderDialog] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [execViewMode, setExecViewMode] = useState<"own" | "team" | "global">("global");
  const [approvalFilter, setApprovalFilter] = useState<string>("all");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectingOrder, setRejectingOrder] = useState<SalesOrder | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");

  const [newOrderForm, setNewOrderForm] = useState({
    repId: "",
    clientId: "",
    providerId: "",
    serviceId: "",
    dateSold: "",
    installDate: "",
    installTime: "",
    installType: "",
    accountNumber: "",
    customerName: "",
    customerAddress: "",
    customerPhone: "",
    customerEmail: "",
    hasTv: false,
  });

  const [mobileOrderForm, setMobileOrderForm] = useState({
    repId: "",
    clientId: "",
    providerId: "",
    serviceId: "",
    dateSold: "",
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    accountNumber: "",
    mobileLines: [{ mobileProductType: "", mobilePortedStatus: "" }] as MobileLineEntry[],
  });

  const addMobileLine = () => {
    setMobileOrderForm(f => ({
      ...f,
      mobileLines: [...f.mobileLines, { mobileProductType: "", mobilePortedStatus: "" }]
    }));
  };

  const removeMobileLine = (index: number) => {
    setMobileOrderForm(f => ({
      ...f,
      mobileLines: f.mobileLines.filter((_, i) => i !== index)
    }));
  };

  const updateMobileLine = (index: number, field: keyof MobileLineEntry, value: string) => {
    setMobileOrderForm(f => ({
      ...f,
      mobileLines: f.mobileLines.map((line, i) => 
        i === index ? { ...line, [field]: value } : line
      )
    }));
  };

  const resetMobileOrderForm = () => {
    setMobileOrderForm({
      repId: "",
      clientId: "",
      providerId: "",
      serviceId: "",
      dateSold: "",
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      accountNumber: "",
      mobileLines: [{ mobileProductType: "", mobilePortedStatus: "" }],
    });
  };

  const isAdmin = user?.role === "ADMIN" || user?.role === "OPERATIONS" || user?.role === "EXECUTIVE";
  const isOperations = user?.role === "OPERATIONS";
  const isExecutive = user?.role === "EXECUTIVE";
  const isTouchDevice = useIsTouchDevice();

  // Handle pre-filling form from lead or MDU query params
  useEffect(() => {
    if (searchString) {
      const params = new URLSearchParams(searchString);
      const fromLead = params.get("fromLead");
      const fromMdu = params.get("fromMdu");
      const customerName = params.get("customerName");
      const customerAddress = params.get("customerAddress");
      const customerPhone = params.get("customerPhone");
      const customerEmail = params.get("customerEmail");
      const accountNumber = params.get("accountNumber");
      
      if (fromLead) {
        setFromLeadId(fromLead);
        setNewOrderForm(f => ({
          ...f,
          customerName: customerName || "",
          customerAddress: customerAddress || "",
          customerPhone: customerPhone || "",
          customerEmail: customerEmail || "",
          accountNumber: accountNumber || "",
        }));
        setShowNewOrderDialog(true);
        setLocation("/orders", { replace: true });
        toast({
          title: "Lead information loaded",
          description: "Customer details have been pre-filled from the lead.",
        });
      } else if (fromMdu) {
        // Fetch MDU order data securely from backend (not via URL params)
        const fetchMduOrder = async () => {
          try {
            const res = await fetch(`/api/admin/mdu/${fromMdu}/prefill`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error("Failed to fetch MDU order");
            const mduOrder = await res.json();
            setNewOrderForm(f => ({
              ...f,
              repId: mduOrder.mduRepId || "",
              customerName: mduOrder.customerName || "",
              customerAddress: mduOrder.customerAddress || "",
              customerPhone: mduOrder.customerPhone || "",
              customerEmail: mduOrder.customerEmail || "",
              accountNumber: mduOrder.accountNumber || "",
              providerId: mduOrder.providerId || "",
              clientId: mduOrder.clientId || "",
              serviceId: mduOrder.serviceId || "",
              dateSold: mduOrder.dateSold || "",
              installDate: mduOrder.installDate || "",
              installTime: mduOrder.installTime || "",
              installType: mduOrder.installType || "",
              hasTv: mduOrder.tvSold || false,
              hasMobile: mduOrder.mobileSold || false,
              mobileLinesQty: mduOrder.mobileLinesQty || 0,
              notes: mduOrder.notes || "",
            }));
            setShowNewOrderDialog(true);
            toast({
              title: "MDU order loaded",
              description: "Order details have been pre-filled from the MDU staging order.",
            });
          } catch (error) {
            toast({
              title: "Failed to load MDU order",
              description: "Could not fetch the MDU order details.",
              variant: "destructive",
            });
          }
        };
        fetchMduOrder();
        setLocation("/orders", { replace: true });
      }
    }
  }, [searchString]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    
    setIsImporting(true);
    setImportResult(null);
    
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      
      const authHeaders = getAuthHeaders() as { Authorization: string };
      const res = await fetch("/api/admin/orders/import", {
        method: "POST",
        headers: {
          Authorization: authHeaders.Authorization,
        },
        body: formData,
      });
      
      const result = await res.json();
      
      if (!res.ok) {
        throw new Error(result.message || "Import failed");
      }
      
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      
      if (result.success > 0) {
        toast({
          title: "Import completed",
          description: `Successfully imported ${result.success} orders${result.failed > 0 ? `, ${result.failed} failed` : ""}`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const closeImportDialog = () => {
    setShowImportDialog(false);
    setImportFile(null);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const { data: orders, isLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/orders", isExecutive ? execViewMode : null],
    queryFn: async () => {
      const url = isExecutive ? `/api/orders?viewMode=${execViewMode}` : "/api/orders";
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
    queryFn: async () => {
      const res = await fetch("/api/services", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Available services filtered by client and provider (for order form)
  const { data: availableServices } = useQuery<Service[]>({
    queryKey: ["/api/services/available", newOrderForm.clientId, newOrderForm.providerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (newOrderForm.clientId) params.append("clientId", newOrderForm.clientId);
      if (newOrderForm.providerId) params.append("providerId", newOrderForm.providerId);
      const res = await fetch(`/api/services/available?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showNewOrderDialog && !!newOrderForm.clientId && !!newOrderForm.providerId,
  });

  // Available services filtered by client and provider (for mobile order form)
  const { data: mobileAvailableServices } = useQuery<Service[]>({
    queryKey: ["/api/services/available", mobileOrderForm.clientId, mobileOrderForm.providerId, "mobile"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (mobileOrderForm.clientId) params.append("clientId", mobileOrderForm.clientId);
      if (mobileOrderForm.providerId) params.append("providerId", mobileOrderForm.providerId);
      const res = await fetch(`/api/services/available?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showMobileOrderDialog && !!mobileOrderForm.clientId && !!mobileOrderForm.providerId,
  });

  const { data: reps } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const users = await res.json();
      // Allow admins to create orders for any sales role
      const salesRoles = ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"];
      return users.filter((u: User) => salesRoles.includes(u.role) && u.status === "ACTIVE" && !u.deletedAt);
    },
    enabled: isAdmin,
  });

  // Auto-detect mobile rates when provider/client/service change
  const { data: mobileRateCheck } = useQuery<{ hasMobileRates: boolean; mobileProductTypes: string[] }>({
    queryKey: ["/api/rate-cards/mobile-check", newOrderForm.providerId, newOrderForm.clientId, newOrderForm.serviceId],
    queryFn: async () => {
      if (!newOrderForm.providerId) return { hasMobileRates: false, mobileProductTypes: [] };
      const params = new URLSearchParams({ providerId: newOrderForm.providerId });
      if (newOrderForm.clientId) params.append("clientId", newOrderForm.clientId);
      if (newOrderForm.serviceId) params.append("serviceId", newOrderForm.serviceId);
      const res = await fetch(`/api/rate-cards/mobile-check?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) return { hasMobileRates: false, mobileProductTypes: [] };
      return res.json();
    },
    enabled: showNewOrderDialog && !!newOrderForm.providerId,
  });

  // Fetch commission line items when viewing order details
  const { data: commissionLines } = useQuery<CommissionLineItem[]>({
    queryKey: ["/api/orders", selectedOrder?.id, "commission-lines"],
    queryFn: async () => {
      if (!selectedOrder?.id) return [];
      const res = await fetch(`/api/orders/${selectedOrder.id}/commission-lines`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedOrder?.id,
  });

  // Fetch rate cards for commission calculation (all users need this for accurate net display)
  const isAdminOrExec = user?.role === "ADMIN" || user?.role === "OPERATIONS" || user?.role === "EXECUTIVE";
  const { data: rateCards } = useQuery<RateCard[]>({
    queryKey: ["/api/rate-cards/for-overrides"],
    queryFn: async () => {
      const res = await fetch("/api/rate-cards/for-overrides", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Helper to calculate override amount for an order
  const getOverrideAmount = (order: SalesOrder): number => {
    if (!rateCards || !order.appliedRateCardId) return 0;
    
    // Executives are exempt from override deductions
    const orderRep = reps?.find(r => r.repId === order.repId);
    if (orderRep?.role === "EXECUTIVE") return 0;
    
    const rateCard = rateCards.find(rc => rc.id === order.appliedRateCardId);
    if (!rateCard) return 0;
    
    let total = 0;
    total += parseFloat(rateCard.overrideDeduction || "0");
    if (order.tvSold) {
      total += parseFloat(rateCard.tvOverrideDeduction || "0");
    }
    if (order.mobileSold) {
      total += parseFloat((rateCard as any).mobileOverrideDeduction || "0");
    }
    return total;
  };

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: typeof newOrderForm) => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          repId: isAdmin ? orderData.repId : user?.repId,
          clientId: orderData.clientId || null,
          providerId: orderData.providerId || null,
          serviceId: orderData.serviceId || null,
          dateSold: orderData.dateSold,
          installDate: orderData.installDate || null,
          installTime: orderData.installTime || null,
          installType: orderData.installType || null,
          accountNumber: orderData.accountNumber || null,
          customerName: orderData.customerName,
          customerAddress: orderData.customerAddress || null,
          customerPhone: orderData.customerPhone || null,
          customerEmail: orderData.customerEmail || null,
          hasTv: orderData.hasTv,
          hasMobile: false,
          mobileLines: [],
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setShowNewOrderDialog(false);
      resetNewOrderForm();
      toast({ title: "Order created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create order", description: error.message, variant: "destructive" });
    },
  });

  const createMobileOrderMutation = useMutation({
    mutationFn: async (orderData: typeof mobileOrderForm) => {
      const res = await fetch("/api/orders/mobile", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          repId: isAdmin ? orderData.repId : user?.repId,
          clientId: orderData.clientId || null,
          providerId: orderData.providerId || null,
          serviceId: orderData.serviceId || null,
          dateSold: orderData.dateSold,
          customerName: orderData.customerName,
          customerPhone: orderData.customerPhone || null,
          customerAddress: orderData.customerAddress || null,
          accountNumber: orderData.accountNumber || null,
          mobileLines: orderData.mobileLines,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create mobile order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setShowMobileOrderDialog(false);
      resetMobileOrderForm();
      setActiveTab("mobile");
      toast({ title: "Mobile order created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create mobile order", description: error.message, variant: "destructive" });
    },
  });

  const resetNewOrderForm = () => {
    setNewOrderForm({
      repId: "",
      clientId: "",
      providerId: "",
      serviceId: "",
      dateSold: "",
      installDate: "",
      installTime: "",
      installType: "",
      accountNumber: "",
      customerName: "",
      customerAddress: "",
      customerPhone: "",
      customerEmail: "",
      hasTv: false,
    });
  };

  const updateJobStatusMutation = useMutation({
    mutationFn: async ({ orderId, jobStatus, installDate, installTime, installType, repId, clientId, providerId, serviceId, tvSold, mobileSold, mobileProductType, customerName, customerPhone, customerEmail, customerAddress, accountNumber }: { orderId: string; jobStatus?: string; installDate?: string; installTime?: string; installType?: string; repId?: string; clientId?: string; providerId?: string; serviceId?: string; tvSold?: boolean; mobileSold?: boolean; mobileProductType?: string; customerName?: string; customerPhone?: string; customerEmail?: string; customerAddress?: string; accountNumber?: string }) => {
      const body: Record<string, any> = {};
      if (jobStatus) body.jobStatus = jobStatus;
      if (installDate !== undefined) body.installDate = installDate;
      if (installTime !== undefined) body.installTime = installTime;
      if (installType !== undefined) body.installType = installType;
      if (repId !== undefined) body.repId = repId;
      if (clientId !== undefined) body.clientId = clientId;
      if (providerId !== undefined) body.providerId = providerId;
      if (serviceId !== undefined) body.serviceId = serviceId;
      if (tvSold !== undefined) body.tvSold = tvSold;
      if (mobileSold !== undefined) body.mobileSold = mobileSold;
      if (mobileProductType !== undefined) body.mobileProductType = mobileProductType;
      if (customerName !== undefined) body.customerName = customerName;
      if (customerPhone !== undefined) body.customerPhone = customerPhone;
      if (customerEmail !== undefined) body.customerEmail = customerEmail;
      if (customerAddress !== undefined) body.customerAddress = customerAddress;
      if (accountNumber !== undefined) body.accountNumber = accountNumber;
      
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update order");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", data.id, "commission-lines"] });
      setSelectedOrder(data);
      toast({ title: "Order updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update order", description: error.message, variant: "destructive" });
    },
  });

  const recalculateCommissionMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/recalculate-commission`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to recalculate commission");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders", data.id, "commission-lines"] });
      setSelectedOrder(data);
      toast({ title: "Commission recalculated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to recalculate commission", description: error.message, variant: "destructive" });
    },
  });

  const approveOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/approve`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to approve order");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedOrder(data);
      toast({ title: "Order approved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve order", description: error.message, variant: "destructive" });
    },
  });

  const rejectOrderMutation = useMutation({
    mutationFn: async ({ orderId, rejectionNote }: { orderId: string; rejectionNote: string }) => {
      const res = await fetch(`/api/orders/${orderId}/reject`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionNote }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reject order");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedOrder(data);
      setShowRejectDialog(false);
      setRejectingOrder(null);
      setRejectionNote("");
      toast({ title: "Order rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject order", description: error.message, variant: "destructive" });
    },
  });

  const bulkApproveOrdersMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const res = await fetch("/api/orders/bulk-approve", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to bulk approve orders");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedOrderIds(new Set());
      toast({ title: `Approved ${data.approved} orders${data.skipped > 0 ? `, ${data.skipped} skipped` : ""}` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to bulk approve orders", description: error.message, variant: "destructive" });
    },
  });

  const handleRejectOrder = (order: SalesOrder) => {
    setRejectingOrder(order);
    setRejectionNote("");
    setShowRejectDialog(true);
  };

  const handleConfirmReject = () => {
    if (rejectingOrder && rejectionNote.trim()) {
      rejectOrderMutation.mutate({ orderId: rejectingOrder.id, rejectionNote: rejectionNote.trim() });
    }
  };

  const handleExportToExcel = () => {
    if (!filteredOrders?.length) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }
    
    // Admin/Exec see full breakdown: Gross, Override, Net; REPs see only net commission
    // Note: baseCommissionEarned is stored as NET (after override already deducted)
    // So Gross = Net + Override, and Net = baseCommissionEarned + incentive
    const headers = isAdminOrExec 
      ? ["Rep Name", "SLSID", "Account Number", "Customer Name", "Date Sold", "Date Install", "Service", "Gross Commission", "Override", "Net Commission", "Provider"]
      : ["Rep Name", "SLSID", "Account Number", "Customer Name", "Date Sold", "Date Install", "Service", "Commission", "Provider"];
    const rows = filteredOrders.map(order => {
      const service = services?.find(s => s.id === order.serviceId);
      const provider = providers?.find(p => p.id === order.providerId);
      const repUser = reps?.find(r => r.repId === order.repId);
      const overrideAmount = getOverrideAmount(order);
      const baseCommission = parseFloat(order.baseCommissionEarned);
      const incentive = parseFloat(order.incentiveEarned || "0");
      // Net is what's stored (already has override deducted)
      const netCommission = baseCommission + incentive;
      // Gross = Net + Override (add back the deduction to get original amount)
      const grossCommission = netCommission + overrideAmount;
      
      if (isAdminOrExec) {
        return [
          repUser?.name || "",
          order.repId,
          order.accountNumber || "",
          order.customerName,
          order.dateSold,
          order.installDate || "",
          service?.name || "",
          grossCommission.toFixed(2),
          overrideAmount.toFixed(2),
          netCommission.toFixed(2),
          provider?.name || "",
        ];
      }
      // REPs only see net commission (no override column)
      return [
        repUser?.name || "",
        order.repId,
        order.accountNumber || "",
        order.customerName,
        order.dateSold,
        order.installDate || "",
        service?.name || "",
        netCommission.toFixed(2),
        provider?.name || "",
      ];
    });
    
    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast({ title: "Export successful", description: `${filteredOrders.length} orders exported` });
  };

  // Submit original order then open mobile order form
  const submitOrderThenOpenMobile = async () => {
    if (!newOrderForm.customerName || !newOrderForm.dateSold) {
      toast({ title: "Missing required fields", description: "Customer name and date sold are required", variant: "destructive" });
      return;
    }
    if (isAdmin && !newOrderForm.repId) {
      toast({ title: "Missing required fields", description: "Rep ID is required", variant: "destructive" });
      return;
    }
    
    try {
      // Submit the original order first
      await createOrderMutation.mutateAsync(newOrderForm);
      
      // Prefill mobile form - only carry over customer info, not base order fields
      // Mobile orders are tracked separately with their own provider/client/service selection
      setMobileOrderForm({
        providerId: "",  // Let user select provider for mobile
        clientId: "",    // Let user select client for mobile
        serviceId: "",   // Mobile uses mobileProductType, not serviceId
        customerName: newOrderForm.customerName,  // Same customer
        dateSold: newOrderForm.dateSold,
        customerPhone: newOrderForm.customerPhone,
        customerAddress: newOrderForm.customerAddress,
        accountNumber: "",  // Mobile may have different account
        repId: newOrderForm.repId,
        mobileLines: [{ mobileProductType: "", mobilePortedStatus: "" }],
      });
      setShowNewOrderDialog(false);
      setShowMobileOrderDialog(true);
      toast({ title: "Order created", description: "Now add mobile order details" });
    } catch (error: any) {
      // Error already handled by mutation's onError
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm("Are you sure you want to permanently delete this order? This action cannot be undone.")) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete order");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order deleted successfully" });
    } catch (error: any) {
      toast({ title: "Failed to delete order", description: error.message, variant: "destructive" });
    }
  };

  const markPaidMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/admin/orders/${orderId}/mark-paid`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to mark as paid");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedOrder(data);
      toast({ title: "Order marked as paid" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to mark as paid", description: error.message, variant: "destructive" });
    },
  });

  const bulkMarkPaidMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const res = await fetch("/api/admin/orders/bulk-mark-paid", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to mark orders as paid");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedOrderIds(new Set());
      toast({ title: `${data.marked} orders marked as paid`, description: data.skipped > 0 ? `${data.skipped} orders skipped (already paid)` : undefined });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to mark orders as paid", description: error.message, variant: "destructive" });
    },
  });

  const handleBulkMarkPaid = () => {
    if (selectedOrderIds.size === 0) {
      toast({ title: "No orders selected", variant: "destructive" });
      return;
    }
    if (!confirm(`Mark ${selectedOrderIds.size} order(s) as paid?`)) {
      return;
    }
    bulkMarkPaidMutation.mutate(Array.from(selectedOrderIds));
  };

  const bulkDeleteOrdersMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const res = await fetch("/api/admin/orders/bulk-delete", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete orders");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedOrderIds(new Set());
      toast({ title: `${data.deleted} order(s) deleted successfully` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete orders", description: error.message, variant: "destructive" });
    },
  });

  const handleBulkDelete = () => {
    if (selectedOrderIds.size === 0) {
      toast({ title: "No orders selected", variant: "destructive" });
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete ${selectedOrderIds.size} order(s)? This action cannot be undone.`)) {
      return;
    }
    bulkDeleteOrdersMutation.mutate(Array.from(selectedOrderIds));
  };

  const reverseApprovalMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/admin/orders/${orderId}/reverse-approval`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reverse approval");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order approval reversed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reverse approval", description: error.message, variant: "destructive" });
    },
  });

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const toggleAllOrders = () => {
    if (!filteredOrders) return;
    const unpaidOrders = filteredOrders.filter((o: SalesOrder) => o.paymentStatus !== "PAID");
    if (selectedOrderIds.size === unpaidOrders.length) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(unpaidOrders.map((o: SalesOrder) => o.id)));
    }
  };

  const flagOrderMutation = useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason: string }) => {
      const res = await fetch(`/api/orders/${orderId}/flag`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to flag order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues/order-exceptions"] });
      setFlaggingOrder(null);
      setFlagReason("");
      toast({ title: "Order flagged", description: "Order has been sent to the exception queue" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to flag order", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateOrder = () => {
    if (!newOrderForm.customerName || !newOrderForm.dateSold) {
      toast({ title: "Missing required fields", description: "Customer name and date sold are required", variant: "destructive" });
      return;
    }
    if (isAdmin && !newOrderForm.repId) {
      toast({ title: "Missing required fields", description: "Rep ID is required", variant: "destructive" });
      return;
    }
    createOrderMutation.mutate(newOrderForm);
  };

  const filteredOrders = orders?.filter((order) => {
    const isMobile = (order as any).isMobileOrder === true;
    const isApproved = order.approvalStatus === "APPROVED";
    const isPaid = order.paymentStatus === "PAID";
    const isCompleted = order.jobStatus === "COMPLETED";
    const isUnapproved = order.approvalStatus === "UNAPPROVED";
    const isInApprovalQueue = isCompleted && isUnapproved;
    const isAdminOps = user?.role === "ADMIN" || user?.role === "OPERATIONS";
    
    let matchesTab = false;
    if (activeTab === "mobile") {
      // For ADMIN/OPS: mobile orders that aren't in approval queue/approved/paid pools
      // For others: all mobile orders
      matchesTab = isMobile && (isAdminOps ? !isApproved && !isPaid && !isInApprovalQueue : true);
    } else if (activeTab === "approval-queue") {
      // Only ADMIN/OPS can access this tab - completed but not yet approved
      matchesTab = isInApprovalQueue;
    } else if (activeTab === "approved") {
      // Only ADMIN/OPS can access this tab - approved but not paid
      matchesTab = isApproved && !isPaid;
    } else if (activeTab === "paid") {
      // Only ADMIN/OPS can access this tab - paid orders
      matchesTab = isPaid;
    } else {
      // Main orders tab: non-mobile
      // For ADMIN/OPS: exclude approval queue, approved and paid (they're in other pools)
      // For others: show all non-mobile orders
      matchesTab = !isMobile && (isAdminOps ? !isApproved && !isPaid && !isInApprovalQueue : true);
    }
    const matchesSearch =
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.repId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.accountNumber?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || order.jobStatus === statusFilter;
    const matchesProvider = providerFilter === "all" || order.providerId === providerFilter;
    const matchesClient = clientFilter === "all" || order.clientId === clientFilter;
    const dateField = dateFilterType === "installDate" ? order.installDate : order.dateSold;
    const orderDate = dateField?.split('T')[0] || dateField || "";
    const matchesDateFrom = !dateFromFilter || orderDate >= dateFromFilter;
    const matchesDateTo = !dateToFilter || orderDate <= dateToFilter;
    const matchesExport = exportFilter === "all" || 
      (exportFilter === "exported" && order.exportedToAccounting) ||
      (exportFilter === "unexported" && !order.exportedToAccounting) ||
      (exportFilter === "ready" && order.jobStatus === "COMPLETED" && !order.exportedToAccounting);
    const matchesApproval = approvalFilter === "all" || order.approvalStatus === approvalFilter;
    return matchesTab && matchesSearch && matchesStatus && matchesProvider && matchesClient && matchesDateFrom && matchesDateTo && matchesExport && matchesApproval;
  }).sort((a, b) => {
    const [field, direction] = sortBy.split("_");
    const multiplier = direction === "asc" ? 1 : -1;
    
    switch (field) {
      case "dateSold":
        return multiplier * (new Date(a.dateSold).getTime() - new Date(b.dateSold).getTime());
      case "customerName":
        return multiplier * a.customerName.localeCompare(b.customerName);
      case "repId":
        return multiplier * a.repId.localeCompare(b.repId);
      case "commission":
        return multiplier * (parseFloat(a.baseCommissionEarned) - parseFloat(b.baseCommissionEarned));
      case "createdAt":
        return multiplier * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "installDate":
        if (!a.installDate && !b.installDate) return 0;
        if (!a.installDate) return 1;
        if (!b.installDate) return -1;
        return multiplier * (new Date(a.installDate).getTime() - new Date(b.installDate).getTime());
      default:
        return 0;
    }
  });

  const columns = [
    ...((user?.role === "ADMIN" || user?.role === "OPERATIONS") ? [{
      key: "select",
      header: () => (
        <Checkbox
          checked={filteredOrders && filteredOrders.filter((o: SalesOrder) => o.paymentStatus !== "PAID").length > 0 && selectedOrderIds.size === filteredOrders.filter((o: SalesOrder) => o.paymentStatus !== "PAID").length}
          onCheckedChange={toggleAllOrders}
          data-testid="checkbox-select-all"
        />
      ),
      cell: (row: SalesOrder) => (
        row.paymentStatus !== "PAID" ? (
          <Checkbox
            checked={selectedOrderIds.has(row.id)}
            onCheckedChange={() => toggleOrderSelection(row.id)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`checkbox-select-order-${row.id}`}
          />
        ) : null
      ),
    }] : []),
    {
      key: "actions",
      header: "",
      cell: (row: SalesOrder) => (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setSelectedOrder(row)}
          data-testid={`button-view-order-${row.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-sm">{row.invoiceNumber || "-"}</span>
      ),
    },
    ...(user?.role !== "REP"
      ? [
          {
            key: "repId",
            header: "Rep ID",
            cell: (row: SalesOrder) => (
              <span className="font-mono text-sm">{row.repId}</span>
            ),
          },
        ]
      : []),
    {
      key: "customerName",
      header: "Customer Name",
      cell: (row: SalesOrder) => (
        <span className="font-medium truncate block max-w-[150px]">{row.customerName}</span>
      ),
    },
    {
      key: "accountNumber",
      header: "Account #",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-sm text-muted-foreground truncate block max-w-[100px]">
          {row.accountNumber || "-"}
        </span>
      ),
    },
    {
      key: "dateSold",
      header: "Date Sold",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {formatLocalDate(row.dateSold)}
        </span>
      ),
    },
    {
      key: "installDate",
      header: "Install Date",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {row.installDate ? formatLocalDate(row.installDate) : "-"}
        </span>
      ),
    },
    {
      key: "installType",
      header: "Install Type",
      cell: (row: SalesOrder) => {
        const typeLabels: Record<string, string> = {
          "AGENT_INSTALL": "Agent Install",
          "DIRECT_SHIP": "Direct Ship",
          "TECH_INSTALL": "Tech Install",
        };
        return (
          <span className="text-sm text-muted-foreground">
            {row.installType ? typeLabels[row.installType] || row.installType : "-"}
          </span>
        );
      },
    },
        ...(activeTab === "orders" ? [{
      key: "baseCommissionEarned",
      header: "Commission",
      cell: (row: SalesOrder) => {
        // baseCommissionEarned is stored as NET (after override already deducted)
        const netCommission = parseFloat(row.baseCommissionEarned) + parseFloat(row.incentiveEarned || "0");
        const overrideAmount = getOverrideAmount(row);
        // Gross = Net + Override (add back the deduction)
        const grossCommission = netCommission + overrideAmount;
        
        if (isAdminOrExec) {
          // Admin/Exec see Gross (before override)
          return (
            <span className="font-mono text-right block">
              ${grossCommission.toFixed(2)}
            </span>
          );
        }
        // Reps see Net (what they actually receive)
        return (
          <span className="font-mono text-right block">
            ${netCommission.toFixed(2)}
          </span>
        );
      },
      className: "text-right",
    }] : []),
    ...(activeTab === "orders" && isAdminOrExec ? [{
      key: "overrideAmount",
      header: "Override",
      cell: (row: SalesOrder) => {
        const amount = getOverrideAmount(row);
        return (
          <span className="font-mono text-right block text-muted-foreground">
            ${amount.toFixed(2)}
          </span>
        );
      },
      className: "text-right",
    }] : []),
    ...(activeTab === "mobile" ? [{
      key: "mobileLinesQty",
      header: "Lines",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-right block">
          {(row as any).mobileLinesQty || 0}
        </span>
      ),
      className: "text-right",
    }] : []),
    ...(activeTab === "mobile" ? [{
      key: "mobileCommission",
      header: "Mobile Commission",
      cell: (row: SalesOrder) => {
        const mobileCommission = parseFloat((row as any).mobileCommissionTotal || "0");
        if (isAdminOrExec) {
          return (
            <span className="font-mono text-right block">
              ${mobileCommission.toFixed(2)}
            </span>
          );
        }
        const mobileOverride = parseFloat((row as any).mobileOverrideDeduction || "0");
        const netCommission = mobileCommission - mobileOverride;
        return (
          <span className="font-mono text-right block">
            ${netCommission.toFixed(2)}
          </span>
        );
      },
      className: "text-right",
    }] : []),
    ...(activeTab === "mobile" && isAdminOrExec ? [{
      key: "mobileOverride",
      header: "Mobile Override",
      cell: (row: SalesOrder) => {
        const amount = parseFloat((row as any).mobileOverrideDeduction || "0");
        return (
          <span className="font-mono text-right block text-muted-foreground">
            ${amount.toFixed(2)}
          </span>
        );
      },
      className: "text-right",
    }] : []),
    ...(isAdminOrExec ? [{
      key: "totalCommission",
      header: "Total",
      cell: (row: SalesOrder) => {
        const gross = activeTab === "mobile"
          ? parseFloat((row as any).mobileCommissionTotal || "0")
          : parseFloat(row.baseCommissionEarned) + parseFloat(row.incentiveEarned || "0");
        const override = activeTab === "mobile" 
          ? parseFloat((row as any).mobileOverrideDeduction || "0")
          : getOverrideAmount(row);
        const total = gross + override;
        return (
          <span className="font-mono text-right block font-semibold text-green-600">
            ${total.toFixed(2)}
          </span>
        );
      },
      className: "text-right",
    }] : []),
    {
      key: "provider",
      header: "Provider",
      cell: (row: SalesOrder) => {
        const provider = providers?.find(p => p.id === row.providerId);
        return <span className="text-sm truncate block max-w-[100px]">{provider?.name || "-"}</span>;
      },
    },
    {
      key: "jobStatus",
      header: "Job",
      cell: (row: SalesOrder) => <JobStatusBadge status={row.jobStatus} />,
    },
    // Payment status only visible to ADMIN and OPERATIONS
    ...((user?.role === "ADMIN" || user?.role === "OPERATIONS") ? [{
      key: "paymentStatus",
      header: "Payment",
      cell: (row: SalesOrder) => <PaymentStatusBadge status={row.paymentStatus} />,
    }] : []),
    // Approval status column
    {
      key: "approvalStatus",
      header: "Approval",
      cell: (row: SalesOrder) => <ApprovalStatusBadge status={row.approvalStatus} />,
    },
    {
      key: "flag",
      header: "",
      cell: (row: SalesOrder) => (
        <Button
          size="icon"
          variant="ghost"
          className="text-orange-500 hover:text-orange-600"
          onClick={(e) => { e.stopPropagation(); setFlaggingOrder(row); }}
          data-testid={`button-flag-order-${row.id}`}
        >
          <Flag className="h-4 w-4" />
        </Button>
      ),
    },
    ...((user?.role === "OPERATIONS" || isAdminOrExec) ? [{
      key: "delete",
      header: "",
      cell: (row: SalesOrder) => (
        (user?.role === "OPERATIONS" || row.jobStatus !== "COMPLETED") ? (
          <Button
            size="icon"
            variant="ghost"
            className="text-destructive"
            onClick={() => handleDeleteOrder(row.id)}
            data-testid={`button-delete-order-${row.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null
      ),
    }] : []),
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Orders</h1>
            <p className="text-muted-foreground">
              {user?.role === "REP" ? "Your orders" : user?.role === "MANAGER" ? "Team orders" : 
               isExecutive ? (execViewMode === "own" ? "My orders" : execViewMode === "team" ? "Team orders" : "All orders") : "All orders"}
            </p>
          </div>
          {isExecutive && (
            <div className="flex items-center gap-1 border rounded-md p-1" data-testid="exec-view-toggle">
              <Button
                size="sm"
                variant={execViewMode === "own" ? "default" : "ghost"}
                onClick={() => setExecViewMode("own")}
                data-testid="button-view-own"
              >
                My Sales
              </Button>
              <Button
                size="sm"
                variant={execViewMode === "team" ? "default" : "ghost"}
                onClick={() => setExecViewMode("team")}
                data-testid="button-view-team"
              >
                My Team
              </Button>
              <Button
                size="sm"
                variant={execViewMode === "global" ? "default" : "ghost"}
                onClick={() => setExecViewMode("global")}
                data-testid="button-view-global"
              >
                Global
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(user?.role === "ADMIN" || user?.role === "OPERATIONS") && selectedOrderIds.size > 0 && (
            <>
              <Button 
                variant="default"
                onClick={handleBulkMarkPaid}
                disabled={bulkMarkPaidMutation.isPending}
                data-testid="button-bulk-mark-paid"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Mark {selectedOrderIds.size} as Paid
              </Button>
              <Button 
                variant="default"
                onClick={() => bulkApproveOrdersMutation.mutate(Array.from(selectedOrderIds))}
                disabled={bulkApproveOrdersMutation.isPending}
                data-testid="button-bulk-approve"
              >
                <ThumbsUp className="h-4 w-4 mr-2" />
                Approve {selectedOrderIds.size}
              </Button>
              {user?.role === "OPERATIONS" && (
                <Button 
                  variant="destructive"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleteOrdersMutation.isPending}
                  data-testid="button-bulk-delete"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete {selectedOrderIds.size}
                </Button>
              )}
            </>
          )}
          {isAdmin && (
            <>
              <Button variant="outline" onClick={() => setShowImportDialog(true)} data-testid="button-import-orders">
                <Upload className="h-4 w-4 mr-2" />
                Import Excel
              </Button>
              <Button 
                variant="default" 
                onClick={handleExportToExcel}
                data-testid="button-export-to-excel"
              >
                <Download className="h-4 w-4 mr-2" />
                Export to Excel
              </Button>
            </>
          )}
          <Button onClick={() => setShowNewOrderDialog(true)} data-testid="button-new-order">
            <Plus className="h-4 w-4 mr-2" />
            New Order
          </Button>
          <Button variant="outline" onClick={() => setShowMobileOrderDialog(true)} data-testid="button-mobile-entry">
            <Smartphone className="h-4 w-4 mr-2" />
            Mobile Entry
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "orders" | "mobile" | "approval-queue" | "approved" | "paid")}>
        <TabsList>
          <TabsTrigger value="orders" data-testid="tab-my-orders">
            {user?.role === "REP" ? "My Orders" : user?.role === "MANAGER" ? "Team Orders" : "All Orders"}
            {orders && (
              <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-muted">
                {orders.filter(o => {
                  const notMobile = !(o as any).isMobileOrder;
                  const isAdminOps = user?.role === "ADMIN" || user?.role === "OPERATIONS";
                  return notMobile && (isAdminOps ? o.approvalStatus !== "APPROVED" && o.paymentStatus !== "PAID" && !(o.jobStatus === "COMPLETED" && o.approvalStatus === "UNAPPROVED") : true);
                }).length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="mobile" data-testid="tab-mobile-orders">
            <Smartphone className="h-4 w-4 mr-1" />
            Mobile Orders
            {orders && (
              <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-muted">
                {orders.filter(o => {
                  const isMobile = (o as any).isMobileOrder === true;
                  const isAdminOps = user?.role === "ADMIN" || user?.role === "OPERATIONS";
                  return isMobile && (isAdminOps ? o.approvalStatus !== "APPROVED" && o.paymentStatus !== "PAID" && !(o.jobStatus === "COMPLETED" && o.approvalStatus === "UNAPPROVED") : true);
                }).length}
              </span>
            )}
          </TabsTrigger>
          {(user?.role === "ADMIN" || user?.role === "OPERATIONS") && (
            <>
              <TabsTrigger value="approval-queue" data-testid="tab-approval-queue">
                <ThumbsUp className="h-4 w-4 mr-1" />
                Approval Queue
                {orders && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                    {orders.filter(o => o.jobStatus === "COMPLETED" && o.approvalStatus === "UNAPPROVED").length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved" data-testid="tab-approved-pool">
                <CheckCircle className="h-4 w-4 mr-1" />
                Approved Pool
                {orders && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-muted">
                    {orders.filter(o => o.approvalStatus === "APPROVED" && o.paymentStatus !== "PAID").length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="paid" data-testid="tab-paid-pool">
                <DollarSign className="h-4 w-4 mr-1" />
                Paid Pool
                {orders && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-muted">
                    {orders.filter(o => o.paymentStatus === "PAID").length}
                  </span>
                )}
              </TabsTrigger>
            </>
          )}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-orders"
              />
            </div>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-[140px]" data-testid="select-provider-filter">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                {providers?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[130px]" data-testid="select-client-filter">
                <SelectValue placeholder="Client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clients?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                <SelectValue placeholder="Job Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Job Status</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELED">Canceled</SelectItem>
              </SelectContent>
            </Select>
                        <div className="flex items-center gap-2">
              <Select value={dateFilterType} onValueChange={setDateFilterType}>
                <SelectTrigger className="w-[130px]" data-testid="select-date-filter-type">
                  <SelectValue placeholder="Date Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="installDate">Install Date</SelectItem>
                  <SelectItem value="dateSold">Date Sold</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFromFilter}
                onChange={(e) => setDateFromFilter(e.target.value)}
                className="w-[140px]"
                placeholder="From"
                data-testid="input-date-from"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateToFilter}
                onChange={(e) => setDateToFilter(e.target.value)}
                className="w-[140px]"
                placeholder="To"
                data-testid="input-date-to"
              />
            </div>
            {isAdmin && (
              <Select value={exportFilter} onValueChange={setExportFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-export-filter">
                  <SelectValue placeholder="Export status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Export Status</SelectItem>
                  <SelectItem value="ready">Ready to Export</SelectItem>
                  <SelectItem value="unexported">Not Exported</SelectItem>
                  <SelectItem value="exported">Exported</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={approvalFilter} onValueChange={setApprovalFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-approval-filter">
                <SelectValue placeholder="Approval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Approval</SelectItem>
                <SelectItem value="UNAPPROVED">Pending Approval</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[180px]" data-testid="select-sort-orders">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="repId_asc">Rep ID (A-Z)</SelectItem>
                <SelectItem value="repId_desc">Rep ID (Z-A)</SelectItem>
                <SelectItem value="dateSold_desc">Date Sold (Newest)</SelectItem>
                <SelectItem value="dateSold_asc">Date Sold (Oldest)</SelectItem>
                <SelectItem value="customerName_asc">Customer (A-Z)</SelectItem>
                <SelectItem value="customerName_desc">Customer (Z-A)</SelectItem>
                <SelectItem value="commission_desc">Commission (High-Low)</SelectItem>
                <SelectItem value="commission_asc">Commission (Low-High)</SelectItem>
                <SelectItem value="installDate_desc">Install Date (Newest)</SelectItem>
                <SelectItem value="installDate_asc">Install Date (Oldest)</SelectItem>
                <SelectItem value="createdAt_desc">Created (Newest)</SelectItem>
                <SelectItem value="createdAt_asc">Created (Oldest)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredOrders || []}
            isLoading={isLoading}
            emptyMessage="No orders found"
            testId="table-orders"
          />
        </CardContent>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
            <DialogDescription>
              {selectedOrder?.invoiceNumber || `Order ${selectedOrder?.id?.slice(0, 8)}`}
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Customer</Label>
                  {isOperations ? (
                    <Input
                      defaultValue={selectedOrder.customerName}
                      onBlur={(e) => {
                        if (e.target.value !== selectedOrder.customerName) {
                          updateJobStatusMutation.mutate({ orderId: selectedOrder.id, customerName: e.target.value });
                        }
                      }}
                      className="w-[180px]"
                      data-testid="input-order-customer-name"
                    />
                  ) : (
                    <p className="font-medium">{selectedOrder.customerName}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  {isOperations ? (
                    <Input
                      defaultValue={selectedOrder.customerEmail || ""}
                      onBlur={(e) => {
                        if (e.target.value !== (selectedOrder.customerEmail || "")) {
                          updateJobStatusMutation.mutate({ orderId: selectedOrder.id, customerEmail: e.target.value });
                        }
                      }}
                      className="w-[180px]"
                      data-testid="input-order-customer-email"
                    />
                  ) : (
                    <p className="text-sm">{selectedOrder.customerEmail || "-"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  {isOperations ? (
                    <Input
                      defaultValue={selectedOrder.customerPhone || ""}
                      onBlur={(e) => {
                        if (e.target.value !== (selectedOrder.customerPhone || "")) {
                          updateJobStatusMutation.mutate({ orderId: selectedOrder.id, customerPhone: e.target.value });
                        }
                      }}
                      className="w-[180px]"
                      data-testid="input-order-customer-phone"
                    />
                  ) : (
                    <p className="text-sm">{selectedOrder.customerPhone || "-"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Rep ID (Sales ID)</Label>
                  {isAdminOrExec ? (
                    <Select
                      value={selectedOrder.repId}
                      onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, repId: value })}
                      disabled={updateJobStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-[180px]" data-testid="select-order-rep">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {reps?.map((rep) => (
                          <SelectItem key={rep.id} value={rep.repId}>{rep.name} ({rep.repId})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-mono">{selectedOrder.repId}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Client</Label>
                  {isOperations ? (
                    <Select
                      value={selectedOrder.clientId || ""}
                      onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, clientId: value })}
                      disabled={updateJobStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-[180px]" data-testid="select-order-client">
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients?.map((client) => (
                          <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-medium">{clients?.find(c => c.id === selectedOrder.clientId)?.name || "-"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Provider</Label>
                  {isOperations ? (
                    <Select
                      value={selectedOrder.providerId || ""}
                      onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, providerId: value })}
                      disabled={updateJobStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-[180px]" data-testid="select-order-provider">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providers?.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-medium">{providers?.find(p => p.id === selectedOrder.providerId)?.name || "-"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Service</Label>
                  {isOperations ? (
                    <Select
                      value={selectedOrder.serviceId || ""}
                      onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, serviceId: value })}
                      disabled={updateJobStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-[180px]" data-testid="select-order-service">
                        <SelectValue placeholder="Select service" />
                      </SelectTrigger>
                      <SelectContent>
                        {services?.map((service) => (
                          <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="font-medium">{services?.find(s => s.id === selectedOrder.serviceId)?.name || "-"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">TV Sold</Label>
                  <div className="flex items-center gap-2 mt-1">
                    {isOperations ? (
                      <>
                        <Switch
                          id="detail-tv-sold"
                          checked={selectedOrder.tvSold || false}
                          onCheckedChange={(checked) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, tvSold: checked })}
                          disabled={updateJobStatusMutation.isPending}
                          data-testid="switch-tv-sold"
                        />
                        <Label htmlFor="detail-tv-sold" className="text-sm cursor-pointer">
                          {selectedOrder.tvSold ? "Yes" : "No"}
                        </Label>
                      </>
                    ) : (
                      <p className="font-medium">{selectedOrder.tvSold ? "Yes" : "No"}</p>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Mobile Sold</Label>
                  <div className="flex items-center gap-2 mt-1">
                    {isOperations ? (
                      <>
                        <Switch
                          id="detail-mobile-sold"
                          checked={selectedOrder.mobileSold || false}
                          onCheckedChange={(checked) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, mobileSold: checked })}
                          disabled={updateJobStatusMutation.isPending}
                          data-testid="switch-mobile-sold"
                        />
                        <Label htmlFor="detail-mobile-sold" className="text-sm cursor-pointer">
                          {selectedOrder.mobileSold ? "Yes" : "No"}
                        </Label>
                      </>
                    ) : (
                      <p className="font-medium">{selectedOrder.mobileSold ? "Yes" : "No"}</p>
                    )}
                  </div>
                </div>
                {selectedOrder.mobileSold && (
                  <div>
                    <Label className="text-muted-foreground">Mobile Type</Label>
                    {isOperations ? (
                      <Select
                        value={selectedOrder.mobileProductType || ""}
                        onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, mobileProductType: value })}
                        disabled={updateJobStatusMutation.isPending}
                      >
                        <SelectTrigger className="w-[140px]" data-testid="select-mobile-product-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UNLIMITED">Unlimited</SelectItem>
                          <SelectItem value="3_GIG">3 Gig</SelectItem>
                          <SelectItem value="1_GIG">1 Gig</SelectItem>
                          <SelectItem value="BYOD">BYOD</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="font-medium">
                        {selectedOrder.mobileProductType === "UNLIMITED" ? "Unlimited" :
                         selectedOrder.mobileProductType === "3_GIG" ? "3 Gig" :
                         selectedOrder.mobileProductType === "1_GIG" ? "1 Gig" :
                         selectedOrder.mobileProductType === "BYOD" ? "BYOD" : "-"}
                      </p>
                    )}
                  </div>
                )}
                <div>
                  <Label className="text-muted-foreground">Account Number</Label>
                  {isOperations ? (
                    <Input
                      defaultValue={selectedOrder.accountNumber || ""}
                      onBlur={(e) => {
                        if (e.target.value !== (selectedOrder.accountNumber || "")) {
                          updateJobStatusMutation.mutate({ orderId: selectedOrder.id, accountNumber: e.target.value });
                        }
                      }}
                      className="w-[180px] font-mono"
                      data-testid="input-order-account-number"
                    />
                  ) : (
                    <p className="font-mono">{selectedOrder.accountNumber || "-"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Address</Label>
                  {isOperations ? (
                    <Input
                      defaultValue={selectedOrder.customerAddress || ""}
                      onBlur={(e) => {
                        if (e.target.value !== (selectedOrder.customerAddress || "")) {
                          updateJobStatusMutation.mutate({ orderId: selectedOrder.id, customerAddress: e.target.value });
                        }
                      }}
                      className="w-[180px]"
                      data-testid="input-order-customer-address"
                    />
                  ) : (
                    <p className="text-sm">{selectedOrder.customerAddress || "-"}</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Date Sold</Label>
                  <p>{formatLocalDate(selectedOrder.dateSold)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Created At</Label>
                  <p className="text-sm">
                    {selectedOrder.createdAt ? new Date(selectedOrder.createdAt).toLocaleString() : "-"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Install Date</Label>
                  <div className="mt-1">
                    <Input
                      type="date"
                      value={selectedOrder.installDate || ""}
                      onChange={(e) => {
                        updateJobStatusMutation.mutate({ orderId: selectedOrder.id, jobStatus: selectedOrder.jobStatus, installDate: e.target.value });
                      }}
                      className="w-[160px]"
                      data-testid="input-install-date"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Install Time</Label>
                  <div className="mt-1">
                    <Select
                      value={selectedOrder.installTime || ""}
                      onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, installTime: value })}
                      disabled={updateJobStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-[140px]" data-testid="select-detail-install-time">
                        <SelectValue placeholder="Select time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="8-11am">8-11am</SelectItem>
                        <SelectItem value="11-2pm">11-2pm</SelectItem>
                        <SelectItem value="2-5pm">2-5pm</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Install Type</Label>
                  <div className="mt-1">
                    <Select
                      value={selectedOrder.installType || ""}
                      onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, installType: value })}
                      disabled={updateJobStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-[160px]" data-testid="select-detail-install-type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AGENT_INSTALL">Agent Install</SelectItem>
                        <SelectItem value="DIRECT_SHIP">Direct Ship</SelectItem>
                        <SelectItem value="TECH_INSTALL">Tech Install</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Job Status</Label>
                  <div className="mt-1">
                    <Select
                      value={selectedOrder.jobStatus}
                      onValueChange={(value) => updateJobStatusMutation.mutate({ orderId: selectedOrder.id, jobStatus: value })}
                      disabled={updateJobStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-[140px]" data-testid="select-job-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PENDING">Pending</SelectItem>
                        <SelectItem value="COMPLETED">Completed</SelectItem>
                        <SelectItem value="CANCELED">Canceled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                              </div>
              <div className="border-t pt-4">
                <Label className="text-muted-foreground">Service Breakdown</Label>
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between gap-2">
                    <span>{services?.find(s => s.id === selectedOrder.serviceId)?.name || "Internet Service"}</span>
                    <span className="font-mono text-muted-foreground">Included</span>
                  </div>
                  {selectedOrder.tvSold && (
                    <div className="flex justify-between gap-2">
                      <span>TV Addon</span>
                      <span className="font-mono text-muted-foreground">Included</span>
                    </div>
                  )}
                  {selectedOrder.mobileSold && selectedOrder.mobileLinesQty > 0 && (
                    <div className="flex justify-between gap-2">
                      <span>Mobile Lines ({selectedOrder.mobileLinesQty})</span>
                      <span className="font-mono text-muted-foreground">Included</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t pt-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Label className="text-muted-foreground">Commission Breakdown</Label>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => recalculateCommissionMutation.mutate(selectedOrder.id)}
                      disabled={recalculateCommissionMutation.isPending}
                      data-testid="button-recalculate-commission"
                    >
                      {recalculateCommissionMutation.isPending ? "Recalculating..." : "Recalculate"}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {(() => {
                    // Executives are exempt from override deductions
                    const orderRepRole = reps?.find(r => r.repId === selectedOrder.repId)?.role;
                    const isExecutiveSale = orderRepRole === "EXECUTIVE";
                    
                    // Get the applied rate card to determine per-category deductions
                    const appliedRateCard = rateCards?.find(rc => rc.id === selectedOrder.appliedRateCardId);
                    const baseDeduction = isExecutiveSale ? 0 : parseFloat(appliedRateCard?.overrideDeduction || "0");
                    const tvDeduction = isExecutiveSale ? 0 : parseFloat(appliedRateCard?.tvOverrideDeduction || "0");
                    const mobileDeductionTotal = isExecutiveSale ? 0 : parseFloat((appliedRateCard as any)?.mobileOverrideDeduction || "0");
                    
                    // Count mobile lines for distributing mobile deduction
                    const mobileLines = commissionLines?.filter(l => l.serviceCategory === "MOBILE") || [];
                    const mobileLineCount = mobileLines.length;
                    
                    // Track deductions applied (each category only once, except mobile which is per-line)
                    let baseDeductionApplied = false;
                    let tvDeductionApplied = false;
                    
                    // Calculate net for each line using category-specific deductions
                    const getNetAmount = (line: CommissionLineItem): number => {
                      const grossAmount = parseFloat(line.totalAmount);
                      if (line.serviceCategory === "INTERNET" && !baseDeductionApplied) {
                        baseDeductionApplied = true;
                        return Math.max(0, grossAmount - baseDeduction);
                      }
                      if (line.serviceCategory === "VIDEO" && !tvDeductionApplied) {
                        tvDeductionApplied = true;
                        return Math.max(0, grossAmount - tvDeduction);
                      }
                      if (line.serviceCategory === "MOBILE") {
                        // Mobile deduction split across all mobile lines
                        const perLineDeduction = mobileLineCount > 0 ? mobileDeductionTotal / mobileLineCount : 0;
                        return Math.max(0, grossAmount - perLineDeduction);
                      }
                      return grossAmount;
                    };
                    
                    return (
                      <>
                        {commissionLines && commissionLines.length > 0 ? (
                          <>
                            {commissionLines.map((line, idx) => {
                              const categoryLabels: Record<string, string> = {
                                "INTERNET": "Internet",
                                "MOBILE": "Mobile",
                                "VIDEO": "Video (TV)"
                              };
                              const label = categoryLabels[line.serviceCategory] || line.serviceCategory;
                              const detail = line.serviceCategory === "MOBILE" && line.quantity > 1 
                                ? ` (${line.quantity} lines)` 
                                : line.serviceCategory === "MOBILE" && line.mobileProductType
                                  ? ` (${line.mobileProductType.replace("_", " ")})`
                                  : "";
                              const netAmount = getNetAmount(line);
                              return (
                                <div key={idx} className="flex justify-between gap-2">
                                  <span>{label}{detail}</span>
                                  <span className="font-mono">${netAmount.toFixed(2)}</span>
                                </div>
                              );
                            })}
                          </>
                        ) : (
                          <div className="flex justify-between gap-2">
                            <span>Base Commission</span>
                            <span className="font-mono">${parseFloat(selectedOrder.baseCommissionEarned).toFixed(2)}</span>
                          </div>
                        )}
                        {parseFloat(selectedOrder.incentiveEarned) > 0 && (
                          <div className="flex justify-between gap-2">
                            <span>Incentives</span>
                            <span className="font-mono">${parseFloat(selectedOrder.incentiveEarned).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between gap-2 border-t pt-2 font-semibold">
                          <span>Total Earned</span>
                          <span className="font-mono">
                            {(() => {
                              // baseCommissionEarned is stored as NET (after override already deducted)
                              const net = parseFloat(selectedOrder.baseCommissionEarned) + parseFloat(selectedOrder.incentiveEarned);
                              const overrideAmt = getOverrideAmount(selectedOrder);
                              const gross = net + overrideAmt;
                              // Admin/Exec see gross, REPs see net
                              if (isAdminOrExec) {
                                return `$${gross.toFixed(2)}`;
                              }
                              return `$${net.toFixed(2)}`;
                            })()}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            {/* Approve/Reject buttons for ADMIN, OPERATIONS, EXECUTIVE */}
            {isAdmin && selectedOrder && selectedOrder.approvalStatus === "UNAPPROVED" && (
              <>
                <Button 
                  variant="default"
                  onClick={() => approveOrderMutation.mutate(selectedOrder.id)}
                  disabled={approveOrderMutation.isPending}
                  data-testid="button-approve-order"
                >
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  {approveOrderMutation.isPending ? "Approving..." : "Approve"}
                </Button>
                <Button 
                  variant="destructive"
                  onClick={() => handleRejectOrder(selectedOrder)}
                  disabled={rejectOrderMutation.isPending}
                  data-testid="button-reject-order"
                >
                  <ThumbsDown className="h-4 w-4 mr-2" />
                  Reject
                </Button>
              </>
            )}
            {/* Show approval status if already approved/rejected */}
            {selectedOrder && selectedOrder.approvalStatus !== "UNAPPROVED" && (
              <div className="flex items-center gap-2 mr-auto">
                <ApprovalStatusBadge status={selectedOrder.approvalStatus} />
                {selectedOrder.rejectionNote && (
                  <span className="text-sm text-muted-foreground">
                    Reason: {selectedOrder.rejectionNote}
                  </span>
                )}
              </div>
            )}
            {/* Reverse Approval - for ADMIN/OPERATIONS/EXECUTIVE on approved orders */}
            {isAdmin && selectedOrder && selectedOrder.approvalStatus === "APPROVED" && (
              <Button 
                variant="outline"
                onClick={() => {
                  if (confirm("Are you sure you want to reverse this approval? The order will be set back to Pending status.")) {
                    reverseApprovalMutation.mutate(selectedOrder.id);
                  }
                }}
                disabled={reverseApprovalMutation.isPending}
                data-testid="button-reverse-approval"
              >
                <ThumbsDown className="h-4 w-4 mr-2" />
                {reverseApprovalMutation.isPending ? "Reversing..." : "Reverse Approval"}
              </Button>
            )}
            {/* Mark as Paid only visible to ADMIN and OPERATIONS */}
            {(user?.role === "ADMIN" || user?.role === "OPERATIONS") && selectedOrder && selectedOrder.paymentStatus !== "PAID" && (
              <Button 
                onClick={() => markPaidMutation.mutate(selectedOrder.id)}
                disabled={markPaidMutation.isPending}
                data-testid="button-mark-paid"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                {markPaidMutation.isPending ? "Marking..." : "Mark as Paid"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setSelectedOrder(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewOrderDialog} onOpenChange={(open) => { setShowNewOrderDialog(open); if (!open) resetNewOrderForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-visible flex flex-col">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
            <DialogDescription>Enter the order details below</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isAdmin && (
                <div className="space-y-2">
                  <Label>Assign To *</Label>
                  {isTouchDevice ? (
                    <NativeSelect
                      value={newOrderForm.repId}
                      onValueChange={(v) => setNewOrderForm(f => ({ ...f, repId: v }))}
                      placeholder="Select user"
                      options={reps?.map((rep) => ({
                        value: rep.repId,
                        label: `${rep.name} (${rep.repId}) - ${rep.role}`
                      })) || []}
                      data-testid="select-rep"
                    />
                  ) : (
                    <Select value={newOrderForm.repId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, repId: v }))}>
                      <SelectTrigger data-testid="select-rep">
                        <SelectValue placeholder="Select user" />
                      </SelectTrigger>
                      <SelectContent>
                        {reps?.map((rep) => (
                          <SelectItem key={rep.id} value={rep.repId}>{rep.name} ({rep.repId}) - {rep.role}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label>Client</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.clientId}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, clientId: v, serviceId: "" }))}
                    placeholder="Select client"
                    options={(clients || []).map((client) => ({
                      value: client.id,
                      label: client.name
                    }))}
                    data-testid="select-client"
                  />
                ) : (
                  <Select value={newOrderForm.clientId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, clientId: v, serviceId: "" }))}>
                    <SelectTrigger data-testid="select-client">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {(clients || []).map((client) => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.providerId}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, providerId: v, serviceId: "" }))}
                    placeholder="Select provider"
                    options={(providers || []).map((provider) => ({
                      value: provider.id,
                      label: provider.name
                    }))}
                    data-testid="select-provider"
                  />
                ) : (
                  <Select value={newOrderForm.providerId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, providerId: v, serviceId: "" }))}>
                    <SelectTrigger data-testid="select-provider">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {(providers || []).map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Date Sold *</Label>
                <Input 
                  type="date" 
                  value={newOrderForm.dateSold}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, dateSold: e.target.value }))}
                  data-testid="input-date-sold" 
                />
              </div>
              <div className="space-y-2">
                <Label>Install Date</Label>
                <Input 
                  type="date" 
                  value={newOrderForm.installDate}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, installDate: e.target.value }))}
                  data-testid="input-install-date" 
                />
              </div>
              <div className="space-y-2">
                <Label>Install Time</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.installTime}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, installTime: v }))}
                    placeholder="Select time window"
                    options={[
                      { value: "8-11am", label: "8-11am" },
                      { value: "11-2pm", label: "11-2pm" },
                      { value: "2-5pm", label: "2-5pm" },
                    ]}
                    data-testid="select-install-time"
                  />
                ) : (
                  <Select value={newOrderForm.installTime} onValueChange={(v) => setNewOrderForm(f => ({ ...f, installTime: v }))}>
                    <SelectTrigger data-testid="select-install-time">
                      <SelectValue placeholder="Select time window" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="8-11am">8-11am</SelectItem>
                      <SelectItem value="11-2pm">11-2pm</SelectItem>
                      <SelectItem value="2-5pm">2-5pm</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Install Type</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.installType}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, installType: v }))}
                    placeholder="Select install type"
                    options={[
                      { value: "AGENT_INSTALL", label: "Agent Install" },
                      { value: "DIRECT_SHIP", label: "Direct Ship" },
                      { value: "TECH_INSTALL", label: "Tech Install" },
                    ]}
                    data-testid="select-install-type"
                  />
                ) : (
                  <Select value={newOrderForm.installType} onValueChange={(v) => setNewOrderForm(f => ({ ...f, installType: v }))}>
                    <SelectTrigger data-testid="select-install-type">
                      <SelectValue placeholder="Select install type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AGENT_INSTALL">Agent Install</SelectItem>
                      <SelectItem value="DIRECT_SHIP">Direct Ship</SelectItem>
                      <SelectItem value="TECH_INSTALL">Tech Install</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input 
                  placeholder="Enter account number" 
                  value={newOrderForm.accountNumber}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, accountNumber: e.target.value }))}
                  data-testid="input-account-number" 
                />
              </div>
              <div className="space-y-2">
                <Label>Service</Label>
                {!newOrderForm.clientId || !newOrderForm.providerId ? (
                  <p className="text-sm text-muted-foreground">Select client and provider first</p>
                ) : isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.serviceId}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, serviceId: v }))}
                    placeholder="Select service"
                    options={(availableServices || []).map((service) => ({
                      value: service.id,
                      label: service.name
                    }))}
                    data-testid="select-service"
                  />
                ) : (
                  <Select value={newOrderForm.serviceId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, serviceId: v }))}>
                    <SelectTrigger data-testid="select-service">
                      <SelectValue placeholder={availableServices?.length ? "Select service" : "No services available"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(availableServices || []).map((service) => (
                        <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Customer Name *</Label>
                <Input 
                  placeholder="Enter customer name" 
                  value={newOrderForm.customerName}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, customerName: e.target.value }))}
                  data-testid="input-customer-name" 
                />
              </div>
              <div className="space-y-2">
                <Label>Customer Phone</Label>
                <Input 
                  placeholder="Enter phone number" 
                  value={newOrderForm.customerPhone}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, customerPhone: e.target.value }))}
                  data-testid="input-customer-phone" 
                />
              </div>
              <div className="space-y-2">
                <Label>Customer Email</Label>
                <Input 
                  placeholder="Enter email address" 
                  value={newOrderForm.customerEmail}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, customerEmail: e.target.value }))}
                  data-testid="input-customer-email" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Customer Address</Label>
              <Textarea 
                placeholder="Enter customer address" 
                value={newOrderForm.customerAddress}
                onChange={(e) => setNewOrderForm(f => ({ ...f, customerAddress: e.target.value }))}
                data-testid="input-customer-address" 
              />
            </div>
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="hasTv" 
                  checked={newOrderForm.hasTv}
                  onCheckedChange={(checked) => setNewOrderForm(f => ({ ...f, hasTv: !!checked }))}
                  data-testid="checkbox-has-tv"
                />
                <Label htmlFor="hasTv" className="cursor-pointer">Video (TV)</Label>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setShowNewOrderDialog(false); resetNewOrderForm(); }}>
              Cancel
            </Button>
            <Button 
              variant="secondary"
              onClick={submitOrderThenOpenMobile}
              disabled={!newOrderForm.customerName || !newOrderForm.dateSold || createOrderMutation.isPending}
              data-testid="button-add-mobile-order"
            >
              <Smartphone className="h-4 w-4 mr-2" />
              {createOrderMutation.isPending ? "Creating..." : "Create & Add Mobile"}
            </Button>
            <Button 
              onClick={handleCreateOrder} 
              disabled={createOrderMutation.isPending}
              data-testid="button-submit-order"
            >
              {createOrderMutation.isPending ? "Creating..." : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportDialog} onOpenChange={closeImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Orders from Excel
            </DialogTitle>
            <DialogDescription>
              Upload an Excel file (.xlsx, .xls) with order data. Required columns: repId, customerName, dateSold.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="excel-file-input"
                data-testid="input-import-file"
              />
              <label
                htmlFor="excel-file-input"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {importFile ? importFile.name : "Click to select Excel file"}
                </span>
              </label>
            </div>
            
            {importResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  {importResult.success > 0 && (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      <span>{importResult.success} imported</span>
                    </div>
                  )}
                  {importResult.failed > 0 && (
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      <span>{importResult.failed} failed</span>
                    </div>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div className="max-h-32 overflow-y-auto bg-muted p-2 rounded text-xs space-y-1">
                    {importResult.errors.slice(0, 10).map((err, i) => (
                      <div key={i} className="text-red-600">{err}</div>
                    ))}
                    {importResult.errors.length > 10 && (
                      <div className="text-muted-foreground">...and {importResult.errors.length - 10} more errors</div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">Expected columns:</p>
              <p>repId, customerName, customerAddress, accountNumber, dateSold, installDate, providerId, clientId, serviceId, invoiceNumber, tvSold, mobileSold, mobileLinesQty</p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={closeImportDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!importFile || isImporting}
              data-testid="button-confirm-import"
            >
              {isImporting ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!flaggingOrder} onOpenChange={() => { setFlaggingOrder(null); setFlagReason(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-orange-500" />
              Flag Order for Review
            </DialogTitle>
            <DialogDescription>
              This order will be sent to the exception queue for review. Please provide a reason.
            </DialogDescription>
          </DialogHeader>
          
          {flaggingOrder && (
            <div className="bg-muted p-3 rounded-md text-sm space-y-1">
              <p><span className="font-medium">Customer:</span> {flaggingOrder.customerName}</p>
              <p><span className="font-medium">Invoice:</span> {flaggingOrder.invoiceNumber || "N/A"}</p>
              <p><span className="font-medium">Rep ID:</span> {flaggingOrder.repId}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Reason for flagging *</Label>
            <Textarea
              placeholder="Describe why this order needs review..."
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              data-testid="input-flag-reason"
            />
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFlaggingOrder(null); setFlagReason(""); }}>
              Cancel
            </Button>
            <Button
              onClick={() => flaggingOrder && flagOrderMutation.mutate({ orderId: flaggingOrder.id, reason: flagReason })}
              disabled={!flagReason.trim() || flagOrderMutation.isPending}
              data-testid="button-confirm-flag"
            >
              {flagOrderMutation.isPending ? "Flagging..." : "Flag Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMobileOrderDialog} onOpenChange={(open) => { setShowMobileOrderDialog(open); if (!open) resetMobileOrderForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Create Mobile Order
            </DialogTitle>
            <DialogDescription>
              Create a new mobile-only order with separate commission tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isAdmin && (
              <div className="space-y-2">
                <Label>Rep ID *</Label>
                <Input 
                  placeholder="Enter rep ID" 
                  value={mobileOrderForm.repId}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, repId: e.target.value }))}
                  data-testid="input-mobile-rep-id"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider *</Label>
                <Select value={mobileOrderForm.providerId} onValueChange={(v) => setMobileOrderForm(f => ({ ...f, providerId: v, serviceId: "" }))}>
                  <SelectTrigger data-testid="select-mobile-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Client *</Label>
                <Select value={mobileOrderForm.clientId} onValueChange={(v) => setMobileOrderForm(f => ({ ...f, clientId: v, serviceId: "" }))}>
                  <SelectTrigger data-testid="select-mobile-client">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Service *</Label>
              <Select value={mobileOrderForm.serviceId} onValueChange={(v) => setMobileOrderForm(f => ({ ...f, serviceId: v }))}>
                <SelectTrigger data-testid="select-mobile-service">
                  <SelectValue placeholder={mobileAvailableServices?.length ? "Select service" : "Select provider & client first"} />
                </SelectTrigger>
                <SelectContent>
                  {(mobileAvailableServices || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Name *</Label>
                <Input 
                  placeholder="Enter customer name" 
                  value={mobileOrderForm.customerName}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, customerName: e.target.value }))}
                  data-testid="input-mobile-customer-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Date Sold *</Label>
                <Input 
                  type="date" 
                  value={mobileOrderForm.dateSold}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, dateSold: e.target.value }))}
                  data-testid="input-mobile-date-sold"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Phone</Label>
                <Input 
                  placeholder="Enter phone number" 
                  value={mobileOrderForm.customerPhone}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, customerPhone: e.target.value }))}
                  data-testid="input-mobile-customer-phone"
                />
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input 
                  placeholder="Enter account number" 
                  value={mobileOrderForm.accountNumber}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, accountNumber: e.target.value }))}
                  data-testid="input-mobile-account-number"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Customer Address</Label>
              <Textarea 
                placeholder="Enter customer address" 
                value={mobileOrderForm.customerAddress}
                onChange={(e) => setMobileOrderForm(f => ({ ...f, customerAddress: e.target.value }))}
                data-testid="input-mobile-customer-address"
              />
            </div>
            <div className="space-y-3 border rounded-md p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Mobile Lines ({mobileOrderForm.mobileLines.length})</Label>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm" 
                  onClick={addMobileLine}
                  data-testid="button-add-mobile-line"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Line
                </Button>
              </div>
              {mobileOrderForm.mobileLines.map((line, index) => (
                <div key={index} className="flex items-center gap-3 p-2 bg-background rounded-md border">
                  <span className="text-sm text-muted-foreground w-8">#{index + 1}</span>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Product:</Label>
                    <Select 
                      value={line.mobileProductType || "__none__"} 
                      onValueChange={(v) => updateMobileLine(index, "mobileProductType", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="w-28" data-testid={`select-mobile-product-type-${index}`}>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select</SelectItem>
                        <SelectItem value="UNLIMITED">Unlimited</SelectItem>
                        <SelectItem value="3_GIG">3 Gig</SelectItem>
                        <SelectItem value="1_GIG">1 Gig</SelectItem>
                        <SelectItem value="BYOD">BYOD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Ported:</Label>
                    <Select 
                      value={line.mobilePortedStatus || "__none__"} 
                      onValueChange={(v) => updateMobileLine(index, "mobilePortedStatus", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="w-28" data-testid={`select-mobile-ported-status-${index}`}>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select</SelectItem>
                        <SelectItem value="PORTED">Ported</SelectItem>
                        <SelectItem value="NON_PORTED">Non-Ported</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeMobileLine(index)}
                    disabled={mobileOrderForm.mobileLines.length === 1}
                    data-testid={`button-remove-mobile-line-${index}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowMobileOrderDialog(false); resetMobileOrderForm(); }}>
              Cancel
            </Button>
            <Button 
              onClick={() => createMobileOrderMutation.mutate(mobileOrderForm)} 
              disabled={createMobileOrderMutation.isPending || !mobileOrderForm.customerName || !mobileOrderForm.dateSold}
              data-testid="button-submit-mobile-order"
            >
              {createMobileOrderMutation.isPending ? "Creating..." : "Create Mobile Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Order Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={(open) => { 
        if (!open) { 
          setShowRejectDialog(false); 
          setRejectingOrder(null); 
          setRejectionNote(""); 
        } 
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Order</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting order {rejectingOrder?.invoiceNumber || rejectingOrder?.id?.slice(0, 8)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rejection Reason *</Label>
              <Textarea
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                placeholder="Enter the reason for rejection..."
                rows={3}
                data-testid="input-rejection-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRejectDialog(false); setRejectingOrder(null); setRejectionNote(""); }}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleConfirmReject}
              disabled={rejectOrderMutation.isPending || !rejectionNote.trim()}
              data-testid="button-confirm-reject"
            >
              {rejectOrderMutation.isPending ? "Rejecting..." : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
