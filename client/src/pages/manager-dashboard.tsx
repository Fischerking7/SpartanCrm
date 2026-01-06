import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { ProductionMetricsModule } from "@/components/production-metrics-card";
import { TeamBreakdownByRepTable } from "@/components/team-breakdown-table";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Filter } from "lucide-react";

type Cadence = "DAY" | "WEEK" | "MONTH";

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

interface FilterOptions {
  supervisors: Array<{ id: string; name: string }>;
  reps: Array<{ id: string; name: string; repId: string }>;
  providers: Array<{ id: string; name: string }>;
}

const __ALL__ = "__ALL__";

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [cadence, setCadence] = useState<Cadence>("WEEK");
  const [supervisorFilter, setSupervisorFilter] = useState<string>(__ALL__);
  const [repFilter, setRepFilter] = useState<string>(__ALL__);
  const [providerFilter, setProviderFilter] = useState<string>(__ALL__);

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    params.set("cadence", cadence);
    if (supervisorFilter !== __ALL__) params.set("supervisorId", supervisorFilter);
    if (repFilter !== __ALL__) params.set("repId", repFilter);
    if (providerFilter !== __ALL__) params.set("providerId", providerFilter);
    return params.toString();
  };

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: filteredData, isLoading: filteredLoading } = useQuery<ProductionData>({
    queryKey: ["/api/dashboard/production/filtered", cadence, supervisorFilter, repFilter, providerFilter],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/production/filtered?${buildQueryParams()}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch production data");
      return res.json();
    },
  });

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ["/api/team/filter-options"],
    queryFn: async () => {
      const res = await fetch("/api/team/filter-options", { headers: getAuthHeaders() });
      if (!res.ok) return { supervisors: [], reps: [], providers: [] };
      return res.json();
    },
  });

  const cadenceLabels: Record<Cadence, string> = {
    DAY: "Today",
    WEEK: "This Week",
    MONTH: "This Month",
  };

  const clearFilters = () => {
    setSupervisorFilter(__ALL__);
    setRepFilter(__ALL__);
    setProviderFilter(__ALL__);
  };

  const hasFilters = supervisorFilter !== __ALL__ || repFilter !== __ALL__ || providerFilter !== __ALL__;

  const columns = [
    {
      key: "name",
      header: "Rep",
      cell: (row: ProductionData["breakdown"][0]) => (
        <div>
          <span className="font-medium">{row.name}</span>
          {row.repId && <span className="text-xs text-muted-foreground ml-2 font-mono">{row.repId}</span>}
        </div>
      ),
    },
    {
      key: "sold",
      header: "Sold",
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block">{row.sold}</span>
      ),
      className: "text-right",
    },
    {
      key: "connected",
      header: "Connected",
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block font-medium">{row.connected}</span>
      ),
      className: "text-right",
    },
    {
      key: "approved",
      header: "Approved",
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block text-green-600 dark:text-green-400">{row.approved}</span>
      ),
      className: "text-right",
    },
    {
      key: "conversion",
      header: "Conversion",
      cell: (row: ProductionData["breakdown"][0]) => (
        <span className="font-mono text-right block">{row.conversionPercent}%</span>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back, {user?.name}
        </p>
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
        <ProductionMetricsModule
          personalWeekly={summary.weekly.personal}
          personalMtd={summary.mtd.personal}
          teamWeekly={summary.weekly.team}
          teamMtd={summary.mtd.team}
        />
      ) : null}

      {summary?.breakdowns.teamByRep && summary.breakdowns.teamByRep.length > 0 && (
        <TeamBreakdownByRepTable
          data={summary.breakdowns.teamByRep}
          title="Team Breakdown (MTD)"
        />
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Filtered Production</CardTitle>
              <CardDescription>Production by rep with filters</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1 bg-muted p-1 rounded-md">
                {(["DAY", "WEEK", "MONTH"] as Cadence[]).map((c) => (
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
          <div className="flex items-center gap-2 flex-wrap pt-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={supervisorFilter} onValueChange={setSupervisorFilter}>
              <SelectTrigger className="w-40" data-testid="select-supervisor-filter">
                <SelectValue placeholder="Supervisor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={__ALL__}>All Supervisors</SelectItem>
                {filterOptions?.supervisors.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={repFilter} onValueChange={setRepFilter}>
              <SelectTrigger className="w-40" data-testid="select-rep-filter">
                <SelectValue placeholder="Rep" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={__ALL__}>All Reps</SelectItem>
                {filterOptions?.reps.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-40" data-testid="select-provider-filter">
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={__ALL__}>All Providers</SelectItem>
                {filterOptions?.providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredData?.breakdown || []}
            isLoading={filteredLoading}
            emptyMessage="No production data available"
            testId="table-team-production"
          />
        </CardContent>
      </Card>
    </div>
  );
}
