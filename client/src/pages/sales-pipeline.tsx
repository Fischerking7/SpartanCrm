import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Search, 
  Users, 
  Clock, 
  Phone,
  Mail,
  MapPin,
  History,
  Download,
  Filter,
  Trash2
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { dispositionMetadata, type Lead, type LeadDisposition } from "@shared/schema";

const DISPOSITION_COLORS: Record<string, string> = {
  "NONE": "bg-gray-500",
  "NOT_HOME": "bg-blue-500",
  "RETURN": "bg-yellow-500",
  "DOOR_SLAM_REJECT": "bg-red-500",
  "SHORT_PITCH": "bg-orange-500",
  "CALLED": "bg-purple-500",
  "EMAIL_SENT": "bg-pink-500",
  "CALL_NO_ANSWER": "bg-cyan-500",
  "SOLD": "bg-green-500",
};

function getDispositionLabel(value: string) {
  return dispositionMetadata.find(d => d.value === value)?.label || value;
}

function getDispositionColor(value: string) {
  return DISPOSITION_COLORS[value] || "bg-gray-500";
}

export default function SalesPipeline() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDisposition, setSelectedDisposition] = useState<string>("ALL");
  const [selectedRepId, setSelectedRepId] = useState<string>("ALL");
  const [historyDialog, setHistoryDialog] = useState<{ open: boolean; leadId: string | null; leadName: string }>({ 
    open: false, 
    leadId: null,
    leadName: ""
  });
  const [isExporting, setIsExporting] = useState(false);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(false);

  const canExport = ["OPERATIONS", "EXECUTIVE"].includes(user?.role || "");
  const canBulkDelete = ["OPERATIONS", "EXECUTIVE", "ADMIN"].includes(user?.role || "");

  const { data: leadPool, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads/pool", selectedRepId, selectedDisposition, searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedRepId && selectedRepId !== "ALL") params.set("repId", selectedRepId);
      if (selectedDisposition && selectedDisposition !== "ALL") params.set("disposition", selectedDisposition);
      if (searchTerm) params.set("search", searchTerm);
      const res = await fetch(`/api/leads/pool?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch lead pool");
      return res.json();
    },
  });

  const { data: reps } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<any[]>({
    queryKey: ["/api/leads", historyDialog.leadId, "history"],
    queryFn: async () => {
      if (!historyDialog.leadId) return [];
      const res = await fetch(`/api/leads/${historyDialog.leadId}/history`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!historyDialog.leadId,
  });

  const updateDispositionMutation = useMutation({
    mutationFn: async ({ leadId, disposition }: { leadId: string; disposition: string }) => {
      const res = await apiRequest("PATCH", `/api/leads/${leadId}/disposition`, { disposition });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads/pool"] });
      toast({ title: "Disposition updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update disposition", description: error.message, variant: "destructive" });
    },
  });

  const handleDispositionChange = (leadId: string, newDisposition: string) => {
    updateDispositionMutation.mutate({ leadId, disposition: newDisposition });
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: async (repId: string) => {
      const res = await apiRequest("DELETE", `/api/leads/by-user/${repId}`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads/pool"] });
      toast({ title: "Leads deleted", description: data.message });
      setDeleteConfirmDialog(false);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete leads", description: error.message, variant: "destructive" });
    },
  });

  const handleBulkDelete = () => {
    if (selectedRepId && selectedRepId !== "ALL") {
      bulkDeleteMutation.mutate(selectedRepId);
    }
  };

  const getSelectedRepName = () => {
    if (!selectedRepId || selectedRepId === "ALL") return "";
    const rep = reps?.find(r => r.repId === selectedRepId);
    return rep?.name || selectedRepId;
  };

  const openHistory = (lead: Lead) => {
    setHistoryDialog({ 
      open: true, 
      leadId: lead.id, 
      leadName: lead.customerName || "Unknown"
    });
  };

  const getRepName = (repId: string) => {
    return reps?.find(r => r.repId === repId)?.name || repId;
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (selectedRepId && selectedRepId !== "ALL") params.set("repId", selectedRepId);
      if (selectedDisposition && selectedDisposition !== "ALL") params.set("disposition", selectedDisposition);
      if (searchTerm) params.set("search", searchTerm);
      
      const res = await fetch(`/api/leads/pool/export?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Export failed");
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lead-pool-export-${format(new Date(), "yyyy-MM-dd-HHmm")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({ title: "Export complete", description: "Lead pool with history exported successfully" });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const dispositionCounts = leadPool?.reduce((acc, lead) => {
    acc[lead.disposition] = (acc[lead.disposition] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Lead Pool</h1>
          <p className="text-muted-foreground">All imported leads with disposition tracking</p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <Button 
              variant="outline" 
              onClick={handleExport} 
              disabled={isExporting || !leadPool?.length}
              data-testid="button-export-leads"
            >
              <Download className="h-4 w-4 mr-2" />
              {isExporting ? "Exporting..." : "Export with History"}
            </Button>
          )}
          <Badge variant="outline" className="text-lg px-4 py-1">
            {leadPool?.length || 0} leads
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {dispositionMetadata.filter(d => d.value !== "NONE").map((d) => (
          <Card 
            key={d.value} 
            className={`cursor-pointer transition-all ${selectedDisposition === d.value ? 'ring-2 ring-primary' : 'hover-elevate'}`}
            onClick={() => setSelectedDisposition(selectedDisposition === d.value ? "ALL" : d.value)}
            data-testid={`card-disposition-${d.value}`}
          >
            <CardContent className="p-3 text-center">
              <div className={`w-3 h-3 rounded-full ${getDispositionColor(d.value)} mx-auto mb-1`} />
              <div className="text-xs font-medium truncate">{d.label}</div>
              <div className="text-lg font-bold">{dispositionCounts[d.value] || 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, email, address..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-leads"
              />
            </div>
            <Select value={selectedRepId} onValueChange={setSelectedRepId}>
              <SelectTrigger className="w-[180px]" data-testid="select-rep-filter">
                <SelectValue placeholder="All Reps" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Reps</SelectItem>
                {reps?.filter(r => !r.deletedAt && r.status === "ACTIVE").map((rep) => (
                  <SelectItem key={rep.id} value={rep.repId}>
                    {rep.name} ({rep.repId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedDisposition} onValueChange={setSelectedDisposition}>
              <SelectTrigger className="w-[180px]" data-testid="select-disposition-filter">
                <SelectValue placeholder="All Dispositions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Dispositions</SelectItem>
                {dispositionMetadata.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canBulkDelete && selectedRepId && selectedRepId !== "ALL" && (
              <Button 
                variant="destructive" 
                onClick={() => setDeleteConfirmDialog(true)}
                disabled={bulkDeleteMutation.isPending}
                data-testid="button-bulk-delete-leads"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete All for {getSelectedRepName()}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : leadPool?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No leads found</p>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-380px)]">
              <div className="space-y-2">
                {leadPool?.map((lead) => (
                  <div 
                    key={lead.id} 
                    className="p-3 border rounded-lg hover-elevate"
                    data-testid={`row-lead-${lead.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{lead.customerName || "Unknown"}</span>
                          <Badge 
                            variant="secondary" 
                            className={`text-white ${getDispositionColor(lead.disposition)}`}
                          >
                            {getDispositionLabel(lead.disposition)}
                          </Badge>
                          {lead.accountNumber && (
                            <Badge variant="outline" className="text-xs">
                              #{lead.accountNumber}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                          {lead.customerPhone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {lead.customerPhone}
                            </span>
                          )}
                          {lead.customerEmail && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {lead.customerEmail}
                            </span>
                          )}
                          {(lead.street || lead.city) && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {[lead.houseNumber, lead.street, lead.city, lead.zipCode].filter(Boolean).join(", ")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {getRepName(lead.repId)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Imported {formatDistanceToNow(new Date(lead.importedAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => openHistory(lead)}
                          data-testid={`button-history-${lead.id}`}
                        >
                          <History className="h-4 w-4 mr-1" />
                          History
                        </Button>
                        <Select 
                          value={lead.disposition}
                          onValueChange={(val) => handleDispositionChange(lead.id, val)}
                        >
                          <SelectTrigger className="w-[140px]" data-testid={`select-change-disposition-${lead.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {dispositionMetadata.map((d) => (
                              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={historyDialog.open} onOpenChange={(open) => setHistoryDialog({ ...historyDialog, open })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disposition History - {historyDialog.leadName}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {historyLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : historyData?.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">No disposition changes recorded</p>
            ) : (
              <div className="space-y-3">
                {historyData?.map((entry, index) => (
                  <div key={entry.id} className="flex items-start gap-3 pb-3 border-b last:border-0">
                    <div className={`w-3 h-3 rounded-full mt-1.5 ${getDispositionColor(entry.disposition)}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{getDispositionLabel(entry.disposition)}</span>
                        {entry.previousDisposition && (
                          <span className="text-xs text-muted-foreground">
                            from {getDispositionLabel(entry.previousDisposition)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {entry.changedByName} • {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                      </div>
                      {entry.notes && (
                        <p className="text-sm mt-1 text-muted-foreground italic">"{entry.notes}"</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmDialog} onOpenChange={setDeleteConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Leads for {getSelectedRepName()}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {leadPool?.length || 0} leads assigned to {getSelectedRepName()}. 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete All Leads"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
