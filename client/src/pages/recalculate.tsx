import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Calculator, AlertTriangle } from "lucide-react";
import type { Provider, Client } from "@shared/schema";

export default function Recalculate() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [recalculateAll, setRecalculateAll] = useState(false);

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch providers");
      return res.json();
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/recalculate-commissions", {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId: selectedProvider && selectedProvider !== "__ALL__" ? selectedProvider : undefined,
          clientId: selectedClient && selectedClient !== "__ALL__" ? selectedClient : undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          recalculateAll,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Recalculation failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/summary"] });
      toast({
        title: t("recalculate.toasts.complete"),
        description: data.message,
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("recalculate.toasts.failed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRecalculate = () => {
    if (!recalculateAll && !dateFrom && !dateTo && !selectedProvider && !selectedClient) {
      toast({
        title: t("recalculate.toasts.noFilters"),
        description: t("recalculate.toasts.noFiltersDesc"),
        variant: "destructive",
      });
      return;
    }
    recalculateMutation.mutate();
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("recalculate.title")}</h1>
        <p className="text-muted-foreground">
          {t("recalculate.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            {t("recalculate.importantTitle")}
          </CardTitle>
          <CardDescription>
            {t("recalculate.importantDesc")}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("recalculate.filterTitle")}</CardTitle>
          <CardDescription>
            {t("recalculate.filterDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <Switch
              id="recalculate-all"
              checked={recalculateAll}
              onCheckedChange={setRecalculateAll}
              data-testid="switch-recalculate-all"
            />
            <Label htmlFor="recalculate-all" className="text-base font-medium">
              {t("recalculate.recalculateAll")}
            </Label>
          </div>

          {!recalculateAll && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("recalculate.dateFrom")}</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("recalculate.dateTo")}</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="input-date-to"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("recalculate.provider")}</Label>
                <Select value={selectedProvider || "__ALL__"} onValueChange={setSelectedProvider}>
                  <SelectTrigger data-testid="select-provider">
                    <SelectValue placeholder={t("recalculate.allProviders")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ALL__">{t("recalculate.allProviders")}</SelectItem>
                    {providers?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("recalculate.client")}</Label>
                <Select value={selectedClient || "__ALL__"} onValueChange={setSelectedClient}>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder={t("recalculate.allClients")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ALL__">{t("recalculate.allClients")}</SelectItem>
                    {clients?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="pt-4 border-t">
            <Button
              onClick={handleRecalculate}
              disabled={recalculateMutation.isPending}
              size="lg"
              data-testid="button-recalculate"
            >
              <Calculator className="h-4 w-4 mr-2" />
              {recalculateMutation.isPending ? t("recalculate.recalculating") : t("recalculate.recalculate")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {recalculateMutation.data && (
        <Card>
          <CardHeader>
            <CardTitle>{t("recalculate.results")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-md bg-muted">
                <p className="text-2xl font-bold" data-testid="text-total">
                  {recalculateMutation.data.total}
                </p>
                <p className="text-sm text-muted-foreground">{t("recalculate.totalOrders")}</p>
              </div>
              <div className="text-center p-4 rounded-md bg-green-100 dark:bg-green-900/30">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-recalculated">
                  {recalculateMutation.data.recalculated}
                </p>
                <p className="text-sm text-muted-foreground">{t("recalculate.recalculated")}</p>
              </div>
              <div className="text-center p-4 rounded-md bg-red-100 dark:bg-red-900/30">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-errors">
                  {recalculateMutation.data.errors}
                </p>
                <p className="text-sm text-muted-foreground">{t("recalculate.errors")}</p>
              </div>
            </div>
            {recalculateMutation.data.errorDetails?.length > 0 && (
              <div className="mt-4">
                <p className="font-medium mb-2">{t("recalculate.errorDetails")}</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {recalculateMutation.data.errorDetails.map((error: string, i: number) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
