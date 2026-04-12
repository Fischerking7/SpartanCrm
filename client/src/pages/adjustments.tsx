import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { DataTable } from "@/components/data-table";
import { ApprovalStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, CheckCircle, XCircle } from "lucide-react";
import type { Adjustment, User } from "@shared/schema";

export default function Adjustments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [formData, setFormData] = useState({
    payeeUserId: "",
    type: "BONUS",
    amount: "",
    reason: "",
    adjustmentDate: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })(),
  });

  const isAdmin = user?.role === "ADMIN" || user?.role === "OPERATIONS";
  const canApprove = isAdmin || user?.role === "EXECUTIVE";

  const { data: adjustments, isLoading } = useQuery<Adjustment[]>({
    queryKey: ["/api/adjustments"],
    queryFn: async () => {
      const res = await fetch("/api/adjustments", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch adjustments");
      return res.json();
    },
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: canApprove,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/adjustments", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          payeeType: "REP",
          amount: parseFloat(data.amount),
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create adjustment");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/adjustments"] });
      setShowCreateDialog(false);
      setFormData({
        payeeUserId: "",
        type: "BONUS",
        amount: "",
        reason: "",
        adjustmentDate: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })(),
      });
      toast({ title: t("adjustments.toasts.created") });
    },
    onError: (error: Error) => {
      toast({ title: t("adjustments.toasts.createFailed"), description: error.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (adjustmentId: string) => {
      const res = await fetch(`/api/admin/adjustments/${adjustmentId}/approve`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to approve");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/adjustments"] });
      toast({ title: t("adjustments.toasts.approved") });
    },
    onError: (error: Error) => {
      toast({ title: t("adjustments.toasts.approveFailed"), description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (adjustmentId: string) => {
      const res = await fetch(`/api/admin/adjustments/${adjustmentId}/reject`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reject");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/adjustments"] });
      toast({ title: t("adjustments.toasts.rejected") });
    },
    onError: (error: Error) => {
      toast({ title: t("adjustments.toasts.rejectFailed"), description: error.message, variant: "destructive" });
    },
  });

  const filteredAdjustments = adjustments?.filter((adj) =>
    adj.reason.toLowerCase().includes(searchTerm.toLowerCase()) ||
    adj.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: "adjustmentDate",
      header: t("adjustments.columns.date"),
      cell: (row: Adjustment) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.adjustmentDate).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "type",
      header: t("adjustments.columns.type"),
      cell: (row: Adjustment) => <Badge variant="outline">{row.type}</Badge>,
    },
    {
      key: "payeeType",
      header: t("adjustments.columns.payeeType"),
      cell: (row: Adjustment) => <Badge variant="secondary">{row.payeeType}</Badge>,
    },
    {
      key: "amount",
      header: t("adjustments.columns.amount"),
      cell: (row: Adjustment) => (
        <span className={`font-mono ${parseFloat(row.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
          {parseFloat(row.amount) >= 0 ? "+" : ""}${parseFloat(row.amount).toFixed(2)}
        </span>
      ),
      className: "text-right",
    },
    {
      key: "reason",
      header: t("adjustments.columns.reason"),
      cell: (row: Adjustment) => (
        <span className="text-sm truncate block max-w-[200px]">{row.reason}</span>
      ),
    },
    {
      key: "approvalStatus",
      header: t("adjustments.columns.status"),
      cell: (row: Adjustment) => <ApprovalStatusBadge status={row.approvalStatus} />,
    },
    ...(canApprove
      ? [
          {
            key: "actions",
            header: t("adjustments.columns.actions"),
            cell: (row: Adjustment) =>
              row.approvalStatus === "UNAPPROVED" ? (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => approveMutation.mutate(row.id)}
                    disabled={approveMutation.isPending}
                    data-testid={`button-approve-${row.id}`}
                  >
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    onClick={() => rejectMutation.mutate(row.id)}
                    disabled={rejectMutation.isPending}
                    data-testid={`button-reject-${row.id}`}
                  >
                    <XCircle className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">{t("adjustments.title")}</h1>
          <p className="text-muted-foreground">
            {canApprove ? t("adjustments.reviewDesc") : t("adjustments.submitDesc")}
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-adjustment">
          <Plus className="h-4 w-4 mr-2" />
          {t("adjustments.newAdjustment")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("adjustments.searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 max-w-md"
              data-testid="input-search-adjustments"
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredAdjustments || []}
            isLoading={isLoading}
            emptyMessage={t("adjustments.noAdjustments")}
            testId="table-adjustments"
          />
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("adjustments.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("adjustments.createDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isAdmin && (
              <div className="space-y-2">
                <Label>{t("adjustments.payee")}</Label>
                <Select
                  value={formData.payeeUserId}
                  onValueChange={(v) => setFormData({ ...formData, payeeUserId: v })}
                >
                  <SelectTrigger data-testid="select-payee">
                    <SelectValue placeholder={t("adjustments.selectUser")} />
                  </SelectTrigger>
                  <SelectContent>
                    {users?.filter(u => u.status === "ACTIVE" && u.id).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name} ({u.repId})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("adjustments.type")}</Label>
                <Select
                  value={formData.type}
                  onValueChange={(v) => setFormData({ ...formData, type: v })}
                >
                  <SelectTrigger data-testid="select-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BONUS">{t("adjustments.types.bonus")}</SelectItem>
                    <SelectItem value="CORRECTION">{t("adjustments.types.correction")}</SelectItem>
                    <SelectItem value="PENALTY">{t("adjustments.types.penalty")}</SelectItem>
                    <SelectItem value="ADVANCE">{t("adjustments.types.advance")}</SelectItem>
                    <SelectItem value="CLAWBACK">{t("adjustments.types.clawback")}</SelectItem>
                    <SelectItem value="OTHER">{t("adjustments.types.other")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("adjustments.amount")}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-amount"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("adjustments.date")}</Label>
              <Input
                type="date"
                value={formData.adjustmentDate}
                onChange={(e) => setFormData({ ...formData, adjustmentDate: e.target.value })}
                data-testid="input-date"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("adjustments.reason")}</Label>
              <Textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder={t("adjustments.reasonPlaceholder")}
                data-testid="input-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t("adjustments.cancel")}
            </Button>
            <Button
              onClick={() => createMutation.mutate(formData)}
              disabled={!formData.reason.trim() || !formData.amount || createMutation.isPending}
              data-testid="button-submit-adjustment"
            >
              {t("adjustments.submitAdjustment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
