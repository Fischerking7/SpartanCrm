import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Calendar, Lock, Check } from "lucide-react";
import type { PayRun } from "@shared/schema";

export default function PayRuns() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [weekEndingDate, setWeekEndingDate] = useState("");

  const { data: payRuns, isLoading } = useQuery<PayRun[]>({
    queryKey: ["/api/admin/payruns"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch pay runs");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (date: string) => {
      const res = await fetch("/api/admin/payruns", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ weekEndingDate: date }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create pay run");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      setShowCreateDialog(false);
      setWeekEndingDate("");
      toast({ title: "Pay run created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create pay run", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (payRunId: string) => {
      const res = await fetch(`/api/admin/payruns/${payRunId}/finalize`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to finalize");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payruns"] });
      toast({ title: "Pay run finalized" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to finalize", description: error.message, variant: "destructive" });
    },
  });

  const columns = [
    {
      key: "weekEndingDate",
      header: "Week Ending",
      cell: (row: PayRun) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">
            {new Date(row.weekEndingDate).toLocaleDateString()}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row: PayRun) => (
        <Badge variant={row.status === "FINALIZED" ? "default" : "secondary"}>
          {row.status === "FINALIZED" ? (
            <><Lock className="h-3 w-3 mr-1" />Finalized</>
          ) : (
            <>Draft</>
          )}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      cell: (row: PayRun) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "finalizedAt",
      header: "Finalized",
      cell: (row: PayRun) => (
        <span className="text-sm text-muted-foreground">
          {row.finalizedAt ? new Date(row.finalizedAt).toLocaleString() : "-"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row: PayRun) => (
        row.status === "DRAFT" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => finalizeMutation.mutate(row.id)}
            disabled={finalizeMutation.isPending}
            data-testid={`button-finalize-${row.id}`}
          >
            <Check className="h-4 w-4 mr-1" />
            Finalize
          </Button>
        ) : null
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Pay Runs</h1>
          <p className="text-muted-foreground">
            Manage weekly payment cycles
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-payrun">
          <Plus className="h-4 w-4 mr-2" />
          New Pay Run
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={payRuns || []}
            isLoading={isLoading}
            emptyMessage="No pay runs yet"
            testId="table-payruns"
          />
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Pay Run</DialogTitle>
            <DialogDescription>
              Create a new weekly pay run for payment processing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Week Ending Date</Label>
              <Input
                type="date"
                value={weekEndingDate}
                onChange={(e) => setWeekEndingDate(e.target.value)}
                data-testid="input-week-ending-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(weekEndingDate)}
              disabled={!weekEndingDate || createMutation.isPending}
              data-testid="button-confirm-create-payrun"
            >
              Create Pay Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
