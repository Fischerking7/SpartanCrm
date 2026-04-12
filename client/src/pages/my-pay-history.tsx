import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { FileText, Calendar, Eye, Wallet, Receipt, ArrowDownCircle, ArrowUpCircle, MinusCircle, Download, Shield, ChevronDown, MessageSquare } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ComposeDialog } from "./messages";

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

function formatCurrency(amount: string | number, locale = "en-US") {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit" }).format(new Date(date));
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

function ReserveSummarySection({ data, locale = "en-US" }: { data: PayStatementDetails; locale?: string }) {
  const { t } = useTranslation();
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
          {t("payHistory.rollingReserveStatus")}
        </h3>
        <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-4 space-y-2 text-sm">
          {previousBalance !== null && (
            <div className="flex items-center justify-between" data-testid="reserve-previous-balance">
              <span className="text-muted-foreground">{t("payHistory.previousBalance")}</span>
              <span className="font-medium">{formatCurrency(previousBalance, locale)}</span>
            </div>
          )}
          {withheldThisPeriod > 0 && (
            <div className="flex items-center justify-between" data-testid="reserve-withheld-period">
              <span className="text-muted-foreground">{t("payHistory.withheldThisPeriod")}</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">+{formatCurrency(withheldThisPeriod, locale)}</span>
            </div>
          )}
          {chargebacksOffset > 0 && (
            <div className="flex items-center justify-between" data-testid="reserve-chargebacks-offset">
              <span className="text-muted-foreground">{t("payHistory.chargebacksOffset")}</span>
              <span className="font-medium text-red-600 dark:text-red-400">-{formatCurrency(chargebacksOffset, locale)}</span>
            </div>
          )}
          {currentBalance !== null && (
            <>
              <Separator />
              <div className="flex items-center justify-between" data-testid="reserve-current-balance">
                <span className="font-semibold">{t("payHistory.currentBalance")}</span>
                <span className="font-bold">{formatCurrency(currentBalance, locale)} / {formatCurrency(cap, locale)} {t("payHistory.cap")}</span>
              </div>
              <div className="flex items-center justify-between" data-testid="reserve-status">
                <span className="text-muted-foreground">{t("payHistory.status")}</span>
                <Badge variant="outline" className="text-xs">{statusLabel}</Badge>
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground mt-2 italic">
            {t("payHistory.rollingReserveNote")}
          </p>
        </div>
      </div>
    </>
  );
}

function StatementDetailsDialog({ statementId, isRep = false, locale = "en-US" }: { statementId: string; isRep?: boolean; locale?: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const fc = (amt: string | number) => formatCurrency(amt, locale);
  const fd = (date: string) => formatDate(date, locale);

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
            {t("payHistory.payStatementDetails")}
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
                <p className="text-muted-foreground">{t("payHistory.payPeriod")}</p>
                <p className="font-medium">{fd(data.periodStart)} - {fd(data.periodEnd)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t("payHistory.status")}</p>
                <Badge variant={data.status === "PAID" ? "default" : data.status === "FINALIZED" ? "secondary" : "outline"}>
                  {data.status}
                </Badge>
              </div>
              {data.stubNumber && (
                <div data-testid="text-stub-number">
                  <p className="text-muted-foreground">{t("payHistory.stubNumber")}</p>
                  <p className="font-medium font-mono text-xs">{data.stubNumber}</p>
                </div>
              )}
              {data.repEmail && (
                <div data-testid="text-rep-email">
                  <p className="text-muted-foreground">{t("payHistory.email")}</p>
                  <p className="font-medium text-xs">{data.repEmail}</p>
                </div>
              )}
              {data.paidAt && (
                <div>
                  <p className="text-muted-foreground">{t("payHistory.paidOn")}</p>
                  <p className="font-medium">{fd(data.paidAt)}</p>
                </div>
              )}
              {data.checkNumber && (
                <div>
                  <p className="text-muted-foreground">{t("payHistory.checkNumber")}</p>
                  <p className="font-medium">{data.checkNumber}</p>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="font-semibold">{t("payHistory.earnings")}</h3>
              {isRep ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">{t("payHistory.netCommission")}</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{fc(data.netPay)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("payHistory.chargebacks")}</p>
                    <p className="font-medium text-red-600 dark:text-red-400">-{fc(data.chargebacksTotal)}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">{t("payHistory.baseCommission")}</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{fc(data.grossCommission)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("payHistory.overrideEarnings")}</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{fc(data.overrideEarnings)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("payHistory.incentives")}</p>
                    <p className="font-medium text-green-600 dark:text-green-400">{fc(data.incentivesTotal)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("payHistory.chargebacks")}</p>
                    <p className="font-medium text-red-600 dark:text-red-400">-{fc(data.chargebacksTotal)}</p>
                  </div>
                </div>
              )}
            </div>

            {commissionItems.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-semibold">{t("payHistory.commissionLineItems")}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("payHistory.description")}</TableHead>
                        <TableHead className="text-right">{t("payHistory.gross")}</TableHead>
                        {hasPerOrderNet && (
                          <>
                            <TableHead className="text-right">{t("payHistory.reserve")}</TableHead>
                            <TableHead className="text-right">{t("payHistory.net")}</TableHead>
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
                              {fc(item.amount)}
                            </TableCell>
                            {hasPerOrderNet && (
                              <>
                                <TableCell className="text-right text-amber-600 dark:text-amber-400 text-sm">
                                  {withheld > 0 ? `-${fc(withheld)}` : "—"}
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  {fc(net)}
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
                  <h3 className="font-semibold">{t("payHistory.otherEarnings")}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("payHistory.type")}</TableHead>
                        <TableHead>{t("payHistory.description")}</TableHead>
                        <TableHead className="text-right">{t("payHistory.amount")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overrideItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><Badge variant="outline" className="text-xs">{t("payHistory.override")}</Badge></TableCell>
                          <TableCell className="text-sm">{item.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {fc(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {bonusItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><Badge variant="outline" className="text-xs">{t("payHistory.bonus")}</Badge></TableCell>
                          <TableCell className="text-sm">{item.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {fc(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {incentiveItems.map((item) => (
                        <TableRow key={item.id} data-testid={`row-incentive-${item.id}`}>
                          <TableCell><Badge variant="outline" className="text-xs">{t("payHistory.incentive")}</Badge></TableCell>
                          <TableCell className="text-sm">{item.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {fc(item.amount)}
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
                  <h3 className="font-semibold">{t("payHistory.chargebacks")}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("payHistory.description")}</TableHead>
                        <TableHead>{t("payHistory.source")}</TableHead>
                        <TableHead className="text-right">{t("payHistory.amount")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chargebackItems.map((item) => {
                        let sourceLabel = t("payHistory.netPaySource");
                        let sourceBadgeVariant: "destructive" | "outline" | "secondary" = "destructive";
                        if (item.chargebackSource === "FROM_RESERVE") {
                          sourceLabel = t("payHistory.fromReserve");
                          sourceBadgeVariant = "secondary";
                        } else if (item.chargebackSource === "FROM_NET_PAY") {
                          sourceLabel = t("payHistory.fromNetPay");
                          sourceBadgeVariant = "destructive";
                        } else if (item.chargebackSource === "SPLIT") {
                          const fromRes = (item.chargebackFromReserveCents || 0) / 100;
                          const fromNet = (item.chargebackFromNetPayCents || 0) / 100;
                          sourceLabel = `${t("payHistory.fromReserve")}: ${fc(fromRes)} / ${t("payHistory.fromNetPay")}: ${fc(fromNet)}`;
                          sourceBadgeVariant = "outline";
                        }
                        return (
                          <TableRow key={item.id} data-testid={`row-chargeback-${item.id}`}>
                            <TableCell className="text-sm">
                              {item.description?.replace(/ \(.*\)$/, '') || t("payHistory.chargebackDefault")}
                            </TableCell>
                            <TableCell>
                              <Badge variant={sourceBadgeVariant} className="text-xs" data-testid={`badge-chargeback-source-${item.id}`}>
                                {sourceLabel}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                              {fc(item.amount)}
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
                  <h3 className="font-semibold">{t("payHistory.deductions")}</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("payHistory.type")}</TableHead>
                        <TableHead className="text-right">{t("payHistory.amount")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.deductions.map((ded) => (
                        <TableRow key={ded.id}>
                          <TableCell className="text-sm">{ded.deductionTypeName}</TableCell>
                          <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                            -{fc(ded.amount)}
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
                    {t("payHistory.carryForwardBalance")}
                  </h3>
                  {carryForwardDeductions.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm" data-testid={`row-cf-deduction-${item.id}`}>
                      <span className="text-muted-foreground">{item.description}</span>
                      <span className="font-medium text-red-600 dark:text-red-400">{fc(item.amount)}</span>
                    </div>
                  ))}
                  {carryForwardCredits.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm" data-testid={`row-cf-credit-${item.id}`}>
                      <span className="text-muted-foreground">{item.description}</span>
                      <Badge variant="outline" className="text-xs text-orange-600">{fc(item.amount)} {t("payHistory.owed")}</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}

            <ReserveSummarySection data={data} locale={locale} />

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-semibold">{t("payHistory.thisPeriod")}</h3>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("payHistory.deductions")}</span>
                  <span className="text-red-600 dark:text-red-400">-{fc(data.deductionsTotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("payHistory.advancesRepayment")}</span>
                  <span className="text-red-600 dark:text-red-400">-{fc(data.advancesRepayment)}</span>
                </div>
                <div className="flex items-center justify-between" data-testid="tax-withheld-label">
                  <span className="text-muted-foreground">{t("payHistory.taxWithheld")}</span>
                  <span className="text-muted-foreground text-sm italic">{t("payHistory.taxNotApplicable")}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-semibold">{t("payHistory.netPay")}</span>
                  <span className="font-bold text-lg">{fc(data.netPay)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">{t("payHistory.yearToDate")}</h3>
                {!isRep && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("payHistory.ytdGross")}</span>
                    <span>{fc(data.ytdGross)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("payHistory.ytdDeductions")}</span>
                  <span className="text-red-600 dark:text-red-400">-{fc(data.ytdDeductions)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-semibold">{t("payHistory.ytdNet")}</span>
                  <span className="font-bold">{fc(data.ytdNet)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{t("payHistory.failedToLoadStatement")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function MyPayHistory() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  const fc = (amt: string | number) => formatCurrency(amt, locale);
  const fd = (date: string) => formatDate(date, locale);
  const isRep = user?.role === "REP";
  const isMobile = useIsMobile();
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [payInquiryOpen, setPayInquiryOpen] = useState(false);
  const [payInquiryContext, setPayInquiryContext] = useState<{ subject: string; body: string; entityType?: string; entityId?: string } | null>(null);
  const toggleCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
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
        <h1 className="text-xl md:text-2xl font-semibold" data-testid="text-page-title">{t("payHistory.title")}</h1>
        <p className="text-muted-foreground">{t("payHistory.ytdSummary")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">{isRep ? t("payHistory.ytdNet") : t("payHistory.ytdGross")}</CardTitle>
            <ArrowUpCircle className="h-4 w-4 text-green-500 shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-ytd-gross">
              {fc(isRep ? (ytdData?.ytdNet || 0) : (ytdData?.ytdGross || 0))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">{t("payHistory.deductions")}</CardTitle>
            <ArrowDownCircle className="h-4 w-4 text-red-500 shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-ytd-deductions">
              -{fc(ytdData?.ytdDeductions || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">{t("payHistory.netPay")}</CardTitle>
            <Wallet className="h-4 w-4 text-primary shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold" data-testid="text-ytd-net">
              {fc(ytdData?.ytdNet || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium">{t("payHistory.payPeriods")}</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0 hidden md:block" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <p className="text-base md:text-2xl font-bold" data-testid="text-statements-count">
              {ytdData?.statementsCount || 0}
            </p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">{t("payHistory.thisYear")}</p>
          </CardContent>
        </Card>
      </div>

      {pendingStatements.length > 0 && (
        <Card>
          <CardHeader className="px-3 pt-3 md:px-6 md:pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <MinusCircle className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
              {t("payHistory.pendingPayments")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            {isMobile ? (
              <div className="space-y-3">
                {pendingStatements.map((statement) => {
                  const isExpanded = expandedCards.has(`pending-${statement.id}`);
                  return (
                    <div key={statement.id} className="border rounded-lg overflow-hidden" data-testid={`card-pending-${statement.id}`}>
                      <button
                        className="w-full p-3 text-left flex items-center justify-between gap-2"
                        onClick={() => toggleCard(`pending-${statement.id}`)}
                        data-testid={`button-expand-pending-${statement.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {fd(statement.periodStart)} - {fd(statement.periodEnd)}
                            </span>
                            <Badge variant="outline" className="text-[10px]">{statement.status}</Badge>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-sm text-muted-foreground">{t("payHistory.netPay")}</span>
                            <span className="text-lg font-bold">{fc(statement.netPay)}</span>
                          </div>
                        </div>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t pt-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{t("payHistory.deductions")}</span>
                            <span className="text-red-600 dark:text-red-400">-{fc(statement.deductionsTotal)}</span>
                          </div>
                          {!isRep && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{t("payHistory.gross")}</span>
                              <span className="text-green-600 dark:text-green-400">{fc(statement.grossCommission)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-2 pt-1 border-t">
                            <StatementDetailsDialog statementId={statement.id} isRep={isRep} locale={locale} />
                            <div className="flex items-center gap-1">
                              {isRep && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-9"
                                  onClick={() => {
                                    setPayInquiryContext({
                                      subject: t("payHistory.payStatementInquirySubject", { start: fd(statement.periodStart), end: fd(statement.periodEnd) }),
                                      body: t("payHistory.payStatementInquiryBody", { start: fd(statement.periodStart), end: fd(statement.periodEnd), amount: fc(statement.netPay) }),
                                      entityType: "PAY_STATEMENT",
                                      entityId: statement.id,
                                    });
                                    setPayInquiryOpen(true);
                                  }}
                                  data-testid={`button-pay-inquiry-${statement.id}`}
                                >
                                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                                  {t("payHistory.ask")}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9"
                                onClick={() => downloadPdf(statement.id)}
                                data-testid={`button-download-pdf-${statement.id}`}
                              >
                                <Download className="h-3.5 w-3.5 mr-1" />
                                PDF
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("payHistory.payPeriod")}</TableHead>
                    {!isRep && <TableHead>{t("payHistory.gross")}</TableHead>}
                    <TableHead>{t("payHistory.deductions")}</TableHead>
                    <TableHead>{t("payHistory.netPay")}</TableHead>
                    <TableHead>{t("payHistory.status")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingStatements.map((statement) => (
                    <TableRow key={statement.id}>
                      <TableCell className="font-medium">
                        {fd(statement.periodStart)} - {fd(statement.periodEnd)}
                      </TableCell>
                      {!isRep && (
                        <TableCell className="text-green-600 dark:text-green-400">
                          {fc(statement.grossCommission)}
                        </TableCell>
                      )}
                      <TableCell className="text-red-600 dark:text-red-400">
                        -{fc(statement.deductionsTotal)}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {fc(statement.netPay)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{statement.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <StatementDetailsDialog statementId={statement.id} isRep={isRep} locale={locale} />
                          {isRep && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setPayInquiryContext({
                                  subject: t("payHistory.payStatementInquirySubject", { start: fd(statement.periodStart), end: fd(statement.periodEnd) }),
                                  body: t("payHistory.payStatementInquiryBody", { start: fd(statement.periodStart), end: fd(statement.periodEnd), amount: fc(statement.netPay) }),
                                  entityType: "PAY_STATEMENT",
                                  entityId: statement.id,
                                });
                                setPayInquiryOpen(true);
                              }}
                              data-testid={`button-pay-inquiry-${statement.id}`}
                              title={t("payHistory.askAboutThis")}
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                          )}
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => downloadPdf(statement.id)}
                            data-testid={`button-download-pdf-${statement.id}`}
                            title={t("payHistory.downloadPdf")}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => downloadExcel(statement.id)}
                            data-testid={`button-download-excel-${statement.id}`}
                            title={t("payHistory.downloadExcel")}
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
            {t("payHistory.paidStatements")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
          {paidStatements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("payHistory.noStatements")}</p>
            </div>
          ) : isMobile ? (
            <div className="space-y-3">
              {paidStatements.map((statement) => {
                const isExpanded = expandedCards.has(`paid-${statement.id}`);
                return (
                  <div key={statement.id} className="border rounded-lg overflow-hidden" data-testid={`card-paid-${statement.id}`}>
                    <button
                      className="w-full p-3 text-left flex items-center justify-between gap-2"
                      onClick={() => toggleCard(`paid-${statement.id}`)}
                      data-testid={`button-expand-paid-${statement.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            {fd(statement.periodStart)} - {fd(statement.periodEnd)}
                          </span>
                          {statement.paidAt && (
                            <span className="text-[10px] text-muted-foreground">
                              {t("payHistory.paidOn")} {fd(statement.paidAt)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-sm text-muted-foreground">{t("payHistory.netPay")}</span>
                          <span className="text-lg font-bold">{fc(statement.netPay)}</span>
                        </div>
                      </div>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2 border-t pt-2">
                        {!isRep && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{t("payHistory.gross")}</span>
                            <span className="text-green-600 dark:text-green-400">{fc(statement.grossCommission)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t("payHistory.deductions")}</span>
                          <span className="text-red-600 dark:text-red-400">-{fc(statement.deductionsTotal)}</span>
                        </div>
                        {statement.checkNumber && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{t("payHistory.checkNumber")}</span>
                            <span className="font-mono">{statement.checkNumber}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t">
                          <StatementDetailsDialog statementId={statement.id} isRep={isRep} locale={locale} />
                          <div className="flex items-center gap-1">
                            {isRep && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-9"
                                onClick={() => {
                                  setPayInquiryContext({
                                    subject: t("payHistory.payStatementInquirySubject", { start: fd(statement.periodStart), end: fd(statement.periodEnd) }),
                                    body: t("payHistory.payStatementInquiryBody", { start: fd(statement.periodStart), end: fd(statement.periodEnd), amount: fc(statement.netPay) }),
                                    entityType: "PAY_STATEMENT",
                                    entityId: statement.id,
                                  });
                                  setPayInquiryOpen(true);
                                }}
                                data-testid={`button-pay-inquiry-${statement.id}`}
                              >
                                <MessageSquare className="h-3.5 w-3.5 mr-1" />
                                {t("payHistory.ask")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9"
                              onClick={() => downloadPdf(statement.id)}
                              data-testid={`button-download-pdf-${statement.id}`}
                            >
                              <Download className="h-3.5 w-3.5 mr-1" />
                              PDF
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("payHistory.payPeriod")}</TableHead>
                  <TableHead>{t("payHistory.paidOn")}</TableHead>
                  <TableHead>{t("payHistory.checkNumber")}</TableHead>
                  {!isRep && <TableHead>{t("payHistory.gross")}</TableHead>}
                  <TableHead>{t("payHistory.deductions")}</TableHead>
                  <TableHead>{t("payHistory.netPay")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paidStatements.map((statement) => (
                  <TableRow key={statement.id}>
                    <TableCell className="font-medium">
                      {fd(statement.periodStart)} - {fd(statement.periodEnd)}
                    </TableCell>
                    <TableCell>
                      {statement.paidAt ? fd(statement.paidAt) : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {statement.checkNumber || "-"}
                    </TableCell>
                    {!isRep && (
                      <TableCell className="text-green-600 dark:text-green-400">
                        {fc(statement.grossCommission)}
                      </TableCell>
                    )}
                    <TableCell className="text-red-600 dark:text-red-400">
                      -{fc(statement.deductionsTotal)}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {fc(statement.netPay)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <StatementDetailsDialog statementId={statement.id} isRep={isRep} locale={locale} />
                        {isRep && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setPayInquiryContext({
                                subject: t("payHistory.payStatementInquirySubject", { start: fd(statement.periodStart), end: fd(statement.periodEnd) }),
                                body: t("payHistory.payStatementInquiryBody", { start: fd(statement.periodStart), end: fd(statement.periodEnd), amount: fc(statement.netPay) }),
                                entityType: "PAY_STATEMENT",
                                entityId: statement.id,
                              });
                              setPayInquiryOpen(true);
                            }}
                            data-testid={`button-pay-inquiry-${statement.id}`}
                            title={t("payHistory.askAboutThis")}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => downloadPdf(statement.id)}
                          data-testid={`button-download-pdf-${statement.id}`}
                          title={t("payHistory.downloadPdf")}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => downloadExcel(statement.id)}
                          data-testid={`button-download-excel-${statement.id}`}
                          title={t("payHistory.downloadExcel")}
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

      <ComposeDialog
        open={payInquiryOpen}
        onOpenChange={(open) => { setPayInquiryOpen(open); if (!open) setPayInquiryContext(null); }}
        defaultCategory="PAY_QUESTION"
        defaultSubject={payInquiryContext?.subject || t("payHistory.payStatementQuestion")}
        defaultBody={payInquiryContext?.body || ""}
        defaultToUserId={user?.assignedSupervisorId || undefined}
        relatedEntityType={payInquiryContext?.entityType}
        relatedEntityId={payInquiryContext?.entityId}
      />
    </div>
  );
}
