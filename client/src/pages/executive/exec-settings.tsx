import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, Users, Settings, Calendar, BarChart3, Shield, Activity, ChevronRight } from "lucide-react";

const settingsGroups = [
  {
    title: "Rate Cards",
    description: "View and edit commission rates by role and service tier",
    icon: DollarSign,
    path: "/admin/rate-cards",
  },
  {
    title: "Override Agreements",
    description: "Override amounts by service tier and recipient role",
    icon: Shield,
    path: "/admin/overrides",
  },
  {
    title: "Payroll Settings",
    description: "Scheduled pay run configuration and pay period definitions",
    icon: Calendar,
    path: "/admin/payroll",
  },
  {
    title: "User Management",
    description: "Full user roster, role changes, and account management",
    icon: Users,
    path: "/admin/users",
  },
  {
    title: "Services & Providers",
    description: "Manage service tiers and provider configurations",
    icon: Settings,
    path: "/admin/services",
  },
  {
    title: "Incentives",
    description: "Configure bonus and SPIFF programs",
    icon: BarChart3,
    path: "/admin/incentives",
  },
  {
    title: "User Activity",
    description: "Login history, device tracking, and page usage analytics",
    icon: Activity,
    path: "/admin/user-activity",
  },
];

export default function ExecSettings() {
  const [, setLocation] = useLocation();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold mb-4">Company Settings</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {settingsGroups.map(group => (
          <Card
            key={group.path}
            className="cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setLocation(group.path)}
            data-testid={`card-setting-${group.title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10 flex-shrink-0">
                <group.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{group.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
