import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { ProductionMetricsModule } from "@/components/production-metrics-card";
import { DashboardChartsModule } from "@/components/dashboard-charts";
import { NextDayInstallsCard } from "@/components/next-day-installs";
import { TeamBreakdownByRepTable } from "@/components/team-breakdown-table";
import { Leaderboard } from "@/components/leaderboard";
import { QuotaProgress } from "@/components/quota-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface DashboardSummary {
  weekly: {
    personal: {
      soldCount: number;
      connectedCount: number;
      earnedDollars: number;
      deltas: {
        soldCount: { value: number; percent: number | null };
        connectedCount: { value: number; percent: number | null };
        earnedDollars: { value: number; percent: number | null };
      };
      sparklineSeries: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>;
    };
    team: {
      soldCount: number;
      connectedCount: number;
      earnedDollars: number;
      deltas: {
        soldCount: { value: number; percent: number | null };
        connectedCount: { value: number; percent: number | null };
        earnedDollars: { value: number; percent: number | null };
      };
      sparklineSeries: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>;
    } | null;
  };
  mtd: {
    personal: {
      soldCount: number;
      connectedCount: number;
      earnedDollars: number;
      deltas: {
        soldCount: { value: number; percent: number | null };
        connectedCount: { value: number; percent: number | null };
        earnedDollars: { value: number; percent: number | null };
      };
      sparklineSeries: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>;
    };
    team: {
      soldCount: number;
      connectedCount: number;
      earnedDollars: number;
      deltas: {
        soldCount: { value: number; percent: number | null };
        connectedCount: { value: number; percent: number | null };
        earnedDollars: { value: number; percent: number | null };
      };
      sparklineSeries: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>;
    } | null;
  };
  breakdowns: {
    teamByRep: Array<{
      id: string;
      name: string;
      repId: string;
      soldCount: number;
      connectedCount: number;
      approvedCount: number;
      earnedDollars: number;
    }> | null;
    teamByManager: null;
  };
}

export default function SalesDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const isRep = user?.role === "REP" || user?.role === "MDU";
  const hasViewModeToggle = ["LEAD", "MANAGER"].includes(user?.role || "");
  const canViewGlobal = user?.role === "MANAGER";
  const [viewMode, setViewMode] = useState<"own" | "team" | "global">("team");

  const effectiveViewMode = hasViewModeToggle ? viewMode : undefined;
  const { data: summary, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", effectiveViewMode || "default"],
    queryFn: async () => {
      const params = effectiveViewMode ? `?viewMode=${effectiveViewMode}` : "";
      const res = await fetch(`/api/dashboard/summary${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const hasTeamData = !isRep && summary?.weekly.team && viewMode !== "own";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-dashboard-title">{t("dashboard.title")}</h1>
        <p className="text-muted-foreground">
          {hasViewModeToggle && viewMode === "global" ? t("dashboard.orgWideOverview") :
           hasViewModeToggle && viewMode === "team" ? `${t("dashboard.welcomeBack")}, ${user?.name} — ${t("dashboard.viewingTeam")}` :
           `${t("dashboard.welcomeBack")}, ${user?.name}`}
        </p>
        {hasViewModeToggle && (
          <div className="flex items-center gap-1 mt-2 bg-muted rounded-lg p-1 w-fit">
            <Button
              variant={viewMode === "own" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setViewMode("own")}
              data-testid="button-dashboard-view-own"
            >
              {t("commissions.mySales")}
            </Button>
            <Button
              variant={viewMode === "team" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setViewMode("team")}
              data-testid="button-dashboard-view-team"
            >
              {t("commissions.myTeam")}
            </Button>
            {canViewGlobal && (
              <Button
                variant={viewMode === "global" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-3"
                onClick={() => setViewMode("global")}
                data-testid="button-dashboard-view-global"
              >
                {t("commissions.global")}
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-4 w-24 mb-4" />
                  <Skeleton className="h-8 w-32 mb-2" />
                  <Skeleton className="h-8 w-32 mb-2" />
                  <Skeleton className="h-8 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <NextDayInstallsCard />

              <ProductionMetricsModule
                personalWeekly={summary.weekly.personal}
                personalMtd={summary.mtd.personal}
                teamWeekly={hasTeamData ? summary.weekly.team : null}
                teamMtd={hasTeamData ? summary.mtd.team : null}
              />
            </div>
            <div className="space-y-6">
              <QuotaProgress />
              <Leaderboard />
            </div>
          </div>

          <DashboardChartsModule
            personalWeekly={summary.weekly.personal.sparklineSeries}
            personalMtd={summary.mtd.personal.sparklineSeries}
            teamWeekly={hasTeamData ? (summary.weekly.team?.sparklineSeries || null) : null}
            teamMtd={hasTeamData ? (summary.mtd.team?.sparklineSeries || null) : null}
          />

          {summary.breakdowns.teamByRep && summary.breakdowns.teamByRep.length > 0 && viewMode !== "own" && (
            <TeamBreakdownByRepTable
              data={summary.breakdowns.teamByRep}
              title={t("dashboard.teamBreakdownMtd")}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
