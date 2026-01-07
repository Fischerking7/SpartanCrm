import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { FileSpreadsheet, Eye, Calendar, User, Hash } from "lucide-react";
import type { SalesOrder, ExportBatch } from "@shared/schema";

interface ExportBatchWithCreator extends ExportBatch {
  creatorName?: string;
}

export default function ExportHistory() {
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

  const { data: batches, isLoading: batchesLoading } = useQuery<ExportBatchWithCreator[]>({
    queryKey: ["/api/admin/accounting/export-batches"],
    queryFn: async () => {
      const res = await fetch("/api/admin/accounting/export-batches", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch export batches");
      return res.json();
    },
  });

  const { data: batchDetails, isLoading: detailsLoading } = useQuery<{ batch: ExportBatch; orders: SalesOrder[] }>({
    queryKey: ["/api/admin/accounting/export-batches", selectedBatch],
    queryFn: async () => {
      const res = await fetch(`/api/admin/accounting/export-batches/${selectedBatch}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch batch details");
      return res.json();
    },
    enabled: !!selectedBatch,
  });

  const columns = [
    {
      key: "createdAt",
      header: "Export Date",
      cell: (batch: ExportBatchWithCreator) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
          <span className="text-muted-foreground text-sm">
            {new Date(batch.createdAt).toLocaleTimeString()}
          </span>
        </div>
      ),
    },
    {
      key: "id",
      header: "Batch ID",
      cell: (batch: ExportBatchWithCreator) => (
        <span className="font-mono text-sm">{batch.id.slice(0, 8)}</span>
      ),
    },
    {
      key: "recordCount",
      header: "Records",
      cell: (batch: ExportBatchWithCreator) => (
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <Badge variant="secondary">{batch.recordCount}</Badge>
        </div>
      ),
    },
    {
      key: "fileName",
      header: "File Name",
      cell: (batch: ExportBatchWithCreator) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {batch.fileName || "-"}
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      cell: (batch: ExportBatchWithCreator) => (
        <span className="text-sm text-muted-foreground truncate max-w-[150px] block">
          {batch.notes || "-"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (batch: ExportBatchWithCreator) => (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setSelectedBatch(batch.id)}
          data-testid={`button-view-batch-${batch.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const orderColumns = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      cell: (order: SalesOrder) => (
        <span className="font-mono text-sm">{order.invoiceNumber || "-"}</span>
      ),
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (order: SalesOrder) => order.customerName,
    },
    {
      key: "repId",
      header: "Rep ID",
      cell: (order: SalesOrder) => (
        <span className="font-mono text-sm">{order.repId}</span>
      ),
    },
    {
      key: "dateSold",
      header: "Date Sold",
      cell: (order: SalesOrder) => new Date(order.dateSold).toLocaleDateString(),
    },
    {
      key: "commission",
      header: "Commission",
      cell: (order: SalesOrder) => (
        <span className="font-mono">
          ${(parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned)).toFixed(2)}
        </span>
      ),
    },
    {
      key: "exportedAt",
      header: "Exported At",
      cell: (order: SalesOrder) => (
        order.exportedAt ? new Date(order.exportedAt).toLocaleDateString() : "-"
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Export History</h1>
        <p className="text-muted-foreground">
          View past accounting exports and their included orders
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Export Batches
          </CardTitle>
          <CardDescription>
            Each export batch contains approved orders that were exported to QuickBooks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={batches || []}
            isLoading={batchesLoading}
            emptyMessage="No export batches yet. Export approved orders from the Orders page."
            testId="table-export-batches"
          />
        </CardContent>
      </Card>

      <Dialog open={!!selectedBatch} onOpenChange={() => setSelectedBatch(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Export Batch Details</DialogTitle>
            <DialogDescription>
              {batchDetails?.batch ? (
                <>
                  Exported on {new Date(batchDetails.batch.createdAt).toLocaleString()} - 
                  {batchDetails.batch.recordCount} orders
                </>
              ) : "Loading..."}
            </DialogDescription>
          </DialogHeader>
          {detailsLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading orders...</div>
          ) : batchDetails?.orders ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground">Batch ID</Label>
                  <p className="font-mono text-sm">{batchDetails.batch.id.slice(0, 12)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Total Orders</Label>
                  <p className="font-semibold">{batchDetails.batch.recordCount}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Total Commission</Label>
                  <p className="font-mono font-semibold">
                    ${batchDetails.orders.reduce((sum, o) => 
                      sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0
                    ).toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="border-t pt-4">
                <Label className="text-muted-foreground mb-2 block">Included Orders</Label>
                <DataTable
                  columns={orderColumns}
                  data={batchDetails.orders}
                  isLoading={false}
                  emptyMessage="No orders in this batch"
                  testId="table-batch-orders"
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
