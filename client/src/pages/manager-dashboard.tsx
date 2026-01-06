import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Target, CheckCircle, TrendingUp, Filter } from "lucide-react";

type Cadence = "DAY" | "WEEK" | "MONTH";

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

  const { data, isLoading } = useQuery<ProductionData>({
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Team Production</h1>
          <p className="text-muted-foreground">Monitor your team's sales performance</p>
        </div>
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

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Target className="h-4 w-4" />
                <span className="text-sm font-medium">Sold</span>
              </div>
              <div className="text-3xl font-bold" data-testid="text-sold">
                {data?.summary.sold || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">Connected</span>
              </div>
              <div className="text-3xl font-bold" data-testid="text-connected">
                {data?.summary.connected || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Approved</span>
              </div>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-approved">
                {data?.summary.approved || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-medium">Conversion</span>
              </div>
              <div className="text-3xl font-bold" data-testid="text-conversion">
                {data?.summary.conversionPercent || 0}%
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Team Production</CardTitle>
              <CardDescription>Production by rep for {cadenceLabels[cadence].toLowerCase()}</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
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
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data?.breakdown || []}
            isLoading={isLoading}
            emptyMessage="No production data available"
            testId="table-team-production"
          />
        </CardContent>
      </Card>
    </div>
  );
}
