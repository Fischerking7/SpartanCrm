import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/auth";
import {
  BarChart3, TrendingUp, Clock, DollarSign, Users, FileText, Download, Play, Calendar, Loader2
} from "lucide-react";

function fmt(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtCents(cents: number | string) {
  const n = typeof cents === "string" ? parseInt(cents) : cents;
  if (isNaN(n)) return "$0.00";
  return fmt(n / 100);
}

interface ColDef {
  key: string;
  label: string;
  format?: "currency" | "cents" | "text";
  align?: "left" | "right";
}

interface ReportDef {
  id: string;
  title: string;
  description: string;
  icon: any;
  color: string;
}

const reports: ReportDef[] = [
  { id: "profit", title: "Iron Crest Profit Report", description: "Rack rate, all payouts, and margin by service and rep", icon: TrendingUp, color: "text-green-600" },
  { id: "variance", title: "Commission Variance Report", description: "Orders where payout differs from rate card", icon: BarChart3, color: "text-blue-600" },
  { id: "ar-aging", title: "AR Aging Report", description: "Open expectations by age bucket: 0-30, 30-60, 60-90, 90+ days", icon: Clock, color: "text-amber-600" },
  { id: "payroll-summary", title: "Payroll Summary", description: "Period commission totals, overrides, and profit", icon: DollarSign, color: "text-purple-600" },
  { id: "ytd-earnings", title: "YTD Earnings Summary", description: "Year-to-date commission and override totals", icon: Users, color: "text-indigo-600" },
  { id: "1099", title: "1099 Preparation", description: "Generate 1099 data for tax filing ($600 minimum threshold)", icon: FileText, color: "text-red-600" },
];

const PROFIT_COLS: ColDef[] = [
  { key: "label", label: "Metric", align: "left" },
  { key: "value", label: "Amount", align: "right" },
];

const VARIANCE_COLS: ColDef[] = [
  { key: "invoiceNumber", label: "Invoice #" },
  { key: "customerName", label: "Customer" },
  { key: "repName", label: "Rep" },
  { key: "dateSold", label: "Date Sold" },
  { key: "commissionAmount", label: "Commission", format: "currency", align: "right" },
  { key: "rackRateCents", label: "Rack Rate", format: "cents", align: "right" },
  { key: "profitCents", label: "Profit", format: "cents", align: "right" },
  { key: "arExpectedCents", label: "AR Expected", format: "cents", align: "right" },
  { key: "arActualCents", label: "AR Actual", format: "cents", align: "right" },
  { key: "arVarianceCents", label: "Variance", format: "cents", align: "right" },
  { key: "arStatus", label: "AR Status" },
];

const AR_AGING_COLS: ColDef[] = [
  { key: "invoiceNumber", label: "Invoice #" },
  { key: "customerName", label: "Customer" },
  { key: "repName", label: "Rep" },
  { key: "clientName", label: "Client" },
  { key: "serviceName", label: "Service" },
  { key: "dateSold", label: "Date Sold" },
  { key: "commission", label: "Commission", format: "currency", align: "right" },
  { key: "ageDays", label: "Age (Days)", align: "right" },
  { key: "ageBucket", label: "Bucket" },
];

const SUMMARY_COLS: ColDef[] = [
  { key: "label", label: "Metric", align: "left" },
  { key: "value", label: "Amount", align: "right" },
];

interface DisplayRow {
  [key: string]: string | number | null;
}

function formatCell(value: any, format?: string): string {
  if (value === null || value === undefined) return "—";
  if (format === "currency") return fmt(value);
  if (format === "cents") return fmtCents(value);
  return String(value);
}

function profitToRows(data: any): DisplayRow[] {
  return [
    { label: "Period", value: `${data.startDate?.split("T")[0] || ""} to ${data.endDate?.split("T")[0] || ""}` },
    { label: "Approved Orders", value: data.orderCount },
    { label: "Total Rack Rate", value: fmt(data.totalRackRate) },
    { label: "Total Rep Payout", value: fmt(data.totalRepPayout) },
    { label: "Director Overrides", value: fmt(data.totalDirectorOverride) },
    { label: "Admin Overrides", value: fmt(data.totalAdminOverride) },
    { label: "Accounting Overrides", value: fmt(data.totalAccountingOverride) },
    { label: "Iron Crest Profit", value: fmt(data.totalIronCrestProfit) },
    { label: "Profit Margin", value: `${data.profitMarginPercent}%` },
  ];
}

function summaryToRows(data: any): DisplayRow[] {
  return [
    { label: "Payroll-Ready Orders", value: data.orderCount },
    { label: "Total Commission", value: fmt(data.totalCommission) },
    { label: "Total Rack Rate", value: fmtCents(data.totalRackRate) },
    { label: "Total Profit", value: fmtCents(data.totalProfit) },
    { label: "Director Overrides", value: fmtCents(data.totalDirectorOverride) },
    { label: "Admin Overrides", value: fmtCents(data.totalAdminOverride) },
    { label: "Accounting Overrides", value: fmtCents(data.totalAccountingOverride) },
  ];
}

export default function AcctReports() {
  const { toast } = useToast();
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0],
    end: new Date().toISOString().split("T")[0],
  });
  const [reportData, setReportData] = useState<DisplayRow[] | null>(null);
  const [reportColumns, setReportColumns] = useState<ColDef[]>([]);
  const [loading, setLoading] = useState(false);

  const runReport = async () => {
    if (!selectedReport) return;
    setLoading(true);
    setReportData(null);
    try {
      const headers = getAuthHeaders();
      let rows: DisplayRow[] = [];
      let cols: ColDef[] = [];

      switch (selectedReport) {
        case "profit": {
          const url = `/api/admin/reports/iron-crest-profit?startDate=${dateRange.start}&endDate=${dateRange.end}`;
          const res = await fetch(url, { headers });
          if (!res.ok) throw new Error("Failed to fetch profit report");
          const data = await res.json();
          rows = profitToRows(data);
          cols = PROFIT_COLS;
          break;
        }
        case "variance": {
          const url = `/api/admin/accounting/variance-report?periodStart=${dateRange.start}&periodEnd=${dateRange.end}`;
          const res = await fetch(url, { headers });
          if (!res.ok) throw new Error("Failed to fetch variance report");
          const data = await res.json();
          rows = Array.isArray(data) ? data : [];
          cols = VARIANCE_COLS;
          break;
        }
        case "ar-aging": {
          const url = `/api/admin/payroll/stale-ar?days=0`;
          const res = await fetch(url, { headers });
          if (!res.ok) throw new Error("Failed to fetch AR aging report");
          const data = await res.json();
          rows = Array.isArray(data) ? data : [];
          cols = AR_AGING_COLS;
          break;
        }
        case "payroll-summary":
        case "ytd-earnings":
        case "1099": {
          const url = `/api/admin/accounting/summary?periodStart=${dateRange.start}&periodEnd=${dateRange.end}`;
          const res = await fetch(url, { headers });
          if (!res.ok) throw new Error("Failed to fetch summary");
          const data = await res.json();
          rows = summaryToRows(data);
          cols = SUMMARY_COLS;
          break;
        }
      }

      setReportColumns(cols);
      setReportData(rows);
    } catch (err: any) {
      toast({ title: "Report failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    if (!reportData || reportData.length === 0 || reportColumns.length === 0) return;

    const headers = reportColumns.map(c => c.label);
    const csvContent = [
      headers.map(h => `"${h}"`).join(","),
      ...reportData.map(row =>
        reportColumns.map(c => {
          const val = row[c.key];
          const formatted = formatCell(val, c.format);
          return `"${formatted.replace(/"/g, '""')}"`;
        }).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedReport}-report-${dateRange.start}-to-${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${reportData.length} rows` });
  };

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-reports">
      <h1 className="text-xl font-semibold">Financial Reports</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map(r => (
          <Card
            key={r.id}
            className={`cursor-pointer transition-all hover:shadow-md ${selectedReport === r.id ? "ring-2 ring-foreground" : ""}`}
            onClick={() => { setSelectedReport(r.id); setReportData(null); }}
            data-testid={`card-report-${r.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg bg-muted ${r.color}`}>
                  <r.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium">{r.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedReport && (
        <Card data-testid="card-report-runner">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {reports.find(r => r.id === selectedReport)?.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={dateRange.start} onChange={e => setDateRange(d => ({ ...d, start: e.target.value }))} className="w-40" data-testid="input-report-start" />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={dateRange.end} onChange={e => setDateRange(d => ({ ...d, end: e.target.value }))} className="w-40" data-testid="input-report-end" />
              </div>
              <Button size="sm" onClick={runReport} disabled={loading} data-testid="button-run-report">
                {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                {loading ? "Loading..." : "Run Report"}
              </Button>
              {reportData && reportData.length > 0 && (
                <Button size="sm" variant="outline" onClick={downloadCSV} data-testid="button-download-report">
                  <Download className="h-3.5 w-3.5 mr-1" /> Download CSV
                </Button>
              )}
            </div>

            {loading && <Skeleton className="h-48 w-full" />}

            {reportData && !loading && (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{reportData.length} rows</Badge>
                  <Badge variant="outline">{dateRange.start} to {dateRange.end}</Badge>
                </div>
                {reportData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No data for this period</p>
                ) : (
                  <div className="border rounded-lg overflow-x-auto max-h-[60vh]">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0 z-10">
                        <tr>
                          {reportColumns.map(col => (
                            <th
                              key={col.key}
                              className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b ${col.align === "right" ? "text-right" : "text-left"}`}
                            >
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.slice(0, 100).map((row, i) => (
                          <tr key={i} className="border-t hover:bg-muted/50">
                            {reportColumns.map(col => (
                              <td
                                key={col.key}
                                className={`px-3 py-2 text-sm whitespace-nowrap ${col.align === "right" ? "text-right font-mono" : ""}`}
                              >
                                {formatCell(row[col.key], col.format)}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {reportData.length > 100 && (
                          <tr>
                            <td colSpan={reportColumns.length} className="px-3 py-2 text-xs text-muted-foreground text-center">
                              Showing first 100 of {reportData.length} rows. Download CSV for full data.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
