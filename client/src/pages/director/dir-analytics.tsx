import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, BarChart3, PieChart, Calendar } from "lucide-react";

function rateColor(rate: number) {
  if (rate >= 75) return "#22c55e";
  if (rate >= 60) return "#eab308";
  return "#ef4444";
}

function SimpleLineChart({ data, height = 200 }: { data: { date: string; sales: number; connects: number }[]; height?: number }) {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No trend data available</p>;
  const maxVal = Math.max(...data.map(d => Math.max(d.sales, d.connects)), 1);
  const w = 100;
  const h = height;
  const stepX = w / Math.max(data.length - 1, 1);

  const salesPoints = data.map((d, i) => `${(i * stepX).toFixed(1)},${(h - (d.sales / maxVal) * (h - 20) - 10).toFixed(1)}`).join(" ");
  const connectPoints = data.map((d, i) => `${(i * stepX).toFixed(1)},${(h - (d.connects / maxVal) * (h - 20) - 10).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }}>
        <polyline points={salesPoints} fill="none" stroke="#3b82f6" strokeWidth="0.5" />
        <polyline points={connectPoints} fill="none" stroke="#22c55e" strokeWidth="0.5" />
      </svg>
      <div className="flex items-center gap-4 justify-center text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Sales</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Connects</span>
      </div>
    </div>
  );
}

function BarChartSimple({ data, height = 200 }: { data: { name: string; rate: number }[]; height?: number }) {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No data</p>;
  const max = Math.max(...data.map(d => d.rate), 1);
  const barW = Math.min(60, Math.floor(500 / data.length));

  return (
    <div className="flex items-end gap-2 justify-center" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <span className="text-xs font-medium">{d.rate}%</span>
          <div
            className="rounded-t"
            style={{
              width: barW,
              height: Math.max((d.rate / max) * (height - 40), 4),
              backgroundColor: rateColor(d.rate),
            }}
          />
          <span className="text-xs text-muted-foreground truncate max-w-[60px]">{d.name}</span>
        </div>
      ))}
      <div className="absolute left-0 right-0" style={{ bottom: 30 }}>
      </div>
    </div>
  );
}

function DonutChart({ data }: { data: { name: string; count: number; percent: number }[] }) {
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">No data</p>;
  const colors = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6", "#ec4899", "#f97316", "#06b6d4"];
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex items-center gap-6 justify-center">
      <svg width="160" height="160" viewBox="0 0 36 36">
        {data.reduce((acc: any[], d, i) => {
          const prevOffset = i === 0 ? 0 : acc[i - 1].offset + acc[i - 1].pct;
          const pct = total > 0 ? (d.count / total) * 100 : 0;
          acc.push({ ...d, pct, offset: prevOffset, color: colors[i % colors.length] });
          return acc;
        }, []).map((seg: any, i: number) => (
          <circle
            key={i}
            cx="18" cy="18" r="15.9155"
            fill="none"
            stroke={seg.color}
            strokeWidth="3"
            strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
            strokeDashoffset={`${-seg.offset}`}
            transform="rotate(-90 18 18)"
          />
        ))}
        <text x="18" y="19" textAnchor="middle" className="text-[4px] font-bold fill-foreground">{total}</text>
        <text x="18" y="22" textAnchor="middle" className="text-[2px] fill-muted-foreground">orders</text>
      </svg>
      <div className="space-y-1">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
            <span className="truncate max-w-[120px]">{d.name}</span>
            <span className="text-muted-foreground ml-auto">{d.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapRow({ data }: { data: { day: string; sales: number; connects: number }[] }) {
  const maxSales = Math.max(...data.map(d => d.sales), 1);
  const maxConnects = Math.max(...data.map(d => d.connects), 1);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Sales by Day</p>
        <div className="flex gap-2 justify-center">
          {data.map((d, i) => {
            const intensity = d.sales / maxSales;
            return (
              <div key={`s-${i}`} className="text-center">
                <div
                  className="w-12 h-12 rounded flex items-center justify-center text-xs font-medium"
                  style={{
                    backgroundColor: `rgba(59, 130, 246, ${Math.max(intensity * 0.8, 0.05)})`,
                    color: intensity > 0.5 ? "white" : "inherit",
                  }}
                >
                  {d.sales}
                </div>
                <span className="text-xs text-muted-foreground mt-1">{d.day}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Connects by Day</p>
        <div className="flex gap-2 justify-center">
          {data.map((d, i) => {
            const intensity = d.connects / maxConnects;
            return (
              <div key={`c-${i}`} className="text-center">
                <div
                  className="w-12 h-12 rounded flex items-center justify-center text-xs font-medium"
                  style={{
                    backgroundColor: `rgba(34, 197, 94, ${Math.max(intensity * 0.8, 0.05)})`,
                    color: intensity > 0.5 ? "white" : "inherit",
                  }}
                >
                  {d.connects}
                </div>
                <span className="text-xs text-muted-foreground mt-1">{d.day}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function DirAnalytics() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/director/analytics"] });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (!data) return <div className="p-6 text-center text-muted-foreground">No analytics data</div>;

  const { trendData, connectRateByManager, serviceMix, dayAnalysis } = data;

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="dir-analytics">
      <h1 className="text-xl font-semibold">Trends & Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Production Trend (90 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleLineChart data={trendData} height={220} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Connect Rate by Manager
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChartSimple data={connectRateByManager} height={220} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="h-4 w-4" /> Service Mix
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart data={serviceMix} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Day of Week Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HeatmapRow data={dayAnalysis} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
