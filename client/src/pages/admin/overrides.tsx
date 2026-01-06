import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Search, Users, Plus, Trash2, ChevronRight, DollarSign, ChevronLeft, Check, Settings2, Edit } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { OverrideAgreement, User, Provider, Client, Service } from "@shared/schema";

const MOBILE_PRODUCT_TYPES = [
  { value: "NO_MOBILE", label: "No Mobile" },
  { value: "UNLIMITED", label: "Unlimited" },
  { value: "3_GIG", label: "3 Gig" },
  { value: "1_GIG", label: "1 Gig" },
  { value: "BYOD", label: "BYOD" },
  { value: "OTHER", label: "Other" },
];

type ScopeType = "ALL" | "PROVIDER" | "PROVIDER_CLIENT" | "SERVICE";

type WizardData = {
  recipientUserId: string;
  scope: ScopeType;
  providerId: string;
  clientId: string;
  serviceId: string;
  amountFlat: string;
  mobileProductType: string;
  tvSoldFilter: string;
  effectiveStart: string;
  effectiveEnd: string;
  active: boolean;
  notes: string;
};

const initialWizardData: WizardData = {
  recipientUserId: "",
  scope: "ALL",
  providerId: "",
  clientId: "",
  serviceId: "",
  amountFlat: "",
  mobileProductType: "",
  tvSoldFilter: "",
  effectiveStart: new Date().toISOString().split("T")[0],
  effectiveEnd: "",
  active: true,
  notes: "",
};

export default function AdminOverrides() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>(initialWizardData);
  const [editingOverride, setEditingOverride] = useState<OverrideAgreement | null>(null);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  const salesUsers = users?.filter((u) => 
    ["REP", "SUPERVISOR", "MANAGER"].includes(u.role) && u.status === "ACTIVE" && !u.deletedAt
  ) || [];

  const eligibleRecipients = users?.filter((u) =>
    ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(u.role) && u.status === "ACTIVE" && !u.deletedAt
  ) || [];

  const getUserName = (userId: string) => users?.find((u) => u.id === userId)?.name || userId;
  const getUserRole = (userId: string) => users?.find((u) => u.id === userId)?.role || "";
  const getProviderName = (id: string) => providers?.find((p) => p.id === id)?.name || "";
  const getClientName = (id: string) => clients?.find((c) => c.id === id)?.name || "";
  const getServiceName = (id: string) => services?.find((s) => s.id === id)?.name || "";

  const getOverridesForUser = (userId: string) => {
    return allOverrides?.filter((o) => o.sourceUserId === userId) || [];
  };

  const filteredUsers = salesUsers.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openUserOverrides = (user: User) => {
    setSelectedUser(user);
  };

  const closeDialog = () => {
    setSelectedUser(null);
  };

  const startWizard = (existingOverride?: OverrideAgreement) => {
    if (existingOverride) {
      setEditingOverride(existingOverride);
      const scope: ScopeType = existingOverride.serviceId ? "SERVICE" :
        (existingOverride.clientId ? "PROVIDER_CLIENT" : 
        (existingOverride.providerId ? "PROVIDER" : "ALL"));
      setWizardData({
        recipientUserId: existingOverride.recipientUserId,
        scope,
        providerId: existingOverride.providerId || "",
        clientId: existingOverride.clientId || "",
        serviceId: existingOverride.serviceId || "",
        amountFlat: existingOverride.amountFlat,
        mobileProductType: existingOverride.mobileProductType || "",
        tvSoldFilter: existingOverride.tvSoldFilter === null ? "" : existingOverride.tvSoldFilter ? "true" : "false",
        effectiveStart: existingOverride.effectiveStart,
        effectiveEnd: existingOverride.effectiveEnd || "",
        active: existingOverride.active,
        notes: existingOverride.notes || "",
      });
    } else {
      setEditingOverride(null);
      setWizardData(initialWizardData);
    }
    setWizardStep(1);
    setAdvancedOpen(false);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setEditingOverride(null);
    setWizardData(initialWizardData);
    setWizardStep(1);
  };

  const updateWizard = (field: keyof WizardData, value: any) => {
    setWizardData({ ...wizardData, [field]: value });
  };

  const canProceed = () => {
    switch (wizardStep) {
      case 1: return !!wizardData.recipientUserId;
      case 2: {
        if (wizardData.scope === "ALL") return true;
        if (wizardData.scope === "PROVIDER") return !!wizardData.providerId;
        if (wizardData.scope === "PROVIDER_CLIENT") return !!wizardData.providerId && !!wizardData.clientId;
        if (wizardData.scope === "SERVICE") return !!wizardData.serviceId;
        return false;
      }
      case 3: return !!wizardData.amountFlat && parseFloat(wizardData.amountFlat) > 0;
      case 4: return true;
      default: return false;
    }
  };

  const saveOverride = async () => {
    if (!selectedUser) return;
    setSaving(true);

    try {
      const data = {
        sourceUserId: selectedUser.id,
        recipientUserId: wizardData.recipientUserId,
        sourceLevel: selectedUser.role,
        amountFlat: wizardData.amountFlat,
        providerId: wizardData.scope !== "ALL" ? wizardData.providerId || null : null,
        clientId: ["PROVIDER_CLIENT", "SERVICE"].includes(wizardData.scope) ? wizardData.clientId || null : null,
        serviceId: wizardData.scope === "SERVICE" ? wizardData.serviceId || null : null,
        mobileProductType: wizardData.mobileProductType || null,
        tvSoldFilter: wizardData.tvSoldFilter === "" ? null : wizardData.tvSoldFilter === "true",
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

      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: editingOverride ? "Override updated" : "Override created" });
      closeWizard();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteOverride = async (id: string) => {
    try {
      await fetch(`/api/admin/overrides/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: "Override deleted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to delete", variant: "destructive" });
    }
  };

  const isLoading = overridesLoading || usersLoading;

  const getScopeDescription = (override: OverrideAgreement) => {
    if (override.serviceId) {
      return `${getServiceName(override.serviceId)}${override.clientId ? ` (${getClientName(override.clientId)})` : ""}`;
    }
    if (override.clientId) {
      return `${getProviderName(override.providerId || "")} + ${getClientName(override.clientId)}`;
    }
    if (override.providerId) {
      return getProviderName(override.providerId);
    }
    return "All Orders";
  };

  const stepTitles = ["Select Recipient", "Choose Scope", "Set Rate", "Review & Save"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Override Agreements</h1>
          <p className="text-muted-foreground">Configure who earns overrides on each person's sales</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or role..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-users"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              Showing {filteredUsers.length} of {salesUsers.length} sales users
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No sales users found</div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => {
                const userOverrides = getOverridesForUser(user.id);
                const totalAmount = userOverrides.reduce((sum, o) => sum + parseFloat(o.amountFlat || "0"), 0);
                
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 rounded-md border hover-elevate cursor-pointer"
                    onClick={() => openUserOverrides(user)}
                    data-testid={`row-user-${user.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="font-medium">{user.name}</span>
                        <Badge variant="outline" className="ml-2">{user.role}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {userOverrides.length > 0 ? (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">{userOverrides.length}</span> recipient{userOverrides.length !== 1 ? "s" : ""} 
                          <span className="mx-2">|</span>
                          <span className="font-mono">${totalAmount.toFixed(2)}</span> total per sale
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">No overrides configured</span>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedUser && !wizardOpen} onOpenChange={() => closeDialog()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Overrides for {selectedUser?.name}
              <Badge variant="outline">{selectedUser?.role}</Badge>
            </DialogTitle>
            <DialogDescription>
              People who earn commission when {selectedUser?.name} makes a sale
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {getOverridesForUser(selectedUser?.id || "").length === 0 ? (
              <div className="text-center py-8 border rounded-md bg-muted/20">
                <DollarSign className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No override recipients configured</p>
              </div>
            ) : (
              <div className="space-y-2">
                {getOverridesForUser(selectedUser?.id || "").map((override) => (
                  <div
                    key={override.id}
                    className="flex items-center justify-between p-3 rounded-md border"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{getUserName(override.recipientUserId)}</span>
                        <Badge variant="secondary" className="text-xs">{getUserRole(override.recipientUserId)}</Badge>
                        {!override.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-medium text-foreground">${override.amountFlat}</span>
                        <span>per sale</span>
                        <span className="text-muted-foreground/50">|</span>
                        <span>{getScopeDescription(override)}</span>
                        {override.mobileProductType && (
                          <>
                            <span className="text-muted-foreground/50">|</span>
                            <span>{MOBILE_PRODUCT_TYPES.find(t => t.value === override.mobileProductType)?.label}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => startWizard(override)}
                        data-testid={`button-edit-override-${override.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteOverride(override.id)}
                        data-testid={`button-delete-override-${override.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog}>Close</Button>
            <Button onClick={() => startWizard()} data-testid="button-add-override">
              <Plus className="h-4 w-4 mr-2" />
              Add Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wizardOpen} onOpenChange={() => closeWizard()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingOverride ? "Edit Override" : "Create Override"} - Step {wizardStep} of 4
            </DialogTitle>
            <DialogDescription>{stepTitles[wizardStep - 1]}</DialogDescription>
          </DialogHeader>

          <div className="flex gap-1 mb-4">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`h-1 flex-1 rounded-full ${
                  step <= wizardStep ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {wizardStep === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Who should receive commission when {selectedUser?.name} makes a sale?
              </p>
              <div className="space-y-2">
                <Label>Override Recipient</Label>
                <Select 
                  value={wizardData.recipientUserId || "__none__"} 
                  onValueChange={(v) => updateWizard("recipientUserId", v === "__none__" ? "" : v)}
                >
                  <SelectTrigger data-testid="select-wizard-recipient">
                    <SelectValue placeholder="Select recipient" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    <SelectItem value="__none__">Select recipient</SelectItem>
                    {eligibleRecipients.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Which sales should trigger this override?
              </p>
              <div className="space-y-3">
                {[
                  { value: "ALL", label: "All Orders", desc: "Override applies to all sales" },
                  { value: "PROVIDER", label: "By Provider", desc: "Only sales from a specific provider" },
                  { value: "PROVIDER_CLIENT", label: "Provider + Client", desc: "Provider and client combination" },
                  { value: "SERVICE", label: "Specific Service", desc: "Only a particular service type" },
                ].map((option) => (
                  <div
                    key={option.value}
                    className={`p-3 rounded-md border cursor-pointer hover-elevate ${
                      wizardData.scope === option.value ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() => updateWizard("scope", option.value as ScopeType)}
                    data-testid={`scope-option-${option.value}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                        wizardData.scope === option.value ? "border-primary" : "border-muted-foreground"
                      }`}>
                        {wizardData.scope === option.value && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <span className="font-medium">{option.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground ml-6">{option.desc}</p>
                  </div>
                ))}
              </div>

              {wizardData.scope === "PROVIDER" && (
                <div className="space-y-2 mt-4">
                  <Label>Select Provider</Label>
                  <Select 
                    value={wizardData.providerId || "__none__"} 
                    onValueChange={(v) => updateWizard("providerId", v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger data-testid="select-wizard-provider">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="__none__">Select provider</SelectItem>
                      {providers?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {wizardData.scope === "PROVIDER_CLIENT" && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select 
                      value={wizardData.providerId || "__none__"} 
                      onValueChange={(v) => updateWizard("providerId", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger data-testid="select-wizard-provider-2">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4}>
                        <SelectItem value="__none__">Select provider</SelectItem>
                        {providers?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Client</Label>
                    <Select 
                      value={wizardData.clientId || "__none__"} 
                      onValueChange={(v) => updateWizard("clientId", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger data-testid="select-wizard-client">
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent position="popper" sideOffset={4}>
                        <SelectItem value="__none__">Select client</SelectItem>
                        {clients?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {wizardData.scope === "SERVICE" && (
                <div className="space-y-2 mt-4">
                  <Label>Select Service</Label>
                  <Select 
                    value={wizardData.serviceId || "__none__"} 
                    onValueChange={(v) => updateWizard("serviceId", v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger data-testid="select-wizard-service">
                      <SelectValue placeholder="Select service" />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="__none__">Select service</SelectItem>
                      {services?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                How much should {getUserName(wizardData.recipientUserId)} earn per qualifying sale?
              </p>
              <div className="space-y-2">
                <Label>Amount per Sale ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={wizardData.amountFlat}
                  onChange={(e) => updateWizard("amountFlat", e.target.value)}
                  placeholder="0.00"
                  className="text-lg"
                  data-testid="input-wizard-amount"
                />
              </div>

              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={wizardData.effectiveStart}
                  onChange={(e) => updateWizard("effectiveStart", e.target.value)}
                  data-testid="input-wizard-start"
                />
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-muted/30 space-y-2">
                <h4 className="font-medium">Summary</h4>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Recipient:</span> {getUserName(wizardData.recipientUserId)}</p>
                  <p><span className="text-muted-foreground">Amount:</span> ${wizardData.amountFlat} per sale</p>
                  <p><span className="text-muted-foreground">Scope:</span> {
                    wizardData.scope === "ALL" ? "All Orders" :
                    wizardData.scope === "PROVIDER" ? getProviderName(wizardData.providerId) :
                    wizardData.scope === "PROVIDER_CLIENT" ? `${getProviderName(wizardData.providerId)} + ${getClientName(wizardData.clientId)}` :
                    getServiceName(wizardData.serviceId)
                  }</p>
                  <p><span className="text-muted-foreground">Start:</span> {wizardData.effectiveStart}</p>
                </div>
              </div>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between" data-testid="button-advanced-options">
                    <span className="flex items-center gap-2">
                      <Settings2 className="h-4 w-4" />
                      Advanced Options
                    </span>
                    <ChevronRight className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Mobile Filter</Label>
                      <Select 
                        value={wizardData.mobileProductType || "__all__"} 
                        onValueChange={(v) => updateWizard("mobileProductType", v === "__all__" ? "" : v)}
                      >
                        <SelectTrigger data-testid="select-wizard-mobile">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={4}>
                          <SelectItem value="__all__">Any</SelectItem>
                          {MOBILE_PRODUCT_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">TV Filter</Label>
                      <Select 
                        value={wizardData.tvSoldFilter || "__all__"} 
                        onValueChange={(v) => updateWizard("tvSoldFilter", v === "__all__" ? "" : v)}
                      >
                        <SelectTrigger data-testid="select-wizard-tv">
                          <SelectValue placeholder="Any" />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={4}>
                          <SelectItem value="__all__">Any</SelectItem>
                          <SelectItem value="true">TV Sold</SelectItem>
                          <SelectItem value="false">No TV</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">End Date (Optional)</Label>
                    <Input
                      type="date"
                      value={wizardData.effectiveEnd}
                      onChange={(e) => updateWizard("effectiveEnd", e.target.value)}
                      data-testid="input-wizard-end"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch 
                      checked={wizardData.active} 
                      onCheckedChange={(c) => updateWizard("active", c)} 
                      data-testid="switch-wizard-active"
                    />
                    <Label>Active</Label>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Notes (Optional)</Label>
                    <Input
                      value={wizardData.notes}
                      onChange={(e) => updateWizard("notes", e.target.value)}
                      placeholder="Internal notes about this override..."
                      data-testid="input-wizard-notes"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          <DialogFooter className="gap-2">
            {wizardStep > 1 && (
              <Button variant="outline" onClick={() => setWizardStep(wizardStep - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
            <Button variant="outline" onClick={closeWizard}>Cancel</Button>
            {wizardStep < 4 ? (
              <Button 
                onClick={() => setWizardStep(wizardStep + 1)} 
                disabled={!canProceed()}
                data-testid="button-wizard-next"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button 
                onClick={saveOverride} 
                disabled={saving || !canProceed()}
                data-testid="button-wizard-save"
              >
                {saving ? "Saving..." : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    {editingOverride ? "Update" : "Create"}
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
