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
import { Plus, Search, DollarSign, Edit, Trash2, ChevronDown, Check } from "lucide-react";
import type { RateCard, Provider, Client, Service } from "@shared/schema";

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
    const isLeadSpecific = formData.leadId !== __ANY_LEAD__;
    const data: any = {
      providerId: formData.providerId,
      clientId: formData.clientId === __ANY_CLIENT__ ? null : formData.clientId,
      leadId: isLeadSpecific ? formData.leadId : null,
      mobileProductType: formData.mobileProductType === __NO_MOBILE__ ? null : formData.mobileProductType,
      mobilePortedStatus: formData.mobilePortedStatus === __NO_PORTED__ ? null : formData.mobilePortedStatus,
      baseAmount: formData.baseAmount || "0",
      tvAddonAmount: formData.tvAddonAmount || "0",
      mobilePerLineAmount: formData.mobilePerLineAmount || "0",
      overrideDeduction: isLeadSpecific ? (formData.overrideDeduction || "0") : "0",
      tvOverrideDeduction: isLeadSpecific ? (formData.tvOverrideDeduction || "0") : "0",
      mobileOverrideDeduction: isLeadSpecific ? (formData.mobileOverrideDeduction || "0") : "0",
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
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">{editingItem ? "Edit" : "Create"} Rate Card</DialogTitle>
            <DialogDescription>Configure commission rates and payout amounts.</DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            <div className="p-4 rounded-lg border bg-muted/30">
              <h3 className="text-sm font-semibold mb-4 text-primary">Rate Card Criteria</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-medium">Provider *</Label>
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
                  <Label className="font-medium">Client</Label>
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
                  <Label className="font-medium">Service</Label>
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
                </div>
                <div className="space-y-2">
                  <Label className="font-medium">Lead</Label>
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
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg border bg-muted/30">
              <h3 className="text-sm font-semibold mb-4 text-primary">Mobile Options</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-medium">Mobile Product Type</Label>
                  <Select value={formData.mobileProductType} onValueChange={(v) => setFormData({ ...formData, mobileProductType: v })}>
                    <SelectTrigger data-testid="select-mobile-product-type">
                      <SelectValue placeholder="No mobile product" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={__NO_MOBILE__}>Any / Not Applicable</SelectItem>
                      {MOBILE_PRODUCT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="font-medium">Ported Status</Label>
                  <Select value={formData.mobilePortedStatus} onValueChange={(v) => setFormData({ ...formData, mobilePortedStatus: v })}>
                    <SelectTrigger data-testid="select-mobile-ported-status">
                      <SelectValue placeholder="Any ported status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={__NO_PORTED__}>Any / Not Applicable</SelectItem>
                      {MOBILE_PORTED_STATUS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900">
              <h3 className="text-sm font-semibold mb-4 text-green-700 dark:text-green-400">Commission Amounts</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="font-medium">Base Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-7"
                      value={formData.baseAmount}
                      onChange={(e) => setFormData({ ...formData, baseAmount: e.target.value })}
                      data-testid="input-base-amount"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Always paid on every sale</p>
                </div>
                <div className="space-y-2">
                  <Label className="font-medium">TV Addon</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-7"
                      value={formData.tvAddonAmount}
                      onChange={(e) => setFormData({ ...formData, tvAddonAmount: e.target.value })}
                      data-testid="input-tv-addon"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Additional when TV is sold</p>
                </div>
                <div className="space-y-2">
                  <Label className="font-medium">Mobile Per-Line</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="pl-7"
                      value={formData.mobilePerLineAmount}
                      onChange={(e) => setFormData({ ...formData, mobilePerLineAmount: e.target.value })}
                      data-testid="input-mobile-per-line"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Per mobile line sold</p>
                </div>
              </div>
            </div>

            {formData.leadId !== __ANY_LEAD__ && (
              <div className="p-4 rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                    Override Deductions for {leadUsers?.find(l => l.id === formData.leadId)?.name || 'Selected Lead'}
                  </h3>
                  <Badge variant="secondary" className="text-xs">Lead-Specific</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  These amounts will be deducted from the gross commission for reps under this Lead.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="font-medium">Base Override</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="pl-7"
                        value={formData.overrideDeduction}
                        onChange={(e) => setFormData({ ...formData, overrideDeduction: e.target.value })}
                        data-testid="input-override-deduction"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-medium">TV Override</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="pl-7"
                        value={formData.tvOverrideDeduction}
                        onChange={(e) => setFormData({ ...formData, tvOverrideDeduction: e.target.value })}
                        data-testid="input-tv-override-deduction"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-medium">Mobile Override</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="pl-7"
                        value={formData.mobileOverrideDeduction}
                        onChange={(e) => setFormData({ ...formData, mobileOverrideDeduction: e.target.value })}
                        data-testid="input-mobile-override-deduction"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 rounded-lg border bg-muted/30">
              <h3 className="text-sm font-semibold mb-4 text-primary">Validity Period</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-medium">Effective Start *</Label>
                  <Input
                    type="date"
                    value={formData.effectiveStart}
                    onChange={(e) => setFormData({ ...formData, effectiveStart: e.target.value })}
                    data-testid="input-effective-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-medium">Effective End</Label>
                  <Input
                    type="date"
                    value={formData.effectiveEnd}
                    onChange={(e) => setFormData({ ...formData, effectiveEnd: e.target.value })}
                    data-testid="input-effective-end"
                  />
                  <p className="text-xs text-muted-foreground">Leave blank if ongoing</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-3">
                <Switch checked={formData.active} onCheckedChange={(c) => setFormData({ ...formData, active: c })} />
                <div>
                  <Label className="font-medium">Active Status</Label>
                  <p className="text-xs text-muted-foreground">Inactive rate cards won't be used for new orders</p>
                </div>
              </div>
              <Badge variant={formData.active ? "default" : "secondary"}>
                {formData.active ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={submitData}
              disabled={!formData.providerId || !isServiceValid || !formData.effectiveStart || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-rate-card"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Rate Card"}
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
    </div>
  );
}
