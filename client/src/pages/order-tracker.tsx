import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Clock,
  CheckCircle2,
  ThumbsUp,
  DollarSign,
  Search,
  ArrowUpRight,
  CalendarDays,
  Package,
  XCircle,
  ChevronRight,
  Filter,
  Pencil,
  Save,
  MapPin,
  Phone,
  User,
  Loader2,
  StickyNote,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { SalesOrder, Client, Provider, Service } from "@shared/schema";
import { Link } from "wouter";

type OrderStatus = "pending" | "completed" | "approved" | "paid" | "rejected" | "canceled";

function getOrderStatus(order: SalesOrder): OrderStatus {
  if (order.jobStatus === "CANCELED") return "canceled";
  if (order.approvalStatus === "REJECTED") return "rejected";
  if (order.paymentStatus === "PAID") return "paid";
  if (order.approvalStatus === "APPROVED") return "approved";
  if (order.jobStatus === "COMPLETED") return "completed";
  return "pending";
}

function getStatusConfig(status: OrderStatus) {
  switch (status) {
    case "pending":
      return { label: "Pending", variant: "outline" as const, icon: Clock, color: "text-yellow-600 dark:text-yellow-400" };
    case "completed":
      return { label: "Completed", variant: "secondary" as const, icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400" };
    case "approved":
      return { label: "Approved", variant: "default" as const, icon: ThumbsUp, color: "text-green-600 dark:text-green-400" };
    case "paid":
      return { label: "Paid", variant: "default" as const, icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400" };
    case "rejected":
      return { label: "Rejected", variant: "destructive" as const, icon: XCircle, color: "text-red-600 dark:text-red-400" };
    case "canceled":
      return { label: "Canceled", variant: "outline" as const, icon: XCircle, color: "text-muted-foreground" };
  }
}

function getStepIndex(status: OrderStatus): number {
  switch (status) {
    case "pending": return 0;
    case "completed": return 1;
    case "approved": return 2;
    case "paid": return 3;
    case "rejected": return -1;
    case "canceled": return -1;
  }
}

const pipelineSteps = [
  { label: "Pending", icon: Clock },
  { label: "Completed", icon: CheckCircle2 },
  { label: "Approved", icon: ThumbsUp },
  { label: "Paid", icon: DollarSign },
];

function StatusPipeline({ status }: { status: OrderStatus }) {
  const stepIndex = getStepIndex(status);
  if (stepIndex === -1) {
    const config = getStatusConfig(status);
    return (
      <div className="flex items-center gap-1.5">
        <config.icon className={`h-4 w-4 ${config.color}`} />
        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {pipelineSteps.map((step, i) => {
        const isActive = i <= stepIndex;
        const isCurrent = i === stepIndex;
        return (
          <div key={step.label} className="flex items-center gap-1">
            <div
              className={`flex items-center justify-center rounded-full transition-colors ${
                isCurrent
                  ? "bg-primary text-primary-foreground h-6 w-6"
                  : isActive
                    ? "bg-primary/20 text-primary h-5 w-5"
                    : "bg-muted text-muted-foreground h-5 w-5"
              }`}
            >
              <step.icon className={isCurrent ? "h-3.5 w-3.5" : "h-3 w-3"} />
            </div>
            {i < pipelineSteps.length - 1 && (
              <div className={`w-4 h-0.5 ${isActive ? "bg-primary/40" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({
  order,
  clientMap,
  providerMap,
  serviceMap,
  services,
  canSeeCommissions,
  isEditing,
  onEdit,
  onCancelEdit,
  onSelect,
}: {
  order: SalesOrder;
  clientMap: Map<string, string>;
  providerMap: Map<string, string>;
  serviceMap: Map<string, string>;
  services: Service[];
  canSeeCommissions: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
}) {
  const { toast } = useToast();
  const status = getOrderStatus(order);
  const config = getStatusConfig(status);
  const netCommission = parseFloat(order.baseCommissionEarned) - parseFloat((order as any).overrideDeduction || "0") + parseFloat(order.incentiveEarned || "0");
  const clientName = clientMap.get(order.clientId) || "Unknown";
  const providerName = providerMap.get(order.providerId) || "Unknown";
  const serviceName = serviceMap.get(order.serviceId) || "";

  const [formData, setFormData] = useState({
    customerName: order.customerName || "",
    customerAddress: order.customerAddress || "",
    customerPhone: order.customerPhone || "",
    customerEmail: order.customerEmail || "",
    installDate: order.installDate ? order.installDate.split("T")[0] : "",
    serviceId: order.serviceId || "",
    accountNumber: order.accountNumber || "",
  });

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order updated", description: "Your changes have been saved." });
      onCancelEdit();
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message || "Could not save changes.", variant: "destructive" });
    },
  });

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload: Record<string, any> = {};
    if (formData.customerName !== (order.customerName || "")) payload.customerName = formData.customerName;
    if (formData.customerAddress !== (order.customerAddress || "")) payload.customerAddress = formData.customerAddress;
    if (formData.customerPhone !== (order.customerPhone || "")) payload.customerPhone = formData.customerPhone;
    if (formData.customerEmail !== (order.customerEmail || "")) payload.customerEmail = formData.customerEmail;
    if (formData.installDate !== (order.installDate ? order.installDate.split("T")[0] : "")) payload.installDate = formData.installDate;
    if (formData.serviceId !== (order.serviceId || "")) payload.serviceId = formData.serviceId;
    if (formData.accountNumber !== (order.accountNumber || "")) payload.accountNumber = formData.accountNumber;

    if (Object.keys(payload).length === 0) {
      onCancelEdit();
      return;
    }
    updateMutation.mutate(payload);
  };

  if (isEditing) {
    return (
      <Card data-testid={`card-order-${order.id}`}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Badge variant={config.variant}>
              <config.icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); onCancelEdit(); }} data-testid={`button-cancel-inline-${order.id}`}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending} data-testid={`button-save-inline-${order.id}`}>
                {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Customer Name</Label>
              <Input
                value={formData.customerName}
                onChange={(e) => updateField("customerName", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-customer-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">Account #</Label>
              <Input
                value={formData.accountNumber}
                onChange={(e) => updateField("accountNumber", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-account-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input
                value={formData.customerPhone}
                onChange={(e) => updateField("customerPhone", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-phone-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input
                value={formData.customerEmail}
                onChange={(e) => updateField("customerEmail", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-email-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">Install Date</Label>
              <Input
                type="date"
                value={formData.installDate}
                onChange={(e) => updateField("installDate", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-date-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">Service</Label>
              <Select value={formData.serviceId} onValueChange={(v) => updateField("serviceId", v)}>
                <SelectTrigger onClick={(e) => e.stopPropagation()} data-testid={`select-inline-service-${order.id}`}>
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Address</Label>
              <Input
                value={formData.customerAddress}
                onChange={(e) => updateField("customerAddress", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-address-${order.id}`}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="hover-elevate cursor-pointer"
      onClick={onSelect}
      data-testid={`card-order-${order.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 flex-wrap">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium" data-testid={`text-customer-${order.id}`}>
                {order.customerName}
              </span>
              {order.accountNumber && (
                <span className="text-xs text-muted-foreground font-mono">
                  #{order.accountNumber}
                </span>
              )}
            </div>
            <div className="flex items-center gap-x-3 gap-y-0.5 mt-1.5 text-sm text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground/80">{serviceName || "No service"}</span>
              <span className="text-xs">|</span>
              <span>{providerName} - {clientName}</span>
            </div>
            <div className="flex items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground flex-wrap">
              {order.installDate && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  Install: {new Date(order.installDate).toLocaleDateString()}
                </span>
              )}
              {order.customerPhone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {order.customerPhone}
                </span>
              )}
              {order.customerAddress && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {order.customerAddress.length > 30 ? order.customerAddress.slice(0, 30) + "..." : order.customerAddress}
                </span>
              )}
            </div>
            {order.notes && (
              <div className="flex items-start gap-1 mt-1.5 text-xs text-muted-foreground">
                <StickyNote className="h-3 w-3 mt-0.5 shrink-0" />
                <span className="line-clamp-1" data-testid={`text-note-preview-${order.id}`}>
                  {order.notes}
                </span>
              </div>
            )}
          </div>

          <div className="hidden md:block">
            <StatusPipeline status={status} />
          </div>
          <div className="md:hidden">
            <Badge variant={config.variant} data-testid={`badge-status-${order.id}`}>
              <config.icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
          </div>

          <div className="text-right min-w-[100px]">
            {canSeeCommissions && (
              <p className="font-mono font-medium" data-testid={`text-commission-${order.id}`}>
                ${netCommission.toFixed(2)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {new Date(order.dateSold).toLocaleDateString()}
            </p>
          </div>

          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            data-testid={`button-edit-inline-${order.id}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OrderTracker() {
  const { user } = useAuth();
  const canSeeCommissions = ["EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user?.role || "");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

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

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    clients?.forEach(c => map.set(c.id, c.name));
    return map;
  }, [clients]);

  const providerMap = useMemo(() => {
    const map = new Map<string, string>();
    providers?.forEach(p => map.set(p.id, p.name));
    return map;
  }, [providers]);

  const serviceMap = useMemo(() => {
    const map = new Map<string, string>();
    services?.forEach(s => map.set(s.id, s.name));
    return map;
  }, [services]);

  const dateFilteredOrders = useMemo(() => {
    if (!orders) return [];
    const now = new Date();
    return orders.filter(o => {
      if (dateRange === "all") return true;
      const status = getOrderStatus(o);
      if (status === "paid") return true;
      const sold = new Date(o.dateSold);
      if (dateRange === "7d") return now.getTime() - sold.getTime() <= 7 * 86400000;
      if (dateRange === "30d") return now.getTime() - sold.getTime() <= 30 * 86400000;
      if (dateRange === "90d") return now.getTime() - sold.getTime() <= 90 * 86400000;
      return true;
    });
  }, [orders, dateRange]);

  const stats = useMemo(() => {
    const all = dateFilteredOrders;
    const pending = all.filter(o => getOrderStatus(o) === "pending").length;
    const completed = all.filter(o => getOrderStatus(o) === "completed").length;
    const approved = all.filter(o => getOrderStatus(o) === "approved").length;
    const paid = all.filter(o => getOrderStatus(o) === "paid").length;
    const totalEarned = all
      .filter(o => getOrderStatus(o) === "approved" || getOrderStatus(o) === "paid")
      .reduce((sum, o) => {
        const base = parseFloat(o.baseCommissionEarned) - parseFloat((o as any).overrideDeduction || "0");
        const incentive = parseFloat(o.incentiveEarned || "0");
        return sum + base + incentive;
      }, 0);
    return { pending, completed, approved, paid, total: all.length, totalEarned };
  }, [dateFilteredOrders]);

  const filteredOrders = useMemo(() => {
    return dateFilteredOrders.filter(o => {
      const status = getOrderStatus(o);
      if (activeTab === "active" && (status === "pending" || status === "completed")) return true;
      if (activeTab === "approved" && status === "approved") return true;
      if (activeTab === "paid" && status === "paid") return true;
      if (activeTab === "all") return true;
      return false;
    }).filter(o => {
      if (!searchTerm) return true;
      const q = searchTerm.toLowerCase();
      return (
        o.customerName.toLowerCase().includes(q) ||
        o.invoiceNumber?.toLowerCase().includes(q) ||
        o.accountNumber?.toLowerCase().includes(q) ||
        clientMap.get(o.clientId)?.toLowerCase().includes(q) ||
        providerMap.get(o.providerId)?.toLowerCase().includes(q)
      );
    });
  }, [dateFilteredOrders, activeTab, searchTerm, clientMap, providerMap]);

  const sortedOrders = useMemo(() => {
    return [...filteredOrders].sort((a, b) => {
      const statusPriority: Record<OrderStatus, number> = {
        pending: 0, completed: 1, approved: 2, rejected: 3, canceled: 4, paid: 5,
      };
      const sPri = statusPriority[getOrderStatus(a)] - statusPriority[getOrderStatus(b)];
      if (sPri !== 0) return sPri;
      return new Date(b.dateSold).getTime() - new Date(a.dateSold).getTime();
    });
  }, [filteredOrders]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-order-tracker-title">
            Order Tracker
          </h1>
          <p className="text-muted-foreground text-sm">
            Track your orders from sale to payment
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[140px]" data-testid="select-date-range">
              <CalendarDays className="h-4 w-4 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
          <Link href="/orders">
            <Button variant="outline" data-testid="link-full-orders">
              <ArrowUpRight className="h-4 w-4 mr-1.5" />
              Full Orders
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "active" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("active")}
          data-testid="card-stat-active"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm text-muted-foreground">Active</span>
              <Package className="h-4 w-4 text-yellow-500" />
            </div>
            <p className="text-2xl font-bold">{stats.pending + stats.completed}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stats.pending} pending, {stats.completed} completed
            </p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "approved" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("approved")}
          data-testid="card-stat-approved"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm text-muted-foreground">Approved</span>
              <ThumbsUp className="h-4 w-4 text-green-500" />
            </div>
            <p className="text-2xl font-bold">{stats.approved}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Awaiting payment</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "paid" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("paid")}
          data-testid="card-stat-paid"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm text-muted-foreground">Paid</span>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold">{stats.paid}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Commission received</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "all" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("all")}
          data-testid="card-stat-total"
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm text-muted-foreground">Total Orders</span>
              <Filter className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground mt-0.5">All orders</p>
          </CardContent>
        </Card>
        {canSeeCommissions && (
          <Card data-testid="card-stat-earned">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm text-muted-foreground">Net Earned</span>
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold font-mono">
                ${stats.totalEarned.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Approved + paid</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by customer, account, invoice..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-orders"
          />
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
            <TabsTrigger value="active" data-testid="tab-active">
              Active
              {(stats.pending + stats.completed) > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-muted">{stats.pending + stats.completed}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved" data-testid="tab-approved">Approved</TabsTrigger>
            <TabsTrigger value="paid" data-testid="tab-paid">Paid</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {sortedOrders.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-lg font-medium">No orders found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchTerm ? "Try adjusting your search" : "Orders will appear here as you make sales"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              clientMap={clientMap}
              providerMap={providerMap}
              serviceMap={serviceMap}
              services={services || []}
              canSeeCommissions={canSeeCommissions}
              isEditing={editingOrderId === order.id}
              onEdit={() => setEditingOrderId(order.id)}
              onCancelEdit={() => setEditingOrderId(null)}
              onSelect={() => setSelectedOrder(order)}
            />
          ))}
        </div>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-order-detail-title">Order Details</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <OrderDetailPanel
              order={selectedOrder}
              clientMap={clientMap}
              providerMap={providerMap}
              serviceMap={serviceMap}
              services={services || []}
              onClose={() => setSelectedOrder(null)}
              canSeeCommissions={canSeeCommissions}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderDetailPanel({
  order,
  clientMap,
  providerMap,
  serviceMap,
  services,
  onClose,
  canSeeCommissions,
}: {
  order: SalesOrder;
  clientMap: Map<string, string>;
  providerMap: Map<string, string>;
  serviceMap: Map<string, string>;
  services: Service[];
  onClose: () => void;
  canSeeCommissions: boolean;
}) {
  const { toast } = useToast();
  const status = getOrderStatus(order);
  const config = getStatusConfig(status);
  const netCommission = parseFloat(order.baseCommissionEarned) - parseFloat((order as any).overrideDeduction || "0") + parseFloat(order.incentiveEarned || "0");

  const [isEditing, setIsEditing] = useState(false);
  const [notesValue, setNotesValue] = useState(order.notes || "");
  const [displayNotes, setDisplayNotes] = useState(order.notes || "");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [formData, setFormData] = useState({
    customerName: order.customerName || "",
    customerAddress: order.customerAddress || "",
    customerPhone: order.customerPhone || "",
    customerEmail: order.customerEmail || "",
    installDate: order.installDate ? order.installDate.split("T")[0] : "",
    serviceId: order.serviceId || "",
    accountNumber: order.accountNumber || "",
  });

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order updated", description: "Your changes have been saved." });
      setIsEditing(false);
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message || "Could not save changes.", variant: "destructive" });
    },
  });

  const notesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Notes saved" });
      setDisplayNotes(notesValue);
      setIsEditingNotes(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to save notes", description: err.message || "Could not save notes.", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const payload: Record<string, any> = {};
    if (formData.customerName !== (order.customerName || "")) payload.customerName = formData.customerName;
    if (formData.customerAddress !== (order.customerAddress || "")) payload.customerAddress = formData.customerAddress;
    if (formData.customerPhone !== (order.customerPhone || "")) payload.customerPhone = formData.customerPhone;
    if (formData.customerEmail !== (order.customerEmail || "")) payload.customerEmail = formData.customerEmail;
    if (formData.installDate !== (order.installDate ? order.installDate.split("T")[0] : "")) payload.installDate = formData.installDate;
    if (formData.serviceId !== (order.serviceId || "")) payload.serviceId = formData.serviceId;
    if (formData.accountNumber !== (order.accountNumber || "")) payload.accountNumber = formData.accountNumber;

    if (Object.keys(payload).length === 0) {
      setIsEditing(false);
      return;
    }
    updateMutation.mutate(payload);
  };

  const handleSaveNotes = () => {
    if (notesValue === displayNotes) {
      setIsEditingNotes(false);
      return;
    }
    notesMutation.mutate(notesValue);
  };

  const readOnlyRows: { label: string; value: string | null }[] = [
    { label: "Invoice #", value: order.invoiceNumber || null },
    { label: "Provider", value: providerMap.get(order.providerId) || null },
    { label: "Client", value: clientMap.get(order.clientId) || null },
    { label: "Date Sold", value: order.dateSold ? new Date(order.dateSold).toLocaleDateString() : null },
    { label: "Install Type", value: order.installType || null },
    { label: "TV", value: order.tvSold ? "Yes" : "No" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Badge variant={config.variant}>
          <config.icon className="h-3 w-3 mr-1" />
          {config.label}
        </Badge>
        <div className="flex items-center gap-2">
          <StatusPipeline status={status} />
          {!isEditing ? (
            <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} data-testid="button-edit-order">
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          ) : (
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-order">
              {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
          )}
        </div>
      </div>

      {status === "rejected" && order.rejectionNote && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive mb-0.5">Rejection Reason</p>
          <p className="text-sm">{order.rejectionNote}</p>
        </div>
      )}

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Customer Name</Label>
            <Input
              value={formData.customerName}
              onChange={(e) => updateField("customerName", e.target.value)}
              data-testid="input-edit-customer-name"
            />
          </div>
          <div>
            <Label className="text-xs">Install Date</Label>
            <Input
              type="date"
              value={formData.installDate}
              onChange={(e) => updateField("installDate", e.target.value)}
              data-testid="input-edit-install-date"
            />
          </div>
          <div>
            <Label className="text-xs">Address</Label>
            <Input
              value={formData.customerAddress}
              onChange={(e) => updateField("customerAddress", e.target.value)}
              data-testid="input-edit-address"
            />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input
              value={formData.customerPhone}
              onChange={(e) => updateField("customerPhone", e.target.value)}
              data-testid="input-edit-phone"
            />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              value={formData.customerEmail}
              onChange={(e) => updateField("customerEmail", e.target.value)}
              data-testid="input-edit-email"
            />
          </div>
          <div>
            <Label className="text-xs">Account #</Label>
            <Input
              value={formData.accountNumber}
              onChange={(e) => updateField("accountNumber", e.target.value)}
              data-testid="input-edit-account"
            />
          </div>
          <div>
            <Label className="text-xs">Service</Label>
            <Select value={formData.serviceId} onValueChange={(v) => updateField("serviceId", v)}>
              <SelectTrigger data-testid="select-edit-service">
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {services.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Customer Name</p>
              <p className="text-sm font-medium">{order.customerName}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Service</p>
                <p className="text-sm font-medium">{serviceMap.get(order.serviceId) || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Install Date</p>
                <p className="text-sm font-medium">{order.installDate ? new Date(order.installDate).toLocaleDateString() : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Address</p>
                <p className="text-sm font-medium">{order.customerAddress || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Phone</p>
                <p className="text-sm font-medium">{order.customerPhone || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium">{order.customerEmail || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Account #</p>
                <p className="text-sm font-medium">{order.accountNumber || "—"}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4">
            {readOnlyRows.filter(r => r.value !== null).map(r => (
              <div key={r.label}>
                <p className="text-xs text-muted-foreground">{r.label}</p>
                <p className="text-sm font-medium">{r.value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="border-t pt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <StickyNote className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">Notes</p>
          </div>
          {!isEditingNotes && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setNotesValue(displayNotes); setIsEditingNotes(true); }}
              data-testid="button-edit-notes"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              {displayNotes ? "Edit" : "Add"}
            </Button>
          )}
        </div>
        {isEditingNotes ? (
          <div className="space-y-2">
            <Textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder="Add notes about this order..."
              className="resize-none text-sm"
              rows={4}
              data-testid="textarea-order-notes"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSaveNotes}
                disabled={notesMutation.isPending}
                data-testid="button-save-notes"
              >
                {notesMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save Notes
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setNotesValue(displayNotes); setIsEditingNotes(false); }}
                data-testid="button-cancel-notes"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-order-notes">
            {displayNotes || "No notes yet"}
          </p>
        )}
      </div>

      {canSeeCommissions && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Net Commission</p>
              <p className="text-xl font-bold font-mono" data-testid="text-detail-commission">
                ${netCommission.toFixed(2)}
              </p>
            </div>
            {parseFloat(order.incentiveEarned || "0") > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Includes Incentive</p>
                <p className="text-sm font-mono">
                  +${parseFloat(order.incentiveEarned || "0").toFixed(2)}
                </p>
              </div>
            )}
          </div>
          {order.paidDate && (
            <p className="text-xs text-muted-foreground mt-2">
              Paid on {new Date(order.paidDate).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
