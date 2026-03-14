import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Home, ShoppingCart, DollarSign, Users, User } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldRoles = ["REP", "MDU", "LEAD"];

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
}

export function MobileBottomNav() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  if (!isMobile || !user || !fieldRoles.includes(user.role)) {
    return null;
  }

  const navItems: NavItem[] = [
    { label: "Home", icon: <Home className="h-5 w-5" />, path: "/dashboard" },
    { label: "Orders", icon: <ShoppingCart className="h-5 w-5" />, path: "/my-orders" },
    { label: "Earnings", icon: <DollarSign className="h-5 w-5" />, path: "/my-earnings" },
    { label: "Leads", icon: <Users className="h-5 w-5" />, path: "/leads" },
    { label: "Account", icon: <User className="h-5 w-5" />, path: "/account" },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border safe-area-bottom md:hidden"
      data-testid="mobile-bottom-nav"
    >
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors min-w-0",
                isActive
                  ? "text-[#C9A84C]"
                  : "text-muted-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {item.icon}
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
