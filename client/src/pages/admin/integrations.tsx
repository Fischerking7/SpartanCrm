import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  Mail, Server, Key, Calendar, Webhook, Plus, Trash2, Copy, Eye, EyeOff, CheckCircle, Clock, AlertTriangle, Activity
} from "lucide-react";

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Integrations() {
  const { toast } = useToast();
  const [showNewSchedule, setShowNewSchedule] = useState(false);
  const [showNewKey, setShowNewKey] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showKeyValue, setShowKeyValue] = useState(false);

  const { data: schedules, isLoading: schedulesLoading } = useQuery<any[]>({ queryKey: ["/api/admin/carrier-schedules"] });
  const { data: apiKeysData, isLoading: keysLoading } = useQuery<any[]>({ queryKey: ["/api/admin/api-keys"] });
  const { data: calConfig } = useQuery<any>({ queryKey: ["/api/admin/calendar-config"] });
  const { data: logs } = useQuery<any[]>({
    queryKey: ["/api/admin/integration-logs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/integration-logs?limit=30", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load integration logs");
      return res.json();
    },
  });
  const { data: clientsList } = useQuery<any[]>({ queryKey: ["/api/clients"] });

  const [scheduleForm, setScheduleForm] = useState<any>({ clientId: "", sourceType: "email", emailTriggerDomain: "", sftpHost: "", sftpUser: "", sftpRemotePath: "", fileNamePattern: "", frequency: "daily" });
  const [keyForm, setKeyForm] = useState({ name: "", scopes: "production-summary,ar-status,payroll-summary" });

  const createSchedule = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/admin/carrier-schedules", scheduleForm); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-schedules"] });
      setShowNewSchedule(false);
      toast({ title: "Carrier schedule created" });
    },
    onError: () => toast({ title: "Failed to create schedule", variant: "destructive" }),
  });

  const toggleSchedule = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/admin/carrier-schedules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-schedules"] });
      toast({ title: "Schedule updated" });
    },
    onError: () => toast({ title: "Failed to update schedule", variant: "destructive" }),
  });

  const deleteSchedule = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/admin/carrier-schedules/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/carrier-schedules"] });
      toast({ title: "Schedule deleted" });
    },
    onError: () => toast({ title: "Failed to delete schedule", variant: "destructive" }),
  });

  const createApiKey = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/api-keys", keyForm);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setNewKey(data.rawKey);
      setShowNewKey(false);
      toast({ title: "API key created" });
    },
    onError: () => toast({ title: "Failed to create key", variant: "destructive" }),
  });

  const revokeKey = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/admin/api-keys/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      toast({ title: "API key revoked" });
    },
    onError: () => toast({ title: "Failed to revoke key", variant: "destructive" }),
  });

  if (schedulesLoading || keysLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" data-testid="integrations-page">
      <h1 className="text-xl font-semibold">Integration Settings</h1>

      <Tabs defaultValue="carrier">
        <TabsList>
          <TabsTrigger value="carrier" data-testid="tab-carrier"><Mail className="h-3.5 w-3.5 mr-1" /> Carrier Automation</TabsTrigger>
          <TabsTrigger value="webhooks" data-testid="tab-webhooks"><Webhook className="h-3.5 w-3.5 mr-1" /> API Keys & Webhooks</TabsTrigger>
          <TabsTrigger value="calendar" data-testid="tab-calendar"><Calendar className="h-3.5 w-3.5 mr-1" /> Calendar</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs"><Activity className="h-3.5 w-3.5 mr-1" /> Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="carrier">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Carrier File Import Schedules</CardTitle>
                <Button size="sm" onClick={() => setShowNewSchedule(true)} data-testid="button-new-schedule">
                  <Plus className="h-3.5 w-3.5 mr-1" /> New Schedule
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {(!schedules || schedules.length === 0) ? (
                <div className="text-center py-8">
                  <Server className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No carrier import schedules configured</p>
                  <p className="text-xs text-muted-foreground mt-1">Set up email or SFTP triggers to automate carrier file imports</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {schedules.map((s: any) => (
                    <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`carrier-schedule-${s.id}`}>
                      <div className="flex items-center gap-3">
                        {s.sourceType === "email" ? <Mail className="h-5 w-5 text-blue-500" /> : <Server className="h-5 w-5 text-green-500" />}
                        <div>
                          <p className="text-sm font-medium">{s.clientName}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.sourceType === "email" ? `Email: *@${s.emailTriggerDomain}` : `SFTP: ${s.sftpHost}:${s.sftpPort}${s.sftpRemotePath || "/"}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Last run: {fmt(s.lastRunAt)} {s.lastRunStatus && <span className="ml-1">({s.lastRunStatus})</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={s.isActive ? "text-green-600" : "text-muted-foreground"}>
                          {s.isActive ? "Active" : "Paused"}
                        </Badge>
                        <Switch checked={s.isActive} onCheckedChange={(v) => toggleSchedule.mutate({ id: s.id, isActive: v })} data-testid={`toggle-schedule-${s.id}`} />
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this schedule?")) deleteSchedule.mutate(s.id); }} data-testid={`delete-schedule-${s.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <p className="text-sm font-medium flex items-center gap-1.5"><Mail className="h-4 w-4" /> Email Webhook Endpoint</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Configure your email service to POST carrier emails to:
                </p>
                <code className="text-xs bg-muted px-2 py-1 rounded mt-1 block font-mono" data-testid="text-webhook-url">
                  POST /api/integrations/carrier-email-webhook
                </code>
                <p className="text-xs text-muted-foreground mt-1">Body: {"{"} from, subject, attachments: [{"{"} filename, content (base64) {"}"}] {"}"}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">API Keys</CardTitle>
                <Button size="sm" onClick={() => setShowNewKey(true)} data-testid="button-new-api-key">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Create API Key
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {newKey && (
                <div className="mb-4 p-3 rounded-lg bg-green-50/50 dark:bg-green-950/30 border border-green-200 dark:border-green-800" data-testid="section-new-key">
                  <p className="text-sm font-medium text-green-700 dark:text-green-300 flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4" /> API Key Created — Save it now
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1 overflow-x-auto">
                      {showKeyValue ? newKey : "•".repeat(40)}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => setShowKeyValue(!showKeyValue)} data-testid="button-toggle-key">
                      {showKeyValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(newKey); toast({ title: "Copied!" }); }} data-testid="button-copy-key">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => { setNewKey(null); setShowKeyValue(false); }}>Dismiss</Button>
                </div>
              )}

              {(!apiKeysData || apiKeysData.length === 0) ? (
                <div className="text-center py-6">
                  <Key className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No API keys yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {apiKeysData.map((k: any) => (
                    <div key={k.id} className={`flex items-center justify-between p-3 border rounded-lg ${!k.isActive ? "opacity-50" : ""}`} data-testid={`api-key-${k.id}`}>
                      <div>
                        <p className="text-sm font-medium">{k.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{k.keyPrefix}</p>
                        <p className="text-xs text-muted-foreground">
                          Scopes: {k.scopes} · Used {k.usageCount}x · Last: {fmt(k.lastUsedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={k.isActive ? "text-green-600" : "text-red-600"}>
                          {k.isActive ? "Active" : "Revoked"}
                        </Badge>
                        {k.isActive && (
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm("Revoke this API key?")) revokeKey.mutate(k.id); }} data-testid={`revoke-key-${k.id}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium">Available Webhook Endpoints</p>
                {[
                  { scope: "production-summary", path: "/api/v1/webhooks/production-summary", desc: "Current period production metrics" },
                  { scope: "ar-status", path: "/api/v1/webhooks/ar-status", desc: "AR pipeline status by status type" },
                  { scope: "payroll-summary", path: "/api/v1/webhooks/payroll-summary", desc: "Recent pay run summaries" },
                ].map(w => (
                  <div key={w.scope} className="p-2.5 border rounded-lg text-xs">
                    <div className="flex items-center justify-between">
                      <code className="font-mono font-medium">GET {w.path}</code>
                      <Badge variant="outline" className="text-[10px]">{w.scope}</Badge>
                    </div>
                    <p className="text-muted-foreground mt-0.5">{w.desc} · Add ?format=csv for CSV output</p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Authenticate with <code className="bg-muted px-1 rounded">X-Api-Key: ic_...</code> header</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Google Calendar Integration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Install Tracking Calendar</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Automatically sync order install dates to a shared Google Calendar
                      </p>
                    </div>
                    <Badge variant="outline" className={calConfig?.isActive ? "text-green-600" : "text-muted-foreground"} data-testid="badge-calendar-status">
                      {calConfig?.isActive ? "Connected" : "Not Connected"}
                    </Badge>
                  </div>
                  {calConfig?.calendarId && (
                    <p className="text-xs text-muted-foreground mt-2">Calendar ID: {calConfig.calendarId}</p>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-yellow-50/50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
                  <p className="text-sm flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    Google Calendar OAuth2 Setup Required
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    To enable live calendar sync, configure Google Cloud OAuth2 credentials and
                    set the Calendar ID. Events will be created for orders with install dates and
                    updated when install sync marks orders as completed.
                  </p>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>When connected, calendar events are created for:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>New orders with an install date set</li>
                    <li>Order install date updates</li>
                    <li>Install completion (event marked as done)</li>
                  </ul>
                  <p className="mt-2">Event includes: customer name, address, service type, assigned rep</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" /> Integration Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(!logs || logs.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">No integration activity yet</p>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {logs.map((log: any) => (
                    <div key={log.id} className="flex items-start gap-3 p-2.5 border rounded-lg text-xs" data-testid={`log-${log.id}`}>
                      <div className="mt-0.5">
                        {log.status === "SUCCESS" ? <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                          : log.status === "ERROR" ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                          : <Clock className="h-3.5 w-3.5 text-yellow-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{log.integrationType}</Badge>
                          <span className="font-medium">{log.action}</span>
                          <span className="text-muted-foreground ml-auto">{fmt(log.createdAt)}</span>
                        </div>
                        {log.details && (
                          <p className="text-muted-foreground mt-0.5 truncate">{log.details.substring(0, 200)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showNewSchedule} onOpenChange={setShowNewSchedule}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Carrier Import Schedule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Client</Label>
              <Select value={scheduleForm.clientId} onValueChange={v => setScheduleForm({ ...scheduleForm, clientId: v })}>
                <SelectTrigger data-testid="select-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>
                  {clientsList?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source Type</Label>
              <Select value={scheduleForm.sourceType} onValueChange={v => setScheduleForm({ ...scheduleForm, sourceType: v })}>
                <SelectTrigger data-testid="select-source-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email Trigger</SelectItem>
                  <SelectItem value="sftp">SFTP Polling</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scheduleForm.sourceType === "email" && (
              <div>
                <Label>Email Domain (e.g. att.com)</Label>
                <Input value={scheduleForm.emailTriggerDomain} onChange={e => setScheduleForm({ ...scheduleForm, emailTriggerDomain: e.target.value })} placeholder="carrier.com" data-testid="input-email-domain" />
              </div>
            )}
            {scheduleForm.sourceType === "sftp" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>SFTP Host</Label>
                    <Input value={scheduleForm.sftpHost} onChange={e => setScheduleForm({ ...scheduleForm, sftpHost: e.target.value })} placeholder="sftp.carrier.com" data-testid="input-sftp-host" />
                  </div>
                  <div>
                    <Label>Username</Label>
                    <Input value={scheduleForm.sftpUser} onChange={e => setScheduleForm({ ...scheduleForm, sftpUser: e.target.value })} data-testid="input-sftp-user" />
                  </div>
                </div>
                <div>
                  <Label>Remote Path</Label>
                  <Input value={scheduleForm.sftpRemotePath} onChange={e => setScheduleForm({ ...scheduleForm, sftpRemotePath: e.target.value })} placeholder="/outbox/commissions/" data-testid="input-sftp-path" />
                </div>
              </>
            )}
            <div>
              <Label>File Name Pattern (optional)</Label>
              <Input value={scheduleForm.fileNamePattern} onChange={e => setScheduleForm({ ...scheduleForm, fileNamePattern: e.target.value })} placeholder="commission_*.csv" data-testid="input-file-pattern" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewSchedule(false)}>Cancel</Button>
            <Button onClick={() => createSchedule.mutate()} disabled={!scheduleForm.clientId || createSchedule.isPending} data-testid="button-create-schedule">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewKey} onOpenChange={setShowNewKey}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create API Key</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Key Name</Label>
              <Input value={keyForm.name} onChange={e => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="BI Dashboard" data-testid="input-key-name" />
            </div>
            <div>
              <Label>Scopes (comma-separated)</Label>
              <Input value={keyForm.scopes} onChange={e => setKeyForm({ ...keyForm, scopes: e.target.value })} data-testid="input-key-scopes" />
              <p className="text-xs text-muted-foreground mt-1">Available: production-summary, ar-status, payroll-summary</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewKey(false)}>Cancel</Button>
            <Button onClick={() => createApiKey.mutate()} disabled={!keyForm.name || createApiKey.isPending} data-testid="button-create-key">Create Key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
