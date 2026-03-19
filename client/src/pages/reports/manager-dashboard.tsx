import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { KpiCard } from "@/components/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users } from "lucide-react";

interface RepData {
  id: string;
  name: string;
  repId: string;
  isActiveToday: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  minutesActive: number;
  todayOrders: number;
  periodOrders: number;
  periodCommission: string;
  isZeroDay: boolean;
  lastPage: string | null;
  deviceType: string | null;
}

interface ManagerDashboardData {
  teamSize: number;
  clockedInCount: number;
  zeroDayCount: number;
  todayTotalOrders: number;
  reps: RepData[];
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export default function ManagerDashboard() {
  const { data, isLoading } = useQuery<ManagerDashboardData>({
    queryKey: ["/api/reports/manager/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/reports/manager/dashboard", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="manager-dashboard">
      <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-dashboard-title">
        <Users className="w-5 h-5" /> Team Dashboard
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="In Field Today"
          value={`${data.clockedInCount}/${data.teamSize}`}
          variant={data.clockedInCount > 0 ? "success" : "warning"}
        />
        <KpiCard label="Orders Today" value={data.todayTotalOrders} variant="default" />
        <KpiCard
          label="Zero-Day Reps"
          value={data.zeroDayCount}
          variant={data.zeroDayCount > 0 ? "danger" : "success"}
        />
        <KpiCard label="Team Size" value={data.teamSize} variant="default" />
      </div>

      <Card data-testid="card-rep-list">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rep Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Rep</TableHead>
                <TableHead className="text-center">First Seen</TableHead>
                <TableHead className="text-center">Last Seen</TableHead>
                <TableHead className="text-center">Minutes</TableHead>
                <TableHead className="text-center">Today</TableHead>
                <TableHead className="text-center">Period</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.reps.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">No team members found</TableCell>
                </TableRow>
              )}
              {data.reps.map(rep => (
                <TableRow
                  key={rep.id}
                  className={rep.isZeroDay ? "bg-red-50 dark:bg-red-950/20" : ""}
                  data-testid={`row-rep-${rep.repId}`}
                >
                  <TableCell>
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${rep.isActiveToday ? "bg-green-500" : "bg-gray-300"}`} />
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium">{rep.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{rep.repId}</span>
                    </div>
                    {rep.deviceType && (
                      <span className="text-xs text-muted-foreground capitalize">{rep.deviceType}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm">{formatTime(rep.firstSeen)}</TableCell>
                  <TableCell className="text-center text-sm">{formatTime(rep.lastSeen)}</TableCell>
                  <TableCell className="text-center text-sm">{rep.minutesActive || "—"}</TableCell>
                  <TableCell className="text-center font-medium">{rep.todayOrders}</TableCell>
                  <TableCell className="text-center">{rep.periodOrders}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${parseFloat(rep.periodCommission).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
