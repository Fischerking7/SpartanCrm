import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, Clock, FileText, ChevronRight, ChevronLeft,
  Loader2, Shield, Phone, Check, AlertTriangle
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";

const DOCUMENTS = [
  { key: "background_check", name: "Background Check Authorization", time: "~3 min" },
  { key: "chargeback_policy", name: "Chargeback & Reserve Policy", time: "~5 min" },
  { key: "contractor_app", name: "Contractor Application", time: "~8 min" },
  { key: "direct_deposit", name: "Direct Deposit Setup", time: "~5 min" },
  { key: "drug_test", name: "Drug Test Consent", time: "~2 min" },
  { key: "nda", name: "Non-Disclosure Agreement", time: "~3 min" },
  { key: "w9", name: "IRS Form W-9", time: "~4 min" },
];

function formatDate(d: string | Date) {
  const locale = i18n.language === "es" ? "es-MX" : "en-US";
  return new Date(d).toLocaleDateString(locale, { month: "2-digit", day: "2-digit", year: "numeric" });
}

export default function OnboardingPortal() {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [repId, setRepId] = useState("");
  const [otp, setOtp] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [otpExpiry, setOtpExpiry] = useState<number | null>(null);
  const [currentDoc, setCurrentDoc] = useState<string | null>(null);
  const { toast } = useToast();

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repId: repId.trim(), otp: otp.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || t("onboarding.otp.failedTitle"));
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.token) {
        setToken(data.token);
        setOtpExpiry(null);
        setStep(2);
        toast({ title: t("onboarding.otp.verifiedTitle"), description: t("onboarding.otp.verifiedDesc") });
      }
    },
    onError: (err: Error) => {
      toast({ title: t("onboarding.otp.failedTitle"), description: err.message, variant: "destructive" });
    },
  });

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const { data: repInfo, isLoading: repInfoLoading } = useQuery<any>({
    queryKey: ["/api/onboarding/rep-info"],
    enabled: !!token && step >= 2,
    queryFn: async () => {
      const res = await fetch("/api/onboarding/rep-info", { headers: authHeaders as any });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const completedDocs = repInfo?.completedDocuments || {};
  const savedDrafts: string[] = repInfo?.drafts || [];
  const docKeyToCamel: Record<string, string> = {
    background_check: "backgroundCheck",
    chargeback_policy: "chargebackPolicy",
    contractor_app: "contractorApp",
    direct_deposit: "directDeposit",
    drug_test: "drugTest",
    nda: "nda",
    w9: "w9",
  };
  const isDocSubmitted = (docKey: string) => {
    const camelKey = docKeyToCamel[docKey];
    return !!completedDocs[camelKey];
  };
  const isDocDrafted = (docKey: string) => savedDrafts.includes(docKey);
  const isDocReady = (docKey: string) => isDocSubmitted(docKey) || isDocDrafted(docKey);
  const completedCount = DOCUMENTS.filter(d => isDocReady(d.key)).length;
  const progressPct = (completedCount / DOCUMENTS.length) * 100;

  if (step === 1) {
    return <OtpStep
      repId={repId}
      setRepId={setRepId}
      otp={otp}
      setOtp={setOtp}
      onVerify={() => verifyMutation.mutate()}
      isPending={verifyMutation.isPending}
      otpExpiry={otpExpiry}
    />;
  }

  if (step === 2 && currentDoc) {
    return <DocumentForm
      docKey={currentDoc}
      token={token!}
      onBack={() => setCurrentDoc(null)}
      onNext={() => {
        const idx = DOCUMENTS.findIndex(d => d.key === currentDoc);
        if (idx < DOCUMENTS.length - 1) {
          setCurrentDoc(DOCUMENTS[idx + 1].key);
        } else {
          setCurrentDoc(null);
        }
      }}
    />;
  }

  if (step === 2) {
    return (
      <div className="min-h-screen bg-[#1B2A4A] p-4 pt-8" data-testid="onboarding-documents">
        <div className="max-w-lg mx-auto">
          <div className="text-white mb-6">
            <p className="text-sm text-[#C9A84C] font-medium">{t("onboarding.steps.stepOf", { current: 2, total: 4 })}</p>
            <h1 className="text-xl font-bold mt-1">{t("onboarding.steps.completeDocs")}</h1>
            <p className="text-sm text-white/60 mt-1">
              {repInfo?.name ? t("onboarding.portal.welcome", { name: repInfo.name }) : t("onboarding.portal.loading")}
            </p>
          </div>

          <div className="mb-6">
            <div className="flex justify-between text-sm text-white/80 mb-2">
              <span>{t("onboarding.portal.completeCount", { count: completedCount })}</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <Progress value={progressPct} className="h-2 bg-white/20" />
          </div>

          {repInfoLoading ? (
            <div className="space-y-3">
              {[1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
            </div>
          ) : (
            <div className="space-y-3">
              {DOCUMENTS.map((doc) => {
                const done = isDocReady(doc.key);
                const submitted = isDocSubmitted(doc.key);
                const drafted = isDocDrafted(doc.key);
                return (
                  <button
                    key={doc.key}
                    onClick={() => setCurrentDoc(doc.key)}
                    className="w-full text-left"
                    data-testid={`doc-card-${doc.key}`}
                  >
                    <Card className="rounded-2xl border-0 shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-4 flex items-center gap-4">
                        {done ? (
                          <CheckCircle2 className="h-6 w-6 text-emerald-500 flex-shrink-0" />
                        ) : (
                          <Circle className="h-6 w-6 text-muted-foreground flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{t(`onboarding.docs.${doc.key}.name`)}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {submitted ? (
                              <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                {t("onboarding.portal.badges.complete")}
                              </Badge>
                            ) : drafted ? (
                              <Badge variant="secondary" className="text-[10px] bg-[#C9A84C]/20 text-[#C9A84C]">
                                {t("onboarding.portal.badges.signed")}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                {t("onboarding.portal.badges.incomplete")}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {doc.time}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      </CardContent>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}

          {completedCount === DOCUMENTS.length && (
            <Button
              className="w-full h-14 mt-6 rounded-2xl bg-[#C9A84C] hover:bg-[#b8973e] text-white text-base font-semibold"
              onClick={() => setStep(4)}
              data-testid="button-review-submit"
            >
              {t("onboarding.portal.reviewButton")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (step === 4) {
    return <ReviewStep token={token!} repInfo={repInfo} onBack={() => setStep(2)} />;
  }

  return null;
}

function OtpStep({ repId, setRepId, otp, setOtp, onVerify, isPending, otpExpiry }: {
  repId: string;
  setRepId: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  onVerify: () => void;
  isPending: boolean;
  otpExpiry: number | null;
}) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!otpExpiry) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((otpExpiry - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [otpExpiry]);

  return (
    <div className="min-h-screen bg-[#1B2A4A] flex flex-col items-center justify-center p-6" data-testid="onboarding-otp">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-[#C9A84C]/20 flex items-center justify-center mx-auto mb-4">
            <Shield className="h-8 w-8 text-[#C9A84C]" />
          </div>
          <h1 className="text-2xl font-bold text-white">{t("onboarding.otp.title")}</h1>
          <p className="text-white/60 mt-2 text-sm">{t("onboarding.steps.stepOf", { current: 1, total: 4 })} — {t("onboarding.steps.verifyIdentity")}</p>
        </div>

        <Card className="rounded-2xl border-0 shadow-lg">
          <CardContent className="p-6 space-y-5">
            <div>
              <Label className="text-sm font-medium">{t("onboarding.otp.repIdLabel")}</Label>
              <Input
                value={repId}
                onChange={(e) => setRepId(e.target.value)}
                placeholder={t("onboarding.otp.repIdPlaceholder")}
                className="mt-1.5 h-12 text-base rounded-lg"
                data-testid="input-rep-id"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">{t("onboarding.otp.otpLabel")}</Label>
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("onboarding.otp.otpPlaceholder")}
                inputMode="numeric"
                maxLength={6}
                className="mt-1.5 h-14 text-center text-2xl tracking-[0.5em] font-mono rounded-lg"
                data-testid="input-otp"
              />
              {countdown > 0 && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {t("onboarding.otp.expiresIn", { time: `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}` })}
                </p>
              )}
            </div>

            <Button
              className="w-full h-12 rounded-lg bg-[#C9A84C] hover:bg-[#b8973e] text-white text-base font-semibold"
              onClick={onVerify}
              disabled={isPending || !repId.trim() || otp.length !== 6}
              data-testid="button-verify-otp"
            >
              {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : t("onboarding.otp.verifyButton")}
            </Button>
          </CardContent>
        </Card>

        <div className="text-center mt-6">
          <a href="#" className="text-[#C9A84C] text-sm flex items-center justify-center gap-2" data-testid="link-contact-manager">
            <Phone className="h-4 w-4" />
            {t("onboarding.otp.contactManager")}
          </a>
        </div>
      </div>
    </div>
  );
}

function DocumentForm({ docKey, token, onBack, onNext }: {
  docKey: string;
  token: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const doc = DOCUMENTS.find(d => d.key === docKey)!;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const { data: draftData } = useQuery({
    queryKey: ["onboarding-draft", docKey],
    queryFn: async () => {
      const res = await fetch(`/api/onboarding/draft/${docKey}`, { headers });
      if (!res.ok) return null;
      return res.json();
    },
  });

  useEffect(() => {
    if (draftData?.draft) {
      setFormFields(draftData.draft);
      if (draftData.draft.signature) setHasSigned(true);
    }
  }, [draftData]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/onboarding/draft/${docKey}`, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(t("onboarding.form.saveFailed"));
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("onboarding.form.draftSaved") });
    },
  });

  const handleSignatureStart = (e: React.TouchEvent | React.MouseEvent) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleSignatureMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;
    ctx.strokeStyle = "#1B2A4A";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSigned(true);
  };

  const handleSignatureEnd = () => setIsDrawing(false);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const updateField = (key: string, value: string) => {
    setFormFields(prev => ({ ...prev, [key]: value }));
  };

  const getFieldsForDoc = () => {
    switch (docKey) {
      case "background_check":
        return [
          { key: "fullName", label: t("onboarding.docs.background_check.fullName"), type: "text" },
          { key: "dateOfBirth", label: t("onboarding.docs.background_check.dateOfBirth"), type: "date" },
          { key: "driversLicense", label: t("onboarding.docs.background_check.driversLicense"), type: "text" },
          { key: "consentGiven", label: t("onboarding.docs.background_check.consentGiven"), type: "checkbox" },
        ];
      case "chargeback_policy":
        return [
          { key: "acknowledged", label: t("onboarding.docs.chargeback_policy.acknowledged"), type: "checkbox" },
          { key: "initials", label: t("onboarding.docs.chargeback_policy.initials"), type: "text" },
        ];
      case "contractor_app":
        return [
          { key: "fullName", label: t("onboarding.docs.contractor_app.fullName"), type: "text" },
          { key: "address", label: t("onboarding.docs.contractor_app.address"), type: "text" },
          { key: "city", label: t("onboarding.docs.contractor_app.city"), type: "text" },
          { key: "state", label: t("onboarding.docs.contractor_app.state"), type: "text" },
          { key: "zip", label: t("onboarding.docs.contractor_app.zip"), type: "text" },
          { key: "phone", label: t("onboarding.docs.contractor_app.phone"), type: "tel" },
          { key: "email", label: t("onboarding.docs.contractor_app.email"), type: "email" },
          { key: "emergencyName", label: t("onboarding.docs.contractor_app.emergencyName"), type: "text" },
          { key: "emergencyPhone", label: t("onboarding.docs.contractor_app.emergencyPhone"), type: "tel" },
        ];
      case "direct_deposit":
        return [
          { key: "bankName", label: t("onboarding.docs.direct_deposit.bankName"), type: "text" },
          { key: "accountType", label: t("onboarding.docs.direct_deposit.accountType"), type: "text" },
          { key: "routingNumber", label: t("onboarding.docs.direct_deposit.routingNumber"), type: "text" },
          { key: "accountNumber", label: t("onboarding.docs.direct_deposit.accountNumber"), type: "text" },
          { key: "ssn", label: t("onboarding.docs.direct_deposit.ssn"), type: "text" },
        ];
      case "drug_test":
        return [
          { key: "consentGiven", label: t("onboarding.docs.drug_test.consentGiven"), type: "checkbox" },
          { key: "fullName", label: t("onboarding.docs.drug_test.fullName"), type: "text" },
        ];
      case "nda":
        return [
          { key: "acknowledged", label: t("onboarding.docs.nda.acknowledged"), type: "checkbox" },
          { key: "fullName", label: t("onboarding.docs.nda.fullName"), type: "text" },
        ];
      case "w9":
        return [
          { key: "fullName", label: t("onboarding.docs.w9.fullName"), type: "text" },
          { key: "businessName", label: t("onboarding.docs.w9.businessName"), type: "text" },
          { key: "address", label: t("onboarding.docs.w9.address"), type: "text" },
          { key: "cityStateZip", label: t("onboarding.docs.w9.cityStateZip"), type: "text" },
          { key: "ssn", label: t("onboarding.docs.w9.ssn"), type: "text" },
          { key: "certify", label: t("onboarding.docs.w9.certify"), type: "checkbox" },
        ];
      default:
        return [];
    }
  };

  const fields = getFieldsForDoc();

  return (
    <div className="min-h-screen bg-background p-4 pt-6" data-testid={`doc-form-${docKey}`}>
      <div className="max-w-lg mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4" data-testid="button-back-docs">
          <ChevronLeft className="h-4 w-4" /> {t("onboarding.form.backToDocs")}
        </button>

        <div className="mb-6">
          <h1 className="text-lg font-bold">{t(`onboarding.docs.${docKey}.name`)}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("onboarding.form.instructions")}</p>
        </div>

        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.key}>
              {field.type === "checkbox" ? (
                <label className="flex items-start gap-3 cursor-pointer" data-testid={`field-${field.key}`}>
                  <input
                    type="checkbox"
                    checked={formFields[field.key] === "true"}
                    onChange={(e) => updateField(field.key, String(e.target.checked))}
                    className="mt-1 h-5 w-5 rounded accent-[#C9A84C]"
                  />
                  <span className="text-sm">{field.label}</span>
                </label>
              ) : (
                <div>
                  <Label className="text-sm">{field.label}</Label>
                  <Input
                    type={field.type}
                    value={formFields[field.key] || ""}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    className="mt-1 h-12 rounded-lg"
                    data-testid={`input-${field.key}`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">{t("onboarding.form.signature")}</Label>
            {hasSigned && (
              <button onClick={clearSignature} className="text-xs text-[#C9A84C]" data-testid="button-clear-signature">
                {t("onboarding.form.clear")}
              </button>
            )}
          </div>
          <div className="border-2 border-dashed rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
            <canvas
              ref={canvasRef}
              width={340}
              height={150}
              className="w-full touch-none cursor-crosshair"
              onMouseDown={handleSignatureStart}
              onMouseMove={handleSignatureMove}
              onMouseUp={handleSignatureEnd}
              onMouseLeave={handleSignatureEnd}
              onTouchStart={handleSignatureStart}
              onTouchMove={handleSignatureMove}
              onTouchEnd={handleSignatureEnd}
              data-testid="signature-canvas"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1 text-center">
            {t("onboarding.form.drawSignature")}
          </p>
        </div>

        <div className="flex gap-3 mt-6 pb-8">
          <Button
            variant="outline"
            className="flex-1 h-12 rounded-lg"
            onClick={() => saveMutation.mutate(formFields)}
            disabled={saveMutation.isPending}
            data-testid="button-save-draft"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("onboarding.form.saveDraft")}
          </Button>
          <Button
            className="flex-1 h-12 rounded-lg bg-[#C9A84C] hover:bg-[#b8973e] text-white"
            onClick={() => {
              const signatureData = canvasRef.current?.toDataURL();
              saveMutation.mutate({ ...formFields, signature: signatureData, completed: "true" });
              onNext();
            }}
            disabled={!hasSigned}
            data-testid="button-next-document"
          >
            {t("onboarding.form.nextDoc")} <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewStep({ token, repInfo, onBack }: {
  token: string;
  repInfo: any;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const docTypeToSigKey: Record<string, string> = {
        background_check: "backgroundCheckSignature",
        chargeback_policy: "chargebackPolicySignature",
        contractor_app: "contractorAppSignature",
        direct_deposit: "directDepositSignature",
        drug_test: "drugTestSignature",
        nda: "ndaSignature",
        w9: "w9Signature",
      };
      const signatures: Record<string, string> = {};
      let directDepositFields: Record<string, string> = {};
      let w9Fields: Record<string, string> = {};
      for (const doc of DOCUMENTS) {
        try {
          const draftRes = await fetch(`/api/onboarding/draft/${doc.key}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (draftRes.ok) {
            const draftData = await draftRes.json();
            if (draftData.draft?.signature) {
              signatures[docTypeToSigKey[doc.key]] = draftData.draft.signature;
            }
            if (doc.key === "direct_deposit" && draftData.draft) {
              directDepositFields = {
                bankName: draftData.draft.bankName || "",
                accountType: draftData.draft.accountType || "",
                routingNumber: draftData.draft.routingNumber || "",
                accountNumber: draftData.draft.accountNumber || "",
              };
            }
            if (doc.key === "w9" && draftData.draft) {
              w9Fields = {
                w9FullName: draftData.draft.fullName || "",
                w9BusinessName: draftData.draft.businessName || "",
                w9Address: draftData.draft.address || "",
                w9CityStateZip: draftData.draft.cityStateZip || "",
              };
            }
          }
        } catch {}
      }

      const formDataObj = new FormData();
      const data = {
        repName: repInfo?.name || "",
        repEmail: repInfo?.email || "",
        repPhone: repInfo?.phone || "",
        ...signatures,
        ...directDepositFields,
        ...w9Fields,
      };
      formDataObj.append("data", JSON.stringify(data));

      const res = await fetch("/api/onboarding/submit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formDataObj,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || t("onboarding.review.submitFailed"));
      }

      setSubmitted(true);
      toast({ title: t("onboarding.review.successTitle") });
    } catch (err: any) {
      toast({ title: t("onboarding.review.errorTitle"), description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#1B2A4A] flex flex-col items-center justify-center p-6" data-testid="onboarding-complete">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
          <Check className="h-8 w-8 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-white">{t("onboarding.review.successTitle")}</h1>
        <p className="text-white/60 text-center mt-2 max-w-xs">
          {t("onboarding.review.successDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1B2A4A] p-4 pt-8" data-testid="onboarding-review">
      <div className="max-w-lg mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-white/60 mb-4" data-testid="button-back-review">
          <ChevronLeft className="h-4 w-4" /> {t("onboarding.form.backToDocs")}
        </button>

        <div className="text-white mb-6">
          <p className="text-sm text-[#C9A84C] font-medium">{t("onboarding.steps.stepOf", { current: 4, total: 4 })}</p>
          <h1 className="text-xl font-bold mt-1">{t("onboarding.review.title")}</h1>
        </div>

        <div className="space-y-3">
          {DOCUMENTS.map((doc) => (
            <Card key={doc.key} className="rounded-2xl border-0">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{t(`onboarding.docs.${doc.key}.name`)}</p>
                  <p className="text-xs text-muted-foreground">{t("onboarding.review.completedOn", { date: formatDate(new Date()) })}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button
          className="w-full h-14 mt-6 rounded-2xl bg-[#C9A84C] hover:bg-[#b8973e] text-white text-base font-semibold"
          onClick={handleSubmit}
          disabled={submitting}
          data-testid="button-final-submit"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : t("onboarding.review.submitButton")}
        </Button>

        <p className="text-xs text-white/40 text-center mt-4">
          {t("onboarding.review.eSignDisclosure")}
        </p>
      </div>
    </div>
  );
}
