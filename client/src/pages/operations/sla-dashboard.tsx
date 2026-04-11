import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Timer, AlertTriangle, TrendingUp, Users, Building2, RefreshCw, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SlaData {
  totalOrders: number;
  totalViolations: number;
  slaThresholds: { saleToInstall: number; installToApproval: number; approvalToPayment: number };
  cycleTimeByStage: {
    saleToInstall: { avg: number; threshold: number; count: number };
    installToApproval: { avg: number; threshold: number; count: number };
    approvalToPayment: { avg: number; threshold: number; count: number };
  };
  bottleneck: { stage: string; avg: number; threshold: number };
  slaViolations: Array<{
    orderId: string; invoiceNumber: string; customerName: string;
    repId: string; repName: string; stage: string;
    daysInStage: number; threshold: number; excess: number;
  }>;
  repLeaderboard: Array<{
    repId: string; repName: string; totalOrders: number; violations: number; violationRate: number;
    avgSaleToInstall: number; avgInstallToApproval: number; avgApprovalToPayment: number;
  }>;
  providerLeaderboard: Array<{
    providerId: string; providerName: string; totalOrders: number; violations: number; violationRate: number;
    avgSaleToInstall: number;
  }>;
}

export default function SlaDashboard() {
  const { toast } = useToast();
  const [thresholds, setThresholds] = useState({ saleToInstall: 14, installToApproval: 7, approvalToPayment: 14 });
  const [applied, setApplied] = useState(thresholds);

  const emitMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/operations/sla-dashboard/emit-exceptions", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "SLA Exceptions Emitted", description: `${data.emitted} exception(s) created from ${data.scanned} orders scanned.` });
    },
    onError: () => toast({ title: "Error", description: "Failed to emit SLA exceptions.", variant: "destructive" }),
  });

  const { data, isLoading, error, refetch } = useQuery<SlaData>({
    queryKey: ["/api/operations/sla-dashboard", applied],
    queryFn: async () => {
      const params = new URLSearchParams({
        saleToInstallDays: String(applied.saleToInstall),
        installToApprovalDays: String(applied.installToApproval),
        approvalToPaymentDays: String(applied.approvalToPayment),
      });
      const res = await fetch(`/api/operations/sla-dashboard?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load SLA data");
      return res.json();
    },
  });

  const stageLabel = (key: string) => {
    if (key === "saleToInstall") return "Sale → Install";
    if (key === "installToApproval") return "Install → Approval";
    if (key === "approvalToPayment") return "Approval → Payment";
    return key;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Timer className="h-6 w-6 text-primary" />
            SLA &amp; Bottleneck Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Order cycle times and SLA violations over the past 90 days</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => emitMutation.mutate()}
            disabled={emitMutation.isPending}
            data-testid="button-emit-sla-exceptions"
          >
            <Bell className="h-4 w-4 mr-2" />
            {emitMutation.isPending ? "Emitting..." : "Emit Exceptions"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-sla">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">SLA Thresholds (days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">Sale → Install</Label>
              <Input
                type="number"
                className="w-24 mt-1"
                value={thresholds.saleToInstall}
                min={1}
                onChange={e => setThresholds(t => ({ ...t, saleToInstall: parseInt(e.target.value) || 14 }))}
                data-testid="input-sla-sale-install"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Install → Approval</Label>
              <Input
                type="number"
                className="w-24 mt-1"
                value={thresholds.installToApproval}
                min={1}
                onChange={e => setThresholds(t => ({ ...t, installToApproval: parseInt(e.target.value) || 7 }))}
                data-testid="input-sla-install-approval"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Approval → Payment</Label>
              <Input
                type="number"
                className="w-24 mt-1"
                value={thresholds.approvalToPayment}
                min={1}
                onChange={e => setThresholds(t => ({ ...t, approvalToPayment: parseInt(e.target.value) || 14 }))}
                data-testid="input-sla-approval-payment"
              />
            </div>
            <Button onClick={() => setApplied(thresholds)} data-testid="button-apply-thresholds">
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
          <AlertDescription>Failed to load SLA data. Please try again.</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card data-testid="card-total-orders">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{data.totalOrders.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">Orders Analyzed (90d)</div>
              </CardContent>
            </Card>
            <Card data-testid="card-total-violations">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-destructive">{data.totalViolations.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">SLA Violations</div>
              </CardContent>
            </Card>
            <Card data-testid="card-violation-rate">
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">
                  {data.totalOrders > 0 ? Math.round((data.totalViolations / data.totalOrders) * 100) : 0}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">Violation Rate</div>
              </CardContent>
            </Card>
            <Card data-testid="card-bottleneck">
              <CardContent className="pt-4">
                <div className="text-base font-bold text-amber-600 dark:text-amber-400 leading-tight">
                  {data.bottleneck.stage ? stageLabel(data.bottleneck.stage) : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Top Bottleneck {data.bottleneck.avg > 0 ? `(avg ${data.bottleneck.avg}d)` : ""}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(data.cycleTimeByStage).map(([key, stage]) => {
              const overThreshold = stage.avg > stage.threshold;
              return (
                <Card key={key} data-testid={`card-stage-${key}`}>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm">{stageLabel(key)}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-end gap-2">
                      <span className={`text-3xl font-bold ${overThreshold ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                        {stage.avg}d
                      </span>
                      <span className="text-sm text-muted-foreground mb-1">avg</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Threshold: {stage.threshold}d &bull; {stage.count} orders measured
                    </div>
                    {overThreshold && (
                      <Badge variant="destructive" className="text-xs">
                        {stage.avg - stage.threshold}d over SLA
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Tabs defaultValue="violations">
            <TabsList>
              <TabsTrigger value="violations" data-testid="tab-violations">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Violations ({data.slaViolations.length})
              </TabsTrigger>
              <TabsTrigger value="reps" data-testid="tab-reps">
                <Users className="h-4 w-4 mr-2" />
                By Rep
              </TabsTrigger>
              <TabsTrigger value="providers" data-testid="tab-providers">
                <Building2 className="h-4 w-4 mr-2" />
                By Provider
              </TabsTrigger>
            </TabsList>

            <TabsContent value="violations">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Rep</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead className="text-right">Days</TableHead>
                          <TableHead className="text-right">Over SLA</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.slaViolations.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No SLA violations with current thresholds
                            </TableCell>
                          </TableRow>
                        )}
                        {data.slaViolations.map((v, i) => (
                          <TableRow key={`${v.orderId}-${i}`} data-testid={`row-violation-${v.orderId}`}>
                            <TableCell className="font-mono text-sm">{v.invoiceNumber || "—"}</TableCell>
                            <TableCell>{v.customerName || "—"}</TableCell>
                            <TableCell>{v.repName}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{v.stage}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{v.daysInStage}d</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="destructive" className="text-xs">+{v.excess}d</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reps">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rep</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="text-right">Violations</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Avg Sale→Install</TableHead>
                          <TableHead className="text-right">Avg Install→Appr.</TableHead>
                          <TableHead className="text-right">Avg Appr.→Pay</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.repLeaderboard.map((rep) => (
                          <TableRow key={rep.repId} data-testid={`row-rep-${rep.repId}`}>
                            <TableCell>
                              <div className="font-medium">{rep.repName}</div>
                              <div className="text-xs text-muted-foreground font-mono">{rep.repId}</div>
                            </TableCell>
                            <TableCell className="text-right">{rep.totalOrders}</TableCell>
                            <TableCell className="text-right">
                              {rep.violations > 0 ? (
                                <span className="text-destructive font-medium">{rep.violations}</span>
                              ) : rep.violations}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={rep.violationRate > 30 ? "destructive" : rep.violationRate > 10 ? "secondary" : "outline"}>
                                {rep.violationRate}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{rep.avgSaleToInstall > 0 ? `${rep.avgSaleToInstall}d` : "—"}</TableCell>
                            <TableCell className="text-right">{rep.avgInstallToApproval > 0 ? `${rep.avgInstallToApproval}d` : "—"}</TableCell>
                            <TableCell className="text-right">{rep.avgApprovalToPayment > 0 ? `${rep.avgApprovalToPayment}d` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="providers">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="text-right">Violations</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Avg Sale→Install</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.providerLeaderboard.map((p) => (
                          <TableRow key={p.providerId} data-testid={`row-provider-${p.providerId}`}>
                            <TableCell className="font-medium">{p.providerName}</TableCell>
                            <TableCell className="text-right">{p.totalOrders}</TableCell>
                            <TableCell className="text-right">
                              {p.violations > 0 ? (
                                <span className="text-destructive font-medium">{p.violations}</span>
                              ) : p.violations}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant={p.violationRate > 30 ? "destructive" : p.violationRate > 10 ? "secondary" : "outline"}>
                                {p.violationRate}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{p.avgSaleToInstall > 0 ? `${p.avgSaleToInstall}d` : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
