import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Users, User, Package } from "lucide-react";

function cents(val: number) {
  return "$" + (val / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rateColor(rate: number) {
  if (rate >= 75) return "text-green-600 dark:text-green-400";
  if (rate >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

export default function ExecProduction() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expandedMgr, setExpandedMgr] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const queryString = params.toString();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/executive/production", queryString ? `?${queryString}` : ""],
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (!data) return <div className="p-6 text-center text-muted-foreground">No data available</div>;

  const { byManager, byRep, byService } = data;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap gap-3 items-center">
        <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" data-testid="input-start-date" />
        <span className="text-sm text-muted-foreground">to</span>
        <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" data-testid="input-end-date" />
      </div>

      <Tabs defaultValue="manager">
        <TabsList data-testid="tabs-production-view">
          <TabsTrigger value="manager" className="gap-1" data-testid="tab-by-manager"><Users className="h-3.5 w-3.5" /> By Manager</TabsTrigger>
          <TabsTrigger value="rep" className="gap-1" data-testid="tab-by-rep"><User className="h-3.5 w-3.5" /> By Rep</TabsTrigger>
          <TabsTrigger value="service" className="gap-1" data-testid="tab-by-service"><Package className="h-3.5 w-3.5" /> By Service</TabsTrigger>
        </TabsList>

        <TabsContent value="manager">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm" data-testid="table-by-manager">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 px-3 text-left"></th>
                    <th className="py-2 px-3 text-left">Manager</th>
                    <th className="py-2 px-3 text-right">Team</th>
                    <th className="py-2 px-3 text-right">Sales</th>
                    <th className="py-2 px-3 text-right">Connects</th>
                    <th className="py-2 px-3 text-right">Rate</th>
                    <th className="py-2 px-3 text-right">Payout</th>
                    <th className="py-2 px-3 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {byManager.map((m: any) => (
                    <>
                      <tr key={m.id} className="border-b cursor-pointer hover:bg-muted/30" onClick={() => setExpandedMgr(expandedMgr === m.id ? null : m.id)} data-testid={`row-manager-${m.id}`}>
                        <td className="py-2.5 px-3">{expandedMgr === m.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="py-2.5 px-3 font-medium">{m.name}</td>
                        <td className="py-2.5 px-3 text-right">{m.teamSize}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{m.sales}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{m.connects}</td>
                        <td className={`py-2.5 px-3 text-right font-mono ${rateColor(m.rate)}`}>{m.rate}%</td>
                        <td className="py-2.5 px-3 text-right font-mono">{cents(m.payoutCents)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{cents(m.profitCents)}</td>
                      </tr>
                      {expandedMgr === m.id && m.reps?.map((r: any) => (
                        <tr key={r.id} className="border-b bg-muted/20" data-testid={`row-rep-${r.id}`}>
                          <td className="py-2 px-3"></td>
                          <td className="py-2 px-3 pl-8 text-muted-foreground">{r.name}</td>
                          <td className="py-2 px-3 text-right text-xs text-muted-foreground">{r.repId}</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">{r.sales}</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">{r.connects}</td>
                          <td className={`py-2 px-3 text-right font-mono ${rateColor(r.rate)}`}>{r.rate}%</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">{cents(r.payoutCents)}</td>
                          <td className="py-2 px-3"></td>
                        </tr>
                      ))}
                    </>
                  ))}
                  {byManager.length === 0 && (
                    <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No manager data</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rep">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm" data-testid="table-by-rep">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 px-3 text-left">Rep</th>
                    <th className="py-2 px-3 text-left">Manager</th>
                    <th className="py-2 px-3 text-right">Sales</th>
                    <th className="py-2 px-3 text-right">Connects</th>
                    <th className="py-2 px-3 text-right">Rate</th>
                    <th className="py-2 px-3 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {byRep.map((r: any) => (
                    <tr key={r.id} className="border-b" data-testid={`row-rep-flat-${r.id}`}>
                      <td className="py-2.5 px-3 font-medium">{r.name}</td>
                      <td className="py-2.5 px-3 text-muted-foreground">{r.manager}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{r.sales}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{r.connects}</td>
                      <td className={`py-2.5 px-3 text-right font-mono ${rateColor(r.rate)}`}>{r.rate}%</td>
                      <td className="py-2.5 px-3 text-right font-mono">{cents(r.payoutCents)}</td>
                    </tr>
                  ))}
                  {byRep.length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No rep data</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="service">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm" data-testid="table-by-service">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 px-3 text-left">Service</th>
                    <th className="py-2 px-3 text-right">Orders</th>
                    <th className="py-2 px-3 text-right">Connects</th>
                    <th className="py-2 px-3 text-right">Rate</th>
                    <th className="py-2 px-3 text-right">Payout</th>
                    <th className="py-2 px-3 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {byService.map((s: any) => (
                    <tr key={s.name} className="border-b" data-testid={`row-service-${s.name}`}>
                      <td className="py-2.5 px-3 font-medium">{s.name}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{s.totalOrders}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{s.connects}</td>
                      <td className={`py-2.5 px-3 text-right font-mono ${rateColor(s.rate)}`}>{s.rate}%</td>
                      <td className="py-2.5 px-3 text-right font-mono">{cents(s.payoutCents)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{cents(s.profitCents)}</td>
                    </tr>
                  ))}
                  {byService.length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No service data</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
