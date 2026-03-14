import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Clock, ListChecks, History, Loader2, SkipForward } from "lucide-react";

export default function DirApprovals() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/director/approvals"] });

  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => {
      await apiRequest("POST", `/api/orders/${orderId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/director/approvals"] });
      toast({ title: "Order approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const bulkApproveMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      await apiRequest("POST", "/api/orders/bulk-approve", { orderIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/director/approvals"] });
      setSelected(new Set());
      toast({ title: "Orders approved" });
    },
    onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (!data) return <div className="p-6 text-center text-muted-foreground">No approval data</div>;

  const { queue: rawQueue, history } = data;
  const queue = rawQueue.filter((o: any) => !skipped.has(o.id));

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectAll = () => {
    if (selected.size === queue.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(queue.map((o: any) => o.id)));
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="dir-approvals">
      <h1 className="text-xl font-semibold">Order Approvals</h1>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue" data-testid="tab-queue">
            <ListChecks className="h-3.5 w-3.5 mr-1" /> Queue ({queue.length})
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="h-3.5 w-3.5 mr-1" /> My History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Pending Approvals</CardTitle>
                <div className="flex items-center gap-2">
                  {selected.size > 0 && (
                    <Button
                      size="sm"
                      onClick={() => bulkApproveMutation.mutate(Array.from(selected))}
                      disabled={bulkApproveMutation.isPending}
                      data-testid="button-bulk-approve"
                    >
                      {bulkApproveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                      Approve Selected ({selected.size})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 w-10">
                        <input
                          type="checkbox"
                          checked={queue.length > 0 && selected.size === queue.length}
                          onChange={selectAll}
                          className="rounded"
                          data-testid="checkbox-select-all"
                        />
                      </th>
                      <th className="text-left p-3">Rep</th>
                      <th className="text-left p-3">Customer</th>
                      <th className="text-left p-3">Service</th>
                      <th className="text-left p-3">Date Sold</th>
                      <th className="text-center p-3">Days Waiting</th>
                      <th className="text-right p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.length === 0 && (
                      <tr><td colSpan={7} className="text-center p-6 text-muted-foreground">No orders pending approval</td></tr>
                    )}
                    {queue.map((o: any) => (
                      <tr key={o.id} className="border-b hover:bg-muted/30" data-testid={`row-approval-${o.id}`}>
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggleSelect(o.id)}
                            className="rounded"
                            data-testid={`checkbox-order-${o.id}`}
                          />
                        </td>
                        <td className="p-3 font-medium">{o.repName}</td>
                        <td className="p-3">{o.customerName}</td>
                        <td className="p-3">{o.serviceName}</td>
                        <td className="p-3 text-muted-foreground">{o.dateSold}</td>
                        <td className="p-3 text-center">
                          <Badge variant={o.daysWaiting >= 3 ? "destructive" : "outline"} className="text-xs">
                            <Clock className="h-3 w-3 mr-0.5" />{o.daysWaiting}d
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-green-600 hover:text-green-700"
                              onClick={() => approveMutation.mutate(o.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`button-approve-${o.id}`}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground"
                              onClick={() => { const next = new Set(skipped); next.add(o.id); setSkipped(next); }}
                              data-testid={`button-skip-${o.id}`}
                            >
                              <SkipForward className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3">Date</th>
                      <th className="text-left p-3">Rep</th>
                      <th className="text-left p-3">Customer</th>
                      <th className="text-center p-3">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!history || history.length === 0) && (
                      <tr><td colSpan={4} className="text-center p-6 text-muted-foreground">No approval history</td></tr>
                    )}
                    {history?.map((h: any) => (
                      <tr key={h.id} className="border-b hover:bg-muted/30" data-testid={`row-history-${h.id}`}>
                        <td className="p-3 text-muted-foreground">
                          {h.approvedAt ? new Date(h.approvedAt).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : "—"}
                        </td>
                        <td className="p-3 font-medium">{h.repName}</td>
                        <td className="p-3">{h.customerName}</td>
                        <td className="p-3 text-center">
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 text-xs">Approved</Badge>
                        </td>
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
