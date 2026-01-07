import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: LucideIcon;
  testId?: string;
  isCurrency?: boolean;
}

export function StatsCard({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  icon: Icon,
  testId,
  isCurrency = true,
}: StatsCardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground";

  const formatValue = (val: string | number) => {
    if (typeof val === "string") return val;
    if (isCurrency) {
      return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    }
    return val.toLocaleString("en-US");
  };

  return (
    <Card data-testid={testId}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <p className="text-3xl font-bold font-mono mt-2" data-testid={`${testId}-value`}>
              {formatValue(value)}
            </p>
            {(subtitle || trendValue) && (
              <div className="flex items-center gap-2 mt-1">
                {trendValue && (
                  <span className={`flex items-center gap-1 text-xs ${trendColor}`}>
                    <TrendIcon className="h-3 w-3" />
                    {trendValue}
                  </span>
                )}
                {subtitle && (
                  <span className="text-xs text-muted-foreground">{subtitle}</span>
                )}
              </div>
            )}
          </div>
          {Icon && (
            <div className="p-2 rounded-md bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
