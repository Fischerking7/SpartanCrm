import { useQuery } from "@tanstack/react-query";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { StatsCard } from "@/components/stats-card";
import { DataTable } from "@/components/data-table";
import { JobStatusBadge, ApprovalStatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, DollarSign, TrendingUp, Clock, Plus } from "lucide-react";
import type { SalesOrder, User } from "@shared/schema";

interface TeamMember extends User {
  earnedMTD: number;
  orderCount: number;
}

interface ManagerStats {
  teamEarnedMTD: number;
  teamPaidMTD: number;
  pendingApprovals: number;
  teamSize: number;
}

export default function ManagerDashboard() {
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<ManagerStats>({
    queryKey: ["/api/dashboard/manager-stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/manager-stats", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data: teamMembers, isLoading: teamLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team/members"],
    queryFn: async () => {
      const res = await fetch("/api/team/members", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch team");
      return res.json();
    },
  });

  const { data: teamOrders, isLoading: ordersLoading } = useQuery<SalesOrder[]>({
    queryKey: ["/api/orders", { limit: 10 }],
    queryFn: async () => {
      const res = await fetch("/api/orders?limit=10", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch orders");
      return res.json();
    },
  });

  const orderColumns = [
    {
      key: "repId",
      header: "Rep",
      cell: (row: SalesOrder) => <span className="font-mono text-sm">{row.repId}</span>,
    },
    {
      key: "customerName",
      header: "Customer",
      cell: (row: SalesOrder) => <span className="font-medium">{row.customerName}</span>,
    },
    {
      key: "dateSold",
      header: "Date",
      cell: (row: SalesOrder) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.dateSold).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "jobStatus",
      header: "Status",
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
  ];

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Team Dashboard</h1>
          <p className="text-muted-foreground">
            Manage your team's performance and commissions
          </p>
        </div>
        <Button data-testid="button-new-adjustment">
          <Plus className="h-4 w-4 mr-2" />
          Submit Adjustment
        </Button>
      </div>

      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Team Earned MTD"
            value={stats?.teamEarnedMTD || 0}
            icon={DollarSign}
            testId="stat-team-earned"
          />
          <StatsCard
            title="Team Paid MTD"
            value={stats?.teamPaidMTD || 0}
            icon={TrendingUp}
            testId="stat-team-paid"
          />
          <StatsCard
            title="Pending Approvals"
            value={stats?.pendingApprovals || 0}
            icon={Clock}
            testId="stat-pending-approvals"
          />
          <StatsCard
            title="Team Size"
            value={stats?.teamSize || 0}
            icon={Users}
            testId="stat-team-size"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <div>
              <CardTitle className="text-lg font-medium">Team Orders</CardTitle>
              <CardDescription>Recent orders from your team</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/orders" data-testid="link-view-all-team-orders">View All</a>
            </Button>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={orderColumns}
              data={teamOrders || []}
              isLoading={ordersLoading}
              emptyMessage="No team orders yet"
              testId="table-team-orders"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">Team Members</CardTitle>
            <CardDescription>Performance this month</CardDescription>
          </CardHeader>
          <CardContent>
            {teamLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-24 mb-1" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : teamMembers && teamMembers.length > 0 ? (
              <div className="space-y-4">
                {teamMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-2 rounded-md hover-elevate"
                    data-testid={`team-member-${member.repId}`}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-primary text-sm">
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{member.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{member.repId}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-semibold text-sm">
                        ${(member.earnedMTD || 0).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.orderCount || 0} orders
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No team members assigned
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
