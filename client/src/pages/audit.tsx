import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Search, History, Filter } from "lucide-react";
import type { AuditLog } from "@shared/schema";

export default function Audit() {
  const [searchTerm, setSearchTerm] = useState("");
  const [tableFilter, setTableFilter] = useState<string>("all");

  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/admin/audit"],
    queryFn: async () => {
      const res = await fetch("/api/admin/audit", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
  });

  const filteredLogs = logs?.filter((log) => {
    const matchesSearch =
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.recordId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.tableName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTable = tableFilter === "all" || log.tableName === tableFilter;
    return matchesSearch && matchesTable;
  });

  const tableNames = Array.from(new Set(logs?.map((log) => log.tableName) || [])).filter(Boolean);

  const getActionBadgeVariant = (action: string) => {
    if (action.includes("create") || action.includes("approve")) return "default";
    if (action.includes("update") || action.includes("import")) return "secondary";
    if (action.includes("delete") || action.includes("reject")) return "destructive";
    return "outline";
  };

  const columns = [
    {
      key: "createdAt",
      header: "Timestamp",
      cell: (row: AuditLog) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {new Date(row.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      cell: (row: AuditLog) => (
        <Badge variant={getActionBadgeVariant(row.action)}>
          {row.action}
        </Badge>
      ),
    },
    {
      key: "tableName",
      header: "Table",
      cell: (row: AuditLog) => (
        <span className="font-mono text-sm">{row.tableName}</span>
      ),
    },
    {
      key: "recordId",
      header: "Record ID",
      cell: (row: AuditLog) => (
        <span className="font-mono text-xs">
          {row.recordId ? `${row.recordId.slice(0, 8)}...` : "-"}
        </span>
      ),
    },
    {
      key: "userId",
      header: "User",
      cell: (row: AuditLog) => (
        <span className="font-mono text-sm">
          {row.userId ? row.userId.slice(0, 8) : "System"}
        </span>
      ),
    },
    {
      key: "changes",
      header: "Changes",
      cell: (row: AuditLog) => (
        <div className="max-w-[200px]">
          {row.beforeJson || row.afterJson ? (
            <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
              {row.afterJson ? row.afterJson.slice(0, 50) + "..." : "Deleted"}
            </code>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </div>
      ),
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
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-audit"
              />
            </div>
            <Select value={tableFilter} onValueChange={setTableFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-table-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by table" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tables</SelectItem>
                {tableNames.map((table) => (
                  <SelectItem key={table} value={table}>{table}</SelectItem>
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
