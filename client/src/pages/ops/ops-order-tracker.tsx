import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  Search, Clock, CheckCircle2, ShieldCheck, DollarSign, XCircle,
  ChevronLeft, ChevronRight, Package, User, Truck, FileCheck, CreditCard,
  ShieldAlert, Pencil, Save, Calendar, X
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const statusBadgeColor: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-300",
  COMPLETED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 border-blue-300",
  CANCELED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-300",
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-300",
  UNAPPROVED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-300",
  UNPAID: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300 border-gray-300",
  PAID: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-300",
  PARTIALLY_PAID: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 border-orange-300",
};

const roleColors: Record<string, string> = {
  REP: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  MDU: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  LEAD: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  MANAGER: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`text-xs ${statusBadgeColor[status] || ""}`}>
      {status}
    </Badge>
  );
}

function RiskBadge({ score }: { score: number | null | undefined }) {
  if (!score && score !== 0) return null;
  const cfg = score <= 25 ? { label: "Low", cls: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" }
    : score <= 50 ? { label: "Med", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" }
    : score <= 75 ? { label: "High", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" }
    : { label: "Critical", cls: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cfg.cls}`} data-testid="badge-risk-score">
      <ShieldAlert className="h-3 w-3" />
      {score} {cfg.label}
    </span>
  );
}

function SectionHeader({ icon, title }: { icon: any; title: string }) {
  const Icon = icon;
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground border-b pb-1.5 mb-2">
      <Icon className="h-4 w-4" />
      {title}
    </div>
  );
}

function DetailRow({ label, value, show = true }: { label: string; value: any; show?: boolean }) {
  if (!show) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="font-medium text-sm mt-0.5">{value || "—"}</div>
    </div>
  );
}

const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString() : "—";
const fmtDateTime = (d: string | null | undefined) => d ? new Date(d).toLocaleString() : "—";
const fmtMoney = (v: string | number | null | undefined) => {
  const n = parseFloat(String(v || "0"));
  return `$${n.toFixed(2)}`;
};
const fmtCents = (v: number | null | undefined) => {
  if (v == null) return "—";
  return `$${(v / 100).toFixed(2)}`;
};

type TabKey = "all" | "pending" | "awaiting_approval" | "approved" | "paid";

const TAB_CONFIG: { key: TabKey; label: string; icon: any; color: string }[] = [
  { key: "all", label: "All Orders", icon: Package, color: "text-slate-600" },
  { key: "pending", label: "Pending", icon: Clock, color: "text-yellow-600" },
  { key: "awaiting_approval", label: "Completed / Awaiting Approval", icon: ShieldCheck, color: "text-orange-600" },
  { key: "approved", label: "Approved", icon: FileCheck, color: "text-green-600" },
  { key: "paid", label: "Paid", icon: DollarSign, color: "text-emerald-600" },
];

export default function OpsOrderTracker() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilterType, setDateFilterType] = useState<"sold" | "install">("sold");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data: allOrdersRaw, isLoading } = useQuery<any[]>({
    queryKey: ["/api/orders"],
    staleTime: Infinity,
  });

  const { data: usersData } = useQuery<any>({
    queryKey: ["/api/admin/users"],
  });

  const { data: servicesData } = useQuery<any>({ queryKey: ["/api/services"] });
  const { data: clientsData } = useQuery<any>({ queryKey: ["/api/clients"] });
  const { data: providersData } = useQuery<any>({ queryKey: ["/api/providers"] });

  const allUsers = usersData?.users || usersData || [];
  const activeReps = Array.isArray(allUsers) ? allUsers.filter((u: any) => ["REP", "LEAD", "MANAGER", "MDU"].includes(u.role) && u.status === "ACTIVE") : [];
  const servicesList = Array.isArray(servicesData) ? servicesData : [];
  const clientsList = Array.isArray(clientsData) ? clientsData : [];
  const providersList = Array.isArray(providersData) ? providersData : [];

  const allOrders = useMemo(() => {
    return Array.isArray(allOrdersRaw) ? allOrdersRaw : [];
  }, [allOrdersRaw]);

  const buckets = useMemo(() => {
    const all: any[] = [];
    const pending: any[] = [];
    const awaiting_approval: any[] = [];
    const approved: any[] = [];
    const paid: any[] = [];

    for (const o of allOrders) {
      all.push(o);
      if (o.paymentStatus === "PAID") {
        paid.push(o);
      } else if (o.approvalStatus === "APPROVED") {
        approved.push(o);
      } else if (o.jobStatus === "COMPLETED" && o.approvalStatus !== "APPROVED") {
        awaiting_approval.push(o);
      } else if (o.jobStatus !== "CANCELED") {
        pending.push(o);
      }
    }

    return { all, pending, awaiting_approval, approved, paid };
  }, [allOrders]);

  const filteredOrders = useMemo(() => {
    let orders = buckets[activeTab] || [];
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      orders = orders.filter((o: any) =>
        (o.customerName || "").toLowerCase().includes(q) ||
        (o.invoiceNumber || "").toLowerCase().includes(q) ||
        (o.repName || o.repId || "").toLowerCase().includes(q) ||
        (o.accountNumber || "").toLowerCase().includes(q) ||
        (o.serviceName || "").toLowerCase().includes(q) ||
        (o.clientName || "").toLowerCase().includes(q)
      );
    }
    if (dateFrom || dateTo) {
      orders = orders.filter((o: any) => {
        const dateVal = dateFilterType === "sold" ? o.dateSold : o.installDate;
        if (!dateVal) return false;
        const d = dateVal.substring(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    }
    return orders;
  }, [buckets, activeTab, searchTerm, dateFrom, dateTo, dateFilterType]);

  const totalPages = Math.ceil(filteredOrders.length / limit);
  const paginatedOrders = filteredOrders.slice((page - 1) * limit, page * limit);

  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => apiRequest("POST", `/api/orders/${orderId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => apiRequest("POST", `/api/orders/bulk-approve`, { orderIds: ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedIds(new Set());
      toast({ title: `${selectedIds.size} orders approved` });
    },
    onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (orderId: string) => apiRequest("PATCH", `/api/orders/${orderId}`, { jobStatus: "CANCELED" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order rejected" });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/orders/${id}/mark-paid`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order marked as paid" });
      if (selectedOrder) setSelectedOrder({ ...selectedOrder, paymentStatus: "PAID" });
    },
    onError: (err: any) => toast({ title: "Failed to mark paid", description: err.message, variant: "destructive" }),
  });

  const reverseApprovalMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/orders/${id}/reverse-approval`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Approval reversed" });
      if (selectedOrder) setSelectedOrder({ ...selectedOrder, approvalStatus: "UNAPPROVED", approvedAt: null });
    },
    onError: (err: any) => toast({ title: "Failed to reverse approval", description: err.message, variant: "destructive" }),
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/orders/${id}`, data);
      return res.json();
    },
    onSuccess: (updatedOrder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order updated" });
      setSelectedOrder(updatedOrder);
      setIsEditing(false);
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const currentIds = paginatedOrders.map((o: any) => o.id);
    if (currentIds.every((id: string) => selectedIds.has(id))) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        currentIds.forEach((id: string) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        currentIds.forEach((id: string) => next.add(id));
        return next;
      });
    }
  };

  const openEditMode = (order: any) => {
    setEditForm({
      customerName: order.customerName || "",
      customerPhone: order.customerPhone || "",
      customerEmail: order.customerEmail || "",
      customerAddress: order.customerAddress || "",
      houseNumber: order.houseNumber || "",
      streetName: order.streetName || "",
      aptUnit: order.aptUnit || "",
      city: order.city || "",
      zipCode: order.zipCode || "",
      accountNumber: order.accountNumber || "",
      repId: order.repId || "",
      serviceId: order.serviceId?.toString() || "",
      clientId: order.clientId?.toString() || "",
      providerId: order.providerId?.toString() || "",
      dateSold: order.dateSold || "",
      jobStatus: order.jobStatus || "PENDING",
      installDate: order.installDate || "",
      installTime: order.installTime || "",
      installType: order.installType || "",
      tvSold: order.tvSold || false,
      mobileSold: order.mobileSold || false,
      mobileProductType: order.mobileProductType || "",
      mobilePortedStatus: order.mobilePortedStatus || "",
      mobileLinesQty: order.mobileLinesQty?.toString() || "0",
      notes: order.notes || "",
    });
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!selectedOrder) return;
    const changes: Record<string, any> = {};
    const text = (field: string) => {
      if (editForm[field] !== (selectedOrder[field] || "")) changes[field] = editForm[field];
    };
    text("customerName"); text("customerPhone"); text("customerEmail"); text("customerAddress");
    text("houseNumber"); text("streetName"); text("aptUnit"); text("city"); text("zipCode");
    text("accountNumber"); text("repId"); text("dateSold"); text("installDate"); text("installTime");
    text("installType"); text("notes");
    text("mobileProductType"); text("mobilePortedStatus");

    if (editForm.serviceId !== (selectedOrder.serviceId?.toString() || "")) changes.serviceId = editForm.serviceId;
    if (editForm.clientId !== (selectedOrder.clientId?.toString() || "")) changes.clientId = editForm.clientId;
    if (editForm.providerId !== (selectedOrder.providerId?.toString() || "")) changes.providerId = editForm.providerId;
    if (editForm.jobStatus !== (selectedOrder.jobStatus || "PENDING")) changes.jobStatus = editForm.jobStatus;
    if (editForm.tvSold !== (selectedOrder.tvSold || false)) changes.tvSold = editForm.tvSold;
    if (editForm.mobileSold !== (selectedOrder.mobileSold || false)) changes.mobileSold = editForm.mobileSold;
    const mLines = parseInt(editForm.mobileLinesQty || "0");
    if (mLines !== (selectedOrder.mobileLinesQty || 0)) changes.mobileLinesQty = mLines;

    if (Object.keys(changes).length === 0) {
      toast({ title: "No changes to save" });
      setIsEditing(false);
      return;
    }
    updateOrderMutation.mutate({ id: selectedOrder.id, data: changes });
  };

  const getDaysSince = (dateStr: string) => {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  };

  const renderOrderDetail = (o: any) => {
    const approvedByUser = o.approvedByUserId ? allUsers.find((u: any) => u.id === o.approvedByUserId) : null;
    return (
      <div className="space-y-5" data-testid="order-detail-view">
        <SectionHeader icon={Package} title="Order Info" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <DetailRow label="Invoice #" value={o.invoiceNumber} />
          <DetailRow label="Rep" value={
            <span>{o.repName || o.repId} {o.repRoleAtSale && <Badge variant="outline" className={`text-[10px] ml-1 ${roleColors[o.repRoleAtSale] || ""}`}>{o.repRoleAtSale}</Badge>}</span>
          } />
          <DetailRow label="Date Sold" value={fmtDate(o.dateSold)} />
          <DetailRow label="Provider" value={o.providerName || "—"} />
          <DetailRow label="Client" value={o.clientName || "—"} />
          <DetailRow label="Service" value={o.serviceName || "—"} />
          <DetailRow label="TV Sold" value={o.tvSold ? "Yes" : "No"} />
          <DetailRow label="Created" value={fmtDateTime(o.createdAt)} />
        </div>

        <SectionHeader icon={User} title="Customer" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <DetailRow label="Name" value={o.customerName} />
          <DetailRow label="Phone" value={o.customerPhone} />
          <DetailRow label="Email" value={o.customerEmail} />
          <DetailRow label="Address" value={o.customerAddress} />
          <DetailRow label="House #" value={o.houseNumber} />
          <DetailRow label="Street" value={o.streetName} />
          <DetailRow label="Apt/Unit" value={o.aptUnit} />
          <DetailRow label="City" value={o.city} />
          <DetailRow label="ZIP" value={o.zipCode} />
          <DetailRow label="Account #" value={o.accountNumber} />
        </div>

        <SectionHeader icon={Truck} title="Installation" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <DetailRow label="Install Date" value={fmtDate(o.installDate)} />
          <DetailRow label="Install Time" value={o.installTime} />
          <DetailRow label="Install Type" value={o.installType} />
          <DetailRow label="Job Status" value={<StatusBadge status={o.jobStatus} />} />
        </div>

        <SectionHeader icon={FileCheck} title="Approval & Payment" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <DetailRow label="Approval" value={<StatusBadge status={o.approvalStatus} />} />
          <DetailRow label="Approved At" value={fmtDateTime(o.approvedAt)} />
          <DetailRow label="Approved By" value={approvedByUser ? `${approvedByUser.firstName} ${approvedByUser.lastName}` : "—"} />
          <DetailRow label="Payment" value={<StatusBadge status={o.paymentStatus} />} />
        </div>

        <SectionHeader icon={CreditCard} title="Commission & Financials" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <DetailRow label="Earned Commission" value={fmtMoney(o.earnedCommission)} />
          <DetailRow label="Paid Commission" value={fmtMoney(o.paidCommission)} />
          <DetailRow label="Chargeback" value={fmtMoney(o.chargebackAmount)} />
          <DetailRow label="Override Deduction" value={fmtMoney(o.overrideDeduction)} />
          <DetailRow label="Override Eligible" value={fmtMoney(o.overrideEligibleAmount)} />
          <DetailRow label="AR Expected" value={fmtCents(o.arExpectedAmountCents)} />
          <DetailRow label="AR Received" value={fmtCents(o.arReceivedAmountCents)} />
          <DetailRow label="Risk Score" value={<RiskBadge score={o.chargebackRiskScore} />} />
        </div>

        {o.notes && (
          <div className="text-sm">
            <p className="text-xs text-muted-foreground mb-1">Notes</p>
            <p className="text-sm bg-muted/50 rounded p-2">{o.notes}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => openEditMode(o)} data-testid="btn-edit-order">
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
          {o.approvalStatus !== "APPROVED" && o.jobStatus === "COMPLETED" && (
            <Button size="sm" onClick={() => { approveMutation.mutate(o.id); setSelectedOrder({ ...o, approvalStatus: "APPROVED" }); }} data-testid="btn-approve-order">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
          )}
          {o.approvalStatus === "APPROVED" && (
            <Button size="sm" variant="outline" className="text-orange-600" onClick={() => reverseApprovalMutation.mutate(o.id)} data-testid="btn-reverse-approval">
              Reverse Approval
            </Button>
          )}
          {o.approvalStatus === "APPROVED" && o.paymentStatus !== "PAID" && (
            <Button size="sm" variant="outline" className="text-green-600" onClick={() => markPaidMutation.mutate(o.id)} data-testid="btn-mark-paid">
              <DollarSign className="h-3.5 w-3.5 mr-1" /> Mark Paid
            </Button>
          )}
          {o.jobStatus !== "CANCELED" && o.approvalStatus !== "APPROVED" && (
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => { rejectMutation.mutate(o.id); setSelectedOrder(null); }} data-testid="btn-reject-order">
              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderEditForm = () => (
    <div className="space-y-4" data-testid="order-edit-form">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Customer Name</Label>
          <Input value={editForm.customerName} onChange={e => setEditForm({ ...editForm, customerName: e.target.value })} data-testid="input-edit-customer-name" />
        </div>
        <div>
          <Label className="text-xs">Phone</Label>
          <Input value={editForm.customerPhone} onChange={e => setEditForm({ ...editForm, customerPhone: e.target.value })} data-testid="input-edit-phone" />
        </div>
        <div>
          <Label className="text-xs">Email</Label>
          <Input value={editForm.customerEmail} onChange={e => setEditForm({ ...editForm, customerEmail: e.target.value })} data-testid="input-edit-email" />
        </div>
        <div>
          <Label className="text-xs">Account #</Label>
          <Input value={editForm.accountNumber} onChange={e => setEditForm({ ...editForm, accountNumber: e.target.value })} data-testid="input-edit-account" />
        </div>
        <div>
          <Label className="text-xs">House #</Label>
          <Input value={editForm.houseNumber} onChange={e => setEditForm({ ...editForm, houseNumber: e.target.value })} data-testid="input-edit-house" />
        </div>
        <div>
          <Label className="text-xs">Street</Label>
          <Input value={editForm.streetName} onChange={e => setEditForm({ ...editForm, streetName: e.target.value })} data-testid="input-edit-street" />
        </div>
        <div>
          <Label className="text-xs">Apt/Unit</Label>
          <Input value={editForm.aptUnit} onChange={e => setEditForm({ ...editForm, aptUnit: e.target.value })} data-testid="input-edit-apt" />
        </div>
        <div>
          <Label className="text-xs">City</Label>
          <Input value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} data-testid="input-edit-city" />
        </div>
        <div>
          <Label className="text-xs">ZIP</Label>
          <Input value={editForm.zipCode} onChange={e => setEditForm({ ...editForm, zipCode: e.target.value })} data-testid="input-edit-zip" />
        </div>
        <div>
          <Label className="text-xs">Rep ID</Label>
          <Select value={editForm.repId} onValueChange={v => setEditForm({ ...editForm, repId: v })}>
            <SelectTrigger data-testid="select-edit-rep"><SelectValue /></SelectTrigger>
            <SelectContent>
              {activeReps.map((r: any) => (
                <SelectItem key={r.repId} value={r.repId}>{r.firstName} {r.lastName} ({r.repId})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Client</Label>
          <Select value={editForm.clientId} onValueChange={v => setEditForm({ ...editForm, clientId: v })}>
            <SelectTrigger data-testid="select-edit-client"><SelectValue /></SelectTrigger>
            <SelectContent>
              {clientsList.map((c: any) => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Provider</Label>
          <Select value={editForm.providerId} onValueChange={v => setEditForm({ ...editForm, providerId: v })}>
            <SelectTrigger data-testid="select-edit-provider"><SelectValue /></SelectTrigger>
            <SelectContent>
              {providersList.map((p: any) => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Service</Label>
          <Select value={editForm.serviceId} onValueChange={v => setEditForm({ ...editForm, serviceId: v })}>
            <SelectTrigger data-testid="select-edit-service"><SelectValue /></SelectTrigger>
            <SelectContent>
              {servicesList.map((s: any) => (
                <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Date Sold</Label>
          <Input type="date" value={editForm.dateSold} onChange={e => setEditForm({ ...editForm, dateSold: e.target.value })} data-testid="input-edit-date-sold" />
        </div>
        <div>
          <Label className="text-xs">Install Date</Label>
          <Input type="date" value={editForm.installDate} onChange={e => setEditForm({ ...editForm, installDate: e.target.value })} data-testid="input-edit-install-date" />
        </div>
        <div>
          <Label className="text-xs">Install Time</Label>
          <Input value={editForm.installTime} onChange={e => setEditForm({ ...editForm, installTime: e.target.value })} data-testid="input-edit-install-time" />
        </div>
        <div>
          <Label className="text-xs">Install Type</Label>
          <Select value={editForm.installType} onValueChange={v => setEditForm({ ...editForm, installType: v })}>
            <SelectTrigger data-testid="select-edit-install-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="STANDARD">Standard</SelectItem>
              <SelectItem value="SELF_INSTALL">Self Install</SelectItem>
              <SelectItem value="PRO_INSTALL">Pro Install</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Job Status</Label>
          <Select value={editForm.jobStatus} onValueChange={v => setEditForm({ ...editForm, jobStatus: v })}>
            <SelectTrigger data-testid="select-edit-job-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="CANCELED">Canceled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch checked={editForm.tvSold} onCheckedChange={v => setEditForm({ ...editForm, tvSold: v })} data-testid="switch-edit-tv" />
          <Label className="text-xs">TV Sold</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={editForm.mobileSold} onCheckedChange={v => setEditForm({ ...editForm, mobileSold: v })} data-testid="switch-edit-mobile" />
          <Label className="text-xs">Mobile Sold</Label>
        </div>
      </div>
      <div>
        <Label className="text-xs">Notes</Label>
        <Textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} data-testid="textarea-edit-notes" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSaveEdit} disabled={updateOrderMutation.isPending} data-testid="btn-save-edit">
          <Save className="h-3.5 w-3.5 mr-1" /> Save
        </Button>
        <Button size="sm" variant="outline" onClick={() => setIsEditing(false)} data-testid="btn-cancel-edit">Cancel</Button>
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="ops-order-tracker">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" data-testid="text-page-title">Order Tracker</h1>
          <p className="text-sm text-muted-foreground">
            {allOrders.length} total orders across all stages
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
            className="pl-9"
            data-testid="input-search-orders"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-muted/30 border rounded-lg p-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Filter By</Label>
          <Select value={dateFilterType} onValueChange={(v: "sold" | "install") => { setDateFilterType(v); setPage(1); }}>
            <SelectTrigger className="w-[140px] h-9" data-testid="select-date-filter-type">
              <Calendar className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sold">Date Sold</SelectItem>
              <SelectItem value="install">Install Date</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="w-[150px] h-9"
            data-testid="input-date-from"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">To</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="w-[150px] h-9"
            data-testid="input-date-to"
          />
        </div>
        {(dateFrom || dateTo) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-muted-foreground"
            onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
            data-testid="btn-clear-dates"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        )}
        {(dateFrom || dateTo) && (
          <span className="text-xs text-muted-foreground ml-auto self-center">
            {filteredOrders.length} orders match
          </span>
        )}
      </div>

      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {TAB_CONFIG.map(tab => {
          const count = buckets[tab.key]?.length || 0;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setPage(1); setSelectedIds(new Set()); }}
              className={`flex flex-col items-center gap-1 p-2 sm:p-3 rounded-lg border transition-all text-center ${
                activeTab === tab.key
                  ? "border-[#C9A84C] bg-[#C9A84C]/10 shadow-sm"
                  : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
              }`}
              data-testid={`tab-${tab.key}`}
            >
              <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${activeTab === tab.key ? "text-[#C9A84C]" : tab.color}`} />
              <span className={`text-lg sm:text-2xl font-bold ${activeTab === tab.key ? "text-[#C9A84C]" : ""}`}>{count}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "awaiting_approval" && paginatedOrders.length > 0 && (
        <div className="flex items-center gap-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg px-4 py-2">
          <Checkbox
            checked={paginatedOrders.every((o: any) => selectedIds.has(o.id))}
            onCheckedChange={toggleSelectAll}
            data-testid="checkbox-select-all"
          />
          <span className="text-sm font-medium">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
          </span>
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
              disabled={bulkApproveMutation.isPending}
              data-testid="btn-bulk-approve"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve Selected
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : paginatedOrders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No orders in this category{searchTerm ? " matching your search" : ""}.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="order-tracker-table">
              <thead>
                <tr className="bg-muted/50 border-b">
                  {activeTab === "awaiting_approval" && (
                    <th className="px-3 py-2.5 text-left w-10"></th>
                  )}
                  <th className="px-3 py-2.5 text-left font-medium">Invoice</th>
                  <th className="px-3 py-2.5 text-left font-medium">Rep</th>
                  <th className="px-3 py-2.5 text-left font-medium">Customer</th>
                  <th className="px-3 py-2.5 text-left font-medium">Service</th>
                  <th className="px-3 py-2.5 text-left font-medium">Date Sold</th>
                  <th className="px-3 py-2.5 text-left font-medium">Job</th>
                  <th className="px-3 py-2.5 text-left font-medium">Approval</th>
                  <th className="px-3 py-2.5 text-left font-medium">Payment</th>
                  {activeTab === "awaiting_approval" && (
                    <th className="px-3 py-2.5 text-left font-medium">Age</th>
                  )}
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOrders.map((o: any) => (
                  <tr
                    key={o.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => { setSelectedOrder(o); setIsEditing(false); }}
                    data-testid={`row-order-${o.id}`}
                  >
                    {activeTab === "awaiting_approval" && (
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={() => toggleSelect(o.id)}
                          data-testid={`checkbox-order-${o.id}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-mono text-xs">{o.invoiceNumber || "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{o.repName || o.repId}</span>
                      {o.repRoleAtSale && (
                        <Badge variant="outline" className={`text-[10px] ml-1 ${roleColors[o.repRoleAtSale] || ""}`}>
                          {o.repRoleAtSale}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 max-w-[150px] truncate">{o.customerName || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{o.serviceName || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">{fmtDate(o.dateSold)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={o.jobStatus} /></td>
                    <td className="px-3 py-2.5"><StatusBadge status={o.approvalStatus} /></td>
                    <td className="px-3 py-2.5"><StatusBadge status={o.paymentStatus} /></td>
                    {activeTab === "awaiting_approval" && (
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {o.dateSold ? `${getDaysSince(o.dateSold)}d` : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {activeTab === "awaiting_approval" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600" onClick={() => approveMutation.mutate(o.id)} data-testid={`btn-approve-${o.id}`}>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600" onClick={() => rejectMutation.mutate(o.id)} data-testid={`btn-reject-${o.id}`}>
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {activeTab === "approved" && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600" onClick={() => markPaidMutation.mutate(o.id)} data-testid={`btn-mark-paid-${o.id}`}>
                            <DollarSign className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, filteredOrders.length)} of {filteredOrders.length}
          </p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="btn-prev-page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm px-2">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={open => { if (!open) { setSelectedOrder(null); setIsEditing(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order {selectedOrder?.invoiceNumber || ""}</DialogTitle>
            <DialogDescription>
              {selectedOrder?.customerName || "Order"} — {selectedOrder?.serviceName || ""}
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (isEditing ? renderEditForm() : renderOrderDetail(selectedOrder))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
