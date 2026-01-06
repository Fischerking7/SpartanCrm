import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Search, UserPlus, MapPin, Phone, Mail, Calendar, StickyNote, X } from "lucide-react";
import type { Lead } from "@shared/schema";

export default function Leads() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [filters, setFilters] = useState({
    zipCode: "",
    street: "",
    city: "",
    dateFrom: "",
    dateTo: "",
  });
  
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState("");

  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (filters.zipCode) params.append("zipCode", filters.zipCode);
    if (filters.street) params.append("street", filters.street);
    if (filters.city) params.append("city", filters.city);
    if (filters.dateFrom) params.append("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.append("dateTo", filters.dateTo);
    const qs = params.toString();
    return `/api/leads${qs ? `?${qs}` : ""}`;
  };

  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads", filters],
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
      zipCode: "",
      street: "",
      city: "",
      dateFrom: "",
      dateTo: "",
    });
  };

  const hasActiveFilters = filters.zipCode || filters.street || filters.city || filters.dateFrom || filters.dateTo;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">My Leads</h1>
          <p className="text-muted-foreground">View and manage your imported leads</p>
        </div>
        <div className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground" data-testid="text-lead-count">
            {leads?.length || 0} leads
          </span>
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Zip Code</Label>
              <Input
                placeholder="Filter by zip code"
                value={filters.zipCode}
                onChange={(e) => setFilters(f => ({ ...f, zipCode: e.target.value }))}
                data-testid="input-filter-zipcode"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Street</Label>
              <Input
                placeholder="Filter by street"
                value={filters.street}
                onChange={(e) => setFilters(f => ({ ...f, street: e.target.value }))}
                data-testid="input-filter-street"
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
          leads.map((lead) => (
            <Card key={lead.id} data-testid={`card-lead-${lead.id}`}>
              <CardContent className="py-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <h3 className="font-medium" data-testid={`text-lead-name-${lead.id}`}>
                      {lead.customerName}
                    </h3>
                    {(lead.street || lead.city || lead.state || lead.zipCode) && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div>
                          {lead.street && <div>{lead.street}</div>}
                          {(lead.city || lead.state || lead.zipCode) && (
                            <div>
                              {[lead.city, lead.state, lead.zipCode].filter(Boolean).join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {lead.customerAddress && !lead.street && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>{lead.customerAddress}</span>
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
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
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
    </div>
  );
}
