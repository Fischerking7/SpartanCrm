import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Receipt, Download, Search, FileText, ChevronLeft, User
} from "lucide-react";

function formatCurrency(v: number | string) {
  const num = typeof v === "string" ? parseFloat(v) : v;
  return "$" + (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function OpsPayStubs() {
  const [search, setSearch] = useState("");
  const [selectedStub, setSelectedStub] = useState<any>(null);

  const { data: statementsData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/payroll/statements"],
  });

  const statements = statementsData?.statements || statementsData || [];
  const filtered = (Array.isArray(statements) ? statements : []).filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (s.repName?.toLowerCase().includes(q) || s.repId?.toLowerCase().includes(q) || String(s.id).includes(q));
  });

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-paystubs">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pay Stubs</h1>
          <p className="text-sm text-muted-foreground">View and export pay statements</p>
        </div>
        <Button variant="outline" data-testid="btn-bulk-export">
          <Download className="h-4 w-4 mr-2" />
          Bulk PDF Export
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by rep name, ID, or statement #..."
          className="pl-10"
          data-testid="input-search-stubs"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <Receipt className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No pay stubs found</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Rep</th>
                  <th className="text-left p-3 font-medium">Period</th>
                  <th className="text-right p-3 font-medium">Gross</th>
                  <th className="text-right p-3 font-medium">Deductions</th>
                  <th className="text-right p-3 font-medium">Net</th>
                  <th className="text-center p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((stub: any) => (
                  <tr key={stub.id} className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedStub(stub)} data-testid={`stub-row-${stub.id}`}>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-[#1B2A4A] flex items-center justify-center">
                          <User className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <p className="font-medium">{stub.repName || "—"}</p>
                          <p className="text-xs text-muted-foreground">{stub.repId || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {stub.periodStart && stub.periodEnd
                        ? `${formatDate(stub.periodStart)} — ${formatDate(stub.periodEnd)}`
                        : formatDate(stub.createdAt)}
                    </td>
                    <td className="p-3 text-right font-medium">{formatCurrency(stub.grossPay || stub.totalEarnings || 0)}</td>
                    <td className="p-3 text-right text-red-600">{formatCurrency(stub.totalDeductions || 0)}</td>
                    <td className="p-3 text-right font-bold text-[#C9A84C]">{formatCurrency(stub.netPay || 0)}</td>
                    <td className="p-3 text-center">
                      <Badge variant="secondary" className="text-xs">
                        {stub.status || "Generated"}
                      </Badge>
                    </td>
                    <td className="p-3 text-center">
                      <Button size="sm" variant="ghost" className="h-7" data-testid={`btn-download-${stub.id}`}
                        onClick={(e) => { e.stopPropagation(); }}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={!!selectedStub} onOpenChange={() => setSelectedStub(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#C9A84C]" />
              Pay Statement #{selectedStub?.id}
            </DialogTitle>
          </DialogHeader>
          {selectedStub && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Rep</p>
                  <p className="font-medium">{selectedStub.repName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Rep ID</p>
                  <p className="font-medium">{selectedStub.repId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Period</p>
                  <p className="font-medium">
                    {selectedStub.periodStart && selectedStub.periodEnd
                      ? `${formatDate(selectedStub.periodStart)} — ${formatDate(selectedStub.periodEnd)}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p className="font-medium">{selectedStub.status || "Generated"}</p>
                </div>
              </div>

              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span>Gross Commissions</span>
                  <span className="font-medium">{formatCurrency(selectedStub.grossPay || selectedStub.totalEarnings || 0)}</span>
                </div>
                {selectedStub.overrideEarnings > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground pl-4">Override Earnings</span>
                    <span>{formatCurrency(selectedStub.overrideEarnings)}</span>
                  </div>
                )}
                <div className="flex justify-between text-red-600">
                  <span>Deductions</span>
                  <span className="font-medium">-{formatCurrency(selectedStub.totalDeductions || 0)}</span>
                </div>
                {selectedStub.reserveWithholding > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground pl-4">Reserve Withholding</span>
                    <span className="text-red-600">-{formatCurrency(selectedStub.reserveWithholding)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>Net Pay</span>
                  <span className="text-[#C9A84C]">{formatCurrency(selectedStub.netPay || 0)}</span>
                </div>
              </div>

              <Button className="w-full" variant="outline" data-testid="btn-download-pdf">
                <Download className="h-4 w-4 mr-2" /> Download PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
