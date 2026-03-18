import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/auth";
import {
  FileText, Download, Play, BarChart3, Loader2
} from "lucide-react";

const reportTypes = [
  { value: "production", label: "Production Report" },
  { value: "commission", label: "Commission Summary" },
  { value: "iron-crest-profit", label: "Iron Crest Profit" },
  { value: "rep-performance", label: "Rep Performance" },
  { value: "order-status", label: "Order Status Breakdown" },
  { value: "approval-turnaround", label: "Approval Turnaround" },
];

interface ColDef {
  key: string;
  label: string;
}

interface DisplayRow {
  [key: string]: string | number | null;
}

const ORDER_COLUMNS: ColDef[] = [
  { key: "repId", label: "Rep ID" },
  { key: "repName", label: "Rep Name" },
  { key: "customerName", label: "Customer" },
  { key: "accountNumber", label: "Account #" },
  { key: "serviceName", label: "Service" },
  { key: "providerName", label: "Provider" },
  { key: "clientName", label: "Client" },
  { key: "dateSold", label: "Date Sold" },
  { key: "installDate", label: "Install Date" },
  { key: "jobStatus", label: "Job Status" },
  { key: "approvalStatus", label: "Approval" },
  { key: "paymentStatus", label: "Payment" },
  { key: "baseCommission", label: "Base Comm." },
  { key: "incentive", label: "Incentive" },
  { key: "totalCommission", label: "Total Comm." },
];

function toDetailRows(orders: any[]): DisplayRow[] {
  return orders.map(o => ({
    repId: o.repId || "",
    repName: o.repName || o.repId || "",
    customerName: o.customerName || "",
    accountNumber: o.accountNumber || "",
    serviceName: o.serviceName || o.serviceId || "",
    providerName: o.providerName || o.providerId || "",
    clientName: o.clientName || o.clientId || "",
    dateSold: o.dateSold || "",
    installDate: o.installDate ? String(o.installDate).split("T")[0] : "",
    jobStatus: o.jobStatus || "",
    approvalStatus: o.approvalStatus || "",
    paymentStatus: o.paymentStatus || "",
    baseCommission: parseFloat(o.baseCommissionEarned || "0").toFixed(2),
    incentive: parseFloat(o.incentiveEarned || "0").toFixed(2),
    totalCommission: (parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0")).toFixed(2),
  }));
}

function aggregateByRep(orders: any[]): { rows: DisplayRow[]; cols: ColDef[] } {
  const map = new Map<string, { repId: string; repName: string; count: number; totalComm: number }>();
  for (const o of orders) {
    const rid = o.repId || "";
    const existing = map.get(rid) || { repId: rid, repName: o.repName || rid, count: 0, totalComm: 0 };
    existing.count++;
    existing.totalComm += parseFloat(o.baseCommissionEarned || "0") + parseFloat(o.incentiveEarned || "0");
    map.set(rid, existing);
  }
  return {
    cols: [
      { key: "repId", label: "Rep ID" },
      { key: "repName", label: "Rep Name" },
      { key: "totalOrders", label: "Total Orders" },
      { key: "totalCommission", label: "Total Commission" },
      { key: "avgCommission", label: "Avg Commission" },
    ],
    rows: Array.from(map.values()).map(r => ({
      repId: r.repId,
      repName: r.repName,
      totalOrders: r.count,
      totalCommission: `$${r.totalComm.toFixed(2)}`,
      avgCommission: `$${(r.count > 0 ? r.totalComm / r.count : 0).toFixed(2)}`,
    })),
  };
}

function aggregateCommission(orders: any[]): { rows: DisplayRow[]; cols: ColDef[] } {
  const map = new Map<string, { repId: string; repName: string; orders: number; base: number; incentive: number; total: number }>();
  for (const o of orders) {
    const rid = o.repId || "";
    const existing = map.get(rid) || { repId: rid, repName: o.repName || rid, orders: 0, base: 0, incentive: 0, total: 0 };
    existing.orders++;
    const b = parseFloat(o.baseCommissionEarned || "0");
    const inc = parseFloat(o.incentiveEarned || "0");
    existing.base += b;
    existing.incentive += inc;
    existing.total += b + inc;
    map.set(rid, existing);
  }
  return {
    cols: [
      { key: "repId", label: "Rep ID" },
      { key: "repName", label: "Rep Name" },
      { key: "orders", label: "Orders" },
      { key: "base", label: "Base Commission" },
      { key: "incentive", label: "Incentive" },
      { key: "total", label: "Total Commission" },
    ],
    rows: Array.from(map.values()).map(r => ({
      repId: r.repId,
      repName: r.repName,
      orders: r.orders,
      base: `$${r.base.toFixed(2)}`,
      incentive: `$${r.incentive.toFixed(2)}`,
      total: `$${r.total.toFixed(2)}`,
    })),
  };
}

function aggregateOrderStatus(orders: any[]): { rows: DisplayRow[]; cols: ColDef[] } {
  const map = new Map<string, number>();
  for (const o of orders) {
    const status = o.jobStatus || "Unknown";
    map.set(status, (map.get(status) || 0) + 1);
  }
  const total = orders.length;
  return {
    cols: [
      { key: "jobStatus", label: "Job Status" },
      { key: "count", label: "Count" },
      { key: "percentage", label: "Percentage" },
    ],
    rows: Array.from(map.entries()).map(([status, count]) => ({
      jobStatus: status,
      count,
      percentage: `${((count / total) * 100).toFixed(1)}%`,
    })),
  };
}

function buildReport(type: string, orders: any[]): { rows: DisplayRow[]; cols: ColDef[] } {
  switch (type) {
    case "rep-performance":
      return aggregateByRep(orders);
    case "commission":
      return aggregateCommission(orders);
    case "order-status":
      return aggregateOrderStatus(orders);
    default:
      return { rows: toDetailRows(orders), cols: ORDER_COLUMNS };
  }
}

export default function OpsReports() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState("production");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [previewData, setPreviewData] = useState<DisplayRow[] | null>(null);
  const [previewColumns, setPreviewColumns] = useState<ColDef[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchOrders = useCallback(async (limit?: number) => {
    const url = `/api/orders?from=${dateFrom}&to=${dateTo}${limit ? `&limit=${limit}` : ""}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Failed to fetch orders");
    const data = await res.json();
    return Array.isArray(data) ? data : data.orders || [];
  }, [dateFrom, dateTo]);

  const fetchProfitReport = useCallback(async () => {
    const url = `/api/admin/reports/iron-crest-profit?from=${dateFrom}&to=${dateTo}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error("Failed to fetch report");
    return res.json();
  }, [dateFrom, dateTo]);

  const runReport = useCallback(async (type: string, limit?: number) => {
    if (type === "iron-crest-profit") {
      const data = await fetchProfitReport();
      const rows: DisplayRow[] = Array.isArray(data) ? data : [data];
      const cols = rows.length > 0
        ? Object.keys(rows[0]).map(k => ({
            key: k,
            label: k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()),
          }))
        : [];
      return { rows, cols };
    }
    const orders = await fetchOrders(limit);
    return buildReport(type, orders);
  }, [fetchOrders, fetchProfitReport]);

  const handlePreview = useCallback(async (overrideType?: string) => {
    const type = overrideType || reportType;
    setIsLoading(true);
    try {
      const { rows, cols } = await runReport(type, 50);
      setPreviewColumns(cols);
      setPreviewData(rows);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [reportType, runReport, toast]);

  const handleDownload = useCallback(async () => {
    try {
      const { rows, cols } = await runReport(reportType, 10000);

      if (rows.length === 0) {
        toast({ title: "No data to export" });
        return;
      }

      const headers = cols.map(c => c.label);
      const csvContent = [
        headers.map(h => `"${h}"`).join(","),
        ...rows.map(row =>
          cols.map(c => {
            const val = row[c.key];
            if (val === null || val === undefined) return "";
            const str = String(val);
            return `"${str.replace(/"/g, '""')}"`;
          }).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${reportType}-${dateFrom}-${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: `Exported ${rows.length} rows` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  }, [reportType, dateFrom, dateTo, runReport, toast]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6" data-testid="ops-reports">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <BarChart3 className="h-6 w-6" /> Reports
      </h1>

      <Card data-testid="report-builder">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Report Builder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger data-testid="select-report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reportTypes.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>From Date</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="input-date-from" />
            </div>

            <div className="space-y-2">
              <Label>To Date</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="input-date-to" />
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={() => handlePreview()} disabled={isLoading} data-testid="btn-preview">
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              {isLoading ? "Loading..." : "Preview"}
            </Button>
            <Button variant="outline" onClick={handleDownload} data-testid="btn-download-csv">
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {previewData && (
        <Card data-testid="preview-results">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                {reportTypes.find(r => r.value === reportType)?.label} — {previewData.length} rows
              </CardTitle>
              <Badge variant="secondary">{dateFrom} to {dateTo}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {previewData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No data for this period</p>
            ) : (
              <div className="border rounded-lg overflow-auto max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      {previewColumns.map(col => (
                        <th key={col.key} className="text-left px-3 py-2 font-medium whitespace-nowrap border-b">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((row, i) => (
                      <tr key={i} className="border-t hover:bg-muted/50">
                        {previewColumns.map(col => (
                          <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                            {row[col.key] === null || row[col.key] === undefined ? "—" : String(row[col.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="saved-reports">
        <CardHeader>
          <CardTitle>Quick Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "MTD Production", type: "production", desc: "Month-to-date sales and commissions" },
              { label: "Iron Crest Profit", type: "iron-crest-profit", desc: "Profit margins and override breakdown" },
              { label: "Rep Performance", type: "rep-performance", desc: "Rep-level sales metrics" },
            ].map(report => (
              <Card key={report.type} className="hover:border-foreground/30 transition-colors cursor-pointer"
                onClick={() => { setReportType(report.type); handlePreview(report.type); }}
              >
                <CardContent className="p-4">
                  <h3 className="font-medium">{report.label}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{report.desc}</p>
                  <Button size="sm" variant="outline" className="mt-3" data-testid={`btn-quick-${report.type}`}>
                    <Play className="h-3 w-3 mr-1" /> Run
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
