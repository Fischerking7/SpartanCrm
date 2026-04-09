import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Play, Zap, CheckCircle, XCircle, Clock } from "lucide-react";
import type { AutomationRule } from "@shared/schema";

const RULE_TYPES = [
  { value: "AUTO_APPROVE_ORDER", label: "Auto Approve Order" },
  { value: "AUTO_POST_IMPORT", label: "Auto Post Import" },
  { value: "AUTO_PAYROLL_READY", label: "Auto Payroll Ready" },
  { value: "ALERT_ON_EXCEPTION", label: "Alert on Exception" },
  { value: "ESCALATE_AFTER_DAYS", label: "Escalate After Days" },
];

const CONDITION_OPS = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "greater than or equal" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "less than or equal" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
];

const ORDER_FIELDS = [
  { value: "approvalStatus", label: "Approval Status" },
  { value: "jobStatus", label: "Job Status" },
  { value: "paymentStatus", label: "Payment Status" },
  { value: "baseCommissionEarned", label: "Base Commission" },
  { value: "chargebackRiskScore", label: "Chargeback Risk Score" },
  { value: "daysOld", label: "Days Old (Escalate)" },
  { value: "repId", label: "Rep ID" },
  { value: "clientId", label: "Client ID" },
  { value: "providerId", label: "Provider ID" },
];

const IMPORT_FIELDS = [
  { value: "status", label: "Status" },
  { value: "sourceType", label: "Source Type" },
];

const ACTION_TYPES_BY_RULE: Record<string, { value: string; label: string }[]> = {
  AUTO_APPROVE_ORDER: [{ value: "AUTO_APPROVE", label: "Auto Approve Order" }],
  AUTO_POST_IMPORT: [{ value: "AUTO_POST", label: "Auto Post Import" }],
  AUTO_PAYROLL_READY: [{ value: "SET_PAYROLL_READY", label: "Set Payroll Ready" }],
  ALERT_ON_EXCEPTION: [{ value: "CREATE_EXCEPTION", label: "Create Exception" }],
  ESCALATE_AFTER_DAYS: [{ value: "ESCALATE", label: "Escalate Order" }, { value: "CREATE_EXCEPTION", label: "Create Exception" }],
};

type Condition = { field: string; op: string; value: string };
type Action = { type: string; message?: string; exceptionType?: string; severity?: string };

const EMPTY_RULE = {
  name: "",
  description: "",
  ruleType: "AUTO_APPROVE_ORDER" as const,
  enabled: true,
  conditions: [] as Condition[],
  actions: [] as Action[],
};

function RuleTypeBadge({ ruleType }: { ruleType: string }) {
  const colors: Record<string, string> = {
    AUTO_APPROVE_ORDER: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    AUTO_POST_IMPORT: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    AUTO_PAYROLL_READY: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    ALERT_ON_EXCEPTION: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    ESCALATE_AFTER_DAYS: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  const label = RULE_TYPES.find(t => t.value === ruleType)?.label || ruleType;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[ruleType] || "bg-gray-100 text-gray-800"}`}>{label}</span>;
}

function TestRunDialog({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const { toast } = useToast();
  const [entityId, setEntityId] = useState("");
  const [result, setResult] = useState<{ matched: boolean; actions: string[]; error?: string; note?: string } | null>(null);

  const testMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/admin/automation-rules/${rule.id}/test`, {
        entityId,
      });
    },
    onSuccess: async (res: Response) => {
      const data = await res.json();
      setResult(data);
    },
    onError: (err: Error) => {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Dry Run: {rule.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>
              {rule.ruleType === "AUTO_POST_IMPORT" ? "Import ID" : "Order ID"}
            </Label>
            <Input
              data-testid="input-test-entity-id"
              placeholder={rule.ruleType === "AUTO_POST_IMPORT" ? "Enter import ID..." : "Enter order ID..."}
              value={entityId}
              onChange={e => setEntityId(e.target.value)}
            />
          </div>

          {result && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center gap-2">
                  {result.matched ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-medium">
                    {result.matched ? "Conditions matched" : "Conditions did not match"}
                  </span>
                </div>
                {result.matched && result.actions.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Would execute:</p>
                    <ul className="text-sm space-y-1">
                      {result.actions.map((a: string, i: number) => (
                        <li key={i} className="flex items-start gap-1">
                          <span className="text-blue-500 mt-0.5">•</span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.error && (
                  <p className="text-sm text-destructive">Error: {result.error}</p>
                )}
                <p className="text-xs text-muted-foreground italic">{result.note}</p>
              </CardContent>
            </Card>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            data-testid="button-run-test"
            onClick={() => testMutation.mutate()}
            disabled={!entityId || testMutation.isPending}
          >
            <Play className="h-4 w-4 mr-2" />
            {testMutation.isPending ? "Running..." : "Run Dry Test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleFormDialog({
  rule,
  onClose,
}: {
  rule?: AutomationRule;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!rule;

  const [form, setForm] = useState({
    name: rule?.name || EMPTY_RULE.name,
    description: rule?.description || EMPTY_RULE.description,
    ruleType: (rule?.ruleType || EMPTY_RULE.ruleType) as string,
    enabled: rule?.enabled ?? EMPTY_RULE.enabled,
    conditions: ((rule?.conditions as Condition[]) || []) as Condition[],
    actions: ((rule?.actions as Action[]) || []) as Action[],
  });

  const addCondition = () => {
    setForm(f => ({
      ...f,
      conditions: [...f.conditions, { field: "approvalStatus", op: "eq", value: "" }],
    }));
  };

  const removeCondition = (i: number) => {
    setForm(f => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }));
  };

  const updateCondition = (i: number, key: keyof Condition, value: string) => {
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, idx) => idx === i ? { ...c, [key]: value } : c),
    }));
  };

  const addAction = () => {
    const actionTypes = ACTION_TYPES_BY_RULE[form.ruleType] || [];
    const firstType = actionTypes[0]?.value || "AUTO_APPROVE";
    setForm(f => ({ ...f, actions: [...f.actions, { type: firstType }] }));
  };

  const removeAction = (i: number) => {
    setForm(f => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }));
  };

  const updateAction = (i: number, key: keyof Action, value: string) => {
    setForm(f => ({
      ...f,
      actions: f.actions.map((a, idx) => idx === i ? { ...a, [key]: value } : a),
    }));
  };

  const availableFields = form.ruleType === "AUTO_POST_IMPORT" ? IMPORT_FIELDS : ORDER_FIELDS;
  const availableActions = ACTION_TYPES_BY_RULE[form.ruleType] || [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        return apiRequest("PATCH", `/api/admin/automation-rules/${rule!.id}`, form);
      }
      return apiRequest("POST", "/api/admin/automation-rules", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/automation-rules"] });
      toast({ title: isEdit ? "Rule updated" : "Rule created" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error saving rule", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Automation Rule" : "New Automation Rule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Rule Name</Label>
              <Input
                data-testid="input-rule-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Auto-approve low-risk orders"
              />
            </div>
            <div className="col-span-2">
              <Label>Description (optional)</Label>
              <Textarea
                data-testid="input-rule-description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What does this rule do?"
                rows={2}
              />
            </div>
            <div>
              <Label>Rule Type</Label>
              {isEdit ? (
                <div className="mt-1">
                  <RuleTypeBadge ruleType={form.ruleType} />
                  <p className="text-xs text-muted-foreground mt-1">Rule type cannot be changed after creation.</p>
                </div>
              ) : (
                <Select
                  value={form.ruleType}
                  onValueChange={val => setForm(f => ({ ...f, ruleType: val, actions: [] }))}
                >
                  <SelectTrigger data-testid="select-rule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                data-testid="switch-rule-enabled"
                checked={form.enabled}
                onCheckedChange={val => setForm(f => ({ ...f, enabled: val }))}
              />
              <Label className="cursor-pointer" onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}>
                {form.enabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Conditions (all must match)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="button-add-condition"
                onClick={addCondition}
              >
                <Plus className="h-3 w-3 mr-1" /> Add Condition
              </Button>
            </div>
            {form.conditions.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No conditions — rule will match all entities.</p>
            )}
            <div className="space-y-2">
              {form.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={c.field} onValueChange={v => updateCondition(i, "field", v)}>
                    <SelectTrigger data-testid={`select-condition-field-${i}`} className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableFields.map(f => (
                        <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={c.op} onValueChange={v => updateCondition(i, "op", v)}>
                    <SelectTrigger data-testid={`select-condition-op-${i}`} className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_OPS.map(op => (
                        <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    data-testid={`input-condition-value-${i}`}
                    className="flex-1"
                    value={c.value}
                    onChange={e => updateCondition(i, "value", e.target.value)}
                    placeholder="value"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid={`button-remove-condition-${i}`}
                    onClick={() => removeCondition(i)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">Actions</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="button-add-action"
                onClick={addAction}
                disabled={availableActions.length === 0}
              >
                <Plus className="h-3 w-3 mr-1" /> Add Action
              </Button>
            </div>
            {form.actions.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No actions configured.</p>
            )}
            <div className="space-y-2">
              {form.actions.map((a, i) => (
                <div key={i} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Select value={a.type} onValueChange={v => updateAction(i, "type", v)}>
                      <SelectTrigger data-testid={`select-action-type-${i}`} className="flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableActions.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-testid={`button-remove-action-${i}`}
                      onClick={() => removeAction(i)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  {(a.type === "CREATE_EXCEPTION" || a.type === "ESCALATE") && (
                    <Input
                      data-testid={`input-action-message-${i}`}
                      value={a.message || ""}
                      onChange={e => updateAction(i, "message", e.target.value)}
                      placeholder="Message / description"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-save-rule"
            onClick={() => saveMutation.mutate()}
            disabled={!form.name || saveMutation.isPending}
          >
            {saveMutation.isPending ? "Saving..." : isEdit ? "Update Rule" : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AutomationRulesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canMutate = user?.role === "ADMIN" || user?.role === "OPERATIONS";
  const [editRule, setEditRule] = useState<AutomationRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [testRule, setTestRule] = useState<AutomationRule | null>(null);
  const [deleteRule, setDeleteRule] = useState<AutomationRule | null>(null);

  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["/api/admin/automation-rules"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("PATCH", `/api/admin/automation-rules/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/automation-rules"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/automation-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/automation-rules"] });
      toast({ title: "Rule deleted" });
      setDeleteRule(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Automation Rules
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure rules that automatically trigger actions when conditions are met.
          </p>
        </div>
        {canMutate && (
          <Button data-testid="button-create-rule" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Rule
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : rules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No automation rules yet</p>
            <p className="text-sm mt-1">Create your first rule to automate workflows.</p>
            {canMutate && (
              <Button className="mt-4" onClick={() => setShowCreate(true)} data-testid="button-create-first-rule">
                <Plus className="h-4 w-4 mr-2" /> Create Rule
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <Card key={rule.id} data-testid={`card-rule-${rule.id}`} className={rule.enabled ? "" : "opacity-60"}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm" data-testid={`text-rule-name-${rule.id}`}>{rule.name}</h3>
                      <RuleTypeBadge ruleType={rule.ruleType} />
                      <Badge variant={rule.enabled ? "default" : "secondary"} className="text-xs">
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    {rule.description && (
                      <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span data-testid={`text-trigger-count-${rule.id}`}>
                        Triggered: <strong>{rule.triggerCount}</strong>
                      </span>
                      {rule.lastTriggeredAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last: {new Date(rule.lastTriggeredAt).toLocaleDateString()}
                        </span>
                      )}
                      {rule.lastError && (
                        <span className="text-destructive flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          Error: {rule.lastError.slice(0, 60)}
                        </span>
                      )}
                      <span>
                        {(rule.conditions as Condition[])?.length || 0} condition(s),{" "}
                        {(rule.actions as Action[])?.length || 0} action(s)
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canMutate && (
                      <Switch
                        data-testid={`switch-enable-${rule.id}`}
                        checked={rule.enabled}
                        onCheckedChange={val => toggleMutation.mutate({ id: rule.id, enabled: val })}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid={`button-test-${rule.id}`}
                      onClick={() => setTestRule(rule)}
                      title="Dry run"
                    >
                      <Play className="h-4 w-4 text-blue-500" />
                    </Button>
                    {canMutate && (
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-edit-${rule.id}`}
                        onClick={() => setEditRule(rule)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canMutate && (
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-delete-${rule.id}`}
                        onClick={() => setDeleteRule(rule)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <RuleFormDialog onClose={() => setShowCreate(false)} />}
      {editRule && <RuleFormDialog rule={editRule} onClose={() => setEditRule(null)} />}
      {testRule && <TestRunDialog rule={testRule} onClose={() => setTestRule(null)} />}

      {deleteRule && (
        <AlertDialog open onOpenChange={() => setDeleteRule(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Rule</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{deleteRule.name}"? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-testid="button-confirm-delete"
                onClick={() => deleteMutation.mutate(deleteRule.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
