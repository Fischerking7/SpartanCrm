import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Users, Building2, TrendingUp, DollarSign, FileText, CheckCircle } from "lucide-react";
import type { Provider, Client } from "@shared/schema";

interface ReportSummary {
  summary: {
    totalOrders: number;
    approvedOrders: number;
    pendingOrders: number;
    completedOrders: number;
    totalEarned: number;
    totalPaid: number;
    outstandingBalance: number;
  };
  repPerformance: Array<{
    repId: string;
    name: string;
    role: string;
    orderCount: number;
    approvedCount: number;
    totalEarned: number;
  }>;
  providerBreakdown: Array<{
    id: string;
    name: string;
    orderCount: number;
    totalEarned: number;
  }>;
  clientBreakdown: Array<{
    id: string;
    name: string;
    orderCount: number;
    totalEarned: number;
  }>;
  monthlyTrend: Array<{
    month: string;
    orders: number;
    earned: number;
  }>;
}

export default function Reports() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedClient, setSelectedClient] = useState<string>("");

  const queryParams = new URLSearchParams();
  if (dateFrom) queryParams.append("dateFrom", dateFrom);
  if (dateTo) queryParams.append("dateTo", dateTo);
  if (selectedProvider && selectedProvider !== "__ALL__") queryParams.append("providerId", selectedProvider);
  if (selectedClient && selectedClient !== "__ALL__") queryParams.append("clientId", selectedClient);

  const { data: reportData, isLoading } = useQuery<ReportSummary>({
    queryKey: ["/api/admin/reports/summary", dateFrom, dateTo, selectedProvider, selectedClient],
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports/summary?${queryParams.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch reports");
      return res.json();
    },
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch providers");
      return res.json();
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports & Analytics</h1>
        <p className="text-muted-foreground">
          View performance metrics, breakdowns, and trends
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Date From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-2">
              <Label>Date To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
                data-testid="input-date-to"
              />
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={selectedProvider || "__ALL__"} onValueChange={setSelectedProvider}>
                <SelectTrigger className="w-40" data-testid="select-provider">
                  <SelectValue placeholder="All Providers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All Providers</SelectItem>
                  {providers?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Client</Label>
              <Select value={selectedClient || "__ALL__"} onValueChange={setSelectedClient}>
                <SelectTrigger className="w-40" data-testid="select-client">
                  <SelectValue placeholder="All Clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All Clients</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setSelectedProvider("");
                setSelectedClient("");
              }}
              data-testid="button-clear-filters"
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading reports...</div>
      ) : reportData ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-orders">
                  {reportData.summary.totalOrders}
                </div>
                <p className="text-xs text-muted-foreground">
                  {reportData.summary.approvedOrders} approved, {reportData.summary.pendingOrders} pending
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed Jobs</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-completed-jobs">
                  {reportData.summary.completedOrders}
                </div>
                <p className="text-xs text-muted-foreground">
                  {((reportData.summary.completedOrders / reportData.summary.totalOrders) * 100 || 0).toFixed(1)}% completion rate
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-earned">
                  {formatCurrency(reportData.summary.totalEarned)}
                </div>
                <p className="text-xs text-muted-foreground">From approved orders</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Outstanding Balance</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-outstanding">
                  {formatCurrency(reportData.summary.outstandingBalance)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(reportData.summary.totalPaid)} paid
                </p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="reps">
            <TabsList>
              <TabsTrigger value="reps" data-testid="tab-reps">
                <Users className="h-4 w-4 mr-2" />
                Rep Performance
              </TabsTrigger>
              <TabsTrigger value="providers" data-testid="tab-providers">
                <Building2 className="h-4 w-4 mr-2" />
                By Provider
              </TabsTrigger>
              <TabsTrigger value="clients" data-testid="tab-clients">
                <Building2 className="h-4 w-4 mr-2" />
                By Client
              </TabsTrigger>
              <TabsTrigger value="trend" data-testid="tab-trend">
                <BarChart3 className="h-4 w-4 mr-2" />
                Monthly Trend
              </TabsTrigger>
            </TabsList>

            <TabsContent value="reps">
              <Card>
                <CardHeader>
                  <CardTitle>Rep Performance</CardTitle>
                  <CardDescription>Rankings by total earned commissions</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {reportData.repPerformance.length === 0 ? (
                      <p className="text-muted-foreground text-center py-4">No data available</p>
                    ) : (
                      reportData.repPerformance.map((rep, index) => (
                        <div
                          key={rep.repId}
                          className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                          data-testid={`row-rep-${rep.repId}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-sm text-muted-foreground w-6">
                              #{index + 1}
                            </span>
                            <div>
                              <p className="font-medium">{rep.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {rep.repId} - {rep.role}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">{formatCurrency(rep.totalEarned)}</p>
                            <p className="text-sm text-muted-foreground">
                              {rep.orderCount} orders ({rep.approvedCount} approved)
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="providers">
              <Card>
                <CardHeader>
                  <CardTitle>Provider Breakdown</CardTitle>
                  <CardDescription>Orders and earnings by provider</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {reportData.providerBreakdown.length === 0 ? (
                      <p className="text-muted-foreground text-center py-4">No data available</p>
                    ) : (
                      reportData.providerBreakdown.map((provider) => (
                        <div
                          key={provider.id}
                          className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                          data-testid={`row-provider-${provider.id}`}
                        >
                          <div>
                            <p className="font-medium">{provider.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {provider.orderCount} orders
                            </p>
                          </div>
                          <p className="font-semibold">{formatCurrency(provider.totalEarned)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="clients">
              <Card>
                <CardHeader>
                  <CardTitle>Client Breakdown</CardTitle>
                  <CardDescription>Orders and earnings by client</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {reportData.clientBreakdown.length === 0 ? (
                      <p className="text-muted-foreground text-center py-4">No data available</p>
                    ) : (
                      reportData.clientBreakdown.map((client) => (
                        <div
                          key={client.id}
                          className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                          data-testid={`row-client-${client.id}`}
                        >
                          <div>
                            <p className="font-medium">{client.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {client.orderCount} orders
                            </p>
                          </div>
                          <p className="font-semibold">{formatCurrency(client.totalEarned)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trend">
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Trend</CardTitle>
                  <CardDescription>Orders and earnings over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {reportData.monthlyTrend.length === 0 ? (
                      <p className="text-muted-foreground text-center py-4">No data available</p>
                    ) : (
                      reportData.monthlyTrend.map((month) => (
                        <div
                          key={month.month}
                          className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                          data-testid={`row-month-${month.month}`}
                        >
                          <div>
                            <p className="font-medium">{month.month}</p>
                            <p className="text-sm text-muted-foreground">
                              {month.orders} orders
                            </p>
                          </div>
                          <p className="font-semibold">{formatCurrency(month.earned)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <div className="text-center py-8 text-muted-foreground">No data available</div>
      )}
    </div>
  );
}
