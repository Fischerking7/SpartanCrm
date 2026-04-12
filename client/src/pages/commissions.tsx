import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Users, FileText, Calendar, CalendarDays, Wifi, Smartphone, Tv, Clock, Target, MessageSquare } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ComposeDialog } from "./messages";

interface ServiceBreakdown {
  internet: number;
  mobile: number;
  video: number;
}

interface OwnCommission {
  id: string;
  dateSold: string;
  customerName: string;
  accountNumber: string;
  baseCommission: number;
  incentive: number;
  total: number;
  serviceBreakdown: ServiceBreakdown;
}

interface OverrideEarning {
  id: string;
  salesOrderId: string;
  sourceRepId: string;
  sourceLevelUsed: string;
  amount: number;
  dateSold: string;
  customerName: string;
}

interface ChartDataPoint {
  day: string;
  amount: number;
}

interface CommissionsData {
  role: string;
  ownSoldCommissions: OwnCommission[];
  ownTotalConnected: number;
  ownTotalEarned: number;
  serviceTotals: ServiceBreakdown;
  weeklyEarned: number;
  mtdEarned: number;
  pendingWeekly: number;
  pendingMtd: number;
  rollingAverage30Days: number;
  weeklyChartData: ChartDataPoint[];
  mtdChartData: ChartDataPoint[];
  overrideEarnings: OverrideEarning[] | null;
  overrideTotalEarned: number | null;
  grandTotal: number;
}

export default function Commissions() {
  const { user } = useAuth();
  const [execViewMode, setExecViewMode] = useState<"own" | "team" | "global">("own");
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryContext, setInquiryContext] = useState<{ subject: string; body: string; entityType?: string; entityId?: string } | null>(null);
  const isExecutive = user?.role === "EXECUTIVE";
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";

  const { data, isLoading } = useQuery<CommissionsData>({
    queryKey: ["/api/commissions", isExecutive ? execViewMode : null],
    queryFn: async () => {
      const url = isExecutive ? `/api/commissions?viewMode=${execViewMode}` : "/api/commissions";
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch commissions");
      return res.json();
    },
  });

  const isMobile = useIsMobile();
  const isRep = user?.role === "REP";
  const canSeeOverrides = ["EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user?.role || "");
  const formatCurrency = (amount: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount);

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        <Skeleton className="h-7 w-48 md:h-8 md:w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <Skeleton className="h-24 md:h-32" />
          <Skeleton className="h-24 md:h-32" />
          <Skeleton className="h-24 md:h-32" />
          <Skeleton className="h-24 md:h-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <Skeleton className="h-48 md:h-64" />
          <Skeleton className="h-48 md:h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold" data-testid="text-page-title">
            {isRep ? t("commissions.title") : isExecutive ? (execViewMode === "own" ? t("commissions.title") : execViewMode === "team" ? t("commissions.teamCommissions") : t("commissions.globalCommissions")) : t("commissions.commissionsOverview")}
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            {t("commissions.trackEarnings")}
          </p>
        </div>
        {isExecutive && (
          <div className="flex items-center gap-1 border rounded-md p-1" data-testid="exec-view-toggle">
            <Button
              size="sm"
              variant={execViewMode === "own" ? "default" : "ghost"}
              onClick={() => setExecViewMode("own")}
              data-testid="button-view-own"
            >
              {t("commissions.mySales")}
            </Button>
            <Button
              size="sm"
              variant={execViewMode === "team" ? "default" : "ghost"}
              onClick={() => setExecViewMode("team")}
              data-testid="button-view-team"
            >
              {t("commissions.myTeam")}
            </Button>
            <Button
              size="sm"
              variant={execViewMode === "global" ? "default" : "ghost"}
              onClick={() => setExecViewMode("global")}
              data-testid="button-view-global"
            >
              {t("commissions.global")}
            </Button>
          </div>
        )}
      </div>

      {isRep && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          <Card>
            <CardHeader className="pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-base font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                {t("commissions.pendingOrders")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.thisWeek")}</p>
                  <p className="text-lg md:text-xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-pending-weekly">
                    {formatCurrency(data?.pendingWeekly || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.monthToDate")}</p>
                  <p className="text-lg md:text-xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-pending-mtd">
                    {formatCurrency(data?.pendingMtd || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-base font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-500" />
                {t("commissions.connectedOrders")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.thisWeek")}</p>
                  <p className="text-lg md:text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-connected-weekly">
                    {formatCurrency(data?.weeklyEarned || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.monthToDate")}</p>
                  <p className="text-lg md:text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-connected-mtd">
                    {formatCurrency(data?.mtdEarned || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isRep && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-500" />
              {t("commissions.thirtyDayAverage")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="text-lg md:text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-30-day-avg">
              {formatCurrency(data?.rollingAverage30Days || 0)}
            </div>
            <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.dailyAverage30Days")}</p>
          </CardContent>
        </Card>
      )}

      <div className={`grid grid-cols-2 gap-3 md:gap-4 ${isRep ? "md:grid-cols-4" : "md:grid-cols-5"}`}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{t("commissions.totalConnected")}</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="text-lg md:text-2xl font-bold" data-testid="text-total-connected">
              {data?.ownTotalConnected || 0}
            </div>
            <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.approvedOrders")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{t("commissions.earned")}</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="text-lg md:text-2xl font-bold" data-testid="text-own-earned">
              {formatCurrency(data?.ownTotalEarned || 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{t("commissions.weekly")}</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="text-lg md:text-2xl font-bold" data-testid="text-weekly-earned">
              {formatCurrency(data?.weeklyEarned || 0)}
            </div>
            <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.thisWeek")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{t("commissions.mtd")}</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="text-lg md:text-2xl font-bold" data-testid="text-mtd-earned">
              {formatCurrency(data?.mtdEarned || 0)}
            </div>
            <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.monthToDate")}</p>
          </CardContent>
        </Card>

        {canSeeOverrides && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{t("commissions.overrides")}</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <div className="text-lg md:text-2xl font-bold" data-testid="text-override-earned">
                {formatCurrency(data?.overrideTotalEarned || 0)}
              </div>
              <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.fromTeamSales")}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {canSeeOverrides && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{t("commissions.grandTotal")}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="text-lg md:text-2xl font-bold text-primary" data-testid="text-grand-total">
              {formatCurrency(data?.grandTotal || 0)}
            </div>
            <p className="text-[10px] md:text-xs text-muted-foreground">{t("commissions.allEarningsCombined")}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="px-3 pt-3 md:px-6 md:pt-6 pb-2">
          <CardTitle className="text-base md:text-lg">{t("commissions.earningsByService")}</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <div className="flex items-center gap-2 md:gap-3 p-2 md:p-4 rounded-md bg-muted/50">
              <div className="p-1.5 md:p-2 rounded-md bg-blue-500/10">
                <Wifi className="h-4 w-4 md:h-5 md:w-5 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground">{t("commissions.internet")}</p>
                <p className="text-sm md:text-xl font-bold truncate" data-testid="text-service-internet">
                  {formatCurrency(data?.serviceTotals?.internet || 0)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3 p-2 md:p-4 rounded-md bg-muted/50">
              <div className="p-1.5 md:p-2 rounded-md bg-green-500/10">
                <Smartphone className="h-4 w-4 md:h-5 md:w-5 text-green-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground">{t("commissions.mobile")}</p>
                <p className="text-sm md:text-xl font-bold truncate" data-testid="text-service-mobile">
                  {formatCurrency(data?.serviceTotals?.mobile || 0)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3 p-2 md:p-4 rounded-md bg-muted/50">
              <div className="p-1.5 md:p-2 rounded-md bg-purple-500/10">
                <Tv className="h-4 w-4 md:h-5 md:w-5 text-purple-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-muted-foreground">{t("commissions.video")}</p>
                <p className="text-sm md:text-xl font-bold truncate" data-testid="text-service-video">
                  {formatCurrency(data?.serviceTotals?.video || 0)}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <Card>
          <CardHeader className="px-3 pt-3 md:px-6 md:pt-6 pb-2">
            <CardTitle className="text-base md:text-lg">{t("commissions.weeklyEarnings")}</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            {data?.weeklyChartData && data.weeklyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={isMobile ? 160 : 200}>
                <BarChart data={data.weeklyChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: isMobile ? 10 : 12 }} />
                  <YAxis tick={{ fontSize: isMobile ? 10 : 12 }} tickFormatter={(val) => `$${val}`} width={isMobile ? 40 : 60} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[160px] md:h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                {t("commissions.noDataAvailable")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-3 pt-3 md:px-6 md:pt-6 pb-2">
            <CardTitle className="text-base md:text-lg">{t("commissions.mtdEarnings")}</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            {data?.mtdChartData && data.mtdChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={isMobile ? 160 : 200}>
                <BarChart data={data.mtdChartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: isMobile ? 8 : 10 }} interval={data.mtdChartData.length > 15 ? 2 : 0} />
                  <YAxis tick={{ fontSize: isMobile ? 10 : 12 }} tickFormatter={(val) => `$${val}`} width={isMobile ? 40 : 60} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[160px] md:h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                {t("commissions.noDataAvailable")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("commissions.commissionDetails")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.ownSoldCommissions && data.ownSoldCommissions.length > 0 ? (
            <>
              {isMobile ? (
                <div className="space-y-3">
                  {data.ownSoldCommissions.map((comm) => (
                    <div key={comm.id} className="border rounded-md p-3 space-y-2" data-testid={`card-commission-${comm.id}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium" data-testid={`text-commission-customer-${comm.id}`}>{comm.customerName}</span>
                        <span className="font-bold text-green-600 dark:text-green-400" data-testid={`text-commission-amount-${comm.id}`}>{formatCurrency(comm.total)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm text-muted-foreground" data-testid={`text-commission-date-${comm.id}`}>{comm.dateSold}</span>
                        {isRep && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setInquiryContext({
                                subject: t("dashboard.commissionInquirySubject", { name: comm.customerName }),
                                body: t("dashboard.commissionInquiryBody", { name: comm.customerName, date: comm.dateSold, account: comm.accountNumber, amount: formatCurrency(comm.total) }),
                                entityType: "ORDER",
                                entityId: String(comm.id),
                              });
                              setInquiryOpen(true);
                            }}
                            data-testid={`btn-inquiry-${comm.id}`}
                          >
                            <MessageSquare className="h-3 w-3 mr-1" />
                            {t("commissions.askQuestion")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-2 font-medium">{t("commissions.date")}</th>
                        <th className="text-left py-3 px-2 font-medium">{t("commissions.customer")}</th>
                        <th className="text-left py-3 px-2 font-medium">{t("commissions.account")}</th>
                        {!isRep && <th className="text-right py-3 px-2 font-medium">{t("commissions.base")}</th>}
                        {!isRep && <th className="text-right py-3 px-2 font-medium">{t("commissions.incentive")}</th>}
                        <th className="text-right py-3 px-2 font-medium">{isRep ? t("commissions.commission") : t("commissions.total")}</th>
                        {isRep && <th className="py-3 px-2 w-10"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.ownSoldCommissions.map((comm) => (
                        <tr key={comm.id} className="border-b" data-testid={`row-commission-${comm.id}`}>
                          <td className="py-3 px-2">{comm.dateSold}</td>
                          <td className="py-3 px-2">{comm.customerName}</td>
                          <td className="py-3 px-2 font-mono text-xs">{comm.accountNumber}</td>
                          {!isRep && <td className="py-3 px-2 text-right">{formatCurrency(comm.baseCommission)}</td>}
                          {!isRep && <td className="py-3 px-2 text-right">{formatCurrency(comm.incentive)}</td>}
                          <td className="py-3 px-2 text-right font-medium">{formatCurrency(comm.total)}</td>
                          {isRep && (
                            <td className="py-3 px-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => {
                                  setInquiryContext({
                                    subject: t("dashboard.commissionInquirySubject", { name: comm.customerName }),
                                    body: t("dashboard.commissionInquiryBody", { name: comm.customerName, date: comm.dateSold, account: comm.accountNumber, amount: formatCurrency(comm.total) }),
                                    entityType: "ORDER",
                                    entityId: String(comm.id),
                                  });
                                  setInquiryOpen(true);
                                }}
                                data-testid={`btn-inquiry-${comm.id}`}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap bg-muted/50 rounded-md py-3 px-2 mt-2">
                <span className="font-medium">{t("commissions.total")}</span>
                <span className="font-bold" data-testid="text-commission-total">{formatCurrency(data.ownTotalEarned)}</span>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("commissions.noCommissions")}</p>
              <p className="text-sm">{t("commissions.noCommissionsDesc")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {canSeeOverrides && data?.overrideEarnings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("commissions.overrideEarnings")}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.overrideEarnings.length > 0 ? (
              <>
                {isMobile ? (
                  <div className="space-y-3">
                    {data.overrideEarnings.map((override) => (
                      <div key={override.id} className="border rounded-md p-3 space-y-2" data-testid={`card-override-${override.id}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-medium" data-testid={`text-override-customer-${override.id}`}>{override.customerName}</span>
                          <span className="font-bold text-green-600 dark:text-green-400" data-testid={`text-override-amount-${override.id}`}>{formatCurrency(override.amount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm text-muted-foreground" data-testid={`text-override-date-${override.id}`}>{override.dateSold}</span>
                          <Badge variant="outline" className="text-xs" data-testid={`badge-override-rep-${override.id}`}>{override.sourceRepId}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-2 font-medium">{t("commissions.date")}</th>
                          <th className="text-left py-3 px-2 font-medium">{t("commissions.customer")}</th>
                          <th className="text-left py-3 px-2 font-medium">{t("commissions.sourceRep")}</th>
                          <th className="text-left py-3 px-2 font-medium">{t("commissions.level")}</th>
                          <th className="text-right py-3 px-2 font-medium">{t("commissions.total")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.overrideEarnings.map((override) => (
                          <tr key={override.id} className="border-b" data-testid={`row-override-${override.id}`}>
                            <td className="py-3 px-2">{override.dateSold}</td>
                            <td className="py-3 px-2">{override.customerName}</td>
                            <td className="py-3 px-2 font-mono text-xs">{override.sourceRepId}</td>
                            <td className="py-3 px-2">
                              <Badge variant="outline" className="text-xs">{override.sourceLevelUsed}</Badge>
                            </td>
                            <td className="py-3 px-2 text-right font-medium">{formatCurrency(override.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap bg-muted/50 rounded-md py-3 px-2 mt-2">
                  <span className="font-medium">{t("commissions.totalOverrideEarnings")}</span>
                  <span className="font-bold" data-testid="text-override-total">{formatCurrency(data.overrideTotalEarned || 0)}</span>
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t("commissions.noOverrideEarnings")}</p>
                <p className="text-sm">{t("commissions.noOverrideEarningsDesc")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ComposeDialog
        open={inquiryOpen}
        onOpenChange={(open) => { setInquiryOpen(open); if (!open) setInquiryContext(null); }}
        defaultCategory="COMMISSION_INQUIRY"
        defaultSubject={inquiryContext?.subject || t("commissions.commissionInquiry")}
        defaultBody={inquiryContext?.body || ""}
        defaultToUserId={user?.assignedSupervisorId || undefined}
        relatedEntityType={inquiryContext?.entityType}
        relatedEntityId={inquiryContext?.entityId}
      />
    </div>
  );
}
