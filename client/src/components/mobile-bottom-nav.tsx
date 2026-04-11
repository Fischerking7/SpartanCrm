import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { LayoutDashboard, ShoppingCart, Zap, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
}

export function MobileBottomNav() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  if (!isMobile || !user) {
    return null;
  }

  const navItems: NavItem[] = [
    { label: "Dashboard", icon: <LayoutDashboard className="h-5 w-5" />, path: "/" },
    { label: "Orders", icon: <ShoppingCart className="h-5 w-5" />, path: "/orders" },
    { label: "Quick Entry", icon: <Zap className="h-5 w-5" />, path: "/mobile-entry" },
    { label: "Leads", icon: <Users className="h-5 w-5" />, path: "/leads" },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-t border-border md:hidden safe-area-bottom"
      data-testid="mobile-bottom-nav"
    >
      <div className="flex items-stretch justify-around h-16">
        {navItems.map((item) => {
          const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 flex-1 min-w-0 transition-colors active:bg-muted/50",
                isActive
                  ? "text-[hsl(var(--sidebar-primary))]"
                  : "text-muted-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[hsl(var(--sidebar-primary))]" />
              )}
              <span className={cn(
                "transition-transform",
                isActive ? "scale-110" : ""
              )}>
                {item.icon}
              </span>
              <span className={cn(
                "text-[10px] truncate",
                isActive ? "font-semibold" : "font-medium"
              )}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
