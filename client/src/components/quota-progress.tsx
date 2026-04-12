import i18n from "i18next";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthHeaders } from "@/lib/auth";
import { Target, TrendingUp, Calendar, AlertCircle } from "lucide-react";

interface QuotaProgressData {
  period: string;
  periodStart: string;
  periodEnd: string;
  daysRemaining: number;
  expectedProgress: number;
  hasGoal: boolean;
  goals: {
    salesTarget: number;
    connectsTarget: number;
    revenueTarget: number;
  } | null;
  actual: {
    soldCount: number;
    connectsCount: number;
    earnedDollars: number;
  };
  progress: {
    sales: number | null;
    connects: number | null;
    revenue: number | null;
  };
}

function getProgressColor(progress: number, expected: number) {
  if (progress >= expected) return "text-green-500";
  if (progress >= expected * 0.8) return "text-yellow-500";
  return "text-red-500";
}

function ProgressBar({ 
  label, 
  current, 
  target, 
  progress, 
  expectedProgress 
}: { 
  label: string; 
  current: number; 
  target: number; 
  progress: number | null; 
  expectedProgress: number;
}) {
  if (progress === null) return null;
  
  const colorClass = getProgressColor(progress, expectedProgress);
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${colorClass}`}>
          {current} / {target} ({progress}%)
        </span>
      </div>
      <div className="relative">
        <Progress value={progress} className="h-2" />
        <div 
          className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/50"
          style={{ left: `${Math.min(expectedProgress, 100)}%` }}
          title={`Expected: ${expectedProgress}%`}
        />
      </div>
    </div>
  );
}

export function QuotaProgress() {
  const { data, isLoading, error } = useQuery<QuotaProgressData>({
    queryKey: ["/api/dashboard/quota-progress"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/quota-progress", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch quota progress");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Goal Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Unable to load goal progress</p>
        </CardContent>
      </Card>
    );
  }

  if (!data?.hasGoal) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Goal Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <Target className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-sm">No goals set for this period</p>
            <p className="text-xs text-muted-foreground mt-1">
              Contact your manager to set monthly targets
            </p>
          </div>
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-muted-foreground mb-2">Current Activity (MTD)</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="font-semibold">{data?.actual.soldCount || 0}</div>
                <div className="text-xs text-muted-foreground">Sales</div>
              </div>
              <div>
                <div className="font-semibold">{data?.actual.connectsCount || 0}</div>
                <div className="text-xs text-muted-foreground">Connected</div>
              </div>
              <div>
                <div className="font-semibold">${(data?.actual.earnedDollars || 0).toFixed(0)}</div>
                <div className="text-xs text-muted-foreground">Earned</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { goals, actual, progress, daysRemaining, expectedProgress, periodStart, periodEnd } = data;
  
  const formatDateRange = () => {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    return `${start.toLocaleDateString(i18n.language === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString(i18n.language === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric" })}`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Goal Progress
          </CardTitle>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{daysRemaining} days left</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{formatDateRange()}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {goals?.salesTarget && goals.salesTarget > 0 && (
          <ProgressBar
            label="Sales"
            current={actual.soldCount}
            target={goals.salesTarget}
            progress={progress.sales}
            expectedProgress={expectedProgress}
          />
        )}
        
        {goals?.connectsTarget && goals.connectsTarget > 0 && (
          <ProgressBar
            label="Connected"
            current={actual.connectsCount}
            target={goals.connectsTarget}
            progress={progress.connects}
            expectedProgress={expectedProgress}
          />
        )}
        
        {goals?.revenueTarget && goals.revenueTarget > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Revenue</span>
              <span className={`font-medium ${getProgressColor(progress.revenue || 0, expectedProgress)}`}>
                ${actual.earnedDollars.toFixed(0)} / ${goals.revenueTarget.toFixed(0)} ({progress.revenue}%)
              </span>
            </div>
            <div className="relative">
              <Progress value={progress.revenue || 0} className="h-2" />
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/50"
                style={{ left: `${Math.min(expectedProgress, 100)}%` }}
                title={`Expected: ${expectedProgress}%`}
              />
            </div>
          </div>
        )}
        
        <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t">
          <TrendingUp className="h-3 w-3" />
          <span>Expected progress: {expectedProgress}%</span>
        </div>
      </CardContent>
    </Card>
  );
}
