import { useState, useEffect, useRef, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Users,
  TrendingUp,
  Search,
  Globe,
  Circle,
  Target,
  Layers,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
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
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

const ROLE_COLORS: Record<string, string> = {
  ADMIN: "#ef4444",
  OPERATIONS: "#f97316",
  EXECUTIVE: "#8b5cf6",
  DIRECTOR: "#6366f1",
  MANAGER: "#0ea5e9",
  LEAD: "#14b8a6",
  REP: "#3b82f6",
  MDU: "#10b981",
  ACCOUNTING: "#f59e0b",
};

const CITY_COORDS: Record<string, [number, number]> = {
  "New York": [40.7128, -74.006], "Los Angeles": [34.0522, -118.2437], "Chicago": [41.8781, -87.6298],
  "Houston": [29.7604, -95.3698], "Phoenix": [33.4484, -112.074], "Philadelphia": [39.9526, -75.1652],
  "San Antonio": [29.4241, -98.4936], "San Diego": [32.7157, -117.1611], "Dallas": [32.7767, -96.797],
  "San Jose": [37.3382, -121.8863], "Austin": [30.2672, -97.7431], "Jacksonville": [30.3322, -81.6557],
  "Fort Worth": [32.7555, -97.3308], "Columbus": [39.9612, -82.9988], "Charlotte": [35.2271, -80.8431],
  "Indianapolis": [39.7684, -86.1581], "San Francisco": [37.7749, -122.4194], "Seattle": [47.6062, -122.3321],
  "Denver": [39.7392, -104.9903], "Nashville": [36.1627, -86.7816], "Oklahoma City": [35.4676, -97.5164],
  "El Paso": [31.7619, -106.485], "Washington": [38.9072, -77.0369], "Boston": [42.3601, -71.0589],
  "Portland": [45.5152, -122.6784], "Las Vegas": [36.1699, -115.1398], "Memphis": [35.1495, -90.049],
  "Louisville": [38.2527, -85.7585], "Baltimore": [39.2904, -76.6122], "Milwaukee": [43.0389, -87.9065],
  "Albuquerque": [35.0844, -106.6504], "Tucson": [32.2226, -110.9747], "Fresno": [36.7378, -119.7871],
  "Sacramento": [38.5816, -121.4944], "Mesa": [33.4152, -111.8315], "Kansas City": [39.0997, -94.5786],
  "Atlanta": [33.749, -84.388], "Omaha": [41.2565, -95.9345], "Colorado Springs": [38.8339, -104.8214],
  "Raleigh": [35.7796, -78.6382], "Miami": [25.7617, -80.1918], "Tampa": [27.9506, -82.4572],
  "Orlando": [28.5383, -81.3792], "Minneapolis": [44.9778, -93.265], "Cleveland": [41.4993, -81.6944],
  "Pittsburgh": [40.4406, -79.9959], "St. Louis": [38.627, -90.1994], "Cincinnati": [39.1031, -84.512],
  "Detroit": [42.3314, -83.0458], "Salt Lake City": [40.7608, -111.891], "Richmond": [37.5407, -77.436],
  "Norfolk": [36.8508, -76.2859], "Virginia Beach": [36.8529, -75.978], "Boise": [43.615, -116.2023],
  "Spokane": [47.6588, -117.426], "Des Moines": [41.5868, -93.625], "Little Rock": [34.7465, -92.2896],
  "Birmingham": [33.5207, -86.8025], "Charleston": [32.7765, -79.9311], "Columbia": [34.0007, -81.0348],
  "Knoxville": [35.9606, -83.9207], "Chattanooga": [35.0456, -85.3097], "Lexington": [38.0406, -84.5037],
  "Greensboro": [36.0726, -79.792], "Winston-Salem": [36.0999, -80.2442], "Durham": [35.994, -78.8986],
  "Newark": [40.7357, -74.1724], "Jersey City": [40.7178, -74.0431], "Akron": [41.0814, -81.519],
  "Toledo": [41.6528, -83.5379], "Madison": [43.0731, -89.4012], "Baton Rouge": [30.4515, -91.1871],
  "New Orleans": [29.9511, -90.0715], "Anchorage": [61.2181, -149.9003], "Honolulu": [21.3069, -157.8583],
  "Tulsa": [36.154, -95.9928], "Wichita": [37.6872, -97.3301], "Arlington": [32.7357, -97.1081],
  "Aurora": [39.7294, -104.8319], "Bakersfield": [35.3733, -119.0187], "Anaheim": [33.8366, -117.9143],
  "Santa Ana": [33.7455, -117.8677], "Riverside": [33.9806, -117.3755], "Corpus Christi": [27.8006, -97.3964],
  "Henderson": [36.0395, -114.9817], "Stockton": [37.9577, -121.2908], "Irvine": [33.6846, -117.8265],
  "St. Petersburg": [27.7676, -82.6403], "Lubbock": [33.5779, -101.8552], "Chandler": [33.3062, -111.8413],
  "Scottsdale": [33.4942, -111.9261], "Glendale": [33.5387, -112.1860], "Plano": [33.0198, -96.6989],
  "Laredo": [27.5036, -99.5076], "Gilbert": [33.3528, -111.789], "Reno": [39.5296, -119.8138],
};

function lookupCoords(locationStr: string): [number, number] | null {
  const cityPart = locationStr.split(",")[0].trim();
  if (CITY_COORDS[cityPart]) return CITY_COORDS[cityPart];
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    if (cityPart.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(cityPart.toLowerCase())) {
      return coords;
    }
  }
  return null;
}

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

type RegionData = { name: string; total: number; completed: number; revenue: number; avgCommission: number };
type LeadRegion = { name: string; total: number; converted: number; active: number; lost: number; conversionRate: number; topDispositions: DispositionEntry[] };
type DispositionEntry = { disposition: string; count: number };
type OverlapEntry = { zip: string; reps: { repId: string; name: string }[] };
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
  totalLeads: number;
  completionRate: number;
  overlapZipCount: number;
  overlapZips: string[];
};

type SortConfig = { key: string; dir: "asc" | "desc" };

function SortHeader({ label, sortKey, sort, setSort }: { label: string; sortKey: string; sort: SortConfig; setSort: (s: SortConfig) => void }) {
  const active = sort.key === sortKey;
  return (
    <button
      className="flex items-center gap-1 font-medium hover:text-foreground"
      onClick={() => setSort({ key: sortKey, dir: active && sort.dir === "asc" ? "desc" : "asc" })}
      data-testid={`sort-${sortKey}`}
    >
      {label}
      {active && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
}

function TeamMapComponent({ members }: { members: TeamMember[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current).setView([39.8283, -98.5795], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;
    const map = mapInstance.current;

    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
    }

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });
    clusterRef.current = cluster;

    const membersWithLocation = members.filter(m => m.lastLoginLocation);
    const locationGroups: Record<string, TeamMember[]> = {};
    for (const m of membersWithLocation) {
      const loc = m.lastLoginLocation!;
      if (!locationGroups[loc]) locationGroups[loc] = [];
      locationGroups[loc].push(m);
    }

    let plotted = 0;
    let unmatched = 0;

    for (const [location, groupMembers] of Object.entries(locationGroups)) {
      const coords = lookupCoords(location);
      if (!coords) {
        unmatched += groupMembers.length;
        continue;
      }

      for (const m of groupMembers) {
        const jitterLat = coords[0] + (Math.random() - 0.5) * 0.005;
        const jitterLng = coords[1] + (Math.random() - 0.5) * 0.005;
        const roleColor = ROLE_COLORS[m.role] || "#6b7280";
        const borderColor = m.isOnline ? "#10b981" : "#fff";

        const marker = L.circleMarker([jitterLat, jitterLng], {
          radius: 8,
          fillColor: roleColor,
          color: borderColor,
          weight: m.isOnline ? 3 : 2,
          fillOpacity: 0.85,
        });

        const container = document.createElement("div");
        container.style.minWidth = "180px";

        const nameEl = document.createElement("strong");
        nameEl.style.fontSize = "13px";
        nameEl.textContent = m.name;
        container.appendChild(nameEl);

        const roleEl = document.createElement("div");
        roleEl.style.cssText = "font-size:11px;margin:2px 0;";
        const roleDot = document.createElement("span");
        roleDot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${roleColor};margin-right:4px;vertical-align:middle;`;
        roleEl.appendChild(roleDot);
        roleEl.appendChild(document.createTextNode(`${m.repId} · ${m.role}`));
        container.appendChild(roleEl);

        const locEl = document.createElement("div");
        locEl.style.cssText = "font-size:11px;color:#666;";
        locEl.textContent = location;
        container.appendChild(locEl);

        const statusEl = document.createElement("div");
        statusEl.style.cssText = `font-size:11px;margin-top:4px;color:${m.isOnline ? "#10b981" : "#999"};font-weight:500;`;
        statusEl.textContent = m.isOnline ? "● Online now" : `○ Last login: ${formatTimeAgo(m.lastLoginAt)}`;
        container.appendChild(statusEl);

        marker.bindPopup(container);
        cluster.addLayer(marker);
        plotted++;
      }
    }

    map.addLayer(cluster);

    const existingNotes = mapRef.current?.querySelectorAll(".leaflet-info-note");
    existingNotes?.forEach(n => n.remove());

    const infoNote = document.createElement("div");
    infoNote.className = "leaflet-info-note";
    infoNote.style.cssText = "position:absolute;bottom:8px;left:8px;z-index:1000;background:rgba(255,255,255,0.92);padding:6px 10px;border-radius:6px;font-size:11px;color:#555;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,0.1);";
    const lines = [`${plotted} plotted`];
    if (unmatched > 0) lines.push(`${unmatched} unmapped`);
    infoNote.textContent = lines.join(" · ");
    mapRef.current?.appendChild(infoNote);
  }, [members]);

  return <div ref={mapRef} className="h-[400px] rounded-lg border relative" data-testid="map-team-locations" />;
}

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

      <TeamMapComponent members={members} />

      <div className="flex flex-wrap gap-3 items-center px-1" data-testid="legend-role-colors">
        <span className="text-xs text-muted-foreground font-medium">Role colors:</span>
        {Object.entries(ROLE_COLORS).map(([role, color]) => (
          <div key={role} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs text-muted-foreground">{role}</span>
          </div>
        ))}
        <span className="text-xs text-muted-foreground ml-2">● green border = online</span>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
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

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
                data-testid="input-geo-team-search"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filtered.map(m => (
                <div key={m.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-sm" data-testid={`row-geo-member-${m.repId}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Circle className={`h-2.5 w-2.5 shrink-0 ${m.isOnline ? "fill-green-500 text-green-500" : "fill-muted text-muted"}`} />
                    <div className="min-w-0">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground ml-1.5">{m.repId}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted-foreground">{m.lastLoginLocation || "—"}</div>
                    <div className="text-xs text-muted-foreground">{formatTimeAgo(m.lastLoginAt)}</div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && <p className="py-4 text-center text-muted-foreground text-sm">No members found</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SalesByRegionTab() {
  const [rangeDays, setRangeDays] = useState("90");
  const [viewMode, setViewMode] = useState<"city" | "zip">("city");
  const [filterRepId, setFilterRepId] = useState("");
  const [filterProviderId, setFilterProviderId] = useState("");
  const [sort, setSort] = useState<SortConfig>({ key: "total", dir: "desc" });
  const isMobile = useIsMobile();

  const { data: repsData } = useQuery<{ repId: string; name: string }[]>({
    queryKey: ["/api/geo/reps-list"],
    queryFn: async () => {
      const res = await fetch("/api/geo/team-locations", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return (d.members || []).map((m: TeamMember) => ({ repId: m.repId, name: m.name }));
    },
  });

  const { data: providersData } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/admin/providers-list"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const queryParams = new URLSearchParams({ range: rangeDays });
  if (filterRepId) queryParams.set("repId", filterRepId);
  if (filterProviderId) queryParams.set("providerId", filterProviderId);

  const { data, isLoading, isError, refetch } = useQuery<{ byCity: RegionData[]; byZip: RegionData[]; totalOrders: number; rangeDays: number; avgCommission: number }>({
    queryKey: ["/api/geo/sales-by-region", rangeDays, filterRepId, filterProviderId],
    queryFn: async () => {
      const res = await fetch(`/api/geo/sales-by-region?${queryParams}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const regionData = viewMode === "city" ? (data?.byCity || []) : (data?.byZip || []);

  const sortedData = useMemo(() => {
    const arr = [...regionData];
    arr.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sort.key] as number;
      const bVal = (b as Record<string, unknown>)[sort.key] as number;
      return sort.dir === "asc" ? aVal - bVal : bVal - aVal;
    });
    return arr;
  }, [regionData, sort]);

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

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
        <Select value={viewMode} onValueChange={(v: string) => setViewMode(v as "city" | "zip")}>
          <SelectTrigger className="w-32" data-testid="select-geo-view-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="city">By City</SelectItem>
            <SelectItem value="zip">By Zip Code</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterRepId || "all"} onValueChange={v => setFilterRepId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44" data-testid="select-geo-rep-filter">
            <SelectValue placeholder="All Reps" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reps</SelectItem>
            {(repsData || []).map(r => (
              <SelectItem key={r.repId} value={r.repId}>{r.name} ({r.repId})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterProviderId || "all"} onValueChange={v => setFilterProviderId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40" data-testid="select-geo-provider-filter">
            <SelectValue placeholder="All Providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            {(providersData || []).map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
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
        <Card data-testid="stat-geo-avg-commission">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Avg Commission</p>
            <p className="text-2xl font-bold font-mono">${(data?.avgCommission || 0).toFixed(2)}</p>
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
          <CardDescription>{regionData.length} regions found · Click column headers to sort</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2.5 px-2">
                    <SortHeader label={viewMode === "city" ? "City" : "Zip"} sortKey="name" sort={sort} setSort={setSort} />
                  </th>
                  <th className="text-right py-2.5 px-2">
                    <div className="flex justify-end"><SortHeader label="Orders" sortKey="total" sort={sort} setSort={setSort} /></div>
                  </th>
                  <th className="text-right py-2.5 px-2">
                    <div className="flex justify-end"><SortHeader label="Connected" sortKey="completed" sort={sort} setSort={setSort} /></div>
                  </th>
                  <th className="text-right py-2.5 px-2 font-medium">Rate</th>
                  <th className="text-right py-2.5 px-2">
                    <div className="flex justify-end"><SortHeader label="Commission" sortKey="revenue" sort={sort} setSort={setSort} /></div>
                  </th>
                  <th className="text-right py-2.5 px-2">
                    <div className="flex justify-end"><SortHeader label="Avg" sortKey="avgCommission" sort={sort} setSort={setSort} /></div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.slice(0, 50).map(r => (
                  <tr key={r.name} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-region-${r.name}`}>
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
                    <td className="py-2.5 px-2 text-right font-mono">${r.avgCommission.toFixed(2)}</td>
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
  const [filterRepId, setFilterRepId] = useState("");
  const [filterRange, setFilterRange] = useState("");
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);

  const { data: repsData } = useQuery<{ repId: string; name: string }[]>({
    queryKey: ["/api/geo/reps-list-leads"],
    queryFn: async () => {
      const res = await fetch("/api/geo/team-locations", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const d = await res.json();
      return (d.members || []).map((m: TeamMember) => ({ repId: m.repId, name: m.name }));
    },
  });

  const queryParams = new URLSearchParams();
  if (filterRepId) queryParams.set("repId", filterRepId);
  if (filterRange) queryParams.set("range", filterRange);

  const { data, isLoading, isError, refetch } = useQuery<{ byCity: LeadRegion[]; byZip: LeadRegion[]; byState: LeadRegion[]; totalLeads: number; topDispositions: DispositionEntry[] }>({
    queryKey: ["/api/geo/lead-density", filterRepId, filterRange],
    queryFn: async () => {
      const qs = queryParams.toString();
      const res = await fetch(`/api/geo/lead-density${qs ? `?${qs}` : ""}`, { headers: getAuthHeaders() });
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
  const topDispositions = data?.topDispositions || [];

  const pieData = [
    { name: "Active", value: totalActive },
    { name: "Converted", value: totalConverted },
    { name: "Lost", value: regionData.reduce((s, r) => s + r.lost, 0) },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={viewMode} onValueChange={(v: string) => setViewMode(v as "city" | "zip" | "state")}>
          <SelectTrigger className="w-32" data-testid="select-lead-view">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="city">By City</SelectItem>
            <SelectItem value="zip">By Zip Code</SelectItem>
            <SelectItem value="state">By State</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterRepId || "all"} onValueChange={v => setFilterRepId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44" data-testid="select-lead-rep-filter">
            <SelectValue placeholder="All Reps" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reps</SelectItem>
            {(repsData || []).map(r => (
              <SelectItem key={r.repId} value={r.repId}>{r.name} ({r.repId})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterRange || "all"} onValueChange={v => setFilterRange(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36" data-testid="select-lead-range">
            <SelectValue placeholder="All Time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

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

      {topDispositions.length > 0 && (
        <Card data-testid="card-top-dispositions">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Top Dispositions (Global)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {topDispositions.map(d => (
                <div key={d.disposition} className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
                  <span className="text-sm font-medium truncate">{d.disposition.replace(/_/g, " ")}</span>
                  <Badge variant="outline" className="font-mono text-xs ml-2 shrink-0">{d.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Lead Density by Region</CardTitle>
          <CardDescription>Click a row to see top dispositions for that area</CardDescription>
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
                  <>
                    <tr
                      key={r.name}
                      className={`border-b last:border-0 hover:bg-muted/30 cursor-pointer ${expandedRegion === r.name ? "bg-muted/40" : ""}`}
                      onClick={() => setExpandedRegion(expandedRegion === r.name ? null : r.name)}
                      data-testid={`row-lead-${r.name}`}
                    >
                      <td className="py-2.5 px-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {r.name}
                          {r.topDispositions.length > 0 && <span className="text-xs text-muted-foreground ml-1">▸</span>}
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
                    {expandedRegion === r.name && r.topDispositions.length > 0 && (
                      <tr key={`${r.name}-disp`}>
                        <td colSpan={6} className="py-2 px-4 bg-muted/20">
                          <div className="flex flex-wrap gap-2 items-center">
                            <span className="text-xs text-muted-foreground font-medium mr-1">Top dispositions:</span>
                            {r.topDispositions.map(d => (
                              <Badge key={d.disposition} variant="secondary" className="text-xs">
                                {d.disposition.replace(/_/g, " ")} ({d.count})
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
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

  const { data, isLoading, isError, refetch } = useQuery<{ territories: RepTerritory[]; overlaps: OverlapEntry[]; rangeDays: number }>({
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
  const overlaps = data?.overlaps || [];
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
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Overlap Zones</p>
            <p className="text-2xl font-bold font-mono text-amber-600">{overlaps.length}</p>
          </CardContent>
        </Card>
      </div>

      {overlaps.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800" data-testid="card-territory-overlaps">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              Territory Overlaps ({overlaps.length} zip codes)
            </CardTitle>
            <CardDescription>Zip codes where multiple reps are operating</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {overlaps.slice(0, 12).map(o => (
                <div key={o.zip} className="flex items-start gap-2 p-2.5 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20" data-testid={`overlap-${o.zip}`}>
                  <Badge variant="outline" className="font-mono text-xs shrink-0 mt-0.5">{o.zip}</Badge>
                  <div className="min-w-0">
                    {o.reps.map(r => (
                      <div key={r.repId} className="text-xs text-muted-foreground truncate">{r.name} ({r.repId})</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {overlaps.length > 12 && (
              <p className="text-xs text-muted-foreground mt-2 text-center">+ {overlaps.length - 12} more overlapping zip codes</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Rep Territory Coverage</CardTitle>
          <CardDescription>Coverage from orders and leads · Click a row for details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filtered.map(t => (
              <div key={t.repId} className={`border rounded-lg ${t.overlapZipCount > 0 ? "border-amber-300 dark:border-amber-700" : ""}`} data-testid={`card-territory-${t.repId}`}>
                <button
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 rounded-lg"
                  onClick={() => setExpandedRep(expandedRep === t.repId ? null : t.repId)}
                  data-testid={`button-expand-${t.repId}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {t.name}
                        {t.overlapZipCount > 0 && (
                          <Badge variant="outline" className="ml-2 text-xs text-amber-600 border-amber-300">
                            {t.overlapZipCount} overlap{t.overlapZipCount > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{t.repId} · {t.role}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-mono">{t.totalOrders} orders · {t.totalLeads} leads</div>
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
                          {t.zips.map(z => {
                            const isOverlap = t.overlapZips.includes(z);
                            return (
                              <Badge
                                key={z}
                                variant={isOverlap ? "destructive" : "secondary"}
                                className={`text-xs font-mono ${isOverlap ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300" : ""}`}
                              >
                                {z}{isOverlap && " ⚠"}
                              </Badge>
                            );
                          })}
                          {t.zips.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-3 text-center">
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-lg font-bold font-mono">{t.totalOrders}</p>
                        <p className="text-xs text-muted-foreground">Orders</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-lg font-bold font-mono text-green-600">{t.completedOrders}</p>
                        <p className="text-xs text-muted-foreground">Connected</p>
                      </div>
                      <div className="p-2 rounded bg-muted/50">
                        <p className="text-lg font-bold font-mono text-blue-600">{t.totalLeads}</p>
                        <p className="text-xs text-muted-foreground">Leads</p>
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
            Team Map
          </TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-geo-sales">
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Sales by Region
          </TabsTrigger>
          <TabsTrigger value="leads" data-testid="tab-geo-leads">
            <Layers className="h-4 w-4 mr-1.5" />
            Lead Heatmap
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
