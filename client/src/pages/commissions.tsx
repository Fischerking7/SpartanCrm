import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Users, FileText, Calendar, CalendarDays } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface OwnCommission {
  id: string;
  dateSold: string;
  customerName: string;
  accountNumber: string;
  baseCommission: number;
  incentive: number;
  total: number;
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
  weeklyEarned: number;
  mtdEarned: number;
  weeklyChartData: ChartDataPoint[];
  mtdChartData: ChartDataPoint[];
  overrideEarnings: OverrideEarning[] | null;
  overrideTotalEarned: number | null;
  grandTotal: number;
}

export default function Commissions() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<CommissionsData>({
    queryKey: ["/api/commissions"],
    queryFn: async () => {
      const res = await fetch("/api/commissions", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch commissions");
      return res.json();
    },
  });

  const isRep = user?.role === "REP";
  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">
          {isRep ? "My Commissions" : "Commissions Overview"}
        </h1>
        <p className="text-muted-foreground">
          Track your commission earnings and performance
        </p>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${isRep ? "md:grid-cols-4" : "md:grid-cols-5"}`}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Connected</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-connected">
              {data?.ownTotalConnected || 0}
            </div>
            <p className="text-xs text-muted-foreground">Approved orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Commission Dollars Earned</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-own-earned">
              {formatCurrency(data?.ownTotalEarned || 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Weekly Earned</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-weekly-earned">
              {formatCurrency(data?.weeklyEarned || 0)}
            </div>
            <p className="text-xs text-muted-foreground">This week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">MTD Earned</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-mtd-earned">
              {formatCurrency(data?.mtdEarned || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Month to date</p>
          </CardContent>
        </Card>

        {!isRep && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Override Earnings</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-override-earned">
                {formatCurrency(data?.overrideTotalEarned || 0)}
              </div>
              <p className="text-xs text-muted-foreground">From team sales</p>
            </CardContent>
          </Card>
        )}
      </div>

      {!isRep && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Grand Total</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary" data-testid="text-grand-total">
              {formatCurrency(data?.grandTotal || 0)}
            </div>
            <p className="text-xs text-muted-foreground">All earnings combined</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Weekly Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.weeklyChartData && data.weeklyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.weeklyChartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(val) => `$${val}`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Month-to-Date Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.mtdChartData && data.mtdChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.mtdChartData}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={data.mtdChartData.length > 15 ? 2 : 0} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(val) => `$${val}`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Commission Details</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.ownSoldCommissions && data.ownSoldCommissions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium">Date</th>
                    <th className="text-left py-3 px-2 font-medium">Customer</th>
                    <th className="text-left py-3 px-2 font-medium">Account</th>
                    <th className="text-right py-3 px-2 font-medium">Base</th>
                    <th className="text-right py-3 px-2 font-medium">Incentive</th>
                    <th className="text-right py-3 px-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ownSoldCommissions.map((comm) => (
                    <tr key={comm.id} className="border-b" data-testid={`row-commission-${comm.id}`}>
                      <td className="py-3 px-2">{comm.dateSold}</td>
                      <td className="py-3 px-2">{comm.customerName}</td>
                      <td className="py-3 px-2 font-mono text-xs">{comm.accountNumber}</td>
                      <td className="py-3 px-2 text-right">{formatCurrency(comm.baseCommission)}</td>
                      <td className="py-3 px-2 text-right">{formatCurrency(comm.incentive)}</td>
                      <td className="py-3 px-2 text-right font-medium">{formatCurrency(comm.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50">
                    <td colSpan={5} className="py-3 px-2 font-medium">Total</td>
                    <td className="py-3 px-2 text-right font-bold">{formatCurrency(data.ownTotalEarned)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No commission earnings yet</p>
              <p className="text-sm">Commissions appear when your orders are completed and approved</p>
            </div>
          )}
        </CardContent>
      </Card>

      {!isRep && data?.overrideEarnings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Override Earnings</CardTitle>
          </CardHeader>
          <CardContent>
            {data.overrideEarnings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 font-medium">Date</th>
                      <th className="text-left py-3 px-2 font-medium">Customer</th>
                      <th className="text-left py-3 px-2 font-medium">Source Rep</th>
                      <th className="text-left py-3 px-2 font-medium">Level</th>
                      <th className="text-right py-3 px-2 font-medium">Amount</th>
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
                  <tfoot>
                    <tr className="bg-muted/50">
                      <td colSpan={4} className="py-3 px-2 font-medium">Total Override Earnings</td>
                      <td className="py-3 px-2 text-right font-bold">{formatCurrency(data.overrideTotalEarned || 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No override earnings yet</p>
                <p className="text-sm">Override earnings appear when team members have approved orders</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
