import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Search, Users, Plus, Trash2, ChevronRight, DollarSign } from "lucide-react";
import type { OverrideAgreement, User, Provider, Client, Service } from "@shared/schema";

const MOBILE_PRODUCT_TYPES = [
  { value: "UNLIMITED", label: "Unlimited" },
  { value: "3_GIG", label: "3 Gig" },
  { value: "1_GIG", label: "1 Gig" },
  { value: "BYOD", label: "BYOD" },
  { value: "OTHER", label: "Other" },
];

type OverrideEntry = {
  id?: string;
  recipientUserId: string;
  amountFlat: string;
  providerId: string;
  clientId: string;
  serviceId: string;
  mobileProductType: string;
  tvSoldFilter: string;
  effectiveStart: string;
  effectiveEnd: string;
  active: boolean;
  notes: string;
};

export default function AdminOverrides() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
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
    ["REP", "SUPERVISOR", "MANAGER"].includes(u.role) && u.status === "ACTIVE"
  ) || [];

  const eligibleRecipients = users?.filter((u) =>
    ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN"].includes(u.role) && u.status === "ACTIVE"
  ) || [];

  const getUserName = (userId: string) => users?.find((u) => u.id === userId)?.name || userId;
  const getUserRole = (userId: string) => users?.find((u) => u.id === userId)?.role || "";

  const getOverridesForUser = (userId: string) => {
    return allOverrides?.filter((o) => o.sourceUserId === userId) || [];
  };

  const filteredUsers = salesUsers.filter((u) =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const openUserOverrides = (user: User) => {
    setSelectedUser(user);
    const existing = getOverridesForUser(user.id);
    if (existing.length > 0) {
      setOverrides(existing.map((o) => ({
        id: o.id,
        recipientUserId: o.recipientUserId,
        amountFlat: o.amountFlat,
        providerId: o.providerId || "",
        clientId: o.clientId || "",
        serviceId: o.serviceId || "",
        mobileProductType: o.mobileProductType || "",
        tvSoldFilter: o.tvSoldFilter === null ? "" : o.tvSoldFilter ? "true" : "false",
        effectiveStart: o.effectiveStart,
        effectiveEnd: o.effectiveEnd || "",
        active: o.active,
        notes: o.notes || "",
      })));
    } else {
      setOverrides([]);
    }
  };

  const closeDialog = () => {
    setSelectedUser(null);
    setOverrides([]);
  };

  const addOverrideRow = () => {
    const today = new Date().toISOString().split("T")[0];
    setOverrides([...overrides, {
      recipientUserId: "",
      amountFlat: "",
      providerId: "",
      clientId: "",
      serviceId: "",
      mobileProductType: "",
      tvSoldFilter: "",
      effectiveStart: today,
      effectiveEnd: "",
      active: true,
      notes: "",
    }]);
  };

  const updateOverrideRow = (index: number, field: keyof OverrideEntry, value: any) => {
    const updated = [...overrides];
    updated[index] = { ...updated[index], [field]: value };
    setOverrides(updated);
  };

  const removeOverrideRow = (index: number) => {
    setOverrides(overrides.filter((_, i) => i !== index));
  };

  const saveOverrides = async () => {
    if (!selectedUser) return;
    setSaving(true);

    try {
      const existingIds = getOverridesForUser(selectedUser.id).map((o) => o.id);
      const newOverrideIds = overrides.filter((o) => o.id).map((o) => o.id);
      const toDelete = existingIds.filter((id) => !newOverrideIds.includes(id));

      for (const id of toDelete) {
        await fetch(`/api/admin/overrides/${id}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
      }

      for (const override of overrides) {
        if (!override.recipientUserId || !override.amountFlat || !override.effectiveStart) continue;

        const data = {
          sourceUserId: selectedUser.id,
          recipientUserId: override.recipientUserId,
          sourceLevel: selectedUser.role,
          amountFlat: override.amountFlat,
          providerId: override.providerId || null,
          clientId: override.clientId || null,
          serviceId: override.serviceId || null,
          mobileProductType: override.mobileProductType || null,
          tvSoldFilter: override.tvSoldFilter === "" ? null : override.tvSoldFilter === "true",
          effectiveStart: override.effectiveStart,
          effectiveEnd: override.effectiveEnd || null,
          active: override.active,
          notes: override.notes || null,
        };

        if (override.id) {
          await fetch(`/api/admin/overrides/${override.id}`, {
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
      }

      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: "Overrides saved successfully" });
      closeDialog();
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isLoading = overridesLoading || usersLoading;

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
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-users"
            />
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

      <Dialog open={!!selectedUser} onOpenChange={() => closeDialog()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Override Recipients for {selectedUser?.name}
              <Badge variant="outline">{selectedUser?.role}</Badge>
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure who earns commission overrides when {selectedUser?.name} makes a sale. Each recipient will earn their specified amount per qualifying order.
            </p>

            {overrides.length === 0 ? (
              <div className="text-center py-8 border rounded-md bg-muted/20">
                <DollarSign className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No override recipients configured</p>
                <Button variant="outline" className="mt-4" onClick={addOverrideRow} data-testid="button-add-first-override">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Override Recipient
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {overrides.map((override, index) => (
                  <Card key={index} className="p-4">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Recipient ({eligibleRecipients.length} available)</Label>
                            <Select 
                              value={override.recipientUserId || "__none__"} 
                              onValueChange={(v) => updateOverrideRow(index, "recipientUserId", v === "__none__" ? "" : v)}
                            >
                              <SelectTrigger data-testid={`select-recipient-${index}`}>
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
                          <div className="space-y-2">
                            <Label>Amount ($)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={override.amountFlat}
                              onChange={(e) => updateOverrideRow(index, "amountFlat", e.target.value)}
                              placeholder="0.00"
                              data-testid={`input-amount-${index}`}
                            />
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="mt-6"
                          onClick={() => removeOverrideRow(index)}
                          data-testid={`button-remove-override-${index}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Provider Filter</Label>
                          <Select 
                            value={override.providerId || "__all__"} 
                            onValueChange={(v) => updateOverrideRow(index, "providerId", v === "__all__" ? "" : v)}
                          >
                            <SelectTrigger data-testid={`select-provider-${index}`}>
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={4}>
                              <SelectItem value="__all__">All Providers</SelectItem>
                              {providers?.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Client Filter</Label>
                          <Select 
                            value={override.clientId || "__all__"} 
                            onValueChange={(v) => updateOverrideRow(index, "clientId", v === "__all__" ? "" : v)}
                          >
                            <SelectTrigger data-testid={`select-client-${index}`}>
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={4}>
                              <SelectItem value="__all__">All Clients</SelectItem>
                              {clients?.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Service Filter</Label>
                          <Select 
                            value={override.serviceId || "__all__"} 
                            onValueChange={(v) => updateOverrideRow(index, "serviceId", v === "__all__" ? "" : v)}
                          >
                            <SelectTrigger data-testid={`select-service-${index}`}>
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={4}>
                              <SelectItem value="__all__">All Services</SelectItem>
                              {services?.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Mobile Product Filter</Label>
                          <Select 
                            value={override.mobileProductType || "__all__"} 
                            onValueChange={(v) => updateOverrideRow(index, "mobileProductType", v === "__all__" ? "" : v)}
                          >
                            <SelectTrigger data-testid={`select-mobile-product-${index}`}>
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={4}>
                              <SelectItem value="__all__">All Mobile Products</SelectItem>
                              {MOBILE_PRODUCT_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">TV/Video Filter</Label>
                          <Select 
                            value={override.tvSoldFilter || "__all__"} 
                            onValueChange={(v) => updateOverrideRow(index, "tvSoldFilter", v === "__all__" ? "" : v)}
                          >
                            <SelectTrigger data-testid={`select-tv-filter-${index}`}>
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent position="popper" sideOffset={4}>
                              <SelectItem value="__all__">Any (TV or not)</SelectItem>
                              <SelectItem value="true">TV Sold</SelectItem>
                              <SelectItem value="false">No TV</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Start Date</Label>
                          <Input
                            type="date"
                            value={override.effectiveStart}
                            onChange={(e) => updateOverrideRow(index, "effectiveStart", e.target.value)}
                            data-testid={`input-start-${index}`}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">End Date (Optional)</Label>
                          <Input
                            type="date"
                            value={override.effectiveEnd}
                            onChange={(e) => updateOverrideRow(index, "effectiveEnd", e.target.value)}
                            data-testid={`input-end-${index}`}
                          />
                        </div>
                        <div className="flex items-end gap-2 pb-1">
                          <Switch 
                            checked={override.active} 
                            onCheckedChange={(c) => updateOverrideRow(index, "active", c)} 
                            data-testid={`switch-active-${index}`}
                          />
                          <Label className="text-xs">Active</Label>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}

                <Button variant="outline" onClick={addOverrideRow} data-testid="button-add-override">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Another Recipient
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={saveOverrides} disabled={saving} data-testid="button-save-overrides">
              {saving ? "Saving..." : "Save All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
