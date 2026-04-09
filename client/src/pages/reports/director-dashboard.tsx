import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface TeamData {
  manager: { id: string; name: string };
  repCount: number;
  totalOrders: number;
  totalInstalls: number;
  totalCommission: string;
  avgCommissionPerRep: string;
}

interface LeaderboardEntry {
  repId: string;
  userName: string;
  role: string | null;
  managerName: string | null;
  totalOrders: number;
  totalInstalls: number;
  totalCommission: string;
  installRate: number;
}

function getDefaultPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const mm = String(month + 1).padStart(2, "0");
  if (day <= 15) {
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-15` };
  }
  return { from: `${year}-${mm}-16`, to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

export default function DirectorDashboard() {
  const defaultPeriod = getDefaultPeriod();
  const [dateFrom, setDateFrom] = useState(defaultPeriod.from);
  const [dateTo, setDateTo] = useState(defaultPeriod.to);

  const { data: teamData, isLoading: teamsLoading } = useQuery<{ teams: TeamData[]; dateFrom: string; dateTo: string }>({
    queryKey: ["/api/reports/director/team-comparison", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/reports/director/team-comparison?dateFrom=${dateFrom}&dateTo=${dateTo}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: lbData, isLoading: lbLoading } = useQuery<{ leaderboard: LeaderboardEntry[]; dateFrom: string; dateTo: string }>({
    queryKey: ["/api/reports/director/rep-leaderboard", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/reports/director/rep-leaderboard?dateFrom=${dateFrom}&dateTo=${dateTo}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="director-dashboard">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <h1 className="text-xl font-bold" data-testid="text-dashboard-title">Director Dashboard</h1>
        <div className="flex items-center gap-2">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" data-testid="input-date-from" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" data-testid="input-date-to" />
          </div>
        </div>
      </div>

      <Card data-testid="card-team-comparison">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> Team Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {teamsLoading ? (
            <div className="p-4"><Skeleton className="h-32" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Manager</TableHead>
                  <TableHead className="text-center">Reps</TableHead>
                  <TableHead className="text-center">Orders</TableHead>
                  <TableHead className="text-center">Installs</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Avg/Rep</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!teamData?.teams || teamData.teams.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No teams found</TableCell>
                  </TableRow>
                )}
                {teamData?.teams.map(team => (
                  <TableRow key={team.manager.id} data-testid={`row-team-${team.manager.id}`}>
                    <TableCell className="font-medium">{team.manager.name}</TableCell>
                    <TableCell className="text-center">{team.repCount}</TableCell>
                    <TableCell className="text-center">{team.totalOrders}</TableCell>
                    <TableCell className="text-center">{team.totalInstalls}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${parseFloat(team.totalCommission).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${parseFloat(team.avgCommissionPerRep).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-leaderboard">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="w-4 h-4" /> Rep Leaderboard (Top 20)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {lbLoading ? (
            <div className="p-4"><Skeleton className="h-48" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Rep</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead className="text-center">Orders</TableHead>
                  <TableHead className="text-center">Installs</TableHead>
                  <TableHead className="text-center">Install %</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!lbData?.leaderboard || lbData.leaderboard.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No data for selected period</TableCell>
                  </TableRow>
                )}
                {lbData?.leaderboard.map((rep, i) => (
                  <TableRow key={rep.repId} data-testid={`row-lb-${rep.repId}`}>
                    <TableCell>
                      {i < 3 ? (
                        <Badge variant={i === 0 ? "default" : "secondary"} className="w-6 h-6 flex items-center justify-center p-0 text-xs">{i + 1}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">{i + 1}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{rep.userName}</div>
                      <div className="text-xs text-muted-foreground">{rep.repId} · {rep.role}</div>
                    </TableCell>
                    <TableCell className="text-sm">{rep.managerName || "—"}</TableCell>
                    <TableCell className="text-center font-medium">{rep.totalOrders}</TableCell>
                    <TableCell className="text-center">{rep.totalInstalls}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={rep.installRate >= 70 ? "default" : rep.installRate >= 50 ? "secondary" : "destructive"} className="text-xs">
                        {rep.installRate}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${parseFloat(rep.totalCommission).toLocaleString("en-US", { minimumFractionDigits: 2 })}
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
