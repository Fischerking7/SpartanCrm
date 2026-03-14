import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronLeft, ChevronDown, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useState } from "react";

function formatCurrency(v: number) {
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function CircularGauge({ current, cap }: { current: number; cap: number }) {
  const pct = Math.min(Math.max((current / cap) * 100, 0), 100);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  const isAtCap = current >= cap;
  const isDeficit = current < 0;
  const color = isDeficit ? "#F97316" : isAtCap ? "#3B82F6" : "#22C55E";

  return (
    <div className="relative flex items-center justify-center" data-testid="reserve-gauge">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r={radius} fill="none" stroke="currentColor" strokeWidth="12" className="text-muted/30" />
        <circle
          cx="90" cy="90" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 90 90)"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-2xl font-bold" style={{ color }}>{formatCurrency(current)}</p>
        <p className="text-xs text-muted-foreground">of {formatCurrency(cap)} cap</p>
      </div>
    </div>
  );
}

export default function MyReserve() {
  const [, setLocation] = useLocation();
  const [infoOpen, setInfoOpen] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/my/reserve"],
  });

  if (isLoading) {
    return (
      <div className="p-4 max-w-lg mx-auto pb-20" data-testid="my-reserve-page">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setLocation("/my-earnings")} className="p-1" data-testid="button-back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">My Reserve</h1>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-48 w-48 rounded-full mx-auto" />
          <Skeleton className="h-6 w-48 mx-auto" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!data?.eligible) {
    return (
      <div className="p-4 max-w-lg mx-auto pb-20" data-testid="my-reserve-page">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setLocation("/my-earnings")} className="p-1" data-testid="button-back">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">My Reserve</h1>
        </div>
        <p className="text-center text-muted-foreground py-12">{data?.message || "Reserve not applicable"}</p>
      </div>
    );
  }

  const balanceDollars = data.currentBalance || 0;
  const capDollars = data.cap || 2500;
  const isAtCap = balanceDollars >= capDollars;
  const isDeficit = balanceDollars < 0;
  const transactions = data.recentTransactions || [];

  const totalWithheld = data.totalWithheld || 0;
  const totalChargebacks = data.totalChargebacks || 0;
  const totalReleased = transactions
    .filter((t: any) => t.type === "RELEASE" || t.type === "MATURITY_RELEASE")
    .reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);

  return (
    <div className="p-4 max-w-lg mx-auto pb-20" data-testid="my-reserve-page">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setLocation("/my-earnings")} className="p-1" data-testid="button-back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">My Reserve</h1>
      </div>

      <Card className="rounded-2xl border-0 shadow-sm mb-6" data-testid="reserve-balance-card">
        <CardContent className="p-6 flex flex-col items-center">
          <CircularGauge current={balanceDollars} cap={capDollars} />
          <p className={`text-sm font-medium mt-4 ${
            isDeficit ? "text-orange-500" : isAtCap ? "text-blue-500" : "text-emerald-600"
          }`} data-testid="text-reserve-status">
            {data.statusLabel}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-3 text-center">
            <TrendingUp className="h-4 w-4 mx-auto text-emerald-500 mb-1" />
            <p className="text-xs text-muted-foreground">Withheld</p>
            <p className="text-sm font-bold" data-testid="text-total-withheld">
              {formatCurrency(totalWithheld)}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-3 text-center">
            <TrendingDown className="h-4 w-4 mx-auto text-red-500 mb-1" />
            <p className="text-xs text-muted-foreground">Chargebacks</p>
            <p className="text-sm font-bold" data-testid="text-total-chargebacks">
              {formatCurrency(totalChargebacks)}
            </p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardContent className="p-3 text-center">
            <Minus className="h-4 w-4 mx-auto text-blue-500 mb-1" />
            <p className="text-xs text-muted-foreground">Released</p>
            <p className="text-sm font-bold" data-testid="text-total-released">
              {formatCurrency(totalReleased)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Transaction History
        </h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No transactions yet</p>
        ) : (
          <div className="space-y-2">
            {transactions.map((txn: any, i: number) => {
              const isCredit = txn.amount > 0;
              return (
                <div key={i} className="flex items-center justify-between py-3 border-b last:border-0" data-testid={`txn-row-${i}`}>
                  <div>
                    <p className="text-sm font-medium">
                      {txn.description || txn.type?.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </p>
                    <p className="text-xs text-muted-foreground">{txn.date ? formatDate(txn.date) : "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${isCredit ? "text-emerald-600" : "text-red-500"}`}>
                      {isCredit ? "+" : ""}{formatCurrency(txn.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">Bal: {formatCurrency(txn.balanceAfter)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Collapsible open={infoOpen} onOpenChange={setInfoOpen}>
        <CollapsibleTrigger className="w-full" data-testid="button-toggle-info">
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <Info className="h-5 w-5 text-[#C9A84C]" />
              <span className="text-sm font-medium flex-1 text-left">How does the reserve work?</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${infoOpen ? "rotate-180" : ""}`} />
            </CardContent>
          </Card>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="rounded-2xl border-0 shadow-sm mt-2">
            <CardContent className="p-4 text-sm text-muted-foreground space-y-3">
              <p>
                A rolling reserve protects both you and the company from chargebacks.
                15% of each pay period's net commission is withheld until your reserve reaches the $2,500 cap.
              </p>
              <p>
                If a customer cancels or a chargeback occurs, the amount is deducted from your reserve
                instead of your paycheck. This keeps your pay stable.
              </p>
              <p>
                Once you separate from the company, your reserve balance is released back to you after
                the carrier's maturity period (120 days for Astound). No early release is permitted per policy.
              </p>
              <p className="text-xs">
                For the full policy, refer to the Chargeback & Rolling Reserve Policy signed during onboarding.
              </p>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
