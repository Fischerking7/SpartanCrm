import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivityTracker } from "@/hooks/use-activity-tracker";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { differenceInDays, isBefore } from "date-fns";
import { AlertTriangle, XCircle, Shield } from "lucide-react";

import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import SalesDashboard from "@/pages/sales-dashboard";
import AdminDashboard from "@/pages/admin-dashboard";
import ExecutiveDashboard from "@/pages/executive-dashboard";
import AccountingDashboard from "@/pages/accounting-dashboard";
import MyReportDashboard from "@/pages/reports/my-dashboard";
import ManagerReportDashboard from "@/pages/reports/manager-dashboard";
import ExecutiveReportDashboard from "@/pages/reports/executive-report-dashboard";
import DirectorReportDashboard from "@/pages/reports/director-dashboard";
import OperationsReportDashboard from "@/pages/reports/operations-report-dashboard";
import Orders from "@/pages/orders";
import Leads from "@/pages/leads";
import Commissions from "@/pages/commissions";
import PayRuns from "@/pages/payruns";
import Accounting from "@/pages/accounting";
import Finance from "@/pages/finance";
import Queues from "@/pages/queues";
import Audit from "@/pages/audit";
import Adjustments from "@/pages/adjustments";
import AdminUsers from "@/pages/admin/users";
import AdminProviders from "@/pages/admin/providers";
import AdminClients from "@/pages/admin/clients";
import AdminServices from "@/pages/admin/services";
import AdminRateCards from "@/pages/admin/rate-cards";
import AdminIncentives from "@/pages/admin/incentives";
import AdminOverrides from "@/pages/admin/overrides";
import OverrideApprovals from "@/pages/admin/override-approvals";
import AdminPayroll from "@/pages/admin/payroll";
import AdminPayrollAdvanced from "@/pages/admin/payroll-advanced";
import AdminQuickBooks from "@/pages/admin/quickbooks";
import ExecutiveReports from "@/pages/executive-reports";
import ExportHistory from "@/pages/export-history";
import Reports from "@/pages/reports";
import Recalculate from "@/pages/recalculate";
import Knowledge from "@/pages/knowledge";
import MyPayHistory from "@/pages/my-pay-history";
import CommissionForecast from "@/pages/commission-forecast";
import NotificationSettings from "@/pages/notification-settings";
import MyCredentials from "@/pages/my-credentials";
import AdminEmployeeCredentials from "@/pages/admin/employee-credentials";
import MduOrders from "@/pages/mdu-orders";
import AdminMduReview from "@/pages/admin/mdu-review";
import SalesPipeline from "@/pages/sales-pipeline";
import Notifications from "@/pages/notifications";
import MobileOrderEntry from "@/pages/mobile-order-entry";
import MyDisputes from "@/pages/my-disputes";
import AdminDisputes from "@/pages/admin-disputes";
import ComplianceCalendar from "@/pages/admin/compliance-calendar";
import OrderTracker from "@/pages/order-tracker";
import UserActivityPage from "@/pages/admin/user-activity";
import InstallSync from "@/pages/admin/install-sync";
import CarrierProfiles from "@/pages/admin/carrier-profiles";
import CarrierRepMappings from "@/pages/admin/carrier-rep-mappings";
import Onboarding from "@/pages/onboarding";
import AdminOnboardingReview from "@/pages/admin/onboarding-review";
import AdminAutomationRules from "@/pages/admin/automation-rules";
import AdminSavedReports from "@/pages/admin/saved-reports";
import NotFound from "@/pages/not-found";
import SlaDashboard from "@/pages/operations/sla-dashboard";
import OnboardingPipeline from "@/pages/operations/onboarding-pipeline";
import PaymentVariances from "@/pages/accounting/payment-variances";
import MonthEnd from "@/pages/accounting/month-end";
import CashFlow from "@/pages/accounting/cash-flow";

function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;
  
  switch (user.role) {
    case "EXECUTIVE":
    case "ADMIN":
      return <ExecutiveReportDashboard />;
    case "DIRECTOR":
      return <DirectorReportDashboard />;
    case "MANAGER":
      return <ManagerReportDashboard />;
    case "OPERATIONS":
    case "ACCOUNTING":
      return <OperationsReportDashboard />;
    default:
      return <MyReportDashboard />;
  }
}

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  
  if (!user) {
    return <Redirect to="/login" />;
  }
  
  if (adminOnly && user.role !== "ADMIN" && user.role !== "OPERATIONS" && user.role !== "EXECUTIVE") {
    return <Redirect to="/" />;
  }
  
  return <>{children}</>;
}

const routeTitles: Record<string, string> = {
  "/": "Dashboard",
  "/dashboard": "Dashboard",
  "/orders": "Orders",
  "/order-tracker": "Order Tracker",
  "/mobile-entry": "Quick Entry",
  "/leads": "Leads",
  "/commissions": "Commissions",
  "/commission-forecast": "Forecast",
  "/my-pay": "My Pay",
  "/my-disputes": "Disputes",
  "/knowledge": "Knowledge Base",
  "/notifications": "Notifications",
  "/notification-settings": "Alert Settings",
  "/reports": "Reports",
  "/executive-reports": "Reports",
  "/sales-pipeline": "Sales Pipeline",
  "/adjustments": "Adjustments",
  "/change-password": "Settings",
  "/my-credentials": "My Credentials",
  "/payruns": "Pay Runs",
  "/accounting": "Accounting",
  "/finance": "Finance",
  "/audit": "Audit Log",
  "/queues": "Queues",
  "/export-history": "Exports",
  "/recalculate": "Recalculate",
  "/admin/user-activity": "User Activity",
  "/admin/automation-rules": "Automation Rules",
  "/admin/saved-reports": "Saved Reports",
  "/operations/sla-dashboard": "SLA & Bottlenecks",
  "/operations/onboarding-pipeline": "Onboarding Pipeline",
  "/accounting/payment-variances": "Payment Variances",
  "/accounting/month-end": "Month-End Checklist",
  "/accounting/cash-flow": "Cash Flow Forecast",
  "/admin/compliance-calendar": "Compliance Calendar",
  "/admin/disputes": "Commission Disputes",
};

interface ComplianceStatus {
  contractorAgreementExpiresAt: string | null;
  ndaExpiresAt: string | null;
  backgroundCheckExpiresAt: string | null;
  drugTestExpiresAt: string | null;
  commissionBlockedDueToExpiry: boolean;
  commissionBlockedReason: string | null;
}

function ComplianceAlertBanner() {
  const { user } = useAuth();
  const repRoles = ["REP", "MDU", "LEAD"];
  const isRep = user && repRoles.includes(user.role);

  const { data: status } = useQuery<ComplianceStatus>({
    queryKey: ["/api/compliance/my-status"],
    queryFn: async () => {
      const res = await fetch("/api/compliance/my-status", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!isRep,
    staleTime: 5 * 60 * 1000,
  });

  const { data: recertRequests } = useQuery<Array<{ id: string; documentTypes: string[]; status: string; requestNote: string | null }>>({
    queryKey: ["/api/compliance/my-recertification"],
    queryFn: async () => {
      const res = await fetch("/api/compliance/my-recertification", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!isRep,
    staleTime: 5 * 60 * 1000,
  });

  if (!isRep) return null;

  const pendingRecert = (recertRequests || []).filter(r => r.status === "PENDING");

  if (pendingRecert.length > 0 && status) {
    const docLabels: Record<string, string> = {
      CONTRACTOR_AGREEMENT: "Contractor Agreement",
      NDA: "NDA",
      BACKGROUND_CHECK: "Background Check",
      DRUG_TEST: "Drug Test",
    };
    const allDocs = [...new Set(pendingRecert.flatMap(r => r.documentTypes))].map(d => docLabels[d] || d);
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/20 border-b border-purple-200 dark:border-purple-800 text-sm" data-testid="banner-recertification-required">
        <Shield className="h-4 w-4 text-purple-600 flex-shrink-0" />
        <span className="text-purple-700 dark:text-purple-400"><strong>Re-certification required:</strong> {allDocs.join(", ")}. Please contact your manager to complete re-signing.</span>
      </div>
    );
  }

  if (!status) return null;

  const now = new Date();
  const checkExpiry = (dateStr: string | null): "expired" | "critical" | "warning" | "notice" | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isBefore(d, now)) return "expired";
    const days = differenceInDays(d, now);
    if (days <= 30) return "critical";
    if (days <= 60) return "warning";
    if (days <= 90) return "notice";
    return null;
  };

  const expiries = [
    { name: "Contractor Agreement", status: checkExpiry(status.contractorAgreementExpiresAt) },
    { name: "NDA", status: checkExpiry(status.ndaExpiresAt) },
    { name: "Background Check", status: checkExpiry(status.backgroundCheckExpiresAt) },
    { name: "Drug Test", status: checkExpiry(status.drugTestExpiresAt) },
  ].filter(e => e.status !== null);

  const hasExpired = expiries.some(e => e.status === "expired");
  const hasCritical = expiries.some(e => e.status === "critical");
  const hasWarning = expiries.some(e => e.status === "warning");
  const hasNotice = expiries.some(e => e.status === "notice");

  if (status.commissionBlockedDueToExpiry) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-sm" data-testid="banner-commission-blocked">
        <XCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
        <span className="text-red-700 dark:text-red-400 font-medium">Commission payouts blocked:</span>
        <span className="text-red-600 dark:text-red-300">{status.commissionBlockedReason || "Expired documents. Contact your manager."}</span>
      </div>
    );
  }

  if (hasExpired) {
    const expiredNames = expiries.filter(e => e.status === "expired").map(e => e.name).join(", ");
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-sm" data-testid="banner-expired-docs">
        <XCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
        <span className="text-red-700 dark:text-red-400"><strong>Expired documents:</strong> {expiredNames}. Re-certification required — contact your manager immediately.</span>
      </div>
    );
  }

  if (hasCritical) {
    const criticalNames = expiries.filter(e => e.status === "critical").map(e => e.name).join(", ");
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-sm" data-testid="banner-expiring-docs-30">
        <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
        <span className="text-red-700 dark:text-red-400"><strong>Documents expiring within 30 days:</strong> {criticalNames}. Contact your manager to schedule renewal.</span>
      </div>
    );
  }

  if (hasWarning) {
    const warningNames = expiries.filter(e => e.status === "warning").map(e => e.name).join(", ");
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-sm" data-testid="banner-expiring-docs-60">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <span className="text-amber-700 dark:text-amber-400"><strong>Documents expiring within 60 days:</strong> {warningNames}. Please plan to renew these soon.</span>
      </div>
    );
  }

  if (hasNotice) {
    const noticeNames = expiries.filter(e => e.status === "notice").map(e => e.name).join(", ");
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 text-sm" data-testid="banner-expiring-docs-90">
        <Shield className="h-4 w-4 text-blue-500 flex-shrink-0" />
        <span className="text-blue-700 dark:text-blue-400"><strong>90-day renewal reminder:</strong> {noticeNames} will expire within 90 days.</span>
      </div>
    );
  }

  return null;
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  useActivityTracker();
  
  if (!user) return null;

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const fieldRoles = ["REP", "MDU", "LEAD"];
  const showBottomNav = fieldRoles.includes(user.role);
  const pageTitle = routeTitles[location] || routeTitles[location.split("/").slice(0, 2).join("/")] || "";

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-3 px-3 py-2 md:p-2 border-b bg-background/95 backdrop-blur-md sticky top-0 z-50 safe-area-top">
            <div className="flex items-center gap-2 min-w-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="md:hidden flex items-center gap-2 min-w-0">
                <div className="w-px h-5 bg-border shrink-0" />
                <span className="text-sm font-semibold truncate" data-testid="text-page-title">{pageTitle}</span>
              </div>
            </div>
            <ThemeToggle />
          </header>
          <main className={`flex-1 overflow-auto ${showBottomNav ? "pb-20 md:pb-0" : ""}`}>
            <ComplianceAlertBanner />
            {children}
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  const { user, mustChangePassword, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="space-y-4 text-center">
          <Skeleton className="h-12 w-12 rounded-full mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }
  
  // Force password change if required
  if (mustChangePassword) {
    return (
      <Switch>
        <Route path="/change-password" component={ChangePassword} />
        <Route>
          <Redirect to="/change-password" />
        </Route>
      </Switch>
    );
  }

  const isAdmin = user.role === "ADMIN" || user.role === "OPERATIONS" || user.role === "EXECUTIVE" || user.role === "ACCOUNTING" || user.role === "DIRECTOR";
  const canViewOpsAutomation = ["OPERATIONS", "ADMIN", "EXECUTIVE", "DIRECTOR"].includes(user.role);
  const canViewAcctAutomation = ["ACCOUNTING", "ADMIN", "OPERATIONS", "EXECUTIVE"].includes(user.role);
  const canReviewMdu = user.role === "ADMIN" || user.role === "OPERATIONS" || user.role === "EXECUTIVE";
  const canViewReports = user.role !== "REP";

  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/orders" component={Orders} />
        <Route path="/order-tracker" component={OrderTracker} />
        <Route path="/leads" component={Leads} />
        <Route path="/commissions" component={Commissions} />
        <Route path="/adjustments" component={Adjustments} />
        <Route path="/knowledge" component={Knowledge} />
        <Route path="/my-pay" component={MyPayHistory} />
        <Route path="/commission-forecast" component={CommissionForecast} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/notification-settings" component={NotificationSettings} />
        <Route path="/my-credentials" component={MyCredentials} />
        <Route path="/change-password" component={ChangePassword} />
        <Route path="/mobile-entry" component={MobileOrderEntry} />
        <Route path="/my-disputes" component={MyDisputes} />
        <Route path="/onboarding" component={Onboarding} />
        
        {user.role === "MDU" && <Route path="/mdu-orders" component={MduOrders} />}
        
        {canViewReports && <Route path="/reports" component={Reports} />}
        {canViewReports && <Route path="/executive-reports" component={ExecutiveReports} />}
        {canViewReports && <Route path="/sales-pipeline" component={SalesPipeline} />}
        
        {canReviewMdu && <Route path="/admin/mdu-review" component={AdminMduReview} />}
        
        {(isAdmin || user.role === "EXECUTIVE") && (
          <>
            <Route path="/payruns" component={PayRuns} />
            <Route path="/export-history" component={ExportHistory} />
            <Route path="/queues" component={Queues} />
            <Route path="/audit" component={Audit} />
            <Route path="/admin/users" component={AdminUsers} />
          </>
        )}
        
        {isAdmin && (
          <>
            <Route path="/accounting" component={Accounting} />
            <Route path="/finance" component={Finance} />
            <Route path="/recalculate" component={Recalculate} />
            <Route path="/admin/providers" component={AdminProviders} />
            <Route path="/admin/clients" component={AdminClients} />
            <Route path="/admin/services" component={AdminServices} />
            <Route path="/admin/rate-cards" component={AdminRateCards} />
            <Route path="/admin/incentives" component={AdminIncentives} />
            <Route path="/admin/overrides" component={AdminOverrides} />
            <Route path="/admin/payroll" component={AdminPayroll} />
            <Route path="/admin/payroll-advanced" component={AdminPayrollAdvanced} />
            <Route path="/admin/quickbooks" component={AdminQuickBooks} />
            <Route path="/admin/employee-credentials" component={AdminEmployeeCredentials} />
            <Route path="/admin/disputes" component={AdminDisputes} />
            <Route path="/admin/compliance-calendar" component={ComplianceCalendar} />
            <Route path="/admin/install-sync" component={InstallSync} />
            <Route path="/admin/carrier-profiles" component={CarrierProfiles} />
            <Route path="/admin/carrier-rep-mappings" component={CarrierRepMappings} />
            <Route path="/admin/onboarding-review" component={AdminOnboardingReview} />
            <Route path="/admin/automation-rules" component={AdminAutomationRules} />
            <Route path="/admin/saved-reports" component={AdminSavedReports} />
          </>
        )}
        
        {["ADMIN", "OPERATIONS", "EXECUTIVE", "ACCOUNTING", "DIRECTOR"].includes(user.role) && (
          <Route path="/admin/override-approvals" component={OverrideApprovals} />
        )}
        
        {["ADMIN", "OPERATIONS", "EXECUTIVE", "MANAGER", "DIRECTOR"].includes(user.role) && (
          <Route path="/admin/user-activity" component={UserActivityPage} />
        )}

        {canViewOpsAutomation && (
          <>
            <Route path="/operations/sla-dashboard" component={SlaDashboard} />
            <Route path="/operations/onboarding-pipeline" component={OnboardingPipeline} />
          </>
        )}

        {canViewAcctAutomation && (
          <>
            <Route path="/accounting/payment-variances" component={PaymentVariances} />
            <Route path="/accounting/month-end" component={MonthEnd} />
            <Route path="/accounting/cash-flow" component={CashFlow} />
          </>
        )}
        
        <Route path="/">
          <Redirect to="/dashboard" />
        </Route>
        <Route>
          <Redirect to="/dashboard" />
        </Route>
      </Switch>
    </AuthenticatedLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <Router />
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
