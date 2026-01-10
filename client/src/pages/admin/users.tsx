import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Search, Users, Edit, UserX, AlertTriangle, KeyRound, Trash2, ChevronDown, ChevronRight, Key, CreditCard, Eye, EyeOff, Save } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { User } from "@shared/schema";

const __NONE__ = "__NONE__";

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
}

interface BankAccount {
  id: string;
  userId: string;
  accountHolderName: string;
  bankName: string;
  accountType: string;
  routingNumber: string;
  accountNumber: string;
  isPrimary: boolean;
}

function PasswordField({ value, label }: { value: string | null; label: string }) {
  const [visible, setVisible] = useState(false);
  if (!value) return null;
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{visible ? value : "••••••••"}</span>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setVisible(!visible)}>
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

function UserCredentialsSection({ userId, enabled }: { userId: string; enabled: boolean }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingCred, setEditingCred] = useState<EmployeeCredential | null>(null);
  const [credForm, setCredForm] = useState({
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
  });

  const { data: credentials, isLoading } = useQuery<EmployeeCredential[]>({
    queryKey: ["/api/admin/employee-credentials/user", userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/employee-credentials/user/${userId}`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof credForm) => {
      const res = await fetch(`/api/admin/employee-credentials/user/${userId}`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create credentials");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials/user", userId] });
      setShowForm(false);
      resetCredForm();
      toast({ title: "Credentials added" });
    },
    onError: () => toast({ title: "Failed to add credentials", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof credForm }) => {
      const res = await fetch(`/api/admin/employee-credentials/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update credentials");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials/user", userId] });
      setEditingCred(null);
      setShowForm(false);
      resetCredForm();
      toast({ title: "Credentials updated" });
    },
    onError: () => toast({ title: "Failed to update credentials", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/employee-credentials/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials/user", userId] });
      toast({ title: "Credentials deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const resetCredForm = () => setCredForm({ entryLabel: "", peopleSoftNumber: "", networkId: "", tempPassword: "", workEmail: "", rtr: "", rtrPassword: "", authenticatorUsername: "", authenticatorPassword: "", ipadPin: "", deviceNumber: "", gmail: "", gmailPassword: "", notes: "" });

  const openEditForm = (cred: EmployeeCredential) => {
    setEditingCred(cred);
    setCredForm({
      entryLabel: cred.entryLabel || "",
      peopleSoftNumber: cred.peopleSoftNumber || "",
      networkId: cred.networkId || "",
      tempPassword: cred.tempPassword || "",
      workEmail: cred.workEmail || "",
      rtr: cred.rtr || "",
      rtrPassword: cred.rtrPassword || "",
      authenticatorUsername: cred.authenticatorUsername || "",
      authenticatorPassword: cred.authenticatorPassword || "",
      ipadPin: cred.ipadPin || "",
      deviceNumber: cred.deviceNumber || "",
      gmail: cred.gmail || "",
      gmailPassword: cred.gmailPassword || "",
      notes: cred.notes || "",
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (editingCred) {
      updateMutation.mutate({ id: editingCred.id, data: credForm });
    } else {
      createMutation.mutate(credForm);
    }
  };

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { resetCredForm(); setEditingCred(null); setShowForm(true); }} data-testid="button-add-credential">
          <Plus className="h-4 w-4 mr-1" /> Add Credentials
        </Button>
      </div>
      
      {!credentials?.length ? (
        <p className="text-sm text-muted-foreground py-4">No credentials on file</p>
      ) : (
        credentials.map((cred) => (
          <div key={cred.id} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline">{cred.entryLabel || "Default"}</Badge>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openEditForm(cred)} data-testid={`button-edit-credential-${cred.id}`}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(cred.id)} data-testid={`button-delete-credential-${cred.id}`}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {cred.peopleSoftNumber && <div><Label className="text-xs text-muted-foreground">PeopleSoft #</Label><p className="font-mono">{cred.peopleSoftNumber}</p></div>}
              {cred.networkId && <div><Label className="text-xs text-muted-foreground">Network ID</Label><p className="font-mono">{cred.networkId}</p></div>}
              {cred.workEmail && <div><Label className="text-xs text-muted-foreground">Work Email</Label><p className="font-mono">{cred.workEmail}</p></div>}
              {cred.deviceNumber && <div><Label className="text-xs text-muted-foreground">Device #</Label><p className="font-mono">{cred.deviceNumber}</p></div>}
              <PasswordField value={cred.tempPassword} label="Temp Password" />
              <PasswordField value={cred.rtrPassword} label="RTR Password" />
              <PasswordField value={cred.authenticatorPassword} label="Authenticator Password" />
              <PasswordField value={cred.ipadPin} label="iPad PIN" />
              <PasswordField value={cred.gmailPassword} label="Gmail Password" />
            </div>
            {cred.notes && (
              <div className="pt-2 border-t">
                <Label className="text-xs text-muted-foreground">Notes</Label>
                <p className="text-sm whitespace-pre-wrap">{cred.notes}</p>
              </div>
            )}
          </div>
        ))
      )}

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingCred(null); resetCredForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCred ? "Edit Credentials" : "Add Credentials"}</DialogTitle>
            <DialogDescription>Enter employee credentials information</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Entry Label</Label>
              <Input value={credForm.entryLabel} onChange={(e) => setCredForm({ ...credForm, entryLabel: e.target.value })} placeholder="e.g., Primary, Backup" data-testid="input-entry-label" />
            </div>
            <div className="space-y-2">
              <Label>PeopleSoft #</Label>
              <Input value={credForm.peopleSoftNumber} onChange={(e) => setCredForm({ ...credForm, peopleSoftNumber: e.target.value })} data-testid="input-peoplesoft" />
            </div>
            <div className="space-y-2">
              <Label>Network ID</Label>
              <Input value={credForm.networkId} onChange={(e) => setCredForm({ ...credForm, networkId: e.target.value })} data-testid="input-network-id" />
            </div>
            <div className="space-y-2">
              <Label>Temp Password</Label>
              <Input value={credForm.tempPassword} onChange={(e) => setCredForm({ ...credForm, tempPassword: e.target.value })} data-testid="input-temp-password" />
            </div>
            <div className="space-y-2">
              <Label>Work Email</Label>
              <Input value={credForm.workEmail} onChange={(e) => setCredForm({ ...credForm, workEmail: e.target.value })} data-testid="input-work-email" />
            </div>
            <div className="space-y-2">
              <Label>RTR</Label>
              <Input value={credForm.rtr} onChange={(e) => setCredForm({ ...credForm, rtr: e.target.value })} data-testid="input-rtr" />
            </div>
            <div className="space-y-2">
              <Label>RTR Password</Label>
              <Input value={credForm.rtrPassword} onChange={(e) => setCredForm({ ...credForm, rtrPassword: e.target.value })} data-testid="input-rtr-password" />
            </div>
            <div className="space-y-2">
              <Label>Authenticator Username</Label>
              <Input value={credForm.authenticatorUsername} onChange={(e) => setCredForm({ ...credForm, authenticatorUsername: e.target.value })} data-testid="input-auth-username" />
            </div>
            <div className="space-y-2">
              <Label>Authenticator Password</Label>
              <Input value={credForm.authenticatorPassword} onChange={(e) => setCredForm({ ...credForm, authenticatorPassword: e.target.value })} data-testid="input-auth-password" />
            </div>
            <div className="space-y-2">
              <Label>iPad PIN</Label>
              <Input value={credForm.ipadPin} onChange={(e) => setCredForm({ ...credForm, ipadPin: e.target.value })} data-testid="input-ipad-pin" />
            </div>
            <div className="space-y-2">
              <Label>Device Number</Label>
              <Input value={credForm.deviceNumber} onChange={(e) => setCredForm({ ...credForm, deviceNumber: e.target.value })} data-testid="input-device-number" />
            </div>
            <div className="space-y-2">
              <Label>Gmail</Label>
              <Input value={credForm.gmail} onChange={(e) => setCredForm({ ...credForm, gmail: e.target.value })} data-testid="input-gmail" />
            </div>
            <div className="space-y-2">
              <Label>Gmail Password</Label>
              <Input value={credForm.gmailPassword} onChange={(e) => setCredForm({ ...credForm, gmailPassword: e.target.value })} data-testid="input-gmail-password" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <Input value={credForm.notes} onChange={(e) => setCredForm({ ...credForm, notes: e.target.value })} data-testid="input-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditingCred(null); resetCredForm(); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-credential">
              {editingCred ? "Update" : "Add"} Credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserBankingSection({ userId, enabled }: { userId: string; enabled: boolean }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [bankForm, setBankForm] = useState({
    accountHolderName: "",
    bankName: "",
    accountType: "checking",
    routingNumber: "",
    accountNumber: "",
    isPrimary: false,
  });

  const { data: accounts, isLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/admin/bank-accounts", userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/bank-accounts?userId=${userId}`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof bankForm) => {
      const res = await fetch("/api/admin/bank-accounts", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, userId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to add bank account");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bank-accounts", userId] });
      setShowForm(false);
      resetBankForm();
      toast({ title: "Bank account added" });
    },
    onError: (error: Error) => toast({ title: "Failed to add bank account", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/bank-accounts/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bank-accounts", userId] });
      toast({ title: "Bank account removed" });
    },
    onError: () => toast({ title: "Failed to remove bank account", variant: "destructive" }),
  });

  const resetBankForm = () => setBankForm({ accountHolderName: "", bankName: "", accountType: "checking", routingNumber: "", accountNumber: "", isPrimary: false });

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { resetBankForm(); setShowForm(true); }} data-testid="button-add-bank-account">
          <Plus className="h-4 w-4 mr-1" /> Add Bank Account
        </Button>
      </div>
      
      {!accounts?.length ? (
        <p className="text-sm text-muted-foreground py-4">No bank accounts on file</p>
      ) : (
        accounts.map((account) => (
          <div key={account.id} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{account.bankName}</span>
              </div>
              <div className="flex items-center gap-2">
                {account.isPrimary && <Badge variant="default">Primary</Badge>}
                <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(account.id)} data-testid={`button-delete-bank-${account.id}`}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Account Holder</Label>
                <p>{account.accountHolderName}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Account Type</Label>
                <p className="capitalize">{account.accountType}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Routing #</Label>
                <p className="font-mono">••••{account.routingNumber.slice(-4)}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Account #</Label>
                <p className="font-mono">••••{account.accountNumber.slice(-4)}</p>
              </div>
            </div>
          </div>
        ))
      )}

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); resetBankForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Bank Account</DialogTitle>
            <DialogDescription>Enter bank account details for direct deposit</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Account Holder Name</Label>
              <Input value={bankForm.accountHolderName} onChange={(e) => setBankForm({ ...bankForm, accountHolderName: e.target.value })} placeholder="Full legal name" data-testid="input-account-holder" />
            </div>
            <div className="space-y-2">
              <Label>Bank Name</Label>
              <Input value={bankForm.bankName} onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })} placeholder="e.g., Chase, Bank of America" data-testid="input-bank-name" />
            </div>
            <div className="space-y-2">
              <Label>Account Type</Label>
              <Select value={bankForm.accountType} onValueChange={(v) => setBankForm({ ...bankForm, accountType: v })}>
                <SelectTrigger data-testid="select-account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Routing Number</Label>
                <Input value={bankForm.routingNumber} onChange={(e) => setBankForm({ ...bankForm, routingNumber: e.target.value.replace(/\D/g, "").slice(0, 9) })} placeholder="9 digits" maxLength={9} data-testid="input-routing" />
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input value={bankForm.accountNumber} onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value.replace(/\D/g, "") })} placeholder="Account number" data-testid="input-account-number" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="isPrimary" checked={bankForm.isPrimary} onChange={(e) => setBankForm({ ...bankForm, isPrimary: e.target.checked })} className="rounded" data-testid="checkbox-primary" />
              <Label htmlFor="isPrimary" className="cursor-pointer">Set as primary account</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); resetBankForm(); }}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(bankForm)} disabled={!bankForm.accountHolderName || !bankForm.bankName || bankForm.routingNumber.length !== 9 || !bankForm.accountNumber || createMutation.isPending} data-testid="button-save-bank">
              Add Bank Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserRow({ user, users, onEdit, onResetPassword, onDeactivate, onDelete }: {
  user: User;
  users: User[];
  onEdit: (user: User) => void;
  onResetPassword: (user: User) => void;
  onDeactivate: (userId: string) => void;
  onDelete: (user: User) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const getInitials = (name: string) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "ADMIN": case "OPERATIONS": case "EXECUTIVE": return "default";
      case "MANAGER": case "SUPERVISOR": return "secondary";
      default: return "outline";
    }
  };

  const getReportsTo = () => {
    const parts: string[] = [];
    if (user.assignedSupervisorId) {
      const sup = users.find(u => u.id === user.assignedSupervisorId);
      if (sup) parts.push(`Sup: ${sup.name}`);
    }
    if (user.assignedManagerId) {
      const mgr = users.find(u => u.id === user.assignedManagerId);
      if (mgr) parts.push(`Mgr: ${mgr.name}`);
    }
    if (user.assignedExecutiveId) {
      const exec = users.find(u => u.id === user.assignedExecutiveId);
      if (exec) parts.push(`Exec: ${exec.name}`);
    }
    return parts.join(" | ") || "-";
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border rounded-lg mb-2 bg-card">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 cursor-pointer hover-elevate" data-testid={`row-user-${user.id}`}>
            <div className="flex items-center gap-4 flex-1">
              <div className="flex items-center gap-1 text-muted-foreground">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/10 text-primary">{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{user.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">({user.repId})</span>
                  <Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge>
                  <Badge variant={user.status === "ACTIVE" ? "default" : "destructive"}>{user.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{getReportsTo()}</p>
              </div>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="icon" variant="ghost" onClick={() => onEdit(user)} data-testid={`button-edit-${user.id}`}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onResetPassword(user)} title="Reset Password" data-testid={`button-reset-password-${user.id}`}>
                <KeyRound className="h-4 w-4 text-amber-600" />
              </Button>
              {user.status === "ACTIVE" && (
                <Button size="icon" variant="ghost" onClick={() => onDeactivate(user.id)} title="Deactivate" data-testid={`button-deactivate-${user.id}`}>
                  <UserX className="h-4 w-4 text-amber-600" />
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => onDelete(user)} title="Remove" data-testid={`button-delete-${user.id}`}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 border-t pt-4">
            <Tabs defaultValue="credentials" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="credentials" className="gap-2">
                  <Key className="h-4 w-4" />
                  Credentials
                </TabsTrigger>
                <TabsTrigger value="banking" className="gap-2">
                  <CreditCard className="h-4 w-4" />
                  Banking
                </TabsTrigger>
              </TabsList>
              <TabsContent value="credentials">
                <UserCredentialsSection userId={user.id} enabled={isOpen} />
              </TabsContent>
              <TabsContent value="banking">
                <UserBankingSection userId={user.id} enabled={isOpen} />
              </TabsContent>
            </Tabs>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default function AdminUsers() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [skipValidation, setSkipValidation] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [tempPasswordResult, setTempPasswordResult] = useState<{ tempPassword: string; expiresInHours: number } | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    repId: "",
    password: "",
    role: "REP",
    assignedSupervisorId: __NONE__,
    assignedManagerId: __NONE__,
    assignedExecutiveId: __NONE__,
  });

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "User created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create user", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditingUser(null);
      resetForm();
      toast({ title: "User updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/users/${userId}/deactivate`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to deactivate");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deactivated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to deactivate", description: error.message, variant: "destructive" });
    },
  });
  
  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/users/${userId}/password-reset`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setTempPasswordResult({ tempPassword: data.tempPassword, expiresInHours: data.expiresInHours });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reset password", description: error.message, variant: "destructive" });
      setResetPasswordUser(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to remove user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeleteUser(null);
      toast({ title: "User archived", description: "User has been removed from the system." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove user", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", repId: "", password: "", role: "REP", assignedSupervisorId: __NONE__, assignedManagerId: __NONE__, assignedExecutiveId: __NONE__ });
    setSkipValidation(false);
  };

  const supervisors = users?.filter((u) => u.role === "SUPERVISOR" && u.status === "ACTIVE") || [];
  const managers = users?.filter((u) => u.role === "MANAGER" && u.status === "ACTIVE") || [];
  const executives = users?.filter((u) => u.role === "EXECUTIVE" && u.status === "ACTIVE") || [];
  
  const getValidationWarnings = (): string[] => {
    const warnings: string[] = [];
    const role = formData.role;
    const hasSupervisor = formData.assignedSupervisorId !== __NONE__;
    const hasManager = formData.assignedManagerId !== __NONE__;
    
    if (role === "REP" || role === "MDU") {
      const hasExecutive = formData.assignedExecutiveId !== __NONE__;
      if (!hasSupervisor && !hasManager && !hasExecutive) {
        warnings.push(`${role === "MDU" ? "MDU" : "Rep"} must be assigned to a Supervisor, Manager, or Executive`);
      }
      if (hasSupervisor && hasManager) {
        const supervisor = supervisors.find(s => s.id === formData.assignedSupervisorId);
        if (supervisor?.assignedManagerId && supervisor.assignedManagerId !== formData.assignedManagerId) {
          warnings.push("Org conflict: Selected manager differs from the supervisor's manager");
        }
      }
    }
    
    if (role === "SUPERVISOR" && !hasManager) {
      warnings.push("Supervisor must be assigned to a Manager");
    }
    
    return warnings;
  };
  
  const validationWarnings = getValidationWarnings();

  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      repId: user.repId,
      password: "",
      role: user.role,
      assignedSupervisorId: user.assignedSupervisorId || __NONE__,
      assignedManagerId: user.assignedManagerId || __NONE__,
      assignedExecutiveId: user.assignedExecutiveId || __NONE__,
    });
  };

  const filteredUsers = users?.filter((user) =>
    !user.deletedAt &&
    (user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.repId.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const showSupervisorField = formData.role === "REP" || formData.role === "MDU";
  const showManagerField = formData.role === "REP" || formData.role === "MDU" || formData.role === "SUPERVISOR";
  const showExecutiveField = formData.role === "REP" || formData.role === "MDU" || formData.role === "SUPERVISOR" || formData.role === "MANAGER";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Users</h1>
            <p className="text-muted-foreground">Manage users, credentials, and banking info</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-user">
          <Plus className="h-4 w-4 mr-2" />
          New User
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-users"
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {filteredUsers?.length || 0} of {users?.length || 0} users
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !filteredUsers?.length ? (
            <p className="text-center text-muted-foreground py-8">No users found</p>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  users={users || []}
                  onEdit={openEditDialog}
                  onResetPassword={setResetPasswordUser}
                  onDeactivate={(id) => deactivateMutation.mutate(id)}
                  onDelete={setDeleteUser}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog || !!editingUser} onOpenChange={() => { setShowCreateDialog(false); setEditingUser(null); resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Create User"}</DialogTitle>
            <DialogDescription>
              {editingUser ? "Update user details" : "Add a new user to the system"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Full name"
                  data-testid="input-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Rep ID</Label>
                <Input
                  value={formData.repId}
                  onChange={(e) => setFormData({ ...formData, repId: e.target.value })}
                  placeholder="Unique identifier"
                  disabled={!!editingUser}
                  data-testid="input-rep-id"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{editingUser ? "New Password (leave blank to keep)" : "Password"}</Label>
              <Input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Password"
                data-testid="input-password"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formData.role}
                onValueChange={(v) => setFormData({ ...formData, role: v, assignedSupervisorId: __NONE__, assignedManagerId: __NONE__, assignedExecutiveId: __NONE__ })}
              >
                <SelectTrigger data-testid="select-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REP">Rep</SelectItem>
                  <SelectItem value="MDU">MDU</SelectItem>
                  <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="EXECUTIVE">Executive</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="OPERATIONS">Operations</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {showSupervisorField && (
              <div className="space-y-2">
                <Label>Assigned Supervisor</Label>
                <Select
                  value={formData.assignedSupervisorId}
                  onValueChange={(v) => setFormData({ ...formData, assignedSupervisorId: v })}
                >
                  <SelectTrigger data-testid="select-supervisor">
                    <SelectValue placeholder="Select supervisor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={__NONE__}>None</SelectItem>
                    {supervisors.filter(s => s?.id).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {showManagerField && (
              <div className="space-y-2">
                <Label>Assigned Manager</Label>
                <Select
                  value={formData.assignedManagerId}
                  onValueChange={(v) => setFormData({ ...formData, assignedManagerId: v })}
                >
                  <SelectTrigger data-testid="select-manager">
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={__NONE__}>None</SelectItem>
                    {managers.filter(m => m?.id).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {showExecutiveField && (
              <div className="space-y-2">
                <Label>Assigned Executive</Label>
                <Select
                  value={formData.assignedExecutiveId}
                  onValueChange={(v) => setFormData({ ...formData, assignedExecutiveId: v })}
                >
                  <SelectTrigger data-testid="select-executive">
                    <SelectValue placeholder="Select executive" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={__NONE__}>None</SelectItem>
                    {executives.filter(e => e?.id).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {validationWarnings.length > 0 && (
              <Alert variant="destructive" className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                  <div className="space-y-1">
                    {validationWarnings.map((warning, i) => (
                      <p key={i}>{warning}</p>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipValidation}
                      onChange={(e) => setSkipValidation(e.target.checked)}
                      className="rounded border-yellow-600"
                      data-testid="checkbox-skip-validation"
                    />
                    <span className="text-sm">Override and save anyway (Admin only)</span>
                  </label>
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingUser(null); resetForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const submitData = {
                  ...formData,
                  assignedSupervisorId: formData.assignedSupervisorId === __NONE__ ? undefined : formData.assignedSupervisorId,
                  assignedManagerId: formData.assignedManagerId === __NONE__ ? undefined : formData.assignedManagerId,
                  assignedExecutiveId: formData.assignedExecutiveId === __NONE__ ? undefined : formData.assignedExecutiveId,
                  skipValidation: skipValidation,
                };
                if (editingUser) {
                  const updateData: any = { 
                    name: submitData.name, 
                    role: submitData.role, 
                    assignedSupervisorId: submitData.assignedSupervisorId,
                    assignedManagerId: submitData.assignedManagerId,
                    assignedExecutiveId: submitData.assignedExecutiveId,
                    skipValidation: submitData.skipValidation,
                  };
                  if (formData.password) updateData.password = formData.password;
                  updateMutation.mutate({ id: editingUser.id, data: updateData });
                } else {
                  createMutation.mutate(submitData as typeof formData);
                }
              }}
              disabled={!formData.name || !formData.repId || (!editingUser && !formData.password) || (validationWarnings.length > 0 && !skipValidation) || createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit-user"
            >
              {editingUser ? "Update User" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={!!resetPasswordUser} onOpenChange={() => { setResetPasswordUser(null); setTempPasswordResult(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Reset Password
            </DialogTitle>
            <DialogDescription>
              {tempPasswordResult 
                ? "Temporary password generated successfully"
                : `Generate a temporary password for ${resetPasswordUser?.name}`
              }
            </DialogDescription>
          </DialogHeader>
          
          {tempPasswordResult ? (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <Label className="text-xs text-muted-foreground">Temporary Password</Label>
                <p className="font-mono text-lg font-bold mt-1">{tempPasswordResult.tempPassword}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Expires in {tempPasswordResult.expiresInHours} hours. User must change on next login.
                </p>
              </div>
              <Button 
                className="w-full" 
                onClick={() => {
                  navigator.clipboard.writeText(tempPasswordResult.tempPassword);
                  toast({ title: "Password copied to clipboard" });
                }}
              >
                Copy Password
              </Button>
            </div>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetPasswordUser(null)}>Cancel</Button>
              <Button 
                onClick={() => resetPasswordUser && resetPasswordMutation.mutate(resetPasswordUser.id)}
                disabled={resetPasswordMutation.isPending}
              >
                {resetPasswordMutation.isPending ? "Generating..." : "Generate Password"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteUser} onOpenChange={() => setDeleteUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              Remove User
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to archive {deleteUser?.name}? This will soft-delete the user and they will no longer be able to log in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUser(null)}>Cancel</Button>
            <Button 
              variant="destructive"
              onClick={() => deleteUser && deleteMutation.mutate(deleteUser.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Removing..." : "Remove User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
