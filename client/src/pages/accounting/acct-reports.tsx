import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getAuthHeaders } from "@/lib/auth";
import {
  BarChart3, TrendingUp, Clock, DollarSign, Users, FileText, Download, Play, Calendar
} from "lucide-react";

function fmt(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
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
  { id: "payroll-summary", title: "Payroll Summary", description: "Period over period comparison by rep, service, and pay run", icon: DollarSign, color: "text-purple-600" },
  { id: "ytd-earnings", title: "YTD Earnings by Rep", description: "All reps, full year, all payment components", icon: Users, color: "text-indigo-600" },
  { id: "1099", title: "1099 Preparation", description: "Generate 1099 data for tax filing ($600 minimum threshold)", icon: FileText, color: "text-red-600" },
];

export default function AcctReports() {
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0],
    end: new Date().toISOString().split("T")[0],
  });
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runReport = async () => {
    setLoading(true);
    setReportData(null);
    try {
      let url = "";
      const headers = getAuthHeaders();
      switch (selectedReport) {
        case "profit":
          url = `/api/admin/reports/iron-crest-profit?startDate=${dateRange.start}&endDate=${dateRange.end}`;
          break;
        case "variance":
          url = `/api/admin/accounting/variance-report?periodStart=${dateRange.start}&periodEnd=${dateRange.end}`;
          break;
        case "ar-aging":
          url = `/api/admin/payroll/stale-ar?days=0`;
          break;
        case "payroll-summary":
          url = `/api/admin/accounting/summary?periodStart=${dateRange.start}&periodEnd=${dateRange.end}`;
          break;
        case "ytd-earnings":
          url = `/api/admin/accounting/summary?periodStart=${dateRange.start}&periodEnd=${dateRange.end}`;
          break;
        case "1099":
          url = `/api/admin/accounting/summary?periodStart=${dateRange.start}&periodEnd=${dateRange.end}`;
          break;
        default:
          return;
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    if (!reportData) return;
    let csv = "";
    if (Array.isArray(reportData)) {
      if (reportData.length === 0) return;
      const keys = Object.keys(reportData[0]);
      csv = keys.join(",") + "\n" + reportData.map((r: any) => keys.map(k => `"${r[k] ?? ""}"`).join(",")).join("\n");
    } else {
      const keys = Object.keys(reportData);
      csv = keys.join(",") + "\n" + keys.map(k => `"${reportData[k] ?? ""}"`).join(",");
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${selectedReport}-report.csv`; a.click();
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
                <Play className="h-3.5 w-3.5 mr-1" /> Run Report
              </Button>
              {reportData && (
                <Button size="sm" variant="outline" onClick={downloadCSV} data-testid="button-download-report">
                  <Download className="h-3.5 w-3.5 mr-1" /> Download CSV
                </Button>
              )}
            </div>

            {loading && <Skeleton className="h-48 w-full" />}

            {reportData && !loading && (
              <div className="border rounded-lg overflow-x-auto">
                {Array.isArray(reportData) ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {reportData.length > 0 && Object.keys(reportData[0]).map(k => (
                          <th key={k} className="text-left p-3 text-xs font-medium">{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.slice(0, 50).map((row: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          {Object.values(row).map((v: any, j: number) => (
                            <td key={j} className="p-3 text-xs">{v != null ? String(v) : "—"}</td>
                          ))}
                        </tr>
                      ))}
                      {reportData.length > 50 && (
                        <tr><td colSpan={Object.keys(reportData[0]).length} className="p-3 text-xs text-muted-foreground text-center">Showing first 50 of {reportData.length} rows. Download CSV for full data.</td></tr>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-4 space-y-2">
                    {Object.entries(reportData).map(([key, value]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                        <span className="font-medium">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
