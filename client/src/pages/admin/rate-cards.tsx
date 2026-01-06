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
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, DollarSign, Edit } from "lucide-react";
import type { RateCard, Provider, Client, Service } from "@shared/schema";

export default function AdminRateCards() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<RateCard | null>(null);
  const [formData, setFormData] = useState({
    providerId: "", clientId: "", serviceId: "", tvCondition: "ANY", mobileCondition: "ANY",
    linesMin: "", linesMax: "", commissionType: "FLAT", amount: "", effectiveStart: "", effectiveEnd: "", active: true, requiresReview: false,
  });

  const { data: items, isLoading } = useQuery<RateCard[]>({ queryKey: ["/api/admin/rate-cards"], queryFn: async () => { const res = await fetch("/api/admin/rate-cards", { headers: getAuthHeaders() }); return res.json(); } });
  const { data: providers } = useQuery<Provider[]>({ queryKey: ["/api/admin/providers"], queryFn: async () => { const res = await fetch("/api/admin/providers", { headers: getAuthHeaders() }); return res.json(); } });
  const { data: clients } = useQuery<Client[]>({ queryKey: ["/api/admin/clients"], queryFn: async () => { const res = await fetch("/api/admin/clients", { headers: getAuthHeaders() }); return res.json(); } });
  const { data: services } = useQuery<Service[]>({ queryKey: ["/api/admin/services"], queryFn: async () => { const res = await fetch("/api/admin/services", { headers: getAuthHeaders() }); return res.json(); } });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/admin/rate-cards", { method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/rate-cards"] }); closeDialog(); toast({ title: "Rate card created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`/api/admin/rate-cards/${id}`, { method: "PATCH", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/rate-cards"] }); closeDialog(); toast({ title: "Rate card updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closeDialog = () => { setShowDialog(false); setEditingItem(null); setFormData({ providerId: "", clientId: "", serviceId: "", tvCondition: "ANY", mobileCondition: "ANY", linesMin: "", linesMax: "", commissionType: "FLAT", amount: "", effectiveStart: "", effectiveEnd: "", active: true, requiresReview: false }); };
  const getProviderName = (id: string) => providers?.find(p => p.id === id)?.name || id;
  const getClientName = (id: string | null) => id ? clients?.find(c => c.id === id)?.name || id : "Any";
  const getServiceName = (id: string) => services?.find(s => s.id === id)?.name || id;
  const filtered = items?.filter((i) => getProviderName(i.providerId).toLowerCase().includes(searchTerm.toLowerCase()) || getServiceName(i.serviceId).toLowerCase().includes(searchTerm.toLowerCase()));

  const columns = [
    { key: "provider", header: "Provider", cell: (r: RateCard) => <span className="font-medium">{getProviderName(r.providerId)}</span> },
    { key: "client", header: "Client", cell: (r: RateCard) => <span className="text-sm">{getClientName(r.clientId)}</span> },
    { key: "service", header: "Service", cell: (r: RateCard) => <span className="text-sm">{getServiceName(r.serviceId)}</span> },
    { key: "type", header: "Type", cell: (r: RateCard) => <Badge variant="outline">{r.commissionType}</Badge> },
    { key: "amount", header: "Amount", cell: (r: RateCard) => <span className="font-mono">${parseFloat(r.amount).toFixed(2)}</span>, className: "text-right" },
    { key: "active", header: "Status", cell: (r: RateCard) => <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", header: "", cell: (r: RateCard) => <Button size="sm" variant="ghost" onClick={() => { setEditingItem(r); setFormData({ providerId: r.providerId, clientId: r.clientId || "", serviceId: r.serviceId, tvCondition: r.tvCondition, mobileCondition: r.mobileCondition, linesMin: r.linesMin?.toString() || "", linesMax: r.linesMax?.toString() || "", commissionType: r.commissionType, amount: r.amount, effectiveStart: r.effectiveStart, effectiveEnd: r.effectiveEnd || "", active: r.active, requiresReview: r.requiresReview }); setShowDialog(true); }}><Edit className="h-4 w-4" /></Button> },
  ];

  const submitData = () => {
    const data = { ...formData, amount: formData.amount, linesMin: formData.linesMin ? parseInt(formData.linesMin) : null, linesMax: formData.linesMax ? parseInt(formData.linesMax) : null, clientId: formData.clientId || null, effectiveEnd: formData.effectiveEnd || null };
    if (editingItem) updateMutation.mutate({ id: editingItem.id, data }); else createMutation.mutate(data);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3"><DollarSign className="h-6 w-6 text-primary" /><div><h1 className="text-2xl font-semibold">Rate Cards</h1><p className="text-muted-foreground">Manage commission rates</p></div></div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-new-rate-card"><Plus className="h-4 w-4 mr-2" />New Rate Card</Button>
      </div>
      <Card>
        <CardHeader className="pb-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div></CardHeader>
        <CardContent><DataTable columns={columns} data={filtered || []} isLoading={isLoading} emptyMessage="No rate cards" testId="table-rate-cards" /></CardContent>
      </Card>
      <Dialog open={showDialog} onOpenChange={closeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editingItem ? "Edit" : "Create"} Rate Card</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Provider</Label><Select value={formData.providerId} onValueChange={(v) => setFormData({ ...formData, providerId: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{providers?.filter(p => p.active).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Client (Any)</Label><Select value={formData.clientId} onValueChange={(v) => setFormData({ ...formData, clientId: v })}><SelectTrigger><SelectValue placeholder="Any client" /></SelectTrigger><SelectContent><SelectItem value="">Any</SelectItem>{clients?.filter(c => c.active).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Service</Label><Select value={formData.serviceId} onValueChange={(v) => setFormData({ ...formData, serviceId: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{services?.filter(s => s.active).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2"><Label>TV Condition</Label><Select value={formData.tvCondition} onValueChange={(v) => setFormData({ ...formData, tvCondition: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ANY">Any</SelectItem><SelectItem value="YES">Yes</SelectItem><SelectItem value="NO">No</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Mobile Condition</Label><Select value={formData.mobileCondition} onValueChange={(v) => setFormData({ ...formData, mobileCondition: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ANY">Any</SelectItem><SelectItem value="YES">Yes</SelectItem><SelectItem value="NO">No</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Lines Min</Label><Input type="number" value={formData.linesMin} onChange={(e) => setFormData({ ...formData, linesMin: e.target.value })} /></div>
              <div className="space-y-2"><Label>Lines Max</Label><Input type="number" value={formData.linesMax} onChange={(e) => setFormData({ ...formData, linesMax: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-2"><Label>Type</Label><Select value={formData.commissionType} onValueChange={(v) => setFormData({ ...formData, commissionType: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FLAT">Flat</SelectItem><SelectItem value="PER_LINE">Per Line</SelectItem><SelectItem value="TIERED">Tiered</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Amount</Label><Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} /></div>
              <div className="space-y-2"><Label>Effective Start</Label><Input type="date" value={formData.effectiveStart} onChange={(e) => setFormData({ ...formData, effectiveStart: e.target.value })} /></div>
              <div className="space-y-2"><Label>Effective End</Label><Input type="date" value={formData.effectiveEnd} onChange={(e) => setFormData({ ...formData, effectiveEnd: e.target.value })} /></div>
            </div>
            <div className="flex items-center gap-6"><div className="flex items-center gap-2"><Switch checked={formData.active} onCheckedChange={(c) => setFormData({ ...formData, active: c })} /><Label>Active</Label></div><div className="flex items-center gap-2"><Switch checked={formData.requiresReview} onCheckedChange={(c) => setFormData({ ...formData, requiresReview: c })} /><Label>Requires Review</Label></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={closeDialog}>Cancel</Button><Button onClick={submitData} disabled={!formData.providerId || !formData.serviceId || !formData.amount || !formData.effectiveStart}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
