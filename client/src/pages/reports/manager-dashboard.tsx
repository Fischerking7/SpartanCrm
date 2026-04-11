import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { KpiCard } from "@/components/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, AlertTriangle, ArrowRight, MessageSquare } from "lucide-react";
import TeamHealthCard from "./team-health-card";
import TeamEarningsPreview from "./team-earnings-preview";
import { Link } from "wouter";

interface TeamMessage {
  id: string;
  subject: string;
  body: string;
  fromUserName: string;
  fromRepId: string;
  toUserId: string;
  isRead: boolean;
  createdAt: string;
  category: string | null;
  parentMessageId: string | null;
}

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

interface CoachingAlert {
  repId: string;
  name: string;
  alerts: Array<{ type: string; severity: string; message: string }>;
  trend: string;
}

interface CoachingScorecardsData {
  needsAttention: CoachingAlert[];
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<ManagerDashboardData>({
    queryKey: ["/api/reports/manager/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/reports/manager/dashboard", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: coachingData } = useQuery<CoachingScorecardsData>({
    queryKey: ["/api/coaching/scorecards", "MONTH"],
    queryFn: async () => {
      const res = await fetch("/api/coaching/scorecards?period=MONTH", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: teamMessages } = useQuery<TeamMessage[]>({
    queryKey: ["/api/messages/team-inbox"],
    queryFn: async () => {
      const res = await fetch("/api/messages/team-inbox", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 30000,
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

      <TeamEarningsPreview />

      {coachingData && coachingData.needsAttention.length > 0 && (
        <Card data-testid="card-coaching-alerts-dashboard">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                Coaching Alerts ({coachingData.needsAttention.length})
              </CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/coaching-scorecards" data-testid="link-coaching-scorecards">
                  View All <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {coachingData.needsAttention.slice(0, 5).map((rep) => (
              <div key={rep.repId} className="flex items-start justify-between gap-2 py-1.5 border-b last:border-0" data-testid={`coaching-alert-${rep.repId}`}>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{rep.name}</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {rep.alerts.slice(0, 2).map((alert, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {alert.message}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Badge variant={rep.trend === "down" ? "destructive" : "outline"} className="text-xs shrink-0">
                  {rep.trend}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {teamMessages && teamMessages.length > 0 && (
        <Card data-testid="team-inbox-preview">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Team Messages
                {(() => {
                  const unreadCount = teamMessages.filter(m => !m.isRead && m.toUserId === user?.id).length;
                  return unreadCount > 0 ? (
                    <Badge variant="destructive" className="text-[10px] h-5">{unreadCount}</Badge>
                  ) : null;
                })()}
              </CardTitle>
              <Link href="/messages">
                <Button variant="ghost" size="sm" className="text-xs" data-testid="link-view-all-messages">
                  View All <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamMessages.filter(m => !m.parentMessageId).slice(0, 5).map((msg) => (
              <div key={msg.id} className={`flex items-start justify-between gap-2 py-1.5 border-b last:border-0 ${!msg.isRead ? "bg-muted/30" : ""}`} data-testid={`team-msg-${msg.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{msg.fromUserName || "Unknown"}</span>
                    {!msg.isRead && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{msg.subject}</p>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  {new Date(msg.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-base font-semibold mb-3">Team Health</h2>
        <TeamHealthCard />
      </div>
    </div>
  );
}
