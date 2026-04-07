import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Upload, Edit, Trash2, Users } from "lucide-react";
import type { CarrierProfile, CarrierRepMapping, User } from "@shared/schema";

interface FormData {
  carrierProfileId: string;
  salesmanNbr: string;
  userId: string;
}

const emptyForm: FormData = { carrierProfileId: "", salesmanNbr: "", userId: "" };

export default function CarrierRepMappings() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<string>("__all__");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<CarrierRepMapping | null>(null);
  const [deleteItem, setDeleteItem] = useState<CarrierRepMapping | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importProfileId, setImportProfileId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: profiles } = useQuery<CarrierProfile[]>({
    queryKey: ["/api/admin/carrier-profiles"],
    queryFn: async () => {
      const res = await fetch("/api/admin/carrier-profiles", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const profileFilter = selectedProfile !== "__all__" ? selectedProfile : undefined;

  const { data: mappings, isLoading } = useQuery<CarrierRepMapping[]>({
    queryKey: ["/api/admin/carrier-rep-mappings", profileFilter],
    queryFn: async () => {
      const url = profileFilter
        ? `/api/admin/carrier-rep-mappings?carrierProfileId=${profileFilter}`
        : "/api/admin/carrier-rep-mappings";
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const userMap = new Map((users || []).map(u => [u.id, u]));
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await fetch("/api/admin/carrier-rep-mappings", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-rep-mappings"] });
      closeDialog();
      toast({ title: "Mapping created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const res = await fetch(`/api/admin/carrier-rep-mappings/${id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-rep-mappings"] });
      closeDialog();
      toast({ title: "Mapping updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/carrier-rep-mappings/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-rep-mappings"] });
      setDeleteItem(null);
      toast({ title: "Mapping deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async ({ file, carrierProfileId }: { file: File; carrierProfileId: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("carrierProfileId", carrierProfileId);
      const authHeaders = getAuthHeaders();
      const uploadHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(authHeaders)) {
        if (key.toLowerCase() !== "content-type") {
          uploadHeaders[key] = val;
        }
      }
      const res = await fetch("/api/admin/carrier-rep-mappings/bulk-import", {
        method: "POST",
        headers: uploadHeaders,
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-rep-mappings"] });
      setShowImportDialog(false);
      const msg = `Imported ${data.imported} of ${data.total} mappings`;
      const errors = data.errors?.length ? `\n${data.errors.join("\n")}` : "";
      toast({ title: msg, description: errors || undefined });
    },
    onError: (e: Error) => toast({ title: "Import Error", description: e.message, variant: "destructive" }),
  });

  function closeDialog() {
    setShowDialog(false);
    setEditingItem(null);
    setFormData(emptyForm);
  }

  function openEdit(item: CarrierRepMapping) {
    setEditingItem(item);
    setFormData({
      carrierProfileId: item.carrierProfileId,
      salesmanNbr: item.salesmanNbr,
      userId: item.userId,
    });
    setShowDialog(true);
  }

  function handleSubmit() {
    if (!formData.carrierProfileId || !formData.salesmanNbr || !formData.userId) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file || !importProfileId) {
      toast({ title: "Select a file and carrier profile", variant: "destructive" });
      return;
    }
    importMutation.mutate({ file, carrierProfileId: importProfileId });
  }

  const filtered = (mappings || []).filter(m => {
    const user = userMap.get(m.userId);
    const profile = profileMap.get(m.carrierProfileId);
    const searchStr = [m.salesmanNbr, user?.name, user?.repId, profile?.name].join(" ").toLowerCase();
    return searchStr.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Carrier Rep Mappings</h1>
          <p className="text-muted-foreground">Map carrier salesman numbers to CRM users for Install Sync matching</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImportDialog(true)} data-testid="button-import">
            <Upload className="h-4 w-4 mr-2" /> Import CSV
          </Button>
          <Button onClick={() => { setFormData(emptyForm); setShowDialog(true); }} data-testid="button-add-mapping">
            <Plus className="h-4 w-4 mr-2" /> Add Mapping
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>
        <Select value={selectedProfile} onValueChange={setSelectedProfile}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-profile">
            <SelectValue placeholder="Filter by carrier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Carriers</SelectItem>
            {(profiles || []).map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No rep mappings found</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Carrier</th>
                <th className="text-left p-3 font-medium">Salesman #</th>
                <th className="text-left p-3 font-medium">CRM User</th>
                <th className="text-left p-3 font-medium">Rep ID</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const user = userMap.get(m.userId);
                const profile = profileMap.get(m.carrierProfileId);
                return (
                  <tr key={m.id} className="border-t" data-testid={`row-mapping-${m.id}`}>
                    <td className="p-3">{profile?.name || "Unknown"}</td>
                    <td className="p-3 font-mono">{m.salesmanNbr}</td>
                    <td className="p-3">{user?.name || "Unknown"}</td>
                    <td className="p-3 font-mono">{user?.repId || "?"}</td>
                    <td className="p-3 text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(m)} data-testid={`button-edit-${m.id}`}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteItem(m)} data-testid={`button-delete-${m.id}`}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={v => { if (!v) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit" : "Add"} Rep Mapping</DialogTitle>
            <DialogDescription>Link a carrier salesman number to a CRM user</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Carrier Profile</Label>
              <Select value={formData.carrierProfileId || "__none__"} onValueChange={v => setFormData(p => ({ ...p, carrierProfileId: v === "__none__" ? "" : v }))}>
                <SelectTrigger data-testid="select-carrier-profile">
                  <SelectValue placeholder="Select carrier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select...</SelectItem>
                  {(profiles || []).map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Salesman Number</Label>
              <Input
                value={formData.salesmanNbr}
                onChange={e => setFormData(p => ({ ...p, salesmanNbr: e.target.value }))}
                placeholder="e.g., 12345"
                data-testid="input-salesman-nbr"
              />
            </div>
            <div>
              <Label>CRM User</Label>
              <Select value={formData.userId || "__none__"} onValueChange={v => setFormData(p => ({ ...p, userId: v === "__none__" ? "" : v }))}>
                <SelectTrigger data-testid="select-user">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select...</SelectItem>
                  {(users || []).filter(u => !u.deletedAt).map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.repId})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save">
              {editingItem ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Rep Mappings from CSV</DialogTitle>
            <DialogDescription>CSV should have columns: salesman_nbr (or carrier_id), rep_id</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Carrier Profile</Label>
              <Select value={importProfileId || "__none__"} onValueChange={v => setImportProfileId(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-import-profile">
                  <SelectValue placeholder="Select carrier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select...</SelectItem>
                  {(profiles || []).map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CSV File</Label>
              <Input type="file" accept=".csv" ref={fileRef} data-testid="input-import-file" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)} data-testid="button-import-cancel">Cancel</Button>
            <Button onClick={handleImport} disabled={importMutation.isPending} data-testid="button-import-submit">
              {importMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Rep Mapping</DialogTitle>
            <DialogDescription>Are you sure you want to remove this mapping?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)} data-testid="button-delete-cancel">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)} disabled={deleteMutation.isPending} data-testid="button-delete-confirm">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
