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
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Building2, Edit } from "lucide-react";
import type { Client } from "@shared/schema";

export default function AdminClients() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<Client | null>(null);
  const [formData, setFormData] = useState({ name: "", active: true });

  const { data: items, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/admin/clients"],
    queryFn: async () => {
      const res = await fetch("/api/admin/clients", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] }); closeDialog(); toast({ title: "Client created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await fetch(`/api/admin/clients/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/clients"] }); closeDialog(); toast({ title: "Client updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const closeDialog = () => { setShowDialog(false); setEditingItem(null); setFormData({ name: "", active: true }); };
  const openEdit = (item: Client) => { setEditingItem(item); setFormData({ name: item.name, active: item.active }); setShowDialog(true); };
  const filtered = items?.filter((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const columns = [
    { key: "name", header: "Name", cell: (r: Client) => <span className="font-medium">{r.name}</span> },
    { key: "active", header: "Status", cell: (r: Client) => <Badge variant={r.active ? "default" : "secondary"}>{r.active ? "Active" : "Inactive"}</Badge> },
    { key: "createdAt", header: "Created", cell: (r: Client) => <span className="text-sm text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</span> },
    { key: "actions", header: "", cell: (r: Client) => <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Edit className="h-4 w-4" /></Button> },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <div><h1 className="text-2xl font-semibold">Clients</h1><p className="text-muted-foreground">Manage clients</p></div>
        </div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-new-client"><Plus className="h-4 w-4 mr-2" />New Client</Button>
      </div>
      <Card>
        <CardHeader className="pb-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" /></div></CardHeader>
        <CardContent><DataTable columns={columns} data={filtered || []} isLoading={isLoading} emptyMessage="No clients" testId="table-clients" /></CardContent>
      </Card>
      <Dialog open={showDialog} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingItem ? "Edit" : "Create"} Client</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={formData.active} onCheckedChange={(c) => setFormData({ ...formData, active: c })} /><Label>Active</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={closeDialog}>Cancel</Button><Button onClick={() => editingItem ? updateMutation.mutate({ id: editingItem.id, data: formData }) : createMutation.mutate(formData)} disabled={!formData.name}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
