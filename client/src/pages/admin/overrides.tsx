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
import { Checkbox } from "@/components/ui/checkbox";
import type { OverrideAgreement, User, Provider, Client, Service } from "@shared/schema";

const MOBILE_PRODUCT_TYPES = [
  { value: "NO_MOBILE", label: "No Mobile" },
  { value: "UNLIMITED", label: "Unlimited" },
  { value: "3_GIG", label: "3 Gig" },
  { value: "1_GIG", label: "1 Gig" },
  { value: "BYOD", label: "BYOD" },
  { value: "OTHER", label: "Other" },
];

type ServiceRate = {
  serviceId: string;
  serviceName: string;
  enabled: boolean;
  amount: string;
  mobileProductType: string;
  tvSoldFilter: string;
};

type WizardData = {
  recipientUserId: string;
  providerId: string;
  clientId: string;
  serviceRates: ServiceRate[];
  effectiveStart: string;
  effectiveEnd: string;
  active: boolean;
  notes: string;
};

export default function AdminOverrides() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>({
    recipientUserId: "",
    providerId: "",
    clientId: "",
    serviceRates: [],
    effectiveStart: new Date().toISOString().split("T")[0],
    effectiveEnd: "",
    active: true,
    notes: "",
  });
  const [editingGroup, setEditingGroup] = useState<{ providerId: string; clientId: string; recipientUserId: string } | null>(null);
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

  const initializeServiceRates = (existingOverrides?: OverrideAgreement[]) => {
    if (!services) return [];
    
    return services.map((service) => {
      const existing = existingOverrides?.find((o) => o.serviceId === service.id);
      return {
        serviceId: service.id,
        serviceName: service.name,
        enabled: !!existing,
        amount: existing?.amountFlat || "",
        mobileProductType: existing?.mobileProductType || "",
        tvSoldFilter: existing?.tvSoldFilter === null ? "" : existing?.tvSoldFilter ? "true" : "false",
      };
    });
  };

  const startWizard = (existingGroup?: { providerId: string; clientId: string; recipientUserId: string }) => {
    if (existingGroup && selectedUser) {
      setEditingGroup(existingGroup);
      const groupOverrides = getOverridesForUser(selectedUser.id).filter(
        (o) => o.providerId === existingGroup.providerId && 
               o.clientId === existingGroup.clientId && 
               o.recipientUserId === existingGroup.recipientUserId
      );
      const firstOverride = groupOverrides[0];
      setWizardData({
        recipientUserId: existingGroup.recipientUserId,
        providerId: existingGroup.providerId,
        clientId: existingGroup.clientId,
        serviceRates: initializeServiceRates(groupOverrides),
        effectiveStart: firstOverride?.effectiveStart || new Date().toISOString().split("T")[0],
        effectiveEnd: firstOverride?.effectiveEnd || "",
        active: firstOverride?.active ?? true,
        notes: firstOverride?.notes || "",
      });
    } else {
      setEditingGroup(null);
      setWizardData({
        recipientUserId: "",
        providerId: "",
        clientId: "",
        serviceRates: initializeServiceRates(),
        effectiveStart: new Date().toISOString().split("T")[0],
        effectiveEnd: "",
        active: true,
        notes: "",
      });
    }
    setWizardStep(1);
    setWizardOpen(true);
  };

  useEffect(() => {
    if (wizardOpen && wizardData.serviceRates.length === 0 && services) {
      setWizardData(prev => ({
        ...prev,
        serviceRates: initializeServiceRates(),
      }));
    }
  }, [wizardOpen, services]);

  const closeWizard = () => {
    setWizardOpen(false);
    setEditingGroup(null);
    setWizardStep(1);
  };

  const updateWizard = (field: keyof WizardData, value: any) => {
    setWizardData({ ...wizardData, [field]: value });
  };

  const updateServiceRate = (serviceId: string, field: keyof ServiceRate, value: any) => {
    setWizardData({
      ...wizardData,
      serviceRates: wizardData.serviceRates.map((sr) =>
        sr.serviceId === serviceId ? { ...sr, [field]: value } : sr
      ),
    });
  };

  const canProceed = () => {
    switch (wizardStep) {
      case 1: return !!wizardData.recipientUserId;
      case 2: return !!wizardData.providerId && !!wizardData.clientId;
      case 3: {
        const enabledRates = wizardData.serviceRates.filter((sr) => sr.enabled);
        return enabledRates.length > 0 && enabledRates.every((sr) => sr.amount && parseFloat(sr.amount) > 0);
      }
      case 4: return true;
      default: return false;
    }
  };

  const saveOverrides = async () => {
    if (!selectedUser) return;
    setSaving(true);

    try {
      if (editingGroup) {
        const existingOverrides = getOverridesForUser(selectedUser.id).filter(
          (o) => o.providerId === editingGroup.providerId && 
                 o.clientId === editingGroup.clientId && 
                 o.recipientUserId === editingGroup.recipientUserId
        );
        for (const existing of existingOverrides) {
          await fetch(`/api/admin/overrides/${existing.id}`, {
            method: "DELETE",
            headers: getAuthHeaders(),
          });
        }
      }

      const enabledRates = wizardData.serviceRates.filter((sr) => sr.enabled && sr.amount);
      
      for (const rate of enabledRates) {
        const data = {
          sourceUserId: selectedUser.id,
          recipientUserId: wizardData.recipientUserId,
          sourceLevel: selectedUser.role,
          amountFlat: rate.amount,
          providerId: wizardData.providerId,
          clientId: wizardData.clientId,
          serviceId: rate.serviceId,
          mobileProductType: rate.mobileProductType || null,
          tvSoldFilter: rate.tvSoldFilter === "" ? null : rate.tvSoldFilter === "true",
          effectiveStart: wizardData.effectiveStart,
          effectiveEnd: wizardData.effectiveEnd || null,
          active: wizardData.active,
          notes: wizardData.notes || null,
        };

        await fetch("/api/admin/overrides", {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: editingGroup ? "Overrides updated" : "Overrides created" });
      closeWizard();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteOverrideGroup = async (group: { providerId: string; clientId: string; recipientUserId: string }) => {
    if (!selectedUser) return;
    try {
      const groupOverrides = getOverridesForUser(selectedUser.id).filter(
        (o) => o.providerId === group.providerId && 
               o.clientId === group.clientId && 
               o.recipientUserId === group.recipientUserId
      );
      for (const override of groupOverrides) {
        await fetch(`/api/admin/overrides/${override.id}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: "Override group deleted" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to delete", variant: "destructive" });
    }
  };

  const isLoading = overridesLoading || usersLoading;

  const getGroupedOverrides = (userId: string) => {
    const userOverrides = getOverridesForUser(userId);
    const groups: { 
      key: string; 
      providerId: string; 
      clientId: string; 
      recipientUserId: string;
      recipientName: string;
      recipientRole: string;
      providerName: string;
      clientName: string;
      services: { name: string; amount: string }[];
      totalAmount: number;
      active: boolean;
    }[] = [];

    userOverrides.forEach((o) => {
      const key = `${o.providerId}-${o.clientId}-${o.recipientUserId}`;
      let group = groups.find((g) => g.key === key);
      if (!group) {
        group = {
          key,
          providerId: o.providerId || "",
          clientId: o.clientId || "",
          recipientUserId: o.recipientUserId,
          recipientName: getUserName(o.recipientUserId),
          recipientRole: getUserRole(o.recipientUserId),
          providerName: getProviderName(o.providerId || ""),
          clientName: getClientName(o.clientId || ""),
          services: [],
          totalAmount: 0,
          active: o.active,
        };
        groups.push(group);
      }
      group.services.push({ 
        name: o.serviceId ? getServiceName(o.serviceId) : "All Services", 
        amount: o.amountFlat 
      });
      group.totalAmount += parseFloat(o.amountFlat || "0");
    });

    return groups;
  };

  const stepTitles = ["Select Recipient", "Select Provider & Client", "Set Service Rates", "Review & Save"];

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
                const groups = getGroupedOverrides(user.id);
                const totalRecipients = new Set(groups.map(g => g.recipientUserId)).size;
                const totalAmount = groups.reduce((sum, g) => sum + g.totalAmount, 0);
                
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
                      {groups.length > 0 ? (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">{totalRecipients}</span> recipient{totalRecipients !== 1 ? "s" : ""} 
                          <span className="mx-2">|</span>
                          <span className="font-medium text-foreground">{groups.length}</span> override{groups.length !== 1 ? "s" : ""}
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
            {getGroupedOverrides(selectedUser?.id || "").length === 0 ? (
              <div className="text-center py-8 border rounded-md bg-muted/20">
                <DollarSign className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No override recipients configured</p>
              </div>
            ) : (
              <div className="space-y-3">
                {getGroupedOverrides(selectedUser?.id || "").map((group) => (
                  <div
                    key={group.key}
                    className="p-4 rounded-md border space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{group.recipientName}</span>
                          <Badge variant="secondary" className="text-xs">{group.recipientRole}</Badge>
                          {!group.active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {group.providerName} + {group.clientName}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startWizard(group)}
                          data-testid={`button-edit-group-${group.key}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteOverrideGroup(group)}
                          data-testid={`button-delete-group-${group.key}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.services.map((s, i) => (
                        <Badge key={i} variant="outline" className="font-normal">
                          {s.name}: <span className="font-mono ml-1">${s.amount}</span>
                        </Badge>
                      ))}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingGroup ? "Edit Override" : "Create Override"} - Step {wizardStep} of 4
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
                Select the Provider and Client combination for this override.
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select 
                    value={wizardData.providerId || "__none__"} 
                    onValueChange={(v) => updateWizard("providerId", v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger data-testid="select-wizard-provider">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="__none__">Select provider</SelectItem>
                      {providers?.filter(p => !p.deletedAt).map((p) => (
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
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Set override amounts for each service type. Check the services that apply.
              </p>
              <div className="space-y-3">
                {wizardData.serviceRates.map((sr) => (
                  <div
                    key={sr.serviceId}
                    className={`p-3 rounded-md border ${sr.enabled ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={sr.enabled}
                        onCheckedChange={(c) => updateServiceRate(sr.serviceId, "enabled", !!c)}
                        data-testid={`checkbox-service-${sr.serviceId}`}
                      />
                      <span className="font-medium flex-1">{sr.serviceName}</span>
                      {sr.enabled && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">$</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={sr.amount}
                            onChange={(e) => updateServiceRate(sr.serviceId, "amount", e.target.value)}
                            placeholder="0.00"
                            className="w-24"
                            data-testid={`input-rate-${sr.serviceId}`}
                          />
                        </div>
                      )}
                    </div>
                    {sr.enabled && (
                      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Mobile Filter</Label>
                          <Select 
                            value={sr.mobileProductType || "__all__"} 
                            onValueChange={(v) => updateServiceRate(sr.serviceId, "mobileProductType", v === "__all__" ? "" : v)}
                          >
                            <SelectTrigger className="h-8 text-xs" data-testid={`select-mobile-${sr.serviceId}`}>
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
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">TV Filter</Label>
                          <Select 
                            value={sr.tvSoldFilter || "__all__"} 
                            onValueChange={(v) => updateServiceRate(sr.serviceId, "tvSoldFilter", v === "__all__" ? "" : v)}
                          >
                            <SelectTrigger className="h-8 text-xs" data-testid={`select-tv-${sr.serviceId}`}>
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
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t space-y-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={wizardData.effectiveStart}
                    onChange={(e) => updateWizard("effectiveStart", e.target.value)}
                    data-testid="input-wizard-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date (Optional)</Label>
                  <Input
                    type="date"
                    value={wizardData.effectiveEnd}
                    onChange={(e) => updateWizard("effectiveEnd", e.target.value)}
                    data-testid="input-wizard-end"
                  />
                </div>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-4">
              <div className="p-4 rounded-md bg-muted/30 space-y-3">
                <h4 className="font-medium">Summary</h4>
                <div className="text-sm space-y-2">
                  <p><span className="text-muted-foreground">Recipient:</span> {getUserName(wizardData.recipientUserId)}</p>
                  <p><span className="text-muted-foreground">Provider:</span> {getProviderName(wizardData.providerId)}</p>
                  <p><span className="text-muted-foreground">Client:</span> {getClientName(wizardData.clientId)}</p>
                  <p><span className="text-muted-foreground">Start:</span> {wizardData.effectiveStart}</p>
                  {wizardData.effectiveEnd && (
                    <p><span className="text-muted-foreground">End:</span> {wizardData.effectiveEnd}</p>
                  )}
                </div>
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground mb-2">Service Rates:</p>
                  <div className="flex flex-wrap gap-2">
                    {wizardData.serviceRates.filter(sr => sr.enabled).map((sr) => (
                      <Badge key={sr.serviceId} variant="outline">
                        {sr.serviceName}: <span className="font-mono ml-1">${sr.amount}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
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
                <Label>Notes (Optional)</Label>
                <Input
                  value={wizardData.notes}
                  onChange={(e) => updateWizard("notes", e.target.value)}
                  placeholder="Internal notes..."
                  data-testid="input-wizard-notes"
                />
              </div>
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
                onClick={saveOverrides} 
                disabled={saving || !canProceed()}
                data-testid="button-wizard-save"
              >
                {saving ? "Saving..." : (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    {editingGroup ? "Update" : "Create"}
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
