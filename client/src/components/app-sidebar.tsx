import { useLocation, Link } from "wouter";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
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
  Activity,
  RefreshCw,
  Radio,
  Zap,
  BookMarked,
  Timer,
  UserCheck,
  BadgeAlert,
  CalendarCheck,
  TrendingDown,
  Shield,
  GitBranch,
  Award,
  Phone,
  MessageSquare,
  BarChart2,
  Globe2,
} from "lucide-react";
import logoImage from "@assets/image_1767725638779.png";
import { useState } from "react";

type MenuItem = { titleKey: string; url: string; icon: React.ComponentType<{ className?: string }> };

// ============ SHARED MENU BLOCKS (Single Source of Truth) ============

const MENU = {
  // Core Sales Items
  orders: { titleKey: "sidebar.menu.orders", url: "/orders", icon: FileText },
  orderTracker: { titleKey: "sidebar.menu.orderTracker", url: "/order-tracker", icon: ClipboardList },
  quickEntry: { titleKey: "sidebar.menu.quickEntry", url: "/mobile-entry", icon: Smartphone },
  leads: { titleKey: "sidebar.menu.leads", url: "/leads", icon: UserPlus },
  mduOrders: { titleKey: "sidebar.menu.mduOrders", url: "/mdu-orders", icon: Building2 },
  
  // Dashboard & Analytics
  dashboard: { titleKey: "sidebar.menu.dashboard", url: "/dashboard", icon: LayoutDashboard },
  leadPool: { titleKey: "sidebar.menu.leadPool", url: "/sales-pipeline", icon: Users },
  reports: { titleKey: "sidebar.menu.reports", url: "/reports", icon: BarChart3 },
  execReports: { titleKey: "sidebar.menu.execReports", url: "/executive-reports", icon: TrendingUp },
  
  // Personal Finance
  commissions: { titleKey: "sidebar.menu.commissions", url: "/commissions", icon: DollarSign },
  forecast: { titleKey: "sidebar.menu.forecast", url: "/commission-forecast", icon: Target },
  myPay: { titleKey: "sidebar.menu.myPay", url: "/my-pay", icon: Calendar },
  myDisputes: { titleKey: "sidebar.menu.myDisputes", url: "/my-disputes", icon: MessageSquareWarning },
  
  // Operations
  mduReview: { titleKey: "sidebar.menu.mduReview", url: "/admin/mdu-review", icon: Building2 },
  payRuns: { titleKey: "sidebar.menu.payRuns", url: "/payruns", icon: Calendar },
  adjustments: { titleKey: "sidebar.menu.adjustments", url: "/adjustments", icon: ClipboardList },
  
  // Accounting & Audit
  accounting: { titleKey: "sidebar.menu.accountingMenu", url: "/accounting", icon: FileSpreadsheet },
  finance: { titleKey: "sidebar.menu.finance", url: "/finance", icon: DollarSign },
  exports: { titleKey: "sidebar.menu.exports", url: "/export-history", icon: Download },
  recalculate: { titleKey: "sidebar.menu.recalculate", url: "/recalculate", icon: Calculator },
  queues: { titleKey: "sidebar.menu.queues", url: "/queues", icon: AlertTriangle },
  audit: { titleKey: "sidebar.menu.audit", url: "/audit", icon: History },
  
  // Resources & Settings
  knowledge: { titleKey: "sidebar.menu.knowledge", url: "/knowledge", icon: BookOpen },
  credentials: { titleKey: "sidebar.menu.credentials", url: "/my-credentials", icon: Key },
  alerts: { titleKey: "sidebar.menu.alerts", url: "/notifications", icon: BellRing },
  settings: { titleKey: "sidebar.menu.alertSettings", url: "/notification-settings", icon: Settings2 },
  
  // Admin Settings
  users: { titleKey: "sidebar.menu.users", url: "/admin/users", icon: Users },
  providers: { titleKey: "sidebar.menu.providers", url: "/admin/providers", icon: Building2 },
  clients: { titleKey: "sidebar.menu.clients", url: "/admin/clients", icon: Building2 },
  services: { titleKey: "sidebar.menu.services", url: "/admin/services", icon: Settings },
  rateCards: { titleKey: "sidebar.menu.rateCards", url: "/admin/rate-cards", icon: DollarSign },
  incentives: { titleKey: "sidebar.menu.incentives", url: "/admin/incentives", icon: DollarSign },
  overrides: { titleKey: "sidebar.menu.overrides", url: "/admin/overrides", icon: Users },
  overrideApprovals: { titleKey: "sidebar.menu.overrideApprovals", url: "/admin/override-approvals", icon: CheckSquare },
  empCredentials: { titleKey: "sidebar.menu.empCredentials", url: "/admin/employee-credentials", icon: Key },
  adminDisputes: { titleKey: "sidebar.menu.adminDisputes", url: "/admin/disputes", icon: MessageSquareWarning },
  complianceCalendar: { titleKey: "sidebar.menu.complianceCalendar", url: "/admin/compliance-calendar", icon: Shield },
  userActivity: { titleKey: "sidebar.menu.userActivity", url: "/admin/user-activity", icon: Activity },
  onboarding: { titleKey: "sidebar.menu.onboarding", url: "/onboarding", icon: ClipboardList },
  onboardingReview: { titleKey: "sidebar.menu.onboardingReview", url: "/admin/onboarding-review", icon: CheckSquare },
  installSync: { titleKey: "sidebar.menu.installSync", url: "/admin/install-sync", icon: RefreshCw },
  carrierProfiles: { titleKey: "sidebar.menu.carrierProfiles", url: "/admin/carrier-profiles", icon: Radio },
  carrierRepMappings: { titleKey: "sidebar.menu.repMappings", url: "/admin/carrier-rep-mappings", icon: Users },
  payroll: { titleKey: "sidebar.payroll", url: "/admin/payroll", icon: Calendar },
  advPayroll: { titleKey: "sidebar.menu.advPayroll", url: "/admin/payroll-advanced", icon: DollarSign },
  quickbooks: { titleKey: "sidebar.menu.quickbooks", url: "/admin/quickbooks", icon: Link2 },
  automationRules: { titleKey: "sidebar.menu.automationRules", url: "/admin/automation-rules", icon: Zap },
  savedReports: { titleKey: "sidebar.menu.savedReports", url: "/admin/saved-reports", icon: BookMarked },

  // New: Operations Automation
  slaDashboard: { titleKey: "sidebar.menu.slaDashboard", url: "/operations/sla-dashboard", icon: Timer },
  onboardingPipeline: { titleKey: "sidebar.menu.onboardingPipeline", url: "/operations/onboarding-pipeline", icon: UserCheck },

  // New: Accounting Automation
  paymentVariances: { titleKey: "sidebar.menu.paymentVariances", url: "/accounting/payment-variances", icon: BadgeAlert },
  monthEnd: { titleKey: "sidebar.menu.monthEnd", url: "/accounting/month-end", icon: CalendarCheck },
  cashFlow: { titleKey: "sidebar.menu.cashFlow", url: "/accounting/cash-flow", icon: TrendingDown },

  // Task 33: Sales Leadership & Rep Experience
  pipelineForecast: { titleKey: "sidebar.menu.pipelineForecast", url: "/pipeline-forecast", icon: GitBranch },
  coachingScorecards: { titleKey: "sidebar.menu.coachingScorecards", url: "/coaching-scorecards", icon: Award },
  earningsSimulator: { titleKey: "sidebar.menu.earningsSimulator", url: "/earnings-simulator", icon: Calculator },
  referrals: { titleKey: "sidebar.menu.referrals", url: "/referrals", icon: Phone },
  messages: { titleKey: "sidebar.menu.messages", url: "/messages", icon: MessageSquare },
  myPerformance: { titleKey: "sidebar.menu.myPerformance", url: "/my-performance", icon: BarChart2 },
  geography: { titleKey: "sidebar.menu.geography", url: "/geography", icon: Globe2 },
};

// ============ COMPOSED MENU GROUPS ============

// Personal section - common to all roles
const personalItems: MenuItem[] = [
  MENU.commissions,
  MENU.forecast,
  MENU.myPay,
  MENU.myDisputes,
  MENU.messages,
  MENU.credentials,
  MENU.onboarding,
];

const repPersonalItems: MenuItem[] = [
  MENU.commissions,
  MENU.forecast,
  MENU.earningsSimulator,
  MENU.myPerformance,
  MENU.myPay,
  MENU.myDisputes,
  MENU.messages,
  MENU.credentials,
  MENU.onboarding,
];

// Alerts & Settings - common to all
const preferencesItems: MenuItem[] = [
  MENU.alerts,
  MENU.settings,
];

// Executive/Operations: Full Operations group (original admin layout)
const execOpsItems: MenuItem[] = [
  MENU.orderTracker,
  MENU.orders,
  MENU.leads,
  MENU.mduReview,
  MENU.payRuns,
  MENU.adjustments,
];

// Operations Automation items
const operationsAutomationItems: MenuItem[] = [
  MENU.slaDashboard,
  MENU.onboardingPipeline,
];

// Accounting Automation items
const accountingAutomationItems: MenuItem[] = [
  MENU.paymentVariances,
  MENU.monthEnd,
  MENU.cashFlow,
];

// Admin: Operations group (limited)
const adminOpsItems: MenuItem[] = [
  MENU.orders,
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
  MENU.savedReports,
  MENU.geography,
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
  MENU.overrideApprovals,
  MENU.empCredentials,
  MENU.adminDisputes,
  MENU.complianceCalendar,
  MENU.quickbooks,
  MENU.userActivity,
  MENU.installSync,
  MENU.carrierProfiles,
  MENU.carrierRepMappings,
  MENU.onboardingReview,
  MENU.automationRules,
];

// ============ ROLE-SPECIFIC MENUS (Composed from blocks) ============

function getRoleMenu(role: string): { sales: MenuItem[]; personal: MenuItem[]; resources: MenuItem[] } {
  const base = {
    personal: personalItems,
    resources: [MENU.knowledge, ...preferencesItems],
  };

  const repBase = {
    personal: repPersonalItems,
    resources: [MENU.knowledge, ...preferencesItems],
  };

  switch (role) {
    case "REP":
      return {
        sales: [MENU.dashboard, MENU.orderTracker, MENU.quickEntry, MENU.leads, MENU.adjustments, MENU.referrals],
        ...repBase,
      };
    case "MDU":
      return {
        sales: [MENU.dashboard, MENU.mduOrders, MENU.orderTracker, MENU.quickEntry, MENU.referrals],
        ...repBase,
      };
    case "LEAD":
      return {
        sales: [MENU.dashboard, MENU.orderTracker, MENU.quickEntry, MENU.leads, MENU.leadPool, MENU.reports, MENU.adjustments, MENU.referrals, MENU.pipelineForecast, MENU.coachingScorecards, MENU.geography],
        ...repBase,
      };
    case "MANAGER":
      return {
        sales: [MENU.dashboard, MENU.orderTracker, MENU.quickEntry, MENU.leads, MENU.leadPool, MENU.reports, MENU.adjustments, MENU.pipelineForecast, MENU.coachingScorecards, MENU.geography, MENU.userActivity],
        ...base,
      };
    case "DIRECTOR":
      return {
        sales: [MENU.dashboard, MENU.orderTracker, MENU.orders, MENU.quickEntry, MENU.leads, MENU.leadPool, MENU.reports, MENU.execReports, MENU.pipelineForecast, MENU.coachingScorecards, MENU.geography, MENU.overrideApprovals, MENU.userActivity, MENU.adjustments],
        ...base,
      };
    case "EXECUTIVE":
      return {
        sales: [MENU.dashboard, MENU.orderTracker, MENU.quickEntry, MENU.leads, MENU.orders, MENU.leadPool, MENU.reports, MENU.execReports, MENU.pipelineForecast, MENU.coachingScorecards, MENU.geography, MENU.mduReview, MENU.payRuns, MENU.exports, MENU.adjustments, MENU.queues, MENU.audit, MENU.users, MENU.userActivity],
        ...base,
      };
    default:
      return {
        sales: [MENU.dashboard, MENU.orderTracker, MENU.quickEntry],
        ...base,
      };
  }
}

// ============ COMPONENTS ============

function MenuItems({ items, location, badges }: { items: MenuItem[]; location: string; badges?: Record<string, number> }) {
  const { t } = useTranslation();
  return (
    <SidebarMenu>
      {items.map((item) => {
        const badgeCount = badges?.[item.url];
        const label = t(item.titleKey);
        const testId = item.titleKey.split(".").pop()?.toLowerCase().replace(/\s+/g, "-") ?? item.url.replace(/\//g, "-");
        return (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton asChild isActive={location === item.url}>
              <Link href={item.url} data-testid={`link-${testId}`}>
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{label}</span>
                {badgeCount != null && badgeCount > 0 && (
                  <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0.5 min-w-[1.25rem] text-center" data-testid={`badge-menu-${testId}`}>
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </Badge>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function CollapsibleSection({ 
  title, 
  icon: Icon, 
  items, 
  location,
  defaultOpen = false,
  badges,
}: { 
  title: string; 
  icon: React.ComponentType<{ className?: string }>; 
  items: MenuItem[]; 
  location: string;
  defaultOpen?: boolean;
  badges?: Record<string, number>;
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
            <MenuItems items={validItems} location={location} badges={badges} />
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { t } = useTranslation();

  if (!user) return null;

  const isAdmin = user.role === "ADMIN" || user.role === "OPERATIONS" || user.role === "EXECUTIVE" || user.role === "ACCOUNTING";

  const { data: exceptionCounts } = useQuery<{ urgent: number; high: number; medium: number; low: number; total: number }>({
    queryKey: ["/api/admin/exceptions/counts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/exceptions/counts", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch counts");
      return res.json();
    },
    enabled: isAdmin,
    refetchInterval: 2 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });

  const exceptionBadges: Record<string, number> = exceptionCounts?.total
    ? { "/queues": exceptionCounts.urgent + exceptionCounts.high }
    : {};

  const { data: unreadNotifData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const notifBadges: Record<string, number> = unreadNotifData?.count
    ? { "/notifications": unreadNotifData.count }
    : {};

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
          title={t("sidebar.sales")} 
          icon={Briefcase} 
          items={menu.sales} 
          location={location}
          defaultOpen={true}
        />
        <CollapsibleSection 
          title={t("sidebar.myAccount")} 
          icon={User} 
          items={menu.personal} 
          location={location}
        />
        <CollapsibleSection 
          title={t("sidebar.resources")} 
          icon={BookOpen} 
          items={menu.resources} 
          location={location}
          badges={notifBadges}
        />
      </>
    );
  };

  const renderAdminSidebar = () => (
    <>
      <CollapsibleSection 
        title={t("sidebar.operations")} 
        icon={Briefcase} 
        items={adminOpsItems} 
        location={location}
        defaultOpen={true}
      />
      <CollapsibleSection 
        title={t("sidebar.accounting")} 
        icon={Wallet} 
        items={adminAccountingItems} 
        location={location}
        badges={exceptionBadges}
      />
      <CollapsibleSection 
        title={t("sidebar.resources")} 
        icon={BookOpen} 
        items={[MENU.knowledge]} 
        location={location}
      />
    </>
  );

  const renderExecutiveSidebar = () => {
    const isExec = user.role === "EXECUTIVE";
    const isOps = user.role === "OPERATIONS";
    const opsItems = isExec
      ? execOpsItems.filter(i => i !== MENU.payRuns)
      : execOpsItems;
    const settingsItems = isExec
      ? [MENU.users]
      : adminSettingsItems;

    return (
      <>
        <CollapsibleSection 
          title={t("sidebar.operations")} 
          icon={Briefcase} 
          items={opsItems} 
          location={location}
          defaultOpen={true}
        />
        <CollapsibleSection
          title={t("sidebar.operationsAutomation")}
          icon={Timer}
          items={operationsAutomationItems}
          location={location}
        />
        {isExec ? (
          <CollapsibleSection 
            title={t("sidebar.accounting")} 
            icon={Wallet} 
            items={[MENU.audit, ...accountingAutomationItems]} 
            location={location}
          />
        ) : (
          <>
            <CollapsibleSection 
              title={t("sidebar.accounting")} 
              icon={Wallet} 
              items={adminAccountingItems} 
              location={location}
              badges={exceptionBadges}
            />
            <CollapsibleSection
              title={t("sidebar.accountingAutomation")}
              icon={CalendarCheck}
              items={accountingAutomationItems}
              location={location}
            />
          </>
        )}
        <CollapsibleSection 
          title={t("sidebar.insights")} 
          icon={TrendingUp} 
          items={adminInsightsItems} 
          location={location}
        />
        <CollapsibleSection 
          title={t("sidebar.myAccount")} 
          icon={User} 
          items={[...personalItems, ...preferencesItems]} 
          location={location}
          badges={notifBadges}
        />
        <CollapsibleSection 
          title={t("sidebar.resources")} 
          icon={BookOpen} 
          items={[MENU.knowledge]} 
          location={location}
        />
        <CollapsibleSection 
          title={t("sidebar.systemSettings")} 
          icon={Cog} 
          items={settingsItems} 
          location={location}
        />
      </>
    );
  };

  const renderDirectorSidebar = () => (
    <>
      <CollapsibleSection
        title={t("sidebar.menu.dashboard")}
        icon={LayoutDashboard}
        items={[MENU.dashboard, MENU.quickEntry]}
        location={location}
        defaultOpen={true}
      />
      <CollapsibleSection
        title={t("sidebar.operations")}
        icon={Briefcase}
        items={[MENU.orders, MENU.orderTracker, MENU.overrideApprovals, MENU.adjustments]}
        location={location}
      />
      <CollapsibleSection
        title={t("sidebar.insights")}
        icon={TrendingUp}
        items={[MENU.reports, MENU.execReports, MENU.userActivity, MENU.geography]}
        location={location}
      />
      <CollapsibleSection
        title={t("common.settings")}
        icon={Cog}
        items={[MENU.users, MENU.rateCards]}
        location={location}
      />
      <CollapsibleSection
        title={t("sidebar.myAccount")}
        icon={User}
        items={[...personalItems, ...preferencesItems]}
        location={location}
        badges={notifBadges}
      />
      <CollapsibleSection
        title={t("sidebar.resources")}
        icon={BookOpen}
        items={[MENU.knowledge]}
        location={location}
      />
    </>
  );

  const renderAccountingSidebar = () => (
    <>
      <CollapsibleSection
        title={t("sidebar.menu.dashboard")}
        icon={LayoutDashboard}
        items={[MENU.dashboard]}
        location={location}
        defaultOpen={true}
      />
      <CollapsibleSection
        title={t("sidebar.menu.orders")}
        icon={Briefcase}
        items={[MENU.orders]}
        location={location}
      />
      <CollapsibleSection
        title={t("sidebar.accounting")}
        icon={Wallet}
        items={[...adminAccountingItems, MENU.payRuns, MENU.overrideApprovals]}
        location={location}
        badges={exceptionBadges}
      />
      <CollapsibleSection
        title={t("sidebar.accountingAutomation")}
        icon={CalendarCheck}
        items={accountingAutomationItems}
        location={location}
      />
      <CollapsibleSection
        title={t("sidebar.insights")}
        icon={TrendingUp}
        items={[MENU.reports, MENU.execReports]}
        location={location}
      />
      <CollapsibleSection
        title={t("sidebar.systemSettings")}
        icon={Cog}
        items={[MENU.rateCards, MENU.quickbooks, MENU.overrides]}
        location={location}
      />
      <CollapsibleSection
        title={t("sidebar.myAccount")}
        icon={User}
        items={[...personalItems, ...preferencesItems]}
        location={location}
        badges={notifBadges}
      />
      <CollapsibleSection
        title={t("sidebar.resources")}
        icon={BookOpen}
        items={[MENU.knowledge]}
        location={location}
      />
    </>
  );

  const renderSidebar = () => {
    if (user.role === "EXECUTIVE" || user.role === "OPERATIONS") return renderExecutiveSidebar();
    if (user.role === "DIRECTOR") return renderDirectorSidebar();
    if (user.role === "ACCOUNTING") return renderAccountingSidebar();
    if (user.role === "ADMIN") return renderAdminSidebar();
    return renderNonAdminSidebar();
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-2 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-full">
          <img src={logoImage} alt="Iron Crest Solutions" className="w-full h-auto object-contain" />
        </div>
      </SidebarHeader>
      
      <SidebarContent className="gap-1">
        {renderSidebar()}
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
        <div className="flex items-center gap-1 mb-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {t("common.signOut")}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
