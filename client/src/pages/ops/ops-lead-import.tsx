import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  Upload, FileSpreadsheet, CheckCircle, XCircle, X, Users, Download
} from "lucide-react";

export default function OpsLeadImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [targetRepId, setTargetRepId] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const { data: usersData } = useQuery<any>({
    queryKey: ["/api/admin/users"],
  });

  const users = usersData?.users || usersData || [];
  const eligibleUsers = Array.isArray(users)
    ? users.filter((u: any) => ["REP", "LEAD", "MANAGER"].includes(u.role) && u.status === "ACTIVE")
    : [];

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

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-lead-import">
      <div>
        <h1 className="text-2xl font-bold">Lead Import</h1>
        <p className="text-sm text-muted-foreground">Import leads for reps, leads, and managers</p>
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
    </div>
  );
}
