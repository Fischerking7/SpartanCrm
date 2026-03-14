import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Settings, Database, Mail, Cloud, Clock, Shield, Server, Globe
} from "lucide-react";

const configSections = [
  {
    title: "System Status",
    items: [
      { label: "Database", value: "Connected", icon: Database, status: "ok" },
      { label: "Email (SMTP)", value: "Configured", icon: Mail, status: "ok" },
      { label: "Object Storage", value: "Active", icon: Cloud, status: "ok" },
      { label: "Background Scheduler", value: "Running", icon: Clock, status: "ok" },
    ],
  },
  {
    title: "Security",
    items: [
      { label: "JWT Authentication", value: "Active", icon: Shield, status: "ok" },
      { label: "Password Hashing", value: "bcrypt (10 rounds)", icon: Shield, status: "info" },
      { label: "Session Management", value: "Token-based", icon: Shield, status: "info" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "QuickBooks", value: "Check Settings", icon: Globe, status: "neutral" },
      { label: "Carrier SFTP", value: "Polling Active", icon: Server, status: "ok" },
      { label: "AI (Claude)", value: "Connected", icon: Server, status: "ok" },
    ],
  },
];

export default function OpsSettings() {
  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="ops-settings">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration and status</p>
      </div>

      {configSections.map(section => (
        <Card key={section.title} className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {section.items.map(item => (
              <div key={item.label} className="flex items-center justify-between py-3" data-testid={`setting-${item.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium">{item.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{item.value}</span>
                  {item.status === "ok" && <div className="h-2 w-2 rounded-full bg-emerald-500" />}
                  {item.status === "neutral" && <div className="h-2 w-2 rounded-full bg-gray-400" />}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Iron Crest CRM</p>
            <p className="text-xs text-muted-foreground">Operations Interface v4.0</p>
          </div>
          <Badge variant="secondary" className="text-xs">Production</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
