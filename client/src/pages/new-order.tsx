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
import { ChevronLeft, ChevronRight, Check, Loader2, CheckCircle2, Plus, List } from "lucide-react";

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
  installTime: string;
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
  installTime: "",
  notes: "",
  hasTv: false,
  hasMobile: false,
  mobileLinesQty: 1,
};

function formatCurrency(v: number) {
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STEP_LABELS = ["Customer", "Service", "Add-Ons", "Review"];

export default function NewOrder() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [successData, setSuccessData] = useState<any>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: providers } = useQuery<any[]>({ queryKey: ["/api/providers"] });
  const { data: clients } = useQuery<any[]>({ queryKey: ["/api/clients"] });
  const { data: services } = useQuery<any[]>({ queryKey: ["/api/services"] });

  const selectedService = services?.find((s: any) => s.id === formData.serviceId);

  const filteredServices = services?.filter((s: any) => {
    if (!s.active) return false;
    if (formData.providerId && s.providerId && s.providerId !== formData.providerId) return false;
    return true;
  });

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
          mobileProductType: "UNLIMITED",
          mobilePortedStatus: "NON_PORTED",
        }));
      }
      const res = await apiRequest("POST", "/api/orders", body);
      return res.json();
    },
    onSuccess: (data) => {
      setSuccessData(data);
      queryClient.invalidateQueries({ queryKey: ["/api/my/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my/orders"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const update = (field: keyof FormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const canAdvance = () => {
    if (step === 1) return !!formData.customerName.trim();
    if (step === 2) return !!formData.serviceId && !!formData.providerId;
    return true;
  };

  if (successData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" data-testid="order-success">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-6">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Order Submitted!</h1>
        {successData.invoiceNumber && (
          <p className="text-muted-foreground mb-1" data-testid="text-invoice">
            Invoice: {successData.invoiceNumber}
          </p>
        )}
        {selectedService && (
          <p className="text-[#C9A84C] font-semibold text-lg mb-6" data-testid="text-expected-commission">
            Expected Commission: {formatCurrency(parseFloat(selectedService.commissionAmount || "0"))}
          </p>
        )}
        <div className="flex gap-3 w-full max-w-xs">
          <Button
            className="flex-1 h-12 rounded-xl bg-[#C9A84C] hover:bg-[#b8973e] text-white"
            onClick={() => { setFormData(initialFormData); setStep(1); setSuccessData(null); }}
            data-testid="button-submit-another"
          >
            <Plus className="h-4 w-4 mr-1" /> Another
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-12 rounded-xl"
            onClick={() => setLocation("/my-orders")}
            data-testid="button-view-orders"
          >
            <List className="h-4 w-4 mr-1" /> My Orders
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto pb-24" data-testid="new-order-page">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => step > 1 ? setStep(step - 1) : setLocation("/")} className="p-1" data-testid="button-back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">New Order</h1>
        </div>
        <span className="text-sm text-muted-foreground">Step {step}/4</span>
      </div>

      <div className="flex gap-1 mb-6">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex-1 text-center">
            <div className={`h-1 rounded-full transition-colors mb-1 ${i + 1 <= step ? "bg-[#C9A84C]" : "bg-muted"}`} />
            <span className={`text-[10px] ${i + 1 <= step ? "text-[#C9A84C] font-medium" : "text-muted-foreground"}`}>{label}</span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4" data-testid="step-customer-info">
          <h2 className="font-semibold text-[#1B2A4A] dark:text-white">Customer Info</h2>
          <div>
            <Label htmlFor="customerName">Customer Name *</Label>
            <Input
              id="customerName"
              autoCapitalize="words"
              value={formData.customerName}
              onChange={e => update("customerName", e.target.value)}
              placeholder="Full name"
              className="h-12 text-base rounded-lg"
              data-testid="input-customer-name"
            />
          </div>
          <div>
            <Label htmlFor="customerPhone">Phone</Label>
            <Input
              id="customerPhone"
              type="tel"
              inputMode="numeric"
              value={formData.customerPhone}
              onChange={e => update("customerPhone", formatPhone(e.target.value))}
              placeholder="(555) 555-5555"
              className="h-12 text-base rounded-lg"
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
              className="h-12 text-base rounded-lg"
              data-testid="input-customer-email"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="houseNumber">House #</Label>
              <Input id="houseNumber" value={formData.houseNumber} onChange={e => update("houseNumber", e.target.value)} className="h-12 rounded-lg" data-testid="input-house-number" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="streetName">Street</Label>
              <Input id="streetName" value={formData.streetName} onChange={e => update("streetName", e.target.value)} className="h-12 rounded-lg" data-testid="input-street" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="aptUnit">Apt/Unit</Label>
              <Input id="aptUnit" value={formData.aptUnit} onChange={e => update("aptUnit", e.target.value)} className="h-12 rounded-lg" data-testid="input-apt" />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" value={formData.city} onChange={e => update("city", e.target.value)} className="h-12 rounded-lg" data-testid="input-city" />
            </div>
            <div>
              <Label htmlFor="zipCode">Zip</Label>
              <Input id="zipCode" inputMode="numeric" value={formData.zipCode} onChange={e => update("zipCode", e.target.value)} className="h-12 rounded-lg" data-testid="input-zip" />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4" data-testid="step-service">
          <h2 className="font-semibold text-[#1B2A4A] dark:text-white">Service Selection</h2>

          {clients && clients.length > 1 && (
            <div>
              <Label>Client</Label>
              <Select value={formData.clientId} onValueChange={v => update("clientId", v)}>
                <SelectTrigger className="h-12 rounded-lg" data-testid="select-client">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Provider</Label>
            <Select value={formData.providerId} onValueChange={v => { update("providerId", v); update("serviceId", ""); }}>
              <SelectTrigger className="h-12 rounded-lg" data-testid="select-provider">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers?.filter((p: any) => p.active).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Service / Speed *</Label>
            {!filteredServices?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {formData.providerId ? "No services for this provider" : "Select a provider first"}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {filteredServices.map((s: any) => {
                  const isSelected = formData.serviceId === s.id;
                  const commission = parseFloat(s.commissionAmount || s.baseCommission || "0");
                  return (
                    <button
                      key={s.id}
                      onClick={() => update("serviceId", s.id)}
                      className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                        isSelected
                          ? "border-[#C9A84C] bg-[#C9A84C]/5 shadow-sm"
                          : "border-border hover:border-[#C9A84C]/40"
                      }`}
                      data-testid={`service-card-${s.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{s.name}</p>
                          {s.speed && <p className="text-xs text-muted-foreground">{s.speed}</p>}
                        </div>
                        {commission > 0 && (
                          <span className="text-[#C9A84C] font-bold text-lg" data-testid={`commission-${s.id}`}>
                            {formatCurrency(commission)}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="mt-2">
                          <Check className="h-4 w-4 text-[#C9A84C]" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dateSold">Date Sold</Label>
              <Input
                id="dateSold"
                type="date"
                value={formData.dateSold}
                onChange={e => update("dateSold", e.target.value)}
                className="h-12 rounded-lg"
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
                className="h-12 rounded-lg"
                data-testid="input-install-date"
              />
            </div>
          </div>

          {formData.installDate && (
            <div>
              <Label htmlFor="installTime">Install Time</Label>
              <Input
                id="installTime"
                type="time"
                value={formData.installTime}
                onChange={e => update("installTime", e.target.value)}
                className="h-12 rounded-lg"
                data-testid="input-install-time"
              />
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5" data-testid="step-addons">
          <h2 className="font-semibold text-[#1B2A4A] dark:text-white">Add-Ons</h2>
          <button
            onClick={() => update("hasTv", !formData.hasTv)}
            className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all ${
              formData.hasTv ? "border-[#C9A84C] bg-[#C9A84C]/5" : "border-border"
            }`}
            data-testid="toggle-tv"
          >
            <div>
              <p className="font-medium text-base">TV Service</p>
              <p className="text-sm text-muted-foreground">Add TV to this order</p>
            </div>
            <div className={`w-12 h-7 rounded-full transition-colors flex items-center px-0.5 ${
              formData.hasTv ? "bg-[#C9A84C]" : "bg-muted"
            }`}>
              <div className={`w-6 h-6 rounded-full bg-white shadow transition-transform ${
                formData.hasTv ? "translate-x-5" : "translate-x-0"
              }`} />
            </div>
          </button>

          <button
            onClick={() => update("hasMobile", !formData.hasMobile)}
            className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all ${
              formData.hasMobile ? "border-[#C9A84C] bg-[#C9A84C]/5" : "border-border"
            }`}
            data-testid="toggle-mobile"
          >
            <div>
              <p className="font-medium text-base">Mobile Service</p>
              <p className="text-sm text-muted-foreground">Add mobile lines</p>
            </div>
            <div className={`w-12 h-7 rounded-full transition-colors flex items-center px-0.5 ${
              formData.hasMobile ? "bg-[#C9A84C]" : "bg-muted"
            }`}>
              <div className={`w-6 h-6 rounded-full bg-white shadow transition-transform ${
                formData.hasMobile ? "translate-x-5" : "translate-x-0"
              }`} />
            </div>
          </button>

          {formData.hasMobile && (
            <div className="bg-muted/30 rounded-2xl p-5">
              <Label className="text-sm font-medium mb-3 block">Number of Lines: {formData.mobileLinesQty}</Label>
              <input
                type="range"
                min={1}
                max={5}
                value={formData.mobileLinesQty}
                onChange={e => update("mobileLinesQty", parseInt(e.target.value))}
                className="w-full accent-[#C9A84C]"
                data-testid="slider-mobile-lines"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                {[1,2,3,4,5].map(n => <span key={n}>{n}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4" data-testid="step-review">
          <h2 className="font-semibold text-[#1B2A4A] dark:text-white">Review Order</h2>
          <Card className="rounded-2xl">
            <CardContent className="p-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p className="font-medium">{formData.customerName}</p>
                {formData.customerPhone && <p className="text-sm text-muted-foreground">{formData.customerPhone}</p>}
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
                  <p className="text-sm">{selectedService?.name || "—"}</p>
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
                    <p className="text-sm">{formData.installDate}{formData.installTime ? ` ${formData.installTime}` : ""}</p>
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

          <Card className="rounded-2xl border-[#C9A84C]/30 bg-[#C9A84C]/5" data-testid="commission-summary">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-[#C9A84C] uppercase tracking-wide mb-3">Commission Summary</p>
              {selectedService && (
                <div className="flex justify-between text-sm mb-1">
                  <span>Base ({selectedService.name})</span>
                  <span className="font-medium">{formatCurrency(parseFloat(selectedService.commissionAmount || selectedService.baseCommission || "0"))}</span>
                </div>
              )}
              {formData.hasTv && (
                <div className="flex justify-between text-sm mb-1">
                  <span>TV Add-on</span>
                  <span className="font-medium">{formatCurrency(50.00)}</span>
                </div>
              )}
              {formData.hasMobile && (
                <div className="flex justify-between text-sm mb-1">
                  <span>Mobile ({formData.mobileLinesQty}x)</span>
                  <span className="font-medium">{formatCurrency(formData.mobileLinesQty * 45.00)}</span>
                </div>
              )}
              <div className="border-t border-[#C9A84C]/20 mt-3 pt-3 flex justify-between">
                <span className="font-bold">TOTAL</span>
                <span className="font-bold text-lg text-[#C9A84C]" data-testid="text-total-commission">
                  {formatCurrency(
                    parseFloat(selectedService?.commissionAmount || selectedService?.baseCommission || "0") +
                    (formData.hasTv ? 50 : 0) +
                    (formData.hasMobile ? formData.mobileLinesQty * 45 : 0)
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t safe-area-bottom z-40">
        {step < 4 ? (
          <Button
            className="w-full h-14 text-base rounded-2xl bg-[#1B2A4A] hover:bg-[#152238] text-white"
            disabled={!canAdvance()}
            onClick={() => setStep(step + 1)}
            data-testid="button-next-step"
          >
            Next
            <ChevronRight className="h-5 w-5 ml-2" />
          </Button>
        ) : (
          <Button
            className="w-full h-14 text-base rounded-2xl bg-[#C9A84C] hover:bg-[#b8973e] text-white font-semibold"
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
