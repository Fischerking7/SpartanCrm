import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth, getAuthHeaders } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, ClipboardList, Zap, MessageSquare, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  badge?: number;
}

export function MobileBottomNav() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/messages/unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/messages/unread-count", { headers: getAuthHeaders() });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  if (!isMobile || !user) {
    return null;
  }

  const unreadCount = unreadData?.count || 0;

  const navItems: NavItem[] = [
    { label: "Dashboard", icon: <LayoutDashboard className="h-5 w-5" />, path: "/" },
    { label: "Orders", icon: <ClipboardList className="h-5 w-5" />, path: "/order-tracker" },
    { label: "Quick Entry", icon: <Zap className="h-5 w-5" />, path: "/mobile-entry" },
    { label: "Performance", icon: <Target className="h-5 w-5" />, path: "/my-performance" },
    { label: "Messages", icon: <MessageSquare className="h-5 w-5" />, path: "/messages", badge: unreadCount },
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
                "relative transition-transform",
                isActive ? "scale-110" : ""
              )}>
                {item.icon}
                {item.badge && item.badge > 0 ? (
                  <span className="absolute -top-1 -right-2 h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
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
