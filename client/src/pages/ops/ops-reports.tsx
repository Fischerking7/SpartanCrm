import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/auth";
import {
  FileText, Download, Play, Calendar, BarChart3
} from "lucide-react";

const reportTypes = [
  { value: "production", label: "Production Report" },
  { value: "commission", label: "Commission Summary" },
  { value: "iron-crest-profit", label: "Iron Crest Profit" },
  { value: "rep-performance", label: "Rep Performance" },
  { value: "order-status", label: "Order Status Breakdown" },
  { value: "approval-turnaround", label: "Approval Turnaround" },
];

const groupByOptions = [
  { value: "rep", label: "By Rep" },
  { value: "manager", label: "By Manager" },
  { value: "service", label: "By Service" },
  { value: "provider", label: "By Provider" },
  { value: "day", label: "By Day" },
  { value: "week", label: "By Week" },
  { value: "month", label: "By Month" },
];

export default function OpsReports() {
  const { toast } = useToast();
  const [reportType, setReportType] = useState("production");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [groupBy, setGroupBy] = useState("rep");
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handlePreview = async () => {
    setIsLoading(true);
    try {
      let url = "";
      switch (reportType) {
        case "iron-crest-profit":
          url = `/api/admin/reports/iron-crest-profit?from=${dateFrom}&to=${dateTo}`;
          break;
        case "production":
        case "commission":
        case "rep-performance":
        case "order-status":
        case "approval-turnaround":
          url = `/api/orders?from=${dateFrom}&to=${dateTo}&limit=20`;
          break;
      }
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch report");
      const data = await res.json();
      setPreviewData(Array.isArray(data) ? data.slice(0, 20) : data.orders ? data.orders.slice(0, 20) : [data]);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      let url = "";
      switch (reportType) {
        case "iron-crest-profit":
          url = `/api/admin/reports/iron-crest-profit?from=${dateFrom}&to=${dateTo}`;
          break;
        default:
          url = `/api/orders?from=${dateFrom}&to=${dateTo}&limit=10000`;
          break;
      }
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data.orders || [data];

      if (rows.length === 0) {
        toast({ title: "No data to export" });
        return;
      }

      const headers = Object.keys(rows[0]);
      const csvContent = [
        headers.join(","),
        ...rows.map((row: any) =>
          headers.map(h => {
            const val = row[h];
            if (val === null || val === undefined) return "";
            const str = String(val);
            return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
          }).join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${reportType}-${dateFrom}-${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: "Report downloaded" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

            <div className="space-y-2">
              <Label>Group By</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger data-testid="select-group-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupByOptions.map(g => (
                    <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={handlePreview} disabled={isLoading} data-testid="btn-preview">
              <Play className="h-4 w-4 mr-2" />
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
            <CardTitle className="text-sm font-medium">
              Preview — {reportTypes.find(r => r.value === reportType)?.label} (first 20 rows)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {previewData.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No data for this period</p>
            ) : (
              <div className="border rounded-lg overflow-auto max-h-[50vh]">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      {Object.keys(previewData[0]).slice(0, 8).map(key => (
                        <th key={key} className="text-left p-2 font-medium whitespace-nowrap">
                          {key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((row: any, i: number) => (
                      <tr key={i} className="border-t">
                        {Object.keys(row).slice(0, 8).map(key => (
                          <td key={key} className="p-2 max-w-[200px] truncate">
                            {row[key] === null ? "—" : String(row[key]).slice(0, 50)}
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
                onClick={() => { setReportType(report.type); handlePreview(); }}
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
