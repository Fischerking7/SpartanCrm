import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Eye,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

export default function OrderTracker() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);

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
          {sortedOrders.map((order) => {
            const status = getOrderStatus(order);
            const config = getStatusConfig(status);
            const netCommission = parseFloat(order.baseCommissionEarned) - parseFloat((order as any).overrideDeduction || "0") + parseFloat(order.incentiveEarned || "0");
            const clientName = clientMap.get(order.clientId) || "Unknown";
            const providerName = providerMap.get(order.providerId) || "Unknown";
            const serviceName = serviceMap.get(order.serviceId) || "";

            return (
              <Card
                key={order.id}
                className="hover-elevate cursor-pointer"
                onClick={() => setSelectedOrder(order)}
                data-testid={`card-order-${order.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium" data-testid={`text-customer-${order.id}`}>
                          {order.customerName}
                        </span>
                        {order.invoiceNumber && (
                          <span className="text-xs text-muted-foreground font-mono">
                            #{order.invoiceNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
                        <span>{providerName}</span>
                        <span>-</span>
                        <span>{clientName}</span>
                        {serviceName && (
                          <>
                            <span>-</span>
                            <span>{serviceName}</span>
                          </>
                        )}
                      </div>
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
                      <p className="font-mono font-medium" data-testid={`text-commission-${order.id}`}>
                        ${netCommission.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.dateSold).toLocaleDateString()}
                      </p>
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground hidden sm:block" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="text-order-detail-title">Order Details</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <OrderDetailPanel
              order={selectedOrder}
              clientMap={clientMap}
              providerMap={providerMap}
              serviceMap={serviceMap}
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
}: {
  order: SalesOrder;
  clientMap: Map<string, string>;
  providerMap: Map<string, string>;
  serviceMap: Map<string, string>;
}) {
  const status = getOrderStatus(order);
  const config = getStatusConfig(status);
  const netCommission = parseFloat(order.baseCommissionEarned) - parseFloat((order as any).overrideDeduction || "0") + parseFloat(order.incentiveEarned || "0");

  const rows: { label: string; value: string | null }[] = [
    { label: "Customer", value: order.customerName },
    { label: "Account #", value: order.accountNumber || null },
    { label: "Invoice #", value: order.invoiceNumber || null },
    { label: "Provider", value: providerMap.get(order.providerId) || null },
    { label: "Client", value: clientMap.get(order.clientId) || null },
    { label: "Service", value: serviceMap.get(order.serviceId) || null },
    { label: "Date Sold", value: order.dateSold ? new Date(order.dateSold).toLocaleDateString() : null },
    { label: "Install Date", value: order.installDate ? new Date(order.installDate).toLocaleDateString() : null },
    { label: "Install Type", value: order.installType || null },
    { label: "TV", value: order.tvSold ? "Yes" : "No" },
    { label: "Address", value: order.customerAddress || null },
    { label: "Phone", value: order.customerPhone || null },
    { label: "Email", value: order.customerEmail || null },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Badge variant={config.variant}>
          <config.icon className="h-3 w-3 mr-1" />
          {config.label}
        </Badge>
        <StatusPipeline status={status} />
      </div>

      {status === "rejected" && order.rejectionNote && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive mb-0.5">Rejection Reason</p>
          <p className="text-sm">{order.rejectionNote}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {rows.filter(r => r.value !== null).map(r => (
          <div key={r.label}>
            <p className="text-xs text-muted-foreground">{r.label}</p>
            <p className="text-sm font-medium">{r.value}</p>
          </div>
        ))}
      </div>

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
    </div>
  );
}
