import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  MapPin,
  Monitor,
  Smartphone,
  Clock,
  Activity,
  Search,
  Globe,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

type ActivityLog = {
  id: string;
  userId: string;
  eventType: string;
  page: string | null;
  ipAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  userAgent: string | null;
  deviceType: string | null;
  createdAt: string;
  userName: string;
  userRepId: string;
  userRole: string;
};

type ActivityData = {
  logs: ActivityLog[];
  stats: {
    uniqueUsersToday: number;
    totalLogins24h: number;
    totalEvents7d: number;
  };
  lastLoginByUser: ActivityLog[];
  deviceBreakdown: Record<string, number>;
  locationBreakdown: Record<string, number>;
  pageBreakdown: Record<string, number>;
};

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function UserActivity() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const { data, isLoading } = useQuery<ActivityData>({
    queryKey: ["/api/user-activity"],
    queryFn: async () => {
      const res = await fetch("/api/user-activity", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (!["ADMIN", "OPERATIONS"].includes(user?.role || "")) {
    return <div className="p-8 text-center text-muted-foreground">Access denied</div>;
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const deviceData = Object.entries(data?.deviceBreakdown || {}).map(([name, value]) => ({ name, value }));
  const locationData = Object.entries(data?.locationBreakdown || {}).sort(([, a], [, b]) => b - a);
  const pageData = Object.entries(data?.pageBreakdown || {}).sort(([, a], [, b]) => b - a);

  const filteredLogs = data?.logs?.filter(log => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      log.userName.toLowerCase().includes(q) ||
      log.userRepId.toLowerCase().includes(q) ||
      (log.city || "").toLowerCase().includes(q) ||
      (log.region || "").toLowerCase().includes(q) ||
      (log.page || "").toLowerCase().includes(q) ||
      log.eventType.toLowerCase().includes(q)
    );
  }) || [];

  const filteredLastLogins = data?.lastLoginByUser?.filter(log => {
    if (!search) return true;
    const q = search.toLowerCase();
    return log.userName.toLowerCase().includes(q) || log.userRepId.toLowerCase().includes(q);
  }) || [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-activity-title">User Activity</h1>
        <p className="text-muted-foreground text-sm">Track user logins, locations, and page usage</p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        <Card data-testid="stat-unique-users">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Active Users (24h)</p>
            </div>
            <p className="text-2xl font-bold font-mono">{data?.stats?.uniqueUsersToday || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-logins-24h">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Logins (24h)</p>
            </div>
            <p className="text-2xl font-bold font-mono">{data?.stats?.totalLogins24h || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-events-7d">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Globe className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Events (7d)</p>
            </div>
            <p className="text-2xl font-bold font-mono">{data?.stats?.totalEvents7d || 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, rep ID, location, or page..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-activity-search"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap w-full h-auto gap-1">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="logins" data-testid="tab-logins">Last Logins</TabsTrigger>
          <TabsTrigger value="pages" data-testid="tab-pages">Page Usage</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card data-testid="card-device-breakdown">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  Device Breakdown (7d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {deviceData.length > 0 ? (
                  <div className="flex items-center gap-6">
                    <div className="h-48 w-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={deviceData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {deviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2">
                      {deviceData.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-sm">{d.name}</span>
                          <span className="text-sm font-mono text-muted-foreground">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No device data yet</p>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-location-breakdown">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Login Locations (7d)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {locationData.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {locationData.map(([loc, count], i) => (
                      <div key={loc} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{loc}</span>
                        </div>
                        <span className="text-sm font-mono text-muted-foreground">{count} login{count !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No location data yet. Locations are captured on login.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {pageData.length > 0 && (
            <Card data-testid="card-page-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Most Visited Pages (7d)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pageData.slice(0, 10).map(([page, count]) => ({ page: page.replace(/^\//, "").replace(/\//g, " / ") || "Dashboard", count }))} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="page" tick={{ fontSize: 12 }} width={120} />
                      <Tooltip />
                      <Bar dataKey="count" name="Visits" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="logins" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Last Login by User</CardTitle>
              <CardDescription>Most recent login session for each user</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredLastLogins.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-3 px-2 font-medium">User</th>
                        <th className="text-left py-3 px-2 font-medium">Role</th>
                        <th className="text-left py-3 px-2 font-medium">Location</th>
                        <th className="text-left py-3 px-2 font-medium">Device</th>
                        <th className="text-left py-3 px-2 font-medium">IP</th>
                        <th className="text-right py-3 px-2 font-medium">Last Login</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLastLogins.map(log => (
                        <tr key={log.userId} className="border-b last:border-0 hover-elevate" data-testid={`row-login-${log.userRepId}`}>
                          <td className="py-3 px-2">
                            <div className="font-medium">{log.userName}</div>
                            <div className="text-xs text-muted-foreground">{log.userRepId}</div>
                          </td>
                          <td className="py-3 px-2">
                            <Badge variant="outline" className="text-xs">{log.userRole}</Badge>
                          </td>
                          <td className="py-3 px-2">
                            {log.city || log.region ? (
                              <div className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-sm">{[log.city, log.region].filter(Boolean).join(", ")}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-1">
                              {log.deviceType === "Mobile" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                              <span className="text-sm">{log.deviceType}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <span className="text-xs font-mono text-muted-foreground">{log.ipAddress}</span>
                          </td>
                          <td className="text-right py-3 px-2">
                            <div className="text-sm">{formatTimeAgo(log.createdAt)}</div>
                            <div className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-12 text-center text-muted-foreground">No login data yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pages" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Page Usage (7d)</CardTitle>
              <CardDescription>Most visited pages across all users</CardDescription>
            </CardHeader>
            <CardContent>
              {pageData.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-3 px-2 font-medium">Page</th>
                        <th className="text-right py-3 px-2 font-medium">Views</th>
                        <th className="text-right py-3 px-2 font-medium">% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageData.map(([page, count]) => {
                        const total = pageData.reduce((s, [, c]) => s + c, 0);
                        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
                        return (
                          <tr key={page} className="border-b last:border-0 hover-elevate" data-testid={`row-page-${page}`}>
                            <td className="py-3 px-2 font-medium">{page || "/"}</td>
                            <td className="text-right py-3 px-2 font-mono">{count}</td>
                            <td className="text-right py-3 px-2 font-mono text-muted-foreground">{pct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-12 text-center text-muted-foreground">No page usage data yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Recent Activity</CardTitle>
              <CardDescription>All tracked events across the platform</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredLogs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-3 px-2 font-medium">User</th>
                        <th className="text-left py-3 px-2 font-medium">Event</th>
                        <th className="text-left py-3 px-2 font-medium">Page</th>
                        <th className="text-left py-3 px-2 font-medium">Device</th>
                        <th className="text-left py-3 px-2 font-medium">Location</th>
                        <th className="text-right py-3 px-2 font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.slice(0, 200).map(log => (
                        <tr key={log.id} className="border-b last:border-0 hover-elevate" data-testid={`row-activity-${log.id}`}>
                          <td className="py-2 px-2">
                            <div className="font-medium text-xs">{log.userName}</div>
                            <div className="text-xs text-muted-foreground">{log.userRepId}</div>
                          </td>
                          <td className="py-2 px-2">
                            <Badge variant={log.eventType === "LOGIN" ? "default" : "outline"} className="text-xs">
                              {log.eventType}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">{log.page || "—"}</td>
                          <td className="py-2 px-2">
                            {log.deviceType === "Mobile" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                          </td>
                          <td className="py-2 px-2 text-xs">
                            {log.city || log.region ? [log.city, log.region].filter(Boolean).join(", ") : "—"}
                          </td>
                          <td className="text-right py-2 px-2 text-xs text-muted-foreground">{formatDate(log.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-12 text-center text-muted-foreground">No activity logged yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
