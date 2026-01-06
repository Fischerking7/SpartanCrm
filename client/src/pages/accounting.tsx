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
import { Download, Upload, FileSpreadsheet, DollarSign } from "lucide-react";
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
        <Select value={selectedPayRunId} onValueChange={setSelectedPayRunId}>
          <SelectTrigger className="w-[300px]" data-testid="select-payrun">
            <SelectValue placeholder="Select a pay run for imports" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No Pay Run</SelectItem>
            {payRuns?.filter(pr => pr.status === "DRAFT").map((payRun) => (
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
      </Tabs>
    </div>
  );
}
