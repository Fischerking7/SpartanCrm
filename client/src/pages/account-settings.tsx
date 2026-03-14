import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { getAuthHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, User, FileText, Building2, Bell, Download,
  Shield, Phone, Mail, MapPin, ChevronRight
} from "lucide-react";

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

const DOCUMENTS = [
  { key: "background_check", name: "Background Check Authorization" },
  { key: "chargeback_policy", name: "Chargeback & Reserve Policy" },
  { key: "contractor_app", name: "Contractor Application" },
  { key: "direct_deposit", name: "Direct Deposit Setup" },
  { key: "drug_test", name: "Drug Test Consent" },
  { key: "nda", name: "Non-Disclosure Agreement" },
];

export default function AccountSettings() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: profile, isLoading: profileLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const { data: bankData, isLoading: bankLoading } = useQuery<any>({
    queryKey: ["/api/payroll/my-payment-methods"],
  });

  const userData = profile?.user || user;
  const bankAccounts = Array.isArray(bankData) ? bankData : bankData?.methods || [];

  return (
    <div className="p-4 max-w-lg mx-auto pb-20" data-testid="account-settings-page">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setLocation("/dashboard")} className="p-1" data-testid="button-back">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Account</h1>
      </div>

      {profileLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-5">
          <Card className="rounded-2xl border-0 shadow-sm" data-testid="card-rep-info">
            <CardContent className="p-5">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-full bg-[#1B2A4A] flex items-center justify-center">
                  <span className="text-xl font-bold text-[#C9A84C]">
                    {(userData?.name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h2 className="font-bold text-base" data-testid="text-user-name">{userData?.name}</h2>
                  <Badge variant="secondary" className="text-[10px] mt-0.5">{userData?.role}</Badge>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Shield className="h-4 w-4" />
                  <span>Rep ID: <span className="text-foreground font-medium" data-testid="text-rep-id">{userData?.repId}</span></span>
                </div>
                {userData?.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span data-testid="text-email">{userData.email}</span>
                  </div>
                )}
                {userData?.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span data-testid="text-phone">{userData.phone}</span>
                  </div>
                )}
                {userData?.assignedManagerName && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4" />
                    <span>Manager: <span className="text-foreground" data-testid="text-manager">{userData.assignedManagerName}</span></span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              My Documents
            </h3>
            <Card className="rounded-2xl border-0 shadow-sm">
              <CardContent className="p-0 divide-y">
                {DOCUMENTS.map((doc) => (
                  <div key={doc.key} className="flex items-center gap-3 px-4 py-3" data-testid={`doc-row-${doc.key}`}>
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{doc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {userData?.onboardingSubmittedAt ? `Signed ${formatDate(userData.onboardingSubmittedAt)}` : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              My Bank Account
            </h3>
            <Card className="rounded-2xl border-0 shadow-sm">
              <CardContent className="p-4">
                {bankLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : bankAccounts.length > 0 ? (
                  <div className="flex items-center gap-3" data-testid="bank-account-info">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{bankAccounts[0].bankName || "Bank Account"}</p>
                      <p className="text-xs text-muted-foreground">
                        {bankAccounts[0].accountType || "Checking"} ····{bankAccounts[0].lastFour || "****"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No bank account on file</p>
                )}
                <p className="text-xs text-muted-foreground mt-3 italic">
                  To change bank info, contact Operations.
                </p>
              </CardContent>
            </Card>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Notifications
            </h3>
            <Card className="rounded-2xl border-0 shadow-sm">
              <CardContent className="p-0 divide-y">
                {[
                  { key: "payStub", label: "Pay stub ready" },
                  { key: "orderUpdate", label: "Order status updates" },
                  { key: "chargeback", label: "Chargeback alerts" },
                  { key: "reserve", label: "Reserve balance alerts" },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between px-4 py-3" data-testid={`notification-toggle-${item.key}`}>
                    <span className="text-sm">{item.label}</span>
                    <Switch defaultChecked />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full h-12 rounded-xl"
              onClick={() => setLocation("/change-password")}
              data-testid="button-change-password"
            >
              Change Password
            </Button>

            <Button
              variant="outline"
              className="w-full h-12 rounded-xl text-red-500 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              onClick={logout}
              data-testid="button-logout"
            >
              Sign Out
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center pb-4">
            Iron Crest CRM v1.0 · Support: ops@ironcrestcrm.com
          </p>
        </div>
      )}
    </div>
  );
}
