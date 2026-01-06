import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Users, Edit, UserX, AlertTriangle, KeyRound, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { User } from "@shared/schema";

const __NONE__ = "__NONE__";

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
      const res = await fetch(`/api/admin/users/${userId}/password-reset`, {
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
  
  // Compute validation warnings
  const getValidationWarnings = (): string[] => {
    const warnings: string[] = [];
    const role = formData.role;
    const hasSupervisor = formData.assignedSupervisorId !== __NONE__;
    const hasManager = formData.assignedManagerId !== __NONE__;
    
    if (role === "REP") {
      if (!hasSupervisor && !hasManager) {
        warnings.push("Rep must be assigned to either a Supervisor or a Manager");
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

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "ADMIN": return "default";
      case "EXECUTIVE": return "default";
      case "MANAGER": return "secondary";
      case "SUPERVISOR": return "secondary";
      default: return "outline";
    }
  };

  const columns = [
    {
      key: "name",
      header: "User",
      cell: (row: User) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {getInitials(row.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{row.repId}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (row: User) => (
        <Badge variant={getRoleBadgeVariant(row.role)}>
          {row.role}
        </Badge>
      ),
    },
    {
      key: "hierarchy",
      header: "Reports To",
      cell: (row: User) => {
        const parts: string[] = [];
        if (row.assignedSupervisorId) {
          const sup = users?.find(u => u.id === row.assignedSupervisorId);
          if (sup) parts.push(`Sup: ${sup.name}`);
        }
        if (row.assignedManagerId) {
          const mgr = users?.find(u => u.id === row.assignedManagerId);
          if (mgr) parts.push(`Mgr: ${mgr.name}`);
        }
        if (row.assignedExecutiveId) {
          const exec = users?.find(u => u.id === row.assignedExecutiveId);
          if (exec) parts.push(`Exec: ${exec.name}`);
        }
        return <span className="text-xs text-muted-foreground">{parts.join(", ") || "-"}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (row: User) => (
        <Badge variant={row.status === "ACTIVE" ? "default" : "destructive"}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      cell: (row: User) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: User) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openEditDialog(row)}
            data-testid={`button-edit-${row.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setResetPasswordUser(row)}
            data-testid={`button-reset-password-${row.id}`}
            title="Reset Password"
          >
            <KeyRound className="h-4 w-4 text-amber-600" />
          </Button>
          {row.status === "ACTIVE" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => deactivateMutation.mutate(row.id)}
              data-testid={`button-deactivate-${row.id}`}
              title="Deactivate"
            >
              <UserX className="h-4 w-4 text-amber-600" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeleteUser(row)}
            data-testid={`button-delete-${row.id}`}
            title="Remove User"
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    },
  ];

  const showSupervisorField = formData.role === "REP";
  const showManagerField = formData.role === "REP" || formData.role === "SUPERVISOR";
  const showExecutiveField = formData.role === "REP" || formData.role === "SUPERVISOR" || formData.role === "MANAGER";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Users</h1>
            <p className="text-muted-foreground">Manage system users and roles</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-user">
          <Plus className="h-4 w-4 mr-2" />
          New User
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-users"
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredUsers || []}
            isLoading={isLoading}
            emptyMessage="No users found"
            testId="table-users"
          />
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
                  <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="EXECUTIVE">Executive</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
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
      
      {/* Password Reset Dialog */}
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
          
          {!tempPasswordResult ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This will generate a temporary password that expires in 24 hours. 
                The user will be required to change their password on next login.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResetPasswordUser(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => resetPasswordUser && resetPasswordMutation.mutate(resetPasswordUser.id)}
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-confirm-reset-password"
                >
                  {resetPasswordMutation.isPending ? "Generating..." : "Generate Temporary Password"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  <p className="font-medium mb-2">Temporary Password (copy now):</p>
                  <code className="block p-3 bg-muted rounded-md text-lg font-mono select-all" data-testid="text-temp-password">
                    {tempPasswordResult.tempPassword}
                  </code>
                  <p className="text-sm mt-3 text-muted-foreground">
                    This password will expire in {tempPasswordResult.expiresInHours} hours.
                    The user must change their password on next login.
                  </p>
                </AlertDescription>
              </Alert>
              <DialogFooter>
                <Button 
                  onClick={() => { setResetPasswordUser(null); setTempPasswordResult(null); }}
                  data-testid="button-close-reset-dialog"
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteUser} onOpenChange={() => setDeleteUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove User</DialogTitle>
            <DialogDescription>
              This will archive the user "{deleteUser?.name}" ({deleteUser?.repId}). 
              Their historical data will be preserved, but they will no longer have access to the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteUser(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteUser && deleteMutation.mutate(deleteUser.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-user"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
