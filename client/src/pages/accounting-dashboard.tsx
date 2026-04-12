import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  Clock,
  CheckCircle,
  AlertTriangle,
  FileText,
  TrendingUp,
  ArrowRight,
  Receipt,
  Wallet,
  CircleDollarSign,
} from "lucide-react";
import { Link } from "wouter";

interface AdminStats {
  totalEarnedMTD: number;
  totalPaidMTD: number;
  pendingInstalls: number;
  activeReps: number;
  unmatchedPayments: number;
  unmatchedChargebacks: number;
  rateIssues: number;
  pendingAdjustments: number;
}

interface PayRun {
  id: string;
  name: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  totalNetPay?: string;
  createdAt: string;
}

interface PendingOverride {
  id: string;
  overrideType: string;
  amount: string;
  recipientName: string;
  orderCustomerName: string;
}

function formatCurrency(amount: number | string) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(num || 0);
}

function StatCard({ title, value, subtitle, icon: Icon, color, href }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  color: string;
  href?: string;
}) {
  const content = (
    <Card className="hover:shadow-md transition-shadow" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

const OVERRIDE_LABELS: Record<string, string> = {
  LEADER_OVERRIDE: "Leader",
  MANAGER_OVERRIDE: "Manager",
  DIRECTOR_OVERRIDE: "Director",
  ADMIN_OVERRIDE: "Operations",
  ACCOUNTING_OVERRIDE: "Accounting",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  IN_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  FINALIZED: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
};

export default function AccountingDashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/dashboard/admin-stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/admin-stats", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: payRuns = [], isLoading: payRunsLoading } = useQuery<PayRun[]>({
    queryKey: ["/api/admin/payruns"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payruns", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: pendingOverrides = [] } = useQuery<PendingOverride[]>({
    queryKey: ["/api/admin/override-earnings/pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/override-earnings/pending", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: pendingCount } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/override-earnings/pending/count"],
    queryFn: async () => {
      const res = await fetch("/api/admin/override-earnings/pending/count", { headers: getAuthHeaders() });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
  });

  const activePayRuns = payRuns.filter(pr => !["PAID", "REJECTED"].includes(pr.status));
  const recentPayRuns = payRuns.slice(0, 5);

  const pendingOverrideTotal = pendingOverrides.reduce((sum, o) => sum + parseFloat(o.amount || "0"), 0);
  const overridesByType = pendingOverrides.reduce<Record<string, number>>((acc, o) => {
    acc[o.overrideType] = (acc[o.overrideType] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("accountingDashboard.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("accountingDashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <StatCard
              title={t("accountingDashboard.earnedMTD")}
              value={formatCurrency(stats?.totalEarnedMTD || 0)}
              subtitle={t("accountingDashboard.totalCommissionsEarned")}
              icon={DollarSign}
              color="bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400"
            />
            <StatCard
              title={t("accountingDashboard.paidMTD")}
              value={formatCurrency(stats?.totalPaidMTD || 0)}
              subtitle={t("accountingDashboard.totalCommissionsPaid")}
              icon={CircleDollarSign}
              color="bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400"
            />
            <StatCard
              title={t("accountingDashboard.pendingOverrides")}
              value={pendingCount?.count || 0}
              subtitle={pendingOverrideTotal > 0 ? formatCurrency(pendingOverrideTotal) : t("accountingDashboard.nonePending")}
              icon={Clock}
              color="bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400"
              href="/admin/override-approvals"
            />
            <StatCard
              title={t("accountingDashboard.actionItems")}
              value={(stats?.unmatchedPayments || 0) + (stats?.unmatchedChargebacks || 0) + (stats?.pendingAdjustments || 0)}
              subtitle={t("accountingDashboard.paymentsChargebacks", { payments: stats?.unmatchedPayments || 0, chargebacks: stats?.unmatchedChargebacks || 0 })}
              icon={AlertTriangle}
              color="bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400"
              href="/queues"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-pending-overrides">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                {t("accountingDashboard.pendingOverrideApprovals")}
              </CardTitle>
              <Link href="/admin/override-approvals">
                <Button variant="ghost" size="sm" data-testid="link-view-overrides">
                  {t("accountingDashboard.viewAll")} <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {pendingOverrides.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-muted-foreground">
                <CheckCircle className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">{t("accountingDashboard.allOverridesApproved")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 mb-3">
                  {Object.entries(overridesByType).map(([type, count]) => (
                    <Badge key={type} variant="outline" className="text-xs">
                      {OVERRIDE_LABELS[type] || type}: {count}
                    </Badge>
                  ))}
                </div>
                <div className="space-y-2">
                  {pendingOverrides.slice(0, 5).map(o => (
                    <div key={o.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {OVERRIDE_LABELS[o.overrideType] || o.overrideType}
                        </Badge>
                        <span className="truncate text-muted-foreground">{o.recipientName}</span>
                      </div>
                      <span className="font-medium text-green-600 dark:text-green-400 shrink-0 ml-2">
                        {formatCurrency(o.amount)}
                      </span>
                    </div>
                  ))}
                  {pendingOverrides.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      {t("accountingDashboard.morePending", { count: pendingOverrides.length - 5 })}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-sm font-medium">{t("accountingDashboard.totalPending")}</span>
                  <span className="text-sm font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(pendingOverrideTotal)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-pay-runs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                {t("accountingDashboard.payRunsSection")}
              </CardTitle>
              <Link href="/payruns">
                <Button variant="ghost" size="sm" data-testid="link-view-payruns">
                  {t("accountingDashboard.viewAll")} <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {payRunsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : recentPayRuns.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-muted-foreground">
                <FileText className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">{t("accountingDashboard.noPayRuns")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentPayRuns.map(pr => (
                  <div key={pr.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pr.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pr.periodStart} — {pr.periodEnd}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {pr.totalNetPay && (
                        <span className="text-xs font-medium">{formatCurrency(pr.totalNetPay)}</span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[pr.status] || "bg-gray-100 text-gray-700"}`}>
                        {pr.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/accounting">
          <Card className="hover:shadow-md transition-shadow cursor-pointer" data-testid="card-quick-accounting">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900 dark:text-violet-400">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("accountingDashboard.accountingTools")}</p>
                <p className="text-xs text-muted-foreground">{t("accountingDashboard.payStubsDesc")}</p>
              </div>
              <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance">
          <Card className="hover:shadow-md transition-shadow cursor-pointer" data-testid="card-quick-finance">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-100 text-cyan-600 dark:bg-cyan-900 dark:text-cyan-400">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("accountingDashboard.financeImports")}</p>
                <p className="text-xs text-muted-foreground">{t("accountingDashboard.arDesc")}</p>
              </div>
              <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/override-approvals">
          <Card className="hover:shadow-md transition-shadow cursor-pointer" data-testid="card-quick-overrides">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("accountingDashboard.overrideApprovals")}</p>
                <p className="text-xs text-muted-foreground">
                  {(pendingCount?.count || 0) > 0 ? t("accountingDashboard.pendingReview", { count: pendingCount?.count }) : t("accountingDashboard.allCaughtUp")}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
