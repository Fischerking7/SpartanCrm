import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { ProductionMetricsModule } from "@/components/production-metrics-card";
import { DashboardChartsModule } from "@/components/dashboard-charts";
import { NextDayInstallsCard } from "@/components/next-day-installs";
import { DataTable } from "@/components/data-table";
import { SimplifiedStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Download, Upload, TrendingUp, Wallet, ArrowDownCircle, AlertTriangle, Calendar, CheckCircle2, Clock, DollarSign, BarChart2, Phone, PhoneCall, User } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { SimplifiedOrderStatus } from "@shared/order-status";

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
    team: null;
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
    team: null;
  };
  breakdowns: {
    teamByRep: null;
    teamByManager: null;
  };
}

interface MySummary {
  greeting: string;
  userName: string;
  period: {
    label: string;
    startDate: string;
    endDate: string;
    soldCount: number;
    connectedCount: number;
    connectRate: number;
    earnedDollars: number;
    payrollReadyAmount: number;
  };
  currentPeriod: {
    soldCount: number;
    connectedCount: number;
    pendingCount: number;
    earnedAmount: number;
    pendingAmount: number;
    projectedAmount: number;
  };
  nextPayment: {
    estimatedDate: string;
    estimatedAmount: number;
    payRunName: string;
    ordersIncluded: number;
  } | null;
  lastPayment: {
    date: string;
    amount: number;
    stubId: string;
    stubNumber: string | null;
    ordersIncluded: number;
  } | null;
  alerts: Array<{ type: string; severity: string; message: string; link?: string }>;
  recentOrders: Array<{
    id: string;
    invoiceNumber: string | null;
    customerName: string;
    dateSold: string;
    approvalStatus: string;
    jobStatus: string;
    paymentStatus: string;
    commissionAmount: string;
    simplifiedStatus: SimplifiedOrderStatus;
  }>;
  ytd: {
    totalEarned: number;
    totalPaid: number;
    totalOrders: number;
    totalConnects: number;
  };
  reserve: {
    currentBalance: number;
    cap: number;
    status: string;
    percentFull: number;
  } | null;
}

interface EarningsTimeline {
  timeline: Array<{
    month: string;
    monthKey: string;
    ordersCount: number;
    connectsCount: number;
    grossEarned: number;
    overrideEarned: number;
    deductions: number;
    netPaid: number;
    payStubIds: string[];
  }>;
  months: number;
}

interface FollowUpLead {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  disposition: string;
  followUpNotes: string | null;
  scheduledFollowUp: string;
  contactAttempts: number;
  lastContactedAt: string | null;
}

interface FollowUpsData {
  overdue: FollowUpLead[];
  today: FollowUpLead[];
  upcoming: FollowUpLead[];
  total: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

const alertSeverityConfig: Record<string, { colorClass: string; icon: typeof AlertTriangle }> = {
  red: { colorClass: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-300", icon: AlertTriangle },
  orange: { colorClass: "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950 dark:border-orange-800 dark:text-orange-300", icon: AlertTriangle },
  yellow: { colorClass: "bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-300", icon: AlertTriangle },
  blue: { colorClass: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300", icon: CheckCircle2 },
};

export default function RepDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [timelineMonths, setTimelineMonths] = useState(6);

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
  });

  const { data: mySummary, isLoading: mySummaryLoading } = useQuery<MySummary>({
    queryKey: ["/api/my/summary"],
    queryFn: async () => {
      const res = await fetch("/api/my/summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch my summary");
      return res.json();
    },
  });

  const { data: earningsTimeline, isLoading: timelineLoading } = useQuery<EarningsTimeline>({
    queryKey: ["/api/my/earnings-timeline", timelineMonths],
    queryFn: async () => {
      const res = await fetch(`/api/my/earnings-timeline?months=${timelineMonths}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch earnings timeline");
      return res.json();
    },
  });

  const { data: followUps, isLoading: followUpsLoading } = useQuery<FollowUpsData>({
    queryKey: ["/api/leads/follow-ups"],
    queryFn: async () => {
      const res = await fetch("/api/leads/follow-ups", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch follow-ups");
      return res.json();
    },
  });

  const markContactedMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await fetch(`/api/leads/${leadId}/contact`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to mark contacted");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads/follow-ups"] });
      toast({ title: "Marked as contacted" });
    },
    onError: () => {
      toast({ title: "Failed to mark contacted", variant: "destructive" });
    },
  });

  const orderColumns = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (row: MySummary["recentOrders"][0]) => (
        <span className="font-mono text-sm">{row.invoiceNumber || "-"}</span>
      ),
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row: MySummary["recentOrders"][0]) => <span className="font-medium">{row.customerName}</span>,
    },
    {
      key: "dateSold",
      header: "Date Sold",
      cell: (row: MySummary["recentOrders"][0]) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "simplifiedStatus",
      header: "Status",
      cell: (row: MySummary["recentOrders"][0]) => <SimplifiedStatusBadge status={row.simplifiedStatus} />,
    },
    {
      key: "commissionAmount",
      header: "Commission",
      cell: (row: MySummary["recentOrders"][0]) => (
        <span className="font-mono text-right block">
          {formatCurrency(parseFloat(row.commissionAmount))}
        </span>
      ),
      className: "text-right",
    },
  ];

  const ytd = mySummary?.ytd;
  const currentPeriod = mySummary?.currentPeriod;
  const nextPayment = mySummary?.nextPayment;
  const lastPayment = mySummary?.lastPayment;
  const alerts = mySummary?.alerts || [];

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            {mySummary?.greeting ? `${mySummary.greeting}, ${user?.name}` : `Welcome back, ${user?.name}`}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 flex-wrap">
          <Button variant="outline" data-testid="button-export-orders">
            <Download className="h-4 w-4 mr-2" />
            Export Orders
          </Button>
          <Button variant="outline" data-testid="button-import-leads">
            <Upload className="h-4 w-4 mr-2" />
            Import Leads
          </Button>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, idx) => {
            const config = alertSeverityConfig[alert.severity] || alertSeverityConfig.yellow;
            const Icon = config.icon;
            return (
              <div
                key={idx}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${config.colorClass}`}
                data-testid={`alert-${alert.type}-${idx}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{alert.message}</span>
                {alert.link && (
                  <a href={alert.link} className="ml-auto underline text-xs opacity-75 shrink-0">
                    View
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {mySummaryLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-4" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">MTD Earned</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500 shrink-0" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <p className="text-lg md:text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-dashboard-mtd-earned">
                {formatCurrency(currentPeriod?.earnedAmount || 0)}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1">
                {currentPeriod?.soldCount ?? 0} sold · {currentPeriod?.connectedCount ?? 0} connected
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">Pending</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <p className="text-lg md:text-2xl font-bold text-yellow-600 dark:text-yellow-400" data-testid="text-dashboard-pending-amount">
                {formatCurrency(currentPeriod?.pendingAmount || 0)}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1">
                {currentPeriod?.pendingCount ?? 0} orders pending
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">Next Payment</CardTitle>
              <Calendar className="h-4 w-4 text-primary shrink-0" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              {nextPayment ? (
                <>
                  <p className="text-lg md:text-2xl font-bold" data-testid="text-dashboard-next-payment-amount">
                    {formatCurrency(nextPayment.estimatedAmount)}
                  </p>
                  <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1">
                    Est. {new Date(nextPayment.estimatedDate).toLocaleDateString()} · {nextPayment.ordersIncluded} orders
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg md:text-2xl font-bold text-muted-foreground" data-testid="text-dashboard-next-payment-amount">—</p>
                  <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1">No upcoming pay run</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">Last Payment</CardTitle>
              <DollarSign className="h-4 w-4 text-blue-500 shrink-0" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              {lastPayment ? (
                <>
                  <p className="text-lg md:text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-dashboard-last-payment-amount">
                    {formatCurrency(lastPayment.amount)}
                  </p>
                  <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1">
                    {new Date(lastPayment.date).toLocaleDateString()}
                    {lastPayment.stubNumber ? ` · ${lastPayment.stubNumber}` : ""}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg md:text-2xl font-bold text-muted-foreground" data-testid="text-dashboard-last-payment-amount">—</p>
                  <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 md:mt-1">No payments yet</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {ytd && (
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">YTD Earned</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500 shrink-0 hidden md:block" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <p className="text-base md:text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-dashboard-ytd-gross">
                {formatCurrency(ytd.totalEarned || 0)}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">{ytd.totalOrders} orders</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">YTD Paid</CardTitle>
              <Wallet className="h-4 w-4 text-primary shrink-0 hidden md:block" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <p className="text-base md:text-2xl font-bold" data-testid="text-dashboard-ytd-net">
                {formatCurrency(ytd.totalPaid || 0)}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">Net paid</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1 md:pb-2 px-3 pt-3 md:px-6 md:pt-6">
              <CardTitle className="text-xs md:text-sm font-medium">Deductions</CardTitle>
              <ArrowDownCircle className="h-4 w-4 text-red-500 shrink-0 hidden md:block" />
            </CardHeader>
            <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
              <p className="text-base md:text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-dashboard-ytd-deductions">
                {formatCurrency(Math.max(0, (ytd.totalEarned || 0) - (ytd.totalPaid || 0)))}
              </p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">Chargebacks</p>
            </CardContent>
          </Card>
        </div>
      )}

      {followUpsLoading ? (
        <Card>
          <CardContent className="p-4 md:p-6">
            <Skeleton className="h-6 w-48 mb-3" />
            <Skeleton className="h-16 w-full mb-2" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      ) : (followUps && (followUps.overdue.length > 0 || followUps.today.length > 0)) ? (
        <Card data-testid="card-follow-up-reminders">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <div>
              <CardTitle className="text-base md:text-lg font-medium flex items-center gap-2">
                <PhoneCall className="h-4 w-4 md:h-5 md:w-5 text-primary" />
                Today's Follow-Ups
              </CardTitle>
              <CardDescription className="text-xs md:text-sm">
                {followUps.overdue.length + followUps.today.length} lead{followUps.overdue.length + followUps.today.length !== 1 ? "s" : ""} need attention
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/leads" data-testid="link-view-all-leads">View Leads</a>
            </Button>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            <div className="space-y-2">
              {followUps.overdue.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-3 p-2.5 md:p-3 rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30"
                  data-testid={`follow-up-item-${lead.id}`}
                >
                  <div className="shrink-0">
                    <div className="h-8 w-8 md:h-9 md:w-9 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                      <User className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{lead.customerName || "Unknown"}</span>
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4" data-testid={`badge-overdue-${lead.id}`}>Overdue</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {lead.followUpNotes || `Disposition: ${lead.disposition}`}
                    </p>
                    {lead.customerPhone && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Phone className="h-3 w-3" />{lead.customerPhone}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-8 text-xs"
                    onClick={() => markContactedMutation.mutate(lead.id)}
                    disabled={markContactedMutation.isPending}
                    data-testid={`button-mark-contacted-${lead.id}`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    <span className="hidden sm:inline">Contacted</span>
                  </Button>
                </div>
              ))}
              {followUps.today.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-3 p-2.5 md:p-3 rounded-lg border"
                  data-testid={`follow-up-item-${lead.id}`}
                >
                  <div className="shrink-0">
                    <div className="h-8 w-8 md:h-9 md:w-9 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                      <User className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{lead.customerName || "Unknown"}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" data-testid={`badge-today-${lead.id}`}>Today</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {lead.followUpNotes || `Disposition: ${lead.disposition}`}
                    </p>
                    {lead.customerPhone && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Phone className="h-3 w-3" />{lead.customerPhone}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-8 text-xs"
                    onClick={() => markContactedMutation.mutate(lead.id)}
                    disabled={markContactedMutation.isPending}
                    data-testid={`button-mark-contacted-${lead.id}`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    <span className="hidden sm:inline">Contacted</span>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2 flex-wrap px-3 pt-3 md:px-6 md:pt-6">
          <div>
            <CardTitle className="text-base md:text-lg font-medium flex items-center gap-2">
              <BarChart2 className="h-4 w-4 md:h-5 md:w-5 text-primary" />
              Earnings Timeline
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">Month-by-month breakdown</CardDescription>
          </div>
          <div className="flex gap-1.5 md:gap-2">
            {[3, 6, 12, 24].map((m) => (
              <Button
                key={m}
                variant={timelineMonths === m ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs md:h-9 md:px-3 md:text-sm"
                onClick={() => setTimelineMonths(m)}
                data-testid={`button-timeline-${m}m`}
              >
                {m}M
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {timelineLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : earningsTimeline && earningsTimeline.timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={earningsTimeline.timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorGross" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} className="text-muted-foreground" />
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="grossEarned"
                  name="Gross Earned"
                  stroke="hsl(var(--primary))"
                  fill="url(#colorGross)"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="netPaid"
                  name="Net Paid"
                  stroke="#22c55e"
                  fill="url(#colorNet)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              No earnings data available yet
            </div>
          )}
        </CardContent>
      </Card>

      <NextDayInstallsCard />

      {summaryLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-4" />
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        <>
          <ProductionMetricsModule
            personalWeekly={summary.weekly.personal}
            personalMtd={summary.mtd.personal}
            teamWeekly={null}
            teamMtd={null}
          />
          <DashboardChartsModule
            personalWeekly={summary.weekly.personal.sparklineSeries}
            personalMtd={summary.mtd.personal.sparklineSeries}
            teamWeekly={null}
            teamMtd={null}
          />
        </>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
          <div>
            <CardTitle className="text-lg font-medium">Recent Orders</CardTitle>
            <CardDescription>Your last 10 orders</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/orders" data-testid="link-view-all-orders">View All</a>
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={orderColumns}
            data={mySummary?.recentOrders || []}
            isLoading={mySummaryLoading}
            emptyMessage="No orders yet"
            testId="table-recent-orders"
          />
        </CardContent>
      </Card>
    </div>
  );
}
