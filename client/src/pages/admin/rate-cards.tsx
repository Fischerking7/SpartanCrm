import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, DollarSign, Edit, Trash2, ChevronDown, Check, Users } from "lucide-react";
import type { RateCard, Provider, Client, Service, RateCardLeadOverride } from "@shared/schema";

const __ANY_CLIENT__ = "__ANY_CLIENT__";
const __ANY_LEAD__ = "__ANY_LEAD__";
const __NO_MOBILE__ = "__NO_MOBILE__";
const __NO_PORTED__ = "__NO_PORTED__";

const MOBILE_PRODUCT_TYPES = [
  { value: "UNLIMITED", label: "Unlimited" },
  { value: "3_GIG", label: "3 Gig" },
  { value: "1_GIG", label: "1 Gig" },
  { value: "BYOD", label: "BYOD" },
];

const MOBILE_PORTED_STATUS = [
  { value: "PORTED", label: "Ported" },
  { value: "NON_PORTED", label: "Non-Ported" },
];

export default function AdminRateCards() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<RateCard | null>(null);
  const [deleteItem, setDeleteItem] = useState<RateCard | null>(null);
  const [leadOverridesItem, setLeadOverridesItem] = useState<RateCard | null>(null);
  const [leadOverrideForm, setLeadOverrideForm] = useState({ leadId: "", overrideDeduction: "", tvOverrideDeduction: "", mobileOverrideDeduction: "" });
  const [formData, setFormData] = useState({
    providerId: "",
    clientId: __ANY_CLIENT__,
    serviceId: "",
    serviceName: "",
    leadId: __ANY_LEAD__,
    mobileProductType: __NO_MOBILE__,
    mobilePortedStatus: __NO_PORTED__,
    baseAmount: "",
    tvAddonAmount: "",
    mobilePerLineAmount: "",
    overrideDeduction: "",
    tvOverrideDeduction: "",
    mobileOverrideDeduction: "",
    effectiveStart: "",
    effectiveEnd: "",
    active: true,
  });
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);

  const { data: items, isLoading } = useQuery<RateCard[]>({
    queryKey: ["/api/admin/rate-cards"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rate-cards", { headers: getAuthHeaders() });
      return res.json();
    },
  });
  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/admin/providers"],
    queryFn: async () => {
      const res = await fetch("/api/admin/providers", { headers: getAuthHeaders() });
      return res.json();
    },
  });
  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/admin/clients"],
    queryFn: async () => {
      const res = await fetch("/api/admin/clients", { headers: getAuthHeaders() });
      return res.json();
    },
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/admin/services"],
    queryFn: async () => {
      const res = await fetch("/api/admin/services", { headers: getAuthHeaders() });
      return res.json();
    },
  });
  const { data: leadUsers } = useQuery<{ id: string; name: string; repId: string; role: string }[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      const all = await res.json();
      return all.filter((u: any) => u.role === "LEAD" && u.status === "ACTIVE");
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/admin/rate-cards", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rate-cards"] });
      closeDialog();
      toast({ title: "Rate card created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`/api/admin/rate-cards/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rate-cards"] });
      closeDialog();
      toast({ title: "Rate card updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/rate-cards/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rate-cards"] });
      setDeleteItem(null);
      toast({
        title: "Rate card archived",
        description: data.dependencyCount > 0
          ? `Archived with ${data.dependencyCount} historical orders referencing it.`
          : "Rate card has been removed.",
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: leadOverrides, refetch: refetchLeadOverrides } = useQuery<(RateCardLeadOverride & { lead: { id: string; name: string } })[]>({
    queryKey: ["/api/admin/rate-cards", leadOverridesItem?.id, "lead-overrides"],
    queryFn: async () => {
      if (!leadOverridesItem?.id) return [];
      const res = await fetch(`/api/admin/rate-cards/${leadOverridesItem.id}/lead-overrides`, { headers: getAuthHeaders() });
      return res.json();
    },
    enabled: !!leadOverridesItem?.id,
  });

  const upsertLeadOverrideMutation = useMutation({
    mutationFn: async (data: { leadId: string; overrideDeduction: string; tvOverrideDeduction: string; mobileOverrideDeduction: string }) => {
      const res = await fetch(`/api/admin/rate-cards/${leadOverridesItem?.id}/lead-overrides`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      refetchLeadOverrides();
      setLeadOverrideForm({ leadId: "", overrideDeduction: "", tvOverrideDeduction: "", mobileOverrideDeduction: "" });
      toast({ title: "Lead override saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteLeadOverrideMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/rate-cards/${leadOverridesItem?.id}/lead-overrides/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      refetchLeadOverrides();
      toast({ title: "Lead override removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingItem(null);
    setFormData({
      providerId: "",
      clientId: __ANY_CLIENT__,
      serviceId: "",
      serviceName: "",
      leadId: __ANY_LEAD__,
      mobileProductType: __NO_MOBILE__,
      mobilePortedStatus: __NO_PORTED__,
      baseAmount: "",
      tvAddonAmount: "",
      mobilePerLineAmount: "",
      overrideDeduction: "",
      tvOverrideDeduction: "",
      mobileOverrideDeduction: "",
      effectiveStart: "",
      effectiveEnd: "",
      active: true,
    });
    setServicePopoverOpen(false);
  };

  const openEdit = (r: RateCard) => {
    setEditingItem(r);
    const existingService = r.serviceId ? services?.find(s => s.id === r.serviceId) : null;
    setFormData({
      providerId: r.providerId,
      clientId: r.clientId || __ANY_CLIENT__,
      serviceId: r.serviceId || "",
      serviceName: existingService?.name || "",
      leadId: (r as any).leadId || __ANY_LEAD__,
      mobileProductType: r.mobileProductType || __NO_MOBILE__,
      mobilePortedStatus: r.mobilePortedStatus || __NO_PORTED__,
      baseAmount: r.baseAmount || "0",
      tvAddonAmount: r.tvAddonAmount || "0",
      mobilePerLineAmount: r.mobilePerLineAmount || "0",
      overrideDeduction: r.overrideDeduction || "0",
      tvOverrideDeduction: (r as any).tvOverrideDeduction || "0",
      mobileOverrideDeduction: (r as any).mobileOverrideDeduction || "0",
      effectiveStart: r.effectiveStart,
      effectiveEnd: r.effectiveEnd || "",
      active: r.active,
    });
    setShowDialog(true);
  };

  const filteredServices = services?.filter(
    (s) => s.active && !s.deletedAt && s.name.toLowerCase().includes(formData.serviceName.toLowerCase())
  ) || [];

  const selectService = (service: Service) => {
    setFormData({ ...formData, serviceId: service.id, serviceName: service.name });
    setServicePopoverOpen(false);
  };

  const handleServiceNameChange = (value: string) => {
    setFormData({ ...formData, serviceName: value, serviceId: "" });
  };

  const getProviderName = (id: string) => providers?.find((p) => p.id === id)?.name || id;
  const getClientName = (id: string | null) => (id ? clients?.find((c) => c.id === id)?.name || id : "Any");
  const getServiceName = (id: string | null) => (id ? services?.find((s) => s.id === id)?.name || id : "-");
  const getLeadName = (id: string | null) => (id ? leadUsers?.find((l) => l.id === id)?.name || id : "All Leads");

  const filtered = items?.filter(
    (i) =>
      !i.deletedAt &&
      (getProviderName(i.providerId).toLowerCase().includes(searchTerm.toLowerCase()) ||
        getServiceName(i.serviceId).toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const columns = [
    {
      key: "provider",
      header: "Provider",
      cell: (r: RateCard) => <span className="font-medium">{getProviderName(r.providerId)}</span>,
    },
    {
      key: "client",
      header: "Client",
      cell: (r: RateCard) => <span className="text-sm">{getClientName(r.clientId)}</span>,
    },
    {
      key: "service",
      header: "Service",
      cell: (r: RateCard) => <span className="text-sm">{getServiceName(r.serviceId)}</span>,
    },
    {
      key: "lead",
      header: "Lead",
      cell: (r: RateCard) => (r as any).leadId ? (
        <Badge variant="secondary">{getLeadName((r as any).leadId)}</Badge>
      ) : (
        <span className="text-muted-foreground text-sm">All</span>
      ),
    },
    {
      key: "mobileProductType",
      header: "Mobile Product",
      cell: (r: RateCard) => r.mobileProductType ? (
        <Badge variant="outline">{MOBILE_PRODUCT_TYPES.find(t => t.value === r.mobileProductType)?.label || r.mobileProductType}</Badge>
      ) : (
        <span className="text-muted-foreground text-sm">-</span>
      ),
    },
    {
      key: "mobilePortedStatus",
      header: "Ported",
      cell: (r: RateCard) => r.mobilePortedStatus ? (
        <Badge variant="outline">{MOBILE_PORTED_STATUS.find(t => t.value === r.mobilePortedStatus)?.label || r.mobilePortedStatus}</Badge>
      ) : (
        <span className="text-muted-foreground text-sm">-</span>
      ),
    },
    {
      key: "baseAmount",
      header: "Base",
      cell: (r: RateCard) => <span className="font-mono">${parseFloat(r.baseAmount || "0").toFixed(2)}</span>,
      className: "text-right",
    },
    {
      key: "tvAddon",
      header: "TV Addon",
      cell: (r: RateCard) => <span className="font-mono text-muted-foreground">${parseFloat(r.tvAddonAmount || "0").toFixed(2)}</span>,
      className: "text-right",
    },
    {
      key: "mobilePerLine",
      header: "Mobile/Line",
      cell: (r: RateCard) => <span className="font-mono text-muted-foreground">${parseFloat(r.mobilePerLineAmount || "0").toFixed(2)}</span>,
      className: "text-right",
    },
    {
      key: "overrideDeduction",
      header: "Base Override",
      cell: (r: RateCard) => <span className="font-mono text-orange-600">${parseFloat(r.overrideDeduction || "0").toFixed(2)}</span>,
      className: "text-right",
    },
    {
      key: "tvOverrideDeduction",
      header: "TV Override",
      cell: (r: RateCard) => <span className="font-mono text-purple-600">${parseFloat((r as any).tvOverrideDeduction || "0").toFixed(2)}</span>,
      className: "text-right",
    },
    {
      key: "mobileOverrideDeduction",
      header: "Mobile Override",
      cell: (r: RateCard) => <span className="font-mono text-green-600">${parseFloat((r as any).mobileOverrideDeduction || "0").toFixed(2)}</span>,
      className: "text-right",
    },
    {
      key: "active",
      header: "Status",
      cell: (r: RateCard) => <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      cell: (r: RateCard) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setLeadOverridesItem(r)} title="Lead Overrides" data-testid={`button-lead-overrides-${r.id}`}>
            <Users className="h-4 w-4 text-blue-600" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openEdit(r)} data-testid={`button-edit-rate-card-${r.id}`}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleteItem(r)} data-testid={`button-delete-rate-card-${r.id}`}>
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  const submitData = () => {
    const data: any = {
      providerId: formData.providerId,
      clientId: formData.clientId === __ANY_CLIENT__ ? null : formData.clientId,
      leadId: formData.leadId === __ANY_LEAD__ ? null : formData.leadId,
      mobileProductType: formData.mobileProductType === __NO_MOBILE__ ? null : formData.mobileProductType,
      mobilePortedStatus: formData.mobilePortedStatus === __NO_PORTED__ ? null : formData.mobilePortedStatus,
      baseAmount: formData.baseAmount || "0",
      tvAddonAmount: formData.tvAddonAmount || "0",
      mobilePerLineAmount: formData.mobilePerLineAmount || "0",
      overrideDeduction: formData.overrideDeduction || "0",
      tvOverrideDeduction: formData.tvOverrideDeduction || "0",
      mobileOverrideDeduction: formData.mobileOverrideDeduction || "0",
      effectiveStart: formData.effectiveStart,
      effectiveEnd: formData.effectiveEnd || null,
      active: formData.active,
    };
    // Service is optional - can be blank for mobile-only rate cards
    if (formData.serviceId) {
      data.serviceId = formData.serviceId;
    } else if (formData.serviceName.trim()) {
      data.customServiceName = formData.serviceName.trim();
    } else {
      data.serviceId = null;
    }
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  // Service is now optional - rate cards can be mobile-product-only
  const isServiceValid = true;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <DollarSign className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Rate Cards</h1>
            <p className="text-muted-foreground">Manage commission rates with payout components</p>
          </div>
        </div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-new-rate-card">
          <Plus className="h-4 w-4 mr-2" />
          New Rate Card
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by provider or service..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-rate-cards"
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={filtered || []} isLoading={isLoading} emptyMessage="No rate cards" testId="table-rate-cards" />
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={closeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit" : "Create"} Rate Card</DialogTitle>
            <DialogDescription>Configure payout amounts for base, TV addon, and mobile per-line commissions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={formData.providerId} onValueChange={(v) => setFormData({ ...formData, providerId: v })}>
                  <SelectTrigger data-testid="select-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.filter((p) => p.active && p.id && !p.deletedAt).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Client (Optional)</Label>
                <Select value={formData.clientId} onValueChange={(v) => setFormData({ ...formData, clientId: v })}>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder="Any client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={__ANY_CLIENT__}>Any Client</SelectItem>
                    {clients?.filter((c) => c.active && c.id && !c.deletedAt).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Service</Label>
                <Popover open={servicePopoverOpen} onOpenChange={setServicePopoverOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative">
                      <Input
                        placeholder="Type or select service..."
                        value={formData.serviceName}
                        onChange={(e) => handleServiceNameChange(e.target.value)}
                        onFocus={() => setServicePopoverOpen(true)}
                        data-testid="input-service"
                      />
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-[200px] p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
                    <div className="max-h-[200px] overflow-y-auto">
                      {filteredServices.length > 0 ? (
                        filteredServices.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                            onClick={() => selectService(s)}
                            data-testid={`option-service-${s.id}`}
                          >
                            {formData.serviceId === s.id && <Check className="h-4 w-4 text-primary" />}
                            <span className={formData.serviceId === s.id ? "font-medium" : ""}>{s.name}</span>
                          </button>
                        ))
                      ) : formData.serviceName ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Custom: "{formData.serviceName}"
                        </div>
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No services found
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">Select existing or type custom</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Lead (Optional)</Label>
              <Select value={formData.leadId} onValueChange={(v) => setFormData({ ...formData, leadId: v })}>
                <SelectTrigger data-testid="select-lead">
                  <SelectValue placeholder="All Leads" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={__ANY_LEAD__}>All Leads (Default)</SelectItem>
                  {leadUsers?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name} ({l.repId})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">If set, this rate card applies only to reps under this Lead</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Mobile Product Type (Optional)</Label>
                <Select value={formData.mobileProductType} onValueChange={(v) => setFormData({ ...formData, mobileProductType: v })}>
                  <SelectTrigger data-testid="select-mobile-product-type">
                    <SelectValue placeholder="No mobile product" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={__NO_MOBILE__}>No specific mobile product</SelectItem>
                    {MOBILE_PRODUCT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Unlimited, 3 Gig, 1 Gig, etc.</p>
              </div>
              <div className="space-y-2">
                <Label>Ported Status (Optional)</Label>
                <Select value={formData.mobilePortedStatus} onValueChange={(v) => setFormData({ ...formData, mobilePortedStatus: v })}>
                  <SelectTrigger data-testid="select-mobile-ported-status">
                    <SelectValue placeholder="Any ported status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={__NO_PORTED__}>Any ported status</SelectItem>
                    {MOBILE_PORTED_STATUS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Ported or Non-Ported lines</p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Base Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.baseAmount}
                  onChange={(e) => setFormData({ ...formData, baseAmount: e.target.value })}
                  data-testid="input-base-amount"
                />
                <p className="text-xs text-muted-foreground">Always paid</p>
              </div>
              <div className="space-y-2">
                <Label>TV Addon Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.tvAddonAmount}
                  onChange={(e) => setFormData({ ...formData, tvAddonAmount: e.target.value })}
                  data-testid="input-tv-addon"
                />
                <p className="text-xs text-muted-foreground">If TV sold</p>
              </div>
              <div className="space-y-2">
                <Label>Mobile Per-Line ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.mobilePerLineAmount}
                  onChange={(e) => setFormData({ ...formData, mobilePerLineAmount: e.target.value })}
                  data-testid="input-mobile-per-line"
                />
                <p className="text-xs text-muted-foreground">Per mobile line sold</p>
              </div>
              <div className="space-y-2">
                <Label>Base Override Deduction ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.overrideDeduction}
                  onChange={(e) => setFormData({ ...formData, overrideDeduction: e.target.value })}
                  data-testid="input-override-deduction"
                />
                <p className="text-xs text-muted-foreground">Pooled for internet sales (always)</p>
              </div>
              <div className="space-y-2">
                <Label>TV Override Deduction ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.tvOverrideDeduction}
                  onChange={(e) => setFormData({ ...formData, tvOverrideDeduction: e.target.value })}
                  data-testid="input-tv-override-deduction"
                />
                <p className="text-xs text-muted-foreground">Pooled when TV sold</p>
              </div>
              <div className="space-y-2">
                <Label>Mobile Override Deduction ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.mobileOverrideDeduction}
                  onChange={(e) => setFormData({ ...formData, mobileOverrideDeduction: e.target.value })}
                  data-testid="input-mobile-override-deduction"
                />
                <p className="text-xs text-muted-foreground">Pooled when mobile sold</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Effective Start</Label>
                <Input
                  type="date"
                  value={formData.effectiveStart}
                  onChange={(e) => setFormData({ ...formData, effectiveStart: e.target.value })}
                  data-testid="input-effective-start"
                />
              </div>
              <div className="space-y-2">
                <Label>Effective End (Optional)</Label>
                <Input
                  type="date"
                  value={formData.effectiveEnd}
                  onChange={(e) => setFormData({ ...formData, effectiveEnd: e.target.value })}
                  data-testid="input-effective-end"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formData.active} onCheckedChange={(c) => setFormData({ ...formData, active: c })} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={submitData}
              disabled={!formData.providerId || !isServiceValid || !formData.effectiveStart || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-rate-card"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Rate Card</DialogTitle>
            <DialogDescription>
              This will archive the rate card for {deleteItem && getProviderName(deleteItem.providerId)} - {deleteItem && getServiceName(deleteItem.serviceId)}.
              Historical orders will retain their reference to this rate card.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-rate-card"
            >
              {deleteMutation.isPending ? "Archiving..." : "Archive Rate Card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!leadOverridesItem} onOpenChange={() => { setLeadOverridesItem(null); setLeadOverrideForm({ leadId: "", overrideDeduction: "", tvOverrideDeduction: "", mobileOverrideDeduction: "" }); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Lead-Specific Override Amounts</DialogTitle>
            <DialogDescription>
              Configure different override deduction amounts for each Lead on this rate card. Reps under a Lead with custom overrides will have those amounts deducted instead of the default.
              <br /><span className="font-medium">Rate Card:</span> {leadOverridesItem && getProviderName(leadOverridesItem.providerId)} - {leadOverridesItem && getServiceName(leadOverridesItem.serviceId)}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-muted/50 p-4 rounded-lg">
              <h4 className="text-sm font-medium mb-2">Default Override Amounts (used when no Lead-specific override)</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-muted-foreground">Base:</span> <span className="font-mono">${parseFloat(leadOverridesItem?.overrideDeduction || "0").toFixed(2)}</span></div>
                <div><span className="text-muted-foreground">TV:</span> <span className="font-mono">${parseFloat((leadOverridesItem as any)?.tvOverrideDeduction || "0").toFixed(2)}</span></div>
                <div><span className="text-muted-foreground">Mobile:</span> <span className="font-mono">${parseFloat((leadOverridesItem as any)?.mobileOverrideDeduction || "0").toFixed(2)}</span></div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Add/Edit Lead Override</h4>
              <div className="grid grid-cols-5 gap-2">
                <div className="col-span-2">
                  <Select value={leadOverrideForm.leadId} onValueChange={(v) => setLeadOverrideForm({ ...leadOverrideForm, leadId: v })}>
                    <SelectTrigger data-testid="select-lead-override-lead">
                      <SelectValue placeholder="Select Lead" />
                    </SelectTrigger>
                    <SelectContent>
                      {leadUsers?.filter(l => !leadOverrides?.some(o => o.leadId === l.id)).map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Base $"
                  value={leadOverrideForm.overrideDeduction}
                  onChange={(e) => setLeadOverrideForm({ ...leadOverrideForm, overrideDeduction: e.target.value })}
                  data-testid="input-lead-override-base"
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="TV $"
                  value={leadOverrideForm.tvOverrideDeduction}
                  onChange={(e) => setLeadOverrideForm({ ...leadOverrideForm, tvOverrideDeduction: e.target.value })}
                  data-testid="input-lead-override-tv"
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Mobile $"
                  value={leadOverrideForm.mobileOverrideDeduction}
                  onChange={(e) => setLeadOverrideForm({ ...leadOverrideForm, mobileOverrideDeduction: e.target.value })}
                  data-testid="input-lead-override-mobile"
                />
              </div>
              <Button
                size="sm"
                onClick={() => leadOverrideForm.leadId && upsertLeadOverrideMutation.mutate(leadOverrideForm)}
                disabled={!leadOverrideForm.leadId || upsertLeadOverrideMutation.isPending}
                data-testid="button-add-lead-override"
              >
                <Plus className="h-4 w-4 mr-1" />
                {upsertLeadOverrideMutation.isPending ? "Saving..." : "Add Lead Override"}
              </Button>
            </div>

            {leadOverrides && leadOverrides.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Current Lead Overrides</h4>
                <div className="border rounded-lg divide-y">
                  {leadOverrides.map((o) => (
                    <div key={o.id} className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-4">
                        <Badge variant="secondary">{o.lead?.name || "Unknown Lead"}</Badge>
                        <div className="text-sm space-x-4">
                          <span><span className="text-muted-foreground">Base:</span> <span className="font-mono">${parseFloat(o.overrideDeduction || "0").toFixed(2)}</span></span>
                          <span><span className="text-muted-foreground">TV:</span> <span className="font-mono">${parseFloat(o.tvOverrideDeduction || "0").toFixed(2)}</span></span>
                          <span><span className="text-muted-foreground">Mobile:</span> <span className="font-mono">${parseFloat(o.mobileOverrideDeduction || "0").toFixed(2)}</span></span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteLeadOverrideMutation.mutate(o.id)}
                        disabled={deleteLeadOverrideMutation.isPending}
                        data-testid={`button-delete-lead-override-${o.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setLeadOverridesItem(null); setLeadOverrideForm({ leadId: "", overrideDeduction: "", tvOverrideDeduction: "", mobileOverrideDeduction: "" }); }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
