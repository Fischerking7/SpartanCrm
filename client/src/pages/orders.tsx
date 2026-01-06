import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge, ApprovalStatusBadge, PaymentStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Plus, Search, Filter, Download, Eye } from "lucide-react";
import type { SalesOrder, Client, Provider, Service } from "@shared/schema";

export default function Orders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);

  const { data: orders, isLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/orders"],
    queryFn: async () => {
      const res = await fetch("/api/orders", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: providers } = useQuery<Provider[]>({
    queryKey: ["/api/providers"],
    queryFn: async () => {
      const res = await fetch("/api/providers", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
    queryFn: async () => {
      const res = await fetch("/api/services", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filteredOrders = orders?.filter((order) => {
    const matchesSearch =
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.invoiceNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.repId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || order.jobStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const columns = [
    {
      key: "invoiceNumber",
      header: "Invoice #",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-sm">{row.invoiceNumber || "-"}</span>
      ),
    },
    ...(user?.role !== "REP"
      ? [
          {
            key: "repId",
            header: "Rep",
            cell: (row: SalesOrder) => (
              <span className="font-mono text-sm">{row.repId}</span>
            ),
          },
        ]
      : []),
    {
      key: "customerName",
      header: "Customer",
      cell: (row: SalesOrder) => (
        <span className="font-medium truncate block max-w-[200px]">{row.customerName}</span>
      ),
    },
    {
      key: "dateSold",
      header: "Date Sold",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "installDate",
      header: "Install Date",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {row.installDate ? new Date(row.installDate).toLocaleDateString() : "-"}
        </span>
      ),
    },
    {
      key: "jobStatus",
      header: "Job Status",
      cell: (row: SalesOrder) => <JobStatusBadge status={row.jobStatus} />,
    },
    {
      key: "approvalStatus",
      header: "Approval",
      cell: (row: SalesOrder) => <ApprovalStatusBadge status={row.approvalStatus} />,
    },
    {
      key: "baseCommissionEarned",
      header: "Commission",
      cell: (row: SalesOrder) => (
        <span className="font-mono text-right block">
          ${parseFloat(row.baseCommissionEarned).toFixed(2)}
        </span>
      ),
      className: "text-right",
    },
    {
      key: "paymentStatus",
      header: "Payment",
      cell: (row: SalesOrder) => <PaymentStatusBadge status={row.paymentStatus} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row: SalesOrder) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSelectedOrder(row)}
          data-testid={`button-view-order-${row.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-muted-foreground">
            {user?.role === "REP" ? "Your orders" : user?.role === "MANAGER" ? "Team orders" : "All orders"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" data-testid="button-export-orders">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setShowNewOrderDialog(true)} data-testid="button-new-order">
            <Plus className="h-4 w-4 mr-2" />
            New Order
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search orders..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-orders"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELED">Canceled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={filteredOrders || []}
            isLoading={isLoading}
            emptyMessage="No orders found"
            testId="table-orders"
          />
        </CardContent>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
            <DialogDescription>
              {selectedOrder?.invoiceNumber || `Order ${selectedOrder?.id?.slice(0, 8)}`}
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Customer</Label>
                  <p className="font-medium">{selectedOrder.customerName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Rep ID</Label>
                  <p className="font-mono">{selectedOrder.repId}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Date Sold</Label>
                  <p>{new Date(selectedOrder.dateSold).toLocaleDateString()}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Install Date</Label>
                  <p>{selectedOrder.installDate ? new Date(selectedOrder.installDate).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Job Status</Label>
                  <div className="mt-1"><JobStatusBadge status={selectedOrder.jobStatus} /></div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Approval Status</Label>
                  <div className="mt-1"><ApprovalStatusBadge status={selectedOrder.approvalStatus} /></div>
                </div>
              </div>
              <div className="border-t pt-4">
                <Label className="text-muted-foreground">Commission Breakdown</Label>
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between">
                    <span>Base Commission</span>
                    <span className="font-mono">${parseFloat(selectedOrder.baseCommissionEarned).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Incentives</span>
                    <span className="font-mono">${parseFloat(selectedOrder.incentiveEarned).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Total Earned</span>
                    <span className="font-mono">
                      ${(parseFloat(selectedOrder.baseCommissionEarned) + parseFloat(selectedOrder.incentiveEarned)).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedOrder(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewOrderDialog} onOpenChange={setShowNewOrderDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
            <DialogDescription>Enter the order details below</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Customer Name</Label>
                <Input placeholder="Enter customer name" data-testid="input-customer-name" />
              </div>
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input placeholder="Enter account number" data-testid="input-account-number" />
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <Select>
                  <SelectTrigger data-testid="select-client">
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients?.filter(c => c.active).map((client) => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select>
                  <SelectTrigger data-testid="select-provider">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.filter(p => p.active).map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Service</Label>
                <Select>
                  <SelectTrigger data-testid="select-service">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services?.filter(s => s.active).map((service) => (
                      <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date Sold</Label>
                <Input type="date" data-testid="input-date-sold" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Customer Address</Label>
              <Textarea placeholder="Enter customer address" data-testid="input-customer-address" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewOrderDialog(false)}>
              Cancel
            </Button>
            <Button data-testid="button-submit-order">Create Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
