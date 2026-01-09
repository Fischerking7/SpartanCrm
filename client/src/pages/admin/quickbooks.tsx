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
  ArrowRight
} from "lucide-react";
import { useState, useEffect } from "react";
import { format } from "date-fns";

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

  const { data: status, isLoading: statusLoading } = useQuery<QBStatus>({
    queryKey: ["/api/admin/quickbooks/status"],
  });

  const { data: accounts, isLoading: accountsLoading } = useQuery<QBAccount[]>({
    queryKey: ["/api/admin/quickbooks/accounts"],
    enabled: status?.isConnected === true,
  });

  const { data: syncLogs, isLoading: logsLoading } = useQuery<SyncLog[]>({
    queryKey: ["/api/admin/quickbooks/sync-logs"],
    enabled: status?.isConnected === true,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (status?.accountMappings) {
      const expense = status.accountMappings.find(m => m.mappingType === "COMMISSION_EXPENSE");
      const ap = status.accountMappings.find(m => m.mappingType === "ACCOUNTS_PAYABLE");
      if (expense) setSelectedExpenseAccount(expense.qbAccountId);
      if (ap) setSelectedAPAccount(ap.qbAccountId);
    }
  }, [status?.accountMappings]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "QUICKBOOKS_CONNECTED") {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/quickbooks/status"] });
        toast({ title: "QuickBooks Connected", description: "Successfully connected to QuickBooks Online" });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [toast]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/admin/quickbooks/authorize");
      const { authUrl } = await response.json();
      window.open(authUrl, "qb_oauth", "width=600,height=700,scrollbars=yes");
    },
    onError: (error: any) => {
      toast({ 
        title: "Connection Failed", 
        description: error.message || "Failed to start QuickBooks connection",
        variant: "destructive"
      });
    },
  });

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
        <TabsList>
          <TabsTrigger value="connection" data-testid="tab-connection">
            <Link2 className="w-4 h-4 mr-2" />
            Connection
          </TabsTrigger>
          <TabsTrigger value="mapping" data-testid="tab-mapping" disabled={!status?.isConnected}>
            <Settings className="w-4 h-4 mr-2" />
            Account Mapping
          </TabsTrigger>
          <TabsTrigger value="sync" data-testid="tab-sync" disabled={!status?.isConnected}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Status
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
                    onClick={() => connectMutation.mutate()}
                    disabled={connectMutation.isPending}
                    data-testid="button-connect-qb"
                  >
                    {connectMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Link2 className="w-4 h-4 mr-2" />
                    )}
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
