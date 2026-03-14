import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "../db";
import { onboardingSubmissions, onboardingAuditLog } from "@shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

interface PdfResult {
  documentType: string;
  buffer: Buffer;
  filename: string;
}

const DOCS = [
  { type: "background_check", title: "BACKGROUND CHECK AUTHORIZATION" },
  { type: "chargeback_policy", title: "Chargebacks & Rolling Reserve Policy" },
  { type: "contractor_app", title: "INDEPENDENT CONTRACTOR APPLICATION" },
  { type: "direct_deposit", title: "DIRECT DEPOSIT AUTHORIZATION" },
  { type: "drug_test", title: "DRUG TEST CONSENT FORM" },
  { type: "nda", title: "NON-DISCLOSURE AGREEMENT" },
] as const;

function getDocumentBody(docType: string, sub: any): string {
  const name = sub.repName;
  const ssnMasked = sub.ssnLast4 ? `***-**-${sub.ssnLast4}` : "***-**-****";
  const bankMasked = sub.accountNumberLast4 ? `****${sub.accountNumberLast4}` : "****";
  const dateStr = new Date(sub.submittedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  switch (docType) {
    case "background_check":
      return `I, ${name}, hereby authorize Iron Crest Solutions LLC and its designated agents to conduct a consumer background investigation including criminal history, employment verification, and other lawful checks.\n\nSocial Security Number: ${ssnMasked} (on file)\n\nI understand this authorization complies with the Fair Credit Reporting Act (FCRA).\n\nGoverning Law: State of New Jersey`;
    case "chargeback_policy":
      return `Section 1 — Rolling Reserve Requirement\n\nIron Crest Solutions LLC ("Iron Crest" or "Company") maintains a rolling reserve account for each independent sales representative ("Sales Rep") to offset potential vendor chargebacks, cancellations, non-pay disconnects, and commission reversals. Iron Crest will withhold fifteen percent (15%) of all commissions otherwise payable to the Sales Rep until the rolling reserve balance reaches two thousand five hundred dollars ($2,500). Once the reserve reaches $2,500, the 15% withholding will cease, subject to this Policy. Sales Reps acknowledge the rolling reserve is not wages and is a conditional holdback against future liabilities.\n\nSection 2 — Chargebacks\n\nAny vendor chargebacks, cancellations, non-pay disconnects, clawbacks, or commission reversals attributable to a Sales Rep's accounts shall be deducted directly from the rolling reserve. Commissions are not fully earned or vested until the applicable vendor chargeback maturity periods have expired.\n\nSection 3 — Replenishment of Rolling Reserve\n\nIf chargebacks reduce the rolling reserve below $2,500, Iron Crest will resume withholding fifteen percent (15%) of commissions until the reserve is restored. Iron Crest has no obligation to advance commissions during a reserve deficit.\n\nSection 4 — Adjustment of Rolling Reserve for Excessive Chargebacks\n\nIf a Sales Rep generates chargebacks exceeding the standard $2,500 reserve, Iron Crest may, in its sole and reasonable discretion, increase the reserve cap, increase the withholding percentage, or impose other risk controls. Continued participation after notice constitutes acceptance.\n\nSection 5 — Vendor Chargeback Maturity Periods\n\nOptimum: Voluntary Cancellation – 120 days; Non-Pay Disconnect – 180 days.\nAstound: Voluntary Cancellation – 120 days; Non-Pay Disconnect – 120 days.\n\nSection 6 — Company-Issued Equipment (iPad)\n\nIf a Sales Rep is issued an iPad or other electronic device for business use, such equipment remains the sole property of Iron Crest Solutions LLC at all times. In the event the Sales Rep voluntarily or involuntarily separates from the Company, and the issued iPad is not returned or is returned damaged beyond normal wear and tear, the full replacement cost of the device ($500) shall be treated as a recoverable charge. This amount will be deducted from the Sales Rep's remaining rolling reserve balance in the same manner as vendor chargebacks or other recoverable losses. If the rolling reserve is insufficient, Iron Crest reserves the right to set off the remaining balance against future commissions or other amounts payable, where legally permissible.\n\nSection 7 — Termination or Resignation\n\nUpon resignation or termination for any reason, Iron Crest will retain the rolling reserve through the full applicable chargeback maturity period(s). If no chargebacks occur, remaining reserve funds will be released after maturity. No early release is required.\n\nSection 8 — Setoff Rights\n\nSales Reps authorize Iron Crest to set off any chargebacks, refunds, reversals, penalties, or equipment recovery costs against the rolling reserve, future commissions, or other amounts payable.\n\nSection 9 — Governing Law and Venue\n\nThis Policy shall be governed by and construed in accordance with the laws of the State of New Jersey, without regard to conflict-of-law principles.\n\nSection 10 — Acknowledgment of Risk and Authority\n\nSales Reps acknowledge commission-based sales involve risk and delayed reversals, and that acceptance of this Policy is a condition of participation. Iron Crest retains final authority regarding reserve administration and chargeback determinations.`;
    case "contractor_app":
      return `INDEPENDENT CONTRACTOR APPLICATION\n\nApplicant: ${name}\nEmail: ${sub.repEmail || "N/A"}\nPhone: ${sub.repPhone || "N/A"}\n\nI certify that all information provided in this application is true and complete. I understand that I am applying for a position as an independent contractor (1099) with Iron Crest Solutions LLC, not as an employee.\n\nI acknowledge that as an independent contractor I am responsible for my own taxes, insurance, and business expenses.\n\nGoverning Law: State of New Jersey`;
    case "direct_deposit":
      return `DIRECT DEPOSIT AUTHORIZATION\n\nI, ${name}, hereby authorize Iron Crest Solutions LLC to initiate direct deposit payments to the following account:\n\nBank: ${sub.bankName || "N/A"}\nAccount Type: ${sub.accountType || "N/A"}\nAccount Number: ${bankMasked}\n\nThis authorization remains in effect until I provide written notice of cancellation.\n\nGoverning Law: State of New Jersey`;
    case "drug_test":
      return `DRUG TEST CONSENT FORM\n\nI, ${name}, hereby consent to submit to drug and/or alcohol testing as required by Iron Crest Solutions LLC.\n\nI understand that:\n1. Testing may be required as a condition of engagement.\n2. A positive result or refusal to test may result in denial of engagement or termination.\n3. Results will be kept confidential.\n\nGoverning Law: State of New Jersey`;
    case "nda":
      return `NON-DISCLOSURE AGREEMENT\n\nI, ${name}, agree not to disclose any confidential or proprietary information of Iron Crest Solutions LLC including but not limited to: customer lists, pricing strategies, sales processes, commission structures, internal tools, and business plans.\n\nThis obligation survives termination of the contractor relationship for a period of 2 years.\n\nViolation of this agreement may result in legal action for damages.\n\nGoverning Law: State of New Jersey`;
    default:
      return "";
  }
}

async function generateSinglePdf(docType: string, title: string, sub: any): Promise<PdfResult> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();
  let y = height - 50;

  page.drawText("IRON CREST SOLUTIONS LLC", { x: 50, y, font: boldFont, size: 14, color: rgb(0.1, 0.1, 0.4) });
  y -= 30;
  page.drawText(title, { x: 50, y, font: boldFont, size: 12 });
  y -= 25;

  const body = getDocumentBody(docType, sub);
  const lines = body.split("\n");
  for (const line of lines) {
    if (y < 100) {
      const newPage = doc.addPage([612, 792]);
      y = newPage.getSize().height - 50;
    }
    const words = line.split(" ");
    let currentLine = "";
    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(test, 10) > width - 100) {
        page.drawText(currentLine, { x: 50, y, font, size: 10 });
        y -= 14;
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) {
      page.drawText(currentLine, { x: 50, y, font, size: 10 });
      y -= 14;
    }
    y -= 4;
  }

  y -= 20;
  const dateStr = new Date(sub.submittedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const timeStr = new Date(sub.submittedAt).toLocaleTimeString("en-US");

  page.drawText("ELECTRONIC SIGNATURE", { x: 50, y, font: boldFont, size: 10 });
  y -= 16;
  page.drawText(`Signed by: ${sub.repName}`, { x: 50, y, font, size: 10 });
  y -= 14;
  page.drawText(`Date: ${dateStr} at ${timeStr}`, { x: 50, y, font, size: 10 });
  y -= 14;
  page.drawText(`IP Address: ${sub.ipAddress}`, { x: 50, y, font, size: 10 });
  y -= 14;
  page.drawText(`Document Hash: ${crypto.createHash("sha256").update(`${sub.id}:${docType}`).digest("hex").substring(0, 16)}`, { x: 50, y, font, size: 10 });
  y -= 20;

  page.drawText("This document was electronically signed in compliance with E-SIGN Act and UETA.", { x: 50, y, font, size: 8, color: rgb(0.4, 0.4, 0.4) });

  const pdfBytes = await doc.save();
  return {
    documentType: docType,
    buffer: Buffer.from(pdfBytes),
    filename: `${sub.repName.replace(/\s+/g, "_")}_${title.replace(/\s+/g, "_")}_${dateStr.replace(/\s+/g, "_")}.pdf`,
  };
}

export async function generateOnboardingPdfs(
  submissionId: string
): Promise<{ pdfs: PdfResult[]; error?: string }> {
  try {
    const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, submissionId));
    if (!sub) return { pdfs: [], error: "Submission not found" };

    const pdfs: PdfResult[] = [];

    for (const d of DOCS) {
      const completedField = `${d.type.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Completed` as keyof typeof sub;
      if (sub[completedField]) {
        const pdf = await generateSinglePdf(d.type, d.title, sub);
        pdfs.push(pdf);
      }
    }

    await db.insert(onboardingAuditLog).values({
      userId: sub.userId,
      action: "PDF_GENERATED",
      detail: JSON.stringify({ submissionId, documentCount: pdfs.length }),
    });

    return { pdfs };
  } catch (err: any) {
    console.error("[Onboarding] PDF generation failed:", err.message);
    return { pdfs: [], error: err.message };
  }
}
