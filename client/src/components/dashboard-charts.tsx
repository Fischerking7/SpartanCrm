import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import { TrendingUp, Activity, ShoppingCart, CheckCircle } from "lucide-react";

interface ChartDataPoint {
  date: string;
  soldCount: number;
  connectedCount: number;
  earnedDollars: number;
}

interface DashboardChartsProps {
  personalData: ChartDataPoint[];
  teamData?: ChartDataPoint[] | null;
  period: "Weekly" | "MTD";
  showTeam?: boolean;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

export function SalesTrendChart({ personalData, teamData, period, showTeam }: DashboardChartsProps) {
  const hasTeamData = showTeam && teamData && teamData.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base font-medium">Sales Trend</CardTitle>
        </div>
        <Badge variant="outline" className="text-xs">{period}</Badge>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={personalData}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value: number) => [value, "Sales"]} />
            {hasTeamData ? (
              <>
                <Area
                  type="monotone"
                  dataKey="soldCount"
                  name="Personal"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.3}
                />
              </>
            ) : (
              <Area
                type="monotone"
                dataKey="soldCount"
                name="Sales"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.3}
              />
            )}
            <Legend />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function ConnectsTrendChart({ personalData, teamData, period, showTeam }: DashboardChartsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base font-medium">Connects Trend</CardTitle>
        </div>
        <Badge variant="outline" className="text-xs">{period}</Badge>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={personalData}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value: number) => [value, "Connected"]} />
            <Line
              type="monotone"
              dataKey="connectedCount"
              name="Connected"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function DailyAverageChart({ personalData, teamData, period, showTeam }: DashboardChartsProps) {
  const totalSales = personalData.reduce((sum, d) => sum + d.soldCount, 0);
  const totalConnects = personalData.reduce((sum, d) => sum + d.connectedCount, 0);
  const daysWithData = personalData.filter(d => d.soldCount > 0 || d.connectedCount > 0).length || 1;
  
  const avgSales = totalSales / daysWithData;
  const avgConnects = totalConnects / daysWithData;

  let teamAvgSales = 0;
  let teamAvgConnects = 0;
  if (showTeam && teamData && teamData.length > 0) {
    const teamTotalSales = teamData.reduce((sum, d) => sum + d.soldCount, 0);
    const teamTotalConnects = teamData.reduce((sum, d) => sum + d.connectedCount, 0);
    const teamDaysWithData = teamData.filter(d => d.soldCount > 0 || d.connectedCount > 0).length || 1;
    teamAvgSales = teamTotalSales / teamDaysWithData;
    teamAvgConnects = teamTotalConnects / teamDaysWithData;
  }

  const barData = showTeam && teamData
    ? [
        { name: "Sales/Day", personal: avgSales, team: teamAvgSales },
        { name: "Connects/Day", personal: avgConnects, team: teamAvgConnects },
      ]
    : [
        { name: "Sales/Day", value: avgSales },
        { name: "Connects/Day", value: avgConnects },
      ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base font-medium">Daily Average</CardTitle>
        </div>
        <Badge variant="outline" className="text-xs">{period}</Badge>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
            <Tooltip formatter={(value: number) => [value.toFixed(1), ""]} />
            {showTeam && teamData ? (
              <>
                <Bar dataKey="personal" name="Personal" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                <Bar dataKey="team" name="Team" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                <Legend />
              </>
            ) : (
              <Bar dataKey="value" name="Average" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface CombinedChartProps {
  personalData: ChartDataPoint[];
  teamData?: ChartDataPoint[] | null;
  period: "Weekly" | "MTD";
}

export function PersonalVsTeamChart({ personalData, teamData, period }: CombinedChartProps) {
  if (!teamData || teamData.length === 0) return null;

  const combinedData = personalData.map((p, i) => ({
    date: p.date,
    personalSales: p.soldCount,
    teamSales: teamData[i]?.soldCount || 0,
    personalConnects: p.connectedCount,
    teamConnects: teamData[i]?.connectedCount || 0,
  }));

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base font-medium">Personal vs Team Sales</CardTitle>
        </div>
        <Badge variant="outline" className="text-xs">{period}</Badge>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={combinedData}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="personalSales" name="Personal Sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="teamSales" name="Team Sales" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function DashboardChartsModule({
  personalWeekly,
  personalMtd,
  teamWeekly,
  teamMtd,
}: {
  personalWeekly: ChartDataPoint[];
  personalMtd: ChartDataPoint[];
  teamWeekly?: ChartDataPoint[] | null;
  teamMtd?: ChartDataPoint[] | null;
}) {
  const hasTeam = !!(teamWeekly && teamWeekly.length > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <SalesTrendChart personalData={personalWeekly} teamData={teamWeekly} period="Weekly" showTeam={hasTeam} />
        <ConnectsTrendChart personalData={personalWeekly} teamData={teamWeekly} period="Weekly" showTeam={hasTeam} />
        <DailyAverageChart personalData={personalWeekly} teamData={teamWeekly} period="Weekly" showTeam={hasTeam} />
      </div>

      {hasTeam && (
        <div className="grid gap-4 md:grid-cols-2">
          <PersonalVsTeamChart personalData={personalWeekly} teamData={teamWeekly} period="Weekly" />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SalesTrendChart personalData={personalMtd} teamData={teamMtd} period="MTD" showTeam={hasTeam} />
        <ConnectsTrendChart personalData={personalMtd} teamData={teamMtd} period="MTD" showTeam={hasTeam} />
        <DailyAverageChart personalData={personalMtd} teamData={teamMtd} period="MTD" showTeam={hasTeam} />
      </div>

      {hasTeam && (
        <div className="grid gap-4 md:grid-cols-2">
          <PersonalVsTeamChart personalData={personalMtd} teamData={teamMtd} period="MTD" />
        </div>
      )}
    </div>
  );
}
