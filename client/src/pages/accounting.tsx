import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Download, Upload, FileSpreadsheet, DollarSign, Layers } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { PayRun } from "@shared/schema";

export default function Accounting() {
  const { toast } = useToast();
  const [selectedPayRunId, setSelectedPayRunId] = useState<string>("");
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
    mutationFn: async () => {
      const res = await fetch("/api/admin/accounting/export-approved", {
        method: "POST",
        headers: getAuthHeaders(),
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
      toast({ title: "Export completed", description: "Approved orders have been exported and marked." });
    },
    onError: (error: Error) => {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
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
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <p className="text-muted-foreground">
          Export data and import payments from QuickBooks
        </p>
      </div>

      <div className="space-y-2">
        <Label>Select Pay Run (Optional)</Label>
        <Select value={selectedPayRunId || "__NONE__"} onValueChange={(v) => setSelectedPayRunId(v === "__NONE__" ? "" : v)}>
          <SelectTrigger className="w-[300px]" data-testid="select-payrun">
            <SelectValue placeholder="Select a pay run for imports" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__NONE__">No Pay Run</SelectItem>
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
        </TabsList>

        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Export Approved Orders</CardTitle>
              <CardDescription>
                Export all approved, unexported orders to CSV for QuickBooks import.
                Orders will be marked as exported after download.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
                data-testid="button-export-approved"
              >
                <Download className="h-4 w-4 mr-2" />
                {exportMutation.isPending ? "Exporting..." : "Export Approved Orders"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Import Payments from QuickBooks</CardTitle>
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
              <CardTitle className="text-lg">Import Chargebacks</CardTitle>
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
                      <TableHead className="text-right">Deduction</TableHead>
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
      </Tabs>
    </div>
  );
}
