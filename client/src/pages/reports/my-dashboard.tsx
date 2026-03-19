import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { KpiCard } from "@/components/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, DollarSign, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface MyDashboardData {
  todayOrders: number;
  periodOrders: number;
  periodCommission: string;
  mtdOrders: number;
  activityToday: {
    firstSeen: string | null;
    lastSeen: string | null;
    minutesActive: number;
  };
  latestStatement: {
    id: string;
    periodStart: string | null;
    periodEnd: string | null;
    netPay: string | null;
    status: string;
  } | null;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export default function MyDashboard() {
  const { data, isLoading } = useQuery<MyDashboardData>({
    queryKey: ["/api/reports/my/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/reports/my/dashboard", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="my-dashboard">
      <h1 className="text-xl font-bold" data-testid="text-dashboard-title">My Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Orders Today" value={data.todayOrders} variant="default" />
        <KpiCard label="Period Orders" value={data.periodOrders} variant="default" />
        <KpiCard label="MTD Orders" value={data.mtdOrders} variant="default" />
      </div>

      <Card data-testid="card-period-commission">
        <CardContent className="p-6 flex items-center gap-4">
          <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
            <DollarSign className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Period Commission Earned</p>
            <p className="text-3xl font-bold" data-testid="text-period-commission">
              ${parseFloat(data.periodCommission).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-activity-today">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" /> Activity Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              First active: <span className="font-medium text-foreground">{formatTime(data.activityToday.firstSeen)}</span>
              {" · "}
              Last active: <span className="font-medium text-foreground">{formatTime(data.activityToday.lastSeen)}</span>
              {" · "}
              <span className="font-medium text-foreground">{data.activityToday.minutesActive} min</span>
            </p>
          </CardContent>
        </Card>

        {data.latestStatement && (
          <Card data-testid="card-latest-statement">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" /> Latest Pay Statement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {data.latestStatement.periodStart} — {data.latestStatement.periodEnd}
                  </p>
                  <p className="text-lg font-bold">
                    ${parseFloat(data.latestStatement.netPay || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <Badge variant="outline" data-testid="badge-statement-status">{data.latestStatement.status}</Badge>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
