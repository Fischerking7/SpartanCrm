import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { loginSchema, type LoginInput } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { Lock, User, AlertTriangle } from "lucide-react";
import logoImage from "@assets/image_1767725638779.png";
import { useTranslation } from "react-i18next";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState<string | null>(null);

  useEffect(() => {
    const msg = localStorage.getItem("sessionExpiredMessage");
    if (msg) {
      setSessionExpiredMsg(msg);
      localStorage.removeItem("sessionExpiredMessage");
    }
  }, []);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { repId: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setIsLoading(true);
    try {
      await login(values.repId, values.password);
      setLocation("/dashboard");
    } catch (error) {
      toast({
        title: t("auth.loginFailed"),
        description: error instanceof Error ? error.message : t("auth.invalidCredentials"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-end gap-1 p-3 md:p-4 border-b">
        <LanguageToggle />
        <ThemeToggle />
      </header>
      
      <main className="flex-1 flex items-center justify-center px-4 py-8 md:p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4 px-4 pt-6 md:px-6">
            <div className="flex justify-center">
              <img 
                src={logoImage} 
                alt="Iron Crest Solutions" 
                className="w-36 md:w-48 h-auto object-contain"
                data-testid="img-logo"
              />
            </div>
            <div>
              <CardTitle className="text-xl md:text-2xl font-semibold">{t("login.ironCrestCRM")}</CardTitle>
              <CardDescription className="mt-1.5 text-sm">{t("login.signInDescription")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-6 md:px-6">
            {sessionExpiredMsg && (
              <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 flex items-center gap-2" data-testid="text-session-expired">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{sessionExpiredMsg}</p>
              </div>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="repId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">{t("auth.repId")}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            {...field}
                            placeholder={t("auth.enterRepId")}
                            className="pl-10 h-11 md:h-10 text-base md:text-sm"
                            data-testid="input-rep-id"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">{t("auth.password")}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            {...field}
                            type="password"
                            placeholder={t("auth.enterPassword")}
                            className="pl-10 h-11 md:h-10 text-base md:text-sm"
                            data-testid="input-password"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full h-11 md:h-10 text-base md:text-sm font-medium"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? t("auth.signingIn") : t("auth.signIn")}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
