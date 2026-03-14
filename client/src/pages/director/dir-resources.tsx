import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Target, Plus, FileText, Loader2 } from "lucide-react";

export default function DirResources() {
  const { toast } = useToast();
  const [docOpen, setDocOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docDescription, setDocDescription] = useState("");
  const [docCategory, setDocCategory] = useState("Training");
  const [goalUserId, setGoalUserId] = useState("");
  const [goalSalesTarget, setGoalSalesTarget] = useState("");
  const [goalConnectsTarget, setGoalConnectsTarget] = useState("");
  const [goalPeriod, setGoalPeriod] = useState("monthly");

  const { data: docs, isLoading: docsLoading } = useQuery<any[]>({ queryKey: ["/api/knowledge-documents"] });
  const { data: goals, isLoading: goalsLoading } = useQuery<any[]>({ queryKey: ["/api/admin/sales-goals"] });
  const { data: teamMembers } = useQuery<any[]>({ queryKey: ["/api/team/members"] });

  const createDoc = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/knowledge-documents", {
        title: docTitle,
        description: docDescription,
        category: docCategory,
        minimumRole: "REP",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge-documents"] });
      setDocOpen(false);
      setDocTitle("");
      setDocDescription("");
      toast({ title: "Document created" });
    },
    onError: () => toast({ title: "Failed to create document", variant: "destructive" }),
  });

  const createGoal = useMutation({
    mutationFn: async () => {
      const now = new Date();
      let periodStart: string, periodEnd: string;
      if (goalPeriod === "weekly") {
        const start = new Date(now);
        start.setDate(start.getDate() - start.getDay());
        periodStart = start.toISOString().split("T")[0];
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        periodEnd = end.toISOString().split("T")[0];
      } else {
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
      }
      await apiRequest("POST", "/api/admin/sales-goals", {
        userId: goalUserId,
        salesTarget: parseInt(goalSalesTarget) || 0,
        connectsTarget: parseInt(goalConnectsTarget) || 0,
        periodStart,
        periodEnd,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sales-goals"] });
      setGoalOpen(false);
      setGoalUserId("");
      setGoalSalesTarget("");
      setGoalConnectsTarget("");
      toast({ title: "Goal created" });
    },
    onError: () => toast({ title: "Failed to create goal", variant: "destructive" }),
  });

  const isLoading = docsLoading || goalsLoading;
  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;

  const categories = Array.from(new Set((docs || []).map((d: any) => d.category || "General")));

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="dir-resources">
      <h1 className="text-xl font-semibold">Knowledge & Goals</h1>

      <Tabs defaultValue="docs">
        <TabsList>
          <TabsTrigger value="docs" data-testid="tab-docs"><BookOpen className="h-3.5 w-3.5 mr-1" /> Documents</TabsTrigger>
          <TabsTrigger value="goals" data-testid="tab-goals"><Target className="h-3.5 w-3.5 mr-1" /> Sales Goals</TabsTrigger>
        </TabsList>

        <TabsContent value="docs">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Knowledge Documents</CardTitle>
                <Button size="sm" onClick={() => setDocOpen(true)} data-testid="button-add-doc">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Document
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {(!docs || docs.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-6">No documents yet. Add training materials, product updates, or field strategies.</p>
              )}
              {categories.map(cat => {
                const catDocs = (docs || []).filter((d: any) => (d.category || "General") === cat);
                if (catDocs.length === 0) return null;
                return (
                  <div key={cat} className="mb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-2">{cat}</p>
                    <div className="space-y-2">
                      {catDocs.map((d: any) => (
                        <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30" data-testid={`doc-${d.id}`}>
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{d.title}</p>
                            {d.description && <p className="text-xs text-muted-foreground truncate">{d.description}</p>}
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">{d.minimumRole || "ALL"}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="goals">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Sales Goals</CardTitle>
                <Button size="sm" onClick={() => setGoalOpen(true)} data-testid="button-set-goal">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Set New Goal
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3">Rep / Manager</th>
                      <th className="text-right p-3">Sales Goal</th>
                      <th className="text-right p-3">Connects Goal</th>
                      <th className="text-left p-3">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!goals || goals.length === 0) && (
                      <tr><td colSpan={4} className="text-center p-6 text-muted-foreground">No goals set</td></tr>
                    )}
                    {(goals || []).map((g: any) => {
                      const member = (teamMembers || []).find((m: any) => m.id === g.userId);
                      return (
                        <tr key={g.id} className="border-b hover:bg-muted/30" data-testid={`row-goal-${g.id}`}>
                          <td className="p-3 font-medium">{member?.name || g.userId?.slice(0, 8)}</td>
                          <td className="p-3 text-right">{g.salesTarget || "—"}</td>
                          <td className="p-3 text-right">{g.connectsTarget || "—"}</td>
                          <td className="p-3 text-muted-foreground text-xs">
                            {g.periodStart} — {g.periodEnd}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Knowledge Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="Document title" data-testid="input-doc-title" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={docDescription} onChange={e => setDocDescription(e.target.value)} placeholder="Brief description" rows={3} data-testid="input-doc-description" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={docCategory} onValueChange={setDocCategory}>
                <SelectTrigger data-testid="select-doc-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Training">Training</SelectItem>
                  <SelectItem value="Product Updates">Product Updates</SelectItem>
                  <SelectItem value="Field Strategies">Field Strategies</SelectItem>
                  <SelectItem value="Policies">Policies</SelectItem>
                  <SelectItem value="General">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocOpen(false)} data-testid="button-cancel-doc">Cancel</Button>
            <Button onClick={() => createDoc.mutate()} disabled={createDoc.isPending || !docTitle} data-testid="button-save-doc">
              {createDoc.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Save Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set New Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Rep / Manager</Label>
              <Select value={goalUserId} onValueChange={setGoalUserId}>
                <SelectTrigger data-testid="select-goal-user">
                  <SelectValue placeholder="Select team member" />
                </SelectTrigger>
                <SelectContent>
                  {(teamMembers || []).map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>{m.name} ({m.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sales Target</Label>
                <Input type="number" value={goalSalesTarget} onChange={e => setGoalSalesTarget(e.target.value)} placeholder="0" data-testid="input-sales-target" />
              </div>
              <div>
                <Label>Connects Target</Label>
                <Input type="number" value={goalConnectsTarget} onChange={e => setGoalConnectsTarget(e.target.value)} placeholder="0" data-testid="input-connects-target" />
              </div>
            </div>
            <div>
              <Label>Period</Label>
              <Select value={goalPeriod} onValueChange={setGoalPeriod}>
                <SelectTrigger data-testid="select-goal-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalOpen(false)} data-testid="button-cancel-goal">Cancel</Button>
            <Button onClick={() => createGoal.mutate()} disabled={createGoal.isPending || !goalUserId} data-testid="button-save-goal">
              {createGoal.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Set Goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
