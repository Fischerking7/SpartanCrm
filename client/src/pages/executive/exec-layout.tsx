import { useLocation, Link } from "wouter";
import { LayoutDashboard, DollarSign, BarChart3, Shield, Settings } from "lucide-react";

const navItems = [
  { label: "Home", icon: LayoutDashboard, path: "/executive" },
  { label: "Financials", icon: DollarSign, path: "/executive/financials" },
  { label: "Production", icon: BarChart3, path: "/executive/production" },
  { label: "Overrides", icon: Shield, path: "/executive/overrides" },
  { label: "Settings", icon: Settings, path: "/executive/settings" },
];

export function ExecNav() {
  const [location] = useLocation();

  return (
    <nav className="flex overflow-x-auto border-b bg-background" data-testid="exec-nav">
      {navItems.map(item => {
        const active = item.path === "/executive"
          ? location === "/executive"
          : location.startsWith(item.path);
        return (
          <Link key={item.path} href={item.path}>
            <span
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`nav-exec-${item.label.toLowerCase()}`}
            >
              <item.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
