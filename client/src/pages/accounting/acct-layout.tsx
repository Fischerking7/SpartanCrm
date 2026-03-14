import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Wallet, FileText, CreditCard, Shield,
  Landmark, BarChart3, FileSpreadsheet, Menu, X
} from "lucide-react";
import { useState } from "react";

const sidebarItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/accounting" },
  { label: "Pay Runs", icon: Wallet, path: "/accounting/pay-runs" },
  { label: "Pay Stubs", icon: FileText, path: "/accounting/pay-stubs" },
  { label: "AR Management", icon: CreditCard, path: "/accounting/ar" },
  { label: "Overrides", icon: Shield, path: "/accounting/overrides" },
  { label: "Advances", icon: Landmark, path: "/accounting/advances" },
  { label: "Reports", icon: BarChart3, path: "/accounting/reports" },
  { label: "1099 Preparation", icon: FileSpreadsheet, path: "/accounting/1099" },
];

export function AcctNav() {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === "/accounting") return location === "/accounting";
    return location.startsWith(path);
  };

  return (
    <>
      <div className="hidden lg:flex flex-col w-56 border-r bg-[#1B2A4A] min-h-0 overflow-y-auto shrink-0" data-testid="acct-sidebar">
        <div className="p-4 border-b border-white/10">
          <h2 className="text-sm font-bold text-white tracking-wide uppercase">Accounting</h2>
        </div>
        <nav className="flex-1 py-2">
          {sidebarItems.map(item => (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                isActive(item.path)
                  ? "bg-[#C9A84C]/20 text-[#C9A84C] font-medium border-r-2 border-[#C9A84C]"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
              data-testid={`acct-nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="lg:hidden border-b bg-[#1B2A4A] px-4 py-2 flex items-center justify-between">
        <h2 className="text-sm font-bold text-white tracking-wide uppercase">Accounting</h2>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-white p-1" data-testid="acct-mobile-menu-toggle">
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="lg:hidden border-b bg-[#1B2A4A] px-2 pb-2">
          <nav className="grid grid-cols-3 gap-1">
            {sidebarItems.map(item => (
              <button
                key={item.path}
                onClick={() => { setLocation(item.path); setMobileOpen(false); }}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-lg text-xs transition-colors",
                  isActive(item.path)
                    ? "bg-[#C9A84C]/20 text-[#C9A84C]"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                )}
                data-testid={`acct-nav-mobile-${item.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

export function AcctLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full" data-testid="acct-layout">
      <AcctNav />
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  );
}
