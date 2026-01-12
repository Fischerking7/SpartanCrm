import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Search, Users, Plus, Trash2, ChevronRight, DollarSign, ChevronLeft, Check, Edit } from "lucide-react";
import type { OverrideAgreement, User, Provider, Client, Service } from "@shared/schema";

const MOBILE_PRODUCT_TYPES = [
  { value: "_any", label: "Any/None" },
  { value: "NO_MOBILE", label: "No Mobile (exclude mobile)" },
  { value: "UNLIMITED", label: "Unlimited" },
  { value: "3_GIG", label: "3 Gig" },
  { value: "1_GIG", label: "1 Gig" },
  { value: "BYOD", label: "BYOD" },
];

const TV_SOLD_OPTIONS = [
  { value: "_any", label: "Any" },
  { value: "true", label: "TV Sold" },
  { value: "false", label: "No TV" },
];

const PORTED_STATUS_OPTIONS = [
  { value: "_any", label: "Any" },
  { value: "PORTED", label: "Ported" },
  { value: "NON_PORTED", label: "Non-Ported" },
];

type WizardData = {
  recipientUserId: string;
  providerId: string;
  clientId: string;
  serviceId: string;
  mobileProductType: string;
  mobilePortedFilter: string;
  tvSoldFilter: string;
  amountFlat: string;
  effectiveStart: string;
  effectiveEnd: string;
  active: boolean;
  notes: string;
};

export default function AdminOverrides() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState<User | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingOverride, setEditingOverride] = useState<OverrideAgreement | null>(null);
  const [wizardData, setWizardData] = useState<WizardData>({
    recipientUserId: "",
    providerId: "",
    clientId: "",
    serviceId: "",
    mobileProductType: "",
    mobilePortedFilter: "",
    tvSoldFilter: "",
    amountFlat: "",
    effectiveStart: new Date().toISOString().split("T")[0],
    effectiveEnd: "",
    active: true,
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const { data: allOverrides, isLoading: overridesLoading } = useQuery<OverrideAgreement[]>({
    queryKey: ["/api/admin/overrides"],
    queryFn: async () => {
      const res = await fetch("/api/admin/overrides", { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
    queryFn: async () => {
      const res = await fetch("/api/services", { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const eligibleRecipients = users?.filter((u) =>
    ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN"].includes(u.role) && u.status === "ACTIVE" && !u.deletedAt
  ) || [];

  const getUserName = (userId: string) => users?.find((u) => u.id === userId)?.name || userId;
  const getUserRole = (userId: string) => users?.find((u) => u.id === userId)?.role || "";
  const getProviderName = (id: string | null) => id ? (providers?.find((p) => p.id === id)?.name || id) : "Any";
  const getClientName = (id: string | null) => id ? (clients?.find((c) => c.id === id)?.name || id) : "Any";
  const getServiceName = (id: string | null) => id ? (services?.find((s) => s.id === id)?.name || id) : "Any";

  const getOverridesForRecipient = (userId: string) => {
    return allOverrides?.filter((o) => o.recipientUserId === userId) || [];
  };

  const filteredRecipients = eligibleRecipients.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openRecipientOverrides = (user: User) => {
    setSelectedRecipient(user);
  };

  const closeDialog = () => {
    setSelectedRecipient(null);
  };

  const startWizard = (existingOverride?: OverrideAgreement) => {
    if (existingOverride) {
      setEditingOverride(existingOverride);
      setWizardData({
        recipientUserId: existingOverride.recipientUserId,
        providerId: existingOverride.providerId || "_any",
        clientId: existingOverride.clientId || "_any",
        serviceId: existingOverride.serviceId || "_any",
        mobileProductType: existingOverride.mobileProductType || "_any",
        mobilePortedFilter: existingOverride.mobilePortedFilter || "_any",
        tvSoldFilter: existingOverride.tvSoldFilter === null ? "_any" : existingOverride.tvSoldFilter ? "true" : "false",
        amountFlat: existingOverride.amountFlat,
        effectiveStart: existingOverride.effectiveStart,
        effectiveEnd: existingOverride.effectiveEnd || "",
        active: existingOverride.active,
        notes: existingOverride.notes || "",
      });
    } else if (selectedRecipient) {
      setEditingOverride(null);
      setWizardData({
        recipientUserId: selectedRecipient.id,
        providerId: "_any",
        clientId: "_any",
        serviceId: "_any",
        mobileProductType: "_any",
        mobilePortedFilter: "_any",
        tvSoldFilter: "_any",
        amountFlat: "",
        effectiveStart: new Date().toISOString().split("T")[0],
        effectiveEnd: "",
        active: true,
        notes: "",
      });
    }
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setEditingOverride(null);
  };

  const updateWizard = (field: keyof WizardData, value: any) => {
    setWizardData({ ...wizardData, [field]: value });
  };

  const canSave = () => {
    return wizardData.amountFlat && parseFloat(wizardData.amountFlat) > 0 && wizardData.effectiveStart;
  };

  const saveOverride = async () => {
    setSaving(true);

    try {
      const data = {
        recipientUserId: wizardData.recipientUserId,
        amountFlat: wizardData.amountFlat,
        providerId: wizardData.providerId === "_any" ? null : wizardData.providerId,
        clientId: wizardData.clientId === "_any" ? null : wizardData.clientId,
        serviceId: wizardData.serviceId === "_any" ? null : wizardData.serviceId,
        mobileProductType: wizardData.mobileProductType === "_any" ? null : wizardData.mobileProductType,
        mobilePortedFilter: wizardData.mobilePortedFilter === "_any" ? null : wizardData.mobilePortedFilter,
        tvSoldFilter: wizardData.tvSoldFilter === "_any" ? null : wizardData.tvSoldFilter === "true",
        effectiveStart: wizardData.effectiveStart,
        effectiveEnd: wizardData.effectiveEnd || null,
        active: wizardData.active,
        notes: wizardData.notes || null,
      };

      if (editingOverride) {
        await fetch(`/api/admin/overrides/${editingOverride.id}`, {
          method: "PATCH",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else {
        await fetch("/api/admin/overrides", {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      
      toast({ title: editingOverride ? "Override updated" : "Override created" });
      closeWizard();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setSaving(false);
    }
  };

  const deleteOverride = async (overrideId: string) => {
    if (!confirm("Delete this override agreement?")) return;
    
    try {
      await fetch(`/api/admin/overrides/${overrideId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: "Override deleted" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "OPERATIONS": return "default";
      case "ADMIN": return "default";
      case "EXECUTIVE": return "secondary";
      case "MANAGER": return "secondary";
      case "SUPERVISOR": return "outline";
      default: return "outline";
    }
  };

  const getMobileTypeLabel = (value: string | null) => {
    if (!value) return "Any";
    return MOBILE_PRODUCT_TYPES.find(m => m.value === value)?.label || value;
  };

  const getTvLabel = (value: boolean | null) => {
    if (value === null) return "Any";
    return value ? "TV Sold" : "No TV";
  };

  if (usersLoading || overridesLoading) {
    return (
      <div className="p-6" data-testid="overrides-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="admin-overrides-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="page-title">Override Agreements</h1>
          <p className="text-muted-foreground">
            Configure override commissions for supervisors, managers, and executives
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search recipients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid="input-search-recipients"
            />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Select a recipient to view and manage their override agreements. Overrides apply automatically based on role hierarchy.
          </p>
          <div className="space-y-2">
            {filteredRecipients.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center">No eligible recipients found</p>
            ) : (
              filteredRecipients.map((user) => {
                const overrideCount = getOverridesForRecipient(user.id).length;
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-2 p-3 rounded-md border hover-elevate cursor-pointer"
                    onClick={() => openRecipientOverrides(user)}
                    data-testid={`recipient-row-${user.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{user.name}</p>
                        <p className="text-sm text-muted-foreground">ID: {user.repId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge>
                      {overrideCount > 0 && (
                        <Badge variant="secondary">{overrideCount} override{overrideCount !== 1 ? "s" : ""}</Badge>
                      )}
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedRecipient} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Overrides for {selectedRecipient?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedRecipient?.role} - receives overrides on sales from their team hierarchy
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {selectedRecipient?.role === "SUPERVISOR" && "Gets overrides on sales from assigned reps"}
                {selectedRecipient?.role === "MANAGER" && "Gets overrides on sales from assigned supervisors and their reps"}
                {selectedRecipient?.role === "EXECUTIVE" && "Gets overrides on sales from all team members in division"}
                {selectedRecipient?.role === "ADMIN" && "Gets overrides on all sales company-wide"}
              </p>
              <Button onClick={() => startWizard()} data-testid="button-add-override">
                <Plus className="h-4 w-4 mr-2" />
                Add Override
              </Button>
            </div>

            {selectedRecipient && getOverridesForRecipient(selectedRecipient.id).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No override agreements configured</p>
                <p className="text-sm">Click "Add Override" to create one</p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedRecipient && getOverridesForRecipient(selectedRecipient.id).map((override) => (
                  <div
                    key={override.id}
                    className="p-4 border rounded-md space-y-2"
                    data-testid={`override-row-${override.id}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-green-600" />
                        <span className="font-semibold text-lg">${override.amountFlat}</span>
                        <Badge variant={override.active ? "default" : "secondary"}>
                          {override.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => startWizard(override)} data-testid={`button-edit-${override.id}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteOverride(override.id)} data-testid={`button-delete-${override.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Badge variant="outline">Provider: {getProviderName(override.providerId)}</Badge>
                      <Badge variant="outline">Client: {getClientName(override.clientId)}</Badge>
                      <Badge variant="outline">Service: {getServiceName(override.serviceId)}</Badge>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Badge variant="secondary">Mobile: {getMobileTypeLabel(override.mobileProductType)}</Badge>
                      <Badge variant="secondary">Ported: {override.mobilePortedFilter || "Any"}</Badge>
                      <Badge variant="secondary">TV: {getTvLabel(override.tvSoldFilter)}</Badge>
                    </div>
                    
                    <div className="text-sm text-muted-foreground">
                      Effective: {override.effectiveStart} {override.effectiveEnd ? `to ${override.effectiveEnd}` : "(ongoing)"}
                    </div>
                    
                    {override.notes && (
                      <p className="text-sm text-muted-foreground italic">Note: {override.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={wizardOpen} onOpenChange={(open) => !open && closeWizard()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingOverride ? "Edit Override Agreement" : "New Override Agreement"}
            </DialogTitle>
            <DialogDescription>
              Configure override for {getUserName(wizardData.recipientUserId)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Amount per Match ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 5.00"
                value={wizardData.amountFlat}
                onChange={(e) => updateWizard("amountFlat", e.target.value)}
                data-testid="input-amount"
              />
              <p className="text-xs text-muted-foreground mt-1">
                For mobile overrides, this is per line matching the product type
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Provider (optional)</Label>
                <Select value={wizardData.providerId} onValueChange={(v) => updateWizard("providerId", v)}>
                  <SelectTrigger data-testid="select-provider">
                    <SelectValue placeholder="Any provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_any">Any provider</SelectItem>
                    {providers?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label>Client (optional)</Label>
                <Select value={wizardData.clientId} onValueChange={(v) => updateWizard("clientId", v)}>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder="Any client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_any">Any client</SelectItem>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Service (optional)</Label>
              <Select value={wizardData.serviceId} onValueChange={(v) => updateWizard("serviceId", v)}>
                <SelectTrigger data-testid="select-service">
                  <SelectValue placeholder="Any service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_any">Any service</SelectItem>
                  {services?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Mobile Product Type</Label>
                <Select value={wizardData.mobileProductType} onValueChange={(v) => updateWizard("mobileProductType", v)}>
                  <SelectTrigger data-testid="select-mobile-type">
                    <SelectValue placeholder="Any/None" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOBILE_PRODUCT_TYPES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label>Ported Status</Label>
                <Select value={wizardData.mobilePortedFilter} onValueChange={(v) => updateWizard("mobilePortedFilter", v)}>
                  <SelectTrigger data-testid="select-ported-status">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    {PORTED_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label>TV Sold Filter</Label>
                <Select value={wizardData.tvSoldFilter} onValueChange={(v) => updateWizard("tvSoldFilter", v)}>
                  <SelectTrigger data-testid="select-tv-filter">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    {TV_SOLD_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Effective Start</Label>
                <Input
                  type="date"
                  value={wizardData.effectiveStart}
                  onChange={(e) => updateWizard("effectiveStart", e.target.value)}
                  data-testid="input-start-date"
                />
              </div>
              
              <div>
                <Label>Effective End (optional)</Label>
                <Input
                  type="date"
                  value={wizardData.effectiveEnd}
                  onChange={(e) => updateWizard("effectiveEnd", e.target.value)}
                  data-testid="input-end-date"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={wizardData.active}
                onCheckedChange={(v) => updateWizard("active", v)}
                data-testid="switch-active"
              />
              <Label>Active</Label>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input
                placeholder="Internal notes..."
                value={wizardData.notes}
                onChange={(e) => updateWizard("notes", e.target.value)}
                data-testid="input-notes"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeWizard} data-testid="button-cancel">
              Cancel
            </Button>
            <Button onClick={saveOverride} disabled={!canSave() || saving} data-testid="button-save">
              {saving ? "Saving..." : (editingOverride ? "Update" : "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
