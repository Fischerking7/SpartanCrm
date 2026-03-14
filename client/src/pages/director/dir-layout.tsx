import { useLocation, Link } from "wouter";
import { BarChart3, Home, TrendingUp, CheckSquare, BookOpen } from "lucide-react";

const navItems = [
  { label: "Home", icon: Home, path: "/director" },
  { label: "Production", icon: BarChart3, path: "/director/production" },
  { label: "Analytics", icon: TrendingUp, path: "/director/analytics" },
  { label: "Approvals", icon: CheckSquare, path: "/director/approvals" },
  { label: "Resources", icon: BookOpen, path: "/director/resources" },
];

export function DirNav() {
  const [location] = useLocation();

  return (
    <nav className="flex overflow-x-auto border-b bg-background" data-testid="dir-nav">
      {navItems.map(item => {
        const active = item.path === "/director"
          ? location === "/director"
          : location.startsWith(item.path);
        return (
          <Link key={item.path} href={item.path}>
            <span
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`nav-${item.label.toLowerCase()}`}
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
