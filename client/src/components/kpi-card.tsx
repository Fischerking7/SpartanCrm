import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  variant?: "default" | "success" | "warning" | "danger";
}

const variantColors = {
  default: "border-l-blue-500",
  success: "border-l-green-500",
  warning: "border-l-yellow-500",
  danger: "border-l-red-500",
};

export function KpiCard({ label, value, subValue, trend, trendLabel, variant = "default" }: KpiCardProps) {
  return (
    <Card className={`border-l-4 ${variantColors[variant]}`} data-testid={`kpi-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide" data-testid={`kpi-label-${label.toLowerCase().replace(/\s+/g, "-")}`}>{label}</p>
        <div className="flex items-end gap-2 mt-1">
          <span className="text-2xl font-bold" data-testid={`kpi-value-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</span>
          {trend && (
            <span className={`flex items-center text-xs font-medium ${trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"}`}>
              {trend === "up" && <TrendingUp className="w-3 h-3 mr-0.5" />}
              {trend === "down" && <TrendingDown className="w-3 h-3 mr-0.5" />}
              {trend === "flat" && <Minus className="w-3 h-3 mr-0.5" />}
              {trendLabel}
            </span>
          )}
        </div>
        {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
      </CardContent>
    </Card>
  );
}
