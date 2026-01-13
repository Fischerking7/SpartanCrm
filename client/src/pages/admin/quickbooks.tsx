import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Link2, 
  Unlink, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  XCircle,
  FileText,
  BookOpen,
  Settings,
  ArrowRight,
  Activity,
  AlertTriangle,
  BarChart3,
  Server,
  DollarSign
} from "lucide-react";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";

interface ReconciliationData {
  orders: { synced: number; failed: number; pending: number; notApplicable: number };
  payRuns: { synced: number; failed: number; pending: number; skipped: number };
  totals: { totalOrdersValue: string; syncedOrdersValue: string; unsyncedOrdersValue: string };
  recentFailures: SyncLog[];
}

interface SyncHealthMetrics {
  last24Hours: { total: number; success: number; failed: number; pending: number; successRate: string };
  failuresByType: Record<string, number>;
  auditLogsCount: number;
  lastApiCalls: any[];
}

interface EnvironmentInfo {
  currentEnvironment: string;
  isSandbox: boolean;
  isProduction: boolean;
  apiMinorVersion: string;
}

interface ExceptionQueueItem extends SyncLog {
  entityDetails?: any;
}

interface QBStatus {
  isConnected: boolean;
  companyName: string | null;
  realmId: string | null;
  lastSyncAt: string | null;
  accessTokenExpiresAt: string | null;
  accountMappings: QBAccountMapping[];
}

interface QBAccountMapping {
  id: string;
  mappingType: string;
  qbAccountId: string;
  qbAccountName: string;
  qbAccountType: string;
  isActive: boolean;
}

interface QBAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  FullyQualifiedName: string;
  Active: boolean;
}

interface SyncLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  qbEntityId: string | null;
  qbDocNumber: string | null;
  errorMessage: string | null;
  retryCount: number;
  syncedAt: string | null;
  createdAt: string;
}

export default function AdminQuickBooks() {
  const { toast } = useToast();
  const [selectedExpenseAccount, setSelectedExpenseAccount] = useState<string>("");
  const [selectedAPAccount, setSelectedAPAccount] = useState<string>("");
  const [selectedRevenueAccount, setSelectedRevenueAccount] = useState<string>("");
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("");

  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<QBStatus>({
    queryKey: ["/api/admin/quickbooks/status"],
    retry: false,
  });

  const credentialsNotConfigured = statusError?.message?.includes("credentials not configured") || 
    statusError?.message?.includes("QB_CLIENT_ID");

  const { data: accounts, isLoading: accountsLoading } = useQuery<QBAccount[]>({
    queryKey: ["/api/admin/quickbooks/accounts"],
    enabled: status?.isConnected === true,
  });

  const { data: syncLogs, isLoading: logsLoading } = useQuery<SyncLog[]>({
    queryKey: ["/api/admin/quickbooks/sync-logs"],
    enabled: status?.isConnected === true,
    refetchInterval: 30000,
  });

  const { data: reconciliationData } = useQuery<ReconciliationData>({
    queryKey: ["/api/admin/quickbooks/reconciliation"],
    enabled: status?.isConnected === true,
    refetchInterval: 60000,
  });

  const { data: healthMetrics } = useQuery<SyncHealthMetrics>({
    queryKey: ["/api/admin/quickbooks/health"],
    enabled: status?.isConnected === true,
    refetchInterval: 30000,
  });

  const { data: exceptionQueue } = useQuery<ExceptionQueueItem[]>({
    queryKey: ["/api/admin/quickbooks/exception-queue"],
    enabled: status?.isConnected === true,
    refetchInterval: 30000,
  });

  const { data: environmentInfo } = useQuery<EnvironmentInfo>({
    queryKey: ["/api/admin/quickbooks/environment"],
    enabled: status?.isConnected === true,
  });

  const { data: qbClasses } = useQuery<{ Id: string; Name: string; FullyQualifiedName: string }[]>({
    queryKey: ["/api/admin/quickbooks/classes"],
    enabled: status?.isConnected === true,
  });

  const { data: qbDepartments } = useQuery<{ Id: string; Name: string; FullyQualifiedName: string }[]>({
    queryKey: ["/api/admin/quickbooks/departments"],
    enabled: status?.isConnected === true,
  });

  useEffect(() => {
    if (status?.accountMappings) {
      const expense = status.accountMappings.find(m => m.mappingType === "COMMISSION_EXPENSE");
      const ap = status.accountMappings.find(m => m.mappingType === "ACCOUNTS_PAYABLE");
      const revenue = status.accountMappings.find(m => m.mappingType === "REVENUE");
      const classMapping = status.accountMappings.find(m => m.mappingType === "CLASS");
      const deptMapping = status.accountMappings.find(m => m.mappingType === "DEPARTMENT");
      if (expense) setSelectedExpenseAccount(expense.qbAccountId);
      if (ap) setSelectedAPAccount(ap.qbAccountId);
      if (revenue) setSelectedRevenueAccount(revenue.qbAccountId);
      if (classMapping) setSelectedClass(classMapping.qbAccountId);
      if (deptMapping) setSelectedDepartment(deptMapping.qbAccountId);
    }
  }, [status?.accountMappings]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "QUICKBOOKS_CONNECTED") {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/quickbooks/status"] });
        toast({ title: "QuickBooks Connected", description: "Successfully connected to QuickBooks Online" });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [toast]);

  const handleConnect = async () => {
    try {
      // Fetch the auth URL with proper authentication
      const response = await apiRequest("GET", "/api/admin/quickbooks/authorize");
      const data = await response.json();
      if (data.authUrl) {
        // Now redirect the browser to QuickBooks
        window.location.href = data.authUrl;
      } else {
        toast({ 
          title: "Connection Failed", 
          description: "No authorization URL received",
          variant: "destructive"
        });
      }
    } catch (error: any) {
      toast({ 
        title: "Connection Failed", 
        description: error.message || "Failed to start QuickBooks connection",
        variant: "destructive"
      });
    }
  };

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/quickbooks/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quickbooks/status"] });
      toast({ title: "Disconnected", description: "QuickBooks has been disconnected" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveMappingMutation = useMutation({
    mutationFn: async ({ mappingType, accountId }: { mappingType: string; accountId: string }) => {
      const account = accounts?.find(a => a.Id === accountId);
      if (!account) throw new Error("Account not found");
      
      await apiRequest("POST", "/api/admin/quickbooks/mappings", {
        mappingType,
        qbAccountId: account.Id,
        qbAccountName: account.Name,
        qbAccountType: account.AccountType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quickbooks/status"] });
      toast({ title: "Mapping Saved", description: "Account mapping has been updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (syncLogId: string) => 
      apiRequest("POST", `/api/admin/quickbooks/retry/${syncLogId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quickbooks/sync-logs"] });
      toast({ title: "Retry Started", description: "Attempting to retry the failed sync" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const bulkSyncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/quickbooks/bulk-sync-invoices"),
    onSuccess: async (response) => {
      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quickbooks/sync-logs"] });
      toast({ 
        title: "Bulk Sync Complete", 
        description: `Synced ${result.synced} of ${result.total} orders. ${result.failed} failed.`
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getSyncStatusBadge = (status: string) => {
    switch (status) {
      case "SYNCED":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"><CheckCircle2 className="w-3 h-3 mr-1" />Synced</Badge>;
      case "PENDING":
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case "FAILED":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "SKIPPED":
        return <Badge variant="secondary"><ArrowRight className="w-3 h-3 mr-1" />Skipped</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (statusLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (credentialsNotConfigured) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">QuickBooks Integration</h1>
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Setup Required
            </CardTitle>
            <CardDescription>
              QuickBooks integration requires developer credentials from Intuit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Credentials Not Configured</AlertTitle>
              <AlertDescription>
                To enable QuickBooks integration, you need to set up the following environment variables:
              </AlertDescription>
            </Alert>

            <div className="bg-muted p-4 rounded-lg space-y-3">
              <h4 className="font-medium">Required Environment Variables:</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <code className="bg-background px-2 py-0.5 rounded text-xs">QB_CLIENT_ID</code>
                  <span className="text-muted-foreground">Your QuickBooks OAuth Client ID</span>
                </li>
                <li className="flex items-start gap-2">
                  <code className="bg-background px-2 py-0.5 rounded text-xs">QB_CLIENT_SECRET</code>
                  <span className="text-muted-foreground">Your QuickBooks OAuth Client Secret</span>
                </li>
              </ul>
              
              <h4 className="font-medium pt-2">Optional:</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <code className="bg-background px-2 py-0.5 rounded text-xs">QB_ENVIRONMENT</code>
                  <span className="text-muted-foreground">"sandbox" or "production" (defaults to sandbox)</span>
                </li>
              </ul>
            </div>

            <div className="pt-2">
              <h4 className="font-medium mb-2">How to get credentials:</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>Go to the Intuit Developer Portal (developer.intuit.com)</li>
                <li>Create or sign in to your developer account</li>
                <li>Create a new app and select "QuickBooks Online and Payments"</li>
                <li>Copy the Client ID and Client Secret from the app's Keys & credentials</li>
                <li>Add them to your Replit Secrets</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const expenseAccounts = accounts?.filter(a => 
    a.AccountType === "Expense" || a.AccountType === "Cost of Goods Sold"
  ) || [];

  const apAccounts = accounts?.filter(a => 
    a.AccountType === "Accounts Payable" || a.AccountType === "Other Current Liability"
  ) || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">QuickBooks Integration</h1>
        {status?.isConnected && (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        )}
      </div>

      <Tabs defaultValue="connection" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="connection" data-testid="tab-connection">
            <Link2 className="w-4 h-4 mr-2" />
            Connection
          </TabsTrigger>
          <TabsTrigger value="mapping" data-testid="tab-mapping" disabled={!status?.isConnected}>
            <Settings className="w-4 h-4 mr-2" />
            Mapping
          </TabsTrigger>
          <TabsTrigger value="reconciliation" data-testid="tab-reconciliation" disabled={!status?.isConnected}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Reconciliation
          </TabsTrigger>
          <TabsTrigger value="exceptions" data-testid="tab-exceptions" disabled={!status?.isConnected}>
            <AlertTriangle className="w-4 h-4 mr-2" />
            Exceptions
          </TabsTrigger>
          <TabsTrigger value="health" data-testid="tab-health" disabled={!status?.isConnected}>
            <Activity className="w-4 h-4 mr-2" />
            Health
          </TabsTrigger>
          <TabsTrigger value="sync" data-testid="tab-sync" disabled={!status?.isConnected}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>QuickBooks Online Connection</CardTitle>
              <CardDescription>
                Connect your QuickBooks Online account to automatically sync invoices and journal entries.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!status?.isConnected ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Not Connected</AlertTitle>
                    <AlertDescription>
                      Connect your QuickBooks Online account to enable automatic invoice sync and journal entry posting.
                    </AlertDescription>
                  </Alert>
                  
                  <Button 
                    onClick={handleConnect}
                    data-testid="button-connect-qb"
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Connect to QuickBooks
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Company Name</p>
                      <p className="font-medium" data-testid="text-company-name">{status.companyName || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Realm ID</p>
                      <p className="font-mono text-sm" data-testid="text-realm-id">{status.realmId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Sync</p>
                      <p data-testid="text-last-sync">
                        {status.lastSyncAt 
                          ? format(new Date(status.lastSyncAt), "MMM d, yyyy h:mm a")
                          : "Never"
                        }
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Token Expires</p>
                      <p data-testid="text-token-expiry">
                        {status.accessTokenExpiresAt 
                          ? format(new Date(status.accessTokenExpiresAt), "MMM d, yyyy h:mm a")
                          : "N/A"
                        }
                      </p>
                    </div>
                  </div>

                  <Button 
                    variant="destructive"
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                    data-testid="button-disconnect-qb"
                  >
                    <Unlink className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mapping" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Account Mapping</CardTitle>
              <CardDescription>
                Map Iron Crest accounts to QuickBooks accounts for proper journal entry posting.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {accountsLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Commission Expense Account</label>
                    <p className="text-sm text-muted-foreground">
                      Debit account for commission expenses when pay runs are finalized.
                    </p>
                    <div className="flex gap-2 items-center">
                      <Select 
                        value={selectedExpenseAccount} 
                        onValueChange={setSelectedExpenseAccount}
                      >
                        <SelectTrigger className="w-full" data-testid="select-expense-account">
                          <SelectValue placeholder="Select expense account" />
                        </SelectTrigger>
                        <SelectContent>
                          {expenseAccounts.map(account => (
                            <SelectItem key={account.Id} value={account.Id}>
                              {account.FullyQualifiedName} ({account.AccountType})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => saveMappingMutation.mutate({ 
                          mappingType: "COMMISSION_EXPENSE", 
                          accountId: selectedExpenseAccount 
                        })}
                        disabled={!selectedExpenseAccount || saveMappingMutation.isPending}
                        data-testid="button-save-expense-mapping"
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Accounts Payable Account</label>
                    <p className="text-sm text-muted-foreground">
                      Credit account for amounts owed to sales reps.
                    </p>
                    <div className="flex gap-2 items-center">
                      <Select 
                        value={selectedAPAccount} 
                        onValueChange={setSelectedAPAccount}
                      >
                        <SelectTrigger className="w-full" data-testid="select-ap-account">
                          <SelectValue placeholder="Select A/P account" />
                        </SelectTrigger>
                        <SelectContent>
                          {apAccounts.map(account => (
                            <SelectItem key={account.Id} value={account.Id}>
                              {account.FullyQualifiedName} ({account.AccountType})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => saveMappingMutation.mutate({ 
                          mappingType: "ACCOUNTS_PAYABLE", 
                          accountId: selectedAPAccount 
                        })}
                        disabled={!selectedAPAccount || saveMappingMutation.isPending}
                        data-testid="button-save-ap-mapping"
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Revenue Account</label>
                    <p className="text-sm text-muted-foreground">
                      Income account for commission revenue recognition.
                    </p>
                    <div className="flex gap-2 items-center">
                      <Select 
                        value={selectedRevenueAccount} 
                        onValueChange={setSelectedRevenueAccount}
                      >
                        <SelectTrigger className="w-full" data-testid="select-revenue-account">
                          <SelectValue placeholder="Select revenue account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts?.filter(a => a.AccountType === "Income" || a.AccountType === "Other Income").map(account => (
                            <SelectItem key={account.Id} value={account.Id}>
                              {account.FullyQualifiedName} ({account.AccountType})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => saveMappingMutation.mutate({ 
                          mappingType: "REVENUE", 
                          accountId: selectedRevenueAccount 
                        })}
                        disabled={!selectedRevenueAccount || saveMappingMutation.isPending}
                        data-testid="button-save-revenue-mapping"
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="pt-4 border-t">
                    <h4 className="text-sm font-medium mb-4">Class & Location Tracking</h4>
                    
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Default Class</label>
                        <p className="text-sm text-muted-foreground">
                          Assign a QuickBooks class to all synced transactions.
                        </p>
                        <div className="flex gap-2 items-center">
                          <Select 
                            value={selectedClass} 
                            onValueChange={setSelectedClass}
                          >
                            <SelectTrigger className="w-full" data-testid="select-class">
                              <SelectValue placeholder="Select class (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              {qbClasses?.map(cls => (
                                <SelectItem key={cls.Id} value={cls.Id}>
                                  {cls.FullyQualifiedName || cls.Name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={() => saveMappingMutation.mutate({ 
                              mappingType: "CLASS", 
                              accountId: selectedClass 
                            })}
                            disabled={!selectedClass || saveMappingMutation.isPending}
                            data-testid="button-save-class-mapping"
                          >
                            Save
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">Default Department/Location</label>
                        <p className="text-sm text-muted-foreground">
                          Assign a QuickBooks department to all synced transactions.
                        </p>
                        <div className="flex gap-2 items-center">
                          <Select 
                            value={selectedDepartment} 
                            onValueChange={setSelectedDepartment}
                          >
                            <SelectTrigger className="w-full" data-testid="select-department">
                              <SelectValue placeholder="Select department (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              {qbDepartments?.map(dept => (
                                <SelectItem key={dept.Id} value={dept.Id}>
                                  {dept.FullyQualifiedName || dept.Name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            onClick={() => saveMappingMutation.mutate({ 
                              mappingType: "DEPARTMENT", 
                              accountId: selectedDepartment 
                            })}
                            disabled={!selectedDepartment || saveMappingMutation.isPending}
                            data-testid="button-save-department-mapping"
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {status?.accountMappings && status.accountMappings.length > 0 && (
                    <div className="pt-4 border-t">
                      <h4 className="text-sm font-medium mb-2">Current Mappings</h4>
                      <div className="space-y-2">
                        {status.accountMappings.map(mapping => (
                          <div key={mapping.id} className="flex items-center justify-between p-2 bg-muted rounded">
                            <span className="font-medium">{mapping.mappingType.replace("_", " ")}</span>
                            <span className="text-muted-foreground">{mapping.qbAccountName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconciliation" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Orders Sync Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Synced</span>
                    <span className="font-medium text-green-600">{reconciliationData?.orders.synced || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Pending</span>
                    <span className="font-medium text-yellow-600">{reconciliationData?.orders.pending || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Failed</span>
                    <span className="font-medium text-red-600">{reconciliationData?.orders.failed || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  Pay Runs Sync Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Synced</span>
                    <span className="font-medium text-green-600">{reconciliationData?.payRuns.synced || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Pending</span>
                    <span className="font-medium text-yellow-600">{reconciliationData?.payRuns.pending || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Failed</span>
                    <span className="font-medium text-red-600">{reconciliationData?.payRuns.failed || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  Value Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Value</span>
                    <span className="font-medium">${reconciliationData?.totals.totalOrdersValue || "0.00"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Synced Value</span>
                    <span className="font-medium text-green-600">${reconciliationData?.totals.syncedOrdersValue || "0.00"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Unsynced Value</span>
                    <span className="font-medium text-yellow-600">${reconciliationData?.totals.unsyncedOrdersValue || "0.00"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {reconciliationData?.recentFailures && reconciliationData.recentFailures.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Recent Failures</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Doc #</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliationData.recentFailures.map(failure => (
                      <TableRow key={failure.id}>
                        <TableCell>{failure.entityType}</TableCell>
                        <TableCell className="font-mono text-sm">{failure.qbDocNumber || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate text-red-600">{failure.errorMessage}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(failure.createdAt), "MMM d, h:mm a")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="exceptions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                Exception Queue
              </CardTitle>
              <CardDescription>
                Failed sync operations that require attention. Review and retry as needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {exceptionQueue && exceptionQueue.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exceptionQueue.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>
                          {item.entityType === "INVOICE" ? (
                            <Badge variant="outline"><FileText className="w-3 h-3 mr-1" />Invoice</Badge>
                          ) : (
                            <Badge variant="outline"><BookOpen className="w-3 h-3 mr-1" />Journal</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {item.entityDetails?.customerName || item.entityDetails?.payRunName || "-"}
                            {item.entityDetails?.invoiceNumber && (
                              <span className="block text-muted-foreground font-mono text-xs">
                                {item.entityDetails.invoiceNumber}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <p className="truncate text-red-600 dark:text-red-400 text-sm">{item.errorMessage}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.retryCount}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(item.createdAt), "MMM d, h:mm a")}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryMutation.mutate(item.id)}
                            disabled={retryMutation.isPending}
                            data-testid={`button-retry-exception-${item.id}`}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Retry
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
                  No exceptions to handle
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Sync Health (24h)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Success Rate</span>
                  <span className="text-2xl font-bold text-green-600">{healthMetrics?.last24Hours.successRate || "100%"}</span>
                </div>
                <Progress 
                  value={parseFloat(healthMetrics?.last24Hours.successRate || "100")} 
                  className="h-2"
                />
                <div className="grid grid-cols-3 gap-4 pt-2">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{healthMetrics?.last24Hours.success || 0}</p>
                    <p className="text-xs text-muted-foreground">Success</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-red-600">{healthMetrics?.last24Hours.failed || 0}</p>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-yellow-600">{healthMetrics?.last24Hours.pending || 0}</p>
                    <p className="text-xs text-muted-foreground">Pending</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5" />
                  Environment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Current Environment</span>
                  <Badge className={environmentInfo?.isProduction ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}>
                    {environmentInfo?.currentEnvironment?.toUpperCase() || "SANDBOX"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">API Version</span>
                  <span className="font-mono text-sm">{environmentInfo?.apiMinorVersion || "65"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Audit Logs</span>
                  <span>{healthMetrics?.auditLogsCount || 0} entries</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {healthMetrics?.failuresByType && Object.keys(healthMetrics.failuresByType).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Failures by Type (24h)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  {Object.entries(healthMetrics.failuresByType).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2">
                      <Badge variant="destructive">{count}</Badge>
                      <span className="text-sm">{type}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="sync" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Sync Operations</h3>
            <Button
              onClick={() => bulkSyncMutation.mutate()}
              disabled={bulkSyncMutation.isPending}
              data-testid="button-bulk-sync"
            >
              {bulkSyncMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-2" />
              )}
              Sync All Pending Invoices
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Sync Activity</CardTitle>
              <CardDescription>
                View the status of recent QuickBooks sync operations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : syncLogs && syncLogs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>QB Doc #</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {syncLogs.map(log => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {log.entityType === "INVOICE" ? (
                            <Badge variant="outline"><FileText className="w-3 h-3 mr-1" />Invoice</Badge>
                          ) : (
                            <Badge variant="outline"><BookOpen className="w-3 h-3 mr-1" />Journal</Badge>
                          )}
                        </TableCell>
                        <TableCell>{log.action}</TableCell>
                        <TableCell>{getSyncStatusBadge(log.status)}</TableCell>
                        <TableCell className="font-mono text-sm">{log.qbDocNumber || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate text-red-600 dark:text-red-400">
                          {log.errorMessage || "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(log.createdAt), "MMM d, h:mm a")}
                        </TableCell>
                        <TableCell>
                          {log.status === "FAILED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => retryMutation.mutate(log.id)}
                              disabled={retryMutation.isPending}
                              data-testid={`button-retry-${log.id}`}
                            >
                              <RefreshCw className="w-3 h-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No sync activity yet. Syncs will appear here once invoices or journal entries are posted.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
