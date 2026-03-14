import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Search, Plus, ArrowLeft, Users, Shield, Key, Target, Activity, UserX
} from "lucide-react";

const roleOptions = ["REP", "MDU", "LEAD", "MANAGER", "DIRECTOR", "EXECUTIVE", "OPERATIONS", "ACCOUNTING"];
const statusOptions = ["ACTIVE", "INACTIVE"];

const roleColors: Record<string, string> = {
  REP: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  MDU: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  LEAD: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  MANAGER: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  EXECUTIVE: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  OPERATIONS: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300",
  ADMIN: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  ACCOUNTING: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
};

export default function OpsReps() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", repId: "", role: "REP", password: "" });

  const { data: allUsers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: selectedUserOrders } = useQuery<any>({
    queryKey: ["/api/orders", `?repId=${selectedUserId}&limit=50`],
    enabled: !!selectedUserId,
  });

  const { data: credentials } = useQuery<any[]>({
    queryKey: ["/api/admin/employee-credentials/user", selectedUserId],
    enabled: !!selectedUserId,
  });

  const { data: goals } = useQuery<any[]>({
    queryKey: ["/api/admin/sales-goals"],
  });

  const filteredUsers = (allUsers || []).filter((u: any) => {
    if (u.deletedAt) return false;
    if (search && !u.name?.toLowerCase().includes(search.toLowerCase()) && !u.repId?.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (statusFilter !== "all" && u.status !== statusFilter) return false;
    return true;
  });

  const selectedUser = selectedUserId ? allUsers?.find((u: any) => u.id === selectedUserId) : null;
  const userOrders = Array.isArray(selectedUserOrders) ? selectedUserOrders : (selectedUserOrders?.orders || []);

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/users", createForm);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowCreateDialog(false);
      setCreateForm({ name: "", repId: "", role: "REP", password: "" });
      toast({ title: "Rep created successfully" });
    },
    onError: (err: any) => toast({ title: "Failed to create rep", description: err.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("POST", `/api/admin/users/${userId}/deactivate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setShowDeactivateDialog(false);
      toast({ title: "Rep deactivated" });
    },
    onError: () => toast({ title: "Failed to deactivate", variant: "destructive" }),
  });

  if (selectedUser) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="rep-detail">
        <Button variant="ghost" onClick={() => setSelectedUserId(null)} data-testid="btn-back-reps">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Rep Roster
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{selectedUser.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={roleColors[selectedUser.role] || ""}>{selectedUser.role}</Badge>
              <span className="text-sm text-muted-foreground">ID: {selectedUser.repId}</span>
              <Badge variant="outline" className={selectedUser.status === "ACTIVE" ? "text-green-600" : "text-red-600"}>
                {selectedUser.status}
              </Badge>
            </div>
          </div>
          {selectedUser.status === "ACTIVE" && (
            <Button variant="destructive" size="sm" onClick={() => setShowDeactivateDialog(true)} data-testid="btn-deactivate">
              <UserX className="h-4 w-4 mr-2" /> Deactivate
            </Button>
          )}
        </div>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile" data-testid="tab-profile">
              <Shield className="h-4 w-4 mr-1" /> Profile
            </TabsTrigger>
            <TabsTrigger value="orders" data-testid="tab-orders">
              Orders
            </TabsTrigger>
            <TabsTrigger value="credentials" data-testid="tab-credentials">
              <Key className="h-4 w-4 mr-1" /> Credentials
            </TabsTrigger>
            <TabsTrigger value="goals" data-testid="tab-goals">
              <Target className="h-4 w-4 mr-1" /> Goals
            </TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-activity">
              <Activity className="h-4 w-4 mr-1" /> Activity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Name</Label>
                    <p className="font-medium">{selectedUser.name}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Rep ID</Label>
                    <p className="font-medium">{selectedUser.repId}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Role</Label>
                    <p className="font-medium">{selectedUser.role}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Status</Label>
                    <p className="font-medium">{selectedUser.status}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Supervisor</Label>
                    <p className="font-medium">
                      {selectedUser.assignedSupervisorId
                        ? allUsers?.find((u: any) => u.id === selectedUser.assignedSupervisorId)?.name || selectedUser.assignedSupervisorId
                        : "None"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Manager</Label>
                    <p className="font-medium">
                      {selectedUser.assignedManagerId
                        ? allUsers?.find((u: any) => u.id === selectedUser.assignedManagerId)?.name || selectedUser.assignedManagerId
                        : "None"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Executive</Label>
                    <p className="font-medium">
                      {selectedUser.assignedExecutiveId
                        ? allUsers?.find((u: any) => u.id === selectedUser.assignedExecutiveId)?.name || selectedUser.assignedExecutiveId
                        : "None"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Created</Label>
                    <p className="font-medium">{new Date(selectedUser.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {userOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No orders found</p>
                ) : (
                  <div className="border rounded-lg overflow-auto max-h-[60vh]">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="text-left p-2">Invoice</th>
                          <th className="text-left p-2">Customer</th>
                          <th className="text-left p-2">Status</th>
                          <th className="text-right p-2">Commission</th>
                          <th className="text-left p-2">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userOrders.map((o: any) => (
                          <tr key={o.id} className="border-t">
                            <td className="p-2 font-mono text-xs">{o.invoiceNumber || "—"}</td>
                            <td className="p-2">{o.customerName}</td>
                            <td className="p-2"><Badge variant="outline" className="text-xs">{o.status}</Badge></td>
                            <td className="p-2 text-right">${parseFloat(o.baseCommissionEarned || "0").toFixed(2)}</td>
                            <td className="p-2">{new Date(o.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credentials" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {(credentials || []).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No credentials stored</p>
                ) : (
                  <div className="space-y-3">
                    {(credentials || []).map((cred: any) => (
                      <Card key={cred.id}>
                        <CardContent className="p-4">
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <Label className="text-muted-foreground">System</Label>
                              <p className="font-medium">{cred.systemName || cred.credentialType}</p>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Username</Label>
                              <p className="font-medium">{cred.username || "—"}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="goals" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {(goals || []).filter((g: any) => g.userId === selectedUserId).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No goals set</p>
                ) : (
                  <div className="space-y-3">
                    {(goals || []).filter((g: any) => g.userId === selectedUserId).map((goal: any) => (
                      <Card key={goal.id}>
                        <CardContent className="p-4 text-sm">
                          <p className="font-medium">{goal.metricType}: {goal.targetValue}</p>
                          <p className="text-muted-foreground">{goal.periodType} · {goal.periodStart} to {goal.periodEnd}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <Label className="text-muted-foreground">Last Login</Label>
                    <p className="font-medium">
                      {selectedUser.lastLoginAt ? new Date(selectedUser.lastLoginAt).toLocaleString() : "Never"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Last Active</Label>
                    <p className="font-medium">
                      {selectedUser.lastActiveAt ? new Date(selectedUser.lastActiveAt).toLocaleString() : "Never"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Login Location</Label>
                    <p className="font-medium">{selectedUser.lastLoginLocation || "Unknown"}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Login IP</Label>
                    <p className="font-medium">{selectedUser.lastLoginIp || "Unknown"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Deactivate {selectedUser.name}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will prevent the user from logging in. Their data will be preserved.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeactivateDialog(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deactivateMutation.mutate(selectedUser.id)} disabled={deactivateMutation.isPending} data-testid="btn-confirm-deactivate">
                Deactivate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="ops-reps">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" /> Rep Management
        </h1>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="btn-add-rep">
          <Plus className="h-4 w-4 mr-2" /> Add Rep
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or rep ID..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-reps"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-role-filter">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {roleOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Rep ID</th>
                <th className="text-left p-3 font-medium">Role</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Manager</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">Status</th>
                <th className="text-left p-3 font-medium hidden lg:table-cell">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user: any) => (
                <tr
                  key={user.id}
                  className="border-t hover:bg-muted/50 cursor-pointer"
                  onClick={() => setSelectedUserId(user.id)}
                  data-testid={`rep-row-${user.id}`}
                >
                  <td className="p-3 font-medium">{user.name}</td>
                  <td className="p-3 font-mono text-xs">{user.repId}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={`text-xs ${roleColors[user.role] || ""}`}>{user.role}</Badge>
                  </td>
                  <td className="p-3 hidden md:table-cell text-muted-foreground">
                    {user.assignedManagerId
                      ? allUsers?.find((u: any) => u.id === user.assignedManagerId)?.name || "—"
                      : "—"}
                  </td>
                  <td className="p-3 hidden lg:table-cell">
                    <Badge variant="outline" className={`text-xs ${user.status === "ACTIVE" ? "text-green-600" : "text-red-600"}`}>
                      {user.status}
                    </Badge>
                  </td>
                  <td className="p-3 hidden lg:table-cell text-muted-foreground">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">{filteredUsers.length} reps found</p>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Rep</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-new-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Rep ID</Label>
              <Input
                value={createForm.repId}
                onChange={e => setCreateForm(f => ({ ...f, repId: e.target.value }))}
                data-testid="input-new-repid"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={createForm.role} onValueChange={v => setCreateForm(f => ({ ...f, role: v }))}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Temporary Password</Label>
              <Input
                type="password"
                value={createForm.password}
                onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                data-testid="input-new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!createForm.name || !createForm.repId || !createForm.password || createMutation.isPending}
              data-testid="btn-create-rep"
            >
              Create Rep
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
