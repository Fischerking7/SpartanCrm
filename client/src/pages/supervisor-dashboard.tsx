import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Target, CheckCircle, TrendingUp } from "lucide-react";

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

export default function SupervisorDashboard() {
  const [cadence, setCadence] = useState<Cadence>("WEEK");

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

  const cadenceLabels: Record<Cadence, string> = {
    DAY: "Today",
    WEEK: "This Week",
    MONTH: "This Month",
  };

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
          <CardTitle>Rep Production</CardTitle>
          <CardDescription>Production by team member for {cadenceLabels[cadence].toLowerCase()}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data?.breakdown || []}
            isLoading={isLoading}
            emptyMessage="No production data available"
            testId="table-rep-production"
          />
        </CardContent>
      </Card>
    </div>
  );
}
