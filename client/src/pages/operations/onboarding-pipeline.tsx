import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { UserCheck, Tablet, AlertTriangle, RefreshCw, ChevronRight, Bell } from "lucide-react";

interface PipelineEntry {
  id: string; name: string; repId: string; email: string;
  onboardingStatus: string; daysInStage: number; isSlaBreached: boolean;
  slaDays: number; startedAt: string | null; submittedAt: string | null;
  approvedAt: string | null; rejectedAt: string | null;
  backgroundCheckStatus: string | null; drugTestStatus: string | null;
  ipadIssued: boolean | null; ipadSerialNumber: string | null;
  ipadIssuedAt: string | null; ipadReturnedAt: string | null;
  appAccessGrantedAt: string | null;
}

interface PipelineData {
  pipeline: Record<string, PipelineEntry[]>;
  stageSummary: Array<{ stage: string; count: number; slaBreached: number }>;
  ipadStats: { totalIssued: number; totalReturned: number; pendingReturn: number };
  slaDays: number;
}

const STAGE_LABELS: Record<string, string> = {
  OTP_SENT: "OTP Sent",
  OTP_VERIFIED: "OTP Verified",
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const STAGE_ORDER = ["OTP_SENT", "OTP_VERIFIED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"];

export default function OnboardingPipeline() {
  const { toast } = useToast();
  const [slaDays, setSlaDays] = useState(7);
  const [appliedSlaDays, setAppliedSlaDays] = useState(7);
  const [ipadDialog, setIpadDialog] = useState<{ userId: string; name: string; hasIpad: boolean } | null>(null);
  const [ipadSerial, setIpadSerial] = useState("");

  const { data, isLoading, error, refetch } = useQuery<PipelineData>({
    queryKey: ["/api/operations/onboarding-pipeline", appliedSlaDays],
    queryFn: async () => {
      const res = await fetch(`/api/operations/onboarding-pipeline?slaDays=${appliedSlaDays}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load onboarding pipeline");
      return res.json();
    },
  });

  const emitMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/operations/onboarding-pipeline/emit-exceptions", {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Onboarding SLA Exceptions Emitted", description: `${data.emitted} exception(s) created from ${data.scanned} reps scanned.` });
    },
    onError: () => toast({ title: "Error", description: "Failed to emit onboarding SLA exceptions.", variant: "destructive" }),
  });

  const ipadMutation = useMutation({
    mutationFn: async ({ userId, action, serialNumber }: { userId: string; action: string; serialNumber?: string }) => {
      return apiRequest("PATCH", `/api/operations/users/${userId}/ipad`, { action, serialNumber });
    },
    onSuccess: () => {
      toast({ title: "iPad status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/onboarding-pipeline"] });
      setIpadDialog(null);
      setIpadSerial("");
    },
    onError: () => {
      toast({ title: "Failed to update iPad status", variant: "destructive" });
    },
  });

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString();
  };

  const stageColor = (stage: string) => {
    if (stage === "APPROVED") return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300";
    if (stage === "REJECTED") return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300";
    if (stage === "UNDER_REVIEW") return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-primary" />
            Onboarding Pipeline
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Rep onboarding status, equipment tracking, and SLA monitoring</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => emitMutation.mutate()}
            disabled={emitMutation.isPending}
            data-testid="button-emit-onboarding-exceptions"
          >
            <Bell className="h-4 w-4 mr-2" />
            {emitMutation.isPending ? "Emitting..." : "Emit Exceptions"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-pipeline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">SLA Days</Label>
          <Input
            type="number"
            className="w-24 mt-1"
            value={slaDays}
            min={1}
            onChange={e => setSlaDays(parseInt(e.target.value) || 7)}
            data-testid="input-sla-days"
          />
        </div>
        <Button onClick={() => setAppliedSlaDays(slaDays)} data-testid="button-apply-sla">Apply</Button>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Failed to load onboarding pipeline.</AlertDescription>
        </Alert>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card data-testid="card-ipad-issued">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Tablet className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-2xl font-bold">{data.ipadStats.totalIssued}</div>
                    <div className="text-xs text-muted-foreground">iPads Issued</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-ipad-returned">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Tablet className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="text-2xl font-bold">{data.ipadStats.totalReturned}</div>
                    <div className="text-xs text-muted-foreground">iPads Returned</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-ipad-pending">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <div>
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{data.ipadStats.pendingReturn}</div>
                    <div className="text-xs text-muted-foreground">Pending Return</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-sla-breached">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  <div>
                    <div className="text-2xl font-bold text-destructive">
                      {data.stageSummary.reduce((s, st) => s + st.slaBreached, 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">SLA Breached</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {data.stageSummary.map((stage, i) => (
              <div key={stage.stage} className="flex items-center gap-1 shrink-0">
                <div className={`rounded-lg px-3 py-2 text-sm min-w-[100px] ${stageColor(stage.stage)}`} data-testid={`stage-summary-${stage.stage}`}>
                  <div className="font-semibold">{STAGE_LABELS[stage.stage] || stage.stage}</div>
                  <div className="text-lg font-bold">{stage.count}</div>
                  {stage.slaBreached > 0 && (
                    <div className="text-xs text-destructive">{stage.slaBreached} over SLA</div>
                  )}
                </div>
                {i < data.stageSummary.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              </div>
            ))}
          </div>

          <Tabs defaultValue="all">
            <TabsList>
              {STAGE_ORDER.filter(s => (data.pipeline[s]?.length || 0) > 0).map(stage => (
                <TabsTrigger key={stage} value={stage} data-testid={`tab-stage-${stage}`}>
                  {STAGE_LABELS[stage] || stage}
                  {(data.pipeline[stage]?.length || 0) > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs">{data.pipeline[stage].length}</Badge>
                  )}
                </TabsTrigger>
              ))}
              <TabsTrigger value="all" data-testid="tab-stage-all">All</TabsTrigger>
            </TabsList>

            {[...STAGE_ORDER, "all"].map(stage => {
              const entries = stage === "all"
                ? STAGE_ORDER.flatMap(s => data.pipeline[s] || [])
                : (data.pipeline[stage] || []);

              return (
                <TabsContent key={stage} value={stage}>
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Days in Stage</TableHead>
                              <TableHead>Background</TableHead>
                              <TableHead>Drug Test</TableHead>
                              <TableHead>iPad</TableHead>
                              <TableHead>Submitted</TableHead>
                              <TableHead>Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {entries.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                                  No reps in this stage
                                </TableCell>
                              </TableRow>
                            )}
                            {entries.map((entry) => (
                              <TableRow key={entry.id} data-testid={`row-rep-${entry.id}`}>
                                <TableCell>
                                  <div className="font-medium">{entry.name}</div>
                                  <div className="text-xs text-muted-foreground font-mono">{entry.repId}</div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={entry.isSlaBreached ? "destructive" : "outline"} className="text-xs">
                                    {STAGE_LABELS[entry.onboardingStatus] || entry.onboardingStatus}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className={entry.isSlaBreached ? "text-destructive font-medium" : ""}>
                                    {entry.daysInStage}d
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={entry.backgroundCheckStatus === "PASS" ? "outline" : "secondary"} className="text-xs">
                                    {entry.backgroundCheckStatus || "Pending"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={entry.drugTestStatus === "PASS" ? "outline" : "secondary"} className="text-xs">
                                    {entry.drugTestStatus || "Pending"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {entry.ipadIssued && !entry.ipadReturnedAt ? (
                                    <div className="text-xs">
                                      <Badge variant="secondary" className="text-xs">Issued</Badge>
                                      {entry.ipadSerialNumber && (
                                        <div className="font-mono text-muted-foreground mt-0.5">{entry.ipadSerialNumber}</div>
                                      )}
                                    </div>
                                  ) : entry.ipadReturnedAt ? (
                                    <Badge variant="outline" className="text-xs">Returned</Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm">{formatDate(entry.submittedAt)}</TableCell>
                                <TableCell>
                                  {!entry.ipadIssued || entry.ipadReturnedAt ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs"
                                      onClick={() => { setIpadDialog({ userId: entry.id, name: entry.name, hasIpad: false }); setIpadSerial(""); }}
                                      data-testid={`button-issue-ipad-${entry.id}`}
                                    >
                                      <Tablet className="h-3 w-3 mr-1" /> Issue iPad
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs"
                                      onClick={() => setIpadDialog({ userId: entry.id, name: entry.name, hasIpad: true })}
                                      data-testid={`button-return-ipad-${entry.id}`}
                                    >
                                      Return iPad
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              );
            })}
          </Tabs>
        </>
      )}

      <Dialog open={!!ipadDialog} onOpenChange={() => { setIpadDialog(null); setIpadSerial(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {ipadDialog?.hasIpad ? "Return iPad" : "Issue iPad"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Rep: <strong>{ipadDialog?.name}</strong></p>
            {!ipadDialog?.hasIpad && (
              <div>
                <Label htmlFor="serial">Serial Number (optional)</Label>
                <Input
                  id="serial"
                  value={ipadSerial}
                  onChange={e => setIpadSerial(e.target.value)}
                  placeholder="e.g. DMPXXX..."
                  data-testid="input-ipad-serial"
                  className="mt-1"
                />
              </div>
            )}
            {ipadDialog?.hasIpad && (
              <p className="text-sm">This will mark the iPad as returned and update the return date.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIpadDialog(null)} data-testid="button-cancel-ipad">
              Cancel
            </Button>
            <Button
              disabled={ipadMutation.isPending}
              onClick={() => {
                if (!ipadDialog) return;
                ipadMutation.mutate({
                  userId: ipadDialog.userId,
                  action: ipadDialog.hasIpad ? "return" : "issue",
                  serialNumber: ipadSerial || undefined,
                });
              }}
              data-testid="button-confirm-ipad"
            >
              {ipadMutation.isPending ? "Saving..." : ipadDialog?.hasIpad ? "Confirm Return" : "Issue iPad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
