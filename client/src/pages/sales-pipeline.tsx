import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Clock, 
  Calendar, 
  Phone,
  Target,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Filter
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const PIPELINE_STAGES = [
  { id: "NOT_HOME", label: "Not Home", color: "bg-blue-500" },
  { id: "RETURN", label: "Return", color: "bg-yellow-500" },
  { id: "DOOR_SLAM_REJECT", label: "Door Slam/Reject", color: "bg-red-500" },
  { id: "SHORT_PITCH", label: "Short-Pitch", color: "bg-orange-500" },
  { id: "CALLED", label: "Called", color: "bg-purple-500" },
  { id: "EMAIL_SENT", label: "Email Sent", color: "bg-pink-500" },
  { id: "CALL_NO_ANSWER", label: "Call-No Answer", color: "bg-cyan-500" },
  { id: "SOLD", label: "Sold", color: "bg-green-500" },
];

const LOSS_REASONS = [
  { id: "PRICE", label: "Price too high" },
  { id: "COMPETITOR", label: "Chose competitor" },
  { id: "NO_RESPONSE", label: "No response" },
  { id: "NOT_INTERESTED", label: "Not interested" },
  { id: "SERVICE_AREA", label: "Outside service area" },
  { id: "CREDIT", label: "Credit issues" },
  { id: "OTHER", label: "Other" },
];

export default function SalesPipeline() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("funnel");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedRepId, setSelectedRepId] = useState<string>("");
  const [groupBy, setGroupBy] = useState("rep");
  
  const [lossDialog, setLossDialog] = useState<{ open: boolean; leadId: string | null }>({ open: false, leadId: null });
  const [lossReason, setLossReason] = useState("");
  const [lossNotes, setLossNotes] = useState("");

  const { data: funnelData, isLoading: funnelLoading } = useQuery<{
    funnel: { stage: string; count: number }[];
    summary: { total: number; won: number; lost: number; active: number; winRate: string; conversionRate: string };
  }>({
    queryKey: ["/api/pipeline/funnel", dateRange.start, dateRange.end, selectedRepId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("startDate", dateRange.start);
      if (dateRange.end) params.set("endDate", dateRange.end);
      if (selectedRepId) params.set("repId", selectedRepId);
      const res = await fetch(`/api/pipeline/funnel?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch funnel data");
      return res.json();
    },
  });

  const { data: agingData, isLoading: agingLoading } = useQuery<{
    buckets: Record<string, number>;
    details: any[];
    summary: { totalActive: number; averageAgeDays: string; oldestLead: any };
  }>({
    queryKey: ["/api/pipeline/aging", selectedRepId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedRepId) params.set("repId", selectedRepId);
      const res = await fetch(`/api/pipeline/aging?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch aging data");
      return res.json();
    },
  });

  const { data: winLossData, isLoading: winLossLoading } = useQuery<{
    byGroup: any[];
    summary: { totalWins: number; totalLosses: number; overallWinRate: string; topLossReasons: { reason: string; count: number }[] };
  }>({
    queryKey: ["/api/pipeline/win-loss", dateRange.start, dateRange.end, groupBy],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("startDate", dateRange.start);
      if (dateRange.end) params.set("endDate", dateRange.end);
      params.set("groupBy", groupBy);
      const res = await fetch(`/api/pipeline/win-loss?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch win/loss data");
      return res.json();
    },
  });

  const { data: followUps, isLoading: followUpsLoading } = useQuery<{
    overdue: any[];
    today: any[];
    upcoming: any[];
    total: number;
  }>({
    queryKey: ["/api/leads/follow-ups"],
  });

  const { data: reps } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ leadId, stage, lostReason, lostNotes }: { leadId: string; stage: string; lostReason?: string; lostNotes?: string }) => {
      const res = await apiRequest("PUT", `/api/leads/${leadId}/stage`, { pipelineStage: stage, lostReason, lostNotes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/funnel"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/aging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/win-loss"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/follow-ups"] });
      toast({ title: "Lead stage updated" });
      setLossDialog({ open: false, leadId: null });
      setLossReason("");
      setLossNotes("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to update lead", description: error.message, variant: "destructive" });
    },
  });

  const handleStageChange = (leadId: string, newStage: string) => {
    if (newStage === "LOST") {
      setLossDialog({ open: true, leadId });
    } else {
      updateStageMutation.mutate({ leadId, stage: newStage });
    }
  };

  const confirmLoss = () => {
    if (lossDialog.leadId) {
      updateStageMutation.mutate({ 
        leadId: lossDialog.leadId, 
        stage: "LOST", 
        lostReason: lossReason, 
        lostNotes: lossNotes 
      });
    }
  };

  const getStageColor = (stage: string) => {
    return PIPELINE_STAGES.find(s => s.id === stage)?.color || "bg-gray-500";
  };

  const getMaxFunnelCount = () => {
    if (!funnelData?.funnel) return 1;
    return Math.max(...funnelData.funnel.map(f => f.count), 1);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Sales Pipeline</h1>
          <p className="text-muted-foreground">Track leads through your sales funnel</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm">From</Label>
            <Input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(d => ({ ...d, start: e.target.value }))}
              className="w-36"
              data-testid="input-date-start"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm">To</Label>
            <Input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(d => ({ ...d, end: e.target.value }))}
              className="w-36"
              data-testid="input-date-end"
            />
          </div>
          <Select value={selectedRepId} onValueChange={setSelectedRepId}>
            <SelectTrigger className="w-40" data-testid="select-rep-filter">
              <SelectValue placeholder="All Reps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reps</SelectItem>
              {reps?.map(rep => (
                <SelectItem key={rep.repId} value={rep.repId}>{rep.name} ({rep.repId})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Leads</p>
                <p className="text-3xl font-bold" data-testid="text-total-leads">{funnelData?.summary.total || 0}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Won</p>
                <p className="text-3xl font-bold text-green-600" data-testid="text-won-leads">{funnelData?.summary.won || 0}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Lost</p>
                <p className="text-3xl font-bold text-red-600" data-testid="text-lost-leads">{funnelData?.summary.lost || 0}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Win Rate</p>
                <p className="text-3xl font-bold text-primary" data-testid="text-win-rate">{funnelData?.summary.winRate || 0}%</p>
              </div>
              <Target className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="funnel" data-testid="tab-funnel">
            <BarChart3 className="h-4 w-4 mr-2" />
            Funnel
          </TabsTrigger>
          <TabsTrigger value="aging" data-testid="tab-aging">
            <Clock className="h-4 w-4 mr-2" />
            Lead Aging
          </TabsTrigger>
          <TabsTrigger value="winloss" data-testid="tab-winloss">
            <TrendingUp className="h-4 w-4 mr-2" />
            Win/Loss Analysis
          </TabsTrigger>
          <TabsTrigger value="followups" data-testid="tab-followups">
            <Calendar className="h-4 w-4 mr-2" />
            Follow-ups
            {followUps && followUps.overdue.length > 0 && (
              <Badge variant="destructive" className="ml-2">{followUps.overdue.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Sales Funnel</CardTitle>
              <CardDescription>Visual representation of leads at each stage</CardDescription>
            </CardHeader>
            <CardContent>
              {funnelLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading funnel data...</div>
              ) : (
                <div className="space-y-3">
                  {funnelData?.funnel.map((stage, index) => {
                    const stageInfo = PIPELINE_STAGES.find(s => s.id === stage.stage);
                    const width = (stage.count / getMaxFunnelCount()) * 100;
                    return (
                      <div key={stage.stage} className="flex items-center gap-4">
                        <div className="w-28 text-sm font-medium">{stageInfo?.label || stage.stage}</div>
                        <div className="flex-1 h-10 bg-muted rounded-md overflow-hidden">
                          <div 
                            className={`h-full ${stageInfo?.color || 'bg-gray-500'} transition-all duration-500 flex items-center justify-end pr-3`}
                            style={{ width: `${Math.max(width, stage.count > 0 ? 5 : 0)}%` }}
                          >
                            {stage.count > 0 && (
                              <span className="text-sm font-bold text-white">{stage.count}</span>
                            )}
                          </div>
                        </div>
                        <div className="w-16 text-right text-sm text-muted-foreground">
                          {funnelData.summary.total > 0 
                            ? `${((stage.count / funnelData.summary.total) * 100).toFixed(0)}%` 
                            : "0%"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Aging Distribution</CardTitle>
                <CardDescription>How long leads have been in pipeline</CardDescription>
              </CardHeader>
              <CardContent>
                {agingLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : (
                  <div className="space-y-4">
                    {agingData?.buckets && Object.entries(agingData.buckets).map(([bucket, count]) => (
                      <div key={bucket} className="flex items-center justify-between">
                        <span className="text-sm">{bucket}</span>
                        <Badge variant={bucket.includes("60+") ? "destructive" : "secondary"}>{count}</Badge>
                      </div>
                    ))}
                    <div className="pt-4 border-t">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Average Age</span>
                        <span className="font-bold">{agingData?.summary.averageAgeDays || 0} days</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Oldest Active Leads</CardTitle>
                <CardDescription>Leads that need attention</CardDescription>
              </CardHeader>
              <CardContent>
                {agingLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : agingData?.details.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No active leads</div>
                ) : (
                  <div className="space-y-2">
                    {agingData?.details.slice(0, 10).map((lead: any) => (
                      <div key={lead.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium">{lead.customerName || "Unknown"}</div>
                          <div className="text-sm text-muted-foreground">
                            Rep: {lead.repId} | Stage: {lead.pipelineStage}
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant={lead.ageDays > 30 ? "destructive" : lead.ageDays > 14 ? "secondary" : "outline"}>
                            {lead.ageDays} days
                          </Badge>
                          {lead.lastContactedAt && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Last contact: {formatDistanceToNow(new Date(lead.lastContactedAt), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="winloss" className="mt-6">
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <Label>Group by:</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="w-40" data-testid="select-group-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rep">Rep</SelectItem>
                  <SelectItem value="provider">Provider</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Win/Loss by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</CardTitle>
                </CardHeader>
                <CardContent>
                  {winLossLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading...</div>
                  ) : winLossData?.byGroup.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No closed leads in date range</div>
                  ) : (
                    <div className="space-y-3">
                      {winLossData?.byGroup.map((item: any, index: number) => (
                        <div key={index} className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                          <div className="flex-1">
                            <div className="font-medium">{item[groupBy] || "Unknown"}</div>
                            <div className="text-sm text-muted-foreground">
                              {item.wins} won / {item.losses} lost
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-red-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-green-500" 
                                style={{ width: `${item.winRate}%` }}
                              />
                            </div>
                            <Badge variant={parseFloat(item.winRate) >= 50 ? "default" : "secondary"}>
                              {item.winRate}%
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top Loss Reasons</CardTitle>
                </CardHeader>
                <CardContent>
                  {winLossLoading ? (
                    <div className="text-center py-8 text-muted-foreground">Loading...</div>
                  ) : winLossData?.summary.topLossReasons.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No losses recorded</div>
                  ) : (
                    <div className="space-y-3">
                      {winLossData?.summary.topLossReasons.map((reason: any, index: number) => (
                        <div key={index} className="flex items-center justify-between">
                          <span className="text-sm">{LOSS_REASONS.find(r => r.id === reason.reason)?.label || reason.reason}</span>
                          <Badge variant="outline">{reason.count}</Badge>
                        </div>
                      ))}
                      <div className="pt-4 border-t">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Overall Win Rate</span>
                          <span className="font-bold">{winLossData?.summary.overallWinRate || 0}%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="followups" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className={followUps?.overdue.length ? "border-red-500" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  Overdue
                </CardTitle>
                <CardDescription>Follow-ups that are past due</CardDescription>
              </CardHeader>
              <CardContent>
                {followUpsLoading ? (
                  <div className="text-center py-4 text-muted-foreground">Loading...</div>
                ) : followUps?.overdue.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">No overdue follow-ups</div>
                ) : (
                  <div className="space-y-2">
                    {followUps?.overdue.slice(0, 5).map((lead: any) => (
                      <FollowUpCard key={lead.id} lead={lead} onStageChange={handleStageChange} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-yellow-500" />
                  Today
                </CardTitle>
                <CardDescription>Follow-ups scheduled for today</CardDescription>
              </CardHeader>
              <CardContent>
                {followUpsLoading ? (
                  <div className="text-center py-4 text-muted-foreground">Loading...</div>
                ) : followUps?.today.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">No follow-ups today</div>
                ) : (
                  <div className="space-y-2">
                    {followUps?.today.slice(0, 5).map((lead: any) => (
                      <FollowUpCard key={lead.id} lead={lead} onStageChange={handleStageChange} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-blue-500" />
                  Upcoming
                </CardTitle>
                <CardDescription>Follow-ups in the next 24 hours</CardDescription>
              </CardHeader>
              <CardContent>
                {followUpsLoading ? (
                  <div className="text-center py-4 text-muted-foreground">Loading...</div>
                ) : followUps?.upcoming.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">No upcoming follow-ups</div>
                ) : (
                  <div className="space-y-2">
                    {followUps?.upcoming.slice(0, 5).map((lead: any) => (
                      <FollowUpCard key={lead.id} lead={lead} onStageChange={handleStageChange} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={lossDialog.open} onOpenChange={(open) => setLossDialog({ open, leadId: open ? lossDialog.leadId : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Lead as Lost</DialogTitle>
            <DialogDescription>Please provide a reason for losing this lead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Loss Reason</Label>
              <Select value={lossReason} onValueChange={setLossReason}>
                <SelectTrigger data-testid="select-loss-reason">
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  {LOSS_REASONS.map(reason => (
                    <SelectItem key={reason.id} value={reason.id}>{reason.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Additional Notes</Label>
              <Textarea 
                value={lossNotes} 
                onChange={(e) => setLossNotes(e.target.value)}
                placeholder="Any additional details..."
                data-testid="input-loss-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLossDialog({ open: false, leadId: null })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmLoss} disabled={!lossReason} data-testid="button-confirm-loss">
              Mark as Lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FollowUpCard({ lead, onStageChange }: { lead: any; onStageChange: (id: string, stage: string) => void }) {
  return (
    <div className="p-3 bg-muted rounded-lg">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">{lead.customerName || "Unknown"}</div>
          <div className="text-xs text-muted-foreground">
            {lead.customerPhone || lead.customerEmail || "No contact info"}
          </div>
        </div>
        <Badge variant="outline" className="text-xs">{lead.pipelineStage}</Badge>
      </div>
      {lead.followUpNotes && (
        <p className="text-xs text-muted-foreground mt-2 italic">"{lead.followUpNotes}"</p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`button-contact-${lead.id}`}>
          <Phone className="h-3 w-3 mr-1" />
          Contact
        </Button>
        <Select onValueChange={(stage) => onStageChange(lead.id, stage)}>
          <SelectTrigger className="h-7 text-xs w-28" data-testid={`select-stage-${lead.id}`}>
            <SelectValue placeholder="Move to..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NOT_HOME">Not Home</SelectItem>
            <SelectItem value="RETURN">Return</SelectItem>
            <SelectItem value="DOOR_SLAM_REJECT">Door Slam/Reject</SelectItem>
            <SelectItem value="SHORT_PITCH">Short-Pitch</SelectItem>
            <SelectItem value="CALLED">Called</SelectItem>
            <SelectItem value="EMAIL_SENT">Email Sent</SelectItem>
            <SelectItem value="CALL_NO_ANSWER">Call-No Answer</SelectItem>
            <SelectItem value="SOLD">Sold</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
