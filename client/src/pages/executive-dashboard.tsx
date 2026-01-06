import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Target, CheckCircle, TrendingUp, ChevronRight } from "lucide-react";

type Cadence = "WEEK" | "MONTH";

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

export default function ExecutiveDashboard() {
  const [cadence, setCadence] = useState<Cadence>("WEEK");
  const [drillDownManager, setDrillDownManager] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery<ProductionData>({
    queryKey: ["/api/dashboard/production", cadence],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/production?cadence=${cadence}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch production data");
      return res.json();
    },
  });

  const { data: managerData, isLoading: managerLoading } = useQuery<ProductionData>({
    queryKey: ["/api/dashboard/production/manager", drillDownManager?.id, cadence],
    queryFn: async () => {
      if (!drillDownManager) return null;
      const res = await fetch(`/api/dashboard/production/manager/${drillDownManager.id}?cadence=${cadence}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch manager data");
      return res.json();
    },
    enabled: !!drillDownManager,
  });

  const cadenceLabels: Record<Cadence, string> = {
    WEEK: "This Week",
    MONTH: "This Month",
  };

  const columns = [
    {
      key: "name",
      header: "Manager",
      cell: (row: ProductionData["breakdown"][0]) => (
        <Button
          variant="ghost"
          className="p-0 h-auto font-medium hover:underline"
          onClick={() => setDrillDownManager({ id: row.id, name: row.name })}
          data-testid={`button-drill-down-${row.id}`}
        >
          {row.name}
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
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

  const repColumns = [
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
          <h1 className="text-2xl font-semibold">Organization Production</h1>
          <p className="text-muted-foreground">Monitor performance across your organization</p>
        </div>
        <div className="flex gap-1 bg-muted p-1 rounded-md">
          {(["WEEK", "MONTH"] as Cadence[]).map((c) => (
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
          <CardTitle>Manager Production</CardTitle>
          <CardDescription>Production by manager for {cadenceLabels[cadence].toLowerCase()}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data?.breakdown || []}
            isLoading={isLoading}
            emptyMessage="No production data available"
            testId="table-manager-production"
          />
        </CardContent>
      </Card>

      <Dialog open={!!drillDownManager} onOpenChange={() => setDrillDownManager(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{drillDownManager?.name}'s Team</DialogTitle>
            <DialogDescription>
              Rep-level production for {cadenceLabels[cadence].toLowerCase()}
            </DialogDescription>
          </DialogHeader>
          
          {managerLoading ? (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
              <Skeleton className="h-48" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 grid-cols-4">
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">Sold</div>
                  <div className="text-xl font-bold">{managerData?.summary.sold || 0}</div>
                </div>
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">Connected</div>
                  <div className="text-xl font-bold">{managerData?.summary.connected || 0}</div>
                </div>
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">Approved</div>
                  <div className="text-xl font-bold text-green-600">{managerData?.summary.approved || 0}</div>
                </div>
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">Conversion</div>
                  <div className="text-xl font-bold">{managerData?.summary.conversionPercent || 0}%</div>
                </div>
              </div>
              <DataTable
                columns={repColumns}
                data={managerData?.breakdown || []}
                isLoading={managerLoading}
                emptyMessage="No rep data available"
                testId="table-drill-down-reps"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
