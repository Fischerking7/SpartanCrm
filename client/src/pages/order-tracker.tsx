import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n/config";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, NativeSelect, useIsTouchDevice } from "@/components/ui/select";
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
  Filter,
  Pencil,
  Save,
  MapPin,
  Phone,
  User,
  Loader2,
  StickyNote,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { SalesOrder, Client, Provider, Service, User as UserType } from "@shared/schema";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileFilterDrawer } from "@/components/mobile-filter-drawer";

interface MobileLineEntry {
  mobileProductType: string;
  mobilePortedStatus: string;
}

type OrderStatus = "pending" | "completed" | "approved" | "paid" | "canceled";

function getOrderStatus(order: SalesOrder): OrderStatus {
  if (order.jobStatus === "CANCELED") return "canceled";
  if (order.paymentStatus === "PAID") return "paid";
  if (order.approvalStatus === "APPROVED") return "approved";
  if (order.jobStatus === "COMPLETED") return "completed";
  return "pending";
}

function getStatusConfig(status: OrderStatus) {
  switch (status) {
    case "pending":
      return { label: i18n.t("orderTracker.pending"), variant: "outline" as const, icon: Clock, color: "text-yellow-600 dark:text-yellow-400" };
    case "completed":
      return { label: i18n.t("orderTracker.connected"), variant: "secondary" as const, icon: CheckCircle2, color: "text-blue-600 dark:text-blue-400" };
    case "approved":
      return { label: i18n.t("orderTracker.approved"), variant: "default" as const, icon: ThumbsUp, color: "text-green-600 dark:text-green-400" };
    case "paid":
      return { label: i18n.t("orderTracker.paid"), variant: "default" as const, icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400" };
    case "canceled":
      return { label: i18n.t("orderTracker.cancelled"), variant: "outline" as const, icon: XCircle, color: "text-muted-foreground" };
  }
}

function getStepIndex(status: OrderStatus): number {
  switch (status) {
    case "pending": return 0;
    case "completed": return 1;
    case "approved": return 2;
    case "paid": return 3;
    case "canceled": return -1;
  }
}

const getPipelineSteps = () => [
  { label: i18n.t("orderTracker.pending"), icon: Clock },
  { label: i18n.t("orderTracker.connected"), icon: CheckCircle2 },
  { label: i18n.t("orderTracker.approved"), icon: ThumbsUp },
  { label: i18n.t("orderTracker.paid"), icon: DollarSign },
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
      {getPipelineSteps().map((step, i) => {
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
            {i < getPipelineSteps().length - 1 && (
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
  canSeeGross,
  canSeeCommission,
  isEditing,
  onEdit,
  onCancelEdit,
  onSelect,
  isSelectable,
  isSelected,
  onToggleSelect,
  repName,
}: {
  order: SalesOrder;
  clientMap: Map<string, string>;
  providerMap: Map<string, string>;
  serviceMap: Map<string, string>;
  services: Service[];
  canSeeGross: boolean;
  canSeeCommission: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
  isSelectable?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  repName?: string;
}) {
  const { toast } = useToast();
  const status = getOrderStatus(order);
  const config = getStatusConfig(status);
  const netCommission = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned || "0");
  const grossCommission = parseFloat((order as any).grossCommissionTotal || "0");
  const displayCommission = canSeeGross ? grossCommission : netCommission;
  const clientName = clientMap.get(order.clientId) || "Unknown";
  const providerName = providerMap.get(order.providerId) || "Unknown";
  const serviceName = serviceMap.get(order.serviceId) || "";

  const [formData, setFormData] = useState({
    customerName: order.customerName || "",
    customerAddress: order.customerAddress || "",
    houseNumber: order.houseNumber || "",
    streetName: order.streetName || "",
    aptUnit: order.aptUnit || "",
    city: order.city || "",
    zipCode: order.zipCode || "",
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
      toast({ title: i18n.t("orderTracker.orderUpdated"), description: i18n.t("orderTracker.changesSaved") });
      onCancelEdit();
    },
    onError: (err: any) => {
      toast({ title: i18n.t("orderTracker.updateFailed"), description: err.message || i18n.t("orderTracker.couldNotSaveChanges"), variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, { jobStatus: newStatus });
      return res.json();
    },
    onSuccess: (_, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      const label = newStatus === "COMPLETED" ? i18n.t("orderTracker.connected") : newStatus === "PENDING" ? i18n.t("orderTracker.pending") : i18n.t("orderTracker.cancelled");
      toast({ title: `${i18n.t("orderTracker.orderUpdated")}: ${label}` });
    },
    onError: (err: any) => {
      toast({ title: i18n.t("orderTracker.statusUpdateFailed"), description: err.message || i18n.t("orderTracker.couldNotUpdateStatus"), variant: "destructive" });
    },
  });

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload: Record<string, any> = {};
    if (formData.customerName !== (order.customerName || "")) payload.customerName = formData.customerName;
    if (formData.customerAddress !== (order.customerAddress || "")) payload.customerAddress = formData.customerAddress;
    if (formData.houseNumber !== (order.houseNumber || "")) payload.houseNumber = formData.houseNumber;
    if (formData.streetName !== (order.streetName || "")) payload.streetName = formData.streetName;
    if (formData.aptUnit !== (order.aptUnit || "")) payload.aptUnit = formData.aptUnit;
    if (formData.city !== (order.city || "")) payload.city = formData.city;
    if (formData.zipCode !== (order.zipCode || "")) payload.zipCode = formData.zipCode;
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
                {i18n.t("orderTracker.cancel")}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending} data-testid={`button-save-inline-${order.id}`}>
                {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                {i18n.t("orderTracker.save")}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.customerName")}</Label>
              <Input
                value={formData.customerName}
                onChange={(e) => updateField("customerName", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-customer-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.accountNumber")}</Label>
              <Input
                value={formData.accountNumber}
                onChange={(e) => updateField("accountNumber", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-account-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.phone")}</Label>
              <Input
                value={formData.customerPhone}
                onChange={(e) => updateField("customerPhone", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-phone-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.email")}</Label>
              <Input
                value={formData.customerEmail}
                onChange={(e) => updateField("customerEmail", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-email-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.installDate")}</Label>
              <Input
                type="date"
                value={formData.installDate}
                onChange={(e) => updateField("installDate", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-date-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.service")}</Label>
              <Select value={formData.serviceId} onValueChange={(v) => updateField("serviceId", v)}>
                <SelectTrigger onClick={(e) => e.stopPropagation()} data-testid={`select-inline-service-${order.id}`}>
                  <SelectValue placeholder={i18n.t("orderTracker.selectService")} />
                </SelectTrigger>
                <SelectContent>
                  {services.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.houseBuilding")}</Label>
              <Input
                value={formData.houseNumber || ""}
                onChange={(e) => updateField("houseNumber", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-house-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.streetName")}</Label>
              <Input
                value={formData.streetName || ""}
                onChange={(e) => updateField("streetName", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-street-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.aptUnit")}</Label>
              <Input
                value={formData.aptUnit || ""}
                onChange={(e) => updateField("aptUnit", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-apt-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.city")}</Label>
              <Input
                value={formData.city || ""}
                onChange={(e) => updateField("city", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-city-${order.id}`}
              />
            </div>
            <div>
              <Label className="text-xs">{i18n.t("orderTracker.zipCode")}</Label>
              <Input
                value={formData.zipCode || ""}
                onChange={(e) => updateField("zipCode", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                data-testid={`input-inline-zip-${order.id}`}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`hover-elevate cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
      onClick={isSelectable ? onToggleSelect : onSelect}
      data-testid={`card-order-${order.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4 flex-wrap">
          {isSelectable && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect?.()}
              onClick={(e) => e.stopPropagation()}
              className="h-5 w-5 shrink-0"
              data-testid={`checkbox-select-order-${order.id}`}
            />
          )}
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
              {order.isMobileOrder && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                  <Smartphone className="h-2.5 w-2.5 mr-0.5" />Mobile
                </Badge>
              )}
              {order.tvSold && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">TV</Badge>
              )}
            </div>
            <div className="flex items-center gap-x-3 gap-y-0.5 mt-1.5 text-sm text-muted-foreground flex-wrap">
              <span className="font-medium text-foreground/80">{serviceName || i18n.t("orderTracker.noService")}</span>
              <span className="text-xs">|</span>
              <span>{providerName} - {clientName}</span>
              {repName && (
                <>
                  <span className="text-xs">|</span>
                  <span>Rep: {repName}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground flex-wrap">
              {order.dateSold && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {i18n.t("orderTracker.soldPrefix")}: {new Intl.DateTimeFormat(i18n.language === "es" ? "es-MX" : "en-US").format(new Date(order.dateSold))}
                </span>
              )}
              {order.installDate && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {i18n.t("orderTracker.installPrefix")}: {new Intl.DateTimeFormat(i18n.language === "es" ? "es-MX" : "en-US").format(new Date(order.installDate))}
                </span>
              )}
              {order.customerPhone && (
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {order.customerPhone}
                </span>
              )}
              {order.customerEmail && (
                <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                  {order.customerEmail}
                </span>
              )}
            </div>
            <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground flex-wrap">
              {(order.houseNumber || order.streetName || order.city || order.zipCode || order.customerAddress) && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {(() => {
                    const parts = [order.houseNumber, order.streetName, order.aptUnit].filter(Boolean).join(" ");
                    const location = [parts, order.city, order.zipCode].filter(Boolean).join(", ");
                    const display = location || order.customerAddress || "";
                    return display.length > 60 ? display.slice(0, 60) + "..." : display;
                  })()}
                </span>
              )}
              {order.invoiceNumber && (
                <span className="font-mono text-[11px]">{order.invoiceNumber}</span>
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

          <div className="flex items-center gap-1.5">
            {status === "pending" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); statusMutation.mutate("COMPLETED"); }}
                  disabled={statusMutation.isPending}
                  data-testid={`button-complete-${order.id}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Complete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); statusMutation.mutate("CANCELED"); }}
                  disabled={statusMutation.isPending}
                  data-testid={`button-cancel-order-${order.id}`}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Cancel
                </Button>
              </>
            )}
            {status === "completed" && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => { e.stopPropagation(); statusMutation.mutate("PENDING"); }}
                disabled={statusMutation.isPending}
                data-testid={`button-revert-pending-${order.id}`}
              >
                <Clock className="h-3.5 w-3.5 mr-1" />
                Revert
              </Button>
            )}
          </div>

          <div className="text-right min-w-[100px]">
            {canSeeCommission ? (
              <>
                <p className="font-mono font-medium" data-testid={`text-commission-${order.id}`}>
                  ${displayCommission.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {canSeeGross ? i18n.t("orderTracker.gross") : i18n.t("orderTracker.net")}
                </p>
              </>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {new Intl.DateTimeFormat(i18n.language === "es" ? "es-MX" : "en-US").format(new Date(order.dateSold))}
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
  const { t } = useTranslation();
  const { toast } = useToast();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  const isMobile = useIsMobile();
  const canSeeGrossCommissions = ["EXECUTIVE", "ADMIN", "OPERATIONS", "DIRECTOR", "ACCOUNTING"].includes(user?.role || "");
  const canSeeCommission = ["EXECUTIVE", "ADMIN", "OPERATIONS", "DIRECTOR", "ACCOUNTING"].includes(user?.role || "");
  const hasViewModeToggle = ["LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE"].includes(user?.role || "");
  const [viewMode, setViewMode] = useState<"own" | "team" | "global">("own");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [orderType, setOrderType] = useState<"data" | "mobile">("data");
  const [dateRange, setDateRange] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const isAdmin = ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user?.role || "");
  const isTouchDevice = useIsTouchDevice();
  const isPaidTab = activeTab === "paid";

  const getTodayDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const [newOrderForm, setNewOrderForm] = useState({
    repId: "",
    clientId: "",
    providerId: "",
    serviceId: "",
    dateSold: getTodayDate(),
    installDate: "",
    installTime: "",
    installType: "",
    accountNumber: "",
    customerName: "",
    customerAddress: "",
    houseNumber: "",
    streetName: "",
    aptUnit: "",
    city: "",
    zipCode: "",
    customerPhone: "",
    customerEmail: "",
    hasTv: false,
  });

  const resetNewOrderForm = () => {
    setNewOrderForm({
      repId: "", clientId: "", providerId: "", serviceId: "", dateSold: getTodayDate(),
      installDate: "", installTime: "", installType: "", accountNumber: "",
      customerName: "", customerAddress: "", houseNumber: "", streetName: "", aptUnit: "", city: "", zipCode: "",
      customerPhone: "", customerEmail: "",
      hasTv: false,
    });
  };

  const [showMobileOrderDialog, setShowMobileOrderDialog] = useState(false);
  const [mobileOrderForm, setMobileOrderForm] = useState({
    repId: "",
    clientId: "",
    providerId: "",
    serviceId: "",
    dateSold: getTodayDate(),
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
      repId: "", clientId: "", providerId: "", serviceId: "",
      dateSold: getTodayDate(), customerName: "", customerPhone: "", customerAddress: "",
      accountNumber: "",
      mobileLines: [{ mobileProductType: "", mobilePortedStatus: "" }],
    });
  };

  const effectiveViewMode = hasViewModeToggle ? viewMode : (["ADMIN", "OPERATIONS"].includes(user?.role || "") ? undefined : "own");
  const { data: orders, isLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/orders", "tracker", effectiveViewMode || "all"],
    queryFn: async () => {
      const params = effectiveViewMode ? `?viewMode=${effectiveViewMode}` : "";
      const res = await fetch(`/api/orders${params}`, { headers: getAuthHeaders() });
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

  const { data: reps } = useQuery<UserType[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const users = await res.json();
      const salesRoles = ["REP", "LEAD", "MANAGER", "EXECUTIVE"];
      return users.filter((u: UserType) => salesRoles.includes(u.role) && u.status === "ACTIVE" && !u.deletedAt);
    },
    enabled: isAdmin,
  });

  useEffect(() => {
    if (showNewOrderDialog && clients?.length === 1 && !newOrderForm.clientId) {
      setNewOrderForm(f => ({ ...f, clientId: clients[0].id }));
    }
  }, [showNewOrderDialog, clients, newOrderForm.clientId]);

  useEffect(() => {
    if (showNewOrderDialog && providers?.length === 1 && !newOrderForm.providerId) {
      setNewOrderForm(f => ({ ...f, providerId: providers[0].id }));
    }
  }, [showNewOrderDialog, providers, newOrderForm.providerId]);

  useEffect(() => {
    if (showMobileOrderDialog && clients?.length === 1 && !mobileOrderForm.clientId) {
      setMobileOrderForm(f => ({ ...f, clientId: clients[0].id }));
    }
  }, [showMobileOrderDialog, clients, mobileOrderForm.clientId]);

  useEffect(() => {
    if (showMobileOrderDialog && providers?.length === 1 && !mobileOrderForm.providerId) {
      setMobileOrderForm(f => ({ ...f, providerId: providers[0].id }));
    }
  }, [showMobileOrderDialog, providers, mobileOrderForm.providerId]);

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
    staleTime: 0,
  });

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
    staleTime: 0,
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
      toast({ title: t("orderTracker.mobileOrderCreated") });
    },
    onError: (error: Error) => {
      toast({ title: t("orderTracker.failedToCreateMobileOrder"), description: error.message, variant: "destructive" });
    },
  });

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
      toast({ title: t("orderTracker.orderCreated") });
    },
    onError: (error: Error) => {
      toast({ title: t("orderTracker.failedToCreate"), description: error.message, variant: "destructive" });
    },
  });

  const handleCreateOrder = () => {
    if (!newOrderForm.customerName || !newOrderForm.dateSold) {
      toast({ title: t("orderTracker.missingRequiredFields"), description: t("orderTracker.customerNameRequired"), variant: "destructive" });
      return;
    }
    if (isAdmin && !newOrderForm.repId) {
      toast({ title: t("orderTracker.missingRequiredFields"), description: t("orderTracker.repIdRequired"), variant: "destructive" });
      return;
    }
    createOrderMutation.mutate(newOrderForm);
  };

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

  const repMap = useMemo(() => {
    const map = new Map<string, string>();
    if (reps) {
      reps.forEach(r => map.set(r.repId, r.name));
    }
    if (user) {
      map.set(user.repId, user.name);
    }
    return map;
  }, [reps, user]);

  const dateFilteredOrders = useMemo(() => {
    if (!orders) return [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const dow = now.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return orders.filter(o => {
      const isMobile = (o as any).isMobileOrder === true;
      if (orderType === "data" && isMobile) return false;
      if (orderType === "mobile" && !isMobile) return false;

      if (dateRange === "all") return true;
      const sold = new Date(o.dateSold);
      if (dateRange === "today") return sold >= today;
      if (dateRange === "this_week") return sold >= weekStart;
      if (dateRange === "this_month") return sold >= monthStart;
      return true;
    });
  }, [orders, dateRange, orderType]);

  const stats = useMemo(() => {
    const all = dateFilteredOrders;
    const pending = all.filter(o => getOrderStatus(o) === "pending").length;
    const completed = all.filter(o => getOrderStatus(o) === "completed").length;
    const approved = all.filter(o => getOrderStatus(o) === "approved").length;
    const paid = all.filter(o => getOrderStatus(o) === "paid").length;
    const totalEarned = all
      .filter(o => getOrderStatus(o) === "approved" || getOrderStatus(o) === "paid")
      .reduce((sum, o) => {
        if (canSeeGrossCommissions) {
          return sum + parseFloat((o as any).grossCommissionTotal || "0");
        }
        return sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned || "0");
      }, 0);
    return { pending, completed, approved, paid, total: all.length, totalEarned };
  }, [dateFilteredOrders, canSeeGrossCommissions]);

  const filteredOrders = useMemo(() => {
    return dateFilteredOrders.filter(o => {
      const status = getOrderStatus(o);
      if (activeTab === "pending" && status === "pending") return true;
      if (activeTab === "completed" && status === "completed") return true;
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
        pending: 0, completed: 1, approved: 2, canceled: 3, paid: 4,
      };
      const sPri = statusPriority[getOrderStatus(a)] - statusPriority[getOrderStatus(b)];
      if (sPri !== 0) return sPri;
      return new Date(b.dateSold).getTime() - new Date(a.dateSold).getTime();
    });
  }, [filteredOrders]);

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        <Skeleton className="h-7 w-40 md:h-8 md:w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-20 md:h-24" />
          ))}
        </div>
        <Skeleton className="h-64 md:h-96" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 md:gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold" data-testid="text-order-tracker-title">
            {t("orderTracker.title")}
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            {hasViewModeToggle && viewMode === "team" ? t("orderTracker.viewingTeamOrders") :
             hasViewModeToggle && viewMode === "global" ? t("orderTracker.viewingAllOrders") :
             t("orderTracker.trackFromSaleToPayment")}
          </p>
          {hasViewModeToggle && (
            <div className="flex items-center gap-1 mt-2 bg-muted rounded-lg p-1">
              <Button
                variant={viewMode === "own" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-3"
                onClick={() => setViewMode("own")}
                data-testid="button-view-my-orders"
              >
                {t("orderTracker.myOrders")}
              </Button>
              <Button
                variant={viewMode === "team" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-3"
                onClick={() => setViewMode("team")}
                data-testid="button-view-my-team"
              >
                {t("orderTracker.myTeam")}
              </Button>
              {(user?.role === "EXECUTIVE" || user?.role === "MANAGER") && (
                <Button
                  variant={viewMode === "global" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-xs px-3"
                  onClick={() => setViewMode("global")}
                  data-testid="button-view-global"
                >
                  {t("orderTracker.global")}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[120px] md:w-[140px] h-9" data-testid="select-date-range">
              <CalendarDays className="h-4 w-4 mr-1 md:mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("orderTracker.allTime")}</SelectItem>
              <SelectItem value="today">{t("orderTracker.today")}</SelectItem>
              <SelectItem value="this_week">{t("orderTracker.thisWeek")}</SelectItem>
              <SelectItem value="this_month">{t("orderTracker.thisMonth")}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="h-9" onClick={() => setShowNewOrderDialog(true)} data-testid="button-new-order-tracker">
            <Plus className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">{t("orderTracker.newOrder")}</span>
            <span className="sm:hidden">{t("orderTracker.new")}</span>
          </Button>
          <Button variant="outline" size="sm" className="h-9 hidden md:inline-flex" onClick={() => {
            if (selectedOrder) {
              setMobileOrderForm({
                providerId: selectedOrder.providerId || "",
                clientId: selectedOrder.clientId || "",
                serviceId: "",
                customerName: selectedOrder.customerName || "",
                dateSold: selectedOrder.dateSold || "",
                customerPhone: selectedOrder.customerPhone || "",
                customerAddress: selectedOrder.customerAddress || "",
                accountNumber: selectedOrder.accountNumber || "",
                repId: selectedOrder.repId || "",
                mobileLines: [{ mobileProductType: "", mobilePortedStatus: "" }],
              });
            }
            setShowMobileOrderDialog(true);
          }} data-testid="button-mobile-entry-tracker">
            <Smartphone className="h-4 w-4 mr-1.5" />
            {t("orderTracker.mobileEntry")}
          </Button>
          <Link href="/orders" className="hidden md:inline-flex">
            <Button variant="outline" size="sm" className="h-9" data-testid="link-full-orders">
              <ArrowUpRight className="h-4 w-4 mr-1.5" />
              {t("orderTracker.fullOrders")}
            </Button>
          </Link>
        </div>
      </div>

      <Tabs value={orderType} onValueChange={(v) => { setOrderType(v as "data" | "mobile"); setActiveTab("all"); }}>
        <TabsList data-testid="tabs-order-type">
          <TabsTrigger value="data" data-testid="tab-data-orders">
            <Package className="h-4 w-4 mr-1.5" />
            {t("orderTracker.data")}
          </TabsTrigger>
          <TabsTrigger value="mobile" data-testid="tab-mobile-orders">
            <Smartphone className="h-4 w-4 mr-1.5" />
            {t("orderTracker.mobile")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-4">
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "pending" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("pending")}
          data-testid="card-stat-pending"
        >
          <CardContent className="p-2.5 md:p-4">
            <div className="flex items-center justify-between gap-1 mb-0.5 md:mb-1">
              <span className="text-[10px] md:text-sm text-muted-foreground">{t("orderTracker.pending")}</span>
              <Clock className="h-3.5 w-3.5 md:h-4 md:w-4 text-yellow-500 shrink-0" />
            </div>
            <p className="text-lg md:text-2xl font-bold">{stats.pending}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden md:block">{t("orderTracker.awaitingCompletion")}</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "completed" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("completed")}
          data-testid="card-stat-completed"
        >
          <CardContent className="p-2.5 md:p-4">
            <div className="flex items-center justify-between gap-1 mb-0.5 md:mb-1">
              <span className="text-[10px] md:text-sm text-muted-foreground">{t("orderTracker.done")}</span>
              <CheckCircle2 className="h-3.5 w-3.5 md:h-4 md:w-4 text-blue-500 shrink-0" />
            </div>
            <p className="text-lg md:text-2xl font-bold">{stats.completed}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden md:block">{t("orderTracker.awaitingApproval")}</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "approved" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("approved")}
          data-testid="card-stat-approved"
        >
          <CardContent className="p-2.5 md:p-4">
            <div className="flex items-center justify-between gap-1 mb-0.5 md:mb-1">
              <span className="text-[10px] md:text-sm text-muted-foreground">{t("orderTracker.approved")}</span>
              <ThumbsUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-500 shrink-0" />
            </div>
            <p className="text-lg md:text-2xl font-bold">{stats.approved}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden md:block">{t("orderTracker.awaitingPayment")}</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "paid" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("paid")}
          data-testid="card-stat-paid"
        >
          <CardContent className="p-2.5 md:p-4">
            <div className="flex items-center justify-between gap-1 mb-0.5 md:mb-1">
              <span className="text-[10px] md:text-sm text-muted-foreground">{t("orderTracker.paid")}</span>
              <DollarSign className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-500 shrink-0" />
            </div>
            <p className="text-lg md:text-2xl font-bold">{stats.paid}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden md:block">{t("orderTracker.commissionReceived")}</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === "all" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setActiveTab("all")}
          data-testid="card-stat-total"
        >
          <CardContent className="p-2.5 md:p-4">
            <div className="flex items-center justify-between gap-1 mb-0.5 md:mb-1">
              <span className="text-[10px] md:text-sm text-muted-foreground">{t("orderTracker.total")}</span>
              <Filter className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground shrink-0" />
            </div>
            <p className="text-lg md:text-2xl font-bold">{stats.total}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden md:block">{t("orderTracker.allOrdersLabel")}</p>
          </CardContent>
        </Card>
        {canSeeCommission && (
          <Card data-testid="card-stat-earned">
            <CardContent className="p-2.5 md:p-4">
              <div className="flex items-center justify-between gap-1 mb-0.5 md:mb-1">
                <span className="text-[10px] md:text-sm text-muted-foreground">{canSeeGrossCommissions ? t("orderTracker.gross") : t("orderTracker.net")}</span>
                <DollarSign className="h-3.5 w-3.5 md:h-4 md:w-4 text-primary shrink-0" />
              </div>
              <p className="text-sm md:text-2xl font-bold font-mono truncate">
                ${stats.totalEarned.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 hidden md:block">{t("orderTracker.approvedPlusPaid")}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <MobileFilterDrawer activeFilterCount={(searchTerm ? 1 : 0) + (activeTab !== "all" ? 1 : 0) + (dateRange !== "all" ? 1 : 0)}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("orderTracker.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-orders"
              />
            </div>
            <div className="md:hidden">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-[130px] h-9" data-testid="select-date-range-mobile">
                  <CalendarDays className="h-4 w-4 mr-1 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("orderTracker.allTime")}</SelectItem>
                  <SelectItem value="today">{t("orderTracker.today")}</SelectItem>
                  <SelectItem value="this_week">{t("orderTracker.thisWeek")}</SelectItem>
                  <SelectItem value="this_month">{t("orderTracker.thisMonth")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSelectedOrderIds(new Set()); }}>
            <TabsList className="w-full md:w-auto overflow-x-auto">
              <TabsTrigger value="all" data-testid="tab-all">{t("orderTracker.all")}</TabsTrigger>
              <TabsTrigger value="pending" data-testid="tab-pending">
                {t("orderTracker.pending")}
                {stats.pending > 0 && (
                  <span className="ml-1 md:ml-1.5 px-1 md:px-1.5 py-0.5 text-[10px] md:text-xs rounded-full bg-muted">{stats.pending}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="completed" data-testid="tab-completed">
                {t("orderTracker.done")}
                {stats.completed > 0 && (
                  <span className="ml-1 md:ml-1.5 px-1 md:px-1.5 py-0.5 text-[10px] md:text-xs rounded-full bg-muted">{stats.completed}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved" data-testid="tab-approved">{t("orderTracker.approved")}</TabsTrigger>
              <TabsTrigger value="paid" data-testid="tab-paid">{t("orderTracker.paid")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </MobileFilterDrawer>

      {isPaidTab && sortedOrders.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={sortedOrders.length > 0 && selectedOrderIds.size === sortedOrders.length}
              onCheckedChange={(checked) => {
                if (checked) {
                  setSelectedOrderIds(new Set(sortedOrders.map(o => o.id)));
                } else {
                  setSelectedOrderIds(new Set());
                }
              }}
              className="h-5 w-5"
              data-testid="checkbox-select-all-paid"
            />
            <span className="text-sm text-muted-foreground">
              {selectedOrderIds.size > 0
                ? `${selectedOrderIds.size} ${t("orderTracker.of")} ${sortedOrders.length} ${t("orderTracker.selected")}`
                : `${t("orderTracker.selectAll")} (${sortedOrders.length})`}
            </span>
          </div>
          {selectedOrderIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedOrderIds(new Set())}
              data-testid="button-clear-selection"
            >
              {t("orderTracker.clear")}
            </Button>
          )}
        </div>
      )}

      {sortedOrders.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-lg font-medium">{t("orderTracker.noOrders")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {searchTerm ? t("orderTracker.tryAdjustSearch") : t("orderTracker.ordersWillAppear")}
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
              canSeeGross={canSeeGrossCommissions}
              canSeeCommission={canSeeCommission}
              isEditing={editingOrderId === order.id}
              onEdit={() => setEditingOrderId(order.id)}
              onCancelEdit={() => setEditingOrderId(null)}
              onSelect={() => setSelectedOrder(order)}
              repName={repMap.get(order.repId || "") || (order as any).repName || ""}
              isSelectable={isPaidTab}
              isSelected={selectedOrderIds.has(order.id)}
              onToggleSelect={() => {
                setSelectedOrderIds(prev => {
                  const next = new Set(prev);
                  if (next.has(order.id)) next.delete(order.id);
                  else next.add(order.id);
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={showNewOrderDialog} onOpenChange={(open) => { setShowNewOrderDialog(open); if (!open) resetNewOrderForm(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-visible flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("orders.createOrder")}</DialogTitle>
            <DialogDescription>{t("orders.enterOrderDetails")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isAdmin && (
                <div className="space-y-2">
                  <Label>{t("orders.assignToRequired")}</Label>
                  {isTouchDevice ? (
                    <NativeSelect
                      value={newOrderForm.repId}
                      onValueChange={(v) => setNewOrderForm(f => ({ ...f, repId: v }))}
                      placeholder={t("orders.selectUser")}
                      options={reps?.map((rep) => ({
                        value: rep.repId,
                        label: `${rep.name} (${rep.repId}) - ${rep.role}`
                      })) || []}
                      data-testid="select-rep-tracker"
                    />
                  ) : (
                    <Select value={newOrderForm.repId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, repId: v }))}>
                      <SelectTrigger data-testid="select-rep-tracker">
                        <SelectValue placeholder={t("orders.selectUser")} />
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
                <Label>{t("orders.client")}</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.clientId}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, clientId: v, serviceId: "" }))}
                    placeholder={t("orders.selectClient")}
                    options={(clients || []).map((client) => ({
                      value: client.id,
                      label: client.name
                    }))}
                    data-testid="select-client-tracker"
                  />
                ) : (
                  <Select value={newOrderForm.clientId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, clientId: v, serviceId: "" }))}>
                    <SelectTrigger data-testid="select-client-tracker">
                      <SelectValue placeholder={t("orders.selectClient")} />
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
                <Label>{t("orders.provider")}</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.providerId}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, providerId: v, serviceId: "" }))}
                    placeholder={t("orders.selectProvider")}
                    options={(providers || []).map((provider) => ({
                      value: provider.id,
                      label: provider.name
                    }))}
                    data-testid="select-provider-tracker"
                  />
                ) : (
                  <Select value={newOrderForm.providerId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, providerId: v, serviceId: "" }))}>
                    <SelectTrigger data-testid="select-provider-tracker">
                      <SelectValue placeholder={t("orders.selectProvider")} />
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
                <Label>{t("orders.dateSoldRequired")}</Label>
                <Input
                  type="date"
                  value={newOrderForm.dateSold}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, dateSold: e.target.value }))}
                  data-testid="input-date-sold-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.installDate")}</Label>
                <Input
                  type="date"
                  value={newOrderForm.installDate}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, installDate: e.target.value }))}
                  data-testid="input-install-date-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.installTime")}</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.installTime}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, installTime: v }))}
                    placeholder={t("orders.selectTimeWindow")}
                    options={[
                      { value: "8-11am", label: "8-11am" },
                      { value: "11-2pm", label: "11-2pm" },
                      { value: "2-5pm", label: "2-5pm" },
                    ]}
                    data-testid="select-install-time-tracker"
                  />
                ) : (
                  <Select value={newOrderForm.installTime} onValueChange={(v) => setNewOrderForm(f => ({ ...f, installTime: v }))}>
                    <SelectTrigger data-testid="select-install-time-tracker">
                      <SelectValue placeholder={t("orders.selectTimeWindow")} />
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
                <Label>{t("orders.installType")}</Label>
                {isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.installType}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, installType: v }))}
                    placeholder={t("orders.selectInstallType")}
                    options={[
                      { value: "AGENT_INSTALL", label: t("orders.agentInstall") },
                      { value: "DIRECT_SHIP", label: t("orders.directShip") },
                      { value: "TECH_INSTALL", label: t("orders.techInstall") },
                    ]}
                    data-testid="select-install-type-tracker"
                  />
                ) : (
                  <Select value={newOrderForm.installType} onValueChange={(v) => setNewOrderForm(f => ({ ...f, installType: v }))}>
                    <SelectTrigger data-testid="select-install-type-tracker">
                      <SelectValue placeholder={t("orders.selectInstallType")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AGENT_INSTALL">{t("orders.agentInstall")}</SelectItem>
                      <SelectItem value="DIRECT_SHIP">{t("orders.directShip")}</SelectItem>
                      <SelectItem value="TECH_INSTALL">{t("orders.techInstall")}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t("orders.accountNumber")}</Label>
                <Input
                  placeholder={t("orders.enterAccountNumber")}
                  value={newOrderForm.accountNumber}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, accountNumber: e.target.value }))}
                  data-testid="input-account-number-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.service")}</Label>
                {!newOrderForm.clientId || !newOrderForm.providerId ? (
                  <p className="text-sm text-muted-foreground">{t("orders.selectClientProviderFirst")}</p>
                ) : isTouchDevice ? (
                  <NativeSelect
                    value={newOrderForm.serviceId}
                    onValueChange={(v) => setNewOrderForm(f => ({ ...f, serviceId: v }))}
                    placeholder={t("orders.selectService")}
                    options={(availableServices || []).map((service) => ({
                      value: service.id,
                      label: service.name
                    }))}
                    data-testid="select-service-tracker"
                  />
                ) : (
                  <Select value={newOrderForm.serviceId} onValueChange={(v) => setNewOrderForm(f => ({ ...f, serviceId: v }))}>
                    <SelectTrigger data-testid="select-service-tracker">
                      <SelectValue placeholder={availableServices?.length ? t("orders.selectService") : t("orders.noServicesAvailable")} />
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
                <Label>{t("orders.customerNameRequired")}</Label>
                <Input
                  placeholder={t("orders.enterCustomerName")}
                  value={newOrderForm.customerName}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, customerName: e.target.value }))}
                  data-testid="input-customer-name-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.phone")}</Label>
                <Input
                  placeholder={t("orders.enterPhone")}
                  value={newOrderForm.customerPhone}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, customerPhone: e.target.value }))}
                  data-testid="input-customer-phone-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.email")}</Label>
                <Input
                  placeholder={t("orders.enterEmail")}
                  value={newOrderForm.customerEmail}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, customerEmail: e.target.value }))}
                  data-testid="input-customer-email-tracker"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-2">
                <Label>{t("orders.house")}</Label>
                <Input
                  placeholder="123"
                  value={newOrderForm.houseNumber}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, houseNumber: e.target.value }))}
                  data-testid="input-house-number-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.street")}</Label>
                <Input
                  placeholder="Main St"
                  value={newOrderForm.streetName}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, streetName: e.target.value }))}
                  data-testid="input-street-name-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.aptUnit")}</Label>
                <Input
                  placeholder="Apt 4B"
                  value={newOrderForm.aptUnit}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, aptUnit: e.target.value }))}
                  data-testid="input-apt-unit-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.city")}</Label>
                <Input
                  placeholder={t("orders.city")}
                  value={newOrderForm.city}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, city: e.target.value }))}
                  data-testid="input-city-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.zipCode")}</Label>
                <Input
                  placeholder="12345"
                  value={newOrderForm.zipCode}
                  onChange={(e) => setNewOrderForm(f => ({ ...f, zipCode: e.target.value }))}
                  data-testid="input-zip-code-tracker"
                />
              </div>
            </div>
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hasTvTracker"
                  checked={newOrderForm.hasTv}
                  onCheckedChange={(checked) => setNewOrderForm(f => ({ ...f, hasTv: !!checked }))}
                  data-testid="checkbox-has-tv-tracker"
                />
                <Label htmlFor="hasTvTracker" className="cursor-pointer">{t("orders.videoTv")}</Label>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setShowNewOrderDialog(false); resetNewOrderForm(); }} data-testid="button-cancel-new-order-tracker">
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreateOrder}
              disabled={createOrderMutation.isPending}
              data-testid="button-submit-order-tracker"
            >
              {createOrderMutation.isPending ? t("orders.creating") : t("orders.createOrder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              canSeeGross={canSeeGrossCommissions}
              canSeeCommission={canSeeCommission}
              repName={repMap.get(selectedOrder.repId || "") || (selectedOrder as any).repName || ""}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showMobileOrderDialog} onOpenChange={(open) => { setShowMobileOrderDialog(open); if (!open) resetMobileOrderForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              {t("orders.createMobileOrder")}
            </DialogTitle>
            <DialogDescription>
              {t("orders.createMobileOrderDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isAdmin && (
              <div className="space-y-2">
                <Label>{t("orders.repIdRequired")}</Label>
                <Input
                  placeholder={t("orders.enterRepId")}
                  value={mobileOrderForm.repId}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, repId: e.target.value }))}
                  data-testid="input-mobile-rep-id-tracker"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("orders.providerRequired")}</Label>
                <Select value={mobileOrderForm.providerId} onValueChange={(v) => setMobileOrderForm(f => ({ ...f, providerId: v, serviceId: "" }))}>
                  <SelectTrigger data-testid="select-mobile-provider-tracker">
                    <SelectValue placeholder={t("orders.selectProvider")} />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("orders.clientRequired")}</Label>
                <Select value={mobileOrderForm.clientId} onValueChange={(v) => setMobileOrderForm(f => ({ ...f, clientId: v, serviceId: "" }))}>
                  <SelectTrigger data-testid="select-mobile-client-tracker">
                    <SelectValue placeholder={t("orders.selectClient")} />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("orders.serviceRequired")}</Label>
              <Select value={mobileOrderForm.serviceId} onValueChange={(v) => setMobileOrderForm(f => ({ ...f, serviceId: v }))}>
                <SelectTrigger data-testid="select-mobile-service-tracker">
                  <SelectValue placeholder={mobileAvailableServices?.length ? t("orders.selectService") : t("orders.selectClientProviderFirst")} />
                </SelectTrigger>
                <SelectContent>
                  {(mobileAvailableServices || []).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("orders.customerNameRequired")}</Label>
                <Input
                  placeholder={t("orders.enterCustomerName")}
                  value={mobileOrderForm.customerName}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, customerName: e.target.value }))}
                  data-testid="input-mobile-customer-name-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.dateSoldRequired")}</Label>
                <Input
                  type="date"
                  value={mobileOrderForm.dateSold}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, dateSold: e.target.value }))}
                  data-testid="input-mobile-date-sold-tracker"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("orders.phone")}</Label>
                <Input
                  placeholder={t("orders.enterPhone")}
                  value={mobileOrderForm.customerPhone}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, customerPhone: e.target.value }))}
                  data-testid="input-mobile-customer-phone-tracker"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("orders.accountNumber")}</Label>
                <Input
                  placeholder={t("orders.enterAccountNumber")}
                  value={mobileOrderForm.accountNumber}
                  onChange={(e) => setMobileOrderForm(f => ({ ...f, accountNumber: e.target.value }))}
                  data-testid="input-mobile-account-number-tracker"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("orders.address")}</Label>
              <Textarea
                placeholder={t("orders.enterAddress")}
                value={mobileOrderForm.customerAddress}
                onChange={(e) => setMobileOrderForm(f => ({ ...f, customerAddress: e.target.value }))}
                data-testid="input-mobile-customer-address-tracker"
              />
            </div>
            <div className="space-y-3 border rounded-md p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t("orders.mobileLines", { count: mobileOrderForm.mobileLines.length })}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMobileLine}
                  data-testid="button-add-mobile-line-tracker"
                >
                  <Plus className="h-4 w-4 mr-1" /> {t("orders.addLine")}
                </Button>
              </div>
              {mobileOrderForm.mobileLines.map((line, index) => (
                <div key={index} className="flex items-center gap-3 p-2 bg-background rounded-md border">
                  <span className="text-sm text-muted-foreground w-8">#{index + 1}</span>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">{t("orders.product")}:</Label>
                    <Select
                      value={line.mobileProductType || "__none__"}
                      onValueChange={(v) => updateMobileLine(index, "mobileProductType", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="w-28" data-testid={`select-mobile-product-type-tracker-${index}`}>
                        <SelectValue placeholder={t("orders.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("orders.select")}</SelectItem>
                        <SelectItem value="UNLIMITED">{t("orders.unlimited")}</SelectItem>
                        <SelectItem value="3_GIG">3 Gig</SelectItem>
                        <SelectItem value="1_GIG">1 Gig</SelectItem>
                        <SelectItem value="BYOD">BYOD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">{t("orders.ported")}:</Label>
                    <Select
                      value={line.mobilePortedStatus || "__none__"}
                      onValueChange={(v) => updateMobileLine(index, "mobilePortedStatus", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="w-28" data-testid={`select-mobile-ported-status-tracker-${index}`}>
                        <SelectValue placeholder={t("orders.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("orders.select")}</SelectItem>
                        <SelectItem value="PORTED">{t("orders.ported")}</SelectItem>
                        <SelectItem value="NON_PORTED">{t("orders.nonPorted")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMobileLine(index)}
                    disabled={mobileOrderForm.mobileLines.length === 1}
                    data-testid={`button-remove-mobile-line-tracker-${index}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowMobileOrderDialog(false); resetMobileOrderForm(); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => createMobileOrderMutation.mutate(mobileOrderForm)}
              disabled={createMobileOrderMutation.isPending || !mobileOrderForm.customerName || !mobileOrderForm.dateSold}
              data-testid="button-submit-mobile-order-tracker"
            >
              {createMobileOrderMutation.isPending ? t("orders.creating") : t("orders.createMobileOrder")}
            </Button>
          </DialogFooter>
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
  canSeeGross,
  canSeeCommission,
  repName,
}: {
  order: SalesOrder;
  clientMap: Map<string, string>;
  providerMap: Map<string, string>;
  serviceMap: Map<string, string>;
  services: Service[];
  onClose: () => void;
  canSeeGross: boolean;
  canSeeCommission: boolean;
  repName?: string;
}) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const status = getOrderStatus(order);
  const config = getStatusConfig(status);
  const netCommission = parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned || "0");
  const grossCommission = parseFloat((order as any).grossCommissionTotal || "0");
  const overrideDeduction = parseFloat(order.overrideDeduction || "0");
  const displayCommission = canSeeGross ? grossCommission : netCommission;

  const [isEditing, setIsEditing] = useState(false);
  const [notesValue, setNotesValue] = useState(order.notes || "");
  const [displayNotes, setDisplayNotes] = useState(order.notes || "");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [formData, setFormData] = useState({
    customerName: order.customerName || "",
    customerAddress: order.customerAddress || "",
    houseNumber: order.houseNumber || "",
    streetName: order.streetName || "",
    aptUnit: order.aptUnit || "",
    city: order.city || "",
    zipCode: order.zipCode || "",
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
      toast({ title: t("orderTracker.orderUpdated"), description: t("orderTracker.changesSaved") });
      setIsEditing(false);
      onClose();
    },
    onError: (err: any) => {
      toast({ title: t("orderTracker.updateFailed"), description: err.message || t("orderTracker.couldNotSaveChanges"), variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, { jobStatus: newStatus });
      return res.json();
    },
    onSuccess: (_, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      const label = newStatus === "COMPLETED" ? t("orderTracker.connected") : newStatus === "PENDING" ? t("orderTracker.pending") : t("orderTracker.cancelled");
      toast({ title: `${t("orderTracker.orderUpdated")}: ${label}` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: t("orderTracker.statusUpdateFailed"), description: err.message || t("orderTracker.couldNotUpdateStatus"), variant: "destructive" });
    },
  });

  const notesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const res = await apiRequest("PATCH", `/api/orders/${order.id}`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: t("orderTracker.notesSaved") });
      setDisplayNotes(notesValue);
      setIsEditingNotes(false);
    },
    onError: (err: any) => {
      toast({ title: t("orderTracker.failedToSaveNotes"), description: err.message || t("orderTracker.couldNotSaveNotes"), variant: "destructive" });
    },
  });

  const handleSave = () => {
    const payload: Record<string, any> = {};
    if (formData.customerName !== (order.customerName || "")) payload.customerName = formData.customerName;
    if (formData.customerAddress !== (order.customerAddress || "")) payload.customerAddress = formData.customerAddress;
    if (formData.houseNumber !== (order.houseNumber || "")) payload.houseNumber = formData.houseNumber;
    if (formData.streetName !== (order.streetName || "")) payload.streetName = formData.streetName;
    if (formData.aptUnit !== (order.aptUnit || "")) payload.aptUnit = formData.aptUnit;
    if (formData.city !== (order.city || "")) payload.city = formData.city;
    if (formData.zipCode !== (order.zipCode || "")) payload.zipCode = formData.zipCode;
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

  const fullAddress = (() => {
    const street = [order.houseNumber, order.streetName, order.aptUnit].filter(Boolean).join(" ");
    const location = [street, order.city, order.zipCode].filter(Boolean).join(", ");
    return location || order.customerAddress || "";
  })();

  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  const readOnlyRows: { label: string; value: string | null }[] = [
    { label: t("orderTracker.invoiceNumber"), value: order.invoiceNumber || null },
    { label: t("orderTracker.rep"), value: repName || null },
    { label: t("orderTracker.provider"), value: providerMap.get(order.providerId) || null },
    { label: t("orderTracker.client"), value: clientMap.get(order.clientId) || null },
    { label: t("orderTracker.saleDate"), value: order.dateSold ? new Intl.DateTimeFormat(locale).format(new Date(order.dateSold)) : null },
    { label: t("orderTracker.installType"), value: order.installType || null },
    { label: t("orderTracker.tvSold"), value: order.tvSold ? t("orderTracker.yes") : t("orderTracker.no") },
    { label: t("orderTracker.mobileOrderLabel"), value: order.isMobileOrder ? t("orderTracker.yes") : t("orderTracker.no") },
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
              {t("orderTracker.edit")}
            </Button>
          ) : (
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-order">
              {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              {t("orderTracker.save")}
            </Button>
          )}
        </div>
      </div>

      {(status === "pending" || status === "completed") && (
        <div className="flex items-center gap-2 flex-wrap">
          {status === "pending" && (
            <>
              <Button
                size="sm"
                onClick={() => statusMutation.mutate("COMPLETED")}
                disabled={statusMutation.isPending}
                data-testid="button-detail-complete"
              >
                {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                {t("orderTracker.markAsConnected")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => statusMutation.mutate("CANCELED")}
                disabled={statusMutation.isPending}
                data-testid="button-detail-cancel-order"
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                {t("orderTracker.cancelOrder")}
              </Button>
            </>
          )}
          {status === "completed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => statusMutation.mutate("PENDING")}
              disabled={statusMutation.isPending}
              data-testid="button-detail-revert"
            >
              {statusMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Clock className="h-3.5 w-3.5 mr-1.5" />}
              {t("orderTracker.revertToPending")}
            </Button>
          )}
        </div>
      )}

      

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("orderTracker.customerName")}</Label>
            <Input
              value={formData.customerName}
              onChange={(e) => updateField("customerName", e.target.value)}
              data-testid="input-edit-customer-name"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.installDate")}</Label>
            <Input
              type="date"
              value={formData.installDate}
              onChange={(e) => updateField("installDate", e.target.value)}
              data-testid="input-edit-install-date"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.houseBuilding")}</Label>
            <Input
              value={formData.houseNumber}
              onChange={(e) => updateField("houseNumber", e.target.value)}
              data-testid="input-edit-house"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.streetName")}</Label>
            <Input
              value={formData.streetName}
              onChange={(e) => updateField("streetName", e.target.value)}
              data-testid="input-edit-street"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.aptUnit")}</Label>
            <Input
              value={formData.aptUnit}
              onChange={(e) => updateField("aptUnit", e.target.value)}
              data-testid="input-edit-apt"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.city")}</Label>
            <Input
              value={formData.city}
              onChange={(e) => updateField("city", e.target.value)}
              data-testid="input-edit-city"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.zipCode")}</Label>
            <Input
              value={formData.zipCode}
              onChange={(e) => updateField("zipCode", e.target.value)}
              data-testid="input-edit-zip"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.phone")}</Label>
            <Input
              value={formData.customerPhone}
              onChange={(e) => updateField("customerPhone", e.target.value)}
              data-testid="input-edit-phone"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.email")}</Label>
            <Input
              value={formData.customerEmail}
              onChange={(e) => updateField("customerEmail", e.target.value)}
              data-testid="input-edit-email"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.accountNumber")}</Label>
            <Input
              value={formData.accountNumber}
              onChange={(e) => updateField("accountNumber", e.target.value)}
              data-testid="input-edit-account"
            />
          </div>
          <div>
            <Label className="text-xs">{t("orderTracker.service")}</Label>
            <Select value={formData.serviceId} onValueChange={(v) => updateField("serviceId", v)}>
              <SelectTrigger data-testid="select-edit-service">
                <SelectValue placeholder={t("orderTracker.selectService")} />
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
              {t("orderTracker.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("orderTracker.customerName")}</p>
              <p className="text-sm font-medium">{order.customerName}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.service")}</p>
                <p className="text-sm font-medium">{serviceMap.get(order.serviceId) || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.installDate")}</p>
                <p className="text-sm font-medium">{order.installDate ? new Intl.DateTimeFormat(locale).format(new Date(order.installDate)) : "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">{t("orderTracker.address")}</p>
                <p className="text-sm font-medium">{fullAddress || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.phone")}</p>
                <p className="text-sm font-medium" data-testid="text-detail-phone">{order.customerPhone || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.email")}</p>
                <p className="text-sm font-medium" data-testid="text-detail-email">{order.customerEmail || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.accountNumber")}</p>
                <p className="text-sm font-medium" data-testid="text-detail-account">{order.accountNumber || "—"}</p>
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
            <p className="text-sm font-medium">{t("orderTracker.notes")}</p>
          </div>
          {!isEditingNotes && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setNotesValue(displayNotes); setIsEditingNotes(true); }}
              data-testid="button-edit-notes"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              {displayNotes ? t("orderTracker.edit") : t("orderTracker.addNoteBtn")}
            </Button>
          )}
        </div>
        {isEditingNotes ? (
          <div className="space-y-2">
            <Textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder={t("orderTracker.addNoteNote")}
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
                {t("orderTracker.saveNote")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setNotesValue(displayNotes); setIsEditingNotes(false); }}
                data-testid="button-cancel-notes"
              >
                {t("orderTracker.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-order-notes">
            {displayNotes || t("orderTracker.noNotes")}
          </p>
        )}
      </div>

      {canSeeCommission && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{canSeeGross ? t("orderTracker.grossCommission") : t("orderTracker.netCommission")}</p>
              <p className="text-xl font-bold font-mono" data-testid="text-detail-commission">
                ${displayCommission.toFixed(2)}
              </p>
            </div>
            {parseFloat(order.incentiveEarned || "0") > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{t("orderTracker.includesIncentive")}</p>
                <p className="text-sm font-mono">
                  +${parseFloat(order.incentiveEarned || "0").toFixed(2)}
                </p>
              </div>
            )}
          </div>
          {canSeeGross && (
            <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.base")}</p>
                <p className="font-mono" data-testid="text-detail-base-commission">${parseFloat(order.baseCommissionEarned).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.overrideDeduction")}</p>
                <p className="font-mono text-orange-600 dark:text-orange-400" data-testid="text-detail-override-deduction">${overrideDeduction.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderTracker.repNet")}</p>
                <p className="font-mono" data-testid="text-detail-net-commission">${netCommission.toFixed(2)}</p>
              </div>
            </div>
          )}
          {order.paidDate && (
            <p className="text-xs text-muted-foreground mt-2">
              {t("orderTracker.paidOn")} {new Intl.DateTimeFormat(locale).format(new Date(order.paidDate))}
            </p>
          )}
          {parseFloat(order.commissionPaid || "0") > 0 && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-detail-commission-paid">
              {t("orderTracker.paidOut")}: ${parseFloat(order.commissionPaid || "0").toFixed(2)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
