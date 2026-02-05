import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, UserPlus, MapPin, Phone, Mail, Calendar, StickyNote, X, Upload, FileSpreadsheet, CheckCircle, XCircle, ShoppingCart, UserCog, RotateCcw, ExternalLink, Trash2, Users, Wrench, Plus, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import { dispositionMetadata, terminalDispositions, type Lead, type LeadDisposition } from "@shared/schema";

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
  
  // Multi-select state for bulk operations
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [showBulkAssignDialog, setShowBulkAssignDialog] = useState(false);
  const [bulkAssignTargetRepId, setBulkAssignTargetRepId] = useState<string>("");
  
  // Manual lead creation state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({
    repId: "",
    customerName: "",
    houseNumber: "",
    aptUnit: "",
    streetName: "",
    city: "",
    state: "",
    zipCode: "",
    customerPhone: "",
    customerEmail: "",
    accountNumber: "",
    notes: "",
  });
  
  // Tab state for Sales Pipeline
  const [activeTab, setActiveTab] = useState<string>("leads");

  const canImport = ["REP", "LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user?.role || "");
  const canAssignToOthers = ["LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user?.role || "");
  const canBulkManage = canAssignToOthers; // LEAD+ can multi-select and bulk manage
  const isAdmin = ["ADMIN", "OPERATIONS"].includes(user?.role || "");
  const canCreateLead = ["EXECUTIVE", "OPERATIONS", "ADMIN"].includes(user?.role || "");
  const canViewPipeline = ["MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"].includes(user?.role || "");

  const getStreetAddress = (lead: Lead): string => {
    let street = "";
    if (lead.houseNumber) {
      street = lead.houseNumber;
      if (lead.street) street += " " + lead.street;
      else if (lead.streetName) street += " " + lead.streetName;
    } else if (lead.street) {
      street = lead.street;
    } else if (lead.streetName) {
      street = lead.streetName;
    } else if (lead.customerAddress) {
      street = lead.customerAddress;
    }
    return street;
  };

  const buildTruePeopleSearchUrl = (lead: Lead): string | null => {
    const street = getStreetAddress(lead);
    if (!street) return null;
    
    // Use state and 5-digit ZIP only (no city, no ZIP+4)
    const stateZip = [lead.state, lead.zipCode?.split('-')[0]].filter(Boolean).join(' ');
    if (!stateZip) return null;
    
    const streetParam = encodeURIComponent(street);
    const stateZipParam = encodeURIComponent(stateZip);
    return `https://www.truepeoplesearch.com/resultaddress?streetaddress=${streetParam}&citystatezip=${stateZipParam}`;
  };

  const buildFastPeopleSearchUrl = (lead: Lead): string | null => {
    const street = getStreetAddress(lead);
    if (!street) return null;
    
    // Use 5-digit ZIP only (no ZIP+4)
    const zip = lead.zipCode?.split('-')[0] || "";
    const city = lead.city || "";
    const state = lead.state || "";
    
    // FastPeopleSearch format: /address/street_city-state-zip
    // e.g., /address/123-main-st_sharon-hill-pa-19079
    const streetPart = street.toLowerCase().replace(/\s+/g, '-');
    const locationParts = [city, state, zip].filter(Boolean).join('-').toLowerCase().replace(/\s+/g, '-');
    
    if (!locationParts) return null;
    
    return `https://www.fastpeoplesearch.com/address/${streetPart}_${locationParts}`;
  };
  
  const formatAddress = (lead: Lead): { line1: string; line2: string } => {
    let line1 = "";
    if (lead.houseNumber) {
      // Structured address with separate house number
      line1 = lead.houseNumber;
      if (lead.streetName) line1 += " " + lead.streetName;
      if (lead.aptUnit) line1 += " " + lead.aptUnit;
    } else if (lead.street) {
      // street field may contain full address with house number
      line1 = lead.street;
      if (lead.aptUnit) line1 += " " + lead.aptUnit;
    } else if (lead.streetName) {
      // Only street name without house number
      line1 = lead.streetName;
      if (lead.aptUnit) line1 += " " + lead.aptUnit;
    } else if (lead.customerAddress) {
      // Fallback to full customer address
      line1 = lead.customerAddress;
    }
    const line2 = [lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ");
    return { line1, line2 };
  };

  // Fetch assignable users for LEAD+ to assign leads
  const { data: assignableUsersList } = useQuery<{ id: string; name: string; repId: string; role: string; status: string }[]>({
    queryKey: ["/api/users/assignable"],
    enabled: canAssignToOthers,
  });
  
  // Fetch lead counts per rep for LEAD+ roles
  const { data: leadCounts } = useQuery<{ repId: string; name: string; role: string; count: number }[]>({
    queryKey: ["/api/leads/counts"],
    enabled: canAssignToOthers,
  });

  // Fetch sales pipeline data for MANAGER+ and OPERATIONS
  interface PipelineData {
    totalLeads: number;
    dispositionCounts: Record<string, number>;
    repBreakdown: { repId: string; name: string; role: string; dispositions: Record<string, number>; total: number }[];
    metrics: { conversionRate: string; negotiationRate: string; returnRate: string; rejectRate: string };
  }
  const { data: pipelineData, isLoading: pipelineLoading } = useQuery<PipelineData>({
    queryKey: ["/api/leads/pipeline"],
    enabled: canViewPipeline,
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

  // Use shared disposition metadata from schema
  const getDispositionLabel = (value: string) => {
    return dispositionMetadata.find(d => d.value === value)?.label || value;
  };

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
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/funnel"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/aging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/win-loss"] });
      toast({ title: `Disposition updated to: ${getDispositionLabel(disposition)}` });
    },
    onError: () => {
      toast({ title: "Failed to update disposition", variant: "destructive" });
    },
  });

  // Reverse disposition mutation for LEAD+ when viewing other reps
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
    // Build full street address
    const streetPart = lead.houseNumber 
      ? `${lead.houseNumber} ${lead.streetName || lead.street || ""}`.trim()
      : (lead.street || lead.streetName || "");
    
    // Build city, state, zip part
    const cityStateZip = [lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ");
    
    // Combine into full address
    const address = [streetPart, cityStateZip].filter(Boolean).join(", ") || lead.customerAddress || "";
    
    const params = new URLSearchParams();
    if (lead.customerName) params.set("customerName", lead.customerName);
    if (address) params.set("customerAddress", address);
    if (lead.customerPhone) params.set("customerPhone", lead.customerPhone);
    if (lead.customerEmail) params.set("customerEmail", lead.customerEmail);
    if (lead.accountNumber) params.set("accountNumber", lead.accountNumber);
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

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/leads/bulk-delete", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete leads");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/counts"] });
      setSelectedLeadIds(new Set());
      setShowBulkDeleteDialog(false);
      toast({ title: `Deleted ${data.count} leads` });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete leads", description: error.message, variant: "destructive" });
    },
  });

  // Bulk assign mutation
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ ids, newRepId }: { ids: string[]; newRepId: string }) => {
      const res = await fetch("/api/leads/bulk-assign", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids, newRepId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to assign leads");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/counts"] });
      setSelectedLeadIds(new Set());
      setShowBulkAssignDialog(false);
      setBulkAssignTargetRepId("");
      toast({ title: data.message });
    },
    onError: (error: any) => {
      toast({ title: "Failed to assign leads", description: error.message, variant: "destructive" });
    },
  });

  // Admin fix addresses mutation
  const fixAddressesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/leads/fix-addresses", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to fix addresses");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: data.message || `Fixed ${data.count} addresses` });
    },
    onError: (error: any) => {
      toast({ title: "Failed to fix addresses", description: error.message, variant: "destructive" });
    },
  });

  // Create lead mutation
  const createLeadMutation = useMutation({
    mutationFn: async (data: typeof newLeadForm) => {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create lead");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/counts"] });
      setShowCreateDialog(false);
      setNewLeadForm({
        repId: "",
        customerName: "",
        houseNumber: "",
        aptUnit: "",
        streetName: "",
        city: "",
        state: "",
        zipCode: "",
        customerPhone: "",
        customerEmail: "",
        accountNumber: "",
        notes: "",
      });
      toast({ title: "Lead created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create lead", description: error.message, variant: "destructive" });
    },
  });

  // Multi-select handlers
  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) {
        next.delete(leadId);
      } else {
        next.add(leadId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!leads) return;
    if (selectedLeadIds.size === leads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(leads.map(l => l.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedLeadIds.size > 0) {
      bulkDeleteMutation.mutate(Array.from(selectedLeadIds));
    }
  };

  const handleBulkAssign = () => {
    if (selectedLeadIds.size > 0 && bulkAssignTargetRepId) {
      bulkAssignMutation.mutate({ ids: Array.from(selectedLeadIds), newRepId: bulkAssignTargetRepId });
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
      // Include targetRepId in URL for LEAD+ roles if selected (not "__self__")
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
  const viewingRepName = viewingRepId === "__all_team__"
    ? "All My Team"
    : viewingRepId 
      ? assignableUsers.find(u => u.repId === viewingRepId)?.name || viewingRepId
      : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">
            {activeTab === "pipeline" ? "Sales Pipeline" : viewingRepName ? `${viewingRepName}'s Leads` : "My Leads"}
          </h1>
          <p className="text-muted-foreground">
            {activeTab === "pipeline" ? "Disposition flow and conversion metrics" : viewingRepName ? `Viewing leads for ${viewingRepName}` : "View and manage your imported leads"}
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
                  <SelectItem value="__all_team__">
                    All My Team ({leadCounts?.reduce((sum, c) => sum + c.count, 0) || 0})
                  </SelectItem>
                  {leadCounts?.filter(c => c.repId !== user?.repId).map(c => (
                    <SelectItem key={c.repId} value={c.repId}>
                      {c.name} ({c.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {canCreateLead && (
            <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-lead">
              <Plus className="h-4 w-4 mr-2" />
              Add Lead
            </Button>
          )}
          {canImport && (
            <Button variant="outline" onClick={() => setShowImportDialog(true)} data-testid="button-import-leads">
              <Upload className="h-4 w-4 mr-2" />
              Import Leads
            </Button>
          )}
          {isAdmin && (
            <Button 
              variant="outline" 
              onClick={() => fixAddressesMutation.mutate()} 
              disabled={fixAddressesMutation.isPending}
              data-testid="button-fix-addresses"
            >
              <Wrench className="h-4 w-4 mr-2" />
              {fixAddressesMutation.isPending ? "Fixing..." : "Fix Addresses"}
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

      {canViewPipeline && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="leads" data-testid="tab-leads">
              <UserPlus className="h-4 w-4 mr-2" />
              Leads
            </TabsTrigger>
            <TabsTrigger value="pipeline" data-testid="tab-pipeline">
              <TrendingUp className="h-4 w-4 mr-2" />
              Sales Pipeline
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="pipeline" className="space-y-6">
            {pipelineLoading ? (
              <div className="flex items-center justify-center py-12">
                <span className="text-muted-foreground">Loading pipeline data...</span>
              </div>
            ) : pipelineData ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Total Leads</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold">{pipelineData.totalLeads}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Conversion Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold text-green-600">{pipelineData.metrics.conversionRate}%</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">In Negotiation</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold text-blue-600">{pipelineData.metrics.negotiationRate}%</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Return Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold text-yellow-600">{pipelineData.metrics.returnRate}%</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">Rejection Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-bold text-red-600">{pipelineData.metrics.rejectRate}%</p>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Disposition Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      {dispositionMetadata.map(d => (
                        <div key={d.value} className="flex items-center justify-between p-3 border rounded-md">
                          <span className="text-sm">{d.label}</span>
                          <Badge variant={d.category === "won" ? "default" : d.category === "negative" ? "destructive" : "secondary"}>
                            {pipelineData.dispositionCounts[d.value] || 0}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Rep Performance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {pipelineData.repBreakdown.length === 0 ? (
                        <p className="text-muted-foreground text-center py-4">No data available</p>
                      ) : (
                        pipelineData.repBreakdown.map(rep => (
                          <div key={rep.repId} className="flex items-center justify-between p-3 border rounded-md">
                            <div>
                              <p className="font-medium">{rep.name}</p>
                              <p className="text-xs text-muted-foreground">{rep.repId} - {rep.role}</p>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm font-medium">{rep.total} leads</p>
                                <div className="flex gap-2 text-xs">
                                  <span className="text-green-600">{rep.dispositions.SOLD || 0} sold</span>
                                  <span className="text-blue-600">{rep.dispositions.NEGOTIATION || 0} negotiating</span>
                                  <span className="text-yellow-600">{rep.dispositions.RETURN || 0} return</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">No pipeline data available</div>
            )}
          </TabsContent>
          
        </Tabs>
      )}

      {(!canViewPipeline || activeTab === "leads") && (
      <div className="space-y-6">
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

      {/* Bulk Actions Toolbar - LEAD+ only */}
      {canBulkManage && leads && leads.length > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selectedLeadIds.size === leads.length && leads.length > 0}
                  onCheckedChange={toggleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-sm text-muted-foreground">
                  {selectedLeadIds.size > 0 
                    ? `${selectedLeadIds.size} of ${leads.length} selected`
                    : `Select all (${leads.length})`}
                </span>
              </div>
              {selectedLeadIds.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowBulkAssignDialog(true)}
                    data-testid="button-bulk-assign"
                  >
                    <Users className="h-4 w-4 mr-1" />
                    Assign Selected
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setShowBulkDeleteDialog(true)}
                    data-testid="button-bulk-delete"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Selected
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Loading leads...
            </CardContent>
          </Card>
        ) : leads && leads.length > 0 ? (
          leads.map((lead) => {
            const isClosedLead = terminalDispositions.includes((lead.disposition || "NONE") as LeadDisposition);
            const isViewingOtherRep = viewingRepId && canAssignToOthers;
            const isSelected = selectedLeadIds.has(lead.id);
            return (
            <Card key={lead.id} data-testid={`card-lead-${lead.id}`} className={`${isClosedLead ? "opacity-75" : ""} ${isSelected ? "ring-2 ring-primary" : ""}`}>
              <CardContent className="py-4">
                <div className="flex gap-4">
                  {canBulkManage && (
                    <div className="flex-shrink-0 pt-1">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleLeadSelection(lead.id)}
                        data-testid={`checkbox-lead-${lead.id}`}
                      />
                    </div>
                  )}
                  <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium" data-testid={`text-lead-name-${lead.id}`}>
                        {lead.customerName || <span className="text-muted-foreground italic">No Name</span>}
                      </h3>
                      {isClosedLead && (
                        <Badge variant={lead.disposition === "SOLD" ? "default" : "destructive"} className="text-xs">
                          {getDispositionLabel(lead.disposition || "")}
                        </Badge>
                      )}
                    </div>
                    {(() => {
                      const tpsUrl = buildTruePeopleSearchUrl(lead);
                      const fpsUrl = buildFastPeopleSearchUrl(lead);
                      const hasAddress = lead.houseNumber || lead.street || lead.streetName || lead.customerAddress;
                      if (!hasAddress) return null;
                      
                      const streetLine = getStreetAddress(lead);
                      
                      return (
                        <div className="space-y-2">
                          <div className="flex items-start gap-2 text-sm text-muted-foreground">
                            <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <div>
                              <div className="font-medium text-foreground">{streetLine}</div>
                              {lead.aptUnit && <div>Unit {lead.aptUnit}</div>}
                              <div>{[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}</div>
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {tpsUrl && (
                              <Button
                                size="sm"
                                variant="outline"
                                asChild
                                data-testid={`link-truepeoplesearch-${lead.id}`}
                              >
                                <a href={tpsUrl} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  TruePeopleSearch
                                </a>
                              </Button>
                            )}
                            {fpsUrl && (
                              <Button
                                size="sm"
                                variant="outline"
                                asChild
                                data-testid={`link-fastpeoplesearch-${lead.id}`}
                              >
                                <a href={fpsUrl} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  FastPeopleSearch
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  
                  <div className="space-y-2">
                    {lead.accountNumber && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground font-medium">Acct:</span>
                        <span data-testid={`text-lead-account-${lead.id}`}>{lead.accountNumber}</span>
                      </div>
                    )}
                    {lead.customerStatus && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground font-medium">Status:</span>
                        <span data-testid={`text-lead-status-${lead.id}`}>{lead.customerStatus}</span>
                      </div>
                    )}
                    {lead.discoReason && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground font-medium">Disco:</span>
                        <span data-testid={`text-lead-disco-${lead.id}`}>{lead.discoReason}</span>
                      </div>
                    )}
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
                    {lead.repId && (
                      <div className="text-xs text-muted-foreground">
                        Rep: {lead.repId}
                      </div>
                    )}
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
                    
                    <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t items-center">
                      <span className="text-xs text-muted-foreground mr-1">Disposition:</span>
                      <Select
                        value={lead.disposition || "NONE"}
                        onValueChange={(value) => updateDispositionMutation.mutate({ id: lead.id, disposition: value })}
                        disabled={updateDispositionMutation.isPending}
                      >
                        <SelectTrigger className="w-[180px] h-8" data-testid={`select-disposition-${lead.id}`}>
                          <SelectValue placeholder="Select disposition" />
                        </SelectTrigger>
                        <SelectContent>
                          {dispositionMetadata.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
              Upload an Excel file (.xlsx) with lead data. Required: houseNumber + streetName (or address). Optional: apt/unit, customerName, customerPhone, customerEmail, city, state, zipCode, notes.
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

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedLeadIds.size} leads?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will remove the selected leads from the system. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Assign Dialog */}
      <Dialog open={showBulkAssignDialog} onOpenChange={setShowBulkAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Assign {selectedLeadIds.size} Leads
            </DialogTitle>
            <DialogDescription>
              Select a user to assign all selected leads to.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Assign to</Label>
              <Select value={bulkAssignTargetRepId} onValueChange={setBulkAssignTargetRepId}>
                <SelectTrigger data-testid="select-bulk-assign-target">
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
            <Button variant="outline" onClick={() => setShowBulkAssignDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleBulkAssign}
              disabled={!bulkAssignTargetRepId || bulkAssignMutation.isPending}
              data-testid="button-confirm-bulk-assign"
            >
              {bulkAssignMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Lead Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Create New Lead
            </DialogTitle>
            <DialogDescription>
              Manually add a new lead to the system.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto p-1">
            <div className="col-span-2 space-y-2">
              <Label>Assign to Rep *</Label>
              <Select value={newLeadForm.repId} onValueChange={(v) => setNewLeadForm(f => ({ ...f, repId: v }))}>
                <SelectTrigger data-testid="select-create-lead-rep">
                  <SelectValue placeholder="Select a rep" />
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
            <div className="space-y-2">
              <Label>Customer Name</Label>
              <Input
                placeholder="John Smith"
                value={newLeadForm.customerName}
                onChange={(e) => setNewLeadForm(f => ({ ...f, customerName: e.target.value }))}
                data-testid="input-create-lead-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                placeholder="555-123-4567"
                value={newLeadForm.customerPhone}
                onChange={(e) => setNewLeadForm(f => ({ ...f, customerPhone: e.target.value }))}
                data-testid="input-create-lead-phone"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                placeholder="email@example.com"
                value={newLeadForm.customerEmail}
                onChange={(e) => setNewLeadForm(f => ({ ...f, customerEmail: e.target.value }))}
                data-testid="input-create-lead-email"
              />
            </div>
            <div className="space-y-2">
              <Label>Account Number</Label>
              <Input
                placeholder="ACC-12345"
                value={newLeadForm.accountNumber}
                onChange={(e) => setNewLeadForm(f => ({ ...f, accountNumber: e.target.value }))}
                data-testid="input-create-lead-account"
              />
            </div>
            <div className="space-y-2">
              <Label>House Number</Label>
              <Input
                placeholder="123"
                value={newLeadForm.houseNumber}
                onChange={(e) => setNewLeadForm(f => ({ ...f, houseNumber: e.target.value }))}
                data-testid="input-create-lead-house"
              />
            </div>
            <div className="space-y-2">
              <Label>Apt/Unit</Label>
              <Input
                placeholder="Apt 4B"
                value={newLeadForm.aptUnit}
                onChange={(e) => setNewLeadForm(f => ({ ...f, aptUnit: e.target.value }))}
                data-testid="input-create-lead-apt"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Street Name</Label>
              <Input
                placeholder="Main Street"
                value={newLeadForm.streetName}
                onChange={(e) => setNewLeadForm(f => ({ ...f, streetName: e.target.value }))}
                data-testid="input-create-lead-street"
              />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input
                placeholder="Philadelphia"
                value={newLeadForm.city}
                onChange={(e) => setNewLeadForm(f => ({ ...f, city: e.target.value }))}
                data-testid="input-create-lead-city"
              />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input
                placeholder="PA"
                value={newLeadForm.state}
                onChange={(e) => setNewLeadForm(f => ({ ...f, state: e.target.value }))}
                data-testid="input-create-lead-state"
              />
            </div>
            <div className="space-y-2">
              <Label>Zip Code</Label>
              <Input
                placeholder="19103"
                value={newLeadForm.zipCode}
                onChange={(e) => setNewLeadForm(f => ({ ...f, zipCode: e.target.value }))}
                data-testid="input-create-lead-zip"
              />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Additional notes about this lead..."
                value={newLeadForm.notes}
                onChange={(e) => setNewLeadForm(f => ({ ...f, notes: e.target.value }))}
                data-testid="input-create-lead-notes"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createLeadMutation.mutate(newLeadForm)}
              disabled={!newLeadForm.repId || createLeadMutation.isPending}
              data-testid="button-confirm-create-lead"
            >
              {createLeadMutation.isPending ? "Creating..." : "Create Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      )}
    </div>
  );
}
