import PDFDocument from "pdfkit";
import { PayStatement, PayStatementLineItem, PayStatementDeduction, User } from "@shared/schema";

interface PayStatementPdfData {
  statement: PayStatement;
  lineItems: PayStatementLineItem[];
  deductions: PayStatementDeduction[];
  user: User;
  companyName?: string;
}

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function generatePayStatementPdf(data: PayStatementPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const { statement, lineItems, deductions, user, companyName = "Iron Crest CRM" } = data;

      doc.fontSize(24).font("Helvetica-Bold").text(companyName, { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(16).font("Helvetica").text("PAY STATEMENT", { align: "center" });
      doc.moveDown(1);

      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(1);

      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Employee Information", 50);
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text(`Name: ${user.name}`, 50);
      doc.text(`Rep ID: ${user.repId}`, 50);
      doc.text(`Role: ${user.role}`, 50);

      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Pay Period", 350, doc.y - 42);
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10);
      doc.text(`From: ${formatDate(statement.periodStart)}`, 350);
      doc.text(`To: ${formatDate(statement.periodEnd)}`, 350);
      if (statement.paidAt) {
        doc.text(`Paid: ${formatDate(statement.paidAt)}`, 350);
      }
      doc.text(`Status: ${statement.status}`, 350);

      doc.moveDown(2);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(1);

      doc.fontSize(12).font("Helvetica-Bold").text("EARNINGS", 50);
      doc.moveDown(0.5);

      doc.fontSize(10).font("Helvetica");

      const earningsItems = [
        { label: "Base Commission", amount: statement.grossCommission },
        { label: "Override Earnings", amount: statement.overrideEarningsTotal },
        { label: "Incentives", amount: statement.incentivesTotal },
        { label: "Adjustments", amount: statement.adjustmentsTotal },
      ];

      earningsItems.forEach((item) => {
        doc.text(item.label, 60);
        doc.text(formatCurrency(item.amount), 450, doc.y - 12, { width: 100, align: "right" });
      });

      if (parseFloat(statement.chargebacksTotal) !== 0) {
        doc.text("Chargebacks", 60);
        doc.fillColor("red").text(`-${formatCurrency(statement.chargebacksTotal)}`, 450, doc.y - 12, { width: 100, align: "right" });
        doc.fillColor("black");
      }

      doc.moveDown(1);

      const commissionItems = lineItems.filter(li => li.category === "COMMISSION");
      const chargebackLineItems = lineItems.filter(li => li.category === "CHARGEBACK");
      const hasPerOrderNet = commissionItems.some(li => li.netAmount !== null);

      if (commissionItems.length > 0) {
        doc.fontSize(11).font("Helvetica-Bold").text("Commission Details", 50);
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica-Bold");
        if (hasPerOrderNet) {
          doc.text("Description", 60);
          doc.text("Gross", 320, doc.y - 9, { width: 70, align: "right" });
          doc.text("Reserve", 390, doc.y - 9, { width: 70, align: "right" });
          doc.text("Net", 460, doc.y - 9, { width: 90, align: "right" });
        } else {
          doc.text("Description", 60);
          doc.text("Amount", 450, doc.y - 9, { width: 100, align: "right" });
        }
        doc.moveDown(0.3);
        doc.moveTo(60, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.3);

        doc.font("Helvetica").fontSize(9);
        commissionItems.slice(0, 20).forEach((item) => {
          if (doc.y > 680) doc.addPage();
          const desc = item.description.substring(0, 40);
          if (hasPerOrderNet) {
            const withheld = item.reserveWithheldForOrder ? parseFloat(item.reserveWithheldForOrder) : 0;
            const net = item.netAmount ? parseFloat(item.netAmount) : parseFloat(item.amount);
            doc.text(desc, 60);
            doc.text(formatCurrency(item.amount), 320, doc.y - 9, { width: 70, align: "right" });
            doc.text(withheld > 0 ? `-${formatCurrency(withheld)}` : "—", 390, doc.y - 9, { width: 70, align: "right" });
            doc.text(formatCurrency(net), 460, doc.y - 9, { width: 90, align: "right" });
          } else {
            doc.text(desc, 60);
            doc.text(formatCurrency(item.amount), 450, doc.y - 9, { width: 100, align: "right" });
          }
        });
        doc.moveDown(1);
      }

      if (chargebackLineItems.length > 0) {
        if (doc.y > 650) doc.addPage();
        doc.fontSize(11).font("Helvetica-Bold").text("Chargebacks", 50);
        doc.moveDown(0.5);

        doc.fontSize(9).font("Helvetica-Bold");
        doc.text("Description", 60);
        doc.text("Source", 300, doc.y - 9, { width: 120 });
        doc.text("Amount", 450, doc.y - 9, { width: 100, align: "right" });
        doc.moveDown(0.3);
        doc.moveTo(60, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.3);

        doc.font("Helvetica").fontSize(9);
        chargebackLineItems.forEach((item) => {
          if (doc.y > 680) doc.addPage();
          const desc = (item.invoiceNumber ? `Chargeback — ${item.invoiceNumber}` : item.description).substring(0, 35);
          let sourceLabel = "Net Pay";
          if (item.chargebackSource === "FROM_RESERVE") {
            sourceLabel = "From Reserve";
          } else if (item.chargebackSource === "FROM_NET_PAY") {
            sourceLabel = "From Net Pay";
          } else if (item.chargebackSource === "SPLIT") {
            const fromRes = (item.chargebackFromReserveCents || 0) / 100;
            const fromNet = (item.chargebackFromNetPayCents || 0) / 100;
            sourceLabel = `Res: ${formatCurrency(fromRes)} / Net: ${formatCurrency(fromNet)}`;
          }

          doc.fillColor("red");
          doc.text(desc, 60);
          doc.fillColor("black");
          doc.text(sourceLabel, 300, doc.y - 9, { width: 120 });
          doc.fillColor("red").text(formatCurrency(item.amount), 450, doc.y - 9, { width: 100, align: "right" });
          doc.fillColor("black");
        });
        doc.moveDown(1);
      }

      doc.fontSize(12).font("Helvetica-Bold").text("DEDUCTIONS", 50);
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica");

      if (deductions.length > 0) {
        deductions.forEach((ded) => {
          doc.text(ded.deductionTypeName, 60);
          doc.fillColor("red").text(`-${formatCurrency(ded.amount)}`, 450, doc.y - 12, { width: 100, align: "right" });
          doc.fillColor("black");
        });
      }

      if (parseFloat(statement.advancesApplied) !== 0) {
        doc.text("Advances Repayment", 60);
        doc.fillColor("red").text(`-${formatCurrency(statement.advancesApplied)}`, 450, doc.y - 12, { width: 100, align: "right" });
        doc.fillColor("black");
      }

      doc.text("Tax Withheld", 60);
      doc.fillColor("gray").text("N/A — 1099 Contractor", 450, doc.y - 12, { width: 100, align: "right" });
      doc.fillColor("black");

      if (statement.reserveWithheldTotal && parseFloat(statement.reserveWithheldTotal) > 0) {
        doc.text("Reserve Withheld", 60);
        doc.fillColor("red").text(`-${formatCurrency(statement.reserveWithheldTotal)}`, 450, doc.y - 12, { width: 100, align: "right" });
        doc.fillColor("black");
      }

      doc.text("Total Deductions", 60);
      doc.fillColor("red").text(`-${formatCurrency(statement.deductionsTotal)}`, 450, doc.y - 12, { width: 100, align: "right" });
      doc.fillColor("black");

      doc.moveDown(2);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(1);

      doc.fontSize(14).font("Helvetica-Bold");
      doc.text("NET PAY", 60);
      doc.text(formatCurrency(statement.netPay), 400, doc.y - 17, { width: 150, align: "right" });

      const hasReserveData = (statement.reserveWithheldTotal && parseFloat(statement.reserveWithheldTotal) > 0) ||
        (statement.reservePreviousBalance && parseFloat(statement.reservePreviousBalance) > 0) ||
        (statement.reserveChargebacksOffset && parseFloat(statement.reserveChargebacksOffset) > 0);

      if (hasReserveData) {
        doc.moveDown(1.5);
        doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
        doc.moveDown(0.5);

        doc.fontSize(12).font("Helvetica-Bold").text("ROLLING RESERVE STATUS", 50);
        doc.moveDown(0.5);
        doc.font("Helvetica").fontSize(10);

        const previousBalance = statement.reservePreviousBalance ? parseFloat(statement.reservePreviousBalance) : null;
        const withheldThisPeriod = parseFloat(statement.reserveWithheldTotal || "0");
        const chargebacksOffset = statement.reserveChargebacksOffset ? parseFloat(statement.reserveChargebacksOffset) : 0;
        const currentBalance = statement.reserveBalanceAfter ? parseFloat(statement.reserveBalanceAfter) : null;
        const cap = statement.reserveCapAmount ? parseFloat(statement.reserveCapAmount) : 2500;
        const statusLabel = statement.reserveStatusLabel || "ACTIVE";

        if (previousBalance !== null) {
          doc.text(`Previous Balance:       ${formatCurrency(previousBalance)}`, 60);
        }
        if (withheldThisPeriod > 0) {
          doc.text(`Withheld This Period:   +${formatCurrency(withheldThisPeriod)}`, 60);
        }
        if (chargebacksOffset > 0) {
          doc.text(`Chargebacks Offset:     -${formatCurrency(chargebacksOffset)}`, 60);
        }
        if (currentBalance !== null) {
          doc.moveDown(0.3);
          doc.font("Helvetica-Bold");
          doc.text(`Current Balance:        ${formatCurrency(currentBalance)} / ${formatCurrency(cap)} cap`, 60);
          doc.font("Helvetica");
          doc.text(`Status:                 ${statusLabel}`, 60);
        }

        doc.moveDown(0.5);
        doc.fontSize(7).fillColor("gray");
        doc.text("Note: The rolling reserve is not wages. It is a conditional holdback per your Independent Contractor Agreement.", 60, doc.y, { width: 490 });
        doc.fillColor("black");
      }

      doc.moveDown(2);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(1);

      doc.fontSize(12).font("Helvetica-Bold").text("YEAR-TO-DATE SUMMARY", 50);
      doc.moveDown(0.5);
      doc.fontSize(10).font("Helvetica");

      const ytdItems = [
        { label: "YTD Gross Earnings", amount: statement.ytdGross },
        { label: "YTD Deductions", amount: statement.ytdDeductions, isNegative: true },
        { label: "YTD Net Pay", amount: statement.ytdNetPay, isBold: true },
      ];

      ytdItems.forEach((item) => {
        if (item.isBold) doc.font("Helvetica-Bold");
        doc.text(item.label, 60);
        if (item.isNegative) {
          doc.fillColor("red").text(`-${formatCurrency(item.amount)}`, 450, doc.y - 12, { width: 100, align: "right" });
          doc.fillColor("black");
        } else {
          doc.text(formatCurrency(item.amount), 450, doc.y - 12, { width: 100, align: "right" });
        }
        doc.font("Helvetica");
      });

      doc.moveDown(3);
      doc.fontSize(8).fillColor("gray");
      doc.text(`Generated on ${new Date().toLocaleString()} | Statement ID: ${statement.id}`, 50, doc.y, { align: "center" });
      doc.text("This is an official pay statement. Please retain for your records.", { align: "center" });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
