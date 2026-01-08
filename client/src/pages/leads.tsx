import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, UserPlus, MapPin, Phone, Mail, Calendar, StickyNote, X, Upload, FileSpreadsheet, CheckCircle, XCircle, ShoppingCart, UserCog, RotateCcw, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import type { Lead } from "@shared/schema";

export default function Leads() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const [filters, setFilters] = useState({
    houseNumber: "",
    streetName: "",
    city: "",
    zipCode: "",
    dateFrom: "",
    dateTo: "",
  });
  const [viewingRepId, setViewingRepId] = useState<string>("");
  
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState("");
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const [targetRepId, setTargetRepId] = useState<string>("");
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assigningLeadId, setAssigningLeadId] = useState<string | null>(null);
  const [assignTargetRepId, setAssignTargetRepId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canImport = ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(user?.role || "");
  const canAssignToOthers = ["SUPERVISOR", "MANAGER", "EXECUTIVE", "ADMIN", "FOUNDER"].includes(user?.role || "");

  const buildWhitepagesUrl = (lead: Lead): string | null => {
    const street = lead.houseNumber && lead.streetName 
      ? `${lead.houseNumber} ${lead.streetName}` 
      : lead.street || lead.customerAddress;
    if (!street) return null;
    const parts = [street, lead.city, lead.state, lead.zipCode].filter(Boolean);
    if (parts.length < 2) return null;
    const encoded = parts.map(p => encodeURIComponent(p?.replace(/\s+/g, '-') || '')).join('/');
    return `https://www.whitepages.com/address/${encoded}`;
  };

  // Fetch assignable users for SUPERVISOR+ to assign leads
  const { data: assignableUsersList } = useQuery<{ id: string; name: string; repId: string; role: string; status: string }[]>({
    queryKey: ["/api/users/assignable"],
    enabled: canAssignToOthers,
  });
  
  // Fetch lead counts per rep for SUPERVISOR+ roles
  const { data: leadCounts } = useQuery<{ repId: string; name: string; role: string; count: number }[]>({
    queryKey: ["/api/leads/counts"],
    enabled: canAssignToOthers,
  });

  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (filters.houseNumber) params.append("houseNumber", filters.houseNumber);
    if (filters.streetName) params.append("streetName", filters.streetName);
    if (filters.city) params.append("city", filters.city);
    if (filters.zipCode) params.append("zipCode", filters.zipCode);
    if (filters.dateFrom) params.append("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.append("dateTo", filters.dateTo);
    if (viewingRepId && canAssignToOthers) params.append("viewRepId", viewingRepId);
    const qs = params.toString();
    return `/api/leads${qs ? `?${qs}` : ""}`;
  };

  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads", filters, viewingRepId],
    queryFn: async () => {
      const res = await fetch(buildQueryUrl(), { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await fetch(`/api/leads/${id}/notes`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error("Failed to update notes");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setEditingNotes(null);
      toast({ title: "Notes updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update notes", variant: "destructive" });
    },
  });

  const updateDispositionMutation = useMutation({
    mutationFn: async ({ id, disposition }: { id: string; disposition: string }) => {
      const res = await fetch(`/api/leads/${id}/disposition`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ disposition }),
      });
      if (!res.ok) throw new Error("Failed to update disposition");
      return res.json();
    },
    onSuccess: (_, { disposition }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/counts"] });
      const messages: Record<string, string> = {
        SOLD: "Lead marked as sold and removed from your list",
        NOT_HOME: "Lead marked as not home",
        RETURN: "Lead marked for return visit",
        REJECT: "Lead rejected and removed from your list",
      };
      toast({ title: messages[disposition] || "Disposition updated" });
    },
    onError: () => {
      toast({ title: "Failed to update disposition", variant: "destructive" });
    },
  });

  // Reverse disposition mutation for SUPERVISOR+ when viewing other reps
  const reverseDispositionMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const res = await fetch(`/api/leads/${id}/reverse-disposition`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to reverse disposition");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/counts"] });
      toast({ title: "Disposition reversed - lead is active again" });
    },
    onError: () => {
      toast({ title: "Failed to reverse disposition", variant: "destructive" });
    },
  });

  const handleSaveNotes = (leadId: string) => {
    updateNotesMutation.mutate({ id: leadId, notes: notesValue });
  };

  const startEditingNotes = (lead: Lead) => {
    setEditingNotes(lead.id);
    setNotesValue(lead.notes || "");
  };

  const cancelEditingNotes = () => {
    setEditingNotes(null);
    setNotesValue("");
  };

  const clearFilters = () => {
    setFilters({
      houseNumber: "",
      streetName: "",
      city: "",
      zipCode: "",
      dateFrom: "",
      dateTo: "",
    });
  };

  const hasActiveFilters = filters.houseNumber || filters.streetName || filters.city || filters.zipCode || filters.dateFrom || filters.dateTo;

  const createOrderFromLead = (lead: Lead) => {
    const address = [
      lead.houseNumber,
      lead.streetName || lead.street,
      lead.city,
      lead.state,
      lead.zipCode
    ].filter(Boolean).join(", ") || lead.customerAddress || "";
    
    const params = new URLSearchParams();
    if (lead.customerName) params.set("customerName", lead.customerName);
    if (address) params.set("customerAddress", address);
    if (lead.customerPhone) params.set("customerPhone", lead.customerPhone);
    if (lead.customerEmail) params.set("customerEmail", lead.customerEmail);
    params.set("fromLead", lead.id);
    
    setLocation(`/orders?${params.toString()}`);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportResult(null);
    }
  };

  const assignLeadMutation = useMutation({
    mutationFn: async ({ leadId, targetRepId }: { leadId: string; targetRepId: string }) => {
      const res = await fetch(`/api/leads/${leadId}/assign`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ targetRepId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to assign lead");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setShowAssignDialog(false);
      setAssigningLeadId(null);
      setAssignTargetRepId("");
      toast({ title: "Lead assigned successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to assign lead", description: error.message, variant: "destructive" });
    },
  });

  const openAssignDialog = (leadId: string) => {
    setAssigningLeadId(leadId);
    setAssignTargetRepId("");
    setShowAssignDialog(true);
  };

  const handleAssignLead = () => {
    if (assigningLeadId && assignTargetRepId) {
      assignLeadMutation.mutate({ leadId: assigningLeadId, targetRepId: assignTargetRepId });
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    
    setIsImporting(true);
    setImportResult(null);
    
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      
      const authHeaders = getAuthHeaders() as { Authorization: string };
      // Include targetRepId in URL for SUPERVISOR+ roles if selected (not "__self__")
      let importUrl = "/api/leads/import";
      if (canAssignToOthers && targetRepId && targetRepId !== "__self__") {
        importUrl += `?targetRepId=${encodeURIComponent(targetRepId)}`;
      }
      
      const res = await fetch(importUrl, {
        method: "POST",
        headers: {
          Authorization: authHeaders.Authorization,
        },
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
          description: `Successfully imported ${result.success} leads${result.failed > 0 ? `, ${result.failed} failed` : ""}`,
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

  const closeImportDialog = () => {
    setShowImportDialog(false);
    setImportFile(null);
    setImportResult(null);
    setTargetRepId("");
  };

  // Assignable users already filtered by backend based on role hierarchy
  const assignableUsers = assignableUsersList || [];

  // Get viewing rep name for display
  const viewingRepName = viewingRepId 
    ? assignableUsers.find(u => u.repId === viewingRepId)?.name || viewingRepId
    : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">
            {viewingRepName ? `${viewingRepName}'s Leads` : "My Leads"}
          </h1>
          <p className="text-muted-foreground">
            {viewingRepName ? `Viewing leads for ${viewingRepName}` : "View and manage your imported leads"}
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {canAssignToOthers && (
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">View leads for:</Label>
              <Select value={viewingRepId || "__my__"} onValueChange={(v) => setViewingRepId(v === "__my__" ? "" : v)}>
                <SelectTrigger className="w-[200px]" data-testid="select-view-rep">
                  <SelectValue placeholder="My Leads" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__my__">My Leads ({leadCounts?.find(c => c.repId === user?.repId)?.count || 0})</SelectItem>
                  {leadCounts?.filter(c => c.repId !== user?.repId).map(c => (
                    <SelectItem key={c.repId} value={c.repId}>
                      {c.name} ({c.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {canImport && (
            <Button variant="outline" onClick={() => setShowImportDialog(true)} data-testid="button-import-leads">
              <Upload className="h-4 w-4 mr-2" />
              Import Leads
            </Button>
          )}
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground" data-testid="text-lead-count">
              {leads?.length || 0} leads
            </span>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">House #</Label>
              <Input
                placeholder="e.g. 123"
                value={filters.houseNumber}
                onChange={(e) => setFilters(f => ({ ...f, houseNumber: e.target.value }))}
                data-testid="input-filter-house-number"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Street Name</Label>
              <Input
                placeholder="e.g. Main St"
                value={filters.streetName}
                onChange={(e) => setFilters(f => ({ ...f, streetName: e.target.value }))}
                data-testid="input-filter-street-name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">City</Label>
              <Input
                placeholder="Filter by city"
                value={filters.city}
                onChange={(e) => setFilters(f => ({ ...f, city: e.target.value }))}
                data-testid="input-filter-city"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Zip Code</Label>
              <Input
                placeholder="Filter by zip"
                value={filters.zipCode}
                onChange={(e) => setFilters(f => ({ ...f, zipCode: e.target.value }))}
                data-testid="input-filter-zipcode"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                data-testid="input-filter-date-from"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                data-testid="input-filter-date-to"
              />
            </div>
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={clearFilters}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear Filters
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading leads...
            </CardContent>
          </Card>
        ) : leads && leads.length > 0 ? (
          leads.map((lead) => {
            const isClosedLead = ["SOLD", "REJECT"].includes(lead.disposition || "");
            const isViewingOtherRep = viewingRepId && canAssignToOthers;
            return (
            <Card key={lead.id} data-testid={`card-lead-${lead.id}`} className={isClosedLead ? "opacity-75" : ""}>
              <CardContent className="py-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium" data-testid={`text-lead-name-${lead.id}`}>
                        {lead.customerName}
                      </h3>
                      {isClosedLead && (
                        <Badge variant={lead.disposition === "SOLD" ? "default" : "destructive"} className="text-xs">
                          {lead.disposition === "SOLD" ? "SOLD" : "REJECTED"}
                        </Badge>
                      )}
                    </div>
                    {(lead.houseNumber || lead.streetName || lead.street || lead.city || lead.state || lead.zipCode) && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        {buildWhitepagesUrl(lead) ? (
                          <a 
                            href={buildWhitepagesUrl(lead) || "#"} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="hover:text-foreground hover:underline"
                            data-testid={`link-whitepages-${lead.id}`}
                          >
                            <div className="flex items-start gap-1">
                              <div>
                                {(lead.houseNumber || lead.streetName) && (
                                  <div>{[lead.houseNumber, lead.streetName].filter(Boolean).join(" ")}</div>
                                )}
                                {lead.street && !lead.houseNumber && !lead.streetName && <div>{lead.street}</div>}
                                {(lead.city || lead.state || lead.zipCode) && (
                                  <div>
                                    {[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}
                                  </div>
                                )}
                              </div>
                              <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            </div>
                          </a>
                        ) : (
                          <div>
                            {(lead.houseNumber || lead.streetName) && (
                              <div>{[lead.houseNumber, lead.streetName].filter(Boolean).join(" ")}</div>
                            )}
                            {lead.street && !lead.houseNumber && !lead.streetName && <div>{lead.street}</div>}
                            {(lead.city || lead.state || lead.zipCode) && (
                              <div>
                                {[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {lead.customerAddress && !lead.street && !lead.houseNumber && !lead.streetName && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        {buildWhitepagesUrl(lead) ? (
                          <a 
                            href={buildWhitepagesUrl(lead) || "#"} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="hover:text-foreground hover:underline flex items-center gap-1"
                            data-testid={`link-whitepages-${lead.id}`}
                          >
                            <span>{lead.customerAddress}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        ) : (
                          <span>{lead.customerAddress}</span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    {lead.customerPhone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span data-testid={`text-lead-phone-${lead.id}`}>{lead.customerPhone}</span>
                      </div>
                    )}
                    {lead.customerEmail && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span data-testid={`text-lead-email-${lead.id}`}>{lead.customerEmail}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>Imported {new Date(lead.importedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <StickyNote className="h-4 w-4 text-muted-foreground" />
                      Notes
                    </div>
                    {editingNotes === lead.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={notesValue}
                          onChange={(e) => setNotesValue(e.target.value)}
                          placeholder="Add notes about this lead..."
                          className="min-h-[80px]"
                          data-testid={`input-notes-${lead.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSaveNotes(lead.id)}
                            disabled={updateNotesMutation.isPending}
                            data-testid={`button-save-notes-${lead.id}`}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEditingNotes}
                            data-testid={`button-cancel-notes-${lead.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => startEditingNotes(lead)}
                        className="cursor-pointer p-2 rounded-md border min-h-[60px] text-sm hover-elevate"
                        data-testid={`text-notes-${lead.id}`}
                      >
                        {lead.notes || <span className="text-muted-foreground italic">Click to add notes...</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={() => createOrderFromLead(lead)}
                        data-testid={`button-create-order-${lead.id}`}
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Create Order
                      </Button>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t">
                      <span className="text-xs text-muted-foreground self-center mr-1">Disposition:</span>
                      <Button
                        size="sm"
                        variant={lead.disposition === "SOLD" ? "default" : "outline"}
                        onClick={() => updateDispositionMutation.mutate({ id: lead.id, disposition: "SOLD" })}
                        disabled={updateDispositionMutation.isPending}
                        data-testid={`button-disposition-sold-${lead.id}`}
                      >
                        Sold
                      </Button>
                      <Button
                        size="sm"
                        variant={lead.disposition === "NOT_HOME" ? "default" : "outline"}
                        onClick={() => updateDispositionMutation.mutate({ id: lead.id, disposition: "NOT_HOME" })}
                        disabled={updateDispositionMutation.isPending}
                        data-testid={`button-disposition-not-home-${lead.id}`}
                      >
                        Not Home
                      </Button>
                      <Button
                        size="sm"
                        variant={lead.disposition === "RETURN" ? "default" : "outline"}
                        onClick={() => updateDispositionMutation.mutate({ id: lead.id, disposition: "RETURN" })}
                        disabled={updateDispositionMutation.isPending}
                        data-testid={`button-disposition-return-${lead.id}`}
                      >
                        Return
                      </Button>
                      <Button
                        size="sm"
                        variant={lead.disposition === "REJECT" ? "destructive" : "outline"}
                        onClick={() => updateDispositionMutation.mutate({ id: lead.id, disposition: "REJECT" })}
                        disabled={updateDispositionMutation.isPending}
                        data-testid={`button-disposition-reject-${lead.id}`}
                      >
                        Reject
                      </Button>
                      {canAssignToOthers && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openAssignDialog(lead.id)}
                          data-testid={`button-assign-lead-${lead.id}`}
                        >
                          <UserCog className="h-4 w-4 mr-1" />
                          Assign
                        </Button>
                      )}
                      {isClosedLead && isViewingOtherRep && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => reverseDispositionMutation.mutate({ id: lead.id })}
                          disabled={reverseDispositionMutation.isPending}
                          data-testid={`button-reverse-disposition-${lead.id}`}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Reverse
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
          })
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <UserPlus className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No leads found</h3>
              <p className="text-muted-foreground">
                {hasActiveFilters
                  ? "No leads match your current filters. Try adjusting or clearing your filters."
                  : "You don't have any imported leads yet."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showImportDialog} onOpenChange={(open) => { if (!open) closeImportDialog(); else setShowImportDialog(true); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Leads from Excel
            </DialogTitle>
            <DialogDescription>
              Upload an Excel file (.xlsx) with lead data. Required: houseNumber + streetName (or address). Optional: customerName, customerPhone, customerEmail, city, state, zipCode, notes.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {canAssignToOthers && (
              <div className="space-y-2">
                <Label>Import leads for</Label>
                <Select value={targetRepId} onValueChange={setTargetRepId}>
                  <SelectTrigger data-testid="select-target-user">
                    <SelectValue placeholder="Myself (or select a user)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__self__">Myself</SelectItem>
                    {assignableUsers.map(u => (
                      <SelectItem key={u.id} value={u.repId}>
                        {u.name} ({u.repId}) - {u.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Leave as "Myself" to import leads to your own page, or select a user to import leads into their page.
                </p>
              </div>
            )}
            
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-import-file"
              />
              {importFile ? (
                <div className="flex items-center justify-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">{importFile.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => { setImportFile(null); setImportResult(null); }}
                    data-testid="button-clear-file"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-select-file">
                    <Upload className="h-4 w-4 mr-2" />
                    Select Excel File
                  </Button>
                  <p className="text-sm text-muted-foreground mt-2">
                    Supports .xlsx and .xls files
                  </p>
                </div>
              )}
            </div>

            {importResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  {importResult.success > 0 && (
                    <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle className="h-4 w-4" />
                      <span>{importResult.success} imported</span>
                    </div>
                  )}
                  {importResult.failed > 0 && (
                    <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                      <XCircle className="h-4 w-4" />
                      <span>{importResult.failed} failed</span>
                    </div>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div className="max-h-32 overflow-y-auto text-sm text-muted-foreground border rounded p-2 space-y-1">
                    {importResult.errors.map((error, i) => (
                      <div key={i}>{error}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeImportDialog}>
              {importResult ? "Close" : "Cancel"}
            </Button>
            {!importResult && (
              <Button
                onClick={handleImport}
                disabled={!importFile || isImporting}
                data-testid="button-start-import"
              >
                {isImporting ? "Importing..." : "Import"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Assign Lead to User
            </DialogTitle>
            <DialogDescription>
              Select a user to assign this lead to. The lead will be moved to their leads page.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Assign to</Label>
              <Select value={assignTargetRepId} onValueChange={setAssignTargetRepId}>
                <SelectTrigger data-testid="select-assign-target-user">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {assignableUsers.map(u => (
                    <SelectItem key={u.id} value={u.repId}>
                      {u.name} ({u.repId}) - {u.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssignLead}
              disabled={!assignTargetRepId || assignLeadMutation.isPending}
              data-testid="button-confirm-assign"
            >
              {assignLeadMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
