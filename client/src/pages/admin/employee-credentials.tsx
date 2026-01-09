import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Key, User, Users, Shield, Eye, EyeOff, Save, Trash2, Search, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";

interface UserInfo {
  id: string;
  name: string;
  repId: string;
  role: string;
  status: string;
}

interface EmployeeCredentials {
  id?: string;
  userId: string;
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

interface CredentialEntry {
  credentials: EmployeeCredentials | null;
  user: UserInfo | null;
}

function PasswordField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const [visible, setVisible] = useState(false);
  
  return (
    <div className="relative">
      <Input
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
  );
}

function CredentialRow({ label, value, onChange, isPassword = false }: { 
  label: string; 
  value: string; 
  onChange: (v: string) => void; 
  isPassword?: boolean 
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 divide-x border-b">
      <div className="p-3 bg-zinc-100 dark:bg-zinc-800 font-medium text-sm">{label}</div>
      <div className="p-3">
        {isPassword ? (
          <PasswordField value={value} onChange={onChange} id={label.toLowerCase().replace(/\s+/g, '-')} />
        ) : (
          <Input value={value} onChange={(e) => onChange(e.target.value)} data-testid={`input-${label.toLowerCase().replace(/\s+/g, '-')}`} />
        )}
      </div>
    </div>
  );
}

export default function AdminEmployeeCredentials() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [formData, setFormData] = useState({
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

  const { data: selectedUserData, isLoading: isLoadingUser } = useQuery<{ user: UserInfo; credentials: EmployeeCredentials | null }>({
    queryKey: ["/api/admin/employee-credentials", selectedUserId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/employee-credentials/${selectedUserId}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch user credentials");
      return res.json();
    },
    enabled: !!selectedUserId,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("PATCH", `/api/admin/employee-credentials/${selectedUserId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials"] });
      toast({ title: "Credentials saved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to save credentials", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/admin/employee-credentials/${selectedUserId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employee-credentials"] });
      setShowDeleteDialog(false);
      setSelectedUserId(null);
      toast({ title: "Credentials deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete credentials", variant: "destructive" });
    },
  });

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
  };

  useEffect(() => {
    if (selectedUserData) {
      loadFormFromCredentials(selectedUserData.credentials);
    }
  }, [selectedUserData]);

  const loadFormFromCredentials = (creds: EmployeeCredentials | null) => {
    setFormData({
      peopleSoftNumber: creds?.peopleSoftNumber || "",
      networkId: creds?.networkId || "",
      tempPassword: creds?.tempPassword || "",
      workEmail: creds?.workEmail || "",
      rtr: creds?.rtr || "",
      rtrPassword: creds?.rtrPassword || "",
      authenticatorUsername: creds?.authenticatorUsername || "",
      authenticatorPassword: creds?.authenticatorPassword || "",
      ipadPin: creds?.ipadPin || "",
      deviceNumber: creds?.deviceNumber || "",
      gmail: creds?.gmail || "",
      gmailPassword: creds?.gmailPassword || "",
      notes: creds?.notes || "",
    });
  };

  const usersWithCredentialsMap = new Map<string, CredentialEntry>();
  allCredentials?.forEach(entry => {
    if (entry.user) {
      usersWithCredentialsMap.set(entry.user.id, entry);
    }
  });

  const allUsersWithCredentialStatus = allUsers?.map(user => ({
    ...user,
    hasCredentials: usersWithCredentialsMap.has(user.id),
    credentials: usersWithCredentialsMap.get(user.id)?.credentials || null,
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
            <CardDescription>Select an employee to view or edit their credentials</CardDescription>
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
                  onClick={() => handleSelectUser(user.id)}
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
                    {user.hasCredentials && (
                      <Badge variant="outline" className="text-xs">Has Credentials</Badge>
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
                <p>Select an employee from the list to view or edit their credentials</p>
              </div>
            </div>
          ) : isLoadingUser ? (
            <div className="p-6">
              <Skeleton className="h-96" />
            </div>
          ) : (
            <>
              <CardHeader className="bg-zinc-900 text-white rounded-t-lg flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-amber-500">Name</span>
                    <span className="ml-2 font-normal">{selectedUserData?.user.name}</span>
                  </CardTitle>
                  <CardDescription className="text-zinc-400">
                    {selectedUserData?.user.repId} - {selectedUserData?.user.role}
                  </CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-red-500 hover:bg-red-500/10"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={!selectedUserData?.credentials}
                  data-testid="button-delete-credentials"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <form onSubmit={(e) => { e.preventDefault(); loadFormFromCredentials(selectedUserData?.credentials || null); }}>
                  <CredentialRow 
                    label="PeopleSoft #" 
                    value={formData.peopleSoftNumber}
                    onChange={(v) => setFormData(prev => ({ ...prev, peopleSoftNumber: v }))}
                  />
                  <CredentialRow 
                    label="Network ID" 
                    value={formData.networkId}
                    onChange={(v) => setFormData(prev => ({ ...prev, networkId: v }))}
                  />
                  <CredentialRow 
                    label="Temp Password" 
                    value={formData.tempPassword}
                    onChange={(v) => setFormData(prev => ({ ...prev, tempPassword: v }))}
                    isPassword
                  />
                  <CredentialRow 
                    label="Work Email" 
                    value={formData.workEmail}
                    onChange={(v) => setFormData(prev => ({ ...prev, workEmail: v }))}
                  />
                  <CredentialRow 
                    label="RTR" 
                    value={formData.rtr}
                    onChange={(v) => setFormData(prev => ({ ...prev, rtr: v }))}
                  />
                  <CredentialRow 
                    label="RTR Password" 
                    value={formData.rtrPassword}
                    onChange={(v) => setFormData(prev => ({ ...prev, rtrPassword: v }))}
                    isPassword
                  />
                  <CredentialRow 
                    label="Authenticator Username" 
                    value={formData.authenticatorUsername}
                    onChange={(v) => setFormData(prev => ({ ...prev, authenticatorUsername: v }))}
                  />
                  <CredentialRow 
                    label="Authenticator Password" 
                    value={formData.authenticatorPassword}
                    onChange={(v) => setFormData(prev => ({ ...prev, authenticatorPassword: v }))}
                    isPassword
                  />
                  <CredentialRow 
                    label="iPad PIN" 
                    value={formData.ipadPin}
                    onChange={(v) => setFormData(prev => ({ ...prev, ipadPin: v }))}
                    isPassword
                  />
                  <CredentialRow 
                    label="Device #" 
                    value={formData.deviceNumber}
                    onChange={(v) => setFormData(prev => ({ ...prev, deviceNumber: v }))}
                  />
                  <CredentialRow 
                    label="Gmail" 
                    value={formData.gmail}
                    onChange={(v) => setFormData(prev => ({ ...prev, gmail: v }))}
                  />
                  <CredentialRow 
                    label="Gmail Password" 
                    value={formData.gmailPassword}
                    onChange={(v) => setFormData(prev => ({ ...prev, gmailPassword: v }))}
                    isPassword
                  />
                  <div className="p-4 border-b">
                    <Label className="text-sm font-medium mb-2 block">Notes</Label>
                    <Textarea 
                      value={formData.notes} 
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Additional notes..."
                      rows={2}
                      data-testid="input-admin-notes"
                    />
                  </div>
                </form>
              </CardContent>
              <div className="p-4 border-t flex justify-between items-center">
                <Button 
                  variant="outline"
                  onClick={() => loadFormFromCredentials(selectedUserData?.credentials || null)}
                  data-testid="button-reset-form"
                >
                  Reset
                </Button>
                <Button 
                  onClick={() => updateMutation.mutate(formData)}
                  disabled={updateMutation.isPending}
                  data-testid="button-save-admin-credentials"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateMutation.isPending ? "Saving..." : "Save Credentials"}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Credentials</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            Are you sure you want to delete the credentials for {selectedUserData?.user.name}? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
