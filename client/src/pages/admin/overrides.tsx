import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Users, Edit, Trash2 } from "lucide-react";
import type { OverrideAgreement, User, Provider, Client, Service } from "@shared/schema";

export default function AdminOverrides() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<OverrideAgreement | null>(null);
  const [formData, setFormData] = useState({
    recipientUserId: "",
    sourceLevel: "REP",
    amountFlat: "",
    providerId: "",
    clientId: "",
    serviceId: "",
    effectiveStart: "",
    effectiveEnd: "",
    active: true,
    notes: "",
  });

  const { data: items, isLoading } = useQuery<OverrideAgreement[]>({
    queryKey: ["/api/admin/overrides"],
    queryFn: async () => {
      const res = await fetch("/api/admin/overrides", { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const { data: users } = useQuery<User[]>({
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

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/admin/overrides", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      closeDialog();
      toast({ title: "Override agreement created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`/api/admin/overrides/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      closeDialog();
      toast({ title: "Override agreement updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/overrides/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/overrides"] });
      toast({ title: "Override agreement deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingItem(null);
    setFormData({
      recipientUserId: "",
      sourceLevel: "REP",
      amountFlat: "",
      providerId: "",
      clientId: "",
      serviceId: "",
      effectiveStart: "",
      effectiveEnd: "",
      active: true,
      notes: "",
    });
  };

  const eligibleRecipients = users?.filter((u) =>
    ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN"].includes(u.role) && u.status === "ACTIVE"
  );

  const getUserName = (userId: string) => users?.find((u) => u.id === userId)?.name || userId;
  const getUserRole = (userId: string) => users?.find((u) => u.id === userId)?.role || "";
  const getProviderName = (id: string | null) => providers?.find((p) => p.id === id)?.name || "All";
  const getClientName = (id: string | null) => clients?.find((c) => c.id === id)?.name || "All";
  const getServiceName = (id: string | null) => services?.find((s) => s.id === id)?.name || "All";

  const filtered = items?.filter((i) => {
    const recipientName = getUserName(i.recipientUserId).toLowerCase();
    return recipientName.includes(searchTerm.toLowerCase()) || i.sourceLevel.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const columns = [
    {
      key: "recipient",
      header: "Recipient",
      cell: (r: OverrideAgreement) => (
        <div>
          <span className="font-medium">{getUserName(r.recipientUserId)}</span>
          <Badge variant="outline" className="ml-2">{getUserRole(r.recipientUserId)}</Badge>
        </div>
      ),
    },
    {
      key: "sourceLevel",
      header: "Source Level",
      cell: (r: OverrideAgreement) => <Badge variant="secondary">{r.sourceLevel}</Badge>,
    },
    {
      key: "amountFlat",
      header: "Amount",
      cell: (r: OverrideAgreement) => <span className="font-mono">${parseFloat(r.amountFlat).toFixed(2)}</span>,
      className: "text-right",
    },
    {
      key: "filters",
      header: "Filters",
      cell: (r: OverrideAgreement) => (
        <div className="text-sm text-muted-foreground">
          {r.providerId || r.clientId || r.serviceId ? (
            <span>
              {r.providerId && `Provider: ${getProviderName(r.providerId)}`}
              {r.clientId && ` | Client: ${getClientName(r.clientId)}`}
              {r.serviceId && ` | Service: ${getServiceName(r.serviceId)}`}
            </span>
          ) : (
            "All orders"
          )}
        </div>
      ),
    },
    {
      key: "dates",
      header: "Effective Period",
      cell: (r: OverrideAgreement) => (
        <span className="text-sm text-muted-foreground">
          {new Date(r.effectiveStart).toLocaleDateString()} - {r.effectiveEnd ? new Date(r.effectiveEnd).toLocaleDateString() : "Ongoing"}
        </span>
      ),
    },
    {
      key: "active",
      header: "Status",
      cell: (r: OverrideAgreement) => <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      cell: (r: OverrideAgreement) => (
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setEditingItem(r);
              setFormData({
                recipientUserId: r.recipientUserId,
                sourceLevel: r.sourceLevel,
                amountFlat: r.amountFlat,
                providerId: r.providerId || "",
                clientId: r.clientId || "",
                serviceId: r.serviceId || "",
                effectiveStart: r.effectiveStart,
                effectiveEnd: r.effectiveEnd || "",
                active: r.active,
                notes: r.notes || "",
              });
              setShowDialog(true);
            }}
            data-testid={`button-edit-override-${r.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              if (confirm("Are you sure you want to delete this override agreement?")) {
                deleteMutation.mutate(r.id);
              }
            }}
            data-testid={`button-delete-override-${r.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const handleSubmit = () => {
    const data = {
      ...formData,
      providerId: formData.providerId || null,
      clientId: formData.clientId || null,
      serviceId: formData.serviceId || null,
      effectiveEnd: formData.effectiveEnd || null,
    };
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Override Agreements</h1>
            <p className="text-muted-foreground">Configure commission overrides for hierarchy roles</p>
          </div>
        </div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-new-override">
          <Plus className="h-4 w-4 mr-2" />
          New Override
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by recipient or source level..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-overrides"
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={filtered || []} isLoading={isLoading} emptyMessage="No override agreements" testId="table-overrides" />
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={closeDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit" : "Create"} Override Agreement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Recipient (Who receives the override)</Label>
              <Select value={formData.recipientUserId} onValueChange={(v) => setFormData({ ...formData, recipientUserId: v })}>
                <SelectTrigger data-testid="select-recipient">
                  <SelectValue placeholder="Select recipient" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleRecipients?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source Level (Whose sales generate overrides)</Label>
                <Select value={formData.sourceLevel} onValueChange={(v) => setFormData({ ...formData, sourceLevel: v })}>
                  <SelectTrigger data-testid="select-source-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="REP">REP</SelectItem>
                    <SelectItem value="SUPERVISOR">SUPERVISOR</SelectItem>
                    <SelectItem value="MANAGER">MANAGER</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount (Flat $ per order)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amountFlat}
                  onChange={(e) => setFormData({ ...formData, amountFlat: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-amount"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Provider (Optional)</Label>
                <Select value={formData.providerId} onValueChange={(v) => setFormData({ ...formData, providerId: v })}>
                  <SelectTrigger data-testid="select-provider">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Providers</SelectItem>
                    {providers?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Client (Optional)</Label>
                <Select value={formData.clientId} onValueChange={(v) => setFormData({ ...formData, clientId: v })}>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Clients</SelectItem>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Service (Optional)</Label>
                <Select value={formData.serviceId} onValueChange={(v) => setFormData({ ...formData, serviceId: v })}>
                  <SelectTrigger data-testid="select-service">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Services</SelectItem>
                    {services?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Optional notes about this override agreement..."
                data-testid="input-notes"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formData.active} onCheckedChange={(c) => setFormData({ ...formData, active: c })} data-testid="switch-active" />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.recipientUserId || !formData.amountFlat || !formData.effectiveStart}
              data-testid="button-save-override"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
