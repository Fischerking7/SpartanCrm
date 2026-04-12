import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Download, Upload, FileSpreadsheet, DollarSign, Layers, Receipt, ArrowDownCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { PayRun } from "@shared/schema";

interface GeneratedPayStubResult {
  generated: number;
  periodStart: string;
  periodEnd: string;
  statements: Array<{
    id: string;
    userId: string;
    grossCommission: string;
    incentivesTotal: string;
    chargebacksTotal: string;
    deductionsTotal: string;
    netPay: string;
    status: string;
    user?: { name: string; repId: string };
  }>;
}

function formatCurrency(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(num);
}

export default function Accounting() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [selectedPayRunId, setSelectedPayRunId] = useState<string>("");
  const [reexportAll, setReexportAll] = useState(false);
  const [weekEndingDate, setWeekEndingDate] = useState<string>("");
  const [lastResult, setLastResult] = useState<GeneratedPayStubResult | null>(null);
  const paymentFileRef = useRef<HTMLInputElement>(null);
  const chargebackFileRef = useRef<HTMLInputElement>(null);

  const { data: payRuns } = useQuery<PayRun[]>({
    queryKey: ["/api/admin/payruns"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay runs");
      return res.json();
    },
  });

  interface PoolEntry {
    id: string;
    salesOrderId: string;
    rateCardId: string;
    amount: string;
    deductionType: "MOBILE" | "TV" | "BASE";
    status: "PENDING" | "DISTRIBUTED";
    exportBatchId: string | null;
    distributedAt: string | null;
    createdAt: string;
    invoiceNumber: string;
    repId: string;
    dateSold: string;
    rateCardName: string;
  }

  const { data: poolEntries, isLoading: poolLoading } = useQuery<PoolEntry[]>({
    queryKey: ["/api/admin/override-pool", "PENDING"],
    queryFn: async () => {
      const res = await fetch("/api/admin/override-pool?status=PENDING", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pool entries");
      return res.json();
    },
  });

  const { data: poolTotal } = useQuery<{ total: string }>({
    queryKey: ["/api/admin/override-pool/total"],
    queryFn: async () => {
      const res = await fetch("/api/admin/override-pool/total", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pool total");
      return res.json();
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (reexport: boolean) => {
      const res = await fetch("/api/admin/accounting/export-approved", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reexport }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Export failed");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: t("accounting.toasts.exportCompleted"), description: reexportAll ? t("accounting.toasts.exportAllDesc") : t("accounting.toasts.exportNewDesc") });
    },
    onError: (error: Error) => {
      toast({ title: t("accounting.toasts.exportFailed"), description: error.message, variant: "destructive" });
    },
  });

  const importPaymentsMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedPayRunId) {
        formData.append("payRunId", selectedPayRunId);
      }
      const res = await fetch("/api/admin/accounting/import-payments", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues/unmatched-payments"] });
      toast({
        title: "Payment import completed",
        description: `Matched: ${data.matched || 0}, Unmatched: ${data.unmatched || 0}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const importChargebacksMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedPayRunId) {
        formData.append("payRunId", selectedPayRunId);
      }
      const res = await fetch("/api/admin/chargebacks/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chargebacks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/queues/unmatched-chargebacks"] });
      toast({
        title: "Chargeback import completed",
        description: `Matched: ${data.matched || 0}, Unmatched: ${data.unmatched || 0}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const handlePaymentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importPaymentsMutation.mutate(file);
    }
  };

  const handleChargebackFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importChargebacksMutation.mutate(file);
    }
  };

  const generatePayStubsMutation = useMutation({
    mutationFn: async (weekEndingDate: string) => {
      const res = await fetch("/api/admin/payroll/generate-weekly-stubs", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ weekEndingDate }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to generate pay stubs");
      }
      return res.json();
    },
    onSuccess: (data: GeneratedPayStubResult) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/statements"] });
      if (data.generated > 0) {
        toast({ title: `Generated ${data.generated} pay stubs`, description: `Period: ${data.periodStart} to ${data.periodEnd}` });
      } else {
        toast({ title: "No pay stubs generated", description: "No paid orders found in this period", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: "destructive" });
    },
  });

  const downloadSingleExcel = async (statementId: string) => {
    try {
      const res = await fetch(`/api/admin/payroll/statements/${statementId}/export-excel`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to download");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pay_stub_${statementId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: t("accounting.toasts.downloadFailed"), variant: "destructive" });
    }
  };

  const exportAllPayStubsExcel = async () => {
    if (!lastResult || lastResult.statements.length === 0) return;
    
    toast({ title: "Downloading pay stubs...", description: `Exporting ${lastResult.statements.length} pay stubs` });
    
    for (const stmt of lastResult.statements) {
      await downloadSingleExcel(stmt.id);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    toast({ title: "Export complete", description: `Downloaded ${lastResult.statements.length} pay stubs` });
  };

  const exportPayStubsSummaryCSV = () => {
    if (!lastResult || lastResult.statements.length === 0) return;
    
    const headers = ["Rep Name", "Rep ID", "Period Start", "Period End", "Gross Commission", "Incentives", "Chargebacks", "Deductions", "Net Pay", "Status"];
    const rows = lastResult.statements.map((stmt) => [
      stmt.user?.name || "Unknown",
      stmt.user?.repId || stmt.userId,
      lastResult.periodStart,
      lastResult.periodEnd,
      stmt.grossCommission,
      stmt.incentivesTotal,
      stmt.chargebacksTotal,
      stmt.deductionsTotal,
      stmt.netPay,
      stmt.status
    ]);
    
    const csvContent = [headers, ...rows].map(row => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `pay-stubs-summary-${lastResult.periodEnd}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({ title: t("accounting.toasts.exportComplete"), description: t("accounting.toasts.exportCompleteDesc") });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("accounting.title")}</h1>
        <p className="text-muted-foreground">
          Export data and import payments from QuickBooks
        </p>
      </div>

      <div className="space-y-2">
        <Label>Select Pay Run (Optional)</Label>
        <Select value={selectedPayRunId || "__NONE__"} onValueChange={(v) => setSelectedPayRunId(v === "__NONE__" ? "" : v)}>
          <SelectTrigger className="w-[300px]" data-testid="select-payrun">
            <SelectValue placeholder={t("accounting.selectPayRun")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__NONE__">{t("accounting.noPayRun")}</SelectItem>
            {payRuns?.filter(pr => pr.status === "DRAFT" && pr.id).map((payRun) => (
              <SelectItem key={payRun.id} value={payRun.id}>
                Week ending {new Date(payRun.weekEndingDate).toLocaleDateString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="export">
        <TabsList>
          <TabsTrigger value="export" data-testid="tab-export">
            <Download className="h-4 w-4 mr-2" />
            Export
          </TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">
            <DollarSign className="h-4 w-4 mr-2" />
            Import Payments
          </TabsTrigger>
          <TabsTrigger value="chargebacks" data-testid="tab-chargebacks">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Import Chargebacks
          </TabsTrigger>
          <TabsTrigger value="override-pool" data-testid="tab-override-pool">
            <Layers className="h-4 w-4 mr-2" />
            Override Pool
            {poolEntries && poolEntries.length > 0 && (
              <Badge variant="secondary" className="ml-2">{poolEntries.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">
            <Receipt className="h-4 w-4 mr-2" />
            Payroll
          </TabsTrigger>
        </TabsList>

        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("accounting.exportSection")}</CardTitle>
              <CardDescription>
                Export approved orders to CSV for QuickBooks import.
                Orders will be marked as exported after download.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="reexport-toggle"
                  checked={reexportAll}
                  onCheckedChange={setReexportAll}
                  data-testid="switch-reexport"
                />
                <Label htmlFor="reexport-toggle" className="text-sm">
                  Re-export all approved orders (includes previously exported)
                </Label>
              </div>
              <Button
                onClick={() => exportMutation.mutate(reexportAll)}
                disabled={exportMutation.isPending}
                data-testid="button-export-approved"
              >
                <Download className="h-4 w-4 mr-2" />
                {exportMutation.isPending ? "Exporting..." : reexportAll ? "Re-export All Orders" : "Export New Orders"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("accounting.importQB")}</CardTitle>
              <CardDescription>
                Upload a CSV file with payment data. Payments will be matched by invoice number.
                Unmatched payments will be added to the exception queue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                type="file"
                ref={paymentFileRef}
                onChange={handlePaymentFileChange}
                accept=".csv"
                className="hidden"
                data-testid="input-payment-file"
              />
              <Button
                onClick={() => paymentFileRef.current?.click()}
                disabled={importPaymentsMutation.isPending}
                data-testid="button-import-payments"
              >
                <Upload className="h-4 w-4 mr-2" />
                {importPaymentsMutation.isPending ? "Importing..." : "Upload Payment CSV"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chargebacks">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("accounting.importChargebacks")}</CardTitle>
              <CardDescription>
                Upload a CSV file with chargeback data. Chargebacks will be matched by invoice number.
                Unmatched chargebacks will be added to the exception queue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                type="file"
                ref={chargebackFileRef}
                onChange={handleChargebackFileChange}
                accept=".csv"
                className="hidden"
                data-testid="input-chargeback-file"
              />
              <Button
                onClick={() => chargebackFileRef.current?.click()}
                disabled={importChargebacksMutation.isPending}
                data-testid="button-import-chargebacks"
              >
                <Upload className="h-4 w-4 mr-2" />
                {importChargebacksMutation.isPending ? "Importing..." : "Upload Chargeback CSV"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="override-pool">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between gap-4">
                <span>Override Deduction Pool</span>
                {poolTotal && (
                  <Badge variant="outline" className="text-base">
                    Pool Total: ${parseFloat(poolTotal.total).toFixed(2)}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Rate card override deductions pooled from approved orders. These deductions are distributed to the hierarchy after export finalization.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {poolLoading ? (
                <div className="text-muted-foreground">Loading...</div>
              ) : poolEntries && poolEntries.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Rep ID</TableHead>
                      <TableHead>Date Sold</TableHead>
                      <TableHead>Rate Card</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">{t("accounting.deduction")}</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poolEntries.map((entry) => (
                      <TableRow key={entry.id} data-testid={`row-pool-${entry.id}`}>
                        <TableCell className="font-mono">{entry.invoiceNumber}</TableCell>
                        <TableCell>{entry.repId}</TableCell>
                        <TableCell>{entry.dateSold}</TableCell>
                        <TableCell>{entry.rateCardName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            entry.deductionType === "TV" ? "border-purple-500 text-purple-600" : 
                            entry.deductionType === "BASE" ? "border-blue-500 text-blue-600" : 
                            entry.deductionType === "MOBILE" ? "border-green-500 text-green-600" :
                            "border-orange-500 text-orange-600"
                          }>
                            {entry.deductionType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${parseFloat(entry.amount).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={entry.status === "PENDING" ? "secondary" : "default"}>
                            {entry.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-muted-foreground text-center py-8">
                  No pending override deductions in pool.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  Generate Pay Stubs
                </CardTitle>
                <CardDescription>
                  Generate pay statements for all reps with paid orders in the selected week.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-end gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="weekEndingDate">{t("accounting.weekEndingDate")}</Label>
                    <Input
                      id="weekEndingDate"
                      type="date"
                      value={weekEndingDate}
                      onChange={(e) => setWeekEndingDate(e.target.value)}
                      className="w-48"
                      data-testid="input-week-ending-date"
                    />
                  </div>
                  <Button 
                    onClick={() => generatePayStubsMutation.mutate(weekEndingDate)}
                    disabled={generatePayStubsMutation.isPending || !weekEndingDate}
                    data-testid="button-generate-pay-stubs"
                  >
                    <Receipt className="h-4 w-4 mr-2" />
                    {generatePayStubsMutation.isPending ? "Generating..." : "Generate Pay Stubs"}
                  </Button>
                </div>

                {lastResult && lastResult.generated > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-medium">Generated Pay Stubs ({lastResult.generated})</h3>
                        <p className="text-sm text-muted-foreground">
                          Period: {lastResult.periodStart} to {lastResult.periodEnd}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={exportPayStubsSummaryCSV} data-testid="button-export-summary-csv">
                          <ArrowDownCircle className="h-4 w-4 mr-2" />
                          Summary CSV
                        </Button>
                        <Button variant="default" onClick={exportAllPayStubsExcel} data-testid="button-export-all-excel">
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Download All Excel
                        </Button>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rep</TableHead>
                          <TableHead>Gross Commission</TableHead>
                          <TableHead>Incentives</TableHead>
                          <TableHead>Deductions</TableHead>
                          <TableHead>Net Pay</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lastResult.statements.map((stmt) => (
                          <TableRow key={stmt.id} data-testid={`row-statement-${stmt.id}`}>
                            <TableCell>
                              <div>
                                <div className="font-medium">{stmt.user?.name || "Unknown"}</div>
                                <div className="text-xs text-muted-foreground">{stmt.user?.repId || stmt.userId}</div>
                              </div>
                            </TableCell>
                            <TableCell>{formatCurrency(stmt.grossCommission)}</TableCell>
                            <TableCell>{formatCurrency(stmt.incentivesTotal)}</TableCell>
                            <TableCell>{formatCurrency(stmt.deductionsTotal)}</TableCell>
                            <TableCell className="font-medium">{formatCurrency(stmt.netPay)}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{stmt.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                onClick={() => downloadSingleExcel(stmt.id)}
                                title="Download Excel"
                                data-testid={`button-download-excel-${stmt.id}`}
                              >
                                <FileSpreadsheet className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
