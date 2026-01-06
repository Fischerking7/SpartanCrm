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
import type { Incentive } from "@shared/schema";

export default function AdminIncentives() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<Incentive | null>(null);
  const [formData, setFormData] = useState({
    name: "", appliesTo: "GLOBAL", type: "FLAT", amount: "", startDate: "", endDate: "", active: true, notes: "",
  });

  const { data: items, isLoading } = useQuery<Incentive[]>({
    queryKey: ["/api/admin/incentives"],
    queryFn: async () => { const res = await fetch("/api/admin/incentives", { headers: getAuthHeaders() }); return res.json(); },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/admin/incentives", { method: "POST", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/incentives"] }); closeDialog(); toast({ title: "Incentive created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`/api/admin/incentives/${id}`, { method: "PATCH", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/incentives"] }); closeDialog(); toast({ title: "Incentive updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closeDialog = () => { setShowDialog(false); setEditingItem(null); setFormData({ name: "", appliesTo: "GLOBAL", type: "FLAT", amount: "", startDate: "", endDate: "", active: true, notes: "" }); };
  const filtered = items?.filter((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const columns = [
    { key: "name", header: "Name", cell: (r: Incentive) => <span className="font-medium">{r.name}</span> },
    { key: "appliesTo", header: "Applies To", cell: (r: Incentive) => <Badge variant="outline">{r.appliesTo}</Badge> },
    { key: "type", header: "Type", cell: (r: Incentive) => <Badge variant="secondary">{r.type}</Badge> },
    { key: "amount", header: "Amount", cell: (r: Incentive) => <span className="font-mono">${parseFloat(r.amount).toFixed(2)}</span>, className: "text-right" },
    { key: "active", header: "Status", cell: (r: Incentive) => <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", header: "", cell: (r: Incentive) => <Button size="sm" variant="ghost" onClick={() => { setEditingItem(r); setFormData({ name: r.name, appliesTo: r.appliesTo, type: r.type, amount: r.amount, startDate: r.startDate, endDate: r.endDate || "", active: r.active, notes: r.notes || "" }); setShowDialog(true); }}><Edit className="h-4 w-4" /></Button> },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3"><Gift className="h-6 w-6 text-primary" /><div><h1 className="text-2xl font-semibold">Incentives</h1><p className="text-muted-foreground">Manage bonus programs</p></div></div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-new-incentive"><Plus className="h-4 w-4 mr-2" />New Incentive</Button>
      </div>
      <Card>
        <CardHeader className="pb-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div></CardHeader>
        <CardContent><DataTable columns={columns} data={filtered || []} isLoading={isLoading} emptyMessage="No incentives" testId="table-incentives" /></CardContent>
      </Card>
      <Dialog open={showDialog} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingItem ? "Edit" : "Create"} Incentive</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2"><Label>Applies To</Label><Select value={formData.appliesTo} onValueChange={(v) => setFormData({ ...formData, appliesTo: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GLOBAL">Global</SelectItem><SelectItem value="REP">Rep</SelectItem><SelectItem value="TEAM">Team</SelectItem><SelectItem value="PROVIDER">Provider</SelectItem><SelectItem value="CLIENT">Client</SelectItem><SelectItem value="SERVICE">Service</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Type</Label><Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FLAT">Flat</SelectItem><SelectItem value="PERCENT">Percent</SelectItem><SelectItem value="PER_LINE">Per Line</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Amount</Label><Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={formData.startDate} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} /></div>
              <div className="space-y-2"><Label>End Date</Label><Input type="date" value={formData.endDate} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={formData.active} onCheckedChange={(c) => setFormData({ ...formData, active: c })} /><Label>Active</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={closeDialog}>Cancel</Button><Button onClick={() => { const data = { ...formData, endDate: formData.endDate || null }; editingItem ? updateMutation.mutate({ id: editingItem.id, data }) : createMutation.mutate(data); }} disabled={!formData.name || !formData.amount || !formData.startDate}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
