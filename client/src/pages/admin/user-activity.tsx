import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users,
  MapPin,
  Monitor,
  Smartphone,
  Activity,
  Search,
  Globe,
  Circle,
  Wifi,
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
import { useIsMobile } from "@/hooks/use-mobile";

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

type UserSummary = {
  id: string;
  name: string;
  repId: string;
  role: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  lastLoginLocation: string | null;
  lastActiveAt: string | null;
  isOnline: boolean;
};

type OnlineUser = {
  id: string;
  name: string;
  repId: string;
  role: string;
  lastActiveAt: string | null;
};

type ActivityData = {
  logs: ActivityLog[];
  stats: {
    uniqueUsersToday: number;
    totalLogins24h: number;
    totalEventsRange: number;
    onlineNow: number;
  };
  onlineUsers: OnlineUser[];
  userSummaries: UserSummary[];
  deviceBreakdown: Record<string, number>;
  locationBreakdown: Record<string, number>;
  pageBreakdown: Record<string, number>;
  rangeDays: number;
};

function formatTimeAgo(dateStr: string | null) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
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
  const [rangeDays, setRangeDays] = useState("7");
  const isMobile = useIsMobile();

  const { data, isLoading } = useQuery<ActivityData>({
    queryKey: ["/api/user-activity", rangeDays],
    queryFn: async () => {
      const res = await fetch(`/api/user-activity?range=${rangeDays}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (!["OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user?.role || "")) {
    return <div className="p-8 text-center text-muted-foreground">Access denied</div>;
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
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

  const filteredUsers = data?.userSummaries?.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.repId.toLowerCase().includes(q) || u.role.toLowerCase().includes(q) || (u.lastLoginLocation || "").toLowerCase().includes(q);
  }) || [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-activity-title">User Activity</h1>
          <p className="text-muted-foreground text-sm">Monitor usage, locations, and login activity</p>
        </div>
        <Select value={rangeDays} onValueChange={setRangeDays}>
          <SelectTrigger className="w-36" data-testid="select-activity-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card data-testid="stat-online-now">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Wifi className="h-4 w-4 text-green-500" />
              <p className="text-xs font-medium uppercase tracking-wide">Online Now</p>
            </div>
            <p className="text-2xl font-bold font-mono">{data?.stats?.onlineNow || 0}</p>
          </CardContent>
        </Card>
        <Card data-testid="stat-unique-users">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Active (24h)</p>
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
        <Card data-testid="stat-events-range">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Globe className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Events ({rangeDays}d)</p>
            </div>
            <p className="text-2xl font-bold font-mono">{data?.stats?.totalEventsRange || 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, rep ID, location, or role..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-activity-search"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap w-full h-auto gap-1">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">All Users</TabsTrigger>
          <TabsTrigger value="online" data-testid="tab-online">Online Now</TabsTrigger>
          <TabsTrigger value="pages" data-testid="tab-pages">Page Usage</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card data-testid="card-device-breakdown">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  Device Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                {deviceData.length > 0 ? (
                  <div className="flex items-center gap-6">
                    <div className="h-48 w-48 shrink-0">
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
                  Login Locations
                </CardTitle>
              </CardHeader>
              <CardContent>
                {locationData.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {locationData.map(([loc, count]) => (
                      <div key={loc} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm">{loc}</span>
                        </div>
                        <span className="text-sm font-mono text-muted-foreground">{count} login{count !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No location data yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {pageData.length > 0 && (
            <Card data-testid="card-page-chart">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Most Visited Pages</CardTitle>
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

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">All Users — Last Login & Activity</CardTitle>
              <CardDescription>Sorted by most recently active. Green dot = online now.</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredUsers.length > 0 ? (
                isMobile ? (
                  <div className="flex flex-col gap-3">
                    {filteredUsers.map(u => (
                      <Card key={u.id} data-testid={`card-user-${u.repId}`}>
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Circle className={`h-2.5 w-2.5 shrink-0 ${u.isOnline ? "fill-green-500 text-green-500" : "fill-muted text-muted"}`} />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{u.name}</div>
                              <div className="text-xs text-muted-foreground">{u.repId} · {u.role}</div>
                            </div>
                            <Badge variant={u.isOnline ? "default" : "outline"} className="text-xs shrink-0">
                              {u.isOnline ? "Online" : "Offline"}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Last Login</span>
                              <div className="font-medium">{formatTimeAgo(u.lastLoginAt)}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Last Active</span>
                              <div className="font-medium">{formatTimeAgo(u.lastActiveAt)}</div>
                            </div>
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Location</span>
                              <div className="font-medium flex items-center gap-1">
                                {u.lastLoginLocation ? (
                                  <><MapPin className="h-3 w-3 text-muted-foreground shrink-0" />{u.lastLoginLocation}</>
                                ) : "—"}
                              </div>
                            </div>
                            {u.lastLoginIp && (
                              <div className="col-span-2">
                                <span className="text-muted-foreground">IP</span>
                                <div className="font-mono text-xs">{u.lastLoginIp}</div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left py-3 px-2 font-medium">Status</th>
                          <th className="text-left py-3 px-2 font-medium">User</th>
                          <th className="text-left py-3 px-2 font-medium">Role</th>
                          <th className="text-left py-3 px-2 font-medium">Last Login</th>
                          <th className="text-left py-3 px-2 font-medium">Last Active</th>
                          <th className="text-left py-3 px-2 font-medium">Location</th>
                          <th className="text-left py-3 px-2 font-medium">IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map(u => (
                          <tr key={u.id} className="border-b last:border-0 hover-elevate" data-testid={`row-user-${u.repId}`}>
                            <td className="py-3 px-2">
                              <div className="flex items-center gap-1.5">
                                <Circle className={`h-2.5 w-2.5 ${u.isOnline ? "fill-green-500 text-green-500" : "fill-muted text-muted"}`} />
                                <span className="text-xs">{u.isOnline ? "Online" : "Offline"}</span>
                              </div>
                            </td>
                            <td className="py-3 px-2">
                              <div className="font-medium">{u.name}</div>
                              <div className="text-xs text-muted-foreground">{u.repId}</div>
                            </td>
                            <td className="py-3 px-2">
                              <Badge variant="outline" className="text-xs">{u.role}</Badge>
                            </td>
                            <td className="py-3 px-2">
                              <div className="text-sm">{formatTimeAgo(u.lastLoginAt)}</div>
                              <div className="text-xs text-muted-foreground">{formatDate(u.lastLoginAt)}</div>
                            </td>
                            <td className="py-3 px-2">
                              <div className="text-sm">{formatTimeAgo(u.lastActiveAt)}</div>
                            </td>
                            <td className="py-3 px-2">
                              {u.lastLoginLocation ? (
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  <span className="text-sm">{u.lastLoginLocation}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-3 px-2">
                              <span className="text-xs font-mono text-muted-foreground">{u.lastLoginIp || "—"}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <p className="py-12 text-center text-muted-foreground">No users found</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="online" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wifi className="h-5 w-5 text-green-500" />
                Online Now ({data?.onlineUsers?.length || 0})
              </CardTitle>
              <CardDescription>Users active in the last 5 minutes</CardDescription>
            </CardHeader>
            <CardContent>
              {(data?.onlineUsers?.length || 0) > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {data!.onlineUsers.map(u => (
                    <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg border bg-green-50/50 dark:bg-green-950/20" data-testid={`card-online-${u.repId}`}>
                      <Circle className="h-3 w-3 fill-green-500 text-green-500 shrink-0 animate-pulse" />
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.repId} · {u.role}</div>
                        <div className="text-xs text-muted-foreground">Active {formatTimeAgo(u.lastActiveAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <Wifi className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-muted-foreground">No users are online right now</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pages" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Page Usage ({rangeDays}d)</CardTitle>
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
                isMobile ? (
                  <div className="flex flex-col gap-2">
                    {filteredLogs.slice(0, 200).map(log => (
                      <div key={log.id} className="p-3 border rounded-lg" data-testid={`card-activity-${log.id}`}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-medium text-sm">{log.userName}</div>
                          <Badge variant={log.eventType === "LOGIN" ? "default" : "outline"} className="text-xs">
                            {log.eventType}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{log.userRepId} · {log.userRole}</div>
                        {log.page && <div className="text-xs text-muted-foreground mt-1">Page: {log.page}</div>}
                        <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            {log.deviceType === "Mobile" ? <Smartphone className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}
                            {log.city || log.region ? [log.city, log.region].filter(Boolean).join(", ") : ""}
                          </div>
                          <span>{formatDate(log.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
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
                )
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
