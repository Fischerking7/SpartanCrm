import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Skeleton } from "@/components/ui/skeleton";

import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import SalesDashboard from "@/pages/sales-dashboard";
import AdminDashboard from "@/pages/admin-dashboard";
import Orders from "@/pages/orders";
import Leads from "@/pages/leads";
import Commissions from "@/pages/commissions";
import Approvals from "@/pages/approvals";
import PayRuns from "@/pages/payruns";
import Accounting from "@/pages/accounting";
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
import NotFound from "@/pages/not-found";

function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;
  
  switch (user.role) {
    case "OPERATIONS":
    case "ADMIN":
    case "EXECUTIVE":
      return <AdminDashboard />;
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
  
  if (adminOnly && user.role !== "ADMIN" && user.role !== "OPERATIONS" && user.role !== "EXECUTIVE") {
    return <Redirect to="/" />;
  }
  
  return <>{children}</>;
}

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  
  if (!user) return null;

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-2 border-b bg-background sticky top-0 z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
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

  const isAdmin = user.role === "ADMIN" || user.role === "OPERATIONS" || user.role === "EXECUTIVE";
  const canReviewMdu = user.role === "ADMIN" || user.role === "OPERATIONS" || user.role === "EXECUTIVE";
  const canViewReports = user.role !== "REP";

  return (
    <AuthenticatedLayout>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/orders" component={Orders} />
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
        
        {(isAdmin || user.role === "EXECUTIVE") && (
          <>
            <Route path="/approvals" component={Approvals} />
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
          </>
        )}
        
        <Route path="/">
          <Redirect to="/orders" />
        </Route>
        <Route>
          <Redirect to="/orders" />
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
