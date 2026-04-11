import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders, useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Users, Plus, CheckCircle2, Clock, Phone, MapPin, Calendar, UserCheck, Trash2 } from "lucide-react";

interface Referral {
  id: string;
  repId: string;
  referrerName: string;
  referrerPhone: string | null;
  referredName: string;
  referredPhone: string | null;
  referredAddress: string | null;
  notes: string | null;
  status: string;
  convertedOrderId: string | null;
  convertedAt: string | null;
  referralDate: string;
  createdAt: string;
}

interface FollowUp {
  id: string;
  repId: string;
  orderId: string | null;
  customerName: string;
  customerPhone: string | null;
  followUpDate: string;
  followUpType: string;
  notes: string | null;
  status: string;
  completedAt: string | null;
  completionNotes: string | null;
}

interface ReferralStats {
  total: number;
  converted: number;
  pending: number;
  conversionRate: string;
}

interface ReferralsData {
  referrals: Referral[];
  stats: ReferralStats;
}

interface FollowUpsData {
  overdue: FollowUp[];
  today: FollowUp[];
  upcoming: FollowUp[];
  completed: FollowUp[];
  total: number;
}

const followUpTypeLabels: Record<string, string> = {
  SATISFACTION_CALL: "Satisfaction Call",
  CHECK_IN: "Check-In",
  REFERRAL_ASK: "Referral Ask",
  RETENTION: "Retention",
  OTHER: "Other",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "CONVERTED") return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">Converted</Badge>;
  if (status === "PENDING") return <Badge variant="secondary">Pending</Badge>;
  if (status === "LOST") return <Badge variant="destructive">Lost</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function FollowUpTypeBadge({ type }: { type: string }) {
  return <Badge variant="outline" className="text-xs">{followUpTypeLabels[type] || type}</Badge>;
}

function AddReferralDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    referrerName: "",
    referrerPhone: "",
    referredName: "",
    referredPhone: "",
    referredAddress: "",
    notes: "",
    referralDate: new Date().toISOString().split("T")[0],
  });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/referrals", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      toast({ title: "Referral logged successfully" });
      setOpen(false);
      setForm({ referrerName: "", referrerPhone: "", referredName: "", referredPhone: "", referredAddress: "", notes: "", referralDate: new Date().toISOString().split("T")[0] });
    },
    onError: () => toast({ title: "Failed to log referral", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-referral">
          <Plus className="h-4 w-4 mr-2" />
          Log Referral
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Customer Referral</DialogTitle>
          <DialogDescription>Record a referral from an existing customer</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Referrer Name *</Label>
              <Input value={form.referrerName} onChange={e => setForm(f => ({ ...f, referrerName: e.target.value }))} placeholder="Existing customer" data-testid="input-referrer-name" />
            </div>
            <div>
              <Label>Referrer Phone</Label>
              <Input value={form.referrerPhone} onChange={e => setForm(f => ({ ...f, referrerPhone: e.target.value }))} placeholder="Phone number" data-testid="input-referrer-phone" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Referred Name *</Label>
              <Input value={form.referredName} onChange={e => setForm(f => ({ ...f, referredName: e.target.value }))} placeholder="Referred person" data-testid="input-referred-name" />
            </div>
            <div>
              <Label>Referred Phone</Label>
              <Input value={form.referredPhone} onChange={e => setForm(f => ({ ...f, referredPhone: e.target.value }))} placeholder="Phone number" data-testid="input-referred-phone" />
            </div>
          </div>
          <div>
            <Label>Referred Address</Label>
            <Input value={form.referredAddress} onChange={e => setForm(f => ({ ...f, referredAddress: e.target.value }))} placeholder="Address" data-testid="input-referred-address" />
          </div>
          <div>
            <Label>Referral Date</Label>
            <Input type="date" value={form.referralDate} onChange={e => setForm(f => ({ ...f, referralDate: e.target.value }))} data-testid="input-referral-date" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any context..." rows={2} data-testid="input-referral-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.referrerName || !form.referredName || mutation.isPending}
            data-testid="button-submit-referral"
          >
            {mutation.isPending ? "Saving..." : "Log Referral"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddFollowUpDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    followUpDate: (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split("T")[0]; })(),
    followUpType: "SATISFACTION_CALL",
    notes: "",
  });

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/post-install-followups", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-install-followups"] });
      toast({ title: "Follow-up scheduled" });
      setOpen(false);
      setForm({ customerName: "", customerPhone: "", followUpDate: (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split("T")[0]; })(), followUpType: "SATISFACTION_CALL", notes: "" });
    },
    onError: () => toast({ title: "Failed to schedule follow-up", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-add-followup">
          <Plus className="h-4 w-4 mr-2" />
          Schedule Follow-Up
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule Post-Install Follow-Up</DialogTitle>
          <DialogDescription>Set a reminder to check in with a recent customer</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Customer Name *</Label>
              <Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Customer name" data-testid="input-followup-customer-name" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} placeholder="Phone number" data-testid="input-followup-phone" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Follow-Up Date</Label>
              <Input type="date" value={form.followUpDate} onChange={e => setForm(f => ({ ...f, followUpDate: e.target.value }))} data-testid="input-followup-date" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.followUpType} onValueChange={v => setForm(f => ({ ...f, followUpType: v }))}>
                <SelectTrigger data-testid="select-followup-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(followUpTypeLabels).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes..." rows={2} data-testid="input-followup-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.customerName || mutation.isPending}
            data-testid="button-submit-followup"
          >
            {mutation.isPending ? "Saving..." : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpItem({ item, onComplete, onCancel }: { item: FollowUp; onComplete: (id: string) => void; onCancel: (id: string) => void }) {
  const today = new Date().toISOString().split("T")[0];
  const isOverdue = item.followUpDate < today && item.status === "SCHEDULED";

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${isOverdue ? "border-red-200 bg-red-50/30 dark:border-red-800 dark:bg-red-950/20" : "border-border"}`}
      data-testid={`followup-item-${item.id}`}
    >
      <div className="shrink-0 mt-0.5">
        <Phone className={`h-4 w-4 ${isOverdue ? "text-red-500" : "text-primary"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{item.customerName}</span>
          {isOverdue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
          <FollowUpTypeBadge type={item.followUpType} />
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(item.followUpDate + "T00:00:00").toLocaleDateString()}
          </span>
          {item.customerPhone && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {item.customerPhone}
            </span>
          )}
        </div>
        {item.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{item.notes}</p>}
      </div>
      {item.status === "SCHEDULED" && (
        <div className="flex gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700" onClick={() => onComplete(item.id)} data-testid={`button-complete-${item.id}`}>
            <CheckCircle2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onCancel(item.id)} data-testid={`button-cancel-${item.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Referrals() {
  const { toast } = useToast();

  const { data: referralsData, isLoading: referralsLoading } = useQuery<ReferralsData>({
    queryKey: ["/api/referrals"],
    queryFn: async () => {
      const res = await fetch("/api/referrals", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: followUpsData, isLoading: followUpsLoading } = useQuery<FollowUpsData>({
    queryKey: ["/api/post-install-followups"],
    queryFn: async () => {
      const res = await fetch("/api/post-install-followups", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const markReferralMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/referrals/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      toast({ title: "Referral updated" });
    },
    onError: () => toast({ title: "Failed to update referral", variant: "destructive" }),
  });

  const completeFollowUpMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/post-install-followups/${id}`, { status: "COMPLETED" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-install-followups"] });
      toast({ title: "Follow-up marked complete" });
    },
    onError: () => toast({ title: "Failed to complete follow-up", variant: "destructive" }),
  });

  const cancelFollowUpMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/post-install-followups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/post-install-followups"] });
      toast({ title: "Follow-up cancelled" });
    },
    onError: () => toast({ title: "Failed to cancel follow-up", variant: "destructive" }),
  });

  const stats = referralsData?.stats;
  const urgentCount = (followUpsData?.overdue.length || 0) + (followUpsData?.today.length || 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Referrals & Follow-Ups</h1>
          <p className="text-muted-foreground">Track customer referrals and post-install check-ins</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <AddFollowUpDialog />
          <AddReferralDialog />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold" data-testid="text-total-referrals">{stats?.total ?? 0}</div>
            <div className="text-xs text-muted-foreground">Total Referrals</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-converted-referrals">{stats?.converted ?? 0}</div>
            <div className="text-xs text-muted-foreground">Converted</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-primary" data-testid="text-conversion-rate">{stats?.conversionRate ?? "0"}%</div>
            <div className="text-xs text-muted-foreground">Conversion Rate</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${urgentCount > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-urgent-followups">{urgentCount}</div>
            <div className="text-xs text-muted-foreground">Urgent Follow-Ups</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="followups">
        <TabsList>
          <TabsTrigger value="followups" data-testid="tab-followups">
            Follow-Ups
            {urgentCount > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs px-1.5 py-0 h-4">{urgentCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="referrals" data-testid="tab-referrals">Referrals</TabsTrigger>
        </TabsList>

        <TabsContent value="followups" className="space-y-4 mt-4">
          {followUpsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (
            <>
              {(followUpsData?.overdue.length || 0) > 0 && (
                <div>
                  <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-2 flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    Overdue ({followUpsData?.overdue.length})
                  </div>
                  <div className="space-y-2">
                    {followUpsData?.overdue.map(item => (
                      <FollowUpItem
                        key={item.id}
                        item={item}
                        onComplete={(id) => completeFollowUpMutation.mutate(id)}
                        onCancel={(id) => cancelFollowUpMutation.mutate(id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(followUpsData?.today.length || 0) > 0 && (
                <div>
                  <div className="text-sm font-medium text-primary mb-2 flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    Today ({followUpsData?.today.length})
                  </div>
                  <div className="space-y-2">
                    {followUpsData?.today.map(item => (
                      <FollowUpItem
                        key={item.id}
                        item={item}
                        onComplete={(id) => completeFollowUpMutation.mutate(id)}
                        onCancel={(id) => cancelFollowUpMutation.mutate(id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(followUpsData?.upcoming.length || 0) > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">Upcoming ({followUpsData?.upcoming.length})</div>
                  <div className="space-y-2">
                    {followUpsData?.upcoming.map(item => (
                      <FollowUpItem
                        key={item.id}
                        item={item}
                        onComplete={(id) => completeFollowUpMutation.mutate(id)}
                        onCancel={(id) => cancelFollowUpMutation.mutate(id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(followUpsData?.completed.length || 0) > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">Recently Completed ({followUpsData?.completed.length})</div>
                  <div className="space-y-2">
                    {followUpsData?.completed.slice(0, 5).map(item => (
                      <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-muted/30 opacity-70" data-testid={`followup-completed-${item.id}`}>
                        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{item.customerName}</span>
                          <span className="text-xs text-muted-foreground ml-2">{followUpTypeLabels[item.followUpType]}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{item.completedAt ? new Date(item.completedAt).toLocaleDateString() : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!followUpsData?.overdue.length && !followUpsData?.today.length && !followUpsData?.upcoming.length && !followUpsData?.completed.length && (
                <div className="text-center py-12 text-muted-foreground">
                  <Phone className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No follow-ups scheduled</p>
                  <p className="text-xs mt-1">Schedule post-install check-ins to stay connected with your customers</p>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="referrals" className="space-y-4 mt-4">
          {referralsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : referralsData && referralsData.referrals.length > 0 ? (
            <div className="space-y-2">
              {referralsData.referrals.map((ref) => (
                <div key={ref.id} className="border rounded-lg p-3" data-testid={`referral-item-${ref.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{ref.referredName}</span>
                        <StatusBadge status={ref.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3" />
                          Referred by {ref.referrerName}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(ref.referralDate + "T00:00:00").toLocaleDateString()}
                        </span>
                        {ref.referredPhone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {ref.referredPhone}
                          </span>
                        )}
                        {ref.referredAddress && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {ref.referredAddress}
                          </span>
                        )}
                      </div>
                      {ref.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{ref.notes}</p>}
                    </div>
                    {ref.status === "PENDING" && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 h-7 text-xs"
                          onClick={() => markReferralMutation.mutate({ id: ref.id, status: "CONVERTED" })}
                          data-testid={`button-convert-${ref.id}`}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Converted
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-7 text-xs"
                          onClick={() => markReferralMutation.mutate({ id: ref.id, status: "LOST" })}
                          data-testid={`button-lost-${ref.id}`}
                        >
                          Lost
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No referrals logged yet</p>
              <p className="text-xs mt-1">Log referrals from satisfied customers to track your conversion pipeline</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
