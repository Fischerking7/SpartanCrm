import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { DollarSign, FileText, TrendingUp, Calendar, Eye, Wallet, Receipt, ArrowDownCircle, ArrowUpCircle, MinusCircle, Download } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";

interface PayStatement {
  id: string;
  payRunId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  grossCommission: string;
  overrideEarnings: string;
  incentivesTotal: string;
  chargebacksTotal: string;
  deductionsTotal: string;
  advancesRepayment: string;
  netPay: string;
  ytdGross: string;
  ytdNet: string;
  ytdDeductions: string;
  status: string;
  paidAt: string | null;
  checkNumber: string | null;
  createdAt: string;
}

interface PayStatementLineItem {
  id: string;
  payStatementId: string;
  salesOrderId: string | null;
  type: string;
  description: string;
  amount: string;
  createdAt: string;
}

interface PayStatementDeduction {
  id: string;
  payStatementId: string;
  userDeductionId: string | null;
  deductionTypeName: string;
  amount: string;
  createdAt: string;
}

interface PayStatementDetails extends PayStatement {
  lineItems: PayStatementLineItem[];
  deductions: PayStatementDeduction[];
}

interface YTDTotals {
  ytdGross: number;
  ytdNet: number;
  ytdDeductions: number;
  statementsCount: number;
}

function formatCurrency(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string) {
  return format(new Date(date), "MMM dd, yyyy");
}

function downloadPdf(statementId: string) {
  const headers = getAuthHeaders();
  fetch(`/api/payroll/my-statements/${statementId}/pdf`, {
    headers,
    credentials: "include",
  })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to download PDF");
      return res.blob();
    })
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PayStatement_${statementId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    })
    .catch((err) => console.error("PDF download error:", err));
}

function downloadExcel(statementId: string) {
  const headers = getAuthHeaders();
  fetch(`/api/payroll/my-statements/${statementId}/excel`, {
    headers,
    credentials: "include",
  })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to download Excel");
      return res.blob();
    })
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PayStub_${statementId}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    })
    .catch((err) => console.error("Excel download error:", err));
}

function StatementDetailsDialog({ statementId, isRep = false }: { statementId: string; isRep?: boolean }) {
  const [open, setOpen] = useState(false);
  
  const { data, isLoading } = useQuery<PayStatementDetails>({
    queryKey: ["/api/payroll/my-statements", statementId],
    queryFn: async () => {
      const res = await fetch(`/api/payroll/my-statements/${statementId}`, { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch statement details");
      return res.json();
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid={`button-view-statement-${statementId}`}>
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Pay Statement Details
          </DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-48" />
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Pay Period</p>
                <p className="font-medium">{formatDate(data.periodStart)} - {formatDate(data.periodEnd)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={data.status === "PAID" ? "default" : data.status === "FINALIZED" ? "secondary" : "outline"}>
                  {data.status}
                </Badge>
              </div>
              {data.paidAt && (
                <div>
                  <p className="text-muted-foreground">Paid On</p>
                  <p className="font-medium">{formatDate(data.paidAt)}</p>
                </div>
              )}
              {data.checkNumber && (
                <div>
                  <p className="text-muted-foreground">Check #</p>
                  <p className="font-medium">{data.checkNumber}</p>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="font-semibold">Earnings</h3>
              {isRep ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Net Commission</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{formatCurrency(data.netPay)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Chargebacks</p>
                    <p className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(data.chargebacksTotal)}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Base Commission</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{formatCurrency(data.grossCommission)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Override Earnings</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{formatCurrency(data.overrideEarnings)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Incentives</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{formatCurrency(data.incentivesTotal)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Chargebacks</p>
                    <p className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(data.chargebacksTotal)}</p>
                  </div>
                </div>
              )}
            </div>

            {data.lineItems.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold">Line Items</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.lineItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{item.type}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{item.description}</TableCell>
                          <TableCell className={`text-right font-medium ${parseFloat(item.amount) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {formatCurrency(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {data.deductions.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold">Deductions</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.deductions.map((ded) => (
                        <TableRow key={ded.id}>
                          <TableCell className="text-sm">{ded.deductionTypeName}</TableCell>
                          <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                            -{formatCurrency(ded.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-semibold">This Period</h3>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Deductions</span>
                  <span className="text-red-600 dark:text-red-400">-{formatCurrency(data.deductionsTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Advances Repayment</span>
                  <span className="text-red-600 dark:text-red-400">-{formatCurrency(data.advancesRepayment)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-semibold">Net Pay</span>
                  <span className="font-bold text-lg">{formatCurrency(data.netPay)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">Year to Date</h3>
                {!isRep && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">YTD Gross</span>
                    <span>{formatCurrency(data.ytdGross)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">YTD Deductions</span>
                  <span className="text-red-600 dark:text-red-400">-{formatCurrency(data.ytdDeductions)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-semibold">YTD Net</span>
                  <span className="font-bold">{formatCurrency(data.ytdNet)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Failed to load statement details</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function MyPayHistory() {
  const { user } = useAuth();
  const isRep = user?.role === "REP";
  const { data: statements, isLoading: statementsLoading } = useQuery<PayStatement[]>({
    queryKey: ["/api/payroll/my-statements"],
    queryFn: async () => {
      const res = await fetch("/api/payroll/my-statements", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch pay statements");
      return res.json();
    },
  });

  const { data: ytdData, isLoading: ytdLoading } = useQuery<YTDTotals>({
    queryKey: ["/api/payroll/my-ytd"],
    queryFn: async () => {
      const res = await fetch("/api/payroll/my-ytd", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch YTD totals");
      return res.json();
    },
  });

  if (statementsLoading || ytdLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const recentStatements = statements || [];
  const paidStatements = recentStatements.filter(s => s.status === "PAID");
  const pendingStatements = recentStatements.filter(s => s.status !== "PAID");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">My Pay History</h1>
        <p className="text-muted-foreground">View your pay statements and year-to-date earnings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">{isRep ? "YTD Net Earnings" : "YTD Gross Earnings"}</CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-ytd-gross">
              {formatCurrency(isRep ? (ytdData?.ytdNet || 0) : (ytdData?.ytdGross || 0))}
            </p>
            <p className="text-xs text-muted-foreground">{isRep ? "After overrides" : "Before deductions"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">YTD Deductions</CardTitle>
            <ArrowDownCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-ytd-deductions">
              -{formatCurrency(ytdData?.ytdDeductions || 0)}
            </p>
            <p className="text-xs text-muted-foreground">Total withheld</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">YTD Net Pay</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-ytd-net">
              {formatCurrency(ytdData?.ytdNet || 0)}
            </p>
            <p className="text-xs text-muted-foreground">Take-home pay</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">Pay Periods</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-statements-count">
              {ytdData?.statementsCount || 0}
            </p>
            <p className="text-xs text-muted-foreground">Statements this year</p>
          </CardContent>
        </Card>
      </div>

      {pendingStatements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MinusCircle className="h-5 w-5 text-amber-500" />
              Pending Payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pay Period</TableHead>
                  {!isRep && <TableHead>Gross</TableHead>}
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingStatements.map((statement) => (
                  <TableRow key={statement.id}>
                    <TableCell className="font-medium">
                      {formatDate(statement.periodStart)} - {formatDate(statement.periodEnd)}
                    </TableCell>
                    {!isRep && (
                      <TableCell className="text-green-600 dark:text-green-400">
                        {formatCurrency(statement.grossCommission)}
                      </TableCell>
                    )}
                    <TableCell className="text-red-600 dark:text-red-400">
                      -{formatCurrency(statement.deductionsTotal)}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {formatCurrency(statement.netPay)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{statement.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <StatementDetailsDialog statementId={statement.id} isRep={isRep} />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => downloadPdf(statement.id)}
                          data-testid={`button-download-pdf-${statement.id}`}
                          title="Download PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => downloadExcel(statement.id)}
                          data-testid={`button-download-excel-${statement.id}`}
                          title="Download Excel"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </div>
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
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Payment History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paidStatements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No paid statements yet</p>
              <p className="text-sm">Your payment history will appear here once you receive payments</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pay Period</TableHead>
                  <TableHead>Paid On</TableHead>
                  <TableHead>Check #</TableHead>
                  {!isRep && <TableHead>Gross</TableHead>}
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net Pay</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paidStatements.map((statement) => (
                  <TableRow key={statement.id}>
                    <TableCell className="font-medium">
                      {formatDate(statement.periodStart)} - {formatDate(statement.periodEnd)}
                    </TableCell>
                    <TableCell>
                      {statement.paidAt ? formatDate(statement.paidAt) : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {statement.checkNumber || "-"}
                    </TableCell>
                    {!isRep && (
                      <TableCell className="text-green-600 dark:text-green-400">
                        {formatCurrency(statement.grossCommission)}
                      </TableCell>
                    )}
                    <TableCell className="text-red-600 dark:text-red-400">
                      -{formatCurrency(statement.deductionsTotal)}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {formatCurrency(statement.netPay)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <StatementDetailsDialog statementId={statement.id} isRep={isRep} />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => downloadPdf(statement.id)}
                          data-testid={`button-download-pdf-${statement.id}`}
                          title="Download PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => downloadExcel(statement.id)}
                          data-testid={`button-download-excel-${statement.id}`}
                          title="Download Excel"
                        >
                          <FileText className="h-4 w-4" />
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
