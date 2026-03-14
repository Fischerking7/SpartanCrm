import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CheckCircle2, XCircle, Search, Filter, Clock, AlertTriangle, ChevronLeft, ChevronRight, ShieldAlert
} from "lucide-react";

function RiskBadge({ score }: { score: number | null | undefined }) {
  if (!score && score !== 0) return null;
  const cfg = score <= 25 ? { label: "Low", cls: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" }
    : score <= 50 ? { label: "Med", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" }
    : score <= 75 ? { label: "High", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" }
    : { label: "Critical", cls: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${cfg.cls}`} data-testid="badge-risk-score">
      <ShieldAlert className="h-3 w-3" />
      {score} {cfg.label}
    </span>
  );
}

const roleColors: Record<string, string> = {
  REP: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  MDU: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  LEAD: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  MANAGER: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

export default function OpsOrders() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const limit = 25;

  const { data: pendingOrders, isLoading: pendingLoading } = useQuery<any[]>({
    queryKey: ["/api/orders", "?status=COMPLETED&limit=100"],
  });

  const { data: allOrdersData, isLoading: allLoading } = useQuery<any>({
    queryKey: ["/api/orders", `?status=${statusFilter === "all" ? "" : statusFilter}&search=${searchTerm}&page=${page}&limit=${limit}`],
  });

  const approvalQueue = useMemo(() => {
    if (!pendingOrders) return [];
    return (Array.isArray(pendingOrders) ? pendingOrders : []).filter(
      (o: any) => o.status === "COMPLETED" && !o.approvedAt
    );
  }, [pendingOrders]);

  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return apiRequest("PATCH", `/api/orders/${orderId}`, { status: "APPROVED" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return apiRequest("PATCH", `/api/orders/${orderId}`, { status: "CANCELED" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order rejected" });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/orders/${id}`, { status: "APPROVED" })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSelectedIds(new Set());
      toast({ title: `${selectedIds.size} orders approved` });
    },
    onError: () => toast({ title: "Bulk approve failed", variant: "destructive" }),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === approvalQueue.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(approvalQueue.map((o: any) => o.id)));
    }
  };

  const getDaysSince = (dateStr: string) => {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  };

  const allOrders = Array.isArray(allOrdersData) ? allOrdersData : (allOrdersData?.orders || []);
  const totalOrders = allOrdersData?.total || allOrders.length;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto" data-testid="ops-orders">
      <h1 className="text-2xl font-bold mb-6">Order Management</h1>

      <Tabs defaultValue="approval" className="space-y-4">
        <TabsList>
          <TabsTrigger value="approval" data-testid="tab-approval">
            Needs Approval ({approvalQueue.length})
          </TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all-orders">
            All Orders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approval" className="space-y-4">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Button
                size="sm"
                onClick={() => bulkApproveMutation.mutate([...selectedIds])}
                disabled={bulkApproveMutation.isPending}
                data-testid="btn-bulk-approve"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Approve Selected
              </Button>
            </div>
          )}

          {pendingLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
          ) : approvalQueue.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                No orders pending approval
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <Checkbox
                  checked={selectedIds.size === approvalQueue.length && approvalQueue.length > 0}
                  onCheckedChange={toggleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm text-muted-foreground">Select All</span>
              </div>
              {approvalQueue.map((order: any) => {
                const days = getDaysSince(order.completedAt || order.createdAt);
                return (
                  <Card key={order.id} className={days >= 5 ? "border-red-300 dark:border-red-700" : ""} data-testid={`approval-order-${order.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedIds.has(order.id)}
                          onCheckedChange={() => toggleSelect(order.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{order.repName || order.repId}</span>
                            {order.repRoleAtSale && (
                              <Badge variant="outline" className={`text-xs ${roleColors[order.repRoleAtSale] || ""}`}>
                                {order.repRoleAtSale}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {order.customerName} · {order.serviceName || "N/A"}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>${parseFloat(order.baseCommissionEarned || "0").toFixed(2)}</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {days}d ago
                            </span>
                            {days >= 5 && (
                              <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> Overdue
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            onClick={() => approveMutation.mutate(order.id)}
                            disabled={approveMutation.isPending}
                            data-testid={`btn-approve-${order.id}`}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => rejectMutation.mutate(order.id)}
                            disabled={rejectMutation.isPending}
                            data-testid={`btn-reject-${order.id}`}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                className="pl-9"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
                data-testid="input-search-orders"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="CANCELED">Canceled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {allLoading ? (
            <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3 font-medium">Invoice</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Customer</th>
                      <th className="text-left p-3 font-medium hidden lg:table-cell">Rep</th>
                      <th className="text-left p-3 font-medium hidden md:table-cell">Service</th>
                      <th className="text-left p-3 font-medium">Status</th>
                      <th className="text-right p-3 font-medium hidden sm:table-cell">Commission</th>
                      <th className="text-right p-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allOrders.map((order: any) => (
                      <tr key={order.id} className="border-t hover:bg-muted/50 cursor-pointer" onClick={() => setSelectedOrder(order)} data-testid={`order-row-${order.id}`}>
                        <td className="p-3 font-mono text-xs">{order.invoiceNumber || "—"}</td>
                        <td className="p-3 hidden md:table-cell">{order.customerName}</td>
                        <td className="p-3 hidden lg:table-cell">{order.repId}</td>
                        <td className="p-3 hidden md:table-cell">{order.serviceName || "—"}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {order.status}
                            </Badge>
                            <RiskBadge score={order.chargebackRiskScore} />
                          </div>
                        </td>
                        <td className="p-3 text-right hidden sm:table-cell">
                          ${parseFloat(order.baseCommissionEarned || "0").toFixed(2)}
                        </td>
                        <td className="p-3 text-right">
                          <Button size="sm" variant="ghost" data-testid={`btn-view-${order.id}`}>
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {allOrders.length} of {totalOrders} orders
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)} data-testid="btn-prev-page">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" disabled={allOrders.length < limit} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Invoice</p>
                  <p className="font-medium">{selectedOrder.invoiceNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant="outline">{selectedOrder.status}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Customer</p>
                  <p className="font-medium">{selectedOrder.customerName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Rep</p>
                  <p className="font-medium">{selectedOrder.repId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Service</p>
                  <p className="font-medium">{selectedOrder.serviceName || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Provider</p>
                  <p className="font-medium">{selectedOrder.providerName || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Commission</p>
                  <p className="font-medium">${parseFloat(selectedOrder.baseCommissionEarned || "0").toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">{new Date(selectedOrder.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              {selectedOrder.chargebackRiskScore != null && (
                <div className="p-3 rounded-lg bg-muted/50 border" data-testid="section-risk-detail">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4" /> Chargeback Risk
                    </p>
                    <RiskBadge score={selectedOrder.chargebackRiskScore} />
                  </div>
                  {selectedOrder.chargebackRiskFactors && (() => {
                    try {
                      const factors = JSON.parse(selectedOrder.chargebackRiskFactors);
                      const triggered = factors.filter((f: any) => f.triggered);
                      if (triggered.length === 0) return <p className="text-xs text-muted-foreground">No risk factors triggered</p>;
                      return (
                        <ul className="space-y-1">
                          {triggered.map((f: any, i: number) => (
                            <li key={i} className="text-xs flex items-start gap-1.5">
                              <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 flex-shrink-0" />
                              <span>{f.factor} <span className="text-muted-foreground">(+{f.weight})</span>{f.detail ? ` — ${f.detail}` : ""}</span>
                            </li>
                          ))}
                        </ul>
                      );
                    } catch { return null; }
                  })()}
                </div>
              )}
              {selectedOrder.customerAddress && (
                <div className="text-sm">
                  <p className="text-muted-foreground">Address</p>
                  <p className="font-medium">{selectedOrder.customerAddress}</p>
                </div>
              )}
              {selectedOrder.status === "COMPLETED" && !selectedOrder.approvedAt && (
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1" onClick={() => { approveMutation.mutate(selectedOrder.id); setSelectedOrder(null); }} data-testid="btn-approve-detail">
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Approve
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => { rejectMutation.mutate(selectedOrder.id); setSelectedOrder(null); }} data-testid="btn-reject-detail">
                    <XCircle className="h-4 w-4 mr-2" /> Reject
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
