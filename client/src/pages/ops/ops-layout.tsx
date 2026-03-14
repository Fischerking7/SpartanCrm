import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ShoppingCart, Zap, FileText, Users, BarChart3
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/ops" },
  { label: "Orders", icon: ShoppingCart, path: "/ops/orders" },
  { label: "Install Sync", icon: Zap, path: "/ops/install-sync" },
  { label: "Finance", icon: FileText, path: "/ops/finance-imports" },
  { label: "Reps", icon: Users, path: "/ops/reps" },
  { label: "Reports", icon: BarChart3, path: "/ops/reports" },
];

export function OpsNav() {
  const [location, setLocation] = useLocation();

  return (
    <nav className="flex overflow-x-auto border-b bg-background px-4 gap-1" data-testid="ops-nav">
      {navItems.map(item => {
        const isActive = location === item.path || (item.path !== "/ops" && location.startsWith(item.path));
        const isHome = item.path === "/ops" && location === "/ops";
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
            data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
          >
            <item.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
