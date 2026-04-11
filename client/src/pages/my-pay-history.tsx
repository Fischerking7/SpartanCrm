import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { FileText, Calendar, Eye, Wallet, Receipt, ArrowDownCircle, ArrowUpCircle, MinusCircle, Download, Shield } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";

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
  reserveWithheldTotal?: string;
  reserveBalanceAfter?: string;
  reservePreviousBalance?: string;
  reserveChargebacksOffset?: string;
  reserveCapAmount?: string;
  reserveStatusLabel?: string;
  createdAt: string;
}

interface PayStatementLineItem {
  id: string;
  payStatementId: string;
  salesOrderId: string | null;
  category: string;
  type: string;
  description: string;
  amount: string;
  netAmount: string | null;
  reserveWithheldForOrder: string | null;
  chargebackSource: string | null;
  chargebackFromReserveCents: number | null;
  chargebackFromNetPayCents: number | null;
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
  stubNumber?: string;
  repEmail?: string;
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

function ReserveSummarySection({ data }: { data: PayStatementDetails }) {
  const hasReserveData = (data.reserveWithheldTotal && parseFloat(data.reserveWithheldTotal) > 0) ||
    (data.reservePreviousBalance && parseFloat(data.reservePreviousBalance) > 0) ||
    (data.reserveChargebacksOffset && parseFloat(data.reserveChargebacksOffset) > 0);

  if (!hasReserveData) return null;

  const previousBalance = data.reservePreviousBalance ? parseFloat(data.reservePreviousBalance) : null;
  const withheldThisPeriod = data.reserveWithheldTotal ? parseFloat(data.reserveWithheldTotal) : 0;
  const chargebacksOffset = data.reserveChargebacksOffset ? parseFloat(data.reserveChargebacksOffset) : 0;
  const currentBalance = data.reserveBalanceAfter ? parseFloat(data.reserveBalanceAfter) : null;
  const cap = data.reserveCapAmount ? parseFloat(data.reserveCapAmount) : 2500;
  const statusLabel = data.reserveStatusLabel || "ACTIVE";

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-amber-500" />
          Rolling Reserve Status
        </h3>
        <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-4 space-y-2 text-sm">
          {previousBalance !== null && (
            <div className="flex items-center justify-between" data-testid="reserve-previous-balance">
              <span className="text-muted-foreground">Previous Balance</span>
              <span className="font-medium">{formatCurrency(previousBalance)}</span>
            </div>
          )}
          {withheldThisPeriod > 0 && (
            <div className="flex items-center justify-between" data-testid="reserve-withheld-period">
              <span className="text-muted-foreground">Withheld This Period</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">+{formatCurrency(withheldThisPeriod)}</span>
            </div>
          )}
          {chargebacksOffset > 0 && (
            <div className="flex items-center justify-between" data-testid="reserve-chargebacks-offset">
              <span className="text-muted-foreground">Chargebacks Offset</span>
              <span className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(chargebacksOffset)}</span>
            </div>
          )}
          {currentBalance !== null && (
            <>
              <Separator />
              <div className="flex items-center justify-between" data-testid="reserve-current-balance">
                <span className="font-semibold">Current Balance</span>
                <span className="font-bold">{formatCurrency(currentBalance)} / {formatCurrency(cap)} cap</span>
              </div>
              <div className="flex items-center justify-between" data-testid="reserve-status">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="outline" className="text-xs">{statusLabel}</Badge>
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground mt-2 italic">
            The rolling reserve is not wages. It is a conditional holdback per your Independent Contractor Agreement.
          </p>
        </div>
      </div>
    </>
  );
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

  const commissionItems = data?.lineItems.filter(li => li.category === "COMMISSION") || [];
  const overrideItems = data?.lineItems.filter(li => li.category === "OVERRIDE") || [];
  const bonusItems = data?.lineItems.filter(li => li.category === "BONUS") || [];
  const incentiveItems = data?.lineItems.filter(li => li.category === "INCENTIVE") || [];
  const chargebackItems = data?.lineItems.filter(li => li.category === "CHARGEBACK") || [];
  const reserveItems = data?.lineItems.filter(li => li.category === "Reserve Withholding") || [];
  const carryForwardDeductions = data?.lineItems.filter(li => li.category === "CARRY_FORWARD_DEDUCTION") || [];
  const carryForwardCredits = data?.lineItems.filter(li => li.category === "CARRY_FORWARD_CREDIT") || [];
  const hasPerOrderNet = commissionItems.some(li => li.netAmount !== null);

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
              {data.stubNumber && (
                <div data-testid="text-stub-number">
                  <p className="text-muted-foreground">Stub #</p>
                  <p className="font-medium font-mono text-xs">{data.stubNumber}</p>
                </div>
              )}
              {data.repEmail && (
                <div data-testid="text-rep-email">
                  <p className="text-muted-foreground">Email</p>
                  <p className="font-medium text-xs">{data.repEmail}</p>
                </div>
              )}
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

            {commissionItems.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold">Commission Line Items</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        {hasPerOrderNet && (
                          <>
                            <TableHead className="text-right">Reserve</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionItems.map((item) => {
                        const withheld = item.reserveWithheldForOrder ? parseFloat(item.reserveWithheldForOrder) : 0;
                        const net = item.netAmount ? parseFloat(item.netAmount) : parseFloat(item.amount);
                        return (
                          <TableRow key={item.id} data-testid={`row-commission-${item.id}`}>
                            <TableCell className="text-sm">{item.description}</TableCell>
                            <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                              {formatCurrency(item.amount)}
                            </TableCell>
                            {hasPerOrderNet && (
                              <>
                                <TableCell className="text-right text-amber-600 dark:text-amber-400 text-sm">
                                  {withheld > 0 ? `-${formatCurrency(withheld)}` : "—"}
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  {formatCurrency(net)}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {(overrideItems.length > 0 || bonusItems.length > 0 || incentiveItems.length > 0) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold">Other Earnings</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overrideItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><Badge variant="outline" className="text-xs">Override</Badge></TableCell>
                          <TableCell className="text-sm">{item.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {formatCurrency(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {bonusItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><Badge variant="outline" className="text-xs">Bonus</Badge></TableCell>
                          <TableCell className="text-sm">{item.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {formatCurrency(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {incentiveItems.map((item) => (
                        <TableRow key={item.id} data-testid={`row-incentive-${item.id}`}>
                          <TableCell><Badge variant="outline" className="text-xs">Incentive</Badge></TableCell>
                          <TableCell className="text-sm">{item.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {formatCurrency(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {chargebackItems.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold">Chargebacks</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chargebackItems.map((item) => {
                        let sourceLabel = "Net Pay";
                        let sourceBadgeVariant: "destructive" | "outline" | "secondary" = "destructive";
                        if (item.chargebackSource === "FROM_RESERVE") {
                          sourceLabel = "From Reserve";
                          sourceBadgeVariant = "secondary";
                        } else if (item.chargebackSource === "FROM_NET_PAY") {
                          sourceLabel = "From Net Pay";
                          sourceBadgeVariant = "destructive";
                        } else if (item.chargebackSource === "SPLIT") {
                          const fromRes = (item.chargebackFromReserveCents || 0) / 100;
                          const fromNet = (item.chargebackFromNetPayCents || 0) / 100;
                          sourceLabel = `Reserve: ${formatCurrency(fromRes)} / Net: ${formatCurrency(fromNet)}`;
                          sourceBadgeVariant = "outline";
                        }
                        return (
                          <TableRow key={item.id} data-testid={`row-chargeback-${item.id}`}>
                            <TableCell className="text-sm">
                              {item.description?.replace(/ \(.*\)$/, '') || "Chargeback"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={sourceBadgeVariant} className="text-xs" data-testid={`badge-chargeback-source-${item.id}`}>
                                {sourceLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                              {formatCurrency(item.amount)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
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

            {(carryForwardDeductions.length > 0 || carryForwardCredits.length > 0) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold flex items-center gap-2">
                    <ArrowDownCircle className="h-4 w-4 text-orange-500" />
                    Carry-Forward Balance
                  </h3>
                  {carryForwardDeductions.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm" data-testid={`row-cf-deduction-${item.id}`}>
                      <span className="text-muted-foreground">{item.description}</span>
                      <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                  {carryForwardCredits.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm" data-testid={`row-cf-credit-${item.id}`}>
                      <span className="text-muted-foreground">{item.description}</span>
                      <Badge variant="outline" className="text-xs text-orange-600">{formatCurrency(item.amount)} owed</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}

            <ReserveSummarySection data={data} />

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
                <div className="flex items-center justify-between" data-testid="tax-withheld-label">
                  <span className="text-muted-foreground">Tax Withheld</span>
                  <span className="text-muted-foreground text-sm italic">N/A — 1099 Contractor</span>
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
  const isMobile = useIsMobile();
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
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <Skeleton className="h-24 md:h-32" />
          <Skeleton className="h-24 md:h-32" />
          <Skeleton className="h-24 md:h-32" />
          <Skeleton className="h-24 md:h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const recentStatements = statements || [];
  const paidStatements = recentStatements.filter(s => s.status === "PAID");
  const pendingStatements = recentStatements.filter(s => s.status !== "PAID");

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold" data-testid="text-page-title">My Pay History</h1>
        <p className="text-muted-foreground">View your pay statements and year-to-date earnings</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">{isRep ? "YTD Net" : "YTD Gross"}</CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-green-500 shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-ytd-gross">
              {formatCurrency(isRep ? (ytdData?.ytdNet || 0) : (ytdData?.ytdGross || 0))}
            </p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">{isRep ? "After overrides" : "Before deductions"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">Deductions</CardTitle>
            <ArrowDownCircle className="h-4 w-4 text-red-500 shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-ytd-deductions">
              -{formatCurrency(ytdData?.ytdDeductions || 0)}
            </p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">Total withheld</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">Net Pay</CardTitle>
            <Wallet className="h-4 w-4 text-primary shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold" data-testid="text-ytd-net">
              {formatCurrency(ytdData?.ytdNet || 0)}
            </p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">Take-home</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">Pay Periods</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold" data-testid="text-statements-count">
              {ytdData?.statementsCount || 0}
            </p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">This year</p>
          </CardContent>
        </Card>
      </div>

      {pendingStatements.length > 0 && (
        <Card>
          <CardHeader className="px-3 pt-3 md:px-6 md:pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <MinusCircle className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
              Pending Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            {isMobile ? (
              <div className="space-y-3">
                {pendingStatements.map((statement) => (
                  <div key={statement.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-pending-${statement.id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(statement.periodStart)} - {formatDate(statement.periodEnd)}
                      </span>
                      <Badge variant="outline" className="text-[10px]">{statement.status}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Net Pay</span>
                      <span className="text-lg font-bold">{formatCurrency(statement.netPay)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t">
                      <div className="flex items-center gap-1">
                        <StatementDetailsDialog statementId={statement.id} isRep={isRep} />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => downloadPdf(statement.id)}
                        data-testid={`button-download-pdf-${statement.id}`}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        PDF
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
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
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="px-3 pt-3 md:px-6 md:pt-6 pb-2">
          <CardTitle className="flex items-center gap-2 text-base md:text-lg">
            <FileText className="h-4 w-4 md:h-5 md:w-5" />
            Payment History
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
          {paidStatements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No paid statements yet</p>
              <p className="text-sm">Your payment history will appear here once you receive payments</p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {paidStatements.map((statement) => (
                <div key={statement.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-paid-${statement.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(statement.periodStart)} - {formatDate(statement.periodEnd)}
                    </span>
                    {statement.paidAt && (
                      <span className="text-[10px] text-muted-foreground">
                        Paid {formatDate(statement.paidAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Net Pay</span>
                    <span className="text-lg font-bold">{formatCurrency(statement.netPay)}</span>
                  </div>
                  {!isRep && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Gross</span>
                      <span className="text-green-600 dark:text-green-400">{formatCurrency(statement.grossCommission)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t">
                    <div className="flex items-center gap-1">
                      <StatementDetailsDialog statementId={statement.id} isRep={isRep} />
                      {statement.checkNumber && (
                        <span className="text-[10px] font-mono text-muted-foreground">#{statement.checkNumber}</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => downloadPdf(statement.id)}
                      data-testid={`button-download-pdf-${statement.id}`}
                    >
                      <Download className="h-3.5 w-3.5 mr-1" />
                      PDF
                    </Button>
                  </div>
                </div>
              ))}
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
