import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bell, Mail, CheckCircle, XCircle, DollarSign, AlertTriangle, CreditCard } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface NotificationPreferences {
  emailOrderApproved: boolean;
  emailOrderRejected: boolean;
  emailPayRunFinalized: boolean;
  emailChargebackApplied: boolean;
  emailAdvanceUpdates: boolean;
}

export default function NotificationSettings() {
  const { toast } = useToast();

  const { data: preferences, isLoading } = useQuery<NotificationPreferences>({
    queryKey: ["/api/notification-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/notification-preferences", {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<NotificationPreferences>) => {
      return apiRequest("PATCH", "/api/notification-preferences", updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({ title: "Preferences saved" });
    },
    onError: () => {
      toast({ title: "Failed to save preferences", variant: "destructive" });
    },
  });

  const handleToggle = (key: keyof NotificationPreferences, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  const notificationTypes = [
    {
      key: "emailOrderApproved" as const,
      title: "Order Approved",
      description: "Get notified when your orders are approved",
      icon: CheckCircle,
      iconColor: "text-green-500",
    },
    {
      key: "emailOrderRejected" as const,
      title: "Order Rejected",
      description: "Get notified when your orders are rejected",
      icon: XCircle,
      iconColor: "text-red-500",
    },
    {
      key: "emailPayRunFinalized" as const,
      title: "Pay Run Finalized",
      description: "Get notified when a pay run is finalized and your pay statement is ready",
      icon: DollarSign,
      iconColor: "text-blue-500",
    },
    {
      key: "emailChargebackApplied" as const,
      title: "Chargeback Applied",
      description: "Get notified when a chargeback is applied to one of your orders",
      icon: AlertTriangle,
      iconColor: "text-orange-500",
    },
    {
      key: "emailAdvanceUpdates" as const,
      title: "Advance Updates",
      description: "Get notified about advance request approvals or rejections",
      icon: CreditCard,
      iconColor: "text-purple-500",
    },
  ];

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Bell className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Notification Settings</h1>
          <p className="text-muted-foreground">Choose which email notifications you want to receive</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Notifications
          </CardTitle>
          <CardDescription>
            We'll send notifications to your registered email address
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-10 w-48" />
                  <Skeleton className="h-6 w-10" />
                </div>
              ))}
            </div>
          ) : preferences ? (
            notificationTypes.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between py-2 border-b last:border-0"
                data-testid={`toggle-${item.key}`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className={`h-5 w-5 ${item.iconColor}`} />
                  <div>
                    <Label className="text-base font-medium">{item.title}</Label>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <Switch
                  checked={preferences[item.key]}
                  onCheckedChange={(checked) => handleToggle(item.key, checked)}
                  disabled={updateMutation.isPending}
                />
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Unable to load preferences</p>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground mt-4 text-center">
        Note: Some critical notifications cannot be disabled and will always be sent.
      </p>
    </div>
  );
}
