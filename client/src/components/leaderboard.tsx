import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAuthHeaders } from "@/lib/auth";
import { Trophy, Medal, Award, TrendingUp, Users } from "lucide-react";
import { useState } from "react";

interface LeaderboardEntry {
  userId: string;
  repId: string;
  name: string;
  role: string;
  soldCount: number;
  connectsCount: number;
  earnedDollars: number;
  isCurrentUser: boolean;
  rank: number;
}

interface LeaderboardData {
  period: string;
  startDate: string;
  endDate: string;
  leaderboard: LeaderboardEntry[];
  myRanking: LeaderboardEntry | null;
  totalParticipants: number;
  hideOthersEarnings?: boolean;
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
  if (rank === 3) return <Award className="h-5 w-5 text-amber-600" />;
  return <span className="text-sm font-bold text-muted-foreground w-5 text-center">{rank}</span>;
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function getRankBgClass(rank: number, isCurrentUser: boolean) {
  if (isCurrentUser) return "bg-primary/10 border-primary/30";
  if (rank === 1) return "bg-yellow-500/10";
  if (rank === 2) return "bg-gray-400/10";
  if (rank === 3) return "bg-amber-600/10";
  return "";
}

export function Leaderboard() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");

  const { data, isLoading } = useQuery<LeaderboardData>({
    queryKey: ["/api/dashboard/leaderboard", period],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/leaderboard?period=${period}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch leaderboard");
      return res.json();
    },
  });

  const formatPeriodLabel = () => {
    if (!data) return "";
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (period === "daily") {
      return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Leaderboard</CardTitle>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <TabsList className="h-8">
              <TabsTrigger value="daily" className="text-xs px-2" data-testid="tab-leaderboard-daily">Today</TabsTrigger>
              <TabsTrigger value="weekly" className="text-xs px-2" data-testid="tab-leaderboard-weekly">Week</TabsTrigger>
              <TabsTrigger value="monthly" className="text-xs px-2" data-testid="tab-leaderboard-monthly">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {data && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>{data.totalParticipants} participants</span>
            <span>•</span>
            <span>{formatPeriodLabel()}</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="h-5 w-5" />
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : data?.leaderboard.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Trophy className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No sales activity yet this {period === "daily" ? "day" : period === "weekly" ? "week" : "month"}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              {data?.leaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${getRankBgClass(entry.rank, entry.isCurrentUser)}`}
                  data-testid={`leaderboard-entry-${entry.rank}`}
                >
                  <div className="flex items-center justify-center w-6">
                    {getRankIcon(entry.rank)}
                  </div>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className={entry.isCurrentUser ? "bg-primary text-primary-foreground" : ""}>
                      {getInitials(entry.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium truncate ${entry.isCurrentUser ? "text-primary" : ""}`}>
                        {entry.name}
                      </span>
                      {entry.isCurrentUser && (
                        <Badge variant="outline" className="text-[10px] h-4">You</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.soldCount} sales • {entry.connectsCount} connects
                    </div>
                  </div>
                  {(!data?.hideOthersEarnings || entry.isCurrentUser) && (
                    <div className="text-right">
                      <span className="font-mono font-semibold text-sm">
                        ${entry.earnedDollars.toFixed(0)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {data?.myRanking && !data.leaderboard.find(e => e.isCurrentUser) && (
              <div className="border-t pt-2 mt-2">
                <div className="text-xs text-muted-foreground mb-1">Your Position</div>
                <div
                  className={`flex items-center gap-3 p-2 rounded-lg bg-primary/10 border border-primary/30`}
                >
                  <div className="flex items-center justify-center w-6">
                    <span className="text-sm font-bold text-muted-foreground">{data.myRanking.rank}</span>
                  </div>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {getInitials(data.myRanking.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-primary">{data.myRanking.name}</span>
                    <div className="text-xs text-muted-foreground">
                      {data.myRanking.soldCount} sales • {data.myRanking.connectsCount} connects
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-semibold text-sm">
                      ${data.myRanking.earnedDollars.toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
