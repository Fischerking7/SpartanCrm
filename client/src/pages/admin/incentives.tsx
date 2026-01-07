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
import { Plus, Search, Gift, Edit } from "lucide-react";
import type { Incentive, Provider, Client, Service, User } from "@shared/schema";

const __NONE__ = "__NONE__";

export default function AdminIncentives() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<Incentive | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    repId: __NONE__,
    providerId: __NONE__,
    clientId: __NONE__,
    serviceId: __NONE__,
    type: "FLAT",
    amount: "",
    startDate: "",
    endDate: "",
    active: true,
    notes: "",
  });

  const { data: items, isLoading } = useQuery<Incentive[]>({
    queryKey: ["/api/admin/incentives"],
    queryFn: async () => {
      const res = await fetch("/api/admin/incentives", { headers: getAuthHeaders() });
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

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      return res.json();
    },
  });

  const reps = users?.filter((u) => ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"].includes(u.role)) || [];

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/admin/incentives", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/incentives"] });
      closeDialog();
      toast({ title: "Incentive created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`/api/admin/incentives/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/incentives"] });
      closeDialog();
      toast({ title: "Incentive updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closeDialog = () => {
    setShowDialog(false);
    setEditingItem(null);
    setFormData({
      name: "",
      repId: __NONE__,
      providerId: __NONE__,
      clientId: __NONE__,
      serviceId: __NONE__,
      type: "FLAT",
      amount: "",
      startDate: "",
      endDate: "",
      active: true,
      notes: "",
    });
  };

  const openEdit = (r: Incentive) => {
    setEditingItem(r);
    setFormData({
      name: r.name,
      repId: r.repId || __NONE__,
      providerId: r.providerId || __NONE__,
      clientId: r.clientId || __NONE__,
      serviceId: r.serviceId || __NONE__,
      type: r.type,
      amount: r.amount,
      startDate: r.startDate,
      endDate: r.endDate || "",
      active: r.active,
      notes: r.notes || "",
    });
    setShowDialog(true);
  };

  const handleSave = () => {
    const appliesTo = formData.serviceId !== __NONE__ ? "SERVICE"
      : formData.clientId !== __NONE__ ? "CLIENT"
      : formData.providerId !== __NONE__ ? "PROVIDER"
      : formData.repId !== __NONE__ ? "REP"
      : "GLOBAL";
    
    const data = {
      name: formData.name,
      appliesTo,
      type: formData.type,
      amount: formData.amount,
      startDate: formData.startDate,
      endDate: formData.endDate || null,
      active: formData.active,
      notes: formData.notes,
      repId: formData.repId === __NONE__ ? null : formData.repId,
      providerId: formData.providerId === __NONE__ ? null : formData.providerId,
      clientId: formData.clientId === __NONE__ ? null : formData.clientId,
      serviceId: formData.serviceId === __NONE__ ? null : formData.serviceId,
    };
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getTargetDisplay = (r: Incentive) => {
    const parts: string[] = [];
    if (r.providerId) {
      const provider = providers?.find((p) => p.id === r.providerId);
      parts.push(provider?.name || "Provider");
    }
    if (r.clientId) {
      const client = clients?.find((c) => c.id === r.clientId);
      parts.push(client?.name || "Client");
    }
    if (r.serviceId) {
      const service = services?.find((s) => s.id === r.serviceId);
      parts.push(service?.name || "Service");
    }
    if (r.repId) {
      const rep = users?.find((u) => u.repId === r.repId);
      parts.push(rep?.name || r.repId);
    }
    return parts.length > 0 ? parts.join(", ") : "-";
  };

  const filtered = items?.filter((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const columns = [
    {
      key: "name",
      header: "Name",
      cell: (r: Incentive) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "appliesTo",
      header: "Applies To",
      cell: (r: Incentive) => <Badge variant="outline">{r.appliesTo}</Badge>,
    },
    {
      key: "target",
      header: "Target",
      cell: (r: Incentive) => (
        <span className="text-sm text-muted-foreground">{getTargetDisplay(r)}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (r: Incentive) => <Badge variant="secondary">{r.type}</Badge>,
    },
    {
      key: "amount",
      header: "Amount",
      cell: (r: Incentive) => (
        <span className="font-mono">${parseFloat(r.amount).toFixed(2)}</span>
      ),
      className: "text-right",
    },
    {
      key: "dates",
      header: "Period",
      cell: (r: Incentive) => (
        <span className="text-sm text-muted-foreground">
          {r.startDate} - {r.endDate || "Ongoing"}
        </span>
      ),
    },
    {
      key: "active",
      header: "Status",
      cell: (r: Incentive) => (
        <Badge variant={r.active ? "default" : "secondary"}>
          {r.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (r: Incentive) => (
        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
          <Edit className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Gift className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Incentives</h1>
            <p className="text-muted-foreground">Manage bonus programs</p>
          </div>
        </div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-new-incentive">
          <Plus className="h-4 w-4 mr-2" />
          New Incentive
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filtered || []}
            isLoading={isLoading}
            emptyMessage="No incentives"
            testId="table-incentives"
          />
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={closeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit" : "Create"} Incentive</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(v) => setFormData({ ...formData, type: v })}
                >
                  <SelectTrigger data-testid="select-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLAT">Flat</SelectItem>
                    <SelectItem value="PERCENT">Percent</SelectItem>
                    <SelectItem value="PER_LINE">Per Line</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  data-testid="input-amount"
                />
              </div>
            </div>

            <div className="space-y-4 p-4 rounded-md bg-muted/50">
              <p className="text-sm font-medium">Target (leave blank for all)</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select
                    value={formData.providerId}
                    onValueChange={(v) => setFormData({ ...formData, providerId: v })}
                  >
                    <SelectTrigger data-testid="select-provider">
                      <SelectValue placeholder="All Providers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={__NONE__}>All Providers</SelectItem>
                      {providers?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Client</Label>
                  <Select
                    value={formData.clientId}
                    onValueChange={(v) => setFormData({ ...formData, clientId: v })}
                  >
                    <SelectTrigger data-testid="select-client">
                      <SelectValue placeholder="All Clients" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={__NONE__}>All Clients</SelectItem>
                      {clients?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Service</Label>
                  <Select
                    value={formData.serviceId}
                    onValueChange={(v) => setFormData({ ...formData, serviceId: v })}
                  >
                    <SelectTrigger data-testid="select-service">
                      <SelectValue placeholder="All Services" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={__NONE__}>All Services</SelectItem>
                      {services?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Rep</Label>
                  <Select
                    value={formData.repId}
                    onValueChange={(v) => setFormData({ ...formData, repId: v })}
                  >
                    <SelectTrigger data-testid="select-rep">
                      <SelectValue placeholder="All Reps" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={__NONE__}>All Reps</SelectItem>
                      {reps.map((u) => (
                        <SelectItem key={u.repId} value={u.repId}>
                          {u.name} ({u.repId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  data-testid="input-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label>End Date (optional)</Label>
                <Input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  data-testid="input-end-date"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                data-testid="input-notes"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={formData.active}
                onCheckedChange={(c) => setFormData({ ...formData, active: c })}
                data-testid="switch-active"
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!formData.name || !formData.amount || !formData.startDate}
              data-testid="button-save"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
