import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function ChangePassword() {
  const { t } = useTranslation();
  const { user, token, mustChangePassword, refreshUser, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast({
        title: t("changePassword.passwordsDoNotMatch"),
        description: t("changePassword.makeSureMatch"),
        variant: "destructive",
      });
      return;
    }
    
    if (newPassword.length < 8) {
      toast({
        title: t("changePassword.passwordTooShort"),
        description: t("changePassword.atLeast8Chars"),
        variant: "destructive",
      });
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const res = await fetch("/api/users/me/password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || t("changePassword.failedToChange"));
      }
      
      toast({
        title: t("changePassword.passwordChanged"),
        description: t("changePassword.updatedSuccessfully"),
      });
      
      await refreshUser();
      setLocation("/");
    } catch (error) {
      toast({
        title: t("changePassword.error"),
        description: error instanceof Error ? error.message : t("changePassword.failedToChange"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-2xl" data-testid="text-page-title">{t("changePassword.title")}</CardTitle>
          </div>
          {mustChangePassword && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <CardDescription className="text-amber-700 dark:text-amber-300">
                {t("changePassword.mustChangeTitle")}
              </CardDescription>
            </div>
          )}
          {!mustChangePassword && (
            <CardDescription>
              {t("changePassword.updateSecure")}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">{t("changePassword.currentPassword")}</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("changePassword.newPassword")}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                data-testid="input-new-password"
              />
              <p className="text-sm text-muted-foreground">
                {t("changePassword.minLengthHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t("changePassword.confirmNewPassword")}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                data-testid="input-confirm-password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
                data-testid="button-change-password"
              >
                {isSubmitting ? t("changePassword.changing") : t("changePassword.changeButton")}
              </Button>
              {mustChangePassword ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={logout}
                  data-testid="button-logout"
                >
                  {t("changePassword.logout")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setLocation("/")}
                  data-testid="button-cancel"
                >
                  {t("changePassword.cancel")}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
