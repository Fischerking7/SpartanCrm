import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Users, User, Package } from "lucide-react";

function rateColor(rate: number) {
  if (rate >= 75) return "text-green-600 dark:text-green-400";
  if (rate >= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function rateBadge(rate: number) {
  if (rate >= 75) return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
  if (rate >= 60) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
  return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
}

export default function DirProduction() {
  const now = new Date();
  const [startDate, setStartDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split("T")[0]);
  const [expandedMgr, setExpandedMgr] = useState<string | null>(null);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/director/production", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/director/production?startDate=${startDate}&endDate=${endDate}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (!data) return <div className="p-6 text-center text-muted-foreground">No data</div>;

  const { byManager, byRep, byService } = data;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="dir-production">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Team Production</h1>
        <div className="flex items-center gap-2">
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-36" data-testid="input-start-date" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-36" data-testid="input-end-date" />
        </div>
      </div>

      <Tabs defaultValue="by-manager">
        <TabsList>
          <TabsTrigger value="by-manager" data-testid="tab-by-manager"><Users className="h-3.5 w-3.5 mr-1" /> By Manager</TabsTrigger>
          <TabsTrigger value="by-rep" data-testid="tab-by-rep"><User className="h-3.5 w-3.5 mr-1" /> By Rep</TabsTrigger>
          <TabsTrigger value="by-service" data-testid="tab-by-service"><Package className="h-3.5 w-3.5 mr-1" /> By Service</TabsTrigger>
        </TabsList>

        <TabsContent value="by-manager">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="w-10 p-3"></th>
                      <th className="text-left p-3">Manager</th>
                      <th className="text-center p-3">Team Size</th>
                      <th className="text-right p-3">MTD Sales</th>
                      <th className="text-right p-3">MTD Connects</th>
                      <th className="text-right p-3">Rate</th>
                      <th className="text-left p-3">Best Rep</th>
                      <th className="text-center p-3">Needs Attention</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byManager.length === 0 && (
                      <tr><td colSpan={8} className="text-center p-6 text-muted-foreground">No managers found</td></tr>
                    )}
                    {byManager.map((m: any) => (
                      <>
                        <tr key={m.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedMgr(expandedMgr === m.id ? null : m.id)} data-testid={`row-mgr-${m.id}`}>
                          <td className="p-3">
                            <button data-testid={`button-expand-mgr-${m.id}`}>
                              {expandedMgr === m.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="p-3 font-medium">{m.name}</td>
                          <td className="p-3 text-center">{m.teamSize}</td>
                          <td className="p-3 text-right">{m.sales}</td>
                          <td className="p-3 text-right font-medium">{m.connects}</td>
                          <td className="p-3 text-right">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${rateBadge(m.rate)}`}>{m.rate}%</span>
                          </td>
                          <td className="p-3">{m.bestRep || "—"}</td>
                          <td className="p-3 text-center">
                            {m.needsAttention > 0 ? (
                              <Badge variant="destructive" className="text-xs">{m.needsAttention}</Badge>
                            ) : (
                              <span className="text-green-600 text-xs">✓</span>
                            )}
                          </td>
                        </tr>
                        {expandedMgr === m.id && m.reps?.map((r: any) => (
                          <tr key={r.id} className="border-b bg-muted/20" data-testid={`row-rep-under-mgr-${r.id}`}>
                            <td className="p-3"></td>
                            <td className="p-3 pl-8 text-muted-foreground">{r.name}</td>
                            <td className="p-3 text-center text-xs text-muted-foreground">{r.role}</td>
                            <td className="p-3 text-right">{r.sales}</td>
                            <td className="p-3 text-right">{r.connects}</td>
                            <td className="p-3 text-right">
                              <span className={`text-xs font-medium ${rateColor(r.rate)}`}>{r.rate}%</span>
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">{r.lastSale || "—"}</td>
                            <td className="p-3"></td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-rep">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 w-10">#</th>
                      <th className="text-left p-3">Rep</th>
                      <th className="text-left p-3">Manager</th>
                      <th className="text-center p-3">Role</th>
                      <th className="text-right p-3">Sales</th>
                      <th className="text-right p-3">Connects</th>
                      <th className="text-right p-3">Rate</th>
                      <th className="text-left p-3">Last Sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRep.length === 0 && (
                      <tr><td colSpan={8} className="text-center p-6 text-muted-foreground">No reps found</td></tr>
                    )}
                    {byRep.map((r: any, i: number) => (
                      <tr key={r.id} className="border-b hover:bg-muted/30" data-testid={`row-rep-${r.id}`}>
                        <td className="p-3 text-muted-foreground">{i + 1}</td>
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 text-muted-foreground">{r.manager}</td>
                        <td className="p-3 text-center"><Badge variant="outline" className="text-xs">{r.role}</Badge></td>
                        <td className="p-3 text-right">{r.sales}</td>
                        <td className="p-3 text-right font-medium">{r.connects}</td>
                        <td className="p-3 text-right">
                          <span className={`text-xs font-medium ${rateColor(r.rate)}`}>{r.rate}%</span>
                        </td>
                        <td className="p-3 text-muted-foreground">{r.lastSale || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-service">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3">Service</th>
                      <th className="text-right p-3">Total Orders</th>
                      <th className="text-right p-3">Connects</th>
                      <th className="text-right p-3">Rate</th>
                      <th className="text-left p-3">Best Manager</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byService.length === 0 && (
                      <tr><td colSpan={5} className="text-center p-6 text-muted-foreground">No service data</td></tr>
                    )}
                    {byService.map((s: any) => (
                      <tr key={s.serviceId} className="border-b hover:bg-muted/30" data-testid={`row-service-${s.serviceId}`}>
                        <td className="p-3 font-medium">{s.name}</td>
                        <td className="p-3 text-right">{s.totalOrders}</td>
                        <td className="p-3 text-right font-medium">{s.connects}</td>
                        <td className="p-3 text-right">
                          <span className={`text-xs font-medium ${rateColor(s.rate)}`}>{s.rate}%</span>
                        </td>
                        <td className="p-3 text-muted-foreground">{s.bestManager || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
