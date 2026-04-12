import i18n from "i18next";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

interface RepEarnings {
  id: string;
  name: string;
  repId: string;
  grossCommission: string;
  chargebacks: string;
  chargebackCount: number;
  deductions: string;
  carryForward: string;
  estimatedNet: string;
  priorPeriodGross: string;
  delta: string;
  chargebackRatio: string;
  risks: string[];
}

interface TeamEarningsData {
  reps: RepEarnings[];
  totals: {
    grossCommission: string;
    chargebacks: string;
    deductions: string;
    carryForward: string;
    estimatedNet: string;
  };
  period: { start: string; end: string };
  priorPeriod: { start: string; end: string };
}

function fmt(val: string): string {
  return "$" + parseFloat(val).toLocaleString(i18n.language === "es" ? "es-MX" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DeltaIndicator({ delta }: { delta: string }) {
  const v = parseFloat(delta);
  if (v > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400 text-xs" data-testid="indicator-trend-up">
        <TrendingUp className="w-3 h-3" />+{fmt(delta)}
      </span>
    );
  }
  if (v < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 text-xs" data-testid="indicator-trend-down">
        <TrendingDown className="w-3 h-3" />-{fmt(String(Math.abs(v)))}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground text-xs" data-testid="indicator-trend-flat">
      <Minus className="w-3 h-3" />$0.00
    </span>
  );
}

function RiskBadges({ risks }: { risks: string[] }) {
  if (risks.length === 0) return null;
  const labels: Record<string, { text: string; variant: "destructive" | "secondary" }> = {
    ZERO_PAY: { text: "$0 Pay", variant: "destructive" },
    CARRY_FORWARD: { text: "Carry-Fwd", variant: "secondary" },
    HIGH_CHARGEBACKS: { text: "High CB", variant: "destructive" },
  };
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {risks.map(r => {
        const cfg = labels[r];
        if (!cfg) return null;
        return (
          <Badge key={r} variant={cfg.variant} className="text-[10px] px-1.5 py-0" data-testid={`badge-risk-${r.toLowerCase()}`}>
            {cfg.text}
          </Badge>
        );
      })}
    </div>
  );
}

export default function TeamEarningsPreview() {
  const { data, isLoading } = useQuery<TeamEarningsData>({
    queryKey: ["/api/reports/manager/team-earnings"],
    queryFn: async () => {
      const res = await fetch("/api/reports/manager/team-earnings", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return <Skeleton className="h-64" data-testid="skeleton-team-earnings" />;
  }

  if (!data) return null;

  const riskCount = data.reps.filter(r => r.risks.length > 0).length;

  return (
    <Card data-testid="card-team-earnings">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Team Earnings Preview
          </CardTitle>
          {riskCount > 0 && (
            <Badge variant="destructive" className="text-xs flex items-center gap-1" data-testid="badge-risk-count">
              <AlertTriangle className="w-3 h-3" />
              {riskCount} {riskCount === 1 ? "rep" : "reps"} flagged
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1" data-testid="text-period-range">
          Period: {data.period?.start ?? "—"} to {data.period?.end ?? "—"}
        </p>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rep</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Chargebacks</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Carry-Fwd</TableHead>
              <TableHead className="text-right">Est. Net</TableHead>
              <TableHead className="text-center">vs Prior</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.reps.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No team members found
                </TableCell>
              </TableRow>
            )}
            {data.reps.map(rep => (
              <TableRow
                key={rep.id}
                className={rep.risks.includes("ZERO_PAY") ? "bg-red-50 dark:bg-red-950/20" : ""}
                data-testid={`row-earnings-${rep.repId}`}
              >
                <TableCell>
                  <div>
                    <span className="font-medium">{rep.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{rep.repId}</span>
                  </div>
                  <RiskBadges risks={rep.risks} />
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{fmt(rep.grossCommission)}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  <span className={parseFloat(rep.chargebacks) > 0 ? "text-red-600 dark:text-red-400" : ""}>
                    {parseFloat(rep.chargebacks) > 0 ? `-${fmt(rep.chargebacks)}` : "$0.00"}
                  </span>
                  {rep.chargebackCount > 0 && (
                    <span className="text-xs text-muted-foreground ml-1">({rep.chargebackCount})</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {parseFloat(rep.deductions) > 0 ? `-${fmt(rep.deductions)}` : "$0.00"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {parseFloat(rep.carryForward) > 0 ? `-${fmt(rep.carryForward)}` : "$0.00"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold">
                  {fmt(rep.estimatedNet)}
                </TableCell>
                <TableCell className="text-center">
                  <DeltaIndicator delta={rep.delta} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 font-semibold bg-muted/50" data-testid="row-earnings-totals">
              <TableCell>Team Totals</TableCell>
              <TableCell className="text-right font-mono text-sm">{fmt(data.totals.grossCommission)}</TableCell>
              <TableCell className="text-right font-mono text-sm text-red-600 dark:text-red-400">
                {parseFloat(data.totals.chargebacks) > 0 ? `-${fmt(data.totals.chargebacks)}` : "$0.00"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {parseFloat(data.totals.deductions) > 0 ? `-${fmt(data.totals.deductions)}` : "$0.00"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {parseFloat(data.totals.carryForward) > 0 ? `-${fmt(data.totals.carryForward)}` : "$0.00"}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{fmt(data.totals.estimatedNet)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}