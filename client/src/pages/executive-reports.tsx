import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  BarChart3, Users, TrendingUp, DollarSign, Tv, Smartphone, Building2, 
  CheckCircle, Clock, User
} from "lucide-react";

interface ServiceBreakdown {
  category: string;
  sales: number;
  connected: number;
  pending: number;
  commission: number;
}

interface ProviderBreakdown {
  name: string;
  sales: number;
  connected: number;
  pending: number;
  commission: number;
}

interface TeamBreakdown {
  managerId: string;
  managerName: string;
  teamSize: number;
  totalSales: number;
  connectedSales: number;
  pendingSales: number;
  pendingCommissions: number;
  connectedCommissions: number;
}

interface SalesOverviewData {
  period: { start: string; end: string };
  companyTotals: {
    totalSales: number;
    connectedSales: number;
    pendingSales: number;
    pendingCommissions: number;
    connectedCommissions: number;
  };
  serviceBreakdown: ServiceBreakdown[];
  providerBreakdown: ProviderBreakdown[];
  teamBreakdown: TeamBreakdown[];
}

interface RepData {
  repId: string;
  userId: string;
  name: string;
  role: string;
  managerName: string | null;
  totalSales: number;
  connectedSales: number;
  pendingSales: number;
  pendingCommissions: number;
  connectedCommissions: number;
  serviceBreakdown: { category: string; sales: number; connected: number; commission: number }[];
  providerBreakdown: { name: string; sales: number; connected: number; commission: number }[];
}

interface RepListingData {
  period: { start: string; end: string };
  reps: RepData[];
}

function formatCurrency(amount: number) {
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount);
}

function getServiceIcon(category: string) {
  const lowerCategory = category.toLowerCase();
  if (lowerCategory.includes("tv") || lowerCategory.includes("television") || lowerCategory.includes("video")) {
    return <Tv className="h-4 w-4" />;
  }
  if (lowerCategory.includes("mobile") || lowerCategory.includes("wireless") || lowerCategory.includes("phone")) {
    return <Smartphone className="h-4 w-4" />;
  }
  return <Building2 className="h-4 w-4" />;
}

function SalesOverviewTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<SalesOverviewData>({
    queryKey: ["/api/executive/sales-overview"],
    queryFn: async () => {
      const res = await fetch("/api/executive/sales-overview", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error(t("executiveReports.failedToFetchOverview"));
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96" />;

  if (!data) return <p className="text-muted-foreground">{t("executiveReports.noData")}</p>;

  const { companyTotals, serviceBreakdown, providerBreakdown, teamBreakdown } = data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            {t("executiveReports.companyWideSales")}
          </CardTitle>
          <CardDescription>
            {data.period.start} to {data.period.end}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">{t("executiveReports.totalSales")}</p>
              <p className="text-3xl font-bold" data-testid="text-total-sales">{companyTotals.totalSales}</p>
            </div>
            <div className="text-center p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-600" /> {t("executiveReports.connected")}
              </p>
              <p className="text-3xl font-bold text-green-600" data-testid="text-connected-sales">{companyTotals.connectedSales}</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg">
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="h-3 w-3 text-yellow-600" /> {t("executiveReports.pending")}
              </p>
              <p className="text-3xl font-bold text-yellow-600" data-testid="text-pending-sales">{companyTotals.pendingSales}</p>
            </div>
            <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
              <p className="text-sm text-muted-foreground">{t("executiveReports.connectedCommission")}</p>
              <p className="text-2xl font-bold text-blue-600" data-testid="text-connected-commission">
                {formatCurrency(companyTotals.connectedCommissions)}
              </p>
            </div>
            <div className="text-center p-4 bg-orange-50 dark:bg-orange-950/30 rounded-lg">
              <p className="text-sm text-muted-foreground">{t("executiveReports.pendingCommission")}</p>
              <p className="text-2xl font-bold text-orange-600" data-testid="text-pending-commission">
                {formatCurrency(companyTotals.pendingCommissions)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Tv className="h-4 w-4" />
              {t("executiveReports.serviceTypeBreakdown")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {serviceBreakdown.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">{t("executiveReports.noServiceData")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("executiveReports.service")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.sales")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.connected")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.pending")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.commission")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serviceBreakdown.map((service) => (
                    <TableRow key={service.category} data-testid={`row-service-${service.category}`}>
                      <TableCell className="font-medium flex items-center gap-2">
                        {getServiceIcon(service.category)}
                        {service.category}
                      </TableCell>
                      <TableCell className="text-right">{service.sales}</TableCell>
                      <TableCell className="text-right text-green-600">{service.connected}</TableCell>
                      <TableCell className="text-right text-yellow-600">{service.pending}</TableCell>
                      <TableCell className="text-right">{formatCurrency(service.commission)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {t("executiveReports.providerBreakdown")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {providerBreakdown.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">{t("executiveReports.noProviderData")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("executiveReports.provider")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.sales")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.connected")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.pending")}</TableHead>
                    <TableHead className="text-right">{t("executiveReports.commission")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providerBreakdown.map((provider, idx) => (
                    <TableRow key={idx} data-testid={`row-provider-${idx}`}>
                      <TableCell className="font-medium">{provider.name}</TableCell>
                      <TableCell className="text-right">{provider.sales}</TableCell>
                      <TableCell className="text-right text-green-600">{provider.connected}</TableCell>
                      <TableCell className="text-right text-yellow-600">{provider.pending}</TableCell>
                      <TableCell className="text-right">{formatCurrency(provider.commission)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {t("executiveReports.managerTeamPerformance")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {teamBreakdown.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">{t("executiveReports.noTeamData")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("executiveReports.manager")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.teamSize")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.totalSales")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.connected")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.pending")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.connectedCommission")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.pendingCommission")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamBreakdown.map((team) => (
                  <TableRow key={team.managerId} data-testid={`row-team-${team.managerId}`}>
                    <TableCell className="font-medium">{team.managerName}</TableCell>
                    <TableCell className="text-right">{team.teamSize}</TableCell>
                    <TableCell className="text-right font-semibold">{team.totalSales}</TableCell>
                    <TableCell className="text-right text-green-600">{team.connectedSales}</TableCell>
                    <TableCell className="text-right text-yellow-600">{team.pendingSales}</TableCell>
                    <TableCell className="text-right text-green-600 font-medium">
                      {formatCurrency(team.connectedCommissions)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">
                      {formatCurrency(team.pendingCommissions)}
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

function RepListingTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery<RepListingData>({
    queryKey: ["/api/executive/rep-listing"],
    queryFn: async () => {
      const res = await fetch("/api/executive/rep-listing", { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error(t("executiveReports.failedToFetchListing"));
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96" />;

  if (!data) return <p className="text-muted-foreground">{t("executiveReports.noData")}</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            {t("executiveReports.repPerformance")}
          </CardTitle>
          <CardDescription>
            {t("executiveReports.repPerformanceDesc", { start: data.period.start, end: data.period.end })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.reps.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t("executiveReports.noRepData")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("executiveReports.rank")}</TableHead>
                  <TableHead>{t("executiveReports.rep")}</TableHead>
                  <TableHead>{t("executiveReports.manager")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.totalSales")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.connected")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.pending")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.connectedCommission")}</TableHead>
                  <TableHead className="text-right">{t("executiveReports.pendingCommission")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.reps.map((rep, idx) => (
                  <TableRow key={rep.userId} data-testid={`row-rep-${rep.userId}`}>
                    <TableCell>
                      <Badge variant={idx < 3 ? "default" : "secondary"}>#{idx + 1}</Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{rep.name}</p>
                        <p className="text-xs text-muted-foreground">{rep.repId}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{rep.managerName || "-"}</TableCell>
                    <TableCell className="text-right font-semibold">{rep.totalSales}</TableCell>
                    <TableCell className="text-right text-green-600">{rep.connectedSales}</TableCell>
                    <TableCell className="text-right text-yellow-600">{rep.pendingSales}</TableCell>
                    <TableCell className="text-right text-green-600 font-medium">
                      {formatCurrency(rep.connectedCommissions)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">
                      {formatCurrency(rep.pendingCommissions)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data.reps.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("executiveReports.serviceTypeSummaryAll")}</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const aggregated: Record<string, { sales: number; connected: number; commission: number }> = {};
                data.reps.forEach(rep => {
                  rep.serviceBreakdown.forEach(s => {
                    if (!aggregated[s.category]) {
                      aggregated[s.category] = { sales: 0, connected: 0, commission: 0 };
                    }
                    aggregated[s.category].sales += s.sales;
                    aggregated[s.category].connected += s.connected;
                    aggregated[s.category].commission += s.commission;
                  });
                });
                const entries = Object.entries(aggregated);
                if (entries.length === 0) {
                  return <p className="text-muted-foreground text-center py-4">{t("executiveReports.noServiceData")}</p>;
                }
                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("executiveReports.service")}</TableHead>
                        <TableHead className="text-right">{t("executiveReports.sales")}</TableHead>
                        <TableHead className="text-right">{t("executiveReports.connected")}</TableHead>
                        <TableHead className="text-right">{t("executiveReports.commission")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map(([category, d]) => (
                        <TableRow key={category}>
                          <TableCell className="font-medium flex items-center gap-2">
                            {getServiceIcon(category)}
                            {category}
                          </TableCell>
                          <TableCell className="text-right">{d.sales}</TableCell>
                          <TableCell className="text-right text-green-600">{d.connected}</TableCell>
                          <TableCell className="text-right">{formatCurrency(d.commission)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("executiveReports.providerSummaryAll")}</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const aggregated: Record<string, { sales: number; connected: number; commission: number }> = {};
                data.reps.forEach(rep => {
                  rep.providerBreakdown.forEach(p => {
                    if (!aggregated[p.name]) {
                      aggregated[p.name] = { sales: 0, connected: 0, commission: 0 };
                    }
                    aggregated[p.name].sales += p.sales;
                    aggregated[p.name].connected += p.connected;
                    aggregated[p.name].commission += p.commission;
                  });
                });
                const entries = Object.entries(aggregated);
                if (entries.length === 0) {
                  return <p className="text-muted-foreground text-center py-4">{t("executiveReports.noProviderData")}</p>;
                }
                return (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("executiveReports.provider")}</TableHead>
                        <TableHead className="text-right">{t("executiveReports.sales")}</TableHead>
                        <TableHead className="text-right">{t("executiveReports.connected")}</TableHead>
                        <TableHead className="text-right">{t("executiveReports.commission")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map(([name, d]) => (
                        <TableRow key={name}>
                          <TableCell className="font-medium">{name}</TableCell>
                          <TableCell className="text-right">{d.sales}</TableCell>
                          <TableCell className="text-right text-green-600">{d.connected}</TableCell>
                          <TableCell className="text-right">{formatCurrency(d.commission)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function ExecutiveReports() {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">{t("executiveReports.title")}</h1>
        <p className="text-muted-foreground">{t("executiveReports.subtitle")}</p>
      </div>

      <Tabs defaultValue="sales-overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sales-overview" data-testid="tab-sales-overview">
            <BarChart3 className="h-4 w-4 mr-2" />
            {t("executiveReports.salesOverview")}
          </TabsTrigger>
          <TabsTrigger value="rep-listing" data-testid="tab-rep-listing">
            <Users className="h-4 w-4 mr-2" />
            {t("executiveReports.repListing")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sales-overview">
          <SalesOverviewTab />
        </TabsContent>
        <TabsContent value="rep-listing">
          <RepListingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
