import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Radio, Edit, Trash2, Eye } from "lucide-react";
import type { CarrierProfile, Provider } from "@shared/schema";

interface FormData {
  name: string;
  providerId: string | null;
  columnMapping: string;
  speedTierMap: string;
  statusCodeMap: string;
  signatureHeaders: string;
  active: boolean;
}

const emptyForm: FormData = {
  name: "",
  providerId: null,
  columnMapping: "{}",
  speedTierMap: "{}",
  statusCodeMap: "{}",
  signatureHeaders: "",
  active: true,
};

export default function CarrierProfiles() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [viewDialog, setViewDialog] = useState<CarrierProfile | null>(null);
  const [editingItem, setEditingItem] = useState<CarrierProfile | null>(null);
  const [deleteItem, setDeleteItem] = useState<CarrierProfile | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);

  const { data: profiles, isLoading } = useQuery<CarrierProfile[]>({
    queryKey: ["/api/admin/carrier-profiles"],
    queryFn: async () => {
      const res = await fetch("/api/admin/carrier-profiles", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/admin/providers"],
    queryFn: async () => {
      const res = await fetch("/api/admin/providers", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const body = {
        name: data.name,
        providerId: data.providerId || null,
        columnMapping: data.columnMapping,
        speedTierMap: data.speedTierMap,
        statusCodeMap: data.statusCodeMap,
        signatureHeaders: data.signatureHeaders.split(",").map(s => s.trim()).filter(Boolean),
        active: data.active,
      };
      const res = await fetch("/api/admin/carrier-profiles", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-profiles"] });
      closeDialog();
      toast({ title: "Carrier profile created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const body = {
        name: data.name,
        providerId: data.providerId || null,
        columnMapping: data.columnMapping,
        speedTierMap: data.speedTierMap,
        statusCodeMap: data.statusCodeMap,
        signatureHeaders: data.signatureHeaders.split(",").map(s => s.trim()).filter(Boolean),
        active: data.active,
      };
      const res = await fetch(`/api/admin/carrier-profiles/${id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-profiles"] });
      closeDialog();
      toast({ title: "Carrier profile updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/carrier-profiles/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-profiles"] });
      setDeleteItem(null);
      toast({ title: "Carrier profile deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function closeDialog() {
    setShowDialog(false);
    setEditingItem(null);
    setFormData(emptyForm);
  }

  function openEdit(item: CarrierProfile) {
    setEditingItem(item);
    setFormData({
      name: item.name,
      providerId: item.providerId,
      columnMapping: item.columnMapping || "{}",
      speedTierMap: item.speedTierMap || "{}",
      statusCodeMap: item.statusCodeMap || "{}",
      signatureHeaders: (item.signatureHeaders || []).join(", "),
      active: item.active,
    });
    setShowDialog(true);
  }

  function handleSubmit() {
    if (!formData.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  const filtered = (profiles || []).filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function formatJson(str: string) {
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Carrier Profiles</h1>
          <p className="text-muted-foreground">Manage carrier-specific column mappings, speed tier maps, and status codes for Install Sync</p>
        </div>
        <Button onClick={() => { setFormData(emptyForm); setShowDialog(true); }} data-testid="button-add-profile">
          <Plus className="h-4 w-4 mr-2" /> Add Profile
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search profiles..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
          data-testid="input-search"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No carrier profiles found</div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(profile => {
            const provider = providers?.find(p => p.id === profile.providerId);
            const sigCount = (profile.signatureHeaders || []).length;
            let speedCount = 0;
            try { speedCount = Object.keys(JSON.parse(profile.speedTierMap || "{}")).length; } catch {}
            return (
              <Card key={profile.id} data-testid={`card-profile-${profile.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Radio className="h-5 w-5 text-blue-600" />
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {profile.name}
                          <Badge variant={profile.active ? "default" : "secondary"} data-testid={`badge-status-${profile.id}`}>
                            {profile.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {provider ? `Provider: ${provider.name}` : "No linked provider"} |
                          {` ${sigCount} signature headers | ${speedCount} speed tiers`}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="icon" onClick={() => setViewDialog(profile)} data-testid={`button-view-${profile.id}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(profile)} data-testid={`button-edit-${profile.id}`}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteItem(profile)} data-testid={`button-delete-${profile.id}`}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={v => { if (!v) closeDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit" : "Add"} Carrier Profile</DialogTitle>
            <DialogDescription>Configure carrier-specific field mappings for Install Sync</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} data-testid="input-name" />
            </div>
            <div>
              <Label>Provider</Label>
              <Select value={formData.providerId || "__none__"} onValueChange={v => setFormData(p => ({ ...p, providerId: v === "__none__" ? null : v }))}>
                <SelectTrigger data-testid="select-provider">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {(providers || []).map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Signature Headers (comma-separated column names to detect this carrier)</Label>
              <Input
                value={formData.signatureHeaders}
                onChange={e => setFormData(p => ({ ...p, signatureHeaders: e.target.value }))}
                placeholder="ACCT_NBR, WORK_ORDER_NBR, WO_STATUS"
                data-testid="input-signature-headers"
              />
            </div>
            <div>
              <Label>Column Mapping (JSON)</Label>
              <Textarea
                value={formData.columnMapping}
                onChange={e => setFormData(p => ({ ...p, columnMapping: e.target.value }))}
                rows={6}
                className="font-mono text-xs"
                data-testid="input-column-mapping"
              />
            </div>
            <div>
              <Label>Speed Tier Map (JSON)</Label>
              <Textarea
                value={formData.speedTierMap}
                onChange={e => setFormData(p => ({ ...p, speedTierMap: e.target.value }))}
                rows={4}
                className="font-mono text-xs"
                data-testid="input-speed-tier-map"
              />
            </div>
            <div>
              <Label>Status Code Map (JSON)</Label>
              <Textarea
                value={formData.statusCodeMap}
                onChange={e => setFormData(p => ({ ...p, statusCodeMap: e.target.value }))}
                rows={4}
                className="font-mono text-xs"
                data-testid="input-status-code-map"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formData.active} onCheckedChange={v => setFormData(p => ({ ...p, active: v }))} data-testid="switch-active" />
              <Label>Active</Label>
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

      <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewDialog?.name} - Details</DialogTitle>
          </DialogHeader>
          {viewDialog && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-semibold">Signature Headers</Label>
                <p className="text-sm">{(viewDialog.signatureHeaders || []).join(", ") || "None"}</p>
              </div>
              <div>
                <Label className="text-sm font-semibold">Column Mapping</Label>
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">{formatJson(viewDialog.columnMapping || "{}")}</pre>
              </div>
              <div>
                <Label className="text-sm font-semibold">Speed Tier Map</Label>
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">{formatJson(viewDialog.speedTierMap || "{}")}</pre>
              </div>
              <div>
                <Label className="text-sm font-semibold">Status Code Map</Label>
                <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">{formatJson(viewDialog.statusCodeMap || "{}")}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Carrier Profile</DialogTitle>
            <DialogDescription>This will also delete all rep mappings for this carrier. Are you sure?</DialogDescription>
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
