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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  LayoutDashboard,
  FileText,
  DollarSign,
  Users,
  CheckSquare,
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
  BarChart3,
  Calculator,
  BookOpen,
  Link2,
  ChevronDown,
  Briefcase,
  Wallet,
  TrendingUp,
  Cog,
} from "lucide-react";
import logoImage from "@assets/image_1767725638779.png";
import { useState } from "react";

type MenuItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };

const repMenuItems: MenuItem[] = [
  { title: "Orders", url: "/orders", icon: FileText },
  { title: "My Leads", url: "/leads", icon: UserPlus },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "My Commissions", url: "/commissions", icon: DollarSign },
  { title: "My Pay", url: "/my-pay", icon: Calendar },
  { title: "Adjustments", url: "/adjustments", icon: ClipboardList },
  { title: "Knowledge Base", url: "/knowledge", icon: BookOpen },
];

const salesLeaderMenuItems: MenuItem[] = [
  { title: "Orders", url: "/orders", icon: FileText },
  { title: "My Leads", url: "/leads", icon: UserPlus },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "My Commissions", url: "/commissions", icon: DollarSign },
  { title: "My Pay", url: "/my-pay", icon: Calendar },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Adjustments", url: "/adjustments", icon: ClipboardList },
  { title: "Knowledge Base", url: "/knowledge", icon: BookOpen },
];

const executiveMenuItems: MenuItem[] = [
  { title: "Orders", url: "/orders", icon: FileText },
  { title: "My Leads", url: "/leads", icon: UserPlus },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "My Commissions", url: "/commissions", icon: DollarSign },
  { title: "My Pay", url: "/my-pay", icon: Calendar },
  { title: "Approvals Queue", url: "/approvals", icon: CheckSquare },
  { title: "Pay Runs", url: "/payruns", icon: Calendar },
  { title: "Export History", url: "/export-history", icon: Download },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Adjustments", url: "/adjustments", icon: ClipboardList },
  { title: "Knowledge Base", url: "/knowledge", icon: BookOpen },
  { title: "Exception Queues", url: "/queues", icon: AlertTriangle },
  { title: "Audit Log", url: "/audit", icon: History },
];

const adminOperations: MenuItem[] = [
  { title: "Orders", url: "/orders", icon: FileText },
  { title: "Approvals", url: "/approvals", icon: CheckSquare },
  { title: "Pay Runs", url: "/payruns", icon: Calendar },
  { title: "Adjustments", url: "/adjustments", icon: ClipboardList },
];

const adminAccounting: MenuItem[] = [
  { title: "Accounting", url: "/accounting", icon: FileSpreadsheet },
  { title: "Export History", url: "/export-history", icon: Download },
  { title: "Recalculate", url: "/recalculate", icon: Calculator },
  { title: "Exception Queues", url: "/queues", icon: AlertTriangle },
  { title: "Audit Log", url: "/audit", icon: History },
];

const adminInsights: MenuItem[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

const adminPersonal: MenuItem[] = [
  { title: "My Leads", url: "/leads", icon: UserPlus },
  { title: "My Commissions", url: "/commissions", icon: DollarSign },
  { title: "My Pay", url: "/my-pay", icon: Calendar },
];

const adminResources: MenuItem[] = [
  { title: "Knowledge Base", url: "/knowledge", icon: BookOpen },
];

const adminSettings: MenuItem[] = [
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Providers", url: "/admin/providers", icon: Building2 },
  { title: "Clients", url: "/admin/clients", icon: Building2 },
  { title: "Services", url: "/admin/services", icon: Settings },
  { title: "Rate Cards", url: "/admin/rate-cards", icon: DollarSign },
  { title: "Incentives", url: "/admin/incentives", icon: DollarSign },
  { title: "Overrides", url: "/admin/overrides", icon: Users },
  { title: "Payroll", url: "/admin/payroll", icon: Calendar },
  { title: "QuickBooks", url: "/admin/quickbooks", icon: Link2 },
];

function MenuItems({ items, location }: { items: MenuItem[]; location: string }) {
  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.url}>
          <SidebarMenuButton asChild isActive={location === item.url}>
            <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function CollapsibleSection({ 
  title, 
  icon: Icon, 
  items, 
  location,
  defaultOpen = false 
}: { 
  title: string; 
  icon: React.ComponentType<{ className?: string }>; 
  items: MenuItem[]; 
  location: string;
  defaultOpen?: boolean;
}) {
  const hasActiveItem = items.some(item => location === item.url);
  const [isOpen, setIsOpen] = useState(defaultOpen || hasActiveItem);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <SidebarGroup className="py-0">
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="cursor-pointer hover-elevate rounded-md px-2 py-1.5 flex items-center justify-between w-full">
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              {title}
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent className="pl-2">
            <MenuItems items={items} location={location} />
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  if (!user) return null;

  const isAdmin = user.role === "ADMIN" || user.role === "FOUNDER";
  const isExecutive = user.role === "EXECUTIVE";
  const isSalesLeader = ["SUPERVISOR", "MANAGER"].includes(user.role);

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

  const renderNonAdminSidebar = () => {
    const menuItems = isExecutive ? executiveMenuItems : (isSalesLeader ? salesLeaderMenuItems : repMenuItems);
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Navigation</SidebarGroupLabel>
        <SidebarGroupContent>
          <MenuItems items={menuItems} location={location} />
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  const renderAdminSidebar = () => (
    <>
      <CollapsibleSection 
        title="Operations" 
        icon={Briefcase} 
        items={adminOperations} 
        location={location}
        defaultOpen={true}
      />
      <CollapsibleSection 
        title="Accounting" 
        icon={Wallet} 
        items={adminAccounting} 
        location={location}
      />
      <CollapsibleSection 
        title="Insights" 
        icon={TrendingUp} 
        items={adminInsights} 
        location={location}
      />
      <CollapsibleSection 
        title="My Workspace" 
        icon={UserPlus} 
        items={adminPersonal} 
        location={location}
      />
      <CollapsibleSection 
        title="Resources" 
        icon={BookOpen} 
        items={adminResources} 
        location={location}
      />
      <CollapsibleSection 
        title="System Settings" 
        icon={Cog} 
        items={adminSettings} 
        location={location}
      />
    </>
  );

  return (
    <Sidebar>
      <SidebarHeader className="p-2 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-full">
          <img src={logoImage} alt="Iron Crest Solutions" className="w-full h-auto object-contain" />
        </div>
      </SidebarHeader>
      
      <SidebarContent className="gap-1">
        {isAdmin ? renderAdminSidebar() : renderNonAdminSidebar()}
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
