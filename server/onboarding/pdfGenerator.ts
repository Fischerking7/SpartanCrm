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
  { type: "chargeback_policy", title: "CHARGEBACK ACCOUNTABILITY POLICY" },
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
      return `I, ${name}, acknowledge and agree to Iron Crest Solutions LLC's Chargeback Accountability Policy.\n\nI understand that:\n1. Chargebacks resulting from fraudulent, misleading, or non-compliant sales may be deducted from my future commissions.\n2. I will be notified of any chargeback and given 10 business days to dispute.\n3. Disputed chargebacks will be reviewed by management.\n4. Repeated chargebacks may result in performance review or termination.\n\nGoverning Law: State of New Jersey`;
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
