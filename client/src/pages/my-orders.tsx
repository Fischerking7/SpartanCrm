import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, CheckCircle2, Circle, Loader2, Shield } from "lucide-react";

const statusFilters = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "installed", label: "Installed" },
  { key: "approved", label: "Approved" },
  { key: "payready", label: "Pay Ready" },
  { key: "paid", label: "Paid" },
  { key: "chargeback", label: "Chargeback" },
];

function formatCurrency(v: number) {
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function getStatusColor(order: any) {
  if (order.paymentStatus === "PAID") return "bg-emerald-500";
  if (order.paymentStatus === "CHARGEBACK") return "bg-red-500";
  if (order.payrollReadyAt) return "bg-violet-500";
  if (order.approvalStatus === "APPROVED") return "bg-blue-500";
  if (order.jobStatus === "COMPLETED") return "bg-sky-500";
  return "bg-amber-500";
}

function getStatusLabel(order: any) {
  if (order.paymentStatus === "PAID") return "Paid";
  if (order.paymentStatus === "CHARGEBACK") return "Chargeback";
  if (order.payrollReadyAt) return "Pay Ready";
  if (order.approvalStatus === "APPROVED") return "Approved";
  if (order.jobStatus === "COMPLETED") return "Installed";
  return "Pending";
}

function TimelineStep({ label, date, done }: { label: string; date?: string | null; done: boolean }) {
  return (
    <div className="flex items-start gap-3">
      {done ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
      )}
      <div>
        <p className={`text-sm font-medium ${done ? "" : "text-muted-foreground"}`}>{label}</p>
        <p className="text-xs text-muted-foreground">
          {done && date ? formatDate(date) : "Pending"}
        </p>
      </div>
    </div>
  );
}

export default function MyOrders() {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [, setLocation] = useLocation();
  const search = useSearch();

  const { data, isLoading, isFetching, refetch } = useQuery<any>({
    queryKey: ["/api/my/orders", `?status=${filter}&page=${page}&limit=20`],
  });

  useEffect(() => {
    if (data?.orders && search) {
      const params = new URLSearchParams(search);
      const detailId = params.get("detail");
      if (detailId) {
        const order = data.orders.find((o: any) => o.id === detailId);
        if (order) setSelectedOrder(order);
      }
    }
  }, [data, search]);

  const { data: reserveData } = useQuery<any>({
    queryKey: ["/api/my/reserve"],
  });

  return (
    <div className="p-4 max-w-lg mx-auto pb-20" data-testid="my-orders-page">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setLocation("/dashboard")} className="p-1" data-testid="button-back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">My Orders</h1>
        {data && <span className="text-sm text-muted-foreground ml-auto">{data.total} total</span>}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 scrollbar-hide">
        {statusFilters.map(f => (
          <button
            key={f.key}
            onClick={() => { setFilter(f.key); setPage(1); }}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              filter === f.key
                ? "bg-[#1B2A4A] text-white dark:bg-[#C9A84C] dark:text-[#1B2A4A]"
                : "bg-muted text-muted-foreground"
            }`}
            data-testid={`filter-${f.key}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : !data?.orders?.length ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="empty-orders">
          <p>No orders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.orders.map((order: any) => (
            <button
              key={order.id}
              onClick={() => setSelectedOrder(order)}
              className="w-full text-left"
              data-testid={`order-row-${order.id}`}
            >
              <Card className="rounded-2xl hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{order.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.invoiceNumber}
                      </p>
                    </div>
                    <Badge variant="secondary" className={`text-white text-[10px] px-2 ml-2 ${getStatusColor(order)}`}>
                      {getStatusLabel(order)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-muted-foreground">{formatDate(order.dateSold)}</p>
                    {order.commissionAmount && (
                      <p className="text-sm font-semibold text-[#C9A84C]">{formatCurrency(parseFloat(order.commissionAmount))}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}

          {data.total > data.orders.length && (
            <div className="flex justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                data-testid="button-prev-page"
              >
                Previous
              </Button>
              <span className="flex items-center text-sm text-muted-foreground">
                Page {page} of {Math.ceil(data.total / 20)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= Math.ceil(data.total / 20)}
                onClick={() => setPage(p => p + 1)}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {isFetching && !isLoading && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-[#1B2A4A] text-white px-3 py-1 rounded-full text-xs flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading...
          </div>
        </div>
      )}

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Order Detail</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Invoice</p>
                  <p className="font-medium" data-testid="text-detail-invoice">{selectedOrder.invoiceNumber}</p>
                </div>
                <Badge variant="secondary" className={`text-white ${getStatusColor(selectedOrder)}`}>
                  {getStatusLabel(selectedOrder)}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Customer</p>
                  <p className="text-sm">{selectedOrder.customerName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date Sold</p>
                  <p className="text-sm">{formatDate(selectedOrder.dateSold)}</p>
                </div>
              </div>

              {(selectedOrder.tvSold || selectedOrder.mobileSold) && (
                <div>
                  <p className="text-xs text-muted-foreground">Services</p>
                  <p className="text-sm">
                    Internet{selectedOrder.tvSold ? " + TV" : ""}{selectedOrder.mobileSold ? ` + Mobile (${selectedOrder.mobileLinesQty || 1} lines)` : ""}
                  </p>
                </div>
              )}

              {selectedOrder.commissionAmount && (
                <div className="bg-[#C9A84C]/5 border border-[#C9A84C]/20 rounded-xl p-3">
                  <p className="text-xs text-[#C9A84C] font-medium">Commission</p>
                  <p className="text-xl font-bold text-[#C9A84C]">{formatCurrency(parseFloat(selectedOrder.commissionAmount))}</p>
                </div>
              )}

              <div className="space-y-3 pt-2">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Status Timeline</p>
                <TimelineStep label="Sold" date={selectedOrder.dateSold || selectedOrder.createdAt} done={true} />
                <TimelineStep
                  label="Installed"
                  date={selectedOrder.jobStatus === "COMPLETED" ? (selectedOrder.installDate || selectedOrder.installedAt) : null}
                  done={selectedOrder.jobStatus === "COMPLETED"}
                />
                <TimelineStep
                  label="Approved"
                  date={selectedOrder.approvedAt}
                  done={selectedOrder.approvalStatus === "APPROVED"}
                />
                <TimelineStep
                  label="Pay Ready"
                  date={selectedOrder.payrollReadyAt}
                  done={!!selectedOrder.payrollReadyAt}
                />
                <TimelineStep
                  label="Paid"
                  date={selectedOrder.paidAt}
                  done={selectedOrder.paymentStatus === "PAID"}
                />
              </div>

              {reserveData?.eligible && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">Rolling Reserve</p>
                  <Card className="rounded-xl">
                    <CardContent className="p-3 flex items-center gap-3">
                      <Shield className="h-5 w-5 text-[#C9A84C]" />
                      <div className="flex-1">
                        <p className="text-sm">Current balance: <span className="font-semibold">{formatCurrency(reserveData.currentBalance || 0)}</span></p>
                        <p className="text-xs text-muted-foreground">
                          {reserveData.percentFull >= 100
                            ? "Cap reached"
                            : `Withholding ${reserveData.withholdingPercent || 15}%`}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {selectedOrder.paymentStatus === "CHARGEBACK" && (
                <div className="bg-red-500/10 rounded-xl p-3">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">Chargeback Applied</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
