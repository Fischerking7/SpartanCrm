import { useState } from "react";
import i18n from "i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { BadgeAlert, RefreshCw, TrendingDown, TrendingUp, DollarSign, Bell } from "lucide-react";

interface Variance {
  id: string; clientName: string; customerName?: string; invoiceNumber?: string;
  repId?: string; repName?: string;
  expectedAmountCents: number; actualAmountCents: number; varianceAmountCents: number;
  variancePct: number; status: string; serviceType?: string; createdAt: string;
  isAlert: boolean; direction: "UNDERPAID" | "OVERPAID";
}

interface VarianceData {
  variances: Variance[];
  summary: {
    totalVariances: number; underpaid: number; overpaid: number;
    totalVarianceCents: number; avgVarianceCents: number;
  };
  thresholdPct: number;
  thresholdCents: number;
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString(i18n.language === "es" ? "es-MX" : "en-US", { style: "currency", currency: "USD" });

export default function PaymentVariances() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [thresholdPct, setThresholdPct] = useState(5);
  const [thresholdCents, setThresholdCents] = useState(1000);
  const [days, setDays] = useState("90");
  const [applied, setApplied] = useState({ thresholdPct: 5, thresholdCents: 1000, days: "90" });
  const [directionFilter, setDirectionFilter] = useState<"all" | "UNDERPAID" | "OVERPAID">("all");

  const canEmit = user && ["ACCOUNTING", "ADMIN", "OPERATIONS"].includes(user.role);

  const { data, isLoading, error, refetch } = useQuery<VarianceData>({
    queryKey: ["/api/accounting/payment-variances", applied],
    queryFn: async () => {
      const params = new URLSearchParams({
        thresholdPct: String(applied.thresholdPct),
        thresholdCents: String(applied.thresholdCents),
        days: applied.days,
      });
      const res = await fetch(`/api/accounting/payment-variances?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load payment variances");
      return res.json();
    },
  });

  const emitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/accounting/payment-variances/emit-exceptions", {
        thresholdPct: applied.thresholdPct,
        thresholdCents: applied.thresholdCents,
        days: 30,
      });
    },
    onSuccess: async (res: any) => {
      const result = await res.json();
      toast({
        title: "Exceptions emitted",
        description: `${result.emitted} new exception(s) created from ${result.scanned} records scanned.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/exceptions"] });
    },
    onError: () => {
      toast({ title: "Failed to emit exceptions", variant: "destructive" });
    },
  });

  const filtered = data?.variances.filter(v =>
    directionFilter === "all" || v.direction === directionFilter
  ) ?? [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BadgeAlert className="h-6 w-6 text-primary" />
            Payment Variance Alerts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Identify payments that differ significantly from expectations</p>
        </div>
        <div className="flex items-center gap-2">
          {canEmit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => emitMutation.mutate()}
              disabled={emitMutation.isPending}
              data-testid="button-emit-exceptions"
            >
              <Bell className="h-4 w-4 mr-2" />
              {emitMutation.isPending ? "Scanning..." : "Emit Exceptions"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-variances">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {canEmit && (
        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-900/10">
          <Bell className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800 dark:text-blue-300 text-sm">
            Use <strong>Emit Exceptions</strong> to push flagged variances into the exception queue for team review and resolution.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Alert Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">Min % Variance</Label>
              <Input
                type="number"
                className="w-24 mt-1"
                value={thresholdPct}
                min={0}
                step={0.5}
                onChange={e => setThresholdPct(parseFloat(e.target.value) || 5)}
                data-testid="input-threshold-pct"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Min $ Variance</Label>
              <Input
                type="number"
                className="w-28 mt-1"
                value={thresholdCents / 100}
                min={0}
                step={1}
                onChange={e => setThresholdCents(Math.round((parseFloat(e.target.value) || 10) * 100))}
                data-testid="input-threshold-dollars"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Lookback (days)</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-28 mt-1" data-testid="select-lookback-days">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="180">180 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setApplied({ thresholdPct, thresholdCents, days })} data-testid="button-apply-filters">
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load payment variances.</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card data-testid="card-total-variances">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{data.summary.totalVariances}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Alerts</div>
              </CardContent>
            </Card>
            <Card data-testid="card-underpaid">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  <div className="text-2xl font-bold text-destructive">{data.summary.underpaid}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Underpaid</div>
              </CardContent>
            </Card>
            <Card data-testid="card-overpaid">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-amber-500" />
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{data.summary.overpaid}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Overpaid</div>
              </CardContent>
            </Card>
            <Card data-testid="card-total-variance-amount">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <div className={`text-xl font-bold ${data.summary.totalVarianceCents < 0 ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                    {fmt(data.summary.totalVarianceCents)}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Net Variance</div>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-3">
            <Label className="text-sm">Filter:</Label>
            <Select value={directionFilter} onValueChange={v => setDirectionFilter(v as "all" | "UNDERPAID" | "OVERPAID")}>
              <SelectTrigger className="w-36" data-testid="select-direction-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ({data.summary.totalVariances})</SelectItem>
                <SelectItem value="UNDERPAID">Underpaid ({data.summary.underpaid})</SelectItem>
                <SelectItem value="OVERPAID">Overpaid ({data.summary.overpaid})</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Rep</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">% Diff</TableHead>
                      <TableHead>Direction</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          No payment variances found with current filters
                        </TableCell>
                      </TableRow>
                    )}
                    {filtered.map((v) => (
                      <TableRow key={v.id} data-testid={`row-variance-${v.id}`}>
                        <TableCell className="font-mono text-sm">{v.invoiceNumber || "—"}</TableCell>
                        <TableCell>{v.clientName}</TableCell>
                        <TableCell>
                          <div>{v.repName || v.repId || "—"}</div>
                          {v.customerName && <div className="text-xs text-muted-foreground">{v.customerName}</div>}
                        </TableCell>
                        <TableCell>{v.serviceType || "—"}</TableCell>
                        <TableCell className="text-right">{fmt(v.expectedAmountCents)}</TableCell>
                        <TableCell className="text-right">{fmt(v.actualAmountCents)}</TableCell>
                        <TableCell className="text-right">
                          <span className={v.varianceAmountCents < 0 ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
                            {fmt(v.varianceAmountCents)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={v.variancePct > 20 ? "destructive" : "secondary"} className="text-xs">
                            {v.variancePct}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={v.direction === "UNDERPAID" ? "destructive" : "outline"} className="text-xs">
                            {v.direction === "UNDERPAID" ? "Under" : "Over"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
