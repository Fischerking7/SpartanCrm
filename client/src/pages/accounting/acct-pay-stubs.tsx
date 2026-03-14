import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  Search, FileText, Download, Eye, ChevronLeft, ChevronRight
} from "lucide-react";

function fmt(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function AcctPayStubs() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selectedStub, setSelectedStub] = useState<any>(null);
  const [page, setPage] = useState(1);
  const perPage = 25;

  const { data: allStatements = [] } = useQuery<any[]>({ queryKey: ["/api/admin/payroll/statements"] });

  const filtered = allStatements.filter(s => {
    if (filter !== "ALL" && s.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (s.repName || "").toLowerCase().includes(q) ||
        (s.stubNumber || "").toLowerCase().includes(q) ||
        (s.payRunName || "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const filters = ["ALL", "DRAFT", "ISSUED", "PAID"];

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-pay-stubs">
      <h1 className="text-xl font-semibold">Pay Stubs</h1>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by rep name, stub #, or period..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
            data-testid="input-search-stubs"
          />
        </div>
        <div className="flex gap-1">
          {filters.map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => { setFilter(f); setPage(1); }}
              data-testid={`filter-${f.toLowerCase()}`}
            >
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3">Rep Name</th>
                  <th className="text-left p-3">Stub #</th>
                  <th className="text-left p-3">Period</th>
                  <th className="text-right p-3">Gross</th>
                  <th className="text-right p-3">Net Pay</th>
                  <th className="text-center p-3">Status</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 && (
                  <tr><td colSpan={7} className="text-center p-6 text-muted-foreground">No pay stubs found</td></tr>
                )}
                {paginated.map((s: any) => (
                  <tr key={s.id} className="border-b hover:bg-muted/30" data-testid={`row-stub-${s.id}`}>
                    <td className="p-3 font-medium">{s.repName || s.userId}</td>
                    <td className="p-3 text-muted-foreground">{s.stubNumber || "—"}</td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {s.periodStart ? new Date(s.periodStart).toLocaleDateString() : ""} – {s.periodEnd ? new Date(s.periodEnd).toLocaleDateString() : ""}
                    </td>
                    <td className="p-3 text-right">{fmt(s.grossCommission || 0)}</td>
                    <td className="p-3 text-right font-medium">{fmt(s.netPay || 0)}</td>
                    <td className="p-3 text-center">
                      <Badge variant="outline">{s.status || "DRAFT"}</Badge>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedStub(s)} data-testid={`button-view-detail-${s.id}`}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {s.stubNumber && (
                          <Button size="sm" variant="ghost" onClick={async () => {
                            const res = await fetch(`/api/admin/payroll/pdf/${s.id}`, { headers: getAuthHeaders() });
                            if (res.ok) {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a"); a.href = url; a.download = `stub-${s.stubNumber}.pdf`; a.click();
                            }
                          }} data-testid={`button-download-${s.id}`}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <p className="text-xs text-muted-foreground">{filtered.length} stubs</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-stubs-prev-page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs">{page} / {totalPages}</span>
                <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-stubs-next-page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedStub} onOpenChange={() => setSelectedStub(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pay Stub {selectedStub?.stubNumber ? `#${selectedStub.stubNumber}` : "Detail"}
            </DialogTitle>
          </DialogHeader>
          {selectedStub && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Rep</p>
                  <p className="font-medium">{selectedStub.repName || selectedStub.userId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Period</p>
                  <p className="font-medium">{selectedStub.periodStart ? new Date(selectedStub.periodStart).toLocaleDateString() : "N/A"} – {selectedStub.periodEnd ? new Date(selectedStub.periodEnd).toLocaleDateString() : "N/A"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pay Run</p>
                  <p className="font-medium">{selectedStub.payRunName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant="outline">{selectedStub.status}</Badge>
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium">Earnings</h3>
                <div className="flex justify-between text-sm">
                  <span>Gross Commission</span>
                  <span className="font-medium">{fmt(selectedStub.grossCommission || 0)}</span>
                </div>
                {selectedStub.lineItems?.map((li: any) => (
                  <div key={li.id} className="flex justify-between text-sm pl-4">
                    <span className="text-muted-foreground">{li.description || li.category}</span>
                    <span>{fmt(li.amount || 0)}</span>
                  </div>
                ))}
              </div>

              <div className="border rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium">Deductions</h3>
                {(selectedStub.deductions || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No deductions</p>
                )}
                {(selectedStub.deductions || []).map((d: any) => (
                  <div key={d.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{d.description || d.type}</span>
                    <span className="text-red-600">-{fmt(d.amount || 0)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t pt-3 flex justify-between text-lg font-semibold">
                <span>Net Pay</span>
                <span data-testid="text-stub-net-pay">{fmt(selectedStub.netPay || 0)}</span>
              </div>

              <div className="flex gap-2 justify-end">
                {selectedStub.stubNumber && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    const res = await fetch(`/api/admin/payroll/pdf/${selectedStub.id}`, { headers: getAuthHeaders() });
                    if (res.ok) {
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a"); a.href = url; a.download = `stub-${selectedStub.stubNumber}.pdf`; a.click();
                    }
                  }} data-testid="button-download-stub-pdf">
                    <Download className="h-3.5 w-3.5 mr-1" /> Download PDF
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
