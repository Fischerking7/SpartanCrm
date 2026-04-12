import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Clock, DollarSign, BarChart3, Target, Calendar, User } from "lucide-react";
import { useState } from "react";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import type { User as UserType } from "@shared/schema";

interface ForecastData {
  period: { type: string; start: string; end: string };
  pending: { orders: number; commission: string };
  projected: { orders: number; commission: string };
  historical: { averageCommission: string };
  confidenceScore: number;
}

export default function CommissionForecast() {
  const { user: currentUser } = useAuth();
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  const [period, setPeriod] = useState("MONTH");
  const [selectedUserId, setSelectedUserId] = useState<string>("__self__");
  
  // Check if current user can view other users' forecasts
  const canViewOthers = Boolean(currentUser && ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(currentUser.role));
  
  // Fetch users list for admin/operator/executive to select from
  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: canViewOthers,
  });
  
  // Filter to only show commission-earning roles (exclude ADMIN and OPERATIONS)
  const commissionEarningUsers = users.filter((u: UserType) => 
    ["REP", "MDU", "LEAD", "MANAGER", "EXECUTIVE"].includes(u.role) && u.status === "ACTIVE"
  );
  
  const { data: forecast, isLoading } = useQuery<ForecastData>({
    queryKey: ["/api/commission-forecast", period, selectedUserId],
    queryFn: async () => {
      const url = selectedUserId && selectedUserId !== "__self__"
        ? `/api/commission-forecast?period=${period}&userId=${selectedUserId}`
        : `/api/commission-forecast?period=${period}`;
      const res = await fetch(url, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch forecast");
      return res.json();
    },
  });
  
  // Get selected user's name for display
  const selectedUser = selectedUserId && selectedUserId !== "__self__" ? users.find((u: UserType) => u.id === selectedUserId) : null;

  const formatCurrency = (value: string | number) => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(num);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale, { month: "short", day: "numeric" });
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 70) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    if (score >= 50) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("forecast.title")}</h1>
            <p className="text-muted-foreground">
              {selectedUser 
                ? t("forecast.forecastFor", { name: selectedUser.name })
                : t("forecast.description")}
            </p>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40" data-testid="select-period">
              <SelectValue placeholder={t("forecast.selectPeriod")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="WEEK">{t("forecast.thisWeek")}</SelectItem>
              <SelectItem value="MONTH">{t("forecast.thisMonth")}</SelectItem>
              <SelectItem value="QUARTER">{t("forecast.thisQuarter")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {canViewOthers && (
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="w-64" data-testid="select-user">
                <SelectValue placeholder={t("forecast.viewOwnForecast")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__self__">{t("forecast.myForecast")}</SelectItem>
                {commissionEarningUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.repId}) - {u.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : forecast ? (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              {formatDate(forecast.period.start)} - {formatDate(forecast.period.end)}
            </span>
            <Badge className={getConfidenceColor(forecast.confidenceScore)}>
              {t("forecast.confidencePct", { pct: forecast.confidenceScore })}
            </Badge>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card data-testid="card-pending-commission">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">{t("forecast.pendingCommission")}</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatCurrency(forecast.pending.commission)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {forecast.pending.orders !== 1
                    ? t("forecast.pendingOrdersPlural", { count: forecast.pending.orders })
                    : t("forecast.pendingOrders", { count: forecast.pending.orders })}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-projected-total">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">{t("forecast.projectedTotal")}</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(forecast.projected.commission)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {forecast.projected.orders !== 1
                    ? t("forecast.projectedSalesPlural", { count: forecast.projected.orders })
                    : t("forecast.projectedSales", { count: forecast.projected.orders })}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-historical-average">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">{t("forecast.historicalAverage")}</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(forecast.historical.averageCommission)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("forecast.historicalDesc")}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-potential-upside">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">{t("forecast.potentialUpside")}</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {formatCurrency(
                    parseFloat(forecast.projected.commission) - parseFloat(forecast.pending.commission)
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("forecast.potentialUpsideDesc")}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {t("forecast.howCalculated")}
              </CardTitle>
              <CardDescription>{t("forecast.understandingForecast")}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>{t("forecast.pendingExplain")}</p>
              <p>{t("forecast.projectedExplain")}</p>
              <p>{t("forecast.confidenceExplain")}</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {t("forecast.unableToLoad")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
