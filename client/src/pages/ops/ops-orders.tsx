import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  CheckCircle2, XCircle, Search, Clock, AlertTriangle, ChevronLeft, ChevronRight,
  ShieldAlert, Pencil, Save, DollarSign, Package, User, Truck, FileCheck, CreditCard, Smartphone
} from "lucide-react";

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

const roleColors: Record<string, string> = {
  REP: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  MDU: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  LEAD: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  MANAGER: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

const statusBadgeColor: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700",
  COMPLETED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 border-blue-300 dark:border-blue-700",
  CANCELED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-300 dark:border-red-700",
  APPROVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-300 dark:border-green-700",
  UNAPPROVED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 border-red-300 dark:border-red-700",
  UNPAID: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300 border-gray-300 dark:border-gray-700",
  PAID: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 border-green-300 dark:border-green-700",
  PARTIALLY_PAID: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 border-orange-300 dark:border-orange-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`text-xs ${statusBadgeColor[status] || ""}`}>
      {status}
    </Badge>
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

export default function OpsOrders() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const limit = 25;

  const isDirector = user?.role === "DIRECTOR";

  const { data: pendingOrders, isLoading: pendingLoading } = useQuery<any[]>({
    queryKey: ["/api/orders", "?status=COMPLETED&limit=100"],
  });

  const { data: allOrdersData, isLoading: allLoading } = useQuery<any>({
    queryKey: ["/api/orders", `?status=${statusFilter === "all" ? "" : statusFilter}&search=${searchTerm}&page=${page}&limit=${limit}`],
  });

  const { data: usersData } = useQuery<any>({
    queryKey: ["/api/admin/users"],
    enabled: !isDirector,
  });

  const { data: servicesData } = useQuery<any>({
    queryKey: ["/api/services"],
    enabled: !isDirector,
  });

  const { data: clientsData } = useQuery<any>({
    queryKey: ["/api/clients"],
    enabled: !isDirector,
  });

  const { data: providersData } = useQuery<any>({
    queryKey: ["/api/providers"],
    enabled: !isDirector,
  });

  const allUsers = usersData?.users || usersData || [];
  const activeReps = Array.isArray(allUsers) ? allUsers.filter((u: any) => ["REP", "LEAD", "MANAGER", "MDU"].includes(u.role) && u.status === "ACTIVE") : [];
  const servicesList = Array.isArray(servicesData) ? servicesData : [];
  const clientsList = Array.isArray(clientsData) ? clientsData : [];
  const providersList = Array.isArray(providersData) ? providersData : [];

  const approvalQueue = useMemo(() => {
    if (!pendingOrders) return [];
    return (Array.isArray(pendingOrders) ? pendingOrders : []).filter(
      (o: any) => o.jobStatus === "COMPLETED" && o.approvalStatus !== "APPROVED"
    );
  }, [pendingOrders]);

  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return apiRequest("POST", `/api/orders/${orderId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return apiRequest("PATCH", `/api/orders/${orderId}`, { jobStatus: "CANCELED" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order rejected" });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      return apiRequest("POST", `/api/orders/bulk-approve`, { orderIds: ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedIds(new Set());
      toast({ title: `${selectedIds.size} orders approved` });
    },
    onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
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
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/orders/${id}/mark-paid`);
      return res.json();
    },
    onSuccess: (updatedOrder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order marked as paid" });
      if (selectedOrder) setSelectedOrder({ ...selectedOrder, paymentStatus: "PAID" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to mark paid", description: err.message, variant: "destructive" });
    },
  });

  const reverseApprovalMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/orders/${id}/reverse-approval`);
      return res.json();
    },
    onSuccess: (updatedOrder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Approval reversed" });
      if (selectedOrder) setSelectedOrder({ ...selectedOrder, approvalStatus: "UNAPPROVED", approvedAt: null });
    },
    onError: (err: any) => {
      toast({ title: "Failed to reverse approval", description: err.message, variant: "destructive" });
    },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === approvalQueue.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approvalQueue.map((o: any) => o.id)));
    }
  };

  const getDaysSince = (dateStr: string) => {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
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

  const allOrders = Array.isArray(allOrdersData) ? allOrdersData : (allOrdersData?.orders || []);
  const totalOrders = allOrdersData?.total || allOrders.length;

  const renderOrderDetail = (o: any) => {
    const approvedByUser = o.approvedByUserId ? allUsers.find((u: any) => u.id === o.approvedByUserId) : null;

    return (
      <div className="space-y-5" data-testid="order-detail-view">
        <SectionHeader icon={Package} title="Order Info" />
        <div className="grid grid-cols-3 gap-3 text-sm">
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
          <DetailRow label="Updated" value={fmtDateTime(o.updatedAt)} />
        </div>

        <SectionHeader icon={User} title="Customer" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <DetailRow label="Name" value={o.customerName} />
          <DetailRow label="Phone" value={o.customerPhone} />
          <DetailRow label="Email" value={o.customerEmail} />
          <DetailRow label="Account #" value={o.accountNumber} />
          <div className="col-span-3">
            <DetailRow label="Address" value={o.customerAddress || [o.houseNumber, o.streetName, o.aptUnit && `Apt ${o.aptUnit}`, o.city, o.zipCode].filter(Boolean).join(", ") || "—"} />
          </div>
        </div>

        <SectionHeader icon={Truck} title="Installation" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <DetailRow label="Job Status" value={<StatusBadge status={o.jobStatus || "PENDING"} />} />
          <DetailRow label="Install Date" value={fmtDate(o.installDate)} />
          <DetailRow label="Install Time" value={o.installTime || "—"} />
          <DetailRow label="Install Type" value={o.installType || "—"} />
          <DetailRow label="Completion Date" value={fmtDate(o.completionDate)} />
        </div>

        <SectionHeader icon={FileCheck} title="Approval & Payment" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <DetailRow label="Approval" value={<StatusBadge status={o.approvalStatus || "UNAPPROVED"} />} />
          <DetailRow label="Approved By" value={approvedByUser ? approvedByUser.name : (o.approvedByUserId ? o.approvedByUserId.slice(0, 8) : "—")} />
          <DetailRow label="Approved At" value={fmtDateTime(o.approvedAt)} />
          <DetailRow label="Payment" value={<StatusBadge status={o.paymentStatus || "UNPAID"} />} />
          <DetailRow label="Paid Date" value={fmtDate(o.paidDate)} />
          <DetailRow label="Pay Run" value={o.payRunId ? o.payRunId.slice(0, 8) + "…" : "—"} />
        </div>

        {!isDirector && (
          <>
            <SectionHeader icon={CreditCard} title="Commission & Financials" />
            <div className="grid grid-cols-3 gap-3 text-sm">
              <DetailRow label="Base Commission" value={fmtMoney(o.baseCommissionEarned)} />
              <DetailRow label="Commission Paid" value={fmtMoney(o.commissionPaid)} />
              <DetailRow label="Override Deduction" value={fmtMoney(o.overrideDeduction)} />
              <DetailRow label="Incentive" value={fmtMoney(o.incentiveEarned)} />
              <DetailRow label="Commission Source" value={o.commissionSource || "CALCULATED"} />
              <DetailRow label="Rack Rate" value={fmtCents(o.ironCrestRackRateCents)} />
              <DetailRow label="Profit" value={fmtCents(o.ironCrestProfitCents)} show={user?.role === "EXECUTIVE"} />
              <DetailRow label="Expected Amount" value={fmtCents(o.expectedAmountCents)} show={!!o.expectedAmountCents} />
              <DetailRow label="Client Acceptance" value={o.clientAcceptanceStatus ? <StatusBadge status={o.clientAcceptanceStatus} /> : "—"} />
              <DetailRow label="Reserve Withheld" value={fmtCents(o.reserveWithheldCents)} show={o.reserveWithheldCents > 0} />
              <DetailRow label="Reserve Released" value={fmtCents(o.reserveReleasedCents)} show={o.reserveReleasedCents > 0} />
              <DetailRow label="Payroll Ready" value={fmtDateTime(o.payrollReadyAt)} show={!!o.payrollReadyAt} />
              <DetailRow label="Payroll Hold" value={o.payrollHoldReason || "—"} show={o.isPayrollHeld} />
            </div>
          </>
        )}

        {(o.mobileSold || o.isMobileOrder) && (
          <>
            <SectionHeader icon={Smartphone} title="Mobile" />
            <div className="grid grid-cols-3 gap-3 text-sm">
              <DetailRow label="Product Type" value={o.mobileProductType || "—"} />
              <DetailRow label="Ported Status" value={o.mobilePortedStatus || "—"} />
              <DetailRow label="Lines" value={o.mobileLinesQty || 0} />
            </div>
          </>
        )}

        {o.chargebackRiskScore != null && (
          <div className="p-3 rounded-lg bg-muted/50 border" data-testid="section-risk-detail">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4" /> Chargeback Risk
              </p>
              <RiskBadge score={o.chargebackRiskScore} />
            </div>
            {o.chargebackRiskFactors && (() => {
              try {
                const factors = JSON.parse(o.chargebackRiskFactors);
                const triggered = factors.filter((f: any) => f.triggered);
                if (triggered.length === 0) return <p className="text-xs text-muted-foreground">No risk factors triggered</p>;
                return (
                  <ul className="space-y-1">
                    {triggered.map((f: any, i: number) => (
                      <li key={i} className="text-xs flex items-start gap-1.5">
                        <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 flex-shrink-0" />
                        <span>{f.factor} <span className="text-muted-foreground">(+{f.weight})</span>{f.detail ? ` — ${f.detail}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                );
              } catch { return null; }
            })()}
          </div>
        )}

        {o.notes && (
          <div className="text-sm p-3 bg-muted/30 rounded-lg border">
            <p className="text-xs text-muted-foreground mb-1">Notes</p>
            <p className="whitespace-pre-wrap">{o.notes}</p>
          </div>
        )}

        {!isDirector && (
          <div className="flex gap-2 flex-wrap pt-3 border-t">
            {o.approvalStatus !== "APPROVED" && o.jobStatus !== "CANCELED" && (
              <Button size="sm" onClick={() => { approveMutation.mutate(o.id); setSelectedOrder(null); }} data-testid="btn-approve-detail">
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
              </Button>
            )}
            {o.approvalStatus !== "APPROVED" && o.jobStatus !== "CANCELED" && (
              <Button size="sm" variant="destructive" onClick={() => { rejectMutation.mutate(o.id); setSelectedOrder(null); }} data-testid="btn-reject-detail">
                <XCircle className="h-4 w-4 mr-1" /> Reject
              </Button>
            )}
            {o.approvalStatus === "APPROVED" && (
              <Button size="sm" variant="outline" onClick={() => reverseApprovalMutation.mutate(o.id)}
                disabled={reverseApprovalMutation.isPending} data-testid="btn-reverse-approval">
                <XCircle className="h-4 w-4 mr-1" /> Reverse Approval
              </Button>
            )}
            {o.paymentStatus !== "PAID" && (
              <Button size="sm" variant="outline" onClick={() => markPaidMutation.mutate(o.id)}
                disabled={markPaidMutation.isPending} data-testid="btn-mark-paid">
                <DollarSign className="h-4 w-4 mr-1" /> Mark Paid
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderEditForm = () => {
    const isCompleted = selectedOrder?.jobStatus === "COMPLETED";

    return (
      <div className="space-y-5" data-testid="order-edit-form">
        <SectionHeader icon={Package} title="Order Info" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Assigned Rep</Label>
            <Select value={editForm.repId} onValueChange={v => setEditForm(f => ({ ...f, repId: v }))}>
              <SelectTrigger data-testid="edit-rep-id"><SelectValue placeholder="Select rep" /></SelectTrigger>
              <SelectContent>
                {activeReps.map((u: any) => (
                  <SelectItem key={u.id} value={u.repId}>{u.name} ({u.repId})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date Sold</Label>
            <Input type="date" value={editForm.dateSold} onChange={e => setEditForm(f => ({ ...f, dateSold: e.target.value }))} data-testid="edit-date-sold" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Provider</Label>
            <Select value={editForm.providerId} onValueChange={v => setEditForm(f => ({ ...f, providerId: v }))}>
              <SelectTrigger data-testid="edit-provider-id"><SelectValue placeholder="Select provider" /></SelectTrigger>
              <SelectContent>
                {providersList.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Client</Label>
            <Select value={editForm.clientId} onValueChange={v => setEditForm(f => ({ ...f, clientId: v }))}>
              <SelectTrigger data-testid="edit-client-id"><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clientsList.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Service</Label>
            <Select value={editForm.serviceId} onValueChange={v => setEditForm(f => ({ ...f, serviceId: v }))}>
              <SelectTrigger data-testid="edit-service-id"><SelectValue placeholder="Select service" /></SelectTrigger>
              <SelectContent>
                {servicesList.map((s: any) => (
                  <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Account #</Label>
            <Input value={editForm.accountNumber} onChange={e => setEditForm(f => ({ ...f, accountNumber: e.target.value }))} data-testid="edit-account-number" />
          </div>
        </div>

        <SectionHeader icon={User} title="Customer" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Customer Name</Label>
            <Input value={editForm.customerName} onChange={e => setEditForm(f => ({ ...f, customerName: e.target.value }))} data-testid="edit-customer-name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone</Label>
            <Input value={editForm.customerPhone} onChange={e => setEditForm(f => ({ ...f, customerPhone: e.target.value }))} data-testid="edit-customer-phone" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Email</Label>
            <Input value={editForm.customerEmail} onChange={e => setEditForm(f => ({ ...f, customerEmail: e.target.value }))} data-testid="edit-customer-email" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">House #</Label>
            <Input value={editForm.houseNumber} onChange={e => setEditForm(f => ({ ...f, houseNumber: e.target.value }))} data-testid="edit-house-number" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Street</Label>
            <Input value={editForm.streetName} onChange={e => setEditForm(f => ({ ...f, streetName: e.target.value }))} data-testid="edit-street-name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Apt/Unit</Label>
            <Input value={editForm.aptUnit} onChange={e => setEditForm(f => ({ ...f, aptUnit: e.target.value }))} data-testid="edit-apt-unit" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">City</Label>
            <Input value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} data-testid="edit-city" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Zip Code</Label>
            <Input value={editForm.zipCode} onChange={e => setEditForm(f => ({ ...f, zipCode: e.target.value }))} data-testid="edit-zip-code" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Full Address</Label>
            <Input value={editForm.customerAddress} onChange={e => setEditForm(f => ({ ...f, customerAddress: e.target.value }))} data-testid="edit-customer-address" />
          </div>
        </div>

        <SectionHeader icon={Truck} title="Installation" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Job Status</Label>
            <Select value={editForm.jobStatus} onValueChange={v => setEditForm(f => ({ ...f, jobStatus: v }))}>
              <SelectTrigger data-testid="edit-job-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELED">Canceled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Install Date</Label>
            <Input type="date" value={editForm.installDate} onChange={e => setEditForm(f => ({ ...f, installDate: e.target.value }))} data-testid="edit-install-date" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Install Time</Label>
            <Input value={editForm.installTime} placeholder="e.g. 9:00 AM - 12:00 PM" onChange={e => setEditForm(f => ({ ...f, installTime: e.target.value }))} data-testid="edit-install-time" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Install Type</Label>
            <Select value={editForm.installType || "__none__"} onValueChange={v => setEditForm(f => ({ ...f, installType: v === "__none__" ? "" : v }))}>
              <SelectTrigger data-testid="edit-install-type"><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                <SelectItem value="AGENT_INSTALL">Agent Install</SelectItem>
                <SelectItem value="DIRECT_SHIP">Direct Ship</SelectItem>
                <SelectItem value="TECH_INSTALL">Tech Install</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <SectionHeader icon={Smartphone} title="Add-ons" />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-2 rounded border">
            <Switch checked={editForm.tvSold} onCheckedChange={v => setEditForm(f => ({ ...f, tvSold: v }))} id="edit-tv" data-testid="edit-tv-sold" />
            <Label htmlFor="edit-tv" className="text-xs cursor-pointer">TV Sold</Label>
          </div>
          <div className="flex items-center gap-3 p-2 rounded border">
            <Switch checked={editForm.mobileSold} onCheckedChange={v => setEditForm(f => ({ ...f, mobileSold: v }))} id="edit-mobile" data-testid="edit-mobile-sold" />
            <Label htmlFor="edit-mobile" className="text-xs cursor-pointer">Mobile Sold</Label>
          </div>
          {editForm.mobileSold && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Product Type</Label>
                <Select value={editForm.mobileProductType || "__none__"} onValueChange={v => setEditForm(f => ({ ...f, mobileProductType: v === "__none__" ? "" : v }))}>
                  <SelectTrigger data-testid="edit-mobile-product-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="UNLIMITED">Unlimited</SelectItem>
                    <SelectItem value="3_GIG">3 GIG</SelectItem>
                    <SelectItem value="1_GIG">1 GIG</SelectItem>
                    <SelectItem value="BYOD">BYOD</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ported Status</Label>
                <Select value={editForm.mobilePortedStatus || "__none__"} onValueChange={v => setEditForm(f => ({ ...f, mobilePortedStatus: v === "__none__" ? "" : v }))}>
                  <SelectTrigger data-testid="edit-mobile-ported"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="PORTED">Ported</SelectItem>
                    <SelectItem value="NON_PORTED">Non-Ported</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lines Qty</Label>
                <Input type="number" min="0" value={editForm.mobileLinesQty} onChange={e => setEditForm(f => ({ ...f, mobileLinesQty: e.target.value }))} data-testid="edit-mobile-lines" />
              </div>
            </>
          )}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={3} data-testid="edit-notes" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
          <Button onClick={handleSaveEdit} disabled={updateOrderMutation.isPending}
            className="bg-[#C9A84C] hover:bg-[#b8973e] text-white" data-testid="btn-save-order">
            <Save className="h-4 w-4 mr-1" />
            {updateOrderMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" data-testid="ops-orders">
      <h1 className="text-2xl font-bold mb-6">Order Management</h1>

      <Tabs defaultValue={isDirector ? "all" : "approval"} className="space-y-4">
        <TabsList>
          {!isDirector && (
            <TabsTrigger value="approval" data-testid="tab-approval">
              Needs Approval ({approvalQueue.length})
            </TabsTrigger>
          )}
          <TabsTrigger value="all" data-testid="tab-all-orders">
            All Orders
          </TabsTrigger>
        </TabsList>

        {!isDirector && (
          <TabsContent value="approval" className="space-y-4">
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
                <Button
                  size="sm"
                  onClick={() => bulkApproveMutation.mutate([...selectedIds])}
                  disabled={bulkApproveMutation.isPending}
                  data-testid="btn-bulk-approve"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approve Selected
                </Button>
              </div>
            )}

            {pendingLoading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
            ) : approvalQueue.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  No orders pending approval
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Checkbox
                    checked={selectedIds.size === approvalQueue.length && approvalQueue.length > 0}
                    onCheckedChange={toggleSelectAll}
                    data-testid="checkbox-select-all"
                  />
                  <span className="text-sm text-muted-foreground">Select All</span>
                </div>
                {approvalQueue.map((order: any) => {
                  const days = getDaysSince(order.completedAt || order.createdAt);
                  return (
                    <Card key={order.id} className={days >= 5 ? "border-red-300 dark:border-red-700" : ""} data-testid={`approval-order-${order.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedIds.has(order.id)}
                            onCheckedChange={() => toggleSelect(order.id)}
                          />
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setSelectedOrder(order); setIsEditing(false); }}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{order.repName || order.repId}</span>
                              {order.repRoleAtSale && (
                                <Badge variant="outline" className={`text-xs ${roleColors[order.repRoleAtSale] || ""}`}>
                                  {order.repRoleAtSale}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {order.customerName} · {order.serviceName || "N/A"}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {!isDirector && <span>{fmtMoney(order.baseCommissionEarned)}</span>}
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {days}d ago
                              </span>
                              {days >= 5 && (
                                <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Overdue
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button
                              size="sm"
                              onClick={() => approveMutation.mutate(order.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`btn-approve-${order.id}`}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => rejectMutation.mutate(order.id)}
                              disabled={rejectMutation.isPending}
                              data-testid={`btn-reject-${order.id}`}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="all" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer, rep, invoice..."
                className="pl-9"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
                data-testid="input-search-orders"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="CANCELED">Canceled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {allLoading ? (
            <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3 font-medium">Invoice</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Customer</th>
                      <th className="text-left p-3 font-medium hidden lg:table-cell">Rep</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Service</th>
                      <th className="text-left p-3 font-medium">Job</th>
                      <th className="text-left p-3 font-medium hidden sm:table-cell">Approval</th>
                      <th className="text-left p-3 font-medium hidden sm:table-cell">Payment</th>
                      {!isDirector && <th className="text-right p-3 font-medium hidden lg:table-cell">Commission</th>}
                      <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allOrders.map((order: any) => (
                      <tr key={order.id} className="border-t hover:bg-muted/50 cursor-pointer" onClick={() => { setSelectedOrder(order); setIsEditing(false); }} data-testid={`order-row-${order.id}`}>
                        <td className="p-3 font-mono text-xs">{order.invoiceNumber || "—"}</td>
                        <td className="p-3 hidden md:table-cell">{order.customerName}</td>
                        <td className="p-3 hidden lg:table-cell">{order.repName || order.repId}</td>
                        <td className="p-3 hidden md:table-cell text-xs">{order.serviceName || "—"}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <StatusBadge status={order.jobStatus || "PENDING"} />
                            <RiskBadge score={order.chargebackRiskScore} />
                          </div>
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <StatusBadge status={order.approvalStatus || "UNAPPROVED"} />
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          <StatusBadge status={order.paymentStatus || "UNPAID"} />
                        </td>
                        {!isDirector && (
                          <td className="p-3 text-right hidden lg:table-cell">
                            {fmtMoney(order.baseCommissionEarned)}
                          </td>
                        )}
                        <td className="p-3 text-right">
                          <Button size="sm" variant="ghost" data-testid={`btn-view-${order.id}`}>
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {allOrders.length} of {totalOrders} orders
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)} data-testid="btn-prev-page">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={allOrders.length < limit} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => { if (!open) { setSelectedOrder(null); setIsEditing(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{isEditing ? "Edit Order" : "Order Details"}</span>
              {!isDirector && !isEditing && (
                <Button size="sm" variant="outline" onClick={() => openEditMode(selectedOrder)} data-testid="btn-edit-order">
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
            </DialogTitle>
            {selectedOrder && (
              <DialogDescription>
                {selectedOrder.invoiceNumber || `Order ${selectedOrder.id?.slice(0, 8)}`}
              </DialogDescription>
            )}
          </DialogHeader>
          {selectedOrder && !isEditing && renderOrderDetail(selectedOrder)}
          {selectedOrder && isEditing && !isDirector && renderEditForm()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
