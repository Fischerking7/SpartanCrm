import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Calendar, DollarSign, Wallet, Plus, Settings, Users, Receipt, ArrowDownCircle, Edit, Trash2, Check, X } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface ScheduledPayRun {
  id: string;
  name: string;
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  secondDayOfMonth: number | null;
  isActive: boolean;
  autoCreatePayRun: boolean;
  autoLinkOrders: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DeductionType {
  id: string;
  name: string;
  description: string | null;
  category: string;
  active: boolean;
  createdAt: string;
}

interface UserDeduction {
  id: string;
  userId: string;
  deductionTypeId: string;
  amount: string;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  user?: { name: string; repId: string };
  deductionType?: DeductionType;
}

interface Advance {
  id: string;
  userId: string;
  requestedAt: string;
  amount: string;
  reason: string | null;
  status: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  repaymentAmount: string;
  remainingBalance: string;
  repaymentStartDate: string | null;
  fullyRepaidAt: string | null;
  user?: { name: string; repId: string };
}

interface User {
  id: string;
  name: string;
  repId: string;
  role: string;
}

function formatCurrency(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string) {
  return format(new Date(date), "MMM dd, yyyy");
}

const scheduleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"]),
  dayOfWeek: z.number().min(0).max(6).nullable(),
  dayOfMonth: z.number().min(1).max(28).nullable(),
  secondDayOfMonth: z.number().min(1).max(28).nullable(),
  autoCreatePayRun: z.boolean(),
  autoLinkOrders: z.boolean(),
}).refine((data) => {
  if (data.frequency === "SEMIMONTHLY" && data.dayOfMonth && data.secondDayOfMonth) {
    return data.dayOfMonth < data.secondDayOfMonth;
  }
  return true;
}, { message: "First pay date must be before second pay date", path: ["secondDayOfMonth"] });

const deductionTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.enum(["HEALTH", "RETIREMENT", "GARNISHMENT", "OTHER"]),
});

const userDeductionSchema = z.object({
  userId: z.string().min(1, "User is required"),
  deductionTypeId: z.string().min(1, "Deduction type is required"),
  amount: z.string().min(1, "Amount is required"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const advanceSchema = z.object({
  userId: z.string().min(1, "User is required"),
  amount: z.string().min(1, "Amount is required"),
  reason: z.string().optional(),
  repaymentAmount: z.string().min(1, "Repayment amount is required"),
  repaymentStartDate: z.string().optional(),
});

function SchedulesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: schedules, isLoading } = useQuery<ScheduledPayRun[]>({
    queryKey: ["/api/admin/scheduled-pay-runs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/scheduled-pay-runs", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch schedules");
      return res.json();
    },
  });

  const form = useForm({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      name: "",
      frequency: "WEEKLY" as const,
      dayOfWeek: 5 as number | null,
      dayOfMonth: null as number | null,
      secondDayOfMonth: null as number | null,
      autoCreatePayRun: true,
      autoLinkOrders: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof scheduleSchema>) => {
      return apiRequest("/api/admin/scheduled-pay-runs", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduled-pay-runs"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Schedule created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create schedule", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest(`/api/admin/scheduled-pay-runs/${id}`, "PATCH", { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduled-pay-runs"] });
      toast({ title: "Schedule updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/scheduled-pay-runs/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scheduled-pay-runs"] });
      toast({ title: "Schedule deleted" });
    },
  });

  const getDayName = (day: number) => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days[day];
  };

  const getPayDayLabel = (schedule: ScheduledPayRun) => {
    if (schedule.frequency === "WEEKLY" || schedule.frequency === "BIWEEKLY") {
      return schedule.dayOfWeek !== null ? getDayName(schedule.dayOfWeek) : "-";
    }
    if (schedule.frequency === "SEMIMONTHLY") {
      const d1 = schedule.dayOfMonth || 1;
      const d2 = schedule.secondDayOfMonth || 16;
      return `${d1}${ordinal(d1)} & ${d2}${ordinal(d2)}`;
    }
    if (schedule.frequency === "MONTHLY") {
      return schedule.dayOfMonth ? `${schedule.dayOfMonth}${ordinal(schedule.dayOfMonth)}` : "-";
    }
    return "-";
  };

  const ordinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  const frequency = form.watch("frequency");

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Automated Pay Run Schedules</h3>
          <p className="text-sm text-muted-foreground">Configure automated pay run creation and order linking</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-schedule">
              <Plus className="h-4 w-4 mr-2" />
              Add Schedule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Automated Schedule</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Schedule Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Semi-Monthly Payroll" {...field} data-testid="input-schedule-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="frequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-frequency">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="WEEKLY">Weekly</SelectItem>
                          <SelectItem value="BIWEEKLY">Bi-Weekly</SelectItem>
                          <SelectItem value="SEMIMONTHLY">Semi-Monthly</SelectItem>
                          <SelectItem value="MONTHLY">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(frequency === "WEEKLY" || frequency === "BIWEEKLY") && (
                  <FormField
                    control={form.control}
                    name="dayOfWeek"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pay Day</FormLabel>
                        <Select onValueChange={(v) => field.onChange(parseInt(v))} value={field.value?.toString()}>
                          <FormControl>
                            <SelectTrigger data-testid="select-day-of-week">
                              <SelectValue placeholder="Select day" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="0">Sunday</SelectItem>
                            <SelectItem value="1">Monday</SelectItem>
                            <SelectItem value="2">Tuesday</SelectItem>
                            <SelectItem value="3">Wednesday</SelectItem>
                            <SelectItem value="4">Thursday</SelectItem>
                            <SelectItem value="5">Friday</SelectItem>
                            <SelectItem value="6">Saturday</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {frequency === "SEMIMONTHLY" && (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="dayOfMonth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Pay Date</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min={1} 
                              max={28} 
                              placeholder="1" 
                              value={field.value || ""} 
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                              data-testid="input-first-pay-date" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="secondDayOfMonth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Second Pay Date</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min={1} 
                              max={28} 
                              placeholder="16" 
                              value={field.value || ""} 
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                              data-testid="input-second-pay-date" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
                {frequency === "MONTHLY" && (
                  <FormField
                    control={form.control}
                    name="dayOfMonth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Day of Month</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min={1} 
                            max={28} 
                            placeholder="15" 
                            value={field.value || ""} 
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                            data-testid="input-day-of-month" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <Separator />
                <div className="space-y-3">
                  <FormField
                    control={form.control}
                    name="autoCreatePayRun"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <FormLabel className="text-sm">Auto-create draft pay runs</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-auto-create" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="autoLinkOrders"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <FormLabel className="text-sm">Auto-link eligible orders</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-auto-link" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-schedule">
                    {createMutation.isPending ? "Creating..." : "Create Schedule"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Frequency</TableHead>
            <TableHead>Pay Day(s)</TableHead>
            <TableHead>Auto-Create</TableHead>
            <TableHead>Auto-Link</TableHead>
            <TableHead>Next Run</TableHead>
            <TableHead>Last Run</TableHead>
            <TableHead>Active</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedules?.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                No automated schedules configured. Add one to get started.
              </TableCell>
            </TableRow>
          )}
          {schedules?.map((schedule) => (
            <TableRow key={schedule.id} data-testid={`row-schedule-${schedule.id}`}>
              <TableCell className="font-medium">{schedule.name}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {schedule.frequency === "BIWEEKLY" ? "Bi-Weekly" : 
                   schedule.frequency === "SEMIMONTHLY" ? "Semi-Monthly" : 
                   schedule.frequency.charAt(0) + schedule.frequency.slice(1).toLowerCase()}
                </Badge>
              </TableCell>
              <TableCell className="text-sm">{getPayDayLabel(schedule)}</TableCell>
              <TableCell>
                {schedule.autoCreatePayRun ? (
                  <Badge variant="default" className="bg-green-600 text-xs">On</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Off</Badge>
                )}
              </TableCell>
              <TableCell>
                {schedule.autoLinkOrders ? (
                  <Badge variant="default" className="bg-green-600 text-xs">On</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Off</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {schedule.nextRunAt ? format(new Date(schedule.nextRunAt), "MMM dd, yyyy") : "-"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {schedule.lastRunAt ? format(new Date(schedule.lastRunAt), "MMM dd, yyyy") : "Never"}
              </TableCell>
              <TableCell>
                <Switch 
                  checked={schedule.isActive} 
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: schedule.id, isActive: checked })}
                  data-testid={`switch-schedule-${schedule.id}`}
                />
              </TableCell>
              <TableCell>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => deleteMutation.mutate(schedule.id)}
                  data-testid={`button-delete-schedule-${schedule.id}`}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DeductionTypesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: types, isLoading } = useQuery<DeductionType[]>({
    queryKey: ["/api/admin/payroll/deduction-types"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payroll/deduction-types", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch deduction types");
      return res.json();
    },
  });

  const form = useForm({
    resolver: zodResolver(deductionTypeSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "OTHER" as const,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof deductionTypeSchema>) => {
      return apiRequest("/api/admin/payroll/deduction-types", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/deduction-types"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Deduction type created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create deduction type", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return apiRequest(`/api/admin/payroll/deduction-types/${id}`, "PATCH", { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/deduction-types"] });
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Deduction Types</h3>
          <p className="text-sm text-muted-foreground">Define categories of deductions</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-deduction-type">
              <Plus className="h-4 w-4 mr-2" />
              Add Deduction Type
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Deduction Type</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Health Insurance" {...field} data-testid="input-deduction-type-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input placeholder="Optional description" {...field} data-testid="input-deduction-type-desc" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-deduction-category">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="HEALTH">Health</SelectItem>
                          <SelectItem value="RETIREMENT">Retirement</SelectItem>
                          <SelectItem value="GARNISHMENT">Garnishment</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-deduction-type">
                    {createMutation.isPending ? "Creating..." : "Create Type"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types?.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                No deduction types defined. Add one to get started.
              </TableCell>
            </TableRow>
          )}
          {types?.map((type) => (
            <TableRow key={type.id}>
              <TableCell className="font-medium">{type.name}</TableCell>
              <TableCell>
                <Badge variant="outline">{type.category}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{type.description || "-"}</TableCell>
              <TableCell>
                <Switch 
                  checked={type.active} 
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: type.id, active: checked })}
                  data-testid={`switch-deduction-type-${type.id}`}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UserDeductionsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: deductions, isLoading: deductionsLoading } = useQuery<UserDeduction[]>({
    queryKey: ["/api/admin/payroll/user-deductions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payroll/user-deductions", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch user deductions");
      return res.json();
    },
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const { data: types } = useQuery<DeductionType[]>({
    queryKey: ["/api/admin/payroll/deduction-types"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payroll/deduction-types", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch deduction types");
      return res.json();
    },
  });

  const form = useForm({
    resolver: zodResolver(userDeductionSchema),
    defaultValues: {
      userId: "",
      deductionTypeId: "",
      amount: "",
      startDate: "",
      endDate: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof userDeductionSchema>) => {
      return apiRequest("/api/admin/payroll/user-deductions", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/user-deductions"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "User deduction created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create user deduction", variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return apiRequest(`/api/admin/payroll/user-deductions/${id}`, "PATCH", { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/user-deductions"] });
    },
  });

  if (deductionsLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">User Deductions</h3>
          <p className="text-sm text-muted-foreground">Assign deductions to specific team members</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-user-deduction">
              <Plus className="h-4 w-4 mr-2" />
              Assign Deduction
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Deduction to User</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="userId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-deduction-user">
                            <SelectValue placeholder="Select user" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users?.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name} ({user.repId})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="deductionTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deduction Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-deduction-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {types?.filter(t => t.active).map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount per Pay Period</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="100.00" {...field} data-testid="input-deduction-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Date (Optional)</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-deduction-start" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>End Date (Optional)</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-deduction-end" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-user-deduction">
                    {createMutation.isPending ? "Creating..." : "Assign Deduction"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Deduction Type</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Period</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deductions?.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No user deductions assigned. Add one to get started.
              </TableCell>
            </TableRow>
          )}
          {deductions?.map((ded) => (
            <TableRow key={ded.id}>
              <TableCell className="font-medium">
                {ded.user?.name || "Unknown"} <span className="text-muted-foreground">({ded.user?.repId})</span>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{ded.deductionType?.name || "Unknown"}</Badge>
              </TableCell>
              <TableCell className="text-red-600 dark:text-red-400">{formatCurrency(ded.amount)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {ded.startDate ? formatDate(ded.startDate) : "N/A"} - {ded.endDate ? formatDate(ded.endDate) : "Ongoing"}
              </TableCell>
              <TableCell>
                <Switch 
                  checked={ded.active} 
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: ded.id, active: checked })}
                  data-testid={`switch-user-deduction-${ded.id}`}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AdvancesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: advances, isLoading } = useQuery<Advance[]>({
    queryKey: ["/api/admin/payroll/advances"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payroll/advances", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch advances");
      return res.json();
    },
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const form = useForm({
    resolver: zodResolver(advanceSchema),
    defaultValues: {
      userId: "",
      amount: "",
      reason: "",
      repaymentAmount: "",
      repaymentStartDate: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof advanceSchema>) => {
      return apiRequest("/api/admin/payroll/advances", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Advance created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create advance", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/payroll/advances/${id}/approve`, "POST", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      toast({ title: "Advance approved" });
    },
    onError: () => {
      toast({ title: "Failed to approve advance", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/admin/payroll/advances/${id}/reject`, "POST", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      toast({ title: "Advance rejected" });
    },
    onError: () => {
      toast({ title: "Failed to reject advance", variant: "destructive" });
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;

  const pendingAdvances = advances?.filter(a => a.status === "PENDING") || [];
  const activeAdvances = advances?.filter(a => a.status === "APPROVED" && parseFloat(a.remainingBalance) > 0) || [];
  const completedAdvances = advances?.filter(a => a.status === "APPROVED" && parseFloat(a.remainingBalance) <= 0) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Commission Advances</h3>
          <p className="text-sm text-muted-foreground">Manage advances and draws against future earnings</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-advance">
              <Plus className="h-4 w-4 mr-2" />
              Issue Advance
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Issue Advance</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="userId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-advance-user">
                            <SelectValue placeholder="Select user" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users?.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name} ({user.repId})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Advance Amount</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="500.00" {...field} data-testid="input-advance-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Emergency funds" {...field} data-testid="input-advance-reason" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="repaymentAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repayment Amount per Pay Period</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="100.00" {...field} data-testid="input-repayment-amount" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="repaymentStartDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repayment Start Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-repayment-start" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-advance">
                    {createMutation.isPending ? "Creating..." : "Issue Advance"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {pendingAdvances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4 text-amber-500" />
              Pending Approval ({pendingAdvances.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingAdvances.map((adv) => (
                  <TableRow key={adv.id}>
                    <TableCell className="font-medium">{adv.user?.name} ({adv.user?.repId})</TableCell>
                    <TableCell>{formatDate(adv.requestedAt)}</TableCell>
                    <TableCell>{formatCurrency(adv.amount)}</TableCell>
                    <TableCell className="text-muted-foreground">{adv.reason || "-"}</TableCell>
                    <TableCell className="space-x-2">
                      <Button size="sm" onClick={() => approveMutation.mutate(adv.id)} disabled={approveMutation.isPending} data-testid={`button-approve-advance-${adv.id}`}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => rejectMutation.mutate(adv.id)} disabled={rejectMutation.isPending} data-testid={`button-reject-advance-${adv.id}`}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowDownCircle className="h-4 w-4 text-blue-500" />
            Active Advances ({activeAdvances.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeAdvances.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">No active advances</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Original Amount</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Repayment/Period</TableHead>
                  <TableHead>Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeAdvances.map((adv) => {
                  const total = parseFloat(adv.amount);
                  const remaining = parseFloat(adv.remainingBalance);
                  const paid = total - remaining;
                  const progress = (paid / total) * 100;
                  return (
                    <TableRow key={adv.id}>
                      <TableCell className="font-medium">{adv.user?.name} ({adv.user?.repId})</TableCell>
                      <TableCell>{formatCurrency(adv.amount)}</TableCell>
                      <TableCell className="text-red-600 dark:text-red-400">{formatCurrency(adv.remainingBalance)}</TableCell>
                      <TableCell>{formatCurrency(adv.repaymentAmount)}</TableCell>
                      <TableCell>
                        <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{progress.toFixed(0)}% repaid</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WeeklyPayStubsTab() {
  const { toast } = useToast();
  const [weekEndingDate, setWeekEndingDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [lastResult, setLastResult] = useState<{ generated: number; periodStart: string; periodEnd: string; statements: any[] } | null>(null);

  const exportToCSV = () => {
    if (!lastResult || lastResult.statements.length === 0) return;
    
    const headers = ["Rep Name", "Rep ID", "Period Start", "Period End", "Gross Commission", "Incentives", "Chargebacks", "Deductions", "Net Pay", "Status"];
    const rows = lastResult.statements.map((stmt: any) => [
      stmt.user?.name || "Unknown",
      stmt.user?.repId || stmt.userId,
      lastResult.periodStart,
      lastResult.periodEnd,
      stmt.grossCommission,
      stmt.incentivesTotal,
      stmt.chargebacksTotal,
      stmt.deductionsTotal,
      stmt.netPay,
      stmt.status
    ]);
    
    const csvContent = [headers, ...rows].map(row => row.map((cell: any) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `pay-stubs-${lastResult.periodEnd}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: "Export complete", description: "Pay stubs exported to CSV" });
  };

  const generateMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await apiRequest("POST", "/api/admin/payroll/generate-weekly-stubs", { weekEndingDate: date });
      return res.json();
    },
    onSuccess: (data) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/payruns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/statements"] });
      if (data.generated > 0) {
        toast({ title: "Pay stubs generated", description: `${data.generated} pay stubs created for period ${data.periodStart} to ${data.periodEnd}` });
      } else {
        toast({ title: "No pay stubs generated", description: data.message || "No paid orders found in this period", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to generate pay stubs", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Generate Weekly Pay Stubs
          </CardTitle>
          <CardDescription>
            Create pay stubs for all reps with paid orders based on install date in the selected week
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label>Week Ending Date</Label>
              <Input
                type="date"
                value={weekEndingDate}
                onChange={(e) => setWeekEndingDate(e.target.value)}
                className="w-48"
                data-testid="input-week-ending-date"
              />
            </div>
            <Button
              onClick={() => generateMutation.mutate(weekEndingDate)}
              disabled={generateMutation.isPending || !weekEndingDate}
              data-testid="button-generate-stubs"
            >
              {generateMutation.isPending ? "Generating..." : "Generate Pay Stubs"}
            </Button>
          </div>

          {lastResult && lastResult.generated > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-medium">Generated Pay Stubs ({lastResult.generated})</h3>
                  <p className="text-sm text-muted-foreground">
                    Period: {lastResult.periodStart} to {lastResult.periodEnd}
                  </p>
                </div>
                <Button variant="outline" onClick={exportToCSV} data-testid="button-export-csv">
                  <ArrowDownCircle className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rep</TableHead>
                    <TableHead>Gross Commission</TableHead>
                    <TableHead>Incentives</TableHead>
                    <TableHead>Deductions</TableHead>
                    <TableHead>Net Pay</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lastResult.statements.map((stmt: any) => (
                    <TableRow key={stmt.id} data-testid={`row-statement-${stmt.id}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{stmt.user?.name || "Unknown"}</div>
                          <div className="text-xs text-muted-foreground">{stmt.user?.repId || stmt.userId}</div>
                        </div>
                      </TableCell>
                      <TableCell>{formatCurrency(stmt.grossCommission)}</TableCell>
                      <TableCell>{formatCurrency(stmt.incentivesTotal)}</TableCell>
                      <TableCell>{formatCurrency(stmt.deductionsTotal)}</TableCell>
                      <TableCell className="font-medium">{formatCurrency(stmt.netPay)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{stmt.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPayroll() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Payroll Management</h1>
        <p className="text-muted-foreground">Configure payroll schedules, deductions, and advances</p>
      </div>

      <Tabs defaultValue="schedules" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="schedules" data-testid="tab-schedules">
            <Calendar className="h-4 w-4 mr-2" />
            Schedules
          </TabsTrigger>
          <TabsTrigger value="pay-stubs" data-testid="tab-pay-stubs">
            <Receipt className="h-4 w-4 mr-2" />
            Weekly Pay Stubs
          </TabsTrigger>
          <TabsTrigger value="deduction-types" data-testid="tab-deduction-types">
            <Settings className="h-4 w-4 mr-2" />
            Deduction Types
          </TabsTrigger>
          <TabsTrigger value="user-deductions" data-testid="tab-user-deductions">
            <Users className="h-4 w-4 mr-2" />
            User Deductions
          </TabsTrigger>
          <TabsTrigger value="advances" data-testid="tab-advances">
            <Wallet className="h-4 w-4 mr-2" />
            Advances
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedules">
          <SchedulesTab />
        </TabsContent>
        <TabsContent value="pay-stubs">
          <WeeklyPayStubsTab />
        </TabsContent>
        <TabsContent value="deduction-types">
          <DeductionTypesTab />
        </TabsContent>
        <TabsContent value="user-deductions">
          <UserDeductionsTab />
        </TabsContent>
        <TabsContent value="advances">
          <AdvancesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
