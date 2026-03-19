import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { KpiCard } from "@/components/kpi-card";
import { TimeHorizonSelector, type TimeHorizon } from "@/components/time-horizon-selector";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

interface BucketData {
  totalOrders: number;
  totalInstalls: number;
  totalCommission: string;
  totalRackRate: string;
  totalProfit: string;
  uniqueReps: number;
}

interface ExecSummary {
  today: BucketData;
  payPeriod: BucketData;
  mtd: BucketData;
  allTime: BucketData;
  chargebackRate: string;
  pendingPayRuns: number;
}

const horizonMap: Record<TimeHorizon, keyof ExecSummary> = {
  today: "today",
  payPeriod: "payPeriod",
  mtd: "mtd",
};

export default function ExecutiveReportDashboard() {
  const [horizon, setHorizon] = useState<TimeHorizon>("payPeriod");

  const { data, isLoading } = useQuery<ExecSummary>({
    queryKey: ["/api/reports/executive/summary"],
    queryFn: async () => {
      const res = await fetch("/api/reports/executive/summary", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const bucket = data[horizonMap[horizon]] as BucketData;
  const installRate = bucket.totalOrders > 0
    ? Math.round((bucket.totalInstalls / bucket.totalOrders) * 100)
    : 0;

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="executive-report-dashboard">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold" data-testid="text-dashboard-title">Executive Summary</h1>
        <TimeHorizonSelector value={horizon} onChange={setHorizon} />
      </div>

      {data.pendingPayRuns > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800" data-testid="alert-pending-payruns">
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            {data.pendingPayRuns} pending pay run{data.pendingPayRuns > 1 ? "s" : ""} require attention
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard label="Total Orders" value={bucket.totalOrders} variant="default" />
        <KpiCard label="Total Installs" value={bucket.totalInstalls} variant="default" />
        <KpiCard label="Install Rate" value={`${installRate}%`} variant={installRate >= 70 ? "success" : installRate >= 50 ? "warning" : "danger"} />
        <KpiCard
          label="Total Commission"
          value={`$${parseFloat(bucket.totalCommission).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          variant="default"
        />
        <KpiCard
          label="Total Rack Rate"
          value={`$${parseFloat(bucket.totalRackRate).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          variant="default"
        />
        <KpiCard
          label="Total Profit"
          value={`$${parseFloat(bucket.totalProfit).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          variant="success"
        />
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Chargeback Rate:</span>
          <Badge variant={parseFloat(data.chargebackRate) > 5 ? "destructive" : "secondary"} data-testid="badge-chargeback-rate">
            {data.chargebackRate}%
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Active Reps:</span>
          <span className="text-sm font-medium" data-testid="text-unique-reps">{bucket.uniqueReps}</span>
        </div>
      </div>
    </div>
  );
}
