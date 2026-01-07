import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge, ApprovalStatusBadge, PaymentStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Filter, Download, Eye, Upload, FileSpreadsheet, AlertCircle, CheckCircle, Trash2 } from "lucide-react";
import type { SalesOrder, Client, Provider, Service, User, CommissionLineItem, RateCard } from "@shared/schema";

interface MobileLineEntry {
  mobileProductType: string;
  mobilePortedStatus: string;
}

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
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

  const [newOrderForm, setNewOrderForm] = useState({
    repId: "",
    clientId: "",
    providerId: "",
    serviceId: "",
    dateSold: "",
    installDate: "",
    accountNumber: "",
    customerName: "",
    customerAddress: "",
    customerPhone: "",
    customerEmail: "",
    hasTv: false,
    hasMobile: false,
    mobileLines: [] as MobileLineEntry[],
  });

  const addMobileLine = () => {
    setNewOrderForm(f => ({
      ...f,
      mobileLines: [...f.mobileLines, { mobileProductType: "", mobilePortedStatus: "" }]
    }));
  };

  const removeMobileLine = (index: number) => {
    setNewOrderForm(f => ({
      ...f,
      mobileLines: f.mobileLines.filter((_, i) => i !== index)
    }));
  };

  const updateMobileLine = (index: number, field: keyof MobileLineEntry, value: string) => {
    setNewOrderForm(f => ({
      ...f,
      mobileLines: f.mobileLines.map((line, i) => 
        i === index ? { ...line, [field]: value } : line
      )
    }));
  };

  const isAdmin = user?.role === "ADMIN" || user?.role === "FOUNDER";

  // Handle pre-filling form from lead query params
  useEffect(() => {
    if (searchString) {
      const params = new URLSearchParams(searchString);
      const fromLead = params.get("fromLead");
      const customerName = params.get("customerName");
      const customerAddress = params.get("customerAddress");
      const customerPhone = params.get("customerPhone");
      const customerEmail = params.get("customerEmail");
      
      if (fromLead) {
        setFromLeadId(fromLead);
        setNewOrderForm(f => ({
          ...f,
          customerName: customerName || "",
          customerAddress: customerAddress || "",
          customerPhone: customerPhone || "",
          customerEmail: customerEmail || "",
        }));
        setShowNewOrderDialog(true);
        // Clear the URL params after processing
        setLocation("/orders", { replace: true });
        toast({
          title: "Lead information loaded",
          description: "Customer details have been pre-filled from the lead.",
        });
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
    queryKey: ["/api/orders"],
    queryFn: async () => {
      const res = await fetch("/api/orders", { headers: getAuthHeaders() });
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

  // Fetch rate cards for override calculation (admin/executive only)
  const isAdminOrExec = user?.role === "ADMIN" || user?.role === "FOUNDER" || user?.role === "EXECUTIVE";
  const { data: rateCards } = useQuery<RateCard[]>({
    queryKey: ["/api/admin/rate-cards"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rate-cards", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin, // Only admins can access this endpoint
  });

  // Helper to calculate override amount for an order
  const getOverrideAmount = (order: SalesOrder): number => {
    if (!rateCards || !order.appliedRateCardId) return 0;
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
          accountNumber: orderData.accountNumber || null,
          customerName: orderData.customerName,
          customerAddress: orderData.customerAddress || null,
          customerPhone: orderData.customerPhone || null,
          customerEmail: orderData.customerEmail || null,
          hasTv: orderData.hasTv,
          hasMobile: orderData.hasMobile,
          mobileLines: orderData.hasMobile ? orderData.mobileLines : [],
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

  const resetNewOrderForm = () => {
    setNewOrderForm({
      repId: "",
      clientId: "",
      providerId: "",
      serviceId: "",
      dateSold: "",
      installDate: "",
      accountNumber: "",
      customerName: "",
      customerAddress: "",
      customerPhone: "",
      customerEmail: "",
      hasTv: false,
      hasMobile: false,
      mobileLines: [],
    });
  };

  const updateJobStatusMutation = useMutation({
    mutationFn: async ({ orderId, jobStatus, installDate }: { orderId: string; jobStatus?: string; installDate?: string }) => {
      const body: Record<string, string> = {};
      if (jobStatus) body.jobStatus = jobStatus;
      if (installDate !== undefined) body.installDate = installDate;
      
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

  const handleExportToExcel = () => {
    if (!filteredOrders?.length) {
      toast({ title: "No orders to export", variant: "destructive" });
      return;
    }
    
    const headers = ["Invoice #", "Rep ID", "Customer Name", "Account #", "Phone", "Provider", "Service", "TV", "Mobile", "Mobile Lines", "Date Sold", "Install Date", "Job Status", "Approval Status", "Commission", "Payment Status"];
    const rows = filteredOrders.map(order => {
      const provider = providers?.find(p => p.id === order.providerId);
      const service = services?.find(s => s.id === order.serviceId);
      return [
        order.invoiceNumber || "",
        order.repId,
        order.customerName,
        order.accountNumber || "",
        order.customerPhone || "",
        provider?.name || "",
        service?.name || "",
        order.tvSold ? "Yes" : "No",
        order.mobileSold ? "Yes" : "No",
        order.mobileLinesQty?.toString() || "0",
        order.dateSold,
        order.installDate || "",
        order.jobStatus,
        order.approvalStatus,
        parseFloat(order.baseCommissionEarned).toFixed(2),
        order.paymentStatus,
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

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm("Are you sure you want to permanently delete this order? This action cannot be undone.")) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/hard-delete`, {
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
    const matchesSearch =
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.repId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || order.jobStatus === statusFilter;
    const matchesExport = exportFilter === "all" || 
      (exportFilter === "exported" && order.exportedToAccounting) ||
      (exportFilter === "unexported" && !order.exportedToAccounting) ||
      (exportFilter === "ready" && order.approvalStatus === "APPROVED" && !order.exportedToAccounting);
    return matchesSearch && matchesStatus && matchesExport;
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
            header: "Rep",
            cell: (row: SalesOrder) => (
              <span className="font-mono text-sm">{row.repId}</span>
            ),
          },
        ]
      : []),
    {
      key: "customerName",
      header: "Customer",
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
      key: "customerPhone",
      header: "Phone",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-sm text-muted-foreground truncate block max-w-[120px]">
          {row.customerPhone || "-"}
        </span>
      ),
    },
    {
      key: "provider",
      header: "Provider",
      cell: (row: SalesOrder) => {
        const provider = providers?.find(p => p.id === row.providerId);
        return <span className="text-sm truncate block max-w-[100px]">{provider?.name || "-"}</span>;
      },
    },
    {
      key: "service",
      header: "Service",
      cell: (row: SalesOrder) => {
        const service = services?.find(s => s.id === row.serviceId);
        return <span className="text-sm truncate block max-w-[100px]">{service?.name || "-"}</span>;
      },
    },
    {
      key: "addons",
      header: "Add-ons",
      cell: (row: SalesOrder) => (
        <div className="flex gap-1 flex-wrap">
          {row.tvSold && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">TV</span>}
          {row.mobileSold && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Mobile ({row.mobileLinesQty})</span>}
          {!row.tvSold && !row.mobileSold && <span className="text-muted-foreground text-sm">-</span>}
        </div>
      ),
    },
    {
      key: "dateSold",
      header: "Date Sold",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "installDate",
      header: "Install",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {row.installDate ? new Date(row.installDate).toLocaleDateString() : "-"}
        </span>
      ),
    },
    {
      key: "jobStatus",
      header: "Job",
      cell: (row: SalesOrder) => <JobStatusBadge status={row.jobStatus} />,
    },
    {
      key: "approvalStatus",
      header: "Approval",
      cell: (row: SalesOrder) => <ApprovalStatusBadge status={row.approvalStatus} />,
    },
    {
      key: "baseCommissionEarned",
      header: "Commission",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-right block">
          ${parseFloat(row.baseCommissionEarned).toFixed(2)}
        </span>
      ),
      className: "text-right",
    },
    ...(isAdmin ? [{
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
    {
      key: "paymentStatus",
      header: "Payment",
      cell: (row: SalesOrder) => <PaymentStatusBadge status={row.paymentStatus} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row: SalesOrder) => (
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSelectedOrder(row)}
            data-testid={`button-view-order-${row.id}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {isAdmin && row.approvalStatus === "UNAPPROVED" && (
            <Button
              size="icon"
              variant="ghost"
              className="text-destructive"
              onClick={() => handleDeleteOrder(row.id)}
              data-testid={`button-delete-order-${row.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-muted-foreground">
            {user?.role === "REP" ? "Your orders" : user?.role === "MANAGER" ? "Team orders" : "All orders"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
        </div>
      </div>

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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELED">Canceled</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && (
              <Select value={exportFilter} onValueChange={setExportFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-export-filter">
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
        <DialogContent className="max-w-2xl">
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
                  <p className="font-medium">{selectedOrder.customerName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="text-sm">{selectedOrder.customerEmail || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p className="text-sm">{selectedOrder.customerPhone || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Rep ID</Label>
                  <p className="font-mono">{selectedOrder.repId}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Provider</Label>
                  <p className="font-medium">{providers?.find(p => p.id === selectedOrder.providerId)?.name || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Service</Label>
                  <p className="font-medium">{services?.find(s => s.id === selectedOrder.serviceId)?.name || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Account Number</Label>
                  <p className="font-mono">{selectedOrder.accountNumber || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Date Sold</Label>
                  <p>{new Date(selectedOrder.dateSold).toLocaleDateString()}</p>
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
                <div>
                  <Label className="text-muted-foreground">Approval Status</Label>
                  <div className="mt-1"><ApprovalStatusBadge status={selectedOrder.approvalStatus} /></div>
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
                    // Calculate gross from line items and derive deduction
                    const grossFromLines = commissionLines?.reduce((sum, line) => sum + parseFloat(line.totalAmount), 0) || 0;
                    const netCommission = parseFloat(selectedOrder.baseCommissionEarned);
                    const overrideDeduction = grossFromLines > 0 ? grossFromLines - netCommission : 0;
                    
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
                              return (
                                <div key={idx} className="flex justify-between gap-2">
                                  <span>{label}{detail}</span>
                                  <span className="font-mono">${parseFloat(line.totalAmount).toFixed(2)}</span>
                                </div>
                              );
                            })}
                            {isAdmin && overrideDeduction > 0.01 && (
                              <div className="flex justify-between gap-2 text-muted-foreground">
                                <span>Override Deduction</span>
                                <span className="font-mono">-${overrideDeduction.toFixed(2)}</span>
                              </div>
                            )}
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
                            ${(parseFloat(selectedOrder.baseCommissionEarned) + parseFloat(selectedOrder.incentiveEarned)).toFixed(2)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {isAdmin && selectedOrder && selectedOrder.paymentStatus !== "PAID" && (
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
            <DialogDescription>Enter the order details below</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {isAdmin && (
                <div className="space-y-2">
                  <Label>Assign To *</Label>
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
                </div>
              )}
              <div className="space-y-2">
                <Label>Client</Label>
                <Select value={newOrderForm.clientId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, clientId: v }))}>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.filter(c => c.active !== false && c.id).map((client) => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={newOrderForm.providerId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, providerId: v }))}>
                  <SelectTrigger data-testid="select-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.filter(p => p.active !== false && p.id).map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Select value={newOrderForm.serviceId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, serviceId: v }))}>
                  <SelectTrigger data-testid="select-service">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services?.filter(s => s.active !== false && s.id).map((service) => (
                      <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="hasMobile" 
                  checked={newOrderForm.hasMobile}
                  onCheckedChange={(checked) => setNewOrderForm(f => ({ 
                    ...f, 
                    hasMobile: !!checked, 
                    mobileLines: checked ? (f.mobileLines.length > 0 ? f.mobileLines : [{ mobileProductType: "", mobilePortedStatus: "" }]) : [] 
                  }))}
                  data-testid="checkbox-has-mobile"
                />
                <Label htmlFor="hasMobile" className="cursor-pointer">Mobile</Label>
                {mobileRateCheck?.hasMobileRates && !newOrderForm.hasMobile && (
                  <span className="text-xs text-muted-foreground ml-2">(mobile rates available)</span>
                )}
              </div>
            </div>
            {newOrderForm.hasMobile && (
              <div className="space-y-3 border rounded-md p-4 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Mobile Lines ({newOrderForm.mobileLines.length})</Label>
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
                {newOrderForm.mobileLines.map((line, index) => (
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
                          <SelectItem value="OTHER">Other</SelectItem>
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
                      disabled={newOrderForm.mobileLines.length === 1}
                      data-testid={`button-remove-mobile-line-${index}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNewOrderDialog(false); resetNewOrderForm(); }}>
              Cancel
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
    </div>
  );
}
