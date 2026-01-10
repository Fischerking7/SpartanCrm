import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { XCircle, Clock, Eye, Building2, FileText, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
import type { Provider, Service, Client, User } from "@shared/schema";

interface MduStagingOrder {
  id: string;
  mduRepId: string;
  clientId: string;
  providerId: string;
  serviceId: string;
  dateSold: string;
  installDate?: string;
  installTime?: string;
  installType?: string;
  accountNumber?: string;
  tvSold: boolean;
  mobileSold: boolean;
  mobileProductType?: string;
  mobilePortedStatus?: string;
  mobileLinesQty: number;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionNote?: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
  promotedToOrderId?: string;
  createdAt: string;
}

export default function AdminMduReview() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedOrder, setSelectedOrder] = useState<MduStagingOrder | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  
  const handleCreateOrder = (orderId: string) => {
    setLocation(`/orders?fromMdu=${orderId}`);
  };

  const { data: pendingOrders, isLoading } = useQuery<MduStagingOrder[]>({
    queryKey: ["/api/admin/mdu/pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/mdu/pending", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pending orders");
      return res.json();
    },
  });

  const { data: allOrders } = useQuery<MduStagingOrder[]>({
    queryKey: ["/api/admin/mdu/orders"],
    queryFn: async () => {
      const res = await fetch("/api/admin/mdu/orders", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch all orders");
      return res.json();
    },
  });

  const { data: providers } = useQuery<Provider[]>({ queryKey: ["/api/providers"] });
  const { data: services } = useQuery<Service[]>({ queryKey: ["/api/services"] });
  const { data: clients } = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  const { data: users } = useQuery<User[]>({ queryKey: ["/api/admin/users"] });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const res = await fetch(`/api/admin/mdu/${id}/reject`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionNote: note }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reject order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/mdu/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/mdu/orders"] });
      setShowRejectDialog(false);
      setSelectedOrder(null);
      setRejectionNote("");
      toast({ title: "Order rejected" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject order", description: error.message, variant: "destructive" });
    },
  });

  const getProviderName = (id: string) => providers?.find(p => p.id === id)?.name || "Unknown";
  const getServiceName = (id: string) => services?.find(s => s.id === id)?.name || "Unknown";
  const getClientName = (id: string) => clients?.find(c => c.id === id)?.name || "Unknown";
  const getRepName = (repId: string) => {
    const user = users?.find(u => u.repId === repId);
    return user ? user.name : repId;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "APPROVED":
        return <Badge className="bg-green-500 text-white"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case "REJECTED":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleReject = () => {
    if (!selectedOrder) return;
    rejectMutation.mutate({ id: selectedOrder.id, note: rejectionNote });
  };

  const processedOrders = allOrders?.filter(o => o.status !== "PENDING") || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Building2 className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">MDU Order Review</h1>
          <p className="text-muted-foreground">Review and approve pending multi-dwelling unit orders</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Pending Approval ({pendingOrders?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : pendingOrders?.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No pending MDU orders</p>
          ) : (
            <div className="space-y-3">
              {pendingOrders?.map(order => (
                <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`pending-mdu-${order.id}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{order.customerName}</span>
                      {getStatusBadge(order.status)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Rep: {getRepName(order.mduRepId)} • 
                      {getProviderName(order.providerId)} • 
                      {getServiceName(order.serviceId)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Client: {getClientName(order.clientId)} • 
                      Sold: {new Date(order.dateSold).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setSelectedOrder(order)} data-testid={`button-view-mdu-${order.id}`}>
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCreateOrder(order.id)}
                      data-testid={`button-create-order-mdu-${order.id}`}
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      Create Order
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => { setSelectedOrder(order); setShowRejectDialog(true); }}
                      data-testid={`button-reject-mdu-${order.id}`}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {processedOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recently Processed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {processedOrders.slice(0, 20).map(order => (
                <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg opacity-75" data-testid={`processed-mdu-${order.id}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{order.customerName}</span>
                      {getStatusBadge(order.status)}
                      {order.promotedToOrderId && (
                        <Badge variant="outline" className="text-xs">In Orders</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Rep: {getRepName(order.mduRepId)} • 
                      {getProviderName(order.providerId)} • 
                      {getServiceName(order.serviceId)}
                    </div>
                    {order.status === "REJECTED" && order.rejectionNote && (
                      <p className="text-sm text-destructive">Reason: {order.rejectionNote}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {order.reviewedAt ? new Date(order.reviewedAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedOrder && !showRejectDialog} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Customer Name</Label>
                  <p className="font-medium">{selectedOrder.customerName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">MDU Rep</Label>
                  <p className="font-medium">{getRepName(selectedOrder.mduRepId)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p>{selectedOrder.customerPhone || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p>{selectedOrder.customerEmail || "-"}</p>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Address</Label>
                <p>{selectedOrder.customerAddress || "-"}</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground">Provider</Label>
                  <p>{getProviderName(selectedOrder.providerId)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Client</Label>
                  <p>{getClientName(selectedOrder.clientId)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Service</Label>
                  <p>{getServiceName(selectedOrder.serviceId)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground">Date Sold</Label>
                  <p>{new Date(selectedOrder.dateSold).toLocaleDateString()}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Install Date</Label>
                  <p>{selectedOrder.installDate ? new Date(selectedOrder.installDate).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Account #</Label>
                  <p>{selectedOrder.accountNumber || "-"}</p>
                </div>
              </div>
              {selectedOrder.notes && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="text-sm">{selectedOrder.notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelectedOrder(null)}>Close</Button>
            {selectedOrder?.status === "PENDING" && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => handleCreateOrder(selectedOrder.id)}
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Create Order
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setShowRejectDialog(true)}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Order</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this order. The MDU rep will see this note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea
                value={rejectionNote}
                onChange={e => setRejectionNote(e.target.value)}
                placeholder="Enter reason for rejection..."
                data-testid="input-rejection-note"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowRejectDialog(false); setRejectionNote(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectionNote.trim() || rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              Reject Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
