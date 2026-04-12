import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Bell, Mail, CheckCircle, XCircle, DollarSign, AlertTriangle, CreditCard, FileText, BookOpen, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { getAuthHeaders, useAuth } from "@/lib/auth";
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
  const { user } = useAuth();

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

      {(user?.role === "ADMIN" || user?.role === "OPERATIONS") && (
        <TestEmailCard />
      )}

      <p className="text-sm text-muted-foreground mt-4 text-center">
        {t("notificationSettings.note")}
      </p>
    </div>
  );
}

function TestEmailCard() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [resultMessage, setResultMessage] = useState("");

  const handleTestEmail = async () => {
    setStatus("sending");
    setResultMessage("");
    try {
      const res = await fetch("/api/admin/test-email", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.success) {
        setStatus("success");
        setResultMessage(`Test email sent to ${data.sentTo}`);
      } else {
        setStatus("error");
        setResultMessage(data.error || "Failed to send test email");
      }
    } catch {
      setStatus("error");
      setResultMessage("Network error — could not reach the server.");
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Test Email Connection
        </CardTitle>
        <CardDescription>
          Send a test email to verify your SMTP connection is working. The email will be sent to your account's email address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <Button
            onClick={handleTestEmail}
            disabled={status === "sending"}
            data-testid="button-test-email"
          >
            {status === "sending" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Test Email
              </>
            )}
          </Button>
        </div>
        {status === "success" && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md" data-testid="text-test-email-success">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-700 dark:text-green-400">{resultMessage}</p>
          </div>
        )}
        {status === "error" && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md" data-testid="text-test-email-error">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-400">{resultMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
