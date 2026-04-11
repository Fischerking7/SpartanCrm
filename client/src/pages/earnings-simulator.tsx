import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Calculator, Plus, Trash2, TrendingUp, Target, DollarSign, Zap } from "lucide-react";

interface SimulatorContext {
  currentProduction: {
    mtdSold: number;
    mtdApproved: number;
    mtdEarned: string;
    periodStart: string;
    periodEnd: string;
  };
  quota: {
    salesTarget: number;
    revenueTarget: number;
    salesProgress: number;
    revenueProgress: number;
  } | null;
  rateCards: Array<{
    id: string;
    providerName: string;
    serviceName: string;
    baseAmount: string;
    tvAddonAmount: string;
    mobilePerLineAmount: string;
    overrideDeduction: string;
  }>;
}

interface SimulatedSale {
  id: string;
  rateCardId: string;
  quantity: number;
  withTv: boolean;
  mobileLines: number;
}

interface CalculationResult {
  projectedAdditional: string;
  breakdown: Array<{
    rateCardId: string;
    quantity: number;
    withTv: boolean;
    mobileLines: number;
    perUnitCommission: number;
    subtotal: number;
  }>;
}

function formatCurrency(val: string | number) {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function newSale(): SimulatedSale {
  return { id: Math.random().toString(36).slice(2), rateCardId: "", quantity: 1, withTv: false, mobileLines: 0 };
}

export default function EarningsSimulator() {
  const { user } = useAuth();
  const [sales, setSales] = useState<SimulatedSale[]>([newSale()]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const { data: context, isLoading } = useQuery<SimulatorContext>({
    queryKey: ["/api/earnings-simulator/context"],
    queryFn: async () => {
      const res = await fetch("/api/earnings-simulator/context", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load simulator context");
      return res.json();
    },
  });

  const calculate = async () => {
    const validSales = sales.filter(s => s.rateCardId);
    if (validSales.length === 0) return;

    setIsCalculating(true);
    try {
      const res = await fetch("/api/earnings-simulator/calculate", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          additionalSales: validSales.map(s => ({
            rateCardId: s.rateCardId,
            quantity: s.quantity,
            withTv: s.withTv,
            mobileLines: s.mobileLines,
          })),
        }),
      });
      if (!res.ok) throw new Error("Calculation failed");
      const data = await res.json();
      setResult(data);
    } catch {
      // silent
    } finally {
      setIsCalculating(false);
    }
  };

  const updateSale = (id: string, updates: Partial<SimulatedSale>) => {
    setSales(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    setResult(null);
  };

  const addSale = () => {
    setSales(prev => [...prev, newSale()]);
    setResult(null);
  };

  const removeSale = (id: string) => {
    setSales(prev => prev.filter(s => s.id !== id));
    setResult(null);
  };

  const currentEarned = parseFloat(context?.currentProduction.mtdEarned || "0");
  const projectedAdditional = parseFloat(result?.projectedAdditional || "0");
  const totalProjected = currentEarned + projectedAdditional;

  const getRateCardLabel = (rc: SimulatorContext["rateCards"][0]) => {
    return `${rc.providerName} — ${rc.serviceName} ($${parseFloat(rc.baseAmount).toFixed(0)} base)`;
  };

  const getRateCardById = (id: string) => context?.rateCards.find(rc => rc.id === id);

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Earnings Simulator</h1>
        <p className="text-muted-foreground">Model "what if I sell X more this month" to see your projected commission</p>
      </div>

      {/* Current Production Overview */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : context ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs text-muted-foreground">MTD Earned</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-mtd-earned">
                {formatCurrency(context.currentProduction.mtdEarned)}
              </div>
              <div className="text-xs text-muted-foreground">{context.currentProduction.mtdSold} orders</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs text-muted-foreground">Simulated Add</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-simulated-additional">
                {formatCurrency(projectedAdditional)}
              </div>
              <div className="text-xs text-muted-foreground">From simulation</div>
            </CardContent>
          </Card>
          <Card className="border-primary">
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs text-muted-foreground">Total Projected</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-xl font-bold text-primary" data-testid="text-total-projected">
                {formatCurrency(totalProjected)}
              </div>
              <div className="text-xs text-muted-foreground">MTD + Simulated</div>
            </CardContent>
          </Card>
          {context.quota && (
            <Card>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardTitle className="text-xs text-muted-foreground">Quota Progress</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="text-xl font-bold" data-testid="text-quota-progress">
                  {context.quota.salesTarget > 0
                    ? `${Math.round((context.quota.salesProgress / context.quota.salesTarget) * 100)}%`
                    : "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {context.quota.salesProgress}/{context.quota.salesTarget} sales
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}

      {/* Quota progress bar */}
      {context?.quota && context.quota.salesTarget > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Quota Progress (Sales)</span>
              <span className="font-medium">{context.quota.salesProgress} / {context.quota.salesTarget}</span>
            </div>
            <Progress value={Math.min((context.quota.salesProgress / context.quota.salesTarget) * 100, 100)} className="h-2 mb-3" />
            {result && (
              <>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground text-xs">With simulated sales</span>
                  <span className="text-xs font-medium text-primary">{context.quota.salesProgress + sales.filter(s => s.rateCardId).reduce((t, s) => t + s.quantity, 0)} / {context.quota.salesTarget}</span>
                </div>
                <Progress
                  value={Math.min(((context.quota.salesProgress + sales.filter(s => s.rateCardId).reduce((t, s) => t + s.quantity, 0)) / context.quota.salesTarget) * 100, 100)}
                  className="h-1.5"
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sale Simulator */}
      <Card data-testid="card-simulator">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            Simulate Additional Sales
          </CardTitle>
          <CardDescription>Add products you plan to sell and see your projected earnings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : context && context.rateCards.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No active rate cards available</p>
            </div>
          ) : (
            <>
              {sales.map((sale, idx) => {
                const rc = getRateCardById(sale.rateCardId);
                return (
                  <div key={sale.id} className="border rounded-lg p-3 space-y-3" data-testid={`sale-row-${idx}`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <div>
                          <Label className="text-xs">Product / Rate Card</Label>
                          <Select
                            value={sale.rateCardId}
                            onValueChange={(v) => updateSale(sale.id, { rateCardId: v })}
                          >
                            <SelectTrigger data-testid={`select-rate-card-${idx}`}>
                              <SelectValue placeholder="Select a product..." />
                            </SelectTrigger>
                            <SelectContent>
                              {context?.rateCards.map(rc => (
                                <SelectItem key={rc.id} value={rc.id}>
                                  {getRateCardLabel(rc)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs">Quantity</Label>
                            <Input
                              type="number"
                              min={1}
                              max={99}
                              value={sale.quantity}
                              onChange={(e) => updateSale(sale.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                              className="h-8"
                              data-testid={`input-quantity-${idx}`}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs">+ TV?</Label>
                            <div className="flex items-center h-8">
                              <Switch
                                checked={sale.withTv}
                                onCheckedChange={(v) => updateSale(sale.id, { withTv: v })}
                                data-testid={`switch-tv-${idx}`}
                              />
                              {rc && sale.withTv && (
                                <span className="text-xs text-muted-foreground ml-2">+${parseFloat(rc.tvAddonAmount).toFixed(0)}</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Mobile Lines</Label>
                            <Input
                              type="number"
                              min={0}
                              max={10}
                              value={sale.mobileLines}
                              onChange={(e) => updateSale(sale.id, { mobileLines: Math.max(0, parseInt(e.target.value) || 0) })}
                              className="h-8"
                              data-testid={`input-mobile-lines-${idx}`}
                            />
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 mt-5 text-muted-foreground hover:text-destructive"
                        onClick={() => removeSale(sale.id)}
                        disabled={sales.length === 1}
                        data-testid={`button-remove-sale-${idx}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {rc && sale.rateCardId && (
                      <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 flex flex-wrap gap-3">
                        <span>Base: ${parseFloat(rc.baseAmount).toFixed(2)}</span>
                        {parseFloat(rc.tvAddonAmount) > 0 && <span>+ TV: ${parseFloat(rc.tvAddonAmount).toFixed(2)}</span>}
                        {parseFloat(rc.mobilePerLineAmount) > 0 && <span>Mobile/line: ${parseFloat(rc.mobilePerLineAmount).toFixed(2)}</span>}
                        {parseFloat(rc.overrideDeduction) > 0 && <span>Override: −${parseFloat(rc.overrideDeduction).toFixed(2)}</span>}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={addSale} data-testid="button-add-sale">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Product
                </Button>
                <Button
                  onClick={calculate}
                  disabled={isCalculating || !sales.some(s => s.rateCardId)}
                  size="sm"
                  data-testid="button-calculate"
                >
                  <Zap className="h-4 w-4 mr-1" />
                  {isCalculating ? "Calculating..." : "Calculate Earnings"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className="border-primary" data-testid="card-simulation-result">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <TrendingUp className="h-5 w-5" />
              Simulation Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center py-2">
              <div className="text-xs text-muted-foreground mb-1">Projected Additional Earnings</div>
              <div className="text-4xl font-bold text-primary" data-testid="text-result-additional">
                {formatCurrency(result.projectedAdditional)}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Total MTD: <strong>{formatCurrency(totalProjected)}</strong>
              </div>
            </div>

            {result.breakdown.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Breakdown</div>
                {result.breakdown.map((item, idx) => {
                  const rc = context?.rateCards.find(r => r.id === item.rateCardId);
                  return (
                    <div key={idx} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0" data-testid={`breakdown-row-${idx}`}>
                      <div>
                        <span className="font-medium">{rc ? `${rc.providerName} — ${rc.serviceName}` : item.rateCardId}</span>
                        <span className="text-muted-foreground ml-2">× {item.quantity}</span>
                        {item.withTv && <Badge variant="secondary" className="ml-1 text-xs">+TV</Badge>}
                        {item.mobileLines > 0 && <Badge variant="secondary" className="ml-1 text-xs">{item.mobileLines} mobile</Badge>}
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-green-600 dark:text-green-400">{formatCurrency(item.subtotal)}</div>
                        <div className="text-xs text-muted-foreground">${item.perUnitCommission.toFixed(2)}/unit</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
