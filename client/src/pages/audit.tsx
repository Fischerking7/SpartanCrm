import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, History, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AuditLog, User } from "@shared/schema";

const ACTION_LABELS: Record<string, string> = {
  create_order: "Created Order",
  update_order: "Updated Order",
  approve_order: "Approved Order",
  reject_order: "Rejected Order",
  delete_order: "Deleted Order",
  cancel_order: "Canceled Order",
  complete_order: "Completed Order",
  create_user: "Created User",
  update_user: "Updated User",
  delete_user: "Deleted User",
  password_reset: "Reset Password",
  password_change: "Changed Password",
  login: "Logged In",
  logout: "Logged Out",
  create_rate_card: "Created Rate Card",
  update_rate_card: "Updated Rate Card",
  delete_rate_card: "Deleted Rate Card",
  create_incentive: "Created Incentive",
  update_incentive: "Updated Incentive",
  delete_incentive: "Deleted Incentive",
  create_provider: "Created Provider",
  update_provider: "Updated Provider",
  create_client: "Created Client",
  update_client: "Updated Client",
  create_service: "Created Service",
  update_service: "Updated Service",
  leads_import: "Imported Leads",
  leads_export: "Exported Leads",
  leads_delete: "Deleted Leads",
  leads_bulk_delete: "Bulk Deleted Leads",
  lead_assign: "Assigned Lead",
  lead_disposition: "Updated Lead Disposition",
  lead_reverse_disposition: "Reversed Lead Disposition",
  create_pay_run: "Created Pay Run",
  update_pay_run: "Updated Pay Run",
  finalize_pay_run: "Finalized Pay Run",
  approve_pay_run: "Approved Pay Run",
  reject_pay_run: "Rejected Pay Run",
  orders_import: "Imported Orders",
  create_chargeback: "Created Chargeback",
  update_chargeback: "Updated Chargeback",
  create_adjustment: "Created Adjustment",
  update_adjustment: "Updated Adjustment",
  recalculate_commissions: "Recalculated Commissions",
  create_override: "Created Override Agreement",
  update_override: "Updated Override Agreement",
  delete_override: "Deleted Override Agreement",
  qb_sync: "QuickBooks Sync",
  qb_connect: "Connected QuickBooks",
  qb_disconnect: "Disconnected QuickBooks",
  payment_import: "Imported Payments",
  finance_import: "Imported Finance Data",
  create_deduction: "Created Deduction",
  update_deduction: "Updated Deduction",
  create_advance: "Created Advance",
  update_advance: "Updated Advance",
  mdu_order_approve: "Approved MDU Order",
  mdu_order_reject: "Rejected MDU Order",
};

function formatActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Audit() {
  const [searchTerm, setSearchTerm] = useState("");
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/admin/audit"],
    queryFn: async () => {
      const res = await fetch("/api/admin/audit", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
  });

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
  });

  const userMap = useMemo(() => {
    const map = new Map<string, { name: string; repId: string; role: string }>();
    users?.forEach((u) => {
      map.set(u.id, { name: u.name, repId: u.repId, role: u.role });
    });
    return map;
  }, [users]);

  const filteredLogs = logs?.filter((log) => {
    const userInfo = log.userId ? userMap.get(log.userId) : null;
    const userName = userInfo?.name || "";
    const userRepId = userInfo?.repId || "";
    const actionLabel = formatActionLabel(log.action);
    const matchesSearch =
      actionLabel.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.recordId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.tableName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      userRepId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTable = tableFilter === "all" || log.tableName === tableFilter;
    return matchesSearch && matchesTable;
  });

  const tableNames = Array.from(new Set(logs?.map((log) => log.tableName) || [])).filter(Boolean).sort();

  const getActionBadgeVariant = (action: string): "default" | "secondary" | "destructive" | "outline" => {
    if (action.includes("create") || action.includes("approve") || action.includes("finalize")) return "default";
    if (action.includes("update") || action.includes("import") || action.includes("recalculate")) return "secondary";
    if (action.includes("delete") || action.includes("reject") || action.includes("cancel")) return "destructive";
    return "outline";
  };

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatChanges = (json: string | null) => {
    if (!json) return null;
    try {
      const parsed = JSON.parse(json);
      return Object.entries(parsed).map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs py-0.5">
          <span className="text-muted-foreground font-medium min-w-[100px]">{key}:</span>
          <span className="break-all">{String(value)}</span>
        </div>
      ));
    } catch {
      return <span className="text-xs break-all">{json}</span>;
    }
  };

  const columns = [
    {
      key: "createdAt",
      header: "When",
      cell: (row: AuditLog) => (
        <div className="whitespace-nowrap">
          <div className="text-sm">{new Date(row.createdAt).toLocaleDateString()}</div>
          <div className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleTimeString()}</div>
        </div>
      ),
    },
    {
      key: "userId",
      header: "User",
      cell: (row: AuditLog) => {
        const userInfo = row.userId ? userMap.get(row.userId) : null;
        if (!userInfo) {
          return <span className="text-sm text-muted-foreground">System</span>;
        }
        return (
          <div>
            <div className="text-sm font-medium" data-testid={`text-audit-user-${row.id}`}>{userInfo.name}</div>
            <div className="text-xs text-muted-foreground">{userInfo.repId} - {userInfo.role}</div>
          </div>
        );
      },
    },
    {
      key: "action",
      header: "Action",
      cell: (row: AuditLog) => (
        <Badge variant={getActionBadgeVariant(row.action)} data-testid={`badge-audit-action-${row.id}`}>
          {formatActionLabel(row.action)}
        </Badge>
      ),
    },
    {
      key: "tableName",
      header: "Area",
      cell: (row: AuditLog) => (
        <span className="text-sm capitalize">{row.tableName.replace(/_/g, " ")}</span>
      ),
    },
    {
      key: "changes",
      header: "Details",
      cell: (row: AuditLog) => {
        const hasDetails = row.beforeJson || row.afterJson;
        if (!hasDetails) {
          return <span className="text-xs text-muted-foreground">-</span>;
        }
        const isExpanded = expandedRows.has(row.id);
        return (
          <div className="max-w-[300px]">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleRow(row.id)}
              className="gap-1 text-xs"
              data-testid={`button-expand-audit-${row.id}`}
            >
              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {isExpanded ? "Hide" : "View"} Details
            </Button>
            {isExpanded && (
              <div className="mt-2 space-y-2 border-l-2 border-muted pl-3">
                {row.afterJson && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      {row.beforeJson ? "Updated Values" : "Details"}
                    </div>
                    {formatChanges(row.afterJson)}
                  </div>
                )}
                {row.beforeJson && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Previous Values</div>
                    {formatChanges(row.beforeJson)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <History className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-muted-foreground">
            Track all system changes and user actions
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by user, action, or area..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-audit"
              />
            </div>
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-table-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by area" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Areas</SelectItem>
                {tableNames.map((table) => (
                  <SelectItem key={table} value={table}>
                    {table.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredLogs || []}
            isLoading={isLoading}
            emptyMessage="No audit logs found"
            testId="table-audit-logs"
          />
        </CardContent>
      </Card>
    </div>
  );
}
