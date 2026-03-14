import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Check, Loader2 } from "lucide-react";

interface FormData {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  houseNumber: string;
  streetName: string;
  aptUnit: string;
  city: string;
  zipCode: string;
  clientId: string;
  providerId: string;
  serviceId: string;
  dateSold: string;
  installDate: string;
  notes: string;
  hasTv: boolean;
  hasMobile: boolean;
  mobileLinesQty: number;
}

const initialFormData: FormData = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  houseNumber: "",
  streetName: "",
  aptUnit: "",
  city: "",
  zipCode: "",
  clientId: "",
  providerId: "",
  serviceId: "",
  dateSold: new Date().toISOString().split("T")[0],
  installDate: "",
  notes: "",
  hasTv: false,
  hasMobile: false,
  mobileLinesQty: 1,
};

export default function NewOrder() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: providers } = useQuery<any[]>({ queryKey: ["/api/providers"] });
  const { data: clients } = useQuery<any[]>({ queryKey: ["/api/clients"] });
  const { data: services } = useQuery<any[]>({ queryKey: ["/api/services"] });

  const selectedService = services?.find((s: any) => s.id === formData.serviceId);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        customerName: formData.customerName,
        customerPhone: formData.customerPhone || undefined,
        customerEmail: formData.customerEmail || undefined,
        houseNumber: formData.houseNumber || undefined,
        streetName: formData.streetName || undefined,
        aptUnit: formData.aptUnit || undefined,
        city: formData.city || undefined,
        zipCode: formData.zipCode || undefined,
        clientId: formData.clientId,
        providerId: formData.providerId,
        serviceId: formData.serviceId,
        dateSold: formData.dateSold,
        installDate: formData.installDate || undefined,
        notes: formData.notes || undefined,
        hasTv: formData.hasTv,
        hasMobile: formData.hasMobile,
        tvSold: formData.hasTv,
        mobileSold: formData.hasMobile,
      };
      if (formData.hasMobile && formData.mobileLinesQty > 0) {
        body.mobileLines = Array.from({ length: formData.mobileLinesQty }, () => ({
          mobileProductType: "POSTPAID",
          mobilePortedStatus: "NEW",
        }));
      }
      const res = await apiRequest("POST", "/api/orders", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Order submitted!", description: "Your order has been created." });
      queryClient.invalidateQueries({ queryKey: ["/api/my/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my/orders"] });
      setLocation("/");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const update = (field: keyof FormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const canAdvance = () => {
    if (step === 1) return !!formData.customerName.trim();
    if (step === 2) return !!formData.clientId && !!formData.providerId && !!formData.serviceId;
    return true;
  };

  return (
    <div className="p-4 max-w-lg mx-auto pb-24" data-testid="new-order-page">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => step > 1 ? setStep(step - 1) : setLocation("/")} className="p-1" data-testid="button-back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">New Order</h1>
          <div className="flex gap-1 mt-2">
            {[1, 2, 3, 4].map(s => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? "bg-foreground" : "bg-muted"}`}
              />
            ))}
          </div>
        </div>
        <span className="text-sm text-muted-foreground">Step {step}/4</span>
      </div>

      {step === 1 && (
        <div className="space-y-4" data-testid="step-customer-info">
          <h2 className="font-semibold">Customer Info</h2>
          <div>
            <Label htmlFor="customerName">Customer Name *</Label>
            <Input
              id="customerName"
              autoCapitalize="words"
              value={formData.customerName}
              onChange={e => update("customerName", e.target.value)}
              placeholder="Full name"
              className="h-12 text-base"
              data-testid="input-customer-name"
            />
          </div>
          <div>
            <Label htmlFor="customerPhone">Phone</Label>
            <Input
              id="customerPhone"
              type="tel"
              value={formData.customerPhone}
              onChange={e => update("customerPhone", e.target.value)}
              placeholder="(555) 555-5555"
              className="h-12 text-base"
              data-testid="input-customer-phone"
            />
          </div>
          <div>
            <Label htmlFor="customerEmail">Email</Label>
            <Input
              id="customerEmail"
              type="email"
              value={formData.customerEmail}
              onChange={e => update("customerEmail", e.target.value)}
              placeholder="email@example.com"
              className="h-12 text-base"
              data-testid="input-customer-email"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="houseNumber">#</Label>
              <Input id="houseNumber" value={formData.houseNumber} onChange={e => update("houseNumber", e.target.value)} className="h-12" data-testid="input-house-number" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="streetName">Street</Label>
              <Input id="streetName" value={formData.streetName} onChange={e => update("streetName", e.target.value)} className="h-12" data-testid="input-street" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="aptUnit">Apt</Label>
              <Input id="aptUnit" value={formData.aptUnit} onChange={e => update("aptUnit", e.target.value)} className="h-12" data-testid="input-apt" />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={formData.city} onChange={e => update("city", e.target.value)} className="h-12" data-testid="input-city" />
            </div>
            <div>
              <Label htmlFor="zipCode">Zip</Label>
              <Input id="zipCode" value={formData.zipCode} onChange={e => update("zipCode", e.target.value)} className="h-12" data-testid="input-zip" />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4" data-testid="step-order-details">
          <h2 className="font-semibold">Order Details</h2>
          <div>
            <Label>Client *</Label>
            <Select value={formData.clientId} onValueChange={v => update("clientId", v)}>
              <SelectTrigger className="h-12" data-testid="select-client">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Provider *</Label>
            <Select value={formData.providerId} onValueChange={v => update("providerId", v)}>
              <SelectTrigger className="h-12" data-testid="select-provider">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers?.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Service / Speed *</Label>
            <Select value={formData.serviceId} onValueChange={v => update("serviceId", v)}>
              <SelectTrigger className="h-12" data-testid="select-service">
                <SelectValue placeholder="Select service" />
              </SelectTrigger>
              <SelectContent>
                {services?.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dateSold">Date Sold</Label>
              <Input
                id="dateSold"
                type="date"
                value={formData.dateSold}
                onChange={e => update("dateSold", e.target.value)}
                className="h-12"
                data-testid="input-date-sold"
              />
            </div>
            <div>
              <Label htmlFor="installDate">Install Date</Label>
              <Input
                id="installDate"
                type="date"
                value={formData.installDate}
                onChange={e => update("installDate", e.target.value)}
                className="h-12"
                data-testid="input-install-date"
              />
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5" data-testid="step-addons">
          <h2 className="font-semibold">Add-Ons</h2>
          <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50">
            <div>
              <p className="font-medium">TV Service</p>
              <p className="text-sm text-muted-foreground">Add TV to this order</p>
            </div>
            <Switch
              checked={formData.hasTv}
              onCheckedChange={v => update("hasTv", v)}
              data-testid="switch-tv"
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50">
              <div>
                <p className="font-medium">Mobile Service</p>
                <p className="text-sm text-muted-foreground">Add mobile lines</p>
              </div>
              <Switch
                checked={formData.hasMobile}
                onCheckedChange={v => update("hasMobile", v)}
                data-testid="switch-mobile"
              />
            </div>
            {formData.hasMobile && (
              <div className="pl-4">
                <Label htmlFor="mobileLinesQty">Number of Lines</Label>
                <div className="flex items-center gap-3 mt-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12"
                    onClick={() => update("mobileLinesQty", Math.max(1, formData.mobileLinesQty - 1))}
                    data-testid="button-lines-minus"
                  >-</Button>
                  <span className="text-2xl font-bold w-8 text-center">{formData.mobileLinesQty}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12"
                    onClick={() => update("mobileLinesQty", Math.min(10, formData.mobileLinesQty + 1))}
                    data-testid="button-lines-plus"
                  >+</Button>
                </div>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={formData.notes}
              onChange={e => update("notes", e.target.value)}
              placeholder="Optional notes"
              className="h-12"
              data-testid="input-notes"
            />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4" data-testid="step-review">
          <h2 className="font-semibold">Review Order</h2>
          <Card className="rounded-xl">
            <CardContent className="p-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p className="font-medium">{formData.customerName}</p>
                {formData.customerPhone && <p className="text-sm">{formData.customerPhone}</p>}
              </div>
              {formData.streetName && (
                <div>
                  <p className="text-xs text-muted-foreground">Address</p>
                  <p className="text-sm">
                    {formData.houseNumber} {formData.streetName}
                    {formData.aptUnit ? `, Apt ${formData.aptUnit}` : ""}
                    {formData.city ? `, ${formData.city}` : ""}
                    {formData.zipCode ? ` ${formData.zipCode}` : ""}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="text-sm">{providers?.find((p: any) => p.id === formData.providerId)?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Service</p>
                  <p className="text-sm">{services?.find((s: any) => s.id === formData.serviceId)?.name || "—"}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Date Sold</p>
                  <p className="text-sm">{formData.dateSold}</p>
                </div>
                {formData.installDate && (
                  <div>
                    <p className="text-xs text-muted-foreground">Install Date</p>
                    <p className="text-sm">{formData.installDate}</p>
                  </div>
                )}
              </div>
              {(formData.hasTv || formData.hasMobile) && (
                <div>
                  <p className="text-xs text-muted-foreground">Add-ons</p>
                  <p className="text-sm">
                    {[formData.hasTv && "TV", formData.hasMobile && `Mobile (${formData.mobileLinesQty} line${formData.mobileLinesQty > 1 ? "s" : ""})`].filter(Boolean).join(", ")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom z-40">
        {step < 4 ? (
          <Button
            className="w-full h-14 text-base rounded-xl"
            disabled={!canAdvance()}
            onClick={() => setStep(step + 1)}
            data-testid="button-next-step"
          >
            Continue
            <ChevronRight className="h-5 w-5 ml-2" />
          </Button>
        ) : (
          <Button
            className="w-full h-14 text-base rounded-xl"
            disabled={submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
            data-testid="button-submit-order"
          >
            {submitMutation.isPending ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Submitting...</>
            ) : (
              <><Check className="h-5 w-5 mr-2" /> Submit Order</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
