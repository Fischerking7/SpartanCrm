import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Key, Plus, Edit2, Trash2, Shield, Eye, EyeOff, Save, X } from "lucide-react";
import { useState } from "react";

interface EmployeeCredential {
  id: string;
  userId: string;
  entryLabel: string;
  peopleSoftNumber: string | null;
  networkId: string | null;
  tempPassword: string | null;
  workEmail: string | null;
  rtr: string | null;
  rtrPassword: string | null;
  authenticatorUsername: string | null;
  authenticatorPassword: string | null;
  ipadPin: string | null;
  deviceNumber: string | null;
  gmail: string | null;
  gmailPassword: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CredentialFormData {
  entryLabel: string;
  peopleSoftNumber: string;
  networkId: string;
  tempPassword: string;
  workEmail: string;
  rtr: string;
  rtrPassword: string;
  authenticatorUsername: string;
  authenticatorPassword: string;
  ipadPin: string;
  deviceNumber: string;
  gmail: string;
  gmailPassword: string;
  notes: string;
}

const emptyFormData: CredentialFormData = {
  entryLabel: "",
  peopleSoftNumber: "",
  networkId: "",
  tempPassword: "",
  workEmail: "",
  rtr: "",
  rtrPassword: "",
  authenticatorUsername: "",
  authenticatorPassword: "",
  ipadPin: "",
  deviceNumber: "",
  gmail: "",
  gmailPassword: "",
  notes: "",
};

function PasswordField({ value, onChange, label, id }: { value: string; onChange: (v: string) => void; label: string; id: string }) {
  const [visible, setVisible] = useState(false);
  
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
          data-testid={`input-${id}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full"
          onClick={() => setVisible(!visible)}
          data-testid={`button-toggle-${id}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function CredentialCard({ credential, onEdit, onDelete }: { 
  credential: EmployeeCredential; 
  onEdit: () => void; 
  onDelete: () => void;
}) {
  const [showPasswords, setShowPasswords] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="h-4 w-4" />
            {credential.entryLabel}
          </CardTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} data-testid={`button-edit-${credential.id}`}>
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} data-testid={`button-delete-${credential.id}`}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
        <CardDescription>Last updated: {new Date(credential.updatedAt).toLocaleDateString()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-end">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowPasswords(!showPasswords)}
            data-testid={`button-toggle-passwords-${credential.id}`}
          >
            {showPasswords ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {showPasswords ? "Hide" : "Show"} Passwords
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          {credential.peopleSoftNumber && (
            <div>
              <span className="text-muted-foreground">PeopleSoft #:</span>
              <span className="ml-2 font-medium">{credential.peopleSoftNumber}</span>
            </div>
          )}
          {credential.networkId && (
            <div>
              <span className="text-muted-foreground">Network ID:</span>
              <span className="ml-2 font-medium">{credential.networkId}</span>
            </div>
          )}
          {credential.tempPassword && (
            <div>
              <span className="text-muted-foreground">Temp Password:</span>
              <span className="ml-2 font-medium">{showPasswords ? credential.tempPassword : "••••••••"}</span>
            </div>
          )}
          {credential.workEmail && (
            <div>
              <span className="text-muted-foreground">Work Email:</span>
              <span className="ml-2 font-medium">{credential.workEmail}</span>
            </div>
          )}
          {credential.rtr && (
            <div>
              <span className="text-muted-foreground">RTR:</span>
              <span className="ml-2 font-medium">{credential.rtr}</span>
            </div>
          )}
          {credential.rtrPassword && (
            <div>
              <span className="text-muted-foreground">RTR Password:</span>
              <span className="ml-2 font-medium">{showPasswords ? credential.rtrPassword : "••••••••"}</span>
            </div>
          )}
          {credential.authenticatorUsername && (
            <div>
              <span className="text-muted-foreground">Authenticator Username:</span>
              <span className="ml-2 font-medium">{credential.authenticatorUsername}</span>
            </div>
          )}
          {credential.authenticatorPassword && (
            <div>
              <span className="text-muted-foreground">Authenticator Password:</span>
              <span className="ml-2 font-medium">{showPasswords ? credential.authenticatorPassword : "••••••••"}</span>
            </div>
          )}
          {credential.ipadPin && (
            <div>
              <span className="text-muted-foreground">iPad PIN:</span>
              <span className="ml-2 font-medium">{showPasswords ? credential.ipadPin : "••••"}</span>
            </div>
          )}
          {credential.deviceNumber && (
            <div>
              <span className="text-muted-foreground">Device #:</span>
              <span className="ml-2 font-medium">{credential.deviceNumber}</span>
            </div>
          )}
          {credential.gmail && (
            <div>
              <span className="text-muted-foreground">Gmail:</span>
              <span className="ml-2 font-medium">{credential.gmail}</span>
            </div>
          )}
          {credential.gmailPassword && (
            <div>
              <span className="text-muted-foreground">Gmail Password:</span>
              <span className="ml-2 font-medium">{showPasswords ? credential.gmailPassword : "••••••••"}</span>
            </div>
          )}
        </div>
        {credential.notes && (
          <div className="pt-2 border-t">
            <span className="text-muted-foreground text-sm">Notes:</span>
            <p className="text-sm mt-1">{credential.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyCredentials() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<EmployeeCredential | null>(null);
  const [formData, setFormData] = useState<CredentialFormData>(emptyFormData);
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null);

  const { data: credentials, isLoading } = useQuery<EmployeeCredential[]>({
    queryKey: ["/api/my-credentials"],
    queryFn: async () => {
      const res = await fetch("/api/my-credentials", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch credentials");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CredentialFormData) => {
      return apiRequest("POST", "/api/my-credentials", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-credentials"] });
      toast({ title: "Credential entry created successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to create credential entry", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CredentialFormData }) => {
      return apiRequest("PATCH", `/api/my-credentials/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-credentials"] });
      toast({ title: "Credential entry updated successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to update credential entry", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/my-credentials/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-credentials"] });
      toast({ title: "Credential entry deleted successfully" });
      setDeleteCredentialId(null);
    },
    onError: () => {
      toast({ title: "Failed to delete credential entry", variant: "destructive" });
    },
  });

  const handleOpenCreate = () => {
    setEditingCredential(null);
    setFormData({ ...emptyFormData, entryLabel: `Entry ${(credentials?.length || 0) + 1}` });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (credential: EmployeeCredential) => {
    setEditingCredential(credential);
    setFormData({
      entryLabel: credential.entryLabel || "",
      peopleSoftNumber: credential.peopleSoftNumber || "",
      networkId: credential.networkId || "",
      tempPassword: credential.tempPassword || "",
      workEmail: credential.workEmail || "",
      rtr: credential.rtr || "",
      rtrPassword: credential.rtrPassword || "",
      authenticatorUsername: credential.authenticatorUsername || "",
      authenticatorPassword: credential.authenticatorPassword || "",
      ipadPin: credential.ipadPin || "",
      deviceNumber: credential.deviceNumber || "",
      gmail: credential.gmail || "",
      gmailPassword: credential.gmailPassword || "",
      notes: credential.notes || "",
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingCredential(null);
    setFormData(emptyFormData);
  };

  const handleSubmit = () => {
    if (!formData.entryLabel.trim()) {
      toast({ title: "Entry label is required", variant: "destructive" });
      return;
    }
    if (editingCredential) {
      updateMutation.mutate({ id: editingCredential.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-amber-600" />
          <div>
            <h1 className="text-2xl font-bold text-amber-600">IRON CREST SOLUTIONS LLC</h1>
            <h2 className="text-lg font-semibold text-foreground">My Access &amp; Device Credentials</h2>
          </div>
        </div>
        <Button onClick={handleOpenCreate} data-testid="button-add-credential">
          <Plus className="h-4 w-4 mr-2" />
          Add Entry
        </Button>
      </div>

      {user && (
        <Card className="bg-muted/50">
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-amber-600/10 flex items-center justify-center">
                <span className="text-lg font-bold text-amber-600">{user.name?.charAt(0) || "U"}</span>
              </div>
              <div>
                <p className="font-semibold">{user.name}</p>
                <p className="text-sm text-muted-foreground">Rep ID: {user.repId}</p>
              </div>
              <Badge variant="outline" className="ml-auto">{user.role}</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {credentials && credentials.length > 0 ? (
        <div className="grid gap-4">
          {credentials.map((credential) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              onEdit={() => handleOpenEdit(credential)}
              onDelete={() => setDeleteCredentialId(credential.id)}
            />
          ))}
        </div>
      ) : (
        <Card className="py-12">
          <CardContent className="text-center">
            <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold text-lg mb-2">No Credentials Yet</h3>
            <p className="text-muted-foreground mb-4">Add your first credential entry to keep track of your access information.</p>
            <Button onClick={handleOpenCreate} data-testid="button-add-first-credential">
              <Plus className="h-4 w-4 mr-2" />
              Add First Entry
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCredential ? "Edit Credential Entry" : "Add New Credential Entry"}</DialogTitle>
            <DialogDescription>
              Store your access credentials and device information securely.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="entryLabel">Entry Label *</Label>
              <Input
                id="entryLabel"
                value={formData.entryLabel}
                onChange={(e) => setFormData({ ...formData, entryLabel: e.target.value })}
                placeholder="e.g., Primary, Secondary, Device 2..."
                data-testid="input-entry-label"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="peopleSoftNumber">PeopleSoft #</Label>
                <Input
                  id="peopleSoftNumber"
                  value={formData.peopleSoftNumber}
                  onChange={(e) => setFormData({ ...formData, peopleSoftNumber: e.target.value })}
                  data-testid="input-peoplesoft"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="networkId">Network ID</Label>
                <Input
                  id="networkId"
                  value={formData.networkId}
                  onChange={(e) => setFormData({ ...formData, networkId: e.target.value })}
                  data-testid="input-network-id"
                />
              </div>
            </div>

            <PasswordField
              id="tempPassword"
              label="Temp Password"
              value={formData.tempPassword}
              onChange={(v) => setFormData({ ...formData, tempPassword: v })}
            />

            <div className="space-y-1.5">
              <Label htmlFor="workEmail">Work Email</Label>
              <Input
                id="workEmail"
                type="email"
                value={formData.workEmail}
                onChange={(e) => setFormData({ ...formData, workEmail: e.target.value })}
                data-testid="input-work-email"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rtr">RTR</Label>
                <Input
                  id="rtr"
                  value={formData.rtr}
                  onChange={(e) => setFormData({ ...formData, rtr: e.target.value })}
                  data-testid="input-rtr"
                />
              </div>
              <PasswordField
                id="rtrPassword"
                label="RTR Password"
                value={formData.rtrPassword}
                onChange={(v) => setFormData({ ...formData, rtrPassword: v })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="authenticatorUsername">Authenticator Username</Label>
                <Input
                  id="authenticatorUsername"
                  value={formData.authenticatorUsername}
                  onChange={(e) => setFormData({ ...formData, authenticatorUsername: e.target.value })}
                  data-testid="input-auth-username"
                />
              </div>
              <PasswordField
                id="authenticatorPassword"
                label="Authenticator Password"
                value={formData.authenticatorPassword}
                onChange={(v) => setFormData({ ...formData, authenticatorPassword: v })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PasswordField
                id="ipadPin"
                label="iPad PIN"
                value={formData.ipadPin}
                onChange={(v) => setFormData({ ...formData, ipadPin: v })}
              />
              <div className="space-y-1.5">
                <Label htmlFor="deviceNumber">Device #</Label>
                <Input
                  id="deviceNumber"
                  value={formData.deviceNumber}
                  onChange={(e) => setFormData({ ...formData, deviceNumber: e.target.value })}
                  data-testid="input-device-number"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="gmail">Gmail</Label>
                <Input
                  id="gmail"
                  type="email"
                  value={formData.gmail}
                  onChange={(e) => setFormData({ ...formData, gmail: e.target.value })}
                  data-testid="input-gmail"
                />
              </div>
              <PasswordField
                id="gmailPassword"
                label="Gmail Password"
                value={formData.gmailPassword}
                onChange={(v) => setFormData({ ...formData, gmailPassword: v })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                data-testid="input-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save"
            >
              <Save className="h-4 w-4 mr-2" />
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteCredentialId} onOpenChange={() => setDeleteCredentialId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this credential entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCredentialId && deleteMutation.mutate(deleteCredentialId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
