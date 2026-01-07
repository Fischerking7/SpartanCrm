import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Calendar, Lock, Check, Eye, DollarSign, Users, FileText, Link } from "lucide-react";
import type { PayRun, SalesOrder } from "@shared/schema";

interface PayRunDetails extends PayRun {
  orders: SalesOrder[];
  stats: {
    totalOrders: number;
    totalCommission: string;
    repBreakdown: { name: string; total: number; count: number }[];
  };
}

export default function PayRuns() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [selectedPayRun, setSelectedPayRun] = useState<PayRunDetails | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [weekEndingDate, setWeekEndingDate] = useState("");

  const { data: payRuns, isLoading } = useQuery<PayRun[]>({
    queryKey: ["/api/admin/payruns"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay runs");
      return res.json();
    },
  });

  const { data: unlinkedOrders } = useQuery<SalesOrder[]>({
    queryKey: ["/api/admin/payruns/unlinked-orders"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns/unlinked-orders", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showLinkDialog,
  });

  const createMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch("/api/admin/payruns", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ weekEndingDate: date }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create pay run");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      setShowCreateDialog(false);
      setWeekEndingDate("");
      toast({ title: "Pay run created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create pay run", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/finalize`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to finalize");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run finalized" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to finalize", description: error.message, variant: "destructive" });
    },
  });

  const linkOrdersMutation = useMutation({
    mutationFn: async ({ payRunId, orderIds }: { payRunId: string; orderIds: string[] }) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/link-orders`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to link orders");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns/unlinked-orders"] });
      setShowLinkDialog(false);
      setSelectedOrderIds([]);
      toast({ title: `${data.linked} orders linked to pay run` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to link orders", description: error.message, variant: "destructive" });
    },
  });

  const viewPayRun = async (payRunId: string) => {
    try {
      const res = await fetch(`/api/admin/payruns/${payRunId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay run details");
      const details = await res.json();
      setSelectedPayRun(details);
      setShowDetailsDialog(true);
    } catch (error) {
      toast({ title: "Failed to load pay run details", variant: "destructive" });
    }
  };

  const openLinkDialog = (payRun: PayRun) => {
    setSelectedPayRun(payRun as PayRunDetails);
    setSelectedOrderIds([]);
    setShowLinkDialog(true);
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const columns = [
    {
      key: "weekEndingDate",
      header: "Week Ending",
      cell: (row: PayRun) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">
            {new Date(row.weekEndingDate).toLocaleDateString()}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row: PayRun) => (
        <Badge variant={row.status === "FINALIZED" ? "default" : "secondary"}>
          {row.status === "FINALIZED" ? (
            <><Lock className="h-3 w-3 mr-1" />Finalized</>
          ) : (
            <>Draft</>
          )}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      cell: (row: PayRun) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "finalizedAt",
      header: "Finalized",
      cell: (row: PayRun) => (
        <span className="text-sm text-muted-foreground">
          {row.finalizedAt ? new Date(row.finalizedAt).toLocaleString() : "-"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: PayRun) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => viewPayRun(row.id)}
            data-testid={`button-view-${row.id}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {row.status === "DRAFT" && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openLinkDialog(row)}
                data-testid={`button-link-orders-${row.id}`}
              >
                <Link className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => finalizeMutation.mutate(row.id)}
                disabled={finalizeMutation.isPending}
                data-testid={`button-finalize-${row.id}`}
              >
                <Check className="h-4 w-4 mr-1" />
                Finalize
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const orderColumns = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      cell: (row: SalesOrder) => <span className="font-mono text-sm">{row.invoiceNumber}</span>,
    },
    {
      key: "repId",
      header: "Rep",
      cell: (row: SalesOrder) => <span className="font-mono">{row.repId}</span>,
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row: SalesOrder) => <span>{row.customerName}</span>,
    },
    {
      key: "commission",
      header: "Commission",
      cell: (row: SalesOrder) => (
        <span className="font-mono">
          ${(parseFloat(row.baseCommissionEarned) + parseFloat(row.incentiveEarned)).toFixed(2)}
        </span>
      ),
      className: "text-right",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Pay Runs</h1>
          <p className="text-muted-foreground">
            Manage weekly payment cycles
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-payrun">
          <Plus className="h-4 w-4 mr-2" />
          New Pay Run
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={payRuns || []}
            isLoading={isLoading}
            emptyMessage="No pay runs yet"
            testId="table-payruns"
          />
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Pay Run</DialogTitle>
            <DialogDescription>
              Create a new weekly pay run for payment processing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Week Ending Date</Label>
              <Input
                type="date"
                value={weekEndingDate}
                onChange={(e) => setWeekEndingDate(e.target.value)}
                data-testid="input-week-ending-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(weekEndingDate)}
              disabled={!weekEndingDate || createMutation.isPending}
              data-testid="button-confirm-create-payrun"
            >
              Create Pay Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pay Run - Week Ending {selectedPayRun && new Date(selectedPayRun.weekEndingDate).toLocaleDateString()}
            </DialogTitle>
            <DialogDescription>
              View pay run details and linked orders
            </DialogDescription>
          </DialogHeader>
          {selectedPayRun && (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Total Orders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{selectedPayRun.stats.totalOrders}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Total Commission
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">${selectedPayRun.stats.totalCommission}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Reps Paid
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{selectedPayRun.stats.repBreakdown.length}</p>
                  </CardContent>
                </Card>
              </div>

              {selectedPayRun.stats.repBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Rep Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedPayRun.stats.repBreakdown.map((rep) => (
                        <div key={rep.name} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div>
                            <span className="font-mono">{rep.name}</span>
                            <span className="text-sm text-muted-foreground ml-2">({rep.count} orders)</span>
                          </div>
                          <span className="font-mono font-medium">${rep.total.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Linked Orders</CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={orderColumns}
                    data={selectedPayRun.orders || []}
                    isLoading={false}
                    emptyMessage="No orders linked to this pay run"
                    testId="table-payrun-orders"
                  />
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link Orders to Pay Run</DialogTitle>
            <DialogDescription>
              Select approved orders to include in this pay run.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {unlinkedOrders?.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No unlinked orders available</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {unlinkedOrders?.map((order) => (
                  <div 
                    key={order.id} 
                    className="flex items-center gap-4 p-3 border rounded-md hover-elevate cursor-pointer"
                    onClick={() => toggleOrderSelection(order.id)}
                  >
                    <Checkbox 
                      checked={selectedOrderIds.includes(order.id)}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      data-testid={`checkbox-order-${order.id}`}
                    />
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <span className="font-mono text-sm">{order.invoiceNumber}</span>
                      <span className="font-mono">{order.repId}</span>
                      <span className="truncate">{order.customerName}</span>
                      <span className="font-mono text-right">
                        ${(parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowLinkDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedPayRun && linkOrdersMutation.mutate({ 
                payRunId: selectedPayRun.id, 
                orderIds: selectedOrderIds 
              })}
              disabled={selectedOrderIds.length === 0 || linkOrdersMutation.isPending}
              data-testid="button-confirm-link-orders"
            >
              Link {selectedOrderIds.length} Orders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
