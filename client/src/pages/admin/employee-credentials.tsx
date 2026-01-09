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
import { getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Key, User, Users, Shield, Eye, EyeOff, Save, Trash2, Search, ChevronRight, Plus, Edit2 } from "lucide-react";
import { useState } from "react";

interface UserInfo {
  id: string;
  name: string;
  repId: string;
  role: string;
  status: string;
}

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

interface CredentialEntry {
  credentials: EmployeeCredential;
  user: UserInfo | null;
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
    <Card className="mb-3">
      <CardHeader className="py-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
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
      </CardHeader>
      <CardContent className="py-2 space-y-2">
        <div className="flex justify-end">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowPasswords(!showPasswords)}
            data-testid={`button-toggle-passwords-${credential.id}`}
          >
            {showPasswords ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
            {showPasswords ? "Hide" : "Show"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {credential.peopleSoftNumber && (
            <div><span className="text-muted-foreground">PeopleSoft #:</span> {credential.peopleSoftNumber}</div>
          )}
          {credential.networkId && (
            <div><span className="text-muted-foreground">Network ID:</span> {credential.networkId}</div>
          )}
          {credential.tempPassword && (
            <div><span className="text-muted-foreground">Temp Pwd:</span> {showPasswords ? credential.tempPassword : "••••"}</div>
          )}
          {credential.workEmail && (
            <div><span className="text-muted-foreground">Work Email:</span> {credential.workEmail}</div>
          )}
          {credential.rtr && (
            <div><span className="text-muted-foreground">RTR:</span> {credential.rtr}</div>
          )}
          {credential.rtrPassword && (
            <div><span className="text-muted-foreground">RTR Pwd:</span> {showPasswords ? credential.rtrPassword : "••••"}</div>
          )}
          {credential.authenticatorUsername && (
            <div><span className="text-muted-foreground">Auth User:</span> {credential.authenticatorUsername}</div>
          )}
          {credential.authenticatorPassword && (
            <div><span className="text-muted-foreground">Auth Pwd:</span> {showPasswords ? credential.authenticatorPassword : "••••"}</div>
          )}
          {credential.ipadPin && (
            <div><span className="text-muted-foreground">iPad PIN:</span> {showPasswords ? credential.ipadPin : "••••"}</div>
          )}
          {credential.deviceNumber && (
            <div><span className="text-muted-foreground">Device #:</span> {credential.deviceNumber}</div>
          )}
          {credential.gmail && (
            <div><span className="text-muted-foreground">Gmail:</span> {credential.gmail}</div>
          )}
          {credential.gmailPassword && (
            <div><span className="text-muted-foreground">Gmail Pwd:</span> {showPasswords ? credential.gmailPassword : "••••"}</div>
          )}
        </div>
        {credential.notes && (
          <div className="text-sm pt-1 border-t">
            <span className="text-muted-foreground">Notes:</span> {credential.notes}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminEmployeeCredentials() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<EmployeeCredential | null>(null);
  const [formData, setFormData] = useState<CredentialFormData>(emptyFormData);
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null);

  const { data: allCredentials, isLoading } = useQuery<CredentialEntry[]>({
    queryKey: ["/api/admin/employee-credentials"],
    queryFn: async () => {
      const res = await fetch("/api/admin/employee-credentials", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch credentials");
      return res.json();
    },
  });

  const { data: allUsers } = useQuery<UserInfo[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const { data: selectedUserData, isLoading: isLoadingUser } = useQuery<{ user: UserInfo; credentials: EmployeeCredential[] }>({
    queryKey: ["/api/admin/employee-credentials/user", selectedUserId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/employee-credentials/user/${selectedUserId}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch user credentials");
      return res.json();
    },
    enabled: !!selectedUserId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: CredentialFormData) => {
      return apiRequest("POST", `/api/admin/employee-credentials/user/${selectedUserId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials"] });
      toast({ title: "Credential entry created successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to create credential entry", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CredentialFormData }) => {
      return apiRequest("PATCH", `/api/admin/employee-credentials/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials"] });
      toast({ title: "Credential entry updated successfully" });
      handleCloseDialog();
    },
    onError: () => {
      toast({ title: "Failed to update credential entry", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/employee-credentials/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials"] });
      toast({ title: "Credential entry deleted successfully" });
      setDeleteCredentialId(null);
    },
    onError: () => {
      toast({ title: "Failed to delete credential entry", variant: "destructive" });
    },
  });

  const handleOpenCreate = () => {
    if (!selectedUserId) return;
    setEditingCredential(null);
    const existingCount = selectedUserData?.credentials?.length || 0;
    setFormData({ ...emptyFormData, entryLabel: `Entry ${existingCount + 1}` });
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

  const credentialsByUser = new Map<string, EmployeeCredential[]>();
  allCredentials?.forEach(entry => {
    if (entry.user) {
      const existing = credentialsByUser.get(entry.user.id) || [];
      existing.push(entry.credentials);
      credentialsByUser.set(entry.user.id, existing);
    }
  });

  const allUsersWithCredentialStatus = allUsers?.map(user => ({
    ...user,
    credentialCount: credentialsByUser.get(user.id)?.length || 0,
  })) || [];

  const filteredUsers = allUsersWithCredentialStatus.filter(user => 
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.repId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-96 col-span-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-amber-600" />
        <div>
          <h1 className="text-2xl font-bold text-amber-600">IRON CREST SOLUTIONS LLC</h1>
          <h2 className="text-lg font-semibold text-foreground">Employee Credentials Management</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Employees
            </CardTitle>
            <CardDescription>Select an employee to manage their credentials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search by name or rep ID..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-employees"
              />
            </div>
            <div className="max-h-[500px] overflow-y-auto space-y-1">
              {filteredUsers.map(user => (
                <button
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-md text-left transition-colors hover-elevate ${
                    selectedUserId === user.id ? "bg-accent" : ""
                  }`}
                  data-testid={`button-select-user-${user.repId}`}
                >
                  <div>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-sm text-muted-foreground">{user.repId} - {user.role}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.credentialCount > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {user.credentialCount} {user.credentialCount === 1 ? "entry" : "entries"}
                      </Badge>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
              {filteredUsers.length === 0 && (
                <div className="text-center text-muted-foreground py-8">No employees found</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          {!selectedUserId ? (
            <div className="flex items-center justify-center h-full min-h-[400px] text-muted-foreground">
              <div className="text-center">
                <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Select an employee from the list to manage their credentials</p>
              </div>
            </div>
          ) : isLoadingUser ? (
            <div className="p-6">
              <Skeleton className="h-96" />
            </div>
          ) : (
            <>
              <CardHeader className="bg-zinc-900 text-white rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span className="text-amber-500">Employee:</span>
                      <span className="font-normal">{selectedUserData?.user.name}</span>
                    </CardTitle>
                    <CardDescription className="text-zinc-400">
                      {selectedUserData?.user.repId} - {selectedUserData?.user.role}
                    </CardDescription>
                  </div>
                  <Button onClick={handleOpenCreate} data-testid="button-add-credential">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Entry
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 max-h-[600px] overflow-y-auto">
                {selectedUserData?.credentials && selectedUserData.credentials.length > 0 ? (
                  selectedUserData.credentials.map(credential => (
                    <CredentialCard
                      key={credential.id}
                      credential={credential}
                      onEdit={() => handleOpenEdit(credential)}
                      onDelete={() => setDeleteCredentialId(credential.id)}
                    />
                  ))
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Key className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No credential entries for this employee.</p>
                    <p className="text-sm">Click "Add Entry" to create one.</p>
                  </div>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCredential ? "Edit Credential Entry" : "Add New Credential Entry"}</DialogTitle>
            <DialogDescription>
              {selectedUserData?.user.name} - Store access credentials and device information.
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
