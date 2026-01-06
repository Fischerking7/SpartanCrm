import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, ShoppingCart, CheckCircle, DollarSign } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

interface MetricDelta {
  value: number;
  percent: number | null;
}

interface Metrics {
  soldCount: number;
  connectedCount: number;
  earnedDollars: number;
  deltas: {
    soldCount: MetricDelta;
    connectedCount: MetricDelta;
    earnedDollars: MetricDelta;
  };
  sparklineSeries: Array<{ date: string; soldCount: number; connectedCount: number; earnedDollars: number }>;
}

interface ProductionMetricsCardProps {
  title: string;
  metrics: Metrics;
  period: "Weekly" | "MTD";
}

function DeltaBadge({ delta }: { delta: MetricDelta }) {
  if (delta.value === 0) {
    return (
      <Badge variant="secondary" className="text-xs">
        <Minus className="w-3 h-3 mr-1" />
        0
      </Badge>
    );
  }
  
  const isPositive = delta.value > 0;
  const percentText = delta.percent !== null ? `${delta.percent}%` : "";
  
  return (
    <Badge variant={isPositive ? "default" : "destructive"} className="text-xs">
      {isPositive ? (
        <TrendingUp className="w-3 h-3 mr-1" />
      ) : (
        <TrendingDown className="w-3 h-3 mr-1" />
      )}
      {isPositive ? "+" : ""}{delta.value}
      {percentText && ` (${isPositive ? "+" : ""}${percentText})`}
    </Badge>
  );
}

function MiniSparkline({ data, dataKey, color }: { data: any[]; dataKey: string; color: string }) {
  if (!data || data.length === 0) return null;
  
  return (
    <div className="h-8 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Tooltip
            contentStyle={{ fontSize: "10px", padding: "4px 8px" }}
            formatter={(value: number) => [value, dataKey]}
            labelFormatter={(label: string) => label}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricRow({
  label,
  value,
  delta,
  sparklineData,
  sparklineKey,
  sparklineColor,
  icon: Icon,
  format = "number",
}: {
  label: string;
  value: number;
  delta: MetricDelta;
  sparklineData: any[];
  sparklineKey: string;
  sparklineColor: string;
  icon: typeof ShoppingCart;
  format?: "number" | "currency";
}) {
  const displayValue = format === "currency" 
    ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value.toLocaleString();

  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm text-muted-foreground truncate">{label}</span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <MiniSparkline data={sparklineData} dataKey={sparklineKey} color={sparklineColor} />
        <span className="text-lg font-semibold min-w-16 text-right" data-testid={`text-metric-${label.toLowerCase().replace(/\s+/g, '-')}`}>
          {displayValue}
        </span>
        <DeltaBadge delta={delta} />
      </div>
    </div>
  );
}

export function ProductionMetricsCard({ title, metrics, period }: ProductionMetricsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <Badge variant="outline" className="text-xs">{period}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <MetricRow
          label="Sales"
          value={metrics.soldCount}
          delta={metrics.deltas.soldCount}
          sparklineData={metrics.sparklineSeries}
          sparklineKey="soldCount"
          sparklineColor="hsl(var(--primary))"
          icon={ShoppingCart}
        />
        <MetricRow
          label="Connects"
          value={metrics.connectedCount}
          delta={metrics.deltas.connectedCount}
          sparklineData={metrics.sparklineSeries}
          sparklineKey="connectedCount"
          sparklineColor="hsl(var(--chart-2))"
          icon={CheckCircle}
        />
        <MetricRow
          label="Earned"
          value={metrics.earnedDollars}
          delta={metrics.deltas.earnedDollars}
          sparklineData={metrics.sparklineSeries}
          sparklineKey="earnedDollars"
          sparklineColor="hsl(var(--chart-1))"
          icon={DollarSign}
          format="currency"
        />
      </CardContent>
    </Card>
  );
}

export function ProductionMetricsModule({ 
  personalWeekly, 
  personalMtd, 
  teamWeekly, 
  teamMtd 
}: { 
  personalWeekly: Metrics; 
  personalMtd: Metrics; 
  teamWeekly: Metrics | null; 
  teamMtd: Metrics | null;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">My Production</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <ProductionMetricsCard title="My Production" metrics={personalWeekly} period="Weekly" />
          <ProductionMetricsCard title="My Production" metrics={personalMtd} period="MTD" />
        </div>
      </div>
      
      {(teamWeekly || teamMtd) && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Team Production</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {teamWeekly && <ProductionMetricsCard title="Team Production" metrics={teamWeekly} period="Weekly" />}
            {teamMtd && <ProductionMetricsCard title="Team Production" metrics={teamMtd} period="MTD" />}
          </div>
        </div>
      )}
    </div>
  );
}
