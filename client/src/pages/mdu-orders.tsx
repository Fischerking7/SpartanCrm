import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Edit2, Trash2, CheckCircle, XCircle, Clock, Camera } from "lucide-react";
import { ScreenshotCapture, AiFieldIndicator, MissingFieldsWarning } from "@/components/screenshot-capture";

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
  const { t } = useTranslation();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingOrder, setEditingOrder] = useState<MduStagingOrder | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [aiExtractedFields, setAiExtractedFields] = useState<Set<string>>(new Set());
  const [captureMissingFields, setCaptureMissingFields] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    dateSold: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })(),
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
      toast({ title: t("mduOrders.toasts.submitted") });
    },
    onError: (error: Error) => {
      toast({ title: t("mduOrders.toasts.createFailed"), description: error.message, variant: "destructive" });
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
      toast({ title: t("mduOrders.toasts.updated") });
    },
    onError: (error: Error) => {
      toast({ title: t("mduOrders.toasts.updateFailed"), description: error.message, variant: "destructive" });
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
      toast({ title: t("mduOrders.toasts.deleted") });
    },
    onError: (error: Error) => {
      toast({ title: t("mduOrders.toasts.deleteFailed"), description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFormData({
      dateSold: today,
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
    setShowCapture(false);
    setAiExtractedFields(new Set());
    setCaptureMissingFields([]);
  };

  const handleCaptureExtracted = (result: { orderData: Record<string, string>; confidence: Record<string, string>; imageObjectPath: string; imageObjectPaths?: string[]; rawExtraction: Record<string, unknown>; missingRequired: string[]; extractedFields: string[] }) => {
    const { orderData, missingRequired } = result;
    const newFields = new Set<string>();

    setFormData(f => {
      const updated = { ...f };
      if (orderData.customerName) { updated.customerName = orderData.customerName; newFields.add("customerName"); }
      if (orderData.customerPhone) { updated.customerPhone = orderData.customerPhone; newFields.add("customerPhone"); }
      if (orderData.customerEmail) { updated.customerEmail = orderData.customerEmail; newFields.add("customerEmail"); }
      if (orderData.customerAddress) { updated.customerAddress = orderData.customerAddress; newFields.add("customerAddress"); }
      if (orderData.accountNumber) { updated.accountNumber = orderData.accountNumber; newFields.add("accountNumber"); }
      if (orderData.installDate) { updated.installDate = orderData.installDate; newFields.add("installDate"); }
      return updated;
    });

    setAiExtractedFields(newFields);
    setCaptureMissingFields(missingRequired || []);
    setShowCapture(false);
  };

  const openEditDialog = (order: MduStagingOrder) => {
    setFormData({
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
          <h1 className="text-2xl font-semibold">{t("mduOrders.title")}</h1>
          <p className="text-muted-foreground">{t("mduOrders.subtitle")}</p>
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
            <p className="text-muted-foreground text-center py-8">{t("mduOrders.noPending")}</p>
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
                      Sold: {new Date(order.dateSold).toLocaleDateString()}
                      {order.accountNumber && ` • Account: ${order.accountNumber}`}
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
                      Sold: {new Date(order.dateSold).toLocaleDateString()}
                      {order.accountNumber && ` • Account: ${order.accountNumber}`}
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
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingOrder ? "Edit Order" : "New MDU Order"}</DialogTitle>
            <DialogDescription>
              {editingOrder ? "Update order details" : "Submit a new order for review"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-2">
            {!editingOrder && (
              !showCapture ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-dashed border-primary/50 text-primary"
                  onClick={() => setShowCapture(true)}
                  data-testid="button-capture-from-screenshot"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Capture from Screenshot
                </Button>
              ) : (
                <ScreenshotCapture
                  onExtracted={handleCaptureExtracted}
                  onClose={() => setShowCapture(false)}
                />
              )
            )}
            {captureMissingFields.length > 2 && (
              <MissingFieldsWarning missingFields={captureMissingFields} />
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerName" className="flex items-center gap-1">
                  Customer Name *
                  {aiExtractedFields.has("customerName") && <AiFieldIndicator fieldName="customerName" />}
                </Label>
                <Input
                  id="customerName"
                  value={formData.customerName}
                  onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                  data-testid="input-customer-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerPhone" className="flex items-center gap-1">
                  Phone
                  {aiExtractedFields.has("customerPhone") && <AiFieldIndicator fieldName="customerPhone" />}
                </Label>
                <Input
                  id="customerPhone"
                  value={formData.customerPhone}
                  onChange={e => setFormData({ ...formData, customerPhone: e.target.value })}
                  data-testid="input-customer-phone"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerAddress" className="flex items-center gap-1">
                Address
                {aiExtractedFields.has("customerAddress") && <AiFieldIndicator fieldName="customerAddress" />}
              </Label>
              <Input
                id="customerAddress"
                value={formData.customerAddress}
                onChange={e => setFormData({ ...formData, customerAddress: e.target.value })}
                data-testid="input-customer-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerEmail" className="flex items-center gap-1">
                  Email
                  {aiExtractedFields.has("customerEmail") && <AiFieldIndicator fieldName="customerEmail" />}
                </Label>
                <Input
                  id="customerEmail"
                  type="email"
                  value={formData.customerEmail}
                  onChange={e => setFormData({ ...formData, customerEmail: e.target.value })}
                  data-testid="input-customer-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerBirthday">{t("mduOrders.birthday")}</Label>
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
                <Label htmlFor="customerSsn">{t("mduOrders.ssn")}</Label>
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
                  placeholder={t("mduOrders.creditCardNamePlaceholder")}
                  data-testid="input-credit-card-name"
                />
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
                <Label htmlFor="installDate" className="flex items-center gap-1">
                  Install Date
                  {aiExtractedFields.has("installDate") && <AiFieldIndicator fieldName="installDate" />}
                </Label>
                <Input
                  id="installDate"
                  type="date"
                  value={formData.installDate}
                  onChange={e => setFormData({ ...formData, installDate: e.target.value })}
                  data-testid="input-install-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountNumber" className="flex items-center gap-1">
                  Account #
                  {aiExtractedFields.has("accountNumber") && <AiFieldIndicator fieldName="accountNumber" />}
                </Label>
                <Input
                  id="accountNumber"
                  value={formData.accountNumber}
                  onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
                  data-testid="input-account-number"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">{t("mduOrders.notesLabel")}</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                placeholder={t("mduOrders.notesPlaceholder")}
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
