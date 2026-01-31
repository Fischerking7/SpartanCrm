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
  Target,
  Key,
  Filter,
  BellRing,
  Settings2,
  Smartphone,
  MessageSquareWarning,
  User,
} from "lucide-react";
import logoImage from "@assets/image_1767725638779.png";
import { useState } from "react";

type MenuItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };

// ============ SHARED MENU BLOCKS (Single Source of Truth) ============

const MENU = {
  // Core Sales Items
  orders: { title: "Orders", url: "/orders", icon: FileText },
  quickEntry: { title: "Quick Entry", url: "/mobile-entry", icon: Smartphone },
  leads: { title: "My Leads", url: "/leads", icon: UserPlus },
  mduOrders: { title: "My MDU Orders", url: "/mdu-orders", icon: Building2 },
  
  // Dashboard & Analytics
  dashboard: { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  leadPool: { title: "Lead Pool", url: "/sales-pipeline", icon: Users },
  reports: { title: "Reports", url: "/reports", icon: BarChart3 },
  execReports: { title: "Executive Reports", url: "/executive-reports", icon: TrendingUp },
  
  // Personal Finance
  commissions: { title: "Commissions", url: "/commissions", icon: DollarSign },
  forecast: { title: "Forecast", url: "/commission-forecast", icon: Target },
  myPay: { title: "Pay History", url: "/my-pay", icon: Calendar },
  myDisputes: { title: "My Disputes", url: "/my-disputes", icon: MessageSquareWarning },
  
  // Operations
  mduReview: { title: "MDU Review", url: "/admin/mdu-review", icon: Building2 },
  payRuns: { title: "Pay Runs", url: "/payruns", icon: Calendar },
  adjustments: { title: "Adjustments", url: "/adjustments", icon: ClipboardList },
  
  // Accounting & Audit
  accounting: { title: "Accounting", url: "/accounting", icon: FileSpreadsheet },
  finance: { title: "Finance & AR", url: "/finance", icon: DollarSign },
  exports: { title: "Export History", url: "/export-history", icon: Download },
  recalculate: { title: "Recalculate", url: "/recalculate", icon: Calculator },
  queues: { title: "Exception Queues", url: "/queues", icon: AlertTriangle },
  audit: { title: "Audit Log", url: "/audit", icon: History },
  
  // Resources & Settings
  knowledge: { title: "Knowledge Base", url: "/knowledge", icon: BookOpen },
  credentials: { title: "My Credentials", url: "/my-credentials", icon: Key },
  alerts: { title: "Alerts", url: "/notifications", icon: BellRing },
  settings: { title: "Settings", url: "/notification-settings", icon: Settings2 },
  
  // Admin Settings
  users: { title: "Users", url: "/admin/users", icon: Users },
  providers: { title: "Providers", url: "/admin/providers", icon: Building2 },
  clients: { title: "Clients", url: "/admin/clients", icon: Building2 },
  services: { title: "Services", url: "/admin/services", icon: Settings },
  rateCards: { title: "Rate Cards", url: "/admin/rate-cards", icon: DollarSign },
  incentives: { title: "Incentives", url: "/admin/incentives", icon: DollarSign },
  overrides: { title: "Overrides", url: "/admin/overrides", icon: Users },
  empCredentials: { title: "Employee Credentials", url: "/admin/employee-credentials", icon: Key },
  adminDisputes: { title: "Disputes", url: "/admin/disputes", icon: MessageSquareWarning },
  payroll: { title: "Payroll", url: "/admin/payroll", icon: Calendar },
  advPayroll: { title: "Advanced Payroll", url: "/admin/payroll-advanced", icon: DollarSign },
  quickbooks: { title: "QuickBooks", url: "/admin/quickbooks", icon: Link2 },
} as const;

// ============ COMPOSED MENU GROUPS ============

// Personal section - common to all roles
const personalItems: MenuItem[] = [
  MENU.commissions,
  MENU.forecast,
  MENU.myPay,
  MENU.myDisputes,
  MENU.credentials,
];

// Alerts & Settings - common to all
const preferencesItems: MenuItem[] = [
  MENU.alerts,
  MENU.settings,
];

// Admin: Operations group
const adminOpsItems: MenuItem[] = [
  MENU.orders,
  MENU.leads,
  MENU.mduReview,
  MENU.payRuns,
  MENU.adjustments,
];

// Admin: Accounting group
const adminAccountingItems: MenuItem[] = [
  MENU.accounting,
  MENU.finance,
  MENU.exports,
  MENU.recalculate,
  MENU.queues,
  MENU.audit,
];

// Admin: Insights group
const adminInsightsItems: MenuItem[] = [
  MENU.dashboard,
  MENU.leadPool,
  MENU.reports,
  MENU.execReports,
];

// Admin: System Settings group
const adminSettingsItems: MenuItem[] = [
  MENU.users,
  MENU.providers,
  MENU.clients,
  MENU.services,
  MENU.rateCards,
  MENU.incentives,
  MENU.overrides,
  MENU.empCredentials,
  MENU.adminDisputes,
  MENU.quickbooks,
];

// ============ ROLE-SPECIFIC MENUS (Composed from blocks) ============

function getRoleMenu(role: string): { sales: MenuItem[]; personal: MenuItem[]; resources: MenuItem[] } {
  const base = {
    personal: personalItems,
    resources: [MENU.knowledge, ...preferencesItems],
  };

  switch (role) {
    case "REP":
      return {
        sales: [MENU.quickEntry, MENU.leads, MENU.orders, MENU.dashboard, MENU.adjustments],
        ...base,
      };
    case "MDU":
      return {
        sales: [MENU.mduOrders, MENU.dashboard],
        ...base,
      };
    case "SUPERVISOR":
    case "MANAGER":
      return {
        sales: [MENU.orders, MENU.quickEntry, MENU.leads, MENU.leadPool, MENU.dashboard, MENU.reports, MENU.adjustments],
        ...base,
      };
    case "EXECUTIVE":
      return {
        sales: [MENU.quickEntry, MENU.leads, MENU.orders, MENU.leadPool, MENU.dashboard, MENU.reports, MENU.mduReview, MENU.payRuns, MENU.exports, MENU.adjustments, MENU.queues, MENU.audit, MENU.users],
        ...base,
      };
    default:
      return {
        sales: [MENU.orders, MENU.dashboard],
        ...base,
      };
  }
}

// ============ COMPONENTS ============

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
  const validItems = items.filter(Boolean);
  const hasActiveItem = validItems.some(item => location === item.url);
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
            <MenuItems items={validItems} location={location} />
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

  const isAdmin = user.role === "ADMIN" || user.role === "OPERATIONS" || user.role === "EXECUTIVE";

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
      case "OPERATIONS":
        return "default";
      case "EXECUTIVE":
      case "MANAGER":
        return "secondary";
      default:
        return "outline";
    }
  };

  const renderNonAdminSidebar = () => {
    const menu = getRoleMenu(user.role);
    return (
      <>
        <CollapsibleSection 
          title="Sales" 
          icon={Briefcase} 
          items={menu.sales} 
          location={location}
          defaultOpen={true}
        />
        <CollapsibleSection 
          title="My Account" 
          icon={User} 
          items={menu.personal} 
          location={location}
        />
        <CollapsibleSection 
          title="Resources" 
          icon={BookOpen} 
          items={menu.resources} 
          location={location}
        />
      </>
    );
  };

  const renderAdminSidebar = () => (
    <>
      <CollapsibleSection 
        title="Operations" 
        icon={Briefcase} 
        items={adminOpsItems} 
        location={location}
        defaultOpen={true}
      />
      <CollapsibleSection 
        title="Accounting" 
        icon={Wallet} 
        items={adminAccountingItems} 
        location={location}
      />
      <CollapsibleSection 
        title="Insights" 
        icon={TrendingUp} 
        items={adminInsightsItems} 
        location={location}
      />
      <CollapsibleSection 
        title="My Account" 
        icon={User} 
        items={[...personalItems, ...preferencesItems]} 
        location={location}
      />
      <CollapsibleSection 
        title="Resources" 
        icon={BookOpen} 
        items={[MENU.knowledge]} 
        location={location}
      />
      <CollapsibleSection 
        title="System Settings" 
        icon={Cog} 
        items={adminSettingsItems} 
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
