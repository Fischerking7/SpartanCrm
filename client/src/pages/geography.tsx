import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  MapPin,
  Users,
  TrendingUp,
  Search,
  Globe,
  Circle,
  BarChart3,
  Target,
  Layers,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6"];

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="geo-error-state">
      <AlertTriangle className="h-10 w-10 text-destructive mb-3" />
      <p className="text-lg font-medium mb-1">Failed to load data</p>
      <p className="text-sm text-muted-foreground mb-4">Something went wrong. Please try again.</p>
      <Button variant="outline" onClick={onRetry} data-testid="button-geo-retry">Retry</Button>
    </div>
  );
}

function formatTimeAgo(dateStr: string | null) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type TeamMember = {
  id: string;
  name: string;
  repId: string;
  role: string;
  lastLoginLocation: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  isOnline: boolean;
};

type RegionData = { name: string; total: number; completed: number; revenue: number };
type LeadRegion = { name: string; total: number; converted: number; active: number; lost: number; conversionRate: number };
type RepTerritory = {
  repId: string;
  name: string;
  role: string;
  cityCount: number;
  zipCount: number;
  cities: string[];
  zips: string[];
  totalOrders: number;
  completedOrders: number;
  completionRate: number;
};

function TeamLocationsTab() {
  const [search, setSearch] = useState("");
  const { data, isLoading, isError, refetch } = useQuery<{ members: TeamMember[]; locationCounts: Record<string, number> }>({
    queryKey: ["/api/geo/team-locations"],
    queryFn: async () => {
      const res = await fetch("/api/geo/team-locations", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const members = data?.members || [];
  const locationCounts = data?.locationCounts || {};
  const filtered = members.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.repId.toLowerCase().includes(q) || (m.lastLoginLocation || "").toLowerCase().includes(q);
  });

  const onlineCount = members.filter(m => m.isOnline).length;
  const locEntries = Object.entries(locationCounts).sort(([, a], [, b]) => b - a);
  const locationChartData = locEntries.slice(0, 10).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card data-testid="stat-geo-total-members">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Team Size</p>
            </div>
            <p className="text-2xl font-bold font-mono">{members.length}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-geo-online">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Circle className="h-4 w-4 text-green-500" />
              <p className="text-xs font-medium uppercase tracking-wide">Online Now</p>
            </div>
            <p className="text-2xl font-bold font-mono">{onlineCount}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-geo-locations">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MapPin className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Locations</p>
            </div>
            <p className="text-2xl font-bold font-mono">{locEntries.length}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-geo-no-location">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Globe className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">No Location</p>
            </div>
            <p className="text-2xl font-bold font-mono">{members.filter(m => !m.lastLoginLocation).length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {locationChartData.length > 0 && (
          <Card data-testid="card-geo-location-chart">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Team by Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={locationChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                    <Tooltip />
                    <Bar dataKey="value" name="Members" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-geo-location-list">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Location Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {locEntries.map(([loc, count]) => (
                <div key={loc} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm">{loc}</span>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{count}</Badge>
                </div>
              ))}
              {locEntries.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No location data yet</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Team Members</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
                data-testid="input-geo-team-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2.5 px-2 font-medium">Status</th>
                  <th className="text-left py-2.5 px-2 font-medium">Name</th>
                  <th className="text-left py-2.5 px-2 font-medium">Role</th>
                  <th className="text-left py-2.5 px-2 font-medium">Location</th>
                  <th className="text-left py-2.5 px-2 font-medium">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} className="border-b last:border-0 hover-elevate" data-testid={`row-geo-member-${m.repId}`}>
                    <td className="py-2.5 px-2">
                      <Circle className={`h-2.5 w-2.5 ${m.isOnline ? "fill-green-500 text-green-500" : "fill-muted text-muted"}`} />
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.repId}</div>
                    </td>
                    <td className="py-2.5 px-2"><Badge variant="outline" className="text-xs">{m.role}</Badge></td>
                    <td className="py-2.5 px-2">
                      {m.lastLoginLocation ? (
                        <div className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" /><span>{m.lastLoginLocation}</span></div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground">{formatTimeAgo(m.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <p className="py-8 text-center text-muted-foreground">No members found</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SalesByRegionTab() {
  const [rangeDays, setRangeDays] = useState("90");
  const [viewMode, setViewMode] = useState<"city" | "zip">("city");
  const isMobile = useIsMobile();

  const { data, isLoading, isError, refetch } = useQuery<{ byCity: RegionData[]; byZip: RegionData[]; totalOrders: number; rangeDays: number }>({
    queryKey: ["/api/geo/sales-by-region", rangeDays],
    queryFn: async () => {
      const res = await fetch(`/api/geo/sales-by-region?range=${rangeDays}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const regionData = viewMode === "city" ? (data?.byCity || []) : (data?.byZip || []);
  const topRegions = regionData.slice(0, 15);
  const totalRevenue = regionData.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={rangeDays} onValueChange={setRangeDays}>
          <SelectTrigger className="w-36" data-testid="select-geo-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
        <Select value={viewMode} onValueChange={(v) => setViewMode(v as "city" | "zip")}>
          <SelectTrigger className="w-32" data-testid="select-geo-view-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="city">By City</SelectItem>
            <SelectItem value="zip">By Zip Code</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        <Card data-testid="stat-geo-total-orders">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Total Orders</p>
            <p className="text-2xl font-bold font-mono">{data?.totalOrders || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-geo-regions">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Regions</p>
            <p className="text-2xl font-bold font-mono">{regionData.length}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-geo-revenue">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Total Commission</p>
            <p className="text-2xl font-bold font-mono">${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
          </CardContent>
        </Card>
      </div>

      {topRegions.length > 0 && (
        <Card data-testid="card-geo-sales-chart">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Top Regions by Sales Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topRegions.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={isMobile ? 80 : 140} />
                  <Tooltip formatter={(value: number, name: string) => [name === "revenue" ? `$${value.toFixed(2)}` : value, name === "revenue" ? "Commission" : name === "total" ? "Total" : "Connected"]} />
                  <Bar dataKey="total" name="Total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="completed" name="Connected" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">All Regions</CardTitle>
          <CardDescription>{regionData.length} regions found</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2.5 px-2 font-medium">{viewMode === "city" ? "City" : "Zip Code"}</th>
                  <th className="text-right py-2.5 px-2 font-medium">Orders</th>
                  <th className="text-right py-2.5 px-2 font-medium">Connected</th>
                  <th className="text-right py-2.5 px-2 font-medium">Rate</th>
                  <th className="text-right py-2.5 px-2 font-medium">Commission</th>
                </tr>
              </thead>
              <tbody>
                {regionData.slice(0, 50).map(r => (
                  <tr key={r.name} className="border-b last:border-0 hover-elevate" data-testid={`row-region-${r.name}`}>
                    <td className="py-2.5 px-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {r.name}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono">{r.total}</td>
                    <td className="py-2.5 px-2 text-right font-mono">{r.completed}</td>
                    <td className="py-2.5 px-2 text-right">
                      <Badge variant={r.total > 0 && (r.completed / r.total) >= 0.5 ? "default" : "outline"} className="text-xs font-mono">
                        {r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0}%
                      </Badge>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono">${r.revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {regionData.length === 0 && <p className="py-8 text-center text-muted-foreground">No sales data found</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LeadDensityTab() {
  const [viewMode, setViewMode] = useState<"city" | "zip" | "state">("city");

  const { data, isLoading, isError, refetch } = useQuery<{ byCity: LeadRegion[]; byZip: LeadRegion[]; byState: LeadRegion[]; totalLeads: number }>({
    queryKey: ["/api/geo/lead-density"],
    queryFn: async () => {
      const res = await fetch("/api/geo/lead-density", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const regionData = viewMode === "city" ? (data?.byCity || []) : viewMode === "zip" ? (data?.byZip || []) : (data?.byState || []);
  const top10 = regionData.slice(0, 10);
  const totalConverted = regionData.reduce((s, r) => s + r.converted, 0);
  const totalActive = regionData.reduce((s, r) => s + r.active, 0);

  const pieData = [
    { name: "Active", value: totalActive },
    { name: "Converted", value: totalConverted },
    { name: "Lost", value: regionData.reduce((s, r) => s + r.lost, 0) },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <Select value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
        <SelectTrigger className="w-32" data-testid="select-lead-view">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="city">By City</SelectItem>
          <SelectItem value="zip">By Zip Code</SelectItem>
          <SelectItem value="state">By State</SelectItem>
        </SelectContent>
      </Select>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Total Leads</p>
            <p className="text-2xl font-bold font-mono">{data?.totalLeads || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Regions</p>
            <p className="text-2xl font-bold font-mono">{regionData.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Converted</p>
            <p className="text-2xl font-bold font-mono text-green-600">{totalConverted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Active</p>
            <p className="text-2xl font-bold font-mono text-blue-600">{totalActive}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {top10.length > 0 && (
          <Card data-testid="card-lead-density-chart">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Lead Density — Top 10
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top10} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                    <Tooltip />
                    <Bar dataKey="active" name="Active" stackId="a" fill="#3b82f6" />
                    <Bar dataKey="converted" name="Converted" stackId="a" fill="#10b981" />
                    <Bar dataKey="lost" name="Lost" stackId="a" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {pieData.length > 0 && (
          <Card data-testid="card-lead-status-pie">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                Lead Status Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="h-56 w-56 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {pieData.map((_, i) => <Cell key={i} fill={["#3b82f6", "#10b981", "#ef4444"][i]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {pieData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ["#3b82f6", "#10b981", "#ef4444"][i] }} />
                      <span className="text-sm">{d.name}</span>
                      <span className="text-sm font-mono text-muted-foreground">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Lead Density by Region</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2.5 px-2 font-medium">Region</th>
                  <th className="text-right py-2.5 px-2 font-medium">Total</th>
                  <th className="text-right py-2.5 px-2 font-medium">Active</th>
                  <th className="text-right py-2.5 px-2 font-medium">Converted</th>
                  <th className="text-right py-2.5 px-2 font-medium">Lost</th>
                  <th className="text-right py-2.5 px-2 font-medium">Conv. Rate</th>
                </tr>
              </thead>
              <tbody>
                {regionData.slice(0, 50).map(r => (
                  <tr key={r.name} className="border-b last:border-0 hover-elevate" data-testid={`row-lead-${r.name}`}>
                    <td className="py-2.5 px-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {r.name}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono">{r.total}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-blue-600">{r.active}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-green-600">{r.converted}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-red-500">{r.lost}</td>
                    <td className="py-2.5 px-2 text-right">
                      <Badge variant={r.conversionRate >= 30 ? "default" : "outline"} className="text-xs font-mono">
                        {r.conversionRate}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {regionData.length === 0 && <p className="py-8 text-center text-muted-foreground">No lead data found</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RepTerritoryTab() {
  const [rangeDays, setRangeDays] = useState("90");
  const [search, setSearch] = useState("");
  const [expandedRep, setExpandedRep] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ territories: RepTerritory[]; rangeDays: number }>({
    queryKey: ["/api/geo/rep-territory", rangeDays],
    queryFn: async () => {
      const res = await fetch(`/api/geo/rep-territory?range=${rangeDays}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const territories = data?.territories || [];
  const filtered = territories.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.repId.toLowerCase().includes(q) || t.cities.some(c => c.toLowerCase().includes(q)) || t.zips.some(z => z.includes(q));
  });

  const totalCities = new Set(territories.flatMap(t => t.cities)).size;
  const totalZips = new Set(territories.flatMap(t => t.zips)).size;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={rangeDays} onValueChange={setRangeDays}>
          <SelectTrigger className="w-36" data-testid="select-territory-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search rep, city, or zip..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-territory-search"
          />
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Active Reps</p>
            <p className="text-2xl font-bold font-mono">{territories.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Cities Covered</p>
            <p className="text-2xl font-bold font-mono">{totalCities}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Zip Codes</p>
            <p className="text-2xl font-bold font-mono">{totalZips}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Avg Cities/Rep</p>
            <p className="text-2xl font-bold font-mono">{territories.length > 0 ? (totalCities / territories.length).toFixed(1) : 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Rep Territory Coverage</CardTitle>
          <CardDescription>Click a row to see territory details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filtered.map(t => (
              <div key={t.repId} className="border rounded-lg" data-testid={`card-territory-${t.repId}`}>
                <button
                  className="w-full flex items-center justify-between p-3 text-left hover-elevate rounded-lg"
                  onClick={() => setExpandedRep(expandedRep === t.repId ? null : t.repId)}
                  data-testid={`button-expand-${t.repId}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.repId} · {t.role}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-mono">{t.totalOrders} orders</div>
                      <div className="text-xs text-muted-foreground">{t.cityCount} cities · {t.zipCount} zips</div>
                    </div>
                    <div className="w-20">
                      <Progress value={t.completionRate} className="h-2" />
                      <div className="text-xs text-center text-muted-foreground mt-0.5">{t.completionRate}%</div>
                    </div>
                  </div>
                </button>
                {expandedRep === t.repId && (
                  <div className="px-3 pb-3 border-t pt-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Cities ({t.cityCount})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {t.cities.map(c => (
                            <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                          ))}
                          {t.cities.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Zip Codes ({t.zipCount})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {t.zips.map(z => (
                            <Badge key={z} variant="secondary" className="text-xs font-mono">{z}</Badge>
                          ))}
                          {t.zips.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-lg font-bold font-mono">{t.totalOrders}</p>
                        <p className="text-xs text-muted-foreground">Total Orders</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-lg font-bold font-mono text-green-600">{t.completedOrders}</p>
                        <p className="text-xs text-muted-foreground">Connected</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-lg font-bold font-mono">{t.completionRate}%</p>
                        <p className="text-xs text-muted-foreground">Completion</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && <p className="py-8 text-center text-muted-foreground">No territory data found</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Geography() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("team");

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-geography-title">{t("sidebar.menu.geography")}</h1>
        <p className="text-muted-foreground text-sm">Analyze sales performance, lead density, and rep coverage by region</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap w-full h-auto gap-1">
          <TabsTrigger value="team" data-testid="tab-geo-team">
            <Users className="h-4 w-4 mr-1.5" />
            Team Locations
          </TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-geo-sales">
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Sales by Region
          </TabsTrigger>
          <TabsTrigger value="leads" data-testid="tab-geo-leads">
            <Layers className="h-4 w-4 mr-1.5" />
            Lead Density
          </TabsTrigger>
          <TabsTrigger value="territory" data-testid="tab-geo-territory">
            <Target className="h-4 w-4 mr-1.5" />
            Rep Territory
          </TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="mt-4">
          <TeamLocationsTab />
        </TabsContent>
        <TabsContent value="sales" className="mt-4">
          <SalesByRegionTab />
        </TabsContent>
        <TabsContent value="leads" className="mt-4">
          <LeadDensityTab />
        </TabsContent>
        <TabsContent value="territory" className="mt-4">
          <RepTerritoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
