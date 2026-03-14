import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  Upload, FileSpreadsheet, CheckCircle, XCircle, X, Users, Trash2, Calendar, User
} from "lucide-react";

interface ImportSort {
  importDate: string;
  importedBy: string;
  repId: string;
  count: number;
  importerName: string;
  repName: string;
}

export default function OpsLeadImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("import");
  const [targetRepId, setTargetRepId] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [sortsFilterRepId, setSortsFilterRepId] = useState("__all__");
  const [deletingSortKey, setDeletingSortKey] = useState<string | null>(null);

  const { data: usersData } = useQuery<any>({
    queryKey: ["/api/admin/users"],
  });

  const users = usersData?.users || usersData || [];
  const eligibleUsers = Array.isArray(users)
    ? users.filter((u: any) => ["REP", "LEAD", "MANAGER"].includes(u.role) && u.status === "ACTIVE")
    : [];

  const sortsQueryRepId = sortsFilterRepId === "__all__" ? "__all_team__" : sortsFilterRepId;
  const { data: importSorts, isLoading: sortsLoading } = useQuery<ImportSort[]>({
    queryKey: ["/api/leads/sorts", sortsQueryRepId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sortsQueryRepId !== "__all_team__") params.set("viewRepId", sortsQueryRepId);
      else params.set("viewRepId", "__all_team__");
      const res = await fetch(`/api/leads/sorts?${params.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch sorts");
      return res.json();
    },
    enabled: activeTab === "sorts",
  });

  const exportLeadsBeforeDelete = async (params: any) => {
    try {
      const res = await fetch("/api/leads/export-for-delete", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `deleted-leads-export-${new Date().toISOString().split("T")[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Export before delete failed:", err);
    }
  };

  const deleteSortMutation = useMutation({
    mutationFn: async (sort: ImportSort) => {
      await exportLeadsBeforeDelete({ mode: "sort", importDate: sort.importDate, importedBy: sort.importedBy, repId: sort.repId });
      const res = await fetch("/api/leads/sort-delete", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ importDate: sort.importDate, importedBy: sort.importedBy, repId: sort.repId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete sort");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/sorts"] });
      setDeletingSortKey(null);
      toast({ title: `Deleted ${data.deleted} leads from sort. Export downloaded.` });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete sort", description: error.message, variant: "destructive" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResult(null);
    }
    if (e.target) e.target.value = "";
  };

  const handleImport = async () => {
    if (!importFile || !targetRepId) return;

    setIsImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const authHeaders = getAuthHeaders() as { Authorization: string };
      const importUrl = `/api/leads/import?targetRepId=${encodeURIComponent(targetRepId)}`;

      const res = await fetch(importUrl, {
        method: "POST",
        headers: { Authorization: authHeaders.Authorization },
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.message || "Import failed");
      }

      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/sorts"] });

      if (result.success > 0) {
        toast({
          title: "Import completed",
          description: `Imported ${result.success} leads${result.failed > 0 ? `, ${result.failed} failed` : ""}${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const resetForm = () => {
    setImportFile(null);
    setImportResult(null);
  };

  const selectedUser = eligibleUsers.find((u: any) => u.repId === targetRepId);
  const sortsList = importSorts || [];
  const totalSortLeads = sortsList.reduce((s, sort) => s + sort.count, 0);

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-lead-import">
      <div>
        <h1 className="text-2xl font-bold">Leads Management</h1>
        <p className="text-sm text-muted-foreground">Import leads and manage lead sorts for your team</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{eligibleUsers.filter((u: any) => u.role === "REP").length}</p>
              <p className="text-xs text-muted-foreground">Active Reps</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{eligibleUsers.filter((u: any) => u.role === "LEAD").length}</p>
              <p className="text-xs text-muted-foreground">Active Leads</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Users className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{eligibleUsers.filter((u: any) => u.role === "MANAGER").length}</p>
              <p className="text-xs text-muted-foreground">Active Managers</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="leads-tabs">
          <TabsTrigger value="import" data-testid="tab-import">
            <Upload className="h-4 w-4 mr-1.5" /> Import
          </TabsTrigger>
          <TabsTrigger value="sorts" data-testid="tab-sorts">
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Manage Sorts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Select User</Label>
                <Select value={targetRepId} onValueChange={(v) => { setTargetRepId(v); setImportResult(null); }}>
                  <SelectTrigger className="h-11" data-testid="select-target-rep">
                    <SelectValue placeholder="Choose a rep, lead, or manager..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleUsers.filter((u: any) => u.role === "REP").length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Reps</div>
                        {eligibleUsers.filter((u: any) => u.role === "REP").map((u: any) => (
                          <SelectItem key={u.id} value={u.repId} data-testid={`option-rep-${u.repId}`}>
                            {u.name} ({u.repId})
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {eligibleUsers.filter((u: any) => u.role === "LEAD").length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Leads</div>
                        {eligibleUsers.filter((u: any) => u.role === "LEAD").map((u: any) => (
                          <SelectItem key={u.id} value={u.repId} data-testid={`option-lead-${u.repId}`}>
                            {u.name} ({u.repId})
                          </SelectItem>
                        ))}
                      </>
                    )}
                    {eligibleUsers.filter((u: any) => u.role === "MANAGER").length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Managers</div>
                        {eligibleUsers.filter((u: any) => u.role === "MANAGER").map((u: any) => (
                          <SelectItem key={u.id} value={u.repId} data-testid={`option-manager-${u.repId}`}>
                            {u.name} ({u.repId})
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
                {selectedUser && (
                  <p className="text-xs text-muted-foreground">
                    Importing for: <span className="font-medium text-foreground">{selectedUser.name}</span> — {selectedUser.role}
                  </p>
                )}
              </div>

              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer active:bg-muted/50 transition-colors"
                onClick={() => !importFile && fileInputRef.current?.click()}
                data-testid="dropzone-import-file"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-import-file"
                />
                {importFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileSpreadsheet className="h-6 w-6 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm truncate max-w-[250px]">{importFile.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={(e) => { e.stopPropagation(); resetForm(); }}
                      data-testid="btn-clear-file"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="font-medium text-sm">Click to select file</p>
                    <p className="text-xs text-muted-foreground">
                      Supports .xlsx, .xls, and .csv files
                    </p>
                  </div>
                )}
              </div>

              {importResult && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    {importResult.success > 0 && (
                      <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">{importResult.success} imported</span>
                      </div>
                    )}
                    {importResult.failed > 0 && (
                      <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                        <XCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">{importResult.failed} failed</span>
                      </div>
                    )}
                    {importResult.skipped > 0 && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="text-sm">{importResult.skipped} empty rows skipped</span>
                      </div>
                    )}
                  </div>
                  {importResult.errors?.length > 0 && (
                    <div className="max-h-40 overflow-y-auto text-sm text-muted-foreground border rounded p-2 space-y-1 bg-muted/30">
                      {importResult.errors.map((error: string, i: number) => (
                        <div key={i}>{error}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  onClick={handleImport}
                  disabled={!importFile || !targetRepId || isImporting}
                  className="bg-[#C9A84C] hover:bg-[#b8973e] text-white"
                  data-testid="btn-start-import"
                >
                  {isImporting ? "Importing..." : "Import Leads"}
                </Button>
                {importResult && (
                  <Button variant="outline" onClick={resetForm} data-testid="btn-import-another">
                    Import Another
                  </Button>
                )}
              </div>

              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-sm">Supported columns:</p>
                <p>Address: house number, street name, apt/unit, city, state, zip</p>
                <p>Customer: customer name, phone, email, account number</p>
                <p>Other: status, disco reason, notes</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sorts" className="mt-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex items-center gap-3">
              <Label className="text-sm font-medium whitespace-nowrap">Filter by user:</Label>
              <Select value={sortsFilterRepId} onValueChange={setSortsFilterRepId}>
                <SelectTrigger className="w-[220px]" data-testid="select-sorts-filter">
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Users</SelectItem>
                  {eligibleUsers.filter((u: any) => u.role === "REP").length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Reps</div>
                      {eligibleUsers.filter((u: any) => u.role === "REP").map((u: any) => (
                        <SelectItem key={u.id} value={u.repId}>{u.name} ({u.repId})</SelectItem>
                      ))}
                    </>
                  )}
                  {eligibleUsers.filter((u: any) => u.role === "LEAD").length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Leads</div>
                      {eligibleUsers.filter((u: any) => u.role === "LEAD").map((u: any) => (
                        <SelectItem key={u.id} value={u.repId}>{u.name} ({u.repId})</SelectItem>
                      ))}
                    </>
                  )}
                  {eligibleUsers.filter((u: any) => u.role === "MANAGER").length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Managers</div>
                      {eligibleUsers.filter((u: any) => u.role === "MANAGER").map((u: any) => (
                        <SelectItem key={u.id} value={u.repId}>{u.name} ({u.repId})</SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            {sortsList.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {sortsList.length} sort{sortsList.length !== 1 ? "s" : ""} &middot; {totalSortLeads} total leads
              </p>
            )}
          </div>

          {sortsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : sortsList.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="py-12 text-center">
                <FileSpreadsheet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No import sorts found{sortsFilterRepId !== "__all__" ? " for this user" : ""}.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sortsList.map((sort) => {
                const sortKey = `${sort.importDate}_${sort.importedBy}_${sort.repId}`;
                const isDeleting = deletingSortKey === sortKey;
                return (
                  <Card key={sortKey} className="border-0 shadow-sm" data-testid={`sort-card-${sortKey}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 text-sm">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium" data-testid={`text-sort-date-${sortKey}`}>
                                {new Date(sort.importDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                {" "}
                                {new Date(sort.importDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <Badge variant="secondary" data-testid={`badge-sort-count-${sortKey}`}>
                              {sort.count} leads
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              Rep: <span className="font-medium text-foreground">{sort.repName}</span>
                            </span>
                            <span>&middot;</span>
                            <span>Imported by: {sort.importerName}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isDeleting ? (
                            <>
                              <span className="text-xs text-destructive font-medium">Delete all {sort.count} leads?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => deleteSortMutation.mutate(sort)}
                                disabled={deleteSortMutation.isPending}
                                data-testid={`btn-confirm-sort-delete-${sortKey}`}
                              >
                                {deleteSortMutation.isPending ? "Deleting..." : "Confirm"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDeletingSortKey(null)}
                                data-testid={`btn-cancel-sort-delete-${sortKey}`}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive border-destructive/30 hover:bg-destructive/10"
                              onClick={() => setDeletingSortKey(sortKey)}
                              data-testid={`btn-delete-sort-${sortKey}`}
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Delete Sort
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Deleting a sort will remove all leads from that import batch. An export will automatically download before deletion.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
