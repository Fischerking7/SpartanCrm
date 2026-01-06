import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Settings, Edit } from "lucide-react";
import type { Service } from "@shared/schema";

export default function AdminServices() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<Service | null>(null);
  const [formData, setFormData] = useState({ code: "", name: "", category: "", unitType: "", active: true, notes: "" });

  const { data: items, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/admin/services"],
    queryFn: async () => {
      const res = await fetch("/api/admin/services", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/services"] }); closeDialog(); toast({ title: "Service created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const res = await fetch(`/api/admin/services/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/services"] }); closeDialog(); toast({ title: "Service updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closeDialog = () => { setShowDialog(false); setEditingItem(null); setFormData({ code: "", name: "", category: "", unitType: "", active: true, notes: "" }); };
  const openEdit = (item: Service) => { setEditingItem(item); setFormData({ code: item.code, name: item.name, category: item.category || "", unitType: item.unitType || "", active: item.active, notes: item.notes || "" }); setShowDialog(true); };
  const filtered = items?.filter((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()) || i.code.toLowerCase().includes(searchTerm.toLowerCase()));

  const columns = [
    { key: "code", header: "Code", cell: (r: Service) => <span className="font-mono text-sm">{r.code}</span> },
    { key: "name", header: "Name", cell: (r: Service) => <span className="font-medium">{r.name}</span> },
    { key: "category", header: "Category", cell: (r: Service) => <span className="text-sm text-muted-foreground">{r.category || "-"}</span> },
    { key: "active", header: "Status", cell: (r: Service) => <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge> },
    { key: "actions", header: "", cell: (r: Service) => <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Edit className="h-4 w-4" /></Button> },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          <div><h1 className="text-2xl font-semibold">Services</h1><p className="text-muted-foreground">Manage service catalog</p></div>
        </div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-new-service"><Plus className="h-4 w-4 mr-2" />New Service</Button>
      </div>
      <Card>
        <CardHeader className="pb-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div></CardHeader>
        <CardContent><DataTable columns={columns} data={filtered || []} isLoading={isLoading} emptyMessage="No services" testId="table-services" /></CardContent>
      </Card>
      <Dialog open={showDialog} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingItem ? "Edit" : "Create"} Service</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Code</Label><Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} disabled={!!editingItem} /></div>
              <div className="space-y-2"><Label>Name</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Category</Label><Input value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} /></div>
              <div className="space-y-2"><Label>Unit Type</Label><Input value={formData.unitType} onChange={(e) => setFormData({ ...formData, unitType: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={formData.active} onCheckedChange={(c) => setFormData({ ...formData, active: c })} /><Label>Active</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={closeDialog}>Cancel</Button><Button onClick={() => editingItem ? updateMutation.mutate({ id: editingItem.id, data: { name: formData.name, category: formData.category, unitType: formData.unitType, active: formData.active, notes: formData.notes } }) : createMutation.mutate(formData)} disabled={!formData.code || !formData.name}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
