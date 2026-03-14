import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CheckCircle, XCircle, Loader2, DollarSign, Clock, ChevronDown, ChevronRight
} from "lucide-react";

function fmt(v: string | number) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function AcctAdvances() {
  const { toast } = useToast();
  const [tab, setTab] = useState("pending");
  const [approveOpen, setApproveOpen] = useState<any>(null);
  const [approvedAmount, setApprovedAmount] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: advancesData, isLoading } = useQuery<any[]>({ queryKey: ["/api/admin/payroll/advances"] });
  const { data: deductionsData } = useQuery<any[]>({ queryKey: ["/api/admin/payroll/user-deductions"] });

  const advances = advancesData || [];
  const pendingAdvances = advances.filter((a: any) => a.status === "PENDING");
  const activeAdvances = advances.filter((a: any) => a.status === "APPROVED" || a.status === "ACTIVE" || a.status === "PARTIALLY_REPAID");
  const repaidAdvances = advances.filter((a: any) => a.status === "REPAID" || a.status === "CANCELLED");

  const approveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/payroll/advances/${approveOpen.id}/approve`, {
        approvedAmount: approvedAmount || approveOpen.requestedAmount,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      setApproveOpen(null);
      toast({ title: "Advance approved" });
    },
    onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/payroll/advances/${id}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      toast({ title: "Advance rejected" });
    },
    onError: () => toast({ title: "Failed to reject", variant: "destructive" }),
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/admin/payroll/advances/${id}/mark-paid`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payroll/advances"] });
      toast({ title: "Advance marked as paid" });
    },
    onError: () => toast({ title: "Failed to mark paid", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="acct-advances">
      <h1 className="text-xl font-semibold">Advances & Deductions</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending" data-testid="tab-pending">Pending ({pendingAdvances.length})</TabsTrigger>
          <TabsTrigger value="active" data-testid="tab-active">Active ({activeAdvances.length})</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History ({repaidAdvances.length})</TabsTrigger>
          <TabsTrigger value="deductions" data-testid="tab-deductions">Deductions</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <div className="space-y-3">
            {pendingAdvances.length === 0 && (
              <Card><CardContent className="p-6 text-center text-muted-foreground">No pending advance requests</CardContent></Card>
            )}
            {pendingAdvances.map((a: any) => (
              <Card key={a.id} data-testid={`card-advance-${a.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="font-medium text-sm">{a.userName || a.userId?.slice(0, 8)}</p>
                      <p className="text-lg font-semibold">{fmt(a.requestedAmount || 0)}</p>
                      <p className="text-xs text-muted-foreground">{a.reason || "No reason provided"}</p>
                      {a.createdAt && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Requested {new Date(a.createdAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => {
                        setApprovedAmount(a.requestedAmount);
                        setApproveOpen(a);
                      }} data-testid={`button-approve-advance-${a.id}`}>
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => rejectMutation.mutate(a.id)}
                        disabled={rejectMutation.isPending} data-testid={`button-reject-advance-${a.id}`}>
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="active">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3"></th>
                      <th className="text-left p-3">Rep</th>
                      <th className="text-right p-3">Original</th>
                      <th className="text-right p-3">Remaining</th>
                      <th className="text-right p-3">Per Period</th>
                      <th className="text-center p-3">Status</th>
                      <th className="text-right p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAdvances.length === 0 && (
                      <tr><td colSpan={7} className="text-center p-6 text-muted-foreground">No active advances</td></tr>
                    )}
                    {activeAdvances.map((a: any) => (
                      <tr key={a.id} className="border-b hover:bg-muted/30" data-testid={`row-advance-${a.id}`}>
                        <td className="p-3">
                          <button onClick={() => setExpandedId(expandedId === a.id ? null : a.id)} data-testid={`button-expand-advance-${a.id}`}>
                            {expandedId === a.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="p-3 font-medium">{a.userName || a.userId?.slice(0, 8)}</td>
                        <td className="p-3 text-right">{fmt(a.approvedAmount || a.requestedAmount || 0)}</td>
                        <td className="p-3 text-right font-medium">{fmt(a.remainingBalance || 0)}</td>
                        <td className="p-3 text-right">{a.repaymentPercentage ? `${a.repaymentPercentage}%` : "—"}</td>
                        <td className="p-3 text-center"><Badge variant="outline">{a.status}</Badge></td>
                        <td className="p-3 text-right">
                          <Button size="sm" variant="ghost" onClick={() => markPaid.mutate(a.id)}
                            disabled={markPaid.isPending} data-testid={`button-mark-paid-${a.id}`}>
                            <DollarSign className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3">Rep</th>
                      <th className="text-right p-3">Amount</th>
                      <th className="text-center p-3">Status</th>
                      <th className="text-right p-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repaidAdvances.length === 0 && (
                      <tr><td colSpan={4} className="text-center p-6 text-muted-foreground">No repayment history</td></tr>
                    )}
                    {repaidAdvances.map((a: any) => (
                      <tr key={a.id} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-medium">{a.userName || a.userId?.slice(0, 8)}</td>
                        <td className="p-3 text-right">{fmt(a.approvedAmount || a.requestedAmount || 0)}</td>
                        <td className="p-3 text-center"><Badge variant="outline">{a.status}</Badge></td>
                        <td className="p-3 text-right text-muted-foreground">{a.updatedAt ? new Date(a.updatedAt).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deductions">
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3">Rep</th>
                      <th className="text-left p-3">Type</th>
                      <th className="text-right p-3">Amount</th>
                      <th className="text-center p-3">Frequency</th>
                      <th className="text-center p-3">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!deductionsData || deductionsData.length === 0) && (
                      <tr><td colSpan={5} className="text-center p-6 text-muted-foreground">No deductions configured</td></tr>
                    )}
                    {deductionsData?.map((d: any) => (
                      <tr key={d.id} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-medium">{d.userName || d.userId?.slice(0, 8)}</td>
                        <td className="p-3">{d.deductionTypeName || d.deductionTypeId}</td>
                        <td className="p-3 text-right">{fmt(d.amount || 0)}</td>
                        <td className="p-3 text-center">{d.frequency || "ONE_TIME"}</td>
                        <td className="p-3 text-center">{d.isActive ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!approveOpen} onOpenChange={() => setApproveOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Advance</DialogTitle>
          </DialogHeader>
          {approveOpen && (
            <div className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Requested by {approveOpen.userName || approveOpen.userId}</p>
                <p className="text-sm">Requested: {fmt(approveOpen.requestedAmount || 0)}</p>
              </div>
              <div>
                <Label>Approved Amount</Label>
                <Input type="number" step="0.01" value={approvedAmount} onChange={e => setApprovedAmount(e.target.value)} data-testid="input-approved-amount" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(null)} data-testid="button-cancel-approve">Cancel</Button>
            <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} data-testid="button-confirm-approve-advance">
              {approveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
