import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { ProductionMetricsModule } from "@/components/production-metrics-card";
import { DashboardChartsModule } from "@/components/dashboard-charts";
import { NextDayInstallsCard } from "@/components/next-day-installs";
import { TeamBreakdownByManagerTable, TeamBreakdownByRepTable } from "@/components/team-breakdown-table";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight } from "lucide-react";
import AdminDashboard from "./admin-dashboard";

type Cadence = "WEEK" | "MONTH";

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
    teamByManager: Array<{
      id: string;
      name: string;
      soldCount: number;
      connectedCount: number;
      approvedCount: number;
      earnedDollars: number;
    }> | null;
  };
}

interface ProductionData {
  summary: {
    sold: number;
    connected: number;
    approved: number;
    conversionPercent: number;
  };
  breakdown: Array<{
    id: string;
    name: string;
    repId?: string;
    sold: number;
    connected: number;
    approved: number;
    conversionPercent: number;
  }>;
}

export default function ExecutiveDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<"my" | "team" | "global">("my");
  const [cadence, setCadence] = useState<Cadence>("WEEK");
  const [drillDownManager, setDrillDownManager] = useState<{ id: string; name: string } | null>(null);

  const apiViewMode = viewMode === "my" ? "own" : viewMode === "team" ? "team" : "global";
  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary", apiViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/summary?viewMode=${apiViewMode}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: managerData, isLoading: managerLoading } = useQuery<ProductionData>({
    queryKey: ["/api/dashboard/production/manager", drillDownManager?.id, cadence],
    queryFn: async () => {
      if (!drillDownManager) return null;
      const res = await fetch(`/api/dashboard/production/manager/${drillDownManager.id}?cadence=${cadence}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch manager data");
      return res.json();
    },
    enabled: !!drillDownManager,
  });

  const cadenceLabels: Record<Cadence, string> = {
    WEEK: t("dashboard.thisWeek"),
    MONTH: t("dashboard.thisMonth"),
  };

  const managerColumns = [
    {
      key: "name",
      header: t("dashboard.manager"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <Button
          variant="ghost"
          className="p-0 h-auto font-medium hover:underline"
          onClick={() => setDrillDownManager({ id: row.id, name: row.name })}
          data-testid={`button-drill-down-${row.id}`}
        >
          {row.name}
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      ),
    },
    {
      key: "sold",
      header: t("dashboard.sold"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block">{row.sold}</span>
      ),
      className: "text-right",
    },
    {
      key: "connected",
      header: t("dashboard.connected"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block font-medium">{row.connected}</span>
      ),
      className: "text-right",
    },
    {
      key: "approved",
      header: t("dashboard.approved"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block text-green-600 dark:text-green-400">{row.approved}</span>
      ),
      className: "text-right",
    },
    {
      key: "conversion",
      header: t("dashboard.conversion"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block">{row.conversionPercent}%</span>
      ),
      className: "text-right",
    },
  ];

  const repColumns = [
    {
      key: "name",
      header: t("dashboard.rep"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <div>
          <span className="font-medium">{row.name}</span>
          {row.repId && <span className="text-xs text-muted-foreground ml-2 font-mono">{row.repId}</span>}
        </div>
      ),
    },
    {
      key: "sold",
      header: t("dashboard.sold"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block">{row.sold}</span>
      ),
      className: "text-right",
    },
    {
      key: "connected",
      header: t("dashboard.connected"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block font-medium">{row.connected}</span>
      ),
      className: "text-right",
    },
    {
      key: "approved",
      header: t("dashboard.approved"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block text-green-600 dark:text-green-400">{row.approved}</span>
      ),
      className: "text-right",
    },
    {
      key: "conversion",
      header: t("dashboard.conversion"),
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block">{row.conversionPercent}%</span>
      ),
      className: "text-right",
    },
  ];

  const viewToggle = (
    <div className="flex items-center gap-1 bg-muted rounded-lg p-1" data-testid="exec-dashboard-view-toggle">
      <Button size="sm" variant={viewMode === "my" ? "default" : "ghost"} className="h-7 text-xs px-3" onClick={() => setViewMode("my")} data-testid="button-exec-view-my">
        {t("commissions.mySales")}
      </Button>
      <Button size="sm" variant={viewMode === "team" ? "default" : "ghost"} className="h-7 text-xs px-3" onClick={() => setViewMode("team")} data-testid="button-exec-view-team">
        {t("commissions.myTeam")}
      </Button>
      <Button size="sm" variant={viewMode === "global" ? "default" : "ghost"} className="h-7 text-xs px-3" onClick={() => setViewMode("global")} data-testid="button-exec-view-global">
        {t("commissions.global")}
      </Button>
    </div>
  );

  if (viewMode === "global") {
    return (
      <div>
        <div className="px-6 pt-6 pb-0 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-exec-dashboard-title">{t("dashboard.title")}</h1>
            <p className="text-muted-foreground">{t("dashboard.orgWideOverview")}</p>
            <div className="mt-2">{viewToggle}</div>
          </div>
        </div>
        <AdminDashboard hideHeader />
      </div>
    );
  }

  const showTeamData = viewMode === "team" && summary?.weekly.team;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-exec-dashboard-title">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground">
            {viewMode === "team"
              ? `${t("dashboard.welcomeBack")}, ${user?.name} — ${t("dashboard.viewingTeam")}`
              : `${t("dashboard.welcomeBack")}, ${user?.name}`}
          </p>
          <div className="mt-2">{viewToggle}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted p-1 rounded-md">
            {(["WEEK", "MONTH"] as Cadence[]).map((c) => (
              <Button
                key={c}
                variant={cadence === c ? "default" : "ghost"}
                size="sm"
                onClick={() => setCadence(c)}
                data-testid={`button-cadence-${c.toLowerCase()}`}
              >
                {cadenceLabels[c]}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {summaryLoading ? (
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
          <NextDayInstallsCard />
          <ProductionMetricsModule
            personalWeekly={summary.weekly.personal}
            personalMtd={summary.mtd.personal}
            teamWeekly={showTeamData ? summary.weekly.team : null}
            teamMtd={showTeamData ? summary.mtd.team : null}
          />
          <DashboardChartsModule
            personalWeekly={summary.weekly.personal.sparklineSeries}
            personalMtd={summary.mtd.personal.sparklineSeries}
            teamWeekly={showTeamData ? (summary.weekly.team?.sparklineSeries || null) : null}
            teamMtd={showTeamData ? (summary.mtd.team?.sparklineSeries || null) : null}
          />
        </>
      ) : null}

      {viewMode === "team" && summary?.breakdowns.teamByManager && summary.breakdowns.teamByManager.length > 0 && (
        <TeamBreakdownByManagerTable
          data={summary.breakdowns.teamByManager}
          title={t("dashboard.managerBreakdownMtd")}
        />
      )}

      {viewMode === "team" && summary?.breakdowns.teamByRep && summary.breakdowns.teamByRep.length > 0 && (
        <TeamBreakdownByRepTable
          data={summary.breakdowns.teamByRep}
          title={t("dashboard.allRepsBreakdownMtd")}
        />
      )}

      <Dialog open={!!drillDownManager} onOpenChange={() => setDrillDownManager(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("dashboard.managersTeam", { name: drillDownManager?.name })}</DialogTitle>
            <DialogDescription>
              {t("dashboard.repProductionFor", { cadence: cadenceLabels[cadence].toLowerCase() })}
            </DialogDescription>
          </DialogHeader>
          
          {managerLoading ? (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
              <Skeleton className="h-48" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-4">
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">{t("dashboard.sold")}</div>
                  <div className="text-xl font-bold">{managerData?.summary.sold || 0}</div>
                </div>
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">{t("dashboard.connected")}</div>
                  <div className="text-xl font-bold">{managerData?.summary.connected || 0}</div>
                </div>
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">{t("dashboard.approved")}</div>
                  <div className="text-xl font-bold text-green-600">{managerData?.summary.approved || 0}</div>
                </div>
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">{t("dashboard.conversion")}</div>
                  <div className="text-xl font-bold">{managerData?.summary.conversionPercent || 0}%</div>
                </div>
              </div>
              <DataTable
                columns={repColumns}
                data={managerData?.breakdown || []}
                isLoading={managerLoading}
                emptyMessage={t("dashboard.noRepData")}
                testId="table-drill-down-reps"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
