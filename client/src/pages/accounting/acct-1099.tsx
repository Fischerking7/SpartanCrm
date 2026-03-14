import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  FileSpreadsheet, Download, Loader2, AlertTriangle, CheckCircle, Users, DollarSign, Search
} from "lucide-react";

function fmt(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function Acct1099() {
  const { toast } = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: taxDocs, isLoading: docsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/tax-documents"],
  });

  const { data: generateData, isLoading: genLoading } = useQuery<any>({
    queryKey: ["/api/admin/tax-documents/generate-data", year],
    queryFn: async () => {
      const res = await fetch(`/api/admin/tax-documents/generate-data/${year}`, { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const bulkGenerate = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/tax-documents/bulk-generate/${year}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tax-documents"] });
      setConfirmOpen(false);
      toast({ title: `1099-NEC forms generated for ${year}` });
    },
    onError: () => toast({ title: "Failed to generate 1099 forms", variant: "destructive" }),
  });

  const docs = taxDocs || [];
  const yearDocs = docs.filter((d: any) => d.taxYear === year || d.year === year);

  const eligibleReps = generateData?.eligible || generateData?.reps || [];
  const belowThreshold = generateData?.belowThreshold || [];

  const filtered = yearDocs.filter((d: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (d.repName || d.contractorName || "").toLowerCase().includes(q) ||
      (d.tin || d.ssn || "").includes(q);
  });

  const totalEarnings = eligibleReps.reduce((s: number, r: any) => s + (r.totalEarnings || r.totalPaid || 0), 0);

  if (docsLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-1099">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">1099-NEC Preparation</h1>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Tax Year:</Label>
          <Input
            type="number"
            value={year}
            onChange={e => setYear(parseInt(e.target.value) || new Date().getFullYear())}
            className="w-24"
            data-testid="input-tax-year"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="p-3" data-testid="card-eligible-count">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Eligible Contractors</p>
              <p className="text-lg font-semibold">{eligibleReps.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3" data-testid="card-total-earnings">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground">Total Earnings</p>
              <p className="text-lg font-semibold">{fmt(totalEarnings)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3" data-testid="card-generated-count">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-purple-500" />
            <div>
              <p className="text-xs text-muted-foreground">Forms Generated</p>
              <p className="text-lg font-semibold">{yearDocs.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3" data-testid="card-below-threshold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <div>
              <p className="text-xs text-muted-foreground">Below $600 Threshold</p>
              <p className="text-lg font-semibold">{belowThreshold.length}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by contractor name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-1099"
          />
        </div>
        <Button onClick={() => setConfirmOpen(true)} disabled={eligibleReps.length === 0} data-testid="button-generate-all">
          <FileSpreadsheet className="h-4 w-4 mr-1" /> Generate All 1099s
        </Button>
      </div>

      {eligibleReps.length > 0 && yearDocs.length === 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Eligible Contractors for {year}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3">Contractor</th>
                    <th className="text-left p-3">Rep ID</th>
                    <th className="text-right p-3">Total Earnings</th>
                    <th className="text-center p-3">Tax Info</th>
                    <th className="text-center p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleReps.map((r: any) => (
                    <tr key={r.id || r.userId} className="border-b hover:bg-muted/30" data-testid={`row-eligible-${r.id || r.userId}`}>
                      <td className="p-3 font-medium">{r.name || r.contractorName}</td>
                      <td className="p-3 text-muted-foreground">{r.repId || "—"}</td>
                      <td className="p-3 text-right font-medium">{fmt(r.totalEarnings || r.totalPaid || 0)}</td>
                      <td className="p-3 text-center">
                        {r.hasTaxInfo || r.ssnOnFile ? (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                            <CheckCircle className="h-3 w-3 mr-0.5" /> On File
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">
                            <AlertTriangle className="h-3 w-3 mr-0.5" /> Missing
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant="outline" className="text-xs">Pending</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {yearDocs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Generated 1099-NEC Forms ({year})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3">Contractor</th>
                    <th className="text-right p-3">Non-Employee Compensation</th>
                    <th className="text-center p-3">Status</th>
                    <th className="text-right p-3">Generated</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="text-center p-6 text-muted-foreground">No matching records</td></tr>
                  )}
                  {filtered.map((d: any) => (
                    <tr key={d.id} className="border-b hover:bg-muted/30" data-testid={`row-1099-${d.id}`}>
                      <td className="p-3 font-medium">{d.repName || d.contractorName}</td>
                      <td className="p-3 text-right font-medium">{fmt(d.totalCompensation || d.amount || 0)}</td>
                      <td className="p-3 text-center">
                        <Badge variant="outline" className={d.status === "FILED" ? "text-green-600" : d.status === "GENERATED" ? "text-blue-600" : ""}>
                          {d.status || "GENERATED"}
                        </Badge>
                      </td>
                      <td className="p-3 text-right text-muted-foreground text-xs">
                        {d.createdAt ? new Date(d.createdAt).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : "—"}
                      </td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" data-testid={`button-download-1099-${d.id}`}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {belowThreshold.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Below $600 Threshold (No 1099 Required)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3">Contractor</th>
                    <th className="text-right p-3">Total Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {belowThreshold.map((r: any, i: number) => (
                    <tr key={r.id || i} className="border-b">
                      <td className="p-3 text-muted-foreground">{r.name || r.contractorName}</td>
                      <td className="p-3 text-right text-muted-foreground">{fmt(r.totalEarnings || r.totalPaid || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate 1099-NEC Forms</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              This will generate 1099-NEC forms for <strong>{eligibleReps.length}</strong> contractors
              who earned $600 or more during <strong>{year}</strong>.
            </p>
            <p className="text-sm text-muted-foreground">
              Total non-employee compensation: <strong>{fmt(totalEarnings)}</strong>
            </p>
            {eligibleReps.filter((r: any) => !r.hasTaxInfo && !r.ssnOnFile).length > 0 && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {eligibleReps.filter((r: any) => !r.hasTaxInfo && !r.ssnOnFile).length} contractors
                  are missing tax information (SSN/EIN). Forms will be generated with available data.
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} data-testid="button-cancel-generate">Cancel</Button>
            <Button onClick={() => bulkGenerate.mutate()} disabled={bulkGenerate.isPending} data-testid="button-confirm-generate">
              {bulkGenerate.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Generate {eligibleReps.length} Forms
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
