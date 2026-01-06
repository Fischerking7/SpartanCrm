import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  FileText,
  DollarSign,
  Users,
  CheckSquare,
  Upload,
  Download,
  AlertTriangle,
  Settings,
  ClipboardList,
  Building2,
  LogOut,
  Calendar,
  FileSpreadsheet,
  History,
  UserPlus,
} from "lucide-react";
import logoImage from "@assets/image_1767725638779.png";

// Sales roles (REP, SUPERVISOR, MANAGER, EXECUTIVE) get the same navigation
const salesMenuItems = [
  { title: "Orders", url: "/orders", icon: FileText },
  { title: "My Leads", url: "/leads", icon: UserPlus },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Commissions", url: "/commissions", icon: DollarSign },
];

// Admin/Founder get additional accounting and management options
const adminMenuItems = [
  { title: "All Orders", url: "/orders", icon: FileText },
  { title: "My Leads", url: "/leads", icon: UserPlus },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Approvals Queue", url: "/approvals", icon: CheckSquare },
  { title: "Pay Runs", url: "/payruns", icon: Calendar },
  { title: "Accounting", url: "/accounting", icon: FileSpreadsheet },
  { title: "Adjustments", url: "/adjustments", icon: ClipboardList },
  { title: "Exception Queues", url: "/queues", icon: AlertTriangle },
  { title: "Audit Log", url: "/audit", icon: History },
];

const adminReferenceItems = [
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Providers", url: "/admin/providers", icon: Building2 },
  { title: "Clients", url: "/admin/clients", icon: Building2 },
  { title: "Services", url: "/admin/services", icon: Settings },
  { title: "Rate Cards", url: "/admin/rate-cards", icon: DollarSign },
  { title: "Incentives", url: "/admin/incentives", icon: DollarSign },
  { title: "Overrides", url: "/admin/overrides", icon: Users },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  if (!user) return null;

  const isAdmin = user.role === "ADMIN" || user.role === "FOUNDER";
  const isSalesRole = ["REP", "SUPERVISOR", "MANAGER", "EXECUTIVE"].includes(user.role);

  const menuItems = isAdmin ? adminMenuItems : salesMenuItems;

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "ADMIN":
      case "FOUNDER":
        return "default";
      case "EXECUTIVE":
      case "MANAGER":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <div className="flex items-center">
          <img src={logoImage} alt="Iron Crest Solutions" className="h-16 w-auto" />
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Reference Data</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminReferenceItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-admin-${item.title.toLowerCase()}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary text-sm">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">{user.repId}</span>
              <Badge variant={getRoleBadgeVariant(user.role)} className="text-xs">
                {user.role}
              </Badge>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
