import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bell, Mail, CheckCircle, XCircle, DollarSign, AlertTriangle, CreditCard, FileText, BookOpen } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";

interface NotificationPreferences {
  emailOrderApproved: boolean;
  emailOrderRejected: boolean;
  emailPayRunFinalized: boolean;
  emailChargebackApplied: boolean;
  emailAdvanceUpdates: boolean;
  emailPayStubDelivery: boolean;
  tutorialEnabled: boolean;
}

export default function NotificationSettings() {
  const { toast } = useToast();
  const { t } = useTranslation();

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
      queryClient.invalidateQueries({ queryKey: ["/api/tutorial/status"] });
      toast({ title: t("notificationSettings.preferencesSaved") });
    },
    onError: () => {
      toast({ title: t("notificationSettings.failedToSave"), variant: "destructive" });
    },
  });

  const handleToggle = (key: keyof NotificationPreferences, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  const notificationTypes = [
    {
      key: "emailOrderApproved" as const,
      title: t("notificationSettings.types.orderApproved.title"),
      description: t("notificationSettings.types.orderApproved.description"),
      icon: CheckCircle,
      iconColor: "text-green-500",
    },
    {
      key: "emailOrderRejected" as const,
      title: t("notificationSettings.types.orderRejected.title"),
      description: t("notificationSettings.types.orderRejected.description"),
      icon: XCircle,
      iconColor: "text-red-500",
    },
    {
      key: "emailPayRunFinalized" as const,
      title: t("notificationSettings.types.payRunFinalized.title"),
      description: t("notificationSettings.types.payRunFinalized.description"),
      icon: DollarSign,
      iconColor: "text-blue-500",
    },
    {
      key: "emailChargebackApplied" as const,
      title: t("notificationSettings.types.chargebackApplied.title"),
      description: t("notificationSettings.types.chargebackApplied.description"),
      icon: AlertTriangle,
      iconColor: "text-orange-500",
    },
    {
      key: "emailAdvanceUpdates" as const,
      title: t("notificationSettings.types.advanceUpdates.title"),
      description: t("notificationSettings.types.advanceUpdates.description"),
      icon: CreditCard,
      iconColor: "text-purple-500",
    },
    {
      key: "emailPayStubDelivery" as const,
      title: t("notificationSettings.types.payStubDelivery.title"),
      description: t("notificationSettings.types.payStubDelivery.description"),
      icon: FileText,
      iconColor: "text-emerald-500",
    },
  ];

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Bell className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("notificationSettings.title")}</h1>
          <p className="text-muted-foreground">{t("notificationSettings.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t("notificationSettings.emailNotifications")}
          </CardTitle>
          <CardDescription>
            {t("notificationSettings.emailDesc")}
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
            <p className="text-muted-foreground">{t("notificationSettings.unableToLoad")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Tutorial
          </CardTitle>
          <CardDescription>
            Re-enable the onboarding tutorial to walk through the app features again on your next login
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-between">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-6 w-10" />
            </div>
          ) : preferences ? (
            <div
              className="flex items-center justify-between py-2"
              data-testid="toggle-tutorial-enabled"
            >
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-indigo-500" />
                <div>
                  <Label className="text-base font-medium">Feature Tour</Label>
                  <p className="text-sm text-muted-foreground">
                    Show the guided tutorial wizard on next login
                  </p>
                </div>
              </div>
              <Switch
                checked={preferences.tutorialEnabled ?? true}
                onCheckedChange={(checked) => handleToggle("tutorialEnabled", checked)}
                disabled={updateMutation.isPending}
                data-testid="switch-tutorial-enabled"
              />
            </div>
          ) : (
            <p className="text-muted-foreground">Unable to load preferences</p>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground mt-4 text-center">
        {t("notificationSettings.note")}
      </p>
    </div>
  );
}
