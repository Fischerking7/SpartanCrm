import i18n from "i18next";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { 
  FileText, CreditCard, Gift, PiggyBank, Users, TrendingUp, BarChart3, 
  Plus, Download, Check, X, Clock, DollarSign, AlertCircle, RefreshCw, Building2, Trash2
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

interface TaxDocument {
  id: string;
  userId: string;
  taxYear: number;
  documentType: string;
  status: string;
  totalEarnings: string;
  recipientName: string | null;
  createdAt: string;
  user?: { name: string; repId: string };
}

interface AchExport {
  id: string;
  payRunId: string;
  batchNumber: string;
  status: string;
  totalAmount: string;
  transactionCount: number;
  effectiveDate: string;
  createdAt: string;
}

interface Bonus {
  id: string;
  userId: string;
  bonusType: string;
  amount: string;
  status: string;
  reason: string | null;
  createdAt: string;
  user?: { name: string; repId: string };
}

interface DrawAccount {
  id: string;
  userId: string;
  status: string;
  drawAmount: string;
  currentBalance: string;
  createdAt: string;
  user?: { name: string; repId: string };
}

interface SplitAgreement {
  id: string;
  primaryRepId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  primaryRep?: { name: string; repId: string };
}

interface CommissionTier {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface CommissionForecast {
  id: string;
  userId: string;
  forecastPeriod: string;
  projectedCommission: string;
  actualCommission: string | null;
  createdAt: string;
  user?: { name: string; repId: string };
}

interface ScheduledPayRun {
  id: string;
  name: string;
  frequency: string;
  nextRunDate: string;
  isActive: boolean;
  createdAt: string;
}

interface User {
  id: string;
  name: string;
  repId: string;
  role: string;
}

interface BankAccount {
  id: string;
  userId: string;
  bankName: string;
  accountType: string;
  routingNumber: string;
  accountNumberLast4: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  user?: { name: string; repId: string };
}

function formatCurrency(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat(i18n.language === "es" ? "es-MX" : "en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string) {
  return format(new Date(date), "MMM dd, yyyy");
}

function TaxDocumentsTab() {
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear() - 1);

  const { data: documents, isLoading } = useQuery<TaxDocument[]>({
    queryKey: ["/api/admin/tax-documents", selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/admin/tax-documents?taxYear=${selectedYear}`, { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch tax documents");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (year: number) => {
      return apiRequest("POST", `/api/admin/tax-documents/bulk-generate/${year}`, {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tax-documents"] });
      toast({ 
        title: "1099s Generated", 
        description: `Created: ${data.created}, Skipped: ${data.skipped}` 
      });
    },
    onError: () => {
      toast({ title: "Failed to generate 1099s", variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT": return <Badge variant="secondary">Draft</Badge>;
      case "GENERATED": return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Generated</Badge>;
      case "SENT": return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Sent</Badge>;
      case "FILED": return <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">Filed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                1099-NEC Tax Documents
              </CardTitle>
              <CardDescription>Generate and manage contractor tax forms</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="w-32" data-testid="select-tax-year">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {[2025, 2024, 2023, 2022].map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                onClick={() => generateMutation.mutate(selectedYear)}
                disabled={generateMutation.isPending}
                data-testid="button-generate-1099s"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Generate 1099s
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!documents || documents.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No tax documents for {selectedYear}. Click "Generate 1099s" to create them.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Tax Year</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Total Earnings</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id} data-testid={`row-tax-doc-${doc.id}`}>
                    <TableCell className="font-medium">{doc.recipientName || doc.user?.name || "Unknown"}</TableCell>
                    <TableCell>{doc.taxYear}</TableCell>
                    <TableCell>{doc.documentType.replace("_", "-")}</TableCell>
                    <TableCell className="text-green-600 dark:text-green-400 font-medium">
                      {formatCurrency(doc.totalEarnings)}
                    </TableCell>
                    <TableCell>{getStatusBadge(doc.status)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(doc.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AchExportsTab() {
  const { toast } = useToast();

  const { data: exports, isLoading } = useQuery<AchExport[]>({
    queryKey: ["/api/admin/ach-exports"],
    queryFn: async () => {
      const res = await fetch("/api/admin/ach-exports", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch ACH exports");
      return res.json();
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/admin/ach-exports/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ach-exports"] });
      toast({ title: "ACH export status updated" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING": return <Badge variant="secondary">Pending</Badge>;
      case "SENT": return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Sent</Badge>;
      case "COMPLETED": return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Completed</Badge>;
      case "FAILED": return <Badge variant="destructive">Failed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            ACH/Direct Deposit Exports
          </CardTitle>
          <CardDescription>Manage and track direct deposit payment batches</CardDescription>
        </CardHeader>
        <CardContent>
          {!exports || exports.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No ACH exports yet. Generate one from a finalized pay run.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Number</TableHead>
                  <TableHead>Total Amount</TableHead>
                  <TableHead>Transactions</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.map((exp) => (
                  <TableRow key={exp.id} data-testid={`row-ach-export-${exp.id}`}>
                    <TableCell className="font-mono">{exp.batchNumber}</TableCell>
                    <TableCell className="text-green-600 dark:text-green-400 font-medium">
                      {formatCurrency(exp.totalAmount)}
                    </TableCell>
                    <TableCell>{exp.transactionCount}</TableCell>
                    <TableCell>{formatDate(exp.effectiveDate)}</TableCell>
                    <TableCell>{getStatusBadge(exp.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {exp.status === "PENDING" && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => updateStatusMutation.mutate({ id: exp.id, status: "SENT" })}
                            data-testid={`button-mark-sent-${exp.id}`}
                          >
                            Mark Sent
                          </Button>
                        )}
                        {exp.status === "SENT" && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => updateStatusMutation.mutate({ id: exp.id, status: "COMPLETED" })}
                            data-testid={`button-mark-completed-${exp.id}`}
                          >
                            Mark Completed
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" data-testid={`button-download-ach-${exp.id}`}>
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BonusesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newBonus, setNewBonus] = useState({
    userId: "",
    bonusType: "SPIFF",
    amount: "",
    reason: "",
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const { data: bonuses, isLoading } = useQuery<Bonus[]>({
    queryKey: ["/api/admin/bonuses"],
    queryFn: async () => {
      const res = await fetch("/api/admin/bonuses", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch bonuses");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newBonus) => {
      return apiRequest("POST", "/api/admin/bonuses", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bonuses"] });
      setDialogOpen(false);
      setNewBonus({ userId: "", bonusType: "SPIFF", amount: "", reason: "" });
      toast({ title: "Bonus created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create bonus", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/admin/bonuses/${id}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bonuses"] });
      toast({ title: "Bonus approved" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING": return <Badge variant="secondary">Pending</Badge>;
      case "APPROVED": return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Approved</Badge>;
      case "PAID": return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Paid</Badge>;
      case "CANCELLED": return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-primary" />
                Bonuses & SPIFFs
              </CardTitle>
              <CardDescription>Manage bonus payments and sales incentives</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-bonus">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Bonus
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Bonus</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Recipient</Label>
                    <Select 
                      value={newBonus.userId} 
                      onValueChange={(v) => setNewBonus(prev => ({ ...prev, userId: v }))}
                    >
                      <SelectTrigger data-testid="select-bonus-user">
                        <SelectValue placeholder="Select user" />
                      </SelectTrigger>
                      <SelectContent>
                        {users?.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name} ({u.repId})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Bonus Type</Label>
                    <Select 
                      value={newBonus.bonusType} 
                      onValueChange={(v) => setNewBonus(prev => ({ ...prev, bonusType: v }))}
                    >
                      <SelectTrigger data-testid="select-bonus-type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SPIFF">SPIFF</SelectItem>
                        <SelectItem value="PERFORMANCE">Performance Bonus</SelectItem>
                        <SelectItem value="REFERRAL">Referral Bonus</SelectItem>
                        <SelectItem value="RETENTION">Retention Bonus</SelectItem>
                        <SelectItem value="SIGNING">Signing Bonus</SelectItem>
                        <SelectItem value="CONTEST">Contest Prize</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input 
                      type="number" 
                      step="0.01"
                      value={newBonus.amount}
                      onChange={(e) => setNewBonus(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="0.00"
                      data-testid="input-bonus-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Reason/Notes</Label>
                    <Textarea 
                      value={newBonus.reason}
                      onChange={(e) => setNewBonus(prev => ({ ...prev, reason: e.target.value }))}
                      placeholder="Reason for bonus..."
                      data-testid="input-bonus-reason"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button 
                    onClick={() => createMutation.mutate(newBonus)}
                    disabled={!newBonus.userId || !newBonus.amount || createMutation.isPending}
                    data-testid="button-submit-bonus"
                  >
                    Create Bonus
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!bonuses || bonuses.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No bonuses yet. Click "Add Bonus" to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bonuses.map((bonus) => (
                  <TableRow key={bonus.id} data-testid={`row-bonus-${bonus.id}`}>
                    <TableCell className="font-medium">{bonus.user?.name || "Unknown"}</TableCell>
                    <TableCell><Badge variant="outline">{bonus.bonusType}</Badge></TableCell>
                    <TableCell className="text-green-600 dark:text-green-400 font-medium">
                      {formatCurrency(bonus.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate">{bonus.reason || "-"}</TableCell>
                    <TableCell>{getStatusBadge(bonus.status)}</TableCell>
                    <TableCell>
                      {bonus.status === "PENDING" && (
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => approveMutation.mutate(bonus.id)}
                          data-testid={`button-approve-bonus-${bonus.id}`}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DrawAccountsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newDraw, setNewDraw] = useState({
    userId: "",
    drawAmount: "",
    guaranteedPeriod: "MONTHLY",
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const { data: accounts, isLoading } = useQuery<DrawAccount[]>({
    queryKey: ["/api/admin/draw-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/draw-accounts", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch draw accounts");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newDraw) => {
      return apiRequest("POST", "/api/admin/draw-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/draw-accounts"] });
      setDialogOpen(false);
      setNewDraw({ userId: "", drawAmount: "", guaranteedPeriod: "MONTHLY" });
      toast({ title: "Draw account created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create draw account", variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE": return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>;
      case "SUSPENDED": return <Badge variant="secondary">Suspended</Badge>;
      case "CLOSED": return <Badge variant="outline">Closed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PiggyBank className="h-5 w-5 text-primary" />
                Draw Against Commission
              </CardTitle>
              <CardDescription>Manage guaranteed minimum payments and draw balances</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-draw-account">
                  <Plus className="h-4 w-4 mr-2" />
                  New Draw Account
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Draw Account</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>User</Label>
                    <Select 
                      value={newDraw.userId} 
                      onValueChange={(v) => setNewDraw(prev => ({ ...prev, userId: v }))}
                    >
                      <SelectTrigger data-testid="select-draw-user">
                        <SelectValue placeholder="Select user" />
                      </SelectTrigger>
                      <SelectContent>
                        {users?.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name} ({u.repId})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Guaranteed Draw Amount</Label>
                    <Input 
                      type="number" 
                      step="0.01"
                      value={newDraw.drawAmount}
                      onChange={(e) => setNewDraw(prev => ({ ...prev, drawAmount: e.target.value }))}
                      placeholder="0.00"
                      data-testid="input-draw-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Period</Label>
                    <Select 
                      value={newDraw.guaranteedPeriod} 
                      onValueChange={(v) => setNewDraw(prev => ({ ...prev, guaranteedPeriod: v }))}
                    >
                      <SelectTrigger data-testid="select-draw-period">
                        <SelectValue placeholder="Select period" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WEEKLY">Weekly</SelectItem>
                        <SelectItem value="BI_WEEKLY">Bi-Weekly</SelectItem>
                        <SelectItem value="MONTHLY">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button 
                    onClick={() => createMutation.mutate(newDraw)}
                    disabled={!newDraw.userId || !newDraw.drawAmount || createMutation.isPending}
                    data-testid="button-submit-draw-account"
                  >
                    Create Account
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!accounts || accounts.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No draw accounts configured. Click "New Draw Account" to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Guaranteed Draw</TableHead>
                  <TableHead>Current Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id} data-testid={`row-draw-account-${account.id}`}>
                    <TableCell className="font-medium">{account.user?.name || "Unknown"}</TableCell>
                    <TableCell className="text-green-600 dark:text-green-400 font-medium">
                      {formatCurrency(account.drawAmount)}
                    </TableCell>
                    <TableCell className={parseFloat(account.currentBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}>
                      {formatCurrency(account.currentBalance)}
                    </TableCell>
                    <TableCell>{getStatusBadge(account.status)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(account.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SplitCommissionsTab() {
  const { toast } = useToast();

  const { data: agreements, isLoading } = useQuery<SplitAgreement[]>({
    queryKey: ["/api/admin/split-agreements"],
    queryFn: async () => {
      const res = await fetch("/api/admin/split-agreements", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch split agreements");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Split Commission Agreements
              </CardTitle>
              <CardDescription>Configure commission sharing between sales reps</CardDescription>
            </div>
            <Button data-testid="button-add-split-agreement">
              <Plus className="h-4 w-4 mr-2" />
              New Agreement
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!agreements || agreements.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No split commission agreements configured.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agreement Name</TableHead>
                  <TableHead>Primary Rep</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agreements.map((agreement) => (
                  <TableRow key={agreement.id} data-testid={`row-split-agreement-${agreement.id}`}>
                    <TableCell className="font-medium">{agreement.name}</TableCell>
                    <TableCell>{agreement.primaryRep?.name || "Unknown"}</TableCell>
                    <TableCell>
                      {agreement.isActive ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(agreement.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CommissionTiersTab() {
  const { toast } = useToast();

  const { data: tiers, isLoading } = useQuery<CommissionTier[]>({
    queryKey: ["/api/admin/commission-tiers"],
    queryFn: async () => {
      const res = await fetch("/api/admin/commission-tiers", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch commission tiers");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Commission Tiers & Caps
              </CardTitle>
              <CardDescription>Volume-based commission accelerators and limits</CardDescription>
            </div>
            <Button data-testid="button-add-commission-tier">
              <Plus className="h-4 w-4 mr-2" />
              New Tier Structure
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!tiers || tiers.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No commission tier structures configured.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tiers.map((tier) => (
                  <TableRow key={tier.id} data-testid={`row-commission-tier-${tier.id}`}>
                    <TableCell className="font-medium">{tier.name}</TableCell>
                    <TableCell className="text-muted-foreground max-w-64 truncate">{tier.description || "-"}</TableCell>
                    <TableCell>
                      {tier.isActive ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(tier.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BankAccountsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [newAccount, setNewAccount] = useState({
    userId: "",
    accountHolderName: "",
    bankName: "",
    accountType: "CHECKING",
    routingNumber: "",
    accountNumber: "",
    isPrimary: true,
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const { data: accounts, isLoading, refetch } = useQuery<BankAccount[]>({
    queryKey: ["/api/admin/bank-accounts", selectedUserId],
    queryFn: async () => {
      if (!selectedUserId) return [];
      const res = await fetch(`/api/admin/bank-accounts?userId=${selectedUserId}`, { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch bank accounts");
      return res.json();
    },
    enabled: !!selectedUserId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newAccount) => {
      return apiRequest("POST", "/api/admin/bank-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bank-accounts"] });
      setDialogOpen(false);
      setNewAccount({
        userId: "",
        accountHolderName: "",
        bankName: "",
        accountType: "CHECKING",
        routingNumber: "",
        accountNumber: "",
        isPrimary: true,
      });
      refetch();
      toast({ title: "Bank account added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add bank account", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/bank-accounts/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bank-accounts"] });
      refetch();
      toast({ title: "Bank account removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove bank account", variant: "destructive" });
    },
  });

  const maskAccountNumber = (last4: string) => {
    return `****${last4}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Direct Deposit / Bank Accounts
              </CardTitle>
              <CardDescription>Manage rep bank account details for ACH payments</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-bank-account">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Bank Account
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Bank Account</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Rep / Employee</Label>
                    <Select 
                      value={newAccount.userId} 
                      onValueChange={(v) => setNewAccount(prev => ({ ...prev, userId: v }))}
                    >
                      <SelectTrigger data-testid="select-bank-user">
                        <SelectValue placeholder="Select user" />
                      </SelectTrigger>
                      <SelectContent>
                        {users?.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name} ({u.repId})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Account Holder Name</Label>
                    <Input 
                      value={newAccount.accountHolderName}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, accountHolderName: e.target.value }))}
                      placeholder="e.g., John Smith"
                      data-testid="input-account-holder-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Bank Name</Label>
                    <Input 
                      value={newAccount.bankName}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, bankName: e.target.value }))}
                      placeholder="e.g., Chase, Bank of America"
                      data-testid="input-bank-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Type</Label>
                    <Select 
                      value={newAccount.accountType} 
                      onValueChange={(v) => setNewAccount(prev => ({ ...prev, accountType: v }))}
                    >
                      <SelectTrigger data-testid="select-account-type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CHECKING">Checking</SelectItem>
                        <SelectItem value="SAVINGS">Savings</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Routing Number (9 digits)</Label>
                    <Input 
                      value={newAccount.routingNumber}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, routingNumber: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
                      placeholder="123456789"
                      maxLength={9}
                      data-testid="input-routing-number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input 
                      value={newAccount.accountNumber}
                      onChange={(e) => setNewAccount(prev => ({ ...prev, accountNumber: e.target.value.replace(/\D/g, '') }))}
                      placeholder="Enter account number"
                      data-testid="input-account-number"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button 
                    onClick={() => createMutation.mutate(newAccount)}
                    disabled={!newAccount.userId || !newAccount.accountHolderName || !newAccount.bankName || newAccount.routingNumber.length !== 9 || !newAccount.accountNumber || createMutation.isPending}
                    data-testid="button-submit-bank-account"
                  >
                    Add Account
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Label>View accounts for:</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-64" data-testid="select-view-user">
                  <SelectValue placeholder="Select a user to view their accounts" />
                </SelectTrigger>
                <SelectContent>
                  {users?.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name} ({u.repId})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!selectedUserId ? (
              <p className="text-center text-muted-foreground py-8">
                Select a user above to view their bank accounts.
              </p>
            ) : isLoading ? (
              <Skeleton className="h-32" />
            ) : !accounts || accounts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No bank accounts on file for this user. Click "Add Bank Account" to add one.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bank</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Routing #</TableHead>
                    <TableHead>Account #</TableHead>
                    <TableHead>Primary</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id} data-testid={`row-bank-account-${account.id}`}>
                      <TableCell className="font-medium">{account.bankName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{account.accountType}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">{account.routingNumber}</TableCell>
                      <TableCell className="font-mono">{maskAccountNumber(account.accountNumberLast4)}</TableCell>
                      <TableCell>
                        {account.isPrimary ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Primary</Badge>
                        ) : (
                          <Badge variant="secondary">Secondary</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(account.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-account-${account.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PayrollReportsTab() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  const { data: summary, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/payroll-reports/summary", selectedYear],
    queryFn: async () => {
      const res = await fetch(`/api/admin/payroll-reports/summary?year=${selectedYear}`, { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch payroll summary");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Payroll Summary</h3>
        <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
          <SelectTrigger className="w-32" data-testid="select-report-year">
            <SelectValue placeholder="Select year" />
          </SelectTrigger>
          <SelectContent>
            {[2026, 2025, 2024, 2023].map(year => (
              <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm">YTD Gross Pay</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(summary?.ytdTotals?.totalGross || 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm">YTD Deductions</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                {formatCurrency(summary?.ytdTotals?.totalDeductions || 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm">YTD Net Pay</p>
              <p className="text-2xl font-bold text-primary">
                {formatCurrency(summary?.ytdTotals?.totalNetPay || 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground text-sm">Pay Statements</p>
              <p className="text-2xl font-bold">
                {summary?.ytdTotals?.statementCount || 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Top Earners
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!summary?.topEarners || summary.topEarners.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">No data for {selectedYear}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Total Net Pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.topEarners.map((earner: any, idx: number) => (
                  <TableRow key={earner.userId} data-testid={`row-top-earner-${earner.userId}`}>
                    <TableCell className="font-medium">#{idx + 1}</TableCell>
                    <TableCell>{earner.userName}</TableCell>
                    <TableCell className="text-green-600 dark:text-green-400 font-medium">
                      {formatCurrency(earner.totalNetPay)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPayrollAdvanced() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Advanced Payroll</h1>
        <p className="text-muted-foreground">Manage 1099s, ACH exports, bonuses, draws, splits, tiers, and reports</p>
      </div>

      <Tabs defaultValue="tax-documents" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="tax-documents" data-testid="tab-tax-documents">
            <FileText className="h-4 w-4 mr-2" />
            1099s
          </TabsTrigger>
          <TabsTrigger value="bank-accounts" data-testid="tab-bank-accounts">
            <Building2 className="h-4 w-4 mr-2" />
            Bank Accounts
          </TabsTrigger>
          <TabsTrigger value="ach-exports" data-testid="tab-ach-exports">
            <CreditCard className="h-4 w-4 mr-2" />
            ACH Exports
          </TabsTrigger>
          <TabsTrigger value="bonuses" data-testid="tab-bonuses">
            <Gift className="h-4 w-4 mr-2" />
            Bonuses
          </TabsTrigger>
          <TabsTrigger value="draws" data-testid="tab-draws">
            <PiggyBank className="h-4 w-4 mr-2" />
            Draws
          </TabsTrigger>
          <TabsTrigger value="splits" data-testid="tab-splits">
            <Users className="h-4 w-4 mr-2" />
            Splits
          </TabsTrigger>
          <TabsTrigger value="tiers" data-testid="tab-tiers">
            <TrendingUp className="h-4 w-4 mr-2" />
            Tiers
          </TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">
            <BarChart3 className="h-4 w-4 mr-2" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tax-documents">
          <TaxDocumentsTab />
        </TabsContent>
        <TabsContent value="bank-accounts">
          <BankAccountsTab />
        </TabsContent>
        <TabsContent value="ach-exports">
          <AchExportsTab />
        </TabsContent>
        <TabsContent value="bonuses">
          <BonusesTab />
        </TabsContent>
        <TabsContent value="draws">
          <DrawAccountsTab />
        </TabsContent>
        <TabsContent value="splits">
          <SplitCommissionsTab />
        </TabsContent>
        <TabsContent value="tiers">
          <CommissionTiersTab />
        </TabsContent>
        <TabsContent value="reports">
          <PayrollReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
