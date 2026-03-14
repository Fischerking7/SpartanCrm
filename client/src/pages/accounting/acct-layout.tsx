import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Wallet, FileText, CreditCard, Shield, Landmark, BarChart3
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/accounting" },
  { label: "Pay Runs", icon: Wallet, path: "/accounting/pay-runs" },
  { label: "Pay Stubs", icon: FileText, path: "/accounting/pay-stubs" },
  { label: "AR", icon: CreditCard, path: "/accounting/ar" },
  { label: "Overrides", icon: Shield, path: "/accounting/overrides" },
  { label: "Advances", icon: Landmark, path: "/accounting/advances" },
  { label: "Reports", icon: BarChart3, path: "/accounting/reports" },
];

export function AcctNav() {
  const [location, setLocation] = useLocation();

  return (
    <nav className="flex overflow-x-auto border-b bg-background px-4 gap-1" data-testid="acct-nav">
      {navItems.map(item => {
        const isActive = location === item.path || (item.path !== "/accounting" && location.startsWith(item.path));
        const isHome = item.path === "/accounting" && location === "/accounting";
        return (
          <button
            key={item.path}
            onClick={() => setLocation(item.path)}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
              (isActive || isHome)
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            )}
            data-testid={`nav-acct-${item.label.toLowerCase().replace(/\s/g, "-")}`}
          >
            <item.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
