import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TrendingDown, TrendingUp, RefreshCw, DollarSign, Calendar, Building2, Users, BarChart3 } from "lucide-react";

interface AccuracyData {
  avgMonthlyActual: number;
  monthOverMonthPct: number | null;
  forecast30VsAvgPct: number | null;
  periodCount: number;
}

interface ForecastData {
  forecast: { d30: number; d60: number; d90: number; beyond: number; total: number };
  byProvider: Array<{ name: string; d30: number; d60: number; d90: number; beyond: number }>;
  byTeam: Array<{ name: string; d30: number; d60: number; d90: number; beyond: number }>;
  historical: Array<{ month: string; label: string; actual: number }>;
  generatedAt: string;
  accuracy: AccuracyData | null;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtFull = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function CashFlow() {
  const { data, isLoading, error, refetch } = useQuery<ForecastData>({
    queryKey: ["/api/accounting/cash-flow-forecast"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/cash-flow-forecast", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load cash flow forecast");
      return res.json();
    },
  });

  const pipelineTotal = data ? data.forecast.d30 + data.forecast.d60 + data.forecast.d90 + data.forecast.beyond : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingDown className="h-6 w-6 text-primary" />
            Cash Flow Forecast
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Estimated commission payouts from approved/pending orders
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-cashflow">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load cash flow forecast.</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card data-testid="card-forecast-30">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-primary">Next 30 days</span>
                </div>
                <div className="text-2xl font-bold">{fmt(data.forecast.d30)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {pipelineTotal > 0 ? Math.round((data.forecast.d30 / pipelineTotal) * 100) : 0}% of pipeline
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-forecast-60">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">31–60 days</span>
                </div>
                <div className="text-2xl font-bold">{fmt(data.forecast.d60)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {pipelineTotal > 0 ? Math.round((data.forecast.d60 / pipelineTotal) * 100) : 0}% of pipeline
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-forecast-90">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">61–90 days</span>
                </div>
                <div className="text-2xl font-bold">{fmt(data.forecast.d90)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {pipelineTotal > 0 ? Math.round((data.forecast.d90 / pipelineTotal) * 100) : 0}% of pipeline
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-forecast-total">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-primary">Total Pipeline</span>
                </div>
                <div className="text-2xl font-bold text-primary">{fmt(data.forecast.total)}</div>
                <div className="text-xs text-muted-foreground mt-1">All pending commissions</div>
              </CardContent>
            </Card>
          </div>

          {data.accuracy && (
            <Card data-testid="card-accuracy">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Forecast Accuracy vs Historical
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Avg Monthly Paid ({data.accuracy.periodCount}mo)</div>
                    <div className="text-xl font-bold mt-0.5">{fmt(data.accuracy.avgMonthlyActual)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">30-day Forecast vs Avg</div>
                    {data.accuracy.forecast30VsAvgPct !== null ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-xl font-bold">
                          {data.accuracy.forecast30VsAvgPct > 0 ? "+" : ""}{data.accuracy.forecast30VsAvgPct}%
                        </span>
                        {data.accuracy.forecast30VsAvgPct > 0 ? (
                          <TrendingUp className="h-4 w-4 text-green-600" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-destructive" />
                        )}
                        <Badge variant={Math.abs(data.accuracy.forecast30VsAvgPct) > 20 ? "destructive" : "secondary"} className="text-xs ml-1">
                          {Math.abs(data.accuracy.forecast30VsAvgPct) > 20 ? "High variance" : "Within range"}
                        </Badge>
                      </div>
                    ) : <div className="text-muted-foreground text-sm mt-0.5">—</div>}
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Month-over-Month</div>
                    {data.accuracy.monthOverMonthPct !== null ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-xl font-bold">
                          {data.accuracy.monthOverMonthPct > 0 ? "+" : ""}{data.accuracy.monthOverMonthPct}%
                        </span>
                        {data.accuracy.monthOverMonthPct >= 0 ? (
                          <TrendingUp className="h-4 w-4 text-green-600" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-destructive" />
                        )}
                      </div>
                    ) : <div className="text-muted-foreground text-sm mt-0.5">—</div>}
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Interpretation</div>
                    <div className="text-sm mt-0.5">
                      {data.accuracy.forecast30VsAvgPct === null ? "Insufficient data" :
                        Math.abs(data.accuracy.forecast30VsAvgPct) <= 10 ? "Forecast is tracking well with historical average" :
                        data.accuracy.forecast30VsAvgPct > 10 ? "Forecast is above average — strong pipeline" :
                        "Forecast is below average — pipeline may be slow"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="provider">
            <TabsList>
              <TabsTrigger value="provider" data-testid="tab-by-provider">
                <Building2 className="h-4 w-4 mr-2" />
                By Provider
              </TabsTrigger>
              <TabsTrigger value="team" data-testid="tab-by-team">
                <Users className="h-4 w-4 mr-2" />
                By Team
              </TabsTrigger>
              <TabsTrigger value="historical" data-testid="tab-historical">
                Historical
              </TabsTrigger>
            </TabsList>

            <TabsContent value="provider">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Commission Forecast by Provider</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead className="text-right">0–30d</TableHead>
                          <TableHead className="text-right">31–60d</TableHead>
                          <TableHead className="text-right">61–90d</TableHead>
                          <TableHead className="text-right">Beyond</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.byProvider.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No pending commissions in the pipeline
                            </TableCell>
                          </TableRow>
                        )}
                        {data.byProvider.map((row) => {
                          const total = row.d30 + row.d60 + row.d90 + row.beyond;
                          return (
                            <TableRow key={row.name} data-testid={`row-provider-${row.name}`}>
                              <TableCell className="font-medium">{row.name}</TableCell>
                              <TableCell className="text-right">{fmtFull(row.d30)}</TableCell>
                              <TableCell className="text-right">{fmtFull(row.d60)}</TableCell>
                              <TableCell className="text-right">{fmtFull(row.d90)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{fmtFull(row.beyond)}</TableCell>
                              <TableCell className="text-right font-semibold">{fmtFull(total)}</TableCell>
                            </TableRow>
                          );
                        })}
                        {data.byProvider.length > 0 && (
                          <TableRow className="font-bold border-t-2">
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right">{fmtFull(data.forecast.d30)}</TableCell>
                            <TableCell className="text-right">{fmtFull(data.forecast.d60)}</TableCell>
                            <TableCell className="text-right">{fmtFull(data.forecast.d90)}</TableCell>
                            <TableCell className="text-right">{fmtFull(data.forecast.beyond)}</TableCell>
                            <TableCell className="text-right">{fmtFull(data.forecast.total)}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="team">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Commission Forecast by Team</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Team / Manager</TableHead>
                          <TableHead className="text-right">0–30d</TableHead>
                          <TableHead className="text-right">31–60d</TableHead>
                          <TableHead className="text-right">61–90d</TableHead>
                          <TableHead className="text-right">Beyond</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.byTeam.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No team data available
                            </TableCell>
                          </TableRow>
                        )}
                        {data.byTeam.map((row) => {
                          const total = row.d30 + row.d60 + row.d90 + row.beyond;
                          return (
                            <TableRow key={row.name} data-testid={`row-team-${row.name}`}>
                              <TableCell className="font-medium">{row.name}</TableCell>
                              <TableCell className="text-right">{fmtFull(row.d30)}</TableCell>
                              <TableCell className="text-right">{fmtFull(row.d60)}</TableCell>
                              <TableCell className="text-right">{fmtFull(row.d90)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{fmtFull(row.beyond)}</TableCell>
                              <TableCell className="text-right font-semibold">{fmtFull(total)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="historical">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Historical Commission Payouts (Last 3 Months)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Month</TableHead>
                          <TableHead className="text-right">Actual Paid</TableHead>
                          {data.accuracy && <TableHead className="text-right">vs 30d Forecast</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.historical.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                              No historical data found
                            </TableCell>
                          </TableRow>
                        )}
                        {data.historical.map((row, i) => {
                          const isLatest = i === data.historical.length - 1;
                          return (
                            <TableRow key={row.month} data-testid={`row-historical-${row.month}`}>
                              <TableCell className="font-medium">
                                {row.label}
                                {isLatest && <Badge variant="secondary" className="ml-2 text-xs">Current</Badge>}
                              </TableCell>
                              <TableCell className="text-right font-semibold">{fmtFull(row.actual)}</TableCell>
                              {data.accuracy && (
                                <TableCell className="text-right text-muted-foreground text-sm">
                                  {isLatest && data.accuracy.forecast30VsAvgPct !== null
                                    ? `${data.accuracy.forecast30VsAvgPct > 0 ? "+" : ""}${data.accuracy.forecast30VsAvgPct}% vs avg`
                                    : "—"}
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="text-xs text-muted-foreground text-right">
            Forecast estimates: install date + 14 days for installed orders, or sale date + 30 days otherwise.
          </div>
        </>
      )}
    </div>
  );
}
