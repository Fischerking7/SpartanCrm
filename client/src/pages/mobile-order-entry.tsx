import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { 
  Plus, CheckCircle, Zap, ClipboardList, ArrowRight, 
  Phone, MapPin, User, Calendar, Tv, Smartphone, 
  Building2, RefreshCw, ChevronDown, ChevronUp
} from "lucide-react";
import type { Client, Provider, Service } from "@shared/schema";

interface QuickOrderForm {
  providerId: string;
  clientId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  dateSold: string;
  hasTv: boolean;
  hasMobile: boolean;
  mobileLinesQty: number;
}

const getDefaultForm = (): QuickOrderForm => ({
  providerId: "",
  clientId: "",
  serviceId: "",
  customerName: "",
  customerPhone: "",
  customerAddress: "",
  dateSold: new Date().toISOString().split("T")[0],
  hasTv: false,
  hasMobile: false,
  mobileLinesQty: 0,
});

export default function MobileOrderEntry() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<"standard" | "quick">("standard");
  const [form, setForm] = useState<QuickOrderForm>(getDefaultForm());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recentOrders, setRecentOrders] = useState<Array<{ customerName: string; provider: string; time: string }>>([]);
  const [orderCount, setOrderCount] = useState(0);

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) return [];
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

  const { data: availableServices } = useQuery<Service[]>({
    queryKey: ["/api/services/available", form.clientId, form.providerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (form.clientId) params.append("clientId", form.clientId);
      if (form.providerId) params.append("providerId", form.providerId);
      const res = await fetch(`/api/services/available?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!form.clientId && !!form.providerId,
  });

  const createOrderMutation = useMutation({
    mutationFn: async (orderData: QuickOrderForm) => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          repId: user?.repId,
          clientId: orderData.clientId || null,
          providerId: orderData.providerId || null,
          serviceId: orderData.serviceId || null,
          dateSold: orderData.dateSold,
          customerName: orderData.customerName,
          customerPhone: orderData.customerPhone || null,
          customerAddress: orderData.customerAddress || null,
          hasTv: orderData.hasTv,
          hasMobile: orderData.hasMobile,
          mobileLines: orderData.hasMobile && orderData.mobileLinesQty > 0
            ? Array(orderData.mobileLinesQty).fill({ mobileProductType: "NEW", mobilePortedStatus: "NEW" })
            : [],
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create order");
      }
      return res.json();
    },
    onSuccess: (_data, submittedForm) => {
      const providerName = providers?.find(p => p.id === submittedForm.providerId)?.name || "Unknown";
      setRecentOrders(prev => [
        { customerName: submittedForm.customerName, provider: providerName, time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 4),
      ]);
      setOrderCount(prev => prev + 1);
      
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      
      toast({
        title: "Order submitted",
        description: `Order for ${submittedForm.customerName} created successfully`,
      });
      
      if (mode === "quick") {
        setForm({
          ...getDefaultForm(),
          providerId: submittedForm.providerId,
          clientId: submittedForm.clientId,
          serviceId: submittedForm.serviceId,
        });
      } else {
        setForm(getDefaultForm());
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create order",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName || !form.providerId || !form.clientId || !form.serviceId) {
      toast({
        title: "Missing required fields",
        description: "Please fill in customer name, provider, client, and service",
        variant: "destructive",
      });
      return;
    }
    createOrderMutation.mutate(form);
  };

  const isFormValid = form.customerName && form.providerId && form.clientId && form.serviceId;

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="sticky top-0 z-50 bg-background border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">New Order</h1>
            <p className="text-xs text-muted-foreground">
              {orderCount > 0 ? `${orderCount} orders today` : "Mobile Entry"}
            </p>
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "standard" | "quick")} className="w-auto">
            <TabsList className="h-9">
              <TabsTrigger value="standard" className="text-xs px-3" data-testid="tab-standard-mode">
                <ClipboardList className="h-3.5 w-3.5 mr-1.5" />
                Standard
              </TabsTrigger>
              <TabsTrigger value="quick" className="text-xs px-3" data-testid="tab-quick-mode">
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                Quick
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {mode === "quick" && (
          <Card className="border-dashed border-primary/50 bg-primary/5">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4 text-primary" />
                <span className="font-medium">Quick Entry Mode</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Provider, client & service stay selected after each order for fast entry
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Service Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider" className="text-sm">Provider *</Label>
              <Select 
                value={form.providerId} 
                onValueChange={(v) => setForm(f => ({ ...f, providerId: v, serviceId: "" }))}
              >
                <SelectTrigger id="provider" className="h-12 text-base" data-testid="select-provider">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map(p => (
                    <SelectItem key={p.id} value={p.id} className="py-3">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="client" className="text-sm">Client *</Label>
              <Select 
                value={form.clientId} 
                onValueChange={(v) => setForm(f => ({ ...f, clientId: v, serviceId: "" }))}
              >
                <SelectTrigger id="client" className="h-12 text-base" data-testid="select-client">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map(c => (
                    <SelectItem key={c.id} value={c.id} className="py-3">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="service" className="text-sm">Service *</Label>
              <Select 
                value={form.serviceId} 
                onValueChange={(v) => setForm(f => ({ ...f, serviceId: v }))}
                disabled={!form.providerId || !form.clientId}
              >
                <SelectTrigger id="service" className="h-12 text-base" data-testid="select-service">
                  <SelectValue placeholder={!form.providerId || !form.clientId ? "Select provider & client first" : "Select service"} />
                </SelectTrigger>
                <SelectContent>
                  {availableServices?.map(s => (
                    <SelectItem key={s.id} value={s.id} className="py-3">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" />
              Customer Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customerName" className="text-sm">Customer Name *</Label>
              <Input
                id="customerName"
                value={form.customerName}
                onChange={(e) => setForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="Enter customer name"
                className="h-12 text-base"
                autoComplete="off"
                data-testid="input-customer-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customerPhone" className="text-sm flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                Phone
              </Label>
              <Input
                id="customerPhone"
                type="tel"
                value={form.customerPhone}
                onChange={(e) => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                placeholder="(555) 555-5555"
                className="h-12 text-base"
                autoComplete="off"
                data-testid="input-customer-phone"
              />
            </div>

            {mode === "standard" && (
              <div className="space-y-2">
                <Label htmlFor="customerAddress" className="text-sm flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  Address
                </Label>
                <Input
                  id="customerAddress"
                  value={form.customerAddress}
                  onChange={(e) => setForm(f => ({ ...f, customerAddress: e.target.value }))}
                  placeholder="Enter address"
                  className="h-12 text-base"
                  autoComplete="off"
                  data-testid="input-customer-address"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Order Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dateSold" className="text-sm">Date Sold</Label>
              <Input
                id="dateSold"
                type="date"
                value={form.dateSold}
                onChange={(e) => setForm(f => ({ ...f, dateSold: e.target.value }))}
                className="h-12 text-base"
                data-testid="input-date-sold"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Tv className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="hasTv" className="text-sm font-normal">TV Service</Label>
              </div>
              <Switch
                id="hasTv"
                checked={form.hasTv}
                onCheckedChange={(v) => setForm(f => ({ ...f, hasTv: v }))}
                data-testid="switch-has-tv"
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="hasMobile" className="text-sm font-normal">Mobile Service</Label>
              </div>
              <Switch
                id="hasMobile"
                checked={form.hasMobile}
                onCheckedChange={(v) => setForm(f => ({ ...f, hasMobile: v, mobileLinesQty: v ? 1 : 0 }))}
                data-testid="switch-has-mobile"
              />
            </div>

            {form.hasMobile && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="mobileLinesQty" className="text-sm">Number of Lines</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => setForm(f => ({ ...f, mobileLinesQty: Math.max(1, f.mobileLinesQty - 1) }))}
                    data-testid="button-decrease-lines"
                  >
                    -
                  </Button>
                  <span className="w-12 text-center text-lg font-semibold">{form.mobileLinesQty}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => setForm(f => ({ ...f, mobileLinesQty: f.mobileLinesQty + 1 }))}
                    data-testid="button-increase-lines"
                  >
                    +
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {mode === "standard" && (
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-between"
            onClick={() => setShowAdvanced(!showAdvanced)}
            data-testid="button-toggle-advanced"
          >
            <span className="text-sm text-muted-foreground">Advanced Options</span>
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}

        {showAdvanced && mode === "standard" && (
          <Card>
            <CardContent className="pt-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Additional fields like install date, account number, and email can be added on the full orders page.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t">
          <Button 
            type="submit" 
            className="w-full h-14 text-lg"
            disabled={!isFormValid || createOrderMutation.isPending}
            data-testid="button-submit-order"
          >
            {createOrderMutation.isPending ? (
              <>
                <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Plus className="h-5 w-5 mr-2" />
                Submit Order
              </>
            )}
          </Button>
        </div>
      </form>

      {recentOrders.length > 0 && (
        <div className="px-4 pb-24">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Recent Orders ({recentOrders.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recentOrders.map((order, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{order.customerName}</p>
                    <p className="text-xs text-muted-foreground">{order.provider}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{order.time}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
