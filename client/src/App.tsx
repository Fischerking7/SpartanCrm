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
import { OpsNav, OpsLayout } from "@/pages/ops/ops-layout";
import { AcctNav, AcctLayout } from "@/pages/accounting/acct-layout";
import { DirNav, DirLayout } from "@/pages/director/dir-layout";
import { ExecNav } from "@/pages/executive/exec-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivityTracker } from "@/hooks/use-activity-tracker";

import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import SalesDashboard from "@/pages/sales-dashboard";
import AdminDashboard from "@/pages/admin-dashboard";
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
import AdminPayroll from "@/pages/admin/payroll";
import AdminPayrollAdvanced from "@/pages/admin/payroll-advanced";
import AdminQuickBooks from "@/pages/admin/quickbooks";
import AdminIntegrations from "@/pages/admin/integrations";
import AdminOnboardingReview from "@/pages/admin/onboarding-review";
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
import RepHome from "@/pages/rep-home";
import NewOrder from "@/pages/new-order";
import MyOrders from "@/pages/my-orders";
import MyEarnings from "@/pages/my-earnings";
import MyDisputes from "@/pages/my-disputes";
import MyReserve from "@/pages/my-reserve";
import AccountSettings from "@/pages/account-settings";
import OnboardingPortal from "@/pages/onboarding";
import AdminDisputes from "@/pages/admin-disputes";
import OrderTracker from "@/pages/order-tracker";
import UserActivityPage from "@/pages/admin/user-activity";
import InstallSync from "@/pages/admin/install-sync";
import OpsHome from "@/pages/ops/ops-home";
import OpsOrders from "@/pages/ops/ops-orders";
import OpsInstallSync from "@/pages/ops/ops-install-sync";
import OpsFinanceImports from "@/pages/ops/ops-finance-imports";
import OpsReps from "@/pages/ops/ops-reps";
import OpsReports from "@/pages/ops/ops-reports";
import OpsPayRuns from "@/pages/ops/ops-payruns";
import OpsPayStubs from "@/pages/ops/ops-paystubs";
import OpsAR from "@/pages/ops/ops-ar";
import OpsOverrides from "@/pages/ops/ops-overrides";
import OpsAdvances from "@/pages/ops/ops-advances";
import OpsSettings from "@/pages/ops/ops-settings";
import OpsLeadImport from "@/pages/ops/ops-lead-import";
import OpsOrderTracker from "@/pages/ops/ops-order-tracker";
import AcctHome from "@/pages/accounting/acct-home";
import AcctPayRuns from "@/pages/accounting/acct-pay-runs";
import AcctPayStubs from "@/pages/accounting/acct-pay-stubs";
import AcctAR from "@/pages/accounting/acct-ar";
import AcctOverrides from "@/pages/accounting/acct-overrides";
import AcctAdvances from "@/pages/accounting/acct-advances";
import AcctReports from "@/pages/accounting/acct-reports";
import Acct1099 from "@/pages/accounting/acct-1099";
import DirHome from "@/pages/director/dir-home";
import DirProduction from "@/pages/director/dir-production";
import DirAnalytics from "@/pages/director/dir-analytics";
import DirApprovals from "@/pages/director/dir-approvals";
import DirResources from "@/pages/director/dir-resources";
import ExecHome from "@/pages/executive/exec-home";
import ExecFinancials from "@/pages/executive/exec-financials";
import ExecProduction from "@/pages/executive/exec-production";
import ExecOverrides from "@/pages/executive/exec-overrides";
import ExecSettings from "@/pages/executive/exec-settings";
import NotFound from "@/pages/not-found";

function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;
  
  switch (user.role) {
    case "EXECUTIVE":
      return <ExecHome />;
    case "DIRECTOR":
      return <DirHome />;
    case "OPERATIONS":
      return <OpsHome />;
    case "ACCOUNTING":
      return <AcctHome />;
    case "MANAGER":
      return <SalesDashboard />;
    case "REP":
    case "MDU":
    case "LEAD":
      return <RepHome />;
    default:
      return <SalesDashboard />;
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
  
  if (adminOnly && user.role !== "OPERATIONS" && user.role !== "EXECUTIVE") {
    return <Redirect to="/" />;
  }
  
  return <>{children}</>;
}

const routeTitles: Record<string, string> = {
  "/": "Dashboard",
  "/dashboard": "Dashboard",
  "/rep-home": "Home",
  "/orders/new": "New Order",
  "/my-orders": "My Orders",
  "/my-earnings": "My Earnings",
  "/reserve": "My Reserve",
  "/account": "Account",
  "/onboarding": "Onboarding",
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
  "/finance": "Finance",
  "/audit": "Audit Log",
  "/queues": "Queues",
  "/export-history": "Exports",
  "/recalculate": "Recalculate",
  "/admin/user-activity": "User Activity",
  "/director": "Director Home",
  "/director/production": "Team Production",
  "/director/analytics": "Trends & Analytics",
  "/director/approvals": "Order Approvals",
  "/director/resources": "Knowledge & Goals",
  "/executive": "Executive Home",
  "/executive/financials": "Financials",
  "/executive/production": "Production",
  "/executive/overrides": "Override Approvals",
  "/executive/settings": "Company Settings",
  "/ops": "Operations Center",
  "/ops/orders": "Order Management",
  "/ops/order-tracker": "Order Tracker",
  "/ops/install-sync": "Install Sync",
  "/ops/finance-imports": "Finance Imports",
  "/ops/reps": "Rep Management",
  "/ops/reports": "Reports",
  "/ops/pay-runs": "Pay Runs",
  "/ops/pay-stubs": "Pay Stubs",
  "/ops/ar": "AR Management",
  "/ops/overrides": "Overrides",
  "/ops/advances": "Advances",
  "/ops/settings": "Settings",
  "/accounting": "Accounting",
  "/accounting/order-tracker": "Order Tracker",
  "/accounting/pay-runs": "Pay Runs",
  "/accounting/pay-stubs": "Pay Stubs",
  "/accounting/ar": "Accounts Receivable",
  "/accounting/overrides": "Override Approvals",
  "/accounting/advances": "Advances & Deductions",
  "/accounting/reports": "Financial Reports",
  "/accounting/1099": "1099 Preparation",
  "/admin/integrations": "Integrations",
};

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
  const showOpsNav = false;
  const showAcctNav = false;
  const showDirNav = false;
  const showExecNav = user.role === "EXECUTIVE" && location.startsWith("/executive");
  const pageTitle = routeTitles[location] || routeTitles[location.split("/").slice(0, 2).join("/")] || "";

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-2 border-b bg-background sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <span className="text-sm font-medium md:hidden truncate flex-1" data-testid="text-page-title">{pageTitle}</span>
            <ThemeToggle />
          </header>
          {showOpsNav && <OpsNav />}
          {showAcctNav && <AcctNav />}
          {showDirNav && <DirNav />}
          {showExecNav && <ExecNav />}
          <main className={`flex-1 overflow-auto ${showBottomNav ? "pb-16 md:pb-0" : ""}`}>
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
        <Route path="/onboarding" component={OnboardingPortal} />
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

  const isAdmin = user.role === "OPERATIONS" || user.role === "EXECUTIVE";
  const canReviewMdu = user.role === "OPERATIONS" || user.role === "EXECUTIVE";
  const canViewReports = user.role !== "REP";

  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/rep-home" component={RepHome} />
        <Route path="/orders/new" component={NewOrder} />
        <Route path="/my-orders" component={MyOrders} />
        <Route path="/my-earnings" component={MyEarnings} />
        <Route path="/reserve" component={MyReserve} />
        <Route path="/account" component={AccountSettings} />
        <Route path="/onboarding" component={OnboardingPortal} />
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
        
        {user.role === "MDU" && <Route path="/mdu-orders" component={MduOrders} />}
        
        {canViewReports && <Route path="/reports" component={Reports} />}
        {canViewReports && <Route path="/executive-reports" component={ExecutiveReports} />}
        {canViewReports && <Route path="/sales-pipeline" component={SalesPipeline} />}
        
        {canReviewMdu && <Route path="/admin/mdu-review" component={AdminMduReview} />}

        {user.role === "DIRECTOR" && (
          <Route path="/ops/orders">{() => <OpsLayout><OpsOrders /></OpsLayout>}</Route>
        )}

        {(user.role === "OPERATIONS" || user.role === "EXECUTIVE") && (
          <>
            <Route path="/ops">{() => <OpsLayout><OpsHome /></OpsLayout>}</Route>
            <Route path="/ops/orders">{() => <OpsLayout><OpsOrders /></OpsLayout>}</Route>
            <Route path="/ops/order-tracker">{() => <OpsLayout><OpsOrderTracker /></OpsLayout>}</Route>
            <Route path="/ops/install-sync">{() => <OpsLayout><OpsInstallSync /></OpsLayout>}</Route>
            <Route path="/ops/finance-imports">{() => <OpsLayout><OpsFinanceImports /></OpsLayout>}</Route>
            <Route path="/ops/reps">{() => <OpsLayout><OpsReps /></OpsLayout>}</Route>
            <Route path="/ops/lead-import">{() => <OpsLayout><OpsLeadImport /></OpsLayout>}</Route>
            <Route path="/ops/pay-runs">{() => <OpsLayout><OpsPayRuns /></OpsLayout>}</Route>
            <Route path="/ops/pay-stubs">{() => <OpsLayout><OpsPayStubs /></OpsLayout>}</Route>
            <Route path="/ops/ar">{() => <OpsLayout><OpsAR /></OpsLayout>}</Route>
            <Route path="/ops/overrides">{() => <OpsLayout><OpsOverrides /></OpsLayout>}</Route>
            <Route path="/ops/advances">{() => <OpsLayout><OpsAdvances /></OpsLayout>}</Route>
            <Route path="/ops/reports">{() => <OpsLayout><OpsReports /></OpsLayout>}</Route>
            <Route path="/ops/settings">{() => <OpsLayout><OpsSettings /></OpsLayout>}</Route>
          </>
        )}
        
        {(user.role === "EXECUTIVE" || user.role === "DIRECTOR") && (
          <>
            <Route path="/director">{() => <DirLayout><DirHome /></DirLayout>}</Route>
            <Route path="/director/production">{() => <DirLayout><DirProduction /></DirLayout>}</Route>
            <Route path="/director/analytics">{() => <DirLayout><DirAnalytics /></DirLayout>}</Route>
            <Route path="/director/approvals">{() => <DirLayout><DirApprovals /></DirLayout>}</Route>
            <Route path="/director/resources">{() => <DirLayout><DirResources /></DirLayout>}</Route>
          </>
        )}

        {user.role === "EXECUTIVE" && (
          <>
            <Route path="/executive" component={ExecHome} />
            <Route path="/executive/financials" component={ExecFinancials} />
            <Route path="/executive/production" component={ExecProduction} />
            <Route path="/executive/overrides" component={ExecOverrides} />
            <Route path="/executive/settings" component={ExecSettings} />
          </>
        )}

        {(user.role === "ACCOUNTING" || user.role === "EXECUTIVE" || user.role === "OPERATIONS" || user.role === "DIRECTOR") && (
          <>
            <Route path="/accounting">{() => <AcctLayout><AcctHome /></AcctLayout>}</Route>
            <Route path="/accounting/order-tracker">{() => <AcctLayout><OpsOrderTracker /></AcctLayout>}</Route>
            <Route path="/accounting/pay-runs">{() => <AcctLayout><AcctPayRuns /></AcctLayout>}</Route>
            <Route path="/accounting/pay-stubs">{() => <AcctLayout><AcctPayStubs /></AcctLayout>}</Route>
            <Route path="/accounting/ar">{() => <AcctLayout><AcctAR /></AcctLayout>}</Route>
            <Route path="/accounting/overrides">{() => <AcctLayout><AcctOverrides /></AcctLayout>}</Route>
            <Route path="/accounting/advances">{() => <AcctLayout><AcctAdvances /></AcctLayout>}</Route>
            <Route path="/accounting/reports">{() => <AcctLayout><AcctReports /></AcctLayout>}</Route>
            <Route path="/accounting/1099">{() => <AcctLayout><Acct1099 /></AcctLayout>}</Route>
          </>
        )}
        
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
            <Route path="/admin/integrations" component={AdminIntegrations} />
            <Route path="/admin/onboarding" component={AdminOnboardingReview} />
            <Route path="/admin/employee-credentials" component={AdminEmployeeCredentials} />
            <Route path="/admin/disputes" component={AdminDisputes} />
            <Route path="/admin/install-sync" component={InstallSync} />
          </>
        )}
        
        {["OPERATIONS", "EXECUTIVE", "MANAGER"].includes(user.role) && (
          <Route path="/admin/user-activity" component={UserActivityPage} />
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
