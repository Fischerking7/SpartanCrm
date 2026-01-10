import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Edit2, Trash2, CheckCircle, XCircle, Clock } from "lucide-react";
import type { Client, Provider, Service } from "@shared/schema";

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
  customerBirthday?: string;
  customerSsnLast4?: string;
  customerSsnDisplay?: string;
  creditCardLast4?: string;
  creditCardExpiry?: string;
  creditCardName?: string;
  notes?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionNote?: string;
  createdAt: string;
}

export default function MduOrders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingOrder, setEditingOrder] = useState<MduStagingOrder | null>(null);
  const [formData, setFormData] = useState({
    clientId: "",
    providerId: "",
    serviceId: "",
    dateSold: new Date().toISOString().split("T")[0],
    installDate: "",
    installTime: "",
    installType: "",
    accountNumber: "",
    tvSold: false,
    mobileSold: false,
    mobileProductType: "",
    mobilePortedStatus: "",
    mobileLinesQty: 0,
    customerName: "",
    customerAddress: "",
    customerPhone: "",
    customerEmail: "",
    customerBirthday: "",
    customerSsn: "",
    creditCardLast4: "",
    creditCardExpiry: "",
    creditCardName: "",
    notes: "",
  });

  const { data: orders, isLoading } = useQuery<MduStagingOrder[]>({
    queryKey: ["/api/mdu/orders"],
    queryFn: async () => {
      const res = await fetch("/api/mdu/orders", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
    queryFn: async () => {
      const res = await fetch("/api/services", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/mdu/orders", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mdu/orders"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Order submitted for review" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create order", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await fetch(`/api/mdu/orders/${id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mdu/orders"] });
      setEditingOrder(null);
      resetForm();
      toast({ title: "Order updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update order", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/mdu/orders/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete order");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mdu/orders"] });
      toast({ title: "Order deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete order", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      clientId: "",
      providerId: "",
      serviceId: "",
      dateSold: new Date().toISOString().split("T")[0],
      installDate: "",
      installTime: "",
      installType: "",
      accountNumber: "",
      tvSold: false,
      mobileSold: false,
      mobileProductType: "",
      mobilePortedStatus: "",
      mobileLinesQty: 0,
      customerName: "",
      customerAddress: "",
      customerPhone: "",
      customerEmail: "",
      customerBirthday: "",
      customerSsn: "",
      creditCardLast4: "",
      creditCardExpiry: "",
      creditCardName: "",
      notes: "",
    });
  };

  const openEditDialog = (order: MduStagingOrder) => {
    setFormData({
      clientId: order.clientId,
      providerId: order.providerId,
      serviceId: order.serviceId,
      dateSold: order.dateSold,
      installDate: order.installDate || "",
      installTime: order.installTime || "",
      installType: order.installType || "",
      accountNumber: order.accountNumber || "",
      tvSold: order.tvSold,
      mobileSold: order.mobileSold,
      mobileProductType: order.mobileProductType || "",
      mobilePortedStatus: order.mobilePortedStatus || "",
      mobileLinesQty: order.mobileLinesQty,
      customerName: order.customerName,
      customerAddress: order.customerAddress || "",
      customerPhone: order.customerPhone || "",
      customerEmail: order.customerEmail || "",
      customerBirthday: order.customerBirthday || "",
      customerSsn: "",
      creditCardLast4: order.creditCardLast4 || "",
      creditCardExpiry: order.creditCardExpiry || "",
      creditCardName: order.creditCardName || "",
      notes: order.notes || "",
    });
    setEditingOrder(order);
  };

  const handleSubmit = () => {
    if (editingOrder) {
      updateMutation.mutate({ id: editingOrder.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending Review</Badge>;
      case "APPROVED":
        return <Badge className="bg-green-500 text-white"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      case "REJECTED":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingOrders = orders?.filter(o => o.status === "PENDING") || [];
  const processedOrders = orders?.filter(o => o.status !== "PENDING") || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">My MDU Orders</h1>
          <p className="text-muted-foreground">Submit orders for review and approval</p>
        </div>
        <Button onClick={() => { resetForm(); setShowCreateDialog(true); }} data-testid="button-new-mdu-order">
          <Plus className="h-4 w-4 mr-2" />
          New Order
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Review ({pendingOrders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingOrders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No pending orders</p>
          ) : (
            <div className="space-y-3">
              {pendingOrders.map(order => (
                <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`mdu-order-${order.id}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{order.customerName}</span>
                      {getStatusBadge(order.status)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {providers?.find(p => p.id === order.providerId)?.name} • 
                      {services?.find(s => s.id === order.serviceId)?.name} • 
                      Sold: {new Date(order.dateSold).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="ghost" onClick={() => openEditDialog(order)} data-testid={`button-edit-mdu-${order.id}`}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="text-destructive"
                      onClick={() => deleteMutation.mutate(order.id)}
                      data-testid={`button-delete-mdu-${order.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
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
            <CardTitle>Processed Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {processedOrders.map(order => (
                <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg opacity-75" data-testid={`mdu-order-processed-${order.id}`}>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{order.customerName}</span>
                      {getStatusBadge(order.status)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {providers?.find(p => p.id === order.providerId)?.name} • 
                      {services?.find(s => s.id === order.serviceId)?.name}
                    </div>
                    {order.status === "REJECTED" && order.rejectionNote && (
                      <p className="text-sm text-destructive">Reason: {order.rejectionNote}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreateDialog || !!editingOrder} onOpenChange={(open) => { 
        if (!open) { setShowCreateDialog(false); setEditingOrder(null); resetForm(); }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOrder ? "Edit Order" : "New MDU Order"}</DialogTitle>
            <DialogDescription>
              {editingOrder ? "Update order details" : "Submit a new order for review"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerName">Customer Name *</Label>
                <Input
                  id="customerName"
                  value={formData.customerName}
                  onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                  data-testid="input-customer-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerPhone">Phone</Label>
                <Input
                  id="customerPhone"
                  value={formData.customerPhone}
                  onChange={e => setFormData({ ...formData, customerPhone: e.target.value })}
                  data-testid="input-customer-phone"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerAddress">Address</Label>
              <Input
                id="customerAddress"
                value={formData.customerAddress}
                onChange={e => setFormData({ ...formData, customerAddress: e.target.value })}
                data-testid="input-customer-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerEmail">Email</Label>
                <Input
                  id="customerEmail"
                  type="email"
                  value={formData.customerEmail}
                  onChange={e => setFormData({ ...formData, customerEmail: e.target.value })}
                  data-testid="input-customer-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerBirthday">Birthday</Label>
                <Input
                  id="customerBirthday"
                  type="date"
                  value={formData.customerBirthday}
                  onChange={e => setFormData({ ...formData, customerBirthday: e.target.value })}
                  data-testid="input-customer-birthday"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerSsn">Social Security Number</Label>
                <Input
                  id="customerSsn"
                  value={formData.customerSsn}
                  onChange={e => {
                    let value = e.target.value.replace(/[^\d-]/g, "");
                    const digits = value.replace(/-/g, "");
                    if (digits.length <= 9) {
                      if (digits.length > 5) {
                        value = digits.slice(0, 3) + "-" + digits.slice(3, 5) + "-" + digits.slice(5);
                      } else if (digits.length > 3) {
                        value = digits.slice(0, 3) + "-" + digits.slice(3);
                      } else {
                        value = digits;
                      }
                    }
                    setFormData({ ...formData, customerSsn: value });
                  }}
                  placeholder="123-45-6789"
                  maxLength={11}
                  data-testid="input-customer-ssn"
                />
                {editingOrder?.customerSsnDisplay && (
                  <p className="text-xs text-muted-foreground">Current: {editingOrder.customerSsnDisplay}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="creditCardLast4">Credit Card (Last 4 digits)</Label>
                <Input
                  id="creditCardLast4"
                  value={formData.creditCardLast4}
                  onChange={e => {
                    const value = e.target.value.replace(/\D/g, "").slice(0, 4);
                    setFormData({ ...formData, creditCardLast4: value });
                  }}
                  placeholder="1234"
                  maxLength={4}
                  data-testid="input-credit-card-last4"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="creditCardExpiry">Card Expiry (MM/YY)</Label>
                <Input
                  id="creditCardExpiry"
                  value={formData.creditCardExpiry}
                  onChange={e => {
                    let value = e.target.value.replace(/[^\d/]/g, "");
                    if (value.length === 2 && !value.includes("/") && e.target.value.length > formData.creditCardExpiry.length) {
                      value = value + "/";
                    }
                    setFormData({ ...formData, creditCardExpiry: value.slice(0, 5) });
                  }}
                  placeholder="MM/YY"
                  maxLength={5}
                  data-testid="input-credit-card-expiry"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creditCardName">Name on Card</Label>
                <Input
                  id="creditCardName"
                  value={formData.creditCardName}
                  onChange={e => setFormData({ ...formData, creditCardName: e.target.value })}
                  placeholder="John Doe"
                  data-testid="input-credit-card-name"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={formData.providerId} onValueChange={v => setFormData({ ...formData, providerId: v })}>
                  <SelectTrigger data-testid="select-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <Select value={formData.clientId} onValueChange={v => setFormData({ ...formData, clientId: v })}>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Service</Label>
                <Select value={formData.serviceId} onValueChange={v => setFormData({ ...formData, serviceId: v })}>
                  <SelectTrigger data-testid="select-service">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services?.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateSold">Date Sold *</Label>
                <Input
                  id="dateSold"
                  type="date"
                  value={formData.dateSold}
                  onChange={e => setFormData({ ...formData, dateSold: e.target.value })}
                  data-testid="input-date-sold"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installDate">Install Date</Label>
                <Input
                  id="installDate"
                  type="date"
                  value={formData.installDate}
                  onChange={e => setFormData({ ...formData, installDate: e.target.value })}
                  data-testid="input-install-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account #</Label>
                <Input
                  id="accountNumber"
                  value={formData.accountNumber}
                  onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
                  data-testid="input-account-number"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes..."
                data-testid="input-notes"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingOrder(null); resetForm(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.customerName || createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit-mdu-order"
            >
              {editingOrder ? "Update Order" : "Submit for Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
