import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { StatsCard } from "@/components/stats-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  FileText,
  CheckCircle,
  Clock,
  Download,
  Calendar,
  Percent,
  Users,
  Tv,
  Smartphone,
  Target,
  BarChart3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "last_quarter", label: "Last Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "custom", label: "Custom Range" },
];

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface ReportSummary {
  period: { start: string; end: string };
  scopeInfo: {
    role: string;
    scopeDescription: string;
    repCount: number;
  };
  totalOrders: number;
  completedOrders: number;
  approvedOrders: number;
  pendingOrders: number;
  totalEarned: string;
  totalPaid: string;
  outstanding: string;
  pendingDollars: string;
  connectedDollars: string;
  avgCommission: string;
  approvalRate: string;
  completionRate: string;
  comparison: {
    ordersTrend: string;
    earnedTrend: string;
  };
}

interface RepData {
  repId: string;
  name: string;
  orders: number;
  earned: number;
  approved: number;
}

interface ProviderData {
  id: string;
  name: string;
  orders: number;
  earned: number;
}

interface ServiceData {
  id: string;
  name: string;
  orders: number;
  earned: number;
}

interface TrendData {
  key: string;
  label: string;
  orders: number;
  earned: number;
}

interface CommissionData {
  repId: string;
  name: string;
  earned: number;
  paid: number;
  outstanding: number;
  orders: number;
}

interface RepLeaderboardData {
  userId: string;
  repId: string;
  name: string;
  role: string;
  supervisorName: string | null;
  ordersSold: number;
  ordersConnected: number;
  ordersPending: number;
  ordersApproved: number;
  earned: number;
  paid: number;
  outstanding: number;
  mobileLines: number;
  tvSold: number;
  internetSold: number;
  avgOrderValue: number;
  approvalRate: number;
  connectionRate: number;
  leadsConverted: number;
  leadsTotal: number;
  conversionRate: number;
}

interface TeamProductionData {
  leaderId: string;
  leaderName: string;
  leaderRepId: string;
  role: string;
  sold: number;
  connected: number;
  mobileLines: number;
  pendingDollars: number;
  connectedDollars: number;
  teamSize: number;
}

interface OverrideInvoiceData {
  orderId: string;
  invoiceNumber: string | null;
  customerName: string;
  dateSold: string;
  repName: string;
  totalOverride: number;
  overrides: Array<{
    recipientName: string;
    recipientRole: string;
    amount: string;
    agreementId: string | null;
  }>;
}

interface ProductionPeriodMetrics {
  totalSold: number;
  pending: number;
  connected: number;
  approved: number;
  pendingDollars: string;
  connectedDollars: string;
  totalEarned: string;
  mobileLines: number;
  tvSold: number;
}

interface ProductionMetrics {
  scopeInfo: {
    role: string;
    scopeDescription: string;
    repCount: number;
  };
  periods: {
    weekly: { start: string; end: string; label: string };
    mtd: { start: string; end: string; label: string };
  };
  weekly: ProductionPeriodMetrics;
  mtd: ProductionPeriodMetrics;
}

export default function Reports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [period, setPeriod] = useState("this_month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [groupBy, setGroupBy] = useState("day");
  const [execViewMode, setExecViewMode] = useState<"own" | "team" | "global">("global");

  const isExecutive = user?.role === "EXECUTIVE";

  const buildQueryString = () => {
    const params = new URLSearchParams({ period });
    if (period === "custom" && customStartDate) params.set("startDate", customStartDate);
    if (period === "custom" && customEndDate) params.set("endDate", customEndDate);
    if (isExecutive) params.set("viewMode", execViewMode);
    return params.toString();
  };

  const { data: summary, isLoading: summaryLoading } = useQuery<ReportSummary>({
    queryKey: ["/api/reports/summary", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/summary?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: production, isLoading: productionLoading } = useQuery<ProductionMetrics>({
    queryKey: ["/api/reports/production", execViewMode],
    queryFn: async () => {
      const params = isExecutive ? `?viewMode=${execViewMode}` : "";
      const res = await fetch(`/api/reports/production${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch production");
      return res.json();
    },
  });

  const { data: salesByRep } = useQuery<{ data: RepData[] }>({
    queryKey: ["/api/reports/sales-by-rep", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/sales-by-rep?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: salesByProvider } = useQuery<{ data: ProviderData[] }>({
    queryKey: ["/api/reports/sales-by-provider", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/sales-by-provider?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: salesByService } = useQuery<{ data: ServiceData[] }>({
    queryKey: ["/api/reports/sales-by-service", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/sales-by-service?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: trendData } = useQuery<{ data: TrendData[] }>({
    queryKey: ["/api/reports/trend", period, customStartDate, customEndDate, groupBy, execViewMode],
    queryFn: async () => {
      const params = new URLSearchParams({ period, groupBy });
      if (period === "custom" && customStartDate) params.set("startDate", customStartDate);
      if (period === "custom" && customEndDate) params.set("endDate", customEndDate);
      if (isExecutive) params.set("viewMode", execViewMode);
      const res = await fetch(`/api/reports/trend?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: commissionSummary } = useQuery<{ data: CommissionData[]; totals: { totalEarned: number; totalPaid: number; totalOutstanding: number; totalOrders: number } }>({
    queryKey: ["/api/reports/commission-summary", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/commission-summary?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: teamProduction } = useQuery<{ data: TeamProductionData[]; totals: { totalSold: number; totalConnected: number; totalMobileLines: number; totalPendingDollars: number; totalConnectedDollars: number } }>({
    queryKey: ["/api/reports/team-production", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/team-production?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) return { data: [], totals: { totalSold: 0, totalConnected: 0, totalMobileLines: 0, totalPendingDollars: 0, totalConnectedDollars: 0 } };
      return res.json();
    },
    enabled: summary?.scopeInfo?.role !== "REP",
  });

  const { data: repLeaderboard } = useQuery<{ data: RepLeaderboardData[]; totals: { totalOrders: number; totalConnected: number; totalEarned: number; totalPaid: number; totalMobileLines: number; totalLeads: number; totalConverted: number }; scopeInfo: { role: string; scopeDescription: string; repCount: number } }>({
    queryKey: ["/api/reports/rep-leaderboard", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/rep-leaderboard?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) return { data: [], totals: { totalOrders: 0, totalConnected: 0, totalEarned: 0, totalPaid: 0, totalMobileLines: 0, totalLeads: 0, totalConverted: 0 }, scopeInfo: { role: "", scopeDescription: "", repCount: 0 } };
      return res.json();
    },
  });

  const { data: overrideInvoices } = useQuery<{ data: OverrideInvoiceData[]; totals: { totalOverrides: string; invoiceCount: number }; recipients: Array<{ id: string; name: string; role: string }> }>({
    queryKey: ["/api/reports/override-invoices", period, customStartDate, customEndDate, execViewMode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/override-invoices?${buildQueryString()}`, { headers: getAuthHeaders() });
      if (!res.ok) return { data: [], totals: { totalOverrides: "0.00", invoiceCount: 0 }, recipients: [] };
      return res.json();
    },
    enabled: summary?.scopeInfo?.role === "ADMIN" || summary?.scopeInfo?.role === "OPERATIONS" || summary?.scopeInfo?.role === "EXECUTIVE",
  });

  type UserActivityData = {
    data: Array<{
      repId: string;
      name: string;
      role: string;
      thisWeek: { submitted: number; connected: number };
      lastWeek: { submitted: number; connected: number };
      weekOverWeek: { submitted: { value: number; percent: number }; connected: { value: number; percent: number } };
      thisMonth: { submitted: number; connected: number };
      lastMonth: { submitted: number; connected: number };
      monthOverMonth: { submitted: { value: number; percent: number }; connected: { value: number; percent: number } };
    }>;
    totals: {
      thisWeek: { submitted: number; connected: number };
      lastWeek: { submitted: number; connected: number };
      thisMonth: { submitted: number; connected: number };
      lastMonth: { submitted: number; connected: number };
    };
    periods: {
      thisWeek: { start: string; end: string };
      lastWeek: { start: string; end: string };
      thisMonth: string;
      lastMonth: string;
    };
  };

  const { data: userActivity, isLoading: userActivityLoading } = useQuery<UserActivityData>({
    queryKey: ["/api/reports/user-activity", execViewMode],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isExecutive) params.set("viewMode", execViewMode);
      const res = await fetch(`/api/reports/user-activity?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  type SalesTrackerRepData = {
    repId: string;
    name: string;
    role: string;
    today: { submitted: number; connected: number; approved: number };
    yesterday: { submitted: number; connected: number; approved: number };
    dayOverDay: { submitted: { value: number; percent: number }; connected: { value: number; percent: number } };
    thisWeek: { submitted: number; connected: number; approved: number };
    lastWeek: { submitted: number; connected: number; approved: number };
    weekOverWeek: { submitted: { value: number; percent: number }; connected: { value: number; percent: number } };
    thisMonth: { submitted: number; connected: number; approved: number };
    lastMonth: { submitted: number; connected: number; approved: number };
    monthOverMonth: { submitted: { value: number; percent: number }; connected: { value: number; percent: number } };
    dailyBreakdown: Array<{ day: string; date: string; submitted: number; connected: number; approved: number }>;
    prevDailyBreakdown: Array<{ day: string; date: string; submitted: number; connected: number; approved: number }>;
  };

  type SalesTrackerData = {
    data: SalesTrackerRepData[];
    totals: {
      today: { submitted: number; connected: number; approved: number };
      yesterday: { submitted: number; connected: number; approved: number };
      thisWeek: { submitted: number; connected: number; approved: number };
      lastWeek: { submitted: number; connected: number; approved: number };
      thisMonth: { submitted: number; connected: number; approved: number };
      lastMonth: { submitted: number; connected: number; approved: number };
    };
    dailyTotals: Array<{ day: string; date: string; submitted: number; connected: number; approved: number }>;
    prevDailyTotals: Array<{ day: string; date: string; submitted: number; connected: number; approved: number }>;
    periods: {
      today: string;
      yesterday: string;
      thisWeek: { start: string; end: string };
      lastWeek: { start: string; end: string };
      thisMonth: string;
      lastMonth: string;
    };
  };

  const [trackerView, setTrackerView] = useState<"daily" | "weekly" | "monthly">("weekly");

  const { data: salesTracker, isLoading: salesTrackerLoading } = useQuery<SalesTrackerData>({
    queryKey: ["/api/reports/sales-tracker", execViewMode],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isExecutive) params.set("viewMode", execViewMode);
      const res = await fetch(`/api/reports/sales-tracker?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: ["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user?.role || ""),
  });

  const handleExport = () => {
    if (!commissionSummary?.data?.length) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    const headers = ["Rep ID", "Name", "Orders", "Earned", "Paid", "Outstanding"];
    const rows = commissionSummary.data.map(row => [
      row.repId,
      row.name,
      row.orders.toString(),
      row.earned.toFixed(2),
      row.paid.toFixed(2),
      row.outstanding.toFixed(2),
    ]);

    const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label || period;
    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commission-report-${periodLabel.toLowerCase().replace(/\s/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast({ title: "Report exported successfully" });
  };

  const getTrendIcon = (value: string) => {
    const num = parseFloat(value);
    if (num > 0) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (num < 0) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return null;
  };

  const getTrendColor = (value: string) => {
    const num = parseFloat(value);
    if (num > 0) return "text-green-600";
    if (num < 0) return "text-red-600";
    return "text-muted-foreground";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">Production Results</h1>
            {production?.scopeInfo && (
              <Badge variant="secondary" className="flex items-center gap-1" data-testid="badge-scope">
                <Users className="h-3 w-3" />
                {production.scopeInfo.scopeDescription}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Weekly and month-to-date production metrics
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {isExecutive && (
            <div className="flex items-center gap-2 border rounded-md p-1" data-testid="toggle-exec-view-mode">
              <Button
                variant={execViewMode === "own" ? "default" : "ghost"}
                size="sm"
                onClick={() => setExecViewMode("own")}
                data-testid="button-view-own"
              >
                My Sales
              </Button>
              <Button
                variant={execViewMode === "team" ? "default" : "ghost"}
                size="sm"
                onClick={() => setExecViewMode("team")}
                data-testid="button-view-team"
              >
                My Team
              </Button>
              <Button
                variant={execViewMode === "global" ? "default" : "ghost"}
                size="sm"
                onClick={() => setExecViewMode("global")}
                data-testid="button-view-global"
              >
                Global
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={handleExport} data-testid="button-export-report">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {productionLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-4" />
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card data-testid="card-weekly-production">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      This Week
                    </CardTitle>
                    <CardDescription>{production?.periods?.weekly?.start} - {production?.periods?.weekly?.end}</CardDescription>
                  </div>
                  <Badge variant="outline">{production?.weekly?.totalSold || 0} Sold</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-md bg-orange-500/10 border border-orange-200 dark:border-orange-900">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Clock className="h-4 w-4 text-orange-600" />
                      Pending Dollars
                    </div>
                    <p className="text-2xl font-bold font-mono">${production?.weekly?.pendingDollars || "0.00"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{production?.weekly?.pending || 0} orders</p>
                  </div>
                  <div className="p-4 rounded-md bg-green-500/10 border border-green-200 dark:border-green-900">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Connected Dollars
                    </div>
                    <p className="text-2xl font-bold font-mono">${production?.weekly?.connectedDollars || "0.00"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{production?.weekly?.connected || 0} orders</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-blue-500/10">
                      <Smartphone className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Mobile Lines</p>
                      <p className="font-semibold">{production?.weekly?.mobileLines || 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-purple-500/10">
                      <Tv className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">TV Sold</p>
                      <p className="font-semibold">{production?.weekly?.tvSold || 0}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-mtd-production">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-primary" />
                      {production?.periods?.mtd?.label || "MTD"}
                    </CardTitle>
                    <CardDescription>{production?.periods?.mtd?.start} - {production?.periods?.mtd?.end}</CardDescription>
                  </div>
                  <Badge variant="outline">{production?.mtd?.totalSold || 0} Sold</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-md bg-orange-500/10 border border-orange-200 dark:border-orange-900">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Clock className="h-4 w-4 text-orange-600" />
                      Pending Dollars
                    </div>
                    <p className="text-2xl font-bold font-mono">${production?.mtd?.pendingDollars || "0.00"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{production?.mtd?.pending || 0} orders</p>
                  </div>
                  <div className="p-4 rounded-md bg-green-500/10 border border-green-200 dark:border-green-900">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Connected Dollars
                    </div>
                    <p className="text-2xl font-bold font-mono">${production?.mtd?.connectedDollars || "0.00"}</p>
                    <p className="text-xs text-muted-foreground mt-1">{production?.mtd?.connected || 0} orders</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-blue-500/10">
                      <Smartphone className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Mobile Lines</p>
                      <p className="font-semibold">{production?.mtd?.mobileLines || 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-purple-500/10">
                      <Tv className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">TV Sold</p>
                      <p className="font-semibold">{production?.mtd?.tvSold || 0}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card data-testid="stat-weekly-total">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Weekly Total</p>
                    <p className="text-3xl font-bold font-mono mt-2">${production?.weekly?.totalEarned || "0.00"}</p>
                    <span className="text-xs text-muted-foreground">
                      All commissions
                    </span>
                  </div>
                  <div className="p-2 rounded-md bg-primary/10">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="stat-mtd-total">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">MTD Total</p>
                    <p className="text-3xl font-bold font-mono mt-2">${production?.mtd?.totalEarned || "0.00"}</p>
                    <span className="text-xs text-muted-foreground">
                      All commissions
                    </span>
                  </div>
                  <div className="p-2 rounded-md bg-green-500/10">
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="stat-weekly-approved">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Weekly Approved</p>
                    <p className="text-3xl font-bold font-mono mt-2">{production?.weekly?.approved || 0}</p>
                    <span className="text-xs text-muted-foreground">
                      of {production?.weekly?.totalSold || 0} orders
                    </span>
                  </div>
                  <div className="p-2 rounded-md bg-blue-500/10">
                    <CheckCircle className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="stat-mtd-approved">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">MTD Approved</p>
                    <p className="text-3xl font-bold font-mono mt-2">{production?.mtd?.approved || 0}</p>
                    <span className="text-xs text-muted-foreground">
                      of {production?.mtd?.totalSold || 0} orders
                    </span>
                  </div>
                  <div className="p-2 rounded-md bg-green-500/10">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Tabs defaultValue="detailed" className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList className="flex-wrap">
            <TabsTrigger value="detailed" data-testid="tab-detailed">Detailed Analytics</TabsTrigger>
            <TabsTrigger value="trend" data-testid="tab-trend">Trend Analysis</TabsTrigger>
            <TabsTrigger value="performance" data-testid="tab-performance">Rep Performance</TabsTrigger>
            <TabsTrigger value="breakdown" data-testid="tab-breakdown">Sales Breakdown</TabsTrigger>
            <TabsTrigger value="commission" data-testid="tab-commission">Commission Summary</TabsTrigger>
            <TabsTrigger value="rep-leaderboard" data-testid="tab-rep-leaderboard">Rep Leaderboard</TabsTrigger>
            {summary?.scopeInfo?.role !== "REP" && (
              <TabsTrigger value="team-production" data-testid="tab-team-production">Team Production</TabsTrigger>
            )}
            {(summary?.scopeInfo?.role === "ADMIN" || summary?.scopeInfo?.role === "OPERATIONS" || summary?.scopeInfo?.role === "EXECUTIVE") && (
              <TabsTrigger value="override-invoices" data-testid="tab-override-invoices">Override by Invoice</TabsTrigger>
            )}
            {(summary?.scopeInfo?.role === "ADMIN" || summary?.scopeInfo?.role === "OPERATIONS" || summary?.scopeInfo?.role === "EXECUTIVE") && (
              <TabsTrigger value="payroll" data-testid="tab-payroll">Payroll Summary</TabsTrigger>
            )}
            {["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(summary?.scopeInfo?.role || "") && (
              <TabsTrigger value="profitability" data-testid="tab-profitability">Profitability</TabsTrigger>
            )}
            {["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(summary?.scopeInfo?.role || "") && (
              <TabsTrigger value="product-mix" data-testid="tab-product-mix">Product Mix</TabsTrigger>
            )}
            <TabsTrigger value="user-activity" data-testid="tab-user-activity">User Activity</TabsTrigger>
            {["ADMIN", "OPERATIONS", "EXECUTIVE"].includes(summary?.scopeInfo?.role || "") && (
              <TabsTrigger value="sales-tracker" data-testid="tab-sales-tracker">Sales Tracker</TabsTrigger>
            )}
          </TabsList>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[180px]" data-testid="select-period">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {period === "custom" && (
              <>
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-start-date"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-end-date"
                />
              </>
            )}
          </div>
        </div>

        <TabsContent value="detailed" className="space-y-4">
          {summaryLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map(i => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-8 w-32" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card data-testid="stat-total-orders">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total Orders</p>
                        <p className="text-3xl font-bold font-mono mt-2">{summary?.totalOrders || 0}</p>
                        <div className="flex items-center gap-1 mt-1">
                          {getTrendIcon(summary?.comparison.ordersTrend || "0")}
                          <span className={`text-xs ${getTrendColor(summary?.comparison.ordersTrend || "0")}`}>
                            {summary?.comparison.ordersTrend}% vs prev
                          </span>
                        </div>
                      </div>
                      <div className="p-2 rounded-md bg-primary/10">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="stat-total-earned">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total Earned</p>
                        <p className="text-3xl font-bold font-mono mt-2">${summary?.totalEarned || "0.00"}</p>
                        <div className="flex items-center gap-1 mt-1">
                          {getTrendIcon(summary?.comparison.earnedTrend || "0")}
                          <span className={`text-xs ${getTrendColor(summary?.comparison.earnedTrend || "0")}`}>
                            {summary?.comparison.earnedTrend}% vs prev
                          </span>
                        </div>
                      </div>
                      <div className="p-2 rounded-md bg-green-500/10">
                        <DollarSign className="h-5 w-5 text-green-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="stat-outstanding">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Outstanding</p>
                        <p className="text-3xl font-bold font-mono mt-2">${summary?.outstanding || "0.00"}</p>
                        <span className="text-xs text-muted-foreground">
                          Earned - Paid
                        </span>
                      </div>
                      <div className="p-2 rounded-md bg-yellow-500/10">
                        <Clock className="h-5 w-5 text-yellow-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="stat-approval-rate">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Approval Rate</p>
                        <p className="text-3xl font-bold font-mono mt-2">{summary?.approvalRate || "0"}%</p>
                        <span className="text-xs text-muted-foreground">
                          {summary?.approvedOrders || 0} of {summary?.totalOrders || 0} approved
                        </span>
                      </div>
                      <div className="p-2 rounded-md bg-blue-500/10">
                        <Percent className="h-5 w-5 text-blue-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card data-testid="stat-pending-dollars-detail">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Pending Dollars</p>
                        <p className="text-3xl font-bold font-mono mt-2">${summary?.pendingDollars || "0.00"}</p>
                        <span className="text-xs text-muted-foreground">
                          Commission from pending orders
                        </span>
                      </div>
                      <div className="p-2 rounded-md bg-orange-500/10">
                        <Clock className="h-5 w-5 text-orange-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="stat-connected-dollars-detail">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Connected Dollars</p>
                        <p className="text-3xl font-bold font-mono mt-2">${summary?.connectedDollars || "0.00"}</p>
                        <span className="text-xs text-muted-foreground">
                          Commission from completed orders
                        </span>
                      </div>
                      <div className="p-2 rounded-md bg-green-500/10">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatsCard
                  title="Avg Commission"
                  value={`$${summary?.avgCommission || "0.00"}`}
                  icon={DollarSign}
                  testId="stat-avg-commission"
                  isCurrency={false}
                />
                <StatsCard
                  title="Completed Orders"
                  value={summary?.completedOrders || 0}
                  icon={CheckCircle}
                  testId="stat-completed-orders"
                  isCurrency={false}
                />
                <StatsCard
                  title="Pending Approval"
                  value={summary?.pendingOrders || 0}
                  icon={Clock}
                  testId="stat-pending-orders"
                  isCurrency={false}
                />
                <StatsCard
                  title="Total Paid"
                  value={summary?.totalPaid || "0.00"}
                  icon={DollarSign}
                  testId="stat-total-paid"
                />
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="trend" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <div>
                <CardTitle className="text-lg">Sales Trend</CardTitle>
                <CardDescription>Orders and earnings over time</CardDescription>
              </div>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="w-[120px]" data-testid="select-group-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Daily</SelectItem>
                  <SelectItem value="week">Weekly</SelectItem>
                  <SelectItem value="month">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {trendData?.data?.length ? (
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={trendData.data}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" className="text-xs" />
                    <YAxis yAxisId="left" className="text-xs" />
                    <YAxis yAxisId="right" orientation="right" className="text-xs" tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      formatter={(value: number, name: string) => [
                        name === "earned" ? formatCurrency(value) : value,
                        name === "earned" ? "Earned" : "Orders"
                      ]}
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} name="Orders" />
                    <Line yAxisId="right" type="monotone" dataKey="earned" stroke="#10b981" strokeWidth={2} name="Earned" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[350px] flex items-center justify-center text-muted-foreground">
                  No data for selected period
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Performers by Revenue</CardTitle>
                <CardDescription>Commission earned by rep</CardDescription>
              </CardHeader>
              <CardContent>
                {salesByRep?.data?.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={salesByRep.data.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tickFormatter={v => `$${v}`} className="text-xs" />
                      <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                        formatter={(value: number) => [formatCurrency(value), "Earned"]}
                      />
                      <Bar dataKey="earned" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No data for selected period
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Performers by Volume</CardTitle>
                <CardDescription>Order count by rep</CardDescription>
              </CardHeader>
              <CardContent>
                {salesByRep?.data?.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={salesByRep.data.slice(0, 10).sort((a, b) => b.orders - a.orders)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                        formatter={(value: number) => [value, "Orders"]}
                      />
                      <Bar dataKey="orders" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No data for selected period
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="breakdown" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Sales by Provider</CardTitle>
                <CardDescription>Order distribution across providers</CardDescription>
              </CardHeader>
              <CardContent>
                {salesByProvider?.data?.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={salesByProvider.data}
                        dataKey="orders"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {salesByProvider.data.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No data for selected period
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Sales by Service</CardTitle>
                <CardDescription>Order distribution across services</CardDescription>
              </CardHeader>
              <CardContent>
                {salesByService?.data?.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={salesByService.data.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" className="text-xs" angle={-45} textAnchor="end" height={80} />
                      <YAxis className="text-xs" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                      />
                      <Bar dataKey="orders" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Orders" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No data for selected period
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="commission" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
              <div>
                <CardTitle className="text-lg">Commission Summary by Rep</CardTitle>
                <CardDescription>Earned vs Paid breakdown</CardDescription>
              </div>
              {commissionSummary?.totals && (
                <div className="flex gap-6 text-sm flex-wrap">
                  <div>
                    <span className="text-muted-foreground">Total Earned: </span>
                    <span className="font-mono font-medium">{formatCurrency(commissionSummary.totals.totalEarned)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Paid: </span>
                    <span className="font-mono font-medium">{formatCurrency(commissionSummary.totals.totalPaid)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Outstanding: </span>
                    <span className="font-mono font-medium text-yellow-600">{formatCurrency(commissionSummary.totals.totalOutstanding)}</span>
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {commissionSummary?.data?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-2 font-medium">Rep</th>
                        <th className="text-right py-3 px-2 font-medium">Orders</th>
                        <th className="text-right py-3 px-2 font-medium">Earned</th>
                        <th className="text-right py-3 px-2 font-medium">Paid</th>
                        <th className="text-right py-3 px-2 font-medium">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissionSummary.data.map((row) => (
                        <tr key={row.repId} className="border-b last:border-0 hover-elevate">
                          <td className="py-3 px-2">
                            <div>
                              <span className="font-medium">{row.name}</span>
                              <span className="text-muted-foreground ml-2 font-mono text-xs">({row.repId})</span>
                            </div>
                          </td>
                          <td className="text-right py-3 px-2 font-mono">{row.orders}</td>
                          <td className="text-right py-3 px-2 font-mono text-green-600">{formatCurrency(row.earned)}</td>
                          <td className="text-right py-3 px-2 font-mono">{formatCurrency(row.paid)}</td>
                          <td className="text-right py-3 px-2 font-mono text-yellow-600">{formatCurrency(row.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  No data for selected period
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rep-leaderboard" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Rep Leaderboard
                  </CardTitle>
                  <CardDescription>Detailed individual rep performance metrics</CardDescription>
                </div>
                {repLeaderboard?.totals && (
                  <div className="flex gap-4 text-sm flex-wrap">
                    <div>
                      <span className="text-muted-foreground">Reps: </span>
                      <span className="font-mono font-medium">{repLeaderboard.data.length}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Earned: </span>
                      <span className="font-mono font-medium text-green-600">{formatCurrency(repLeaderboard.totals.totalEarned)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Leads: </span>
                      <span className="font-mono font-medium">{repLeaderboard.totals.totalLeads}</span>
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {repLeaderboard?.data?.length ? (
                  <div className="overflow-x-auto">
                    <div className="min-w-[1200px]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-3 px-2 font-medium sticky left-0 bg-muted/50">Rep</th>
                            <th className="text-left py-3 px-2 font-medium">Role</th>
                            <th className="text-left py-3 px-2 font-medium">Supervisor</th>
                            <th className="text-right py-3 px-2 font-medium">Sold</th>
                            <th className="text-right py-3 px-2 font-medium">Connected</th>
                            <th className="text-right py-3 px-2 font-medium">Pending</th>
                            <th className="text-right py-3 px-2 font-medium">Earned</th>
                            <th className="text-right py-3 px-2 font-medium">Paid</th>
                            <th className="text-right py-3 px-2 font-medium">Outstanding</th>
                            <th className="text-right py-3 px-2 font-medium">Mobile</th>
                            <th className="text-right py-3 px-2 font-medium">TV</th>
                            <th className="text-right py-3 px-2 font-medium">Internet</th>
                            <th className="text-right py-3 px-2 font-medium">Approval %</th>
                            <th className="text-right py-3 px-2 font-medium">Connect %</th>
                            <th className="text-right py-3 px-2 font-medium">Leads</th>
                            <th className="text-right py-3 px-2 font-medium">Conv %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {repLeaderboard.data.map((rep, idx) => (
                            <tr key={rep.userId} className="border-b last:border-0 hover-elevate" data-testid={`rep-leaderboard-row-${rep.repId}`}>
                              <td className="py-3 px-2 sticky left-0 bg-card">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground font-mono text-xs">#{idx + 1}</span>
                                  <div>
                                    <span className="font-medium">{rep.name}</span>
                                    <span className="text-muted-foreground ml-1 font-mono text-xs">({rep.repId})</span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-2">
                                <Badge variant="outline" className="text-xs">{rep.role}</Badge>
                              </td>
                              <td className="py-3 px-2 text-muted-foreground text-xs">{rep.supervisorName || "-"}</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.ordersSold}</td>
                              <td className="text-right py-3 px-2 font-mono text-green-600">{rep.ordersConnected}</td>
                              <td className="text-right py-3 px-2 font-mono text-yellow-600">{rep.ordersPending}</td>
                              <td className="text-right py-3 px-2 font-mono text-green-600">{formatCurrency(rep.earned)}</td>
                              <td className="text-right py-3 px-2 font-mono">{formatCurrency(rep.paid)}</td>
                              <td className="text-right py-3 px-2 font-mono text-yellow-600">{formatCurrency(rep.outstanding)}</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.mobileLines}</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.tvSold}</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.internetSold}</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.approvalRate.toFixed(0)}%</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.connectionRate.toFixed(0)}%</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.leadsTotal > 0 ? `${rep.leadsConverted}/${rep.leadsTotal}` : "-"}</td>
                              <td className="text-right py-3 px-2 font-mono">{rep.leadsTotal > 0 ? `${rep.conversionRate.toFixed(0)}%` : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/50 font-medium">
                            <td colSpan={3} className="py-3 px-2">Totals ({repLeaderboard.data.length} reps)</td>
                            <td className="text-right py-3 px-2 font-mono">{repLeaderboard.totals.totalOrders}</td>
                            <td className="text-right py-3 px-2 font-mono text-green-600">{repLeaderboard.totals.totalConnected}</td>
                            <td className="text-right py-3 px-2 font-mono">-</td>
                            <td className="text-right py-3 px-2 font-mono text-green-600">{formatCurrency(repLeaderboard.totals.totalEarned)}</td>
                            <td className="text-right py-3 px-2 font-mono">{formatCurrency(repLeaderboard.totals.totalPaid)}</td>
                            <td className="text-right py-3 px-2 font-mono text-yellow-600">{formatCurrency(repLeaderboard.totals.totalEarned - repLeaderboard.totals.totalPaid)}</td>
                            <td className="text-right py-3 px-2 font-mono">{repLeaderboard.totals.totalMobileLines}</td>
                            <td className="text-right py-3 px-2 font-mono">-</td>
                            <td className="text-right py-3 px-2 font-mono">-</td>
                            <td className="text-right py-3 px-2 font-mono">-</td>
                            <td className="text-right py-3 px-2 font-mono">-</td>
                            <td className="text-right py-3 px-2 font-mono">{repLeaderboard.totals.totalConverted}/{repLeaderboard.totals.totalLeads}</td>
                            <td className="text-right py-3 px-2 font-mono">{repLeaderboard.totals.totalLeads > 0 ? `${((repLeaderboard.totals.totalConverted / repLeaderboard.totals.totalLeads) * 100).toFixed(0)}%` : "-"}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-muted-foreground">
                    No rep data available for this period
                  </div>
                )}
              </CardContent>
            </Card>
        </TabsContent>

        {summary?.scopeInfo?.role !== "REP" && (
          <TabsContent value="team-production" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Team Production Overview
                  </CardTitle>
                  <CardDescription>View sold, connected orders, and mobile lines by team leader</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {teamProduction?.data?.length ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-muted/50 rounded-md">
                      <div>
                        <div className="text-sm text-muted-foreground">Total Sold</div>
                        <div className="text-xl font-bold">{teamProduction.totals.totalSold}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Total Connected</div>
                        <div className="text-xl font-bold text-green-600">{teamProduction.totals.totalConnected}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Mobile Lines</div>
                        <div className="text-xl font-bold">{teamProduction.totals.totalMobileLines}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Pending $</div>
                        <div className="text-xl font-bold text-yellow-600">{formatCurrency(teamProduction.totals.totalPendingDollars)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Connected $</div>
                        <div className="text-xl font-bold text-green-600">{formatCurrency(teamProduction.totals.totalConnectedDollars)}</div>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-2 font-medium">Team Leader</th>
                            <th className="text-left py-3 px-2 font-medium">Role</th>
                            <th className="text-right py-3 px-2 font-medium">Team Size</th>
                            <th className="text-right py-3 px-2 font-medium">Sold</th>
                            <th className="text-right py-3 px-2 font-medium">Connected</th>
                            <th className="text-right py-3 px-2 font-medium">Mobile Lines</th>
                            <th className="text-right py-3 px-2 font-medium">Pending $</th>
                            <th className="text-right py-3 px-2 font-medium">Connected $</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamProduction.data.map((team) => (
                            <tr key={team.leaderId} className="border-b last:border-0 hover-elevate">
                              <td className="py-3 px-2">
                                <div>
                                  <span className="font-medium">{team.leaderName}</span>
                                  <span className="text-muted-foreground ml-2 font-mono text-xs">({team.leaderRepId})</span>
                                </div>
                              </td>
                              <td className="py-3 px-2">
                                <Badge variant="outline" className="text-xs">{team.role}</Badge>
                              </td>
                              <td className="text-right py-3 px-2 font-mono">{team.teamSize}</td>
                              <td className="text-right py-3 px-2 font-mono">{team.sold}</td>
                              <td className="text-right py-3 px-2 font-mono text-green-600">{team.connected}</td>
                              <td className="text-right py-3 px-2 font-mono">{team.mobileLines}</td>
                              <td className="text-right py-3 px-2 font-mono text-yellow-600">{formatCurrency(team.pendingDollars)}</td>
                              <td className="text-right py-3 px-2 font-mono text-green-600">{formatCurrency(team.connectedDollars)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-muted-foreground">
                    No team production data available
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {(summary?.scopeInfo?.role === "ADMIN" || summary?.scopeInfo?.role === "OPERATIONS" || summary?.scopeInfo?.role === "EXECUTIVE") && (
          <TabsContent value="override-invoices" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
                <div>
                  <CardTitle className="text-lg">Override Earnings by Invoice</CardTitle>
                  <CardDescription>Override commissions grouped by invoice/order</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {overrideInvoices?.totals?.invoiceCount || 0} invoices
                  </Badge>
                  <Badge variant="default">
                    ${overrideInvoices?.totals?.totalOverrides || "0.00"} total
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {overrideInvoices?.data?.length ? (
                  <div className="overflow-x-auto">
                    <div className="min-w-[700px]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-3 px-2 font-medium">Invoice #</th>
                            <th className="text-left py-3 px-2 font-medium">Date</th>
                            <th className="text-left py-3 px-2 font-medium">Customer</th>
                            <th className="text-left py-3 px-2 font-medium">Rep</th>
                            <th className="text-left py-3 px-2 font-medium">Recipients</th>
                            <th className="text-right py-3 px-2 font-medium">Override Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overrideInvoices.data.map((inv) => (
                            <tr key={inv.orderId} className="border-b last:border-0 hover-elevate" data-testid={`override-invoice-row-${inv.orderId}`}>
                              <td className="py-3 px-2 font-mono text-xs">
                                {inv.invoiceNumber || "-"}
                              </td>
                              <td className="py-3 px-2">{inv.dateSold}</td>
                              <td className="py-3 px-2">{inv.customerName}</td>
                              <td className="py-3 px-2">{inv.repName}</td>
                              <td className="py-3 px-2">
                                <div className="flex flex-wrap gap-1">
                                  {inv.overrides.map((o, idx) => (
                                    <Badge key={idx} variant="outline" className="text-xs">
                                      {o.recipientName} ({o.recipientRole}): ${o.amount}
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                              <td className="text-right py-3 px-2 font-mono font-semibold text-green-600">
                                {formatCurrency(inv.totalOverride)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/50 font-medium">
                            <td colSpan={5} className="py-3 px-2 text-right">Total:</td>
                            <td className="text-right py-3 px-2 font-mono text-green-600">
                              ${overrideInvoices?.totals?.totalOverrides || "0.00"}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-muted-foreground">
                    No override earnings found for this period
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {(summary?.scopeInfo?.role === "ADMIN" || summary?.scopeInfo?.role === "OPERATIONS" || summary?.scopeInfo?.role === "EXECUTIVE") && (
          <TabsContent value="payroll" className="space-y-4">
            <PayrollSummaryTab period={period} customStartDate={customStartDate} customEndDate={customEndDate} />
          </TabsContent>
        )}

        {["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(summary?.scopeInfo?.role || "") && (
          <TabsContent value="profitability" className="space-y-4">
            <ProfitabilityTab period={period} customStartDate={customStartDate} customEndDate={customEndDate} />
          </TabsContent>
        )}

        {["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER"].includes(summary?.scopeInfo?.role || "") && (
          <TabsContent value="product-mix" className="space-y-4">
            <ProductMixTab period={period} customStartDate={customStartDate} customEndDate={customEndDate} />
          </TabsContent>
        )}

        <TabsContent value="user-activity" className="space-y-6">
          {userActivityLoading ? (
            <div className="grid gap-4 md:grid-cols-4">
              {[1,2,3,4].map(i => <Card key={i}><CardContent className="p-6"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-32" /></CardContent></Card>)}
            </div>
          ) : (
            <>
              <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                <Card data-testid="activity-tw-submitted">
                  <CardContent className="p-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Week Submitted</p>
                    <p className="text-2xl font-bold font-mono mt-1">{userActivity?.totals?.thisWeek?.submitted || 0}</p>
                    <p className="text-xs text-muted-foreground">{userActivity?.periods?.thisWeek?.start} – {userActivity?.periods?.thisWeek?.end}</p>
                  </CardContent>
                </Card>
                <Card data-testid="activity-tw-connected">
                  <CardContent className="p-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Week Connected</p>
                    <p className="text-2xl font-bold font-mono mt-1 text-green-600">{userActivity?.totals?.thisWeek?.connected || 0}</p>
                    <p className="text-xs text-muted-foreground">{userActivity?.periods?.thisWeek?.start} – {userActivity?.periods?.thisWeek?.end}</p>
                  </CardContent>
                </Card>
                <Card data-testid="activity-tm-submitted">
                  <CardContent className="p-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Month Submitted</p>
                    <p className="text-2xl font-bold font-mono mt-1">{userActivity?.totals?.thisMonth?.submitted || 0}</p>
                    <p className="text-xs text-muted-foreground">{userActivity?.periods?.thisMonth}</p>
                  </CardContent>
                </Card>
                <Card data-testid="activity-tm-connected">
                  <CardContent className="p-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Month Connected</p>
                    <p className="text-2xl font-bold font-mono mt-1 text-green-600">{userActivity?.totals?.thisMonth?.connected || 0}</p>
                    <p className="text-xs text-muted-foreground">{userActivity?.periods?.thisMonth}</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Week over Week
                  </CardTitle>
                  <CardDescription>
                    {userActivity?.periods?.thisWeek?.start} – {userActivity?.periods?.thisWeek?.end} vs {userActivity?.periods?.lastWeek?.start} – {userActivity?.periods?.lastWeek?.end}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {userActivity?.data?.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-3 px-2 font-medium">User</th>
                            <th className="text-right py-3 px-2 font-medium">Submitted</th>
                            <th className="text-right py-3 px-2 font-medium">Connected</th>
                            <th className="text-right py-3 px-2 font-medium">Last Wk Submitted</th>
                            <th className="text-right py-3 px-2 font-medium">Last Wk Connected</th>
                            <th className="text-right py-3 px-2 font-medium">WoW Submitted</th>
                            <th className="text-right py-3 px-2 font-medium">WoW Connected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userActivity.data.map((u) => (
                            <tr key={u.repId} className="border-b last:border-0 hover-elevate" data-testid={`row-activity-wow-${u.repId}`}>
                              <td className="py-3 px-2">
                                <div className="font-medium">{u.name}</div>
                                <div className="text-xs text-muted-foreground">{u.repId} · {u.role}</div>
                              </td>
                              <td className="text-right py-3 px-2 font-mono">{u.thisWeek.submitted}</td>
                              <td className="text-right py-3 px-2 font-mono text-green-600">{u.thisWeek.connected}</td>
                              <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastWeek.submitted}</td>
                              <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastWeek.connected}</td>
                              <td className="text-right py-3 px-2">
                                <span className={`font-mono text-sm ${u.weekOverWeek.submitted.value > 0 ? "text-green-600" : u.weekOverWeek.submitted.value < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                  {u.weekOverWeek.submitted.value > 0 ? "+" : ""}{u.weekOverWeek.submitted.value} ({u.weekOverWeek.submitted.percent}%)
                                </span>
                              </td>
                              <td className="text-right py-3 px-2">
                                <span className={`font-mono text-sm ${u.weekOverWeek.connected.value > 0 ? "text-green-600" : u.weekOverWeek.connected.value < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                  {u.weekOverWeek.connected.value > 0 ? "+" : ""}{u.weekOverWeek.connected.value} ({u.weekOverWeek.connected.percent}%)
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/50 font-medium">
                            <td className="py-3 px-2">Totals</td>
                            <td className="text-right py-3 px-2 font-mono">{userActivity.totals.thisWeek.submitted}</td>
                            <td className="text-right py-3 px-2 font-mono text-green-600">{userActivity.totals.thisWeek.connected}</td>
                            <td className="text-right py-3 px-2 font-mono text-muted-foreground">{userActivity.totals.lastWeek.submitted}</td>
                            <td className="text-right py-3 px-2 font-mono text-muted-foreground">{userActivity.totals.lastWeek.connected}</td>
                            <td className="text-right py-3 px-2 font-mono">
                              {(() => { const v = userActivity.totals.thisWeek.submitted - userActivity.totals.lastWeek.submitted; return <span className={v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : ""}>{v > 0 ? "+" : ""}{v}</span>; })()}
                            </td>
                            <td className="text-right py-3 px-2 font-mono">
                              {(() => { const v = userActivity.totals.thisWeek.connected - userActivity.totals.lastWeek.connected; return <span className={v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : ""}>{v > 0 ? "+" : ""}{v}</span>; })()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="py-12 text-center text-muted-foreground">No user activity data available</div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Month over Month
                  </CardTitle>
                  <CardDescription>
                    {userActivity?.periods?.thisMonth} vs {userActivity?.periods?.lastMonth}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {userActivity?.data?.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left py-3 px-2 font-medium">User</th>
                            <th className="text-right py-3 px-2 font-medium">Submitted</th>
                            <th className="text-right py-3 px-2 font-medium">Connected</th>
                            <th className="text-right py-3 px-2 font-medium">Last Mo Submitted</th>
                            <th className="text-right py-3 px-2 font-medium">Last Mo Connected</th>
                            <th className="text-right py-3 px-2 font-medium">MoM Submitted</th>
                            <th className="text-right py-3 px-2 font-medium">MoM Connected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userActivity.data.sort((a, b) => b.thisMonth.submitted - a.thisMonth.submitted).map((u) => (
                            <tr key={u.repId} className="border-b last:border-0 hover-elevate" data-testid={`row-activity-mom-${u.repId}`}>
                              <td className="py-3 px-2">
                                <div className="font-medium">{u.name}</div>
                                <div className="text-xs text-muted-foreground">{u.repId} · {u.role}</div>
                              </td>
                              <td className="text-right py-3 px-2 font-mono">{u.thisMonth.submitted}</td>
                              <td className="text-right py-3 px-2 font-mono text-green-600">{u.thisMonth.connected}</td>
                              <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastMonth.submitted}</td>
                              <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastMonth.connected}</td>
                              <td className="text-right py-3 px-2">
                                <span className={`font-mono text-sm ${u.monthOverMonth.submitted.value > 0 ? "text-green-600" : u.monthOverMonth.submitted.value < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                  {u.monthOverMonth.submitted.value > 0 ? "+" : ""}{u.monthOverMonth.submitted.value} ({u.monthOverMonth.submitted.percent}%)
                                </span>
                              </td>
                              <td className="text-right py-3 px-2">
                                <span className={`font-mono text-sm ${u.monthOverMonth.connected.value > 0 ? "text-green-600" : u.monthOverMonth.connected.value < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                  {u.monthOverMonth.connected.value > 0 ? "+" : ""}{u.monthOverMonth.connected.value} ({u.monthOverMonth.connected.percent}%)
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/50 font-medium">
                            <td className="py-3 px-2">Totals</td>
                            <td className="text-right py-3 px-2 font-mono">{userActivity.totals.thisMonth.submitted}</td>
                            <td className="text-right py-3 px-2 font-mono text-green-600">{userActivity.totals.thisMonth.connected}</td>
                            <td className="text-right py-3 px-2 font-mono text-muted-foreground">{userActivity.totals.lastMonth.submitted}</td>
                            <td className="text-right py-3 px-2 font-mono text-muted-foreground">{userActivity.totals.lastMonth.connected}</td>
                            <td className="text-right py-3 px-2 font-mono">
                              {(() => { const v = userActivity.totals.thisMonth.submitted - userActivity.totals.lastMonth.submitted; return <span className={v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : ""}>{v > 0 ? "+" : ""}{v}</span>; })()}
                            </td>
                            <td className="text-right py-3 px-2 font-mono">
                              {(() => { const v = userActivity.totals.thisMonth.connected - userActivity.totals.lastMonth.connected; return <span className={v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : ""}>{v > 0 ? "+" : ""}{v}</span>; })()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="py-12 text-center text-muted-foreground">No user activity data available</div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="sales-tracker" className="space-y-6">
          {salesTrackerLoading ? (
            <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
              {[1,2,3,4,5,6].map(i => <Card key={i}><CardContent className="p-6"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-32" /></CardContent></Card>)}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border rounded-md p-1 w-fit" data-testid="toggle-tracker-view">
                <Button variant={trackerView === "daily" ? "default" : "ghost"} size="sm" onClick={() => setTrackerView("daily")} data-testid="button-tracker-daily">Daily</Button>
                <Button variant={trackerView === "weekly" ? "default" : "ghost"} size="sm" onClick={() => setTrackerView("weekly")} data-testid="button-tracker-weekly">Weekly</Button>
                <Button variant={trackerView === "monthly" ? "default" : "ghost"} size="sm" onClick={() => setTrackerView("monthly")} data-testid="button-tracker-monthly">Monthly</Button>
              </div>

              {trackerView === "daily" && (
                <>
                  <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                    <Card data-testid="tracker-today-submitted">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today Submitted</p>
                        <p className="text-2xl font-bold font-mono mt-1">{salesTracker?.totals?.today?.submitted || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.today}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="tracker-today-connected">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today Connected</p>
                        <p className="text-2xl font-bold font-mono mt-1 text-green-600">{salesTracker?.totals?.today?.connected || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.today}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="tracker-yesterday-submitted">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Yesterday Submitted</p>
                        <p className="text-2xl font-bold font-mono mt-1">{salesTracker?.totals?.yesterday?.submitted || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.yesterday}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="tracker-yesterday-connected">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Yesterday Connected</p>
                        <p className="text-2xl font-bold font-mono mt-1 text-green-600">{salesTracker?.totals?.yesterday?.connected || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.yesterday}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Daily Breakdown — This Week
                      </CardTitle>
                      <CardDescription>
                        {salesTracker?.periods?.thisWeek?.start} – {salesTracker?.periods?.thisWeek?.end}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {salesTracker?.dailyTotals?.length ? (
                        <div className="h-64 mb-6">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={salesTracker.dailyTotals}>
                              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                              <Tooltip />
                              <Bar dataKey="submitted" name="Submitted" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="connected" name="Connected" fill="#10b981" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : null}
                      {salesTracker?.data?.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left py-3 px-2 font-medium">Sales ID</th>
                                {salesTracker.dailyTotals.map(d => (
                                  <th key={d.day} className="text-right py-3 px-2 font-medium">{d.day}</th>
                                ))}
                                <th className="text-right py-3 px-2 font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salesTracker.data.map(u => (
                                <tr key={u.repId} className="border-b last:border-0 hover-elevate" data-testid={`row-tracker-daily-${u.repId}`}>
                                  <td className="py-3 px-2">
                                    <div className="font-medium">{u.name}</div>
                                    <div className="text-xs text-muted-foreground">{u.repId}</div>
                                  </td>
                                  {u.dailyBreakdown.map(d => (
                                    <td key={d.day} className="text-right py-3 px-2 font-mono">{d.submitted || ""}</td>
                                  ))}
                                  <td className="text-right py-3 px-2 font-mono font-medium">{u.thisWeek.submitted}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-muted/50 font-medium">
                                <td className="py-3 px-2">Totals</td>
                                {salesTracker.dailyTotals.map(d => (
                                  <td key={d.day} className="text-right py-3 px-2 font-mono">{d.submitted || ""}</td>
                                ))}
                                <td className="text-right py-3 px-2 font-mono">{salesTracker.totals.thisWeek.submitted}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="py-12 text-center text-muted-foreground">No sales data available</div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}

              {trackerView === "weekly" && (
                <>
                  <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
                    <Card data-testid="tracker-tw-submitted">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Week Submitted</p>
                        <p className="text-2xl font-bold font-mono mt-1">{salesTracker?.totals?.thisWeek?.submitted || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.thisWeek?.start} – {salesTracker?.periods?.thisWeek?.end}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="tracker-tw-connected">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Week Connected</p>
                        <p className="text-2xl font-bold font-mono mt-1 text-green-600">{salesTracker?.totals?.thisWeek?.connected || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.thisWeek?.start} – {salesTracker?.periods?.thisWeek?.end}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="tracker-lw-submitted">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last Week Submitted</p>
                        <p className="text-2xl font-bold font-mono mt-1 text-muted-foreground">{salesTracker?.totals?.lastWeek?.submitted || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.lastWeek?.start} – {salesTracker?.periods?.lastWeek?.end}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        Current Week vs Previous Week
                      </CardTitle>
                      <CardDescription>
                        {salesTracker?.periods?.thisWeek?.start} – {salesTracker?.periods?.thisWeek?.end} vs {salesTracker?.periods?.lastWeek?.start} – {salesTracker?.periods?.lastWeek?.end}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {salesTracker?.data?.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left py-3 px-2 font-medium">Sales ID</th>
                                <th className="text-right py-3 px-2 font-medium">This Wk</th>
                                <th className="text-right py-3 px-2 font-medium">Connected</th>
                                <th className="text-right py-3 px-2 font-medium">Last Wk</th>
                                <th className="text-right py-3 px-2 font-medium">Connected</th>
                                <th className="text-right py-3 px-2 font-medium">Change</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salesTracker.data.map(u => {
                                const diff = u.thisWeek.submitted - u.lastWeek.submitted;
                                return (
                                  <tr key={u.repId} className="border-b last:border-0 hover-elevate" data-testid={`row-tracker-wow-${u.repId}`}>
                                    <td className="py-3 px-2">
                                      <div className="font-medium">{u.name}</div>
                                      <div className="text-xs text-muted-foreground">{u.repId}</div>
                                    </td>
                                    <td className="text-right py-3 px-2 font-mono">{u.thisWeek.submitted}</td>
                                    <td className="text-right py-3 px-2 font-mono text-green-600">{u.thisWeek.connected}</td>
                                    <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastWeek.submitted}</td>
                                    <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastWeek.connected}</td>
                                    <td className="text-right py-3 px-2">
                                      <span className={`font-mono text-sm ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                        {diff > 0 ? "+" : ""}{diff} ({u.weekOverWeek.submitted.percent}%)
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-muted/50 font-medium">
                                <td className="py-3 px-2">Totals</td>
                                <td className="text-right py-3 px-2 font-mono">{salesTracker.totals.thisWeek.submitted}</td>
                                <td className="text-right py-3 px-2 font-mono text-green-600">{salesTracker.totals.thisWeek.connected}</td>
                                <td className="text-right py-3 px-2 font-mono text-muted-foreground">{salesTracker.totals.lastWeek.submitted}</td>
                                <td className="text-right py-3 px-2 font-mono text-muted-foreground">{salesTracker.totals.lastWeek.connected}</td>
                                <td className="text-right py-3 px-2 font-mono">
                                  {(() => { const v = salesTracker.totals.thisWeek.submitted - salesTracker.totals.lastWeek.submitted; return <span className={v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : ""}>{v > 0 ? "+" : ""}{v}</span>; })()}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="py-12 text-center text-muted-foreground">No sales data available</div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}

              {trackerView === "monthly" && (
                <>
                  <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
                    <Card data-testid="tracker-tm-submitted">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Month Submitted</p>
                        <p className="text-2xl font-bold font-mono mt-1">{salesTracker?.totals?.thisMonth?.submitted || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.thisMonth}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="tracker-tm-connected">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This Month Connected</p>
                        <p className="text-2xl font-bold font-mono mt-1 text-green-600">{salesTracker?.totals?.thisMonth?.connected || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.thisMonth}</p>
                      </CardContent>
                    </Card>
                    <Card data-testid="tracker-lm-submitted">
                      <CardContent className="p-5">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last Month Submitted</p>
                        <p className="text-2xl font-bold font-mono mt-1 text-muted-foreground">{salesTracker?.totals?.lastMonth?.submitted || 0}</p>
                        <p className="text-xs text-muted-foreground">{salesTracker?.periods?.lastMonth}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        Current Month vs Previous Month
                      </CardTitle>
                      <CardDescription>
                        {salesTracker?.periods?.thisMonth} vs {salesTracker?.periods?.lastMonth}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {salesTracker?.data?.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left py-3 px-2 font-medium">Sales ID</th>
                                <th className="text-right py-3 px-2 font-medium">This Mo</th>
                                <th className="text-right py-3 px-2 font-medium">Connected</th>
                                <th className="text-right py-3 px-2 font-medium">Last Mo</th>
                                <th className="text-right py-3 px-2 font-medium">Connected</th>
                                <th className="text-right py-3 px-2 font-medium">Change</th>
                              </tr>
                            </thead>
                            <tbody>
                              {salesTracker.data.sort((a, b) => b.thisMonth.submitted - a.thisMonth.submitted).map(u => {
                                const diff = u.thisMonth.submitted - u.lastMonth.submitted;
                                return (
                                  <tr key={u.repId} className="border-b last:border-0 hover-elevate" data-testid={`row-tracker-mom-${u.repId}`}>
                                    <td className="py-3 px-2">
                                      <div className="font-medium">{u.name}</div>
                                      <div className="text-xs text-muted-foreground">{u.repId}</div>
                                    </td>
                                    <td className="text-right py-3 px-2 font-mono">{u.thisMonth.submitted}</td>
                                    <td className="text-right py-3 px-2 font-mono text-green-600">{u.thisMonth.connected}</td>
                                    <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastMonth.submitted}</td>
                                    <td className="text-right py-3 px-2 font-mono text-muted-foreground">{u.lastMonth.connected}</td>
                                    <td className="text-right py-3 px-2">
                                      <span className={`font-mono text-sm ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                        {diff > 0 ? "+" : ""}{diff} ({u.monthOverMonth.submitted.percent}%)
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-muted/50 font-medium">
                                <td className="py-3 px-2">Totals</td>
                                <td className="text-right py-3 px-2 font-mono">{salesTracker.totals.thisMonth.submitted}</td>
                                <td className="text-right py-3 px-2 font-mono text-green-600">{salesTracker.totals.thisMonth.connected}</td>
                                <td className="text-right py-3 px-2 font-mono text-muted-foreground">{salesTracker.totals.lastMonth.submitted}</td>
                                <td className="text-right py-3 px-2 font-mono text-muted-foreground">{salesTracker.totals.lastMonth.connected}</td>
                                <td className="text-right py-3 px-2 font-mono">
                                  {(() => { const v = salesTracker.totals.thisMonth.submitted - salesTracker.totals.lastMonth.submitted; return <span className={v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : ""}>{v > 0 ? "+" : ""}{v}</span>; })()}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="py-12 text-center text-muted-foreground">No sales data available</div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PayrollSummaryTab({ period, customStartDate, customEndDate }: { period: string; customStartDate: string; customEndDate: string }) {
  const { data: payrollSummary, isLoading } = useQuery<{
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    statementsCount: number;
    advancesOutstanding: number;
    repBreakdown: Array<{ repId: string; name: string; gross: number; deductions: number; net: number; statementsCount: number }>;
  }>({
    queryKey: ["/api/admin/payroll/reports/summary", period, customStartDate, customEndDate],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (period === "custom" && customStartDate) params.set("startDate", customStartDate);
      if (period === "custom" && customEndDate) params.set("endDate", customEndDate);
      const res = await fetch(`/api/admin/payroll/reports/summary?${params}`, { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch payroll summary");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card data-testid="payroll-stat-gross">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total Gross</p>
                <p className="text-3xl font-bold font-mono mt-2 text-green-600">{formatCurrency(payrollSummary?.totalGross || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-green-500/10">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="payroll-stat-deductions">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total Deductions</p>
                <p className="text-3xl font-bold font-mono mt-2 text-red-600">{formatCurrency(payrollSummary?.totalDeductions || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-red-500/10">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="payroll-stat-net">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total Net Pay</p>
                <p className="text-3xl font-bold font-mono mt-2">{formatCurrency(payrollSummary?.totalNet || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="payroll-stat-advances">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Advances Outstanding</p>
                <p className="text-3xl font-bold font-mono mt-2 text-amber-600">{formatCurrency(payrollSummary?.advancesOutstanding || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-amber-500/10">
                <TrendingUp className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payroll by Rep</CardTitle>
          <CardDescription>Breakdown of payroll costs per team member</CardDescription>
        </CardHeader>
        <CardContent>
          {payrollSummary?.repBreakdown?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-2 font-medium">Rep</th>
                    <th className="text-right py-3 px-2 font-medium">Gross</th>
                    <th className="text-right py-3 px-2 font-medium">Deductions</th>
                    <th className="text-right py-3 px-2 font-medium">Net Pay</th>
                    <th className="text-right py-3 px-2 font-medium">Statements</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollSummary.repBreakdown.map((rep) => (
                    <tr key={rep.repId} className="border-b last:border-0 hover-elevate">
                      <td className="py-3 px-2">
                        <div>
                          <span className="font-medium">{rep.name}</span>
                          <span className="text-muted-foreground ml-2 text-xs">({rep.repId})</span>
                        </div>
                      </td>
                      <td className="text-right py-3 px-2 font-mono text-green-600">{formatCurrency(rep.gross)}</td>
                      <td className="text-right py-3 px-2 font-mono text-red-600">{formatCurrency(rep.deductions)}</td>
                      <td className="text-right py-3 px-2 font-mono font-semibold">{formatCurrency(rep.net)}</td>
                      <td className="text-right py-3 px-2">{rep.statementsCount}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50 font-medium">
                    <td className="py-3 px-2">Total</td>
                    <td className="text-right py-3 px-2 font-mono text-green-600">{formatCurrency(payrollSummary?.totalGross || 0)}</td>
                    <td className="text-right py-3 px-2 font-mono text-red-600">{formatCurrency(payrollSummary?.totalDeductions || 0)}</td>
                    <td className="text-right py-3 px-2 font-mono font-semibold">{formatCurrency(payrollSummary?.totalNet || 0)}</td>
                    <td className="text-right py-3 px-2">{payrollSummary?.statementsCount || 0}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No payroll data found for this period
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitabilityTab({ period, customStartDate, customEndDate }: { period: string; customStartDate: string; customEndDate: string }) {
  const [groupBy, setGroupBy] = useState<"provider" | "client">("provider");
  
  const { data: profitability, isLoading } = useQuery<{
    data: Array<{
      id: string;
      name: string;
      orders: number;
      revenue: number;
      commissionCost: number;
      overrideCost: number;
      margin: number;
      marginPercent: number;
    }>;
    totals: {
      totalOrders: number;
      totalRevenue: number;
      totalCommissionCost: number;
      totalOverrideCost: number;
      totalMargin: number;
      avgMarginPercent: number;
    };
  }>({
    queryKey: ["/api/reports/profitability", period, customStartDate, customEndDate, groupBy],
    queryFn: async () => {
      const params = new URLSearchParams({ period, type: groupBy });
      if (period === "custom" && customStartDate) params.set("startDate", customStartDate);
      if (period === "custom" && customEndDate) params.set("endDate", customEndDate);
      const res = await fetch(`/api/reports/profitability?${params}`, { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch profitability data");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card data-testid="profit-stat-revenue">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Est. Revenue</p>
                <p className="text-3xl font-bold font-mono mt-2 text-green-600">{formatCurrency(profitability?.totals?.totalRevenue || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-green-500/10">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="profit-stat-commission-cost">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Commission Cost</p>
                <p className="text-3xl font-bold font-mono mt-2 text-red-600">{formatCurrency(profitability?.totals?.totalCommissionCost || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-red-500/10">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="profit-stat-margin">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Gross Margin</p>
                <p className="text-3xl font-bold font-mono mt-2">{formatCurrency(profitability?.totals?.totalMargin || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-primary/10">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="profit-stat-margin-pct">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Avg Margin %</p>
                <p className="text-3xl font-bold font-mono mt-2">{(profitability?.totals?.avgMarginPercent || 0).toFixed(1)}%</p>
              </div>
              <div className="p-2 rounded-md bg-blue-500/10">
                <BarChart3 className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Profitability Analysis</CardTitle>
            <CardDescription>Revenue and margin breakdown by {groupBy}</CardDescription>
          </div>
          <Select value={groupBy} onValueChange={(v: "provider" | "client") => setGroupBy(v)}>
            <SelectTrigger className="w-[140px]" data-testid="select-profitability-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="provider">By Provider</SelectItem>
              <SelectItem value="client">By Client</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {profitability?.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-2 font-medium">{groupBy === "provider" ? "Provider" : "Client"}</th>
                    <th className="text-right py-3 px-2 font-medium">Orders</th>
                    <th className="text-right py-3 px-2 font-medium">Revenue</th>
                    <th className="text-right py-3 px-2 font-medium">Commission Cost</th>
                    <th className="text-right py-3 px-2 font-medium">Override Cost</th>
                    <th className="text-right py-3 px-2 font-medium">Total Cost</th>
                    <th className="text-right py-3 px-2 font-medium">Margin</th>
                    <th className="text-right py-3 px-2 font-medium">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {profitability.data.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover-elevate">
                      <td className="py-3 px-2 font-medium">{row.name}</td>
                      <td className="text-right py-3 px-2">{row.orders}</td>
                      <td className="text-right py-3 px-2 font-mono text-green-600">{formatCurrency(row.revenue)}</td>
                      <td className="text-right py-3 px-2 font-mono text-red-600">{formatCurrency(row.commissionCost)}</td>
                      <td className="text-right py-3 px-2 font-mono text-purple-600">{formatCurrency(row.overrideCost)}</td>
                      <td className="text-right py-3 px-2 font-mono font-semibold text-red-600">{formatCurrency(row.commissionCost + row.overrideCost)}</td>
                      <td className="text-right py-3 px-2 font-mono font-semibold">{formatCurrency(row.margin)}</td>
                      <td className="text-right py-3 px-2">
                        <Badge variant={row.marginPercent >= 30 ? "default" : row.marginPercent >= 15 ? "secondary" : "destructive"}>
                          {row.marginPercent.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No profitability data found for this period
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProductMixTab({ period, customStartDate, customEndDate }: { period: string; customStartDate: string; customEndDate: string }) {
  const { data: productMix, isLoading } = useQuery<{
    data: Array<{
      id: string;
      name: string;
      provider: string;
      orders: number;
      baseCommission: number;
      incentiveCommission: number;
      overrideCommission: number;
      totalCommission: number;
      avgCommissionPerOrder: number;
      percentOfTotal: number;
    }>;
    providerBreakdown: Array<{
      id: string;
      name: string;
      orders: number;
      totalCommission: number;
      percentOfTotal: number;
    }>;
    totals: {
      totalOrders: number;
      totalBaseCommission: number;
      totalIncentiveCommission: number;
      totalOverrideCommission: number;
      grandTotalCommission: number;
    };
  }>({
    queryKey: ["/api/reports/product-mix", period, customStartDate, customEndDate],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (period === "custom" && customStartDate) params.set("startDate", customStartDate);
      if (period === "custom" && customEndDate) params.set("endDate", customEndDate);
      const res = await fetch(`/api/reports/product-mix?${params}`, { 
        headers: getAuthHeaders(),
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to fetch product mix data");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
        <Card data-testid="mix-stat-orders">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total Orders</p>
                <p className="text-3xl font-bold font-mono mt-2">{productMix?.totals?.totalOrders || 0}</p>
              </div>
              <div className="p-2 rounded-md bg-green-500/10">
                <BarChart3 className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="mix-stat-base">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Base Commission</p>
                <p className="text-3xl font-bold font-mono mt-2">{formatCurrency(productMix?.totals?.totalBaseCommission || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-blue-500/10">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="mix-stat-incentives">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Incentives</p>
                <p className="text-3xl font-bold font-mono mt-2 text-orange-600">{formatCurrency(productMix?.totals?.totalIncentiveCommission || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-orange-500/10">
                <TrendingUp className="h-5 w-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="mix-stat-overrides">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Overrides</p>
                <p className="text-3xl font-bold font-mono mt-2 text-purple-600">{formatCurrency(productMix?.totals?.totalOverrideCommission || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-purple-500/10">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="mix-stat-total">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Total Cost</p>
                <p className="text-3xl font-bold font-mono mt-2 text-red-600">{formatCurrency(productMix?.totals?.grandTotalCommission || 0)}</p>
              </div>
              <div className="p-2 rounded-md bg-red-500/10">
                <BarChart3 className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">By Service</CardTitle>
            <CardDescription>Commission costs breakdown by service</CardDescription>
          </CardHeader>
          <CardContent>
            {productMix?.data?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-2 font-medium">Service</th>
                      <th className="text-left py-3 px-2 font-medium">Provider</th>
                      <th className="text-right py-3 px-2 font-medium">Orders</th>
                      <th className="text-right py-3 px-2 font-medium">Base</th>
                      <th className="text-right py-3 px-2 font-medium">Incentives</th>
                      <th className="text-right py-3 px-2 font-medium">Overrides</th>
                      <th className="text-right py-3 px-2 font-medium">Total</th>
                      <th className="text-right py-3 px-2 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productMix.data.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover-elevate">
                        <td className="py-3 px-2 font-medium">{row.name}</td>
                        <td className="py-3 px-2 text-muted-foreground">{row.provider}</td>
                        <td className="text-right py-3 px-2">{row.orders}</td>
                        <td className="text-right py-3 px-2 font-mono">{formatCurrency(row.baseCommission)}</td>
                        <td className="text-right py-3 px-2 font-mono text-orange-600">{formatCurrency(row.incentiveCommission)}</td>
                        <td className="text-right py-3 px-2 font-mono text-purple-600">{formatCurrency(row.overrideCommission)}</td>
                        <td className="text-right py-3 px-2 font-mono font-semibold">{formatCurrency(row.totalCommission)}</td>
                        <td className="text-right py-3 px-2">
                          <Badge variant="outline">{row.percentOfTotal.toFixed(1)}%</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground">
                No service data found
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">By Provider</CardTitle>
            <CardDescription>Commission costs breakdown by provider</CardDescription>
          </CardHeader>
          <CardContent>
            {productMix?.providerBreakdown?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-2 font-medium">Provider</th>
                      <th className="text-right py-3 px-2 font-medium">Orders</th>
                      <th className="text-right py-3 px-2 font-medium">Total Commission</th>
                      <th className="text-right py-3 px-2 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productMix.providerBreakdown.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover-elevate">
                        <td className="py-3 px-2 font-medium">{row.name}</td>
                        <td className="text-right py-3 px-2">{row.orders}</td>
                        <td className="text-right py-3 px-2 font-mono font-semibold">{formatCurrency(row.totalCommission)}</td>
                        <td className="text-right py-3 px-2">
                          <Badge variant="outline">{row.percentOfTotal.toFixed(1)}%</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground">
                No provider data found
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
