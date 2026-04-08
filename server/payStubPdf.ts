import PDFDocument from "pdfkit";
import { storage } from "./storage";
import type { PayStatement, PayStatementLineItem } from "@shared/schema";
import { db } from "./db";
import { rollingReserves } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function generatePayStubPdf(payStatementId: string): Promise<Buffer> {
  const statement = await storage.getPayStatementById(payStatementId);
  if (!statement) throw new Error(`Pay statement ${payStatementId} not found`);

  const lineItems = await storage.getPayStatementLineItems(payStatementId);
  const deductions = await storage.getPayStatementDeductions(payStatementId);

  let reserveData: { capCents: number; withholdingPercent: string; status: string } | null = null;
  if (statement.reserveWithheldTotal && parseFloat(statement.reserveWithheldTotal) > 0) {
    const [reserve] = await db.select().from(rollingReserves).where(eq(rollingReserves.userId, statement.userId));
    if (reserve) {
      reserveData = { capCents: reserve.capCents, withholdingPercent: reserve.withholdingPercent, status: reserve.status };
    }
  }

  return buildPdf(statement, lineItems, deductions, reserveData);
}

function buildPdf(
  stmt: PayStatement,
  lineItems: any[],
  deductions: any[],
  reserveData: { capCents: number; withholdingPercent: string; status: string } | null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(stmt.companyName || "Iron Crest", { align: "center" });
    doc.fontSize(10).text("Pay Statement", { align: "center" });
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);

    const col1 = 50;
    const col2 = 300;
    const labelWidth = 120;

    doc.fontSize(9);
    const infoY = doc.y;
    doc.text("Stub Number:", col1, infoY, { width: labelWidth });
    doc.text(stmt.stubNumber || "N/A", col1 + labelWidth, infoY);

    doc.text("Employee:", col2, infoY, { width: labelWidth });
    doc.text(stmt.repName || "N/A", col2 + labelWidth, infoY);

    doc.moveDown(0.3);
    const row2Y = doc.y;
    doc.text("Role:", col1, row2Y, { width: labelWidth });
    doc.text(stmt.repRole || "N/A", col1 + labelWidth, row2Y);

    doc.text("Email:", col2, row2Y, { width: labelWidth });
    doc.text(stmt.repEmail || "N/A", col2 + labelWidth, row2Y);

    doc.moveDown(0.3);
    const row3Y = doc.y;
    doc.text("Period:", col1, row3Y, { width: labelWidth });
    doc.text(`${stmt.periodStart} to ${stmt.periodEnd}`, col1 + labelWidth, row3Y);

    doc.text("Status:", col2, row3Y, { width: labelWidth });
    doc.text(stmt.status, col2 + labelWidth, row3Y);

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(11).text("Earnings", col1);
    doc.moveDown(0.3);

    doc.fontSize(8);
    const hasReserveWithholding = lineItems.some((li: any) => li.netAmount != null);
    const tableHeaders = hasReserveWithholding
      ? ["Description", "Type", "Gross", "Reserve", "Net"]
      : ["Description", "Type", "Amount"];
    const colWidths = hasReserveWithholding
      ? [200, 90, 80, 70, 70]
      : [250, 120, 100];
    const startX = 50;
    let currentY = doc.y;

    tableHeaders.forEach((header, i) => {
      let x = startX;
      for (let j = 0; j < i; j++) x += colWidths[j];
      doc.text(header, x, currentY, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
    });

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.2);

    const commissionItems = lineItems.filter((li: any) => li.category === "COMMISSION");
    const overrideItems = lineItems.filter((li: any) => li.category === "OVERRIDE");
    const bonusItems = lineItems.filter((li: any) => li.category === "BONUS");
    const chargebackItems = lineItems.filter((li: any) => li.category === "CHARGEBACK");

    const checkPage = () => {
      if (doc.y > 680) {
        doc.addPage();
      }
    };

    const drawCommissionItem = (item: any) => {
      checkPage();
      currentY = doc.y;
      const desc = item.customerName
        ? `${item.invoiceNumber || ""} - ${item.customerName}`
        : item.description;

      if (hasReserveWithholding) {
        doc.text(desc, startX, currentY, { width: colWidths[0] });
        doc.text("Commission", startX + colWidths[0], currentY, { width: colWidths[1] });
        doc.text(`$${parseFloat(item.amount).toFixed(2)}`, startX + colWidths[0] + colWidths[1], currentY, { width: colWidths[2], align: "right" });
        const withheld = item.reserveWithheldForOrder ? parseFloat(item.reserveWithheldForOrder) : 0;
        doc.text(withheld > 0 ? `-$${withheld.toFixed(2)}` : "—", startX + colWidths[0] + colWidths[1] + colWidths[2], currentY, { width: colWidths[3], align: "right" });
        const net = item.netAmount ? parseFloat(item.netAmount) : parseFloat(item.amount);
        doc.text(`$${net.toFixed(2)}`, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY, { width: colWidths[4], align: "right" });
      } else {
        doc.text(desc, startX, currentY, { width: colWidths[0] });
        doc.text("Commission", startX + colWidths[0], currentY, { width: colWidths[1] });
        doc.text(`$${parseFloat(item.amount).toFixed(2)}`, startX + colWidths[0] + colWidths[1], currentY, { width: colWidths[2], align: "right" });
      }
      doc.moveDown(0.3);
    };

    const drawSimpleItem = (description: string, type: string, amount: string) => {
      checkPage();
      currentY = doc.y;
      if (hasReserveWithholding) {
        doc.text(description, startX, currentY, { width: colWidths[0] });
        doc.text(type, startX + colWidths[0], currentY, { width: colWidths[1] });
        doc.text("", startX + colWidths[0] + colWidths[1], currentY, { width: colWidths[2] });
        doc.text("", startX + colWidths[0] + colWidths[1] + colWidths[2], currentY, { width: colWidths[3] });
        doc.text(`$${parseFloat(amount).toFixed(2)}`, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY, { width: colWidths[4], align: "right" });
      } else {
        doc.text(description, startX, currentY, { width: colWidths[0] });
        doc.text(type, startX + colWidths[0], currentY, { width: colWidths[1] });
        doc.text(`$${parseFloat(amount).toFixed(2)}`, startX + colWidths[0] + colWidths[1], currentY, { width: colWidths[2], align: "right" });
      }
      doc.moveDown(0.3);
    };

    for (const item of commissionItems) {
      drawCommissionItem(item);
    }

    for (const item of overrideItems) {
      drawSimpleItem(item.description, "Override", item.amount);
    }

    for (const item of bonusItems) {
      drawSimpleItem(item.description, "Bonus", item.amount);
    }

    if (chargebackItems.length > 0) {
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(0.3);
      doc.fontSize(11).text("Chargebacks", col1);
      doc.moveDown(0.3);
      doc.fontSize(8);

      for (const item of chargebackItems) {
        checkPage();
        currentY = doc.y;
        const absAmount = Math.abs(parseFloat(item.amount));
        let sourceLabel = "";
        if (item.chargebackSource === "FROM_RESERVE") {
          sourceLabel = "From Reserve";
        } else if (item.chargebackSource === "FROM_NET_PAY") {
          sourceLabel = "From Net Pay";
        } else if (item.chargebackSource === "SPLIT") {
          const fromRes = (item.chargebackFromReserveCents || 0) / 100;
          const fromNet = (item.chargebackFromNetPayCents || 0) / 100;
          sourceLabel = `Reserve: $${fromRes.toFixed(2)} / Net Pay: $${fromNet.toFixed(2)}`;
        }

        const cbDesc = item.invoiceNumber ? `Chargeback — ${item.invoiceNumber}` : (item.description || "Chargeback");
        doc.fillColor("red");
        doc.text(cbDesc, startX, currentY, { width: 250 });
        doc.text(sourceLabel, startX + 250, currentY, { width: 170 });
        doc.text(`-$${absAmount.toFixed(2)}`, startX + 420, currentY, { width: 92, align: "right" });
        doc.fillColor("black");
        doc.moveDown(0.3);
      }
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(11).text("Summary", col1);
    doc.moveDown(0.3);

    doc.fontSize(9);
    const summaryCol = 350;
    const valCol = 462;

    const summaryLine = (label: string, value: string, bold = false) => {
      checkPage();
      currentY = doc.y;
      if (bold) doc.font("Helvetica-Bold");
      doc.text(label, summaryCol, currentY);
      doc.text(`$${parseFloat(value).toFixed(2)}`, valCol, currentY, { width: 100, align: "right" });
      if (bold) doc.font("Helvetica");
      doc.moveDown(0.3);
    };

    summaryLine("Gross Commission:", stmt.grossCommission);
    summaryLine("Override Earnings:", stmt.overrideEarningsTotal);
    summaryLine("Bonuses:", stmt.bonusesTotal || "0");
    summaryLine("Chargebacks:", `-${stmt.chargebacksTotal}`);
    summaryLine("Deductions:", `-${stmt.deductionsTotal}`);
    summaryLine("Advances Applied:", `-${stmt.advancesApplied}`);

    checkPage();
    currentY = doc.y;
    doc.text("Tax Withheld:", summaryCol, currentY);
    doc.fillColor("gray").text("N/A — 1099 Contractor", valCol, currentY, { width: 100, align: "right" });
    doc.fillColor("black");
    doc.moveDown(0.3);

    if (stmt.reserveWithheldTotal && parseFloat(stmt.reserveWithheldTotal) > 0) {
      summaryLine("Reserve Withheld:", `-${stmt.reserveWithheldTotal}`);
    }

    doc.moveDown(0.2);
    doc.moveTo(summaryCol, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.3);

    summaryLine("Net Pay:", stmt.netPay, true);

    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica-Bold").text("Year-to-Date", summaryCol);
    doc.font("Helvetica").fontSize(9);
    doc.moveDown(0.2);
    const ytdGrossVal = parseFloat(stmt.ytdGross || "0");
    const ytdDeductionsVal = parseFloat(stmt.ytdDeductions || "0");
    const ytdNetVal = parseFloat(stmt.ytdNetPay || "0");
    summaryLine("YTD Gross:", ytdGrossVal.toFixed(2));
    summaryLine("YTD Deductions:", ytdDeductionsVal.toFixed(2));
    summaryLine("YTD Net:", ytdNetVal.toFixed(2), true);

    const hasReserveData = (stmt.reserveWithheldTotal && parseFloat(stmt.reserveWithheldTotal) > 0) ||
      (stmt.reservePreviousBalance && parseFloat(stmt.reservePreviousBalance) > 0) ||
      (stmt.reserveChargebacksOffset && parseFloat(stmt.reserveChargebacksOffset) > 0);

    if (hasReserveData) {
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica-Bold").text("ROLLING RESERVE STATUS", col1);
      doc.font("Helvetica").fontSize(8);
      doc.moveDown(0.3);

      const reserveWithheld = parseFloat(stmt.reserveWithheldTotal || "0");
      const reserveBalance = stmt.reserveBalanceAfter ? parseFloat(stmt.reserveBalanceAfter) : null;
      const previousBalance = stmt.reservePreviousBalance ? parseFloat(stmt.reservePreviousBalance) : null;
      const chargebacksOffset = stmt.reserveChargebacksOffset ? parseFloat(stmt.reserveChargebacksOffset) : 0;
      const cap = stmt.reserveCapAmount ? parseFloat(stmt.reserveCapAmount) : (reserveData ? (reserveData.capCents / 100) : 2500);
      const statusLabel = stmt.reserveStatusLabel || (reserveData?.status === "AT_CAP" ? "AT CAP — Withholding Paused"
        : reserveData?.status === "HELD" ? "HELD — Pending Maturity Release"
        : `ACTIVE — Withholding ${reserveData?.withholdingPercent || "15"}%`);

      if (previousBalance !== null) {
        doc.text(`Previous Balance:            $${previousBalance.toFixed(2)}`, col1);
        doc.moveDown(0.2);
      }
      if (reserveWithheld > 0) {
        doc.text(`Withheld This Period:        +$${reserveWithheld.toFixed(2)}`, col1);
        doc.moveDown(0.2);
      }
      if (chargebacksOffset > 0) {
        doc.text(`Chargebacks Offset:          -$${chargebacksOffset.toFixed(2)}`, col1);
        doc.moveDown(0.2);
      }
      if (reserveBalance !== null) {
        doc.text(`Current Balance:             $${reserveBalance.toFixed(2)} / $${cap.toFixed(2)} cap`, col1);
        doc.moveDown(0.2);
        doc.text(`Status:                      ${statusLabel}`, col1);
      }
      doc.moveDown(0.3);
      doc.fontSize(7).fillColor("gray");
      doc.text("Note: The rolling reserve is not wages. It is a conditional holdback per your Independent Contractor Agreement.", col1, doc.y, { width: 500 });
      doc.fillColor("black");
    }

    doc.moveDown(1);

    doc.fontSize(9);
    checkPage();
    const statsY = doc.y;
    doc.text(`Orders: ${stmt.totalOrders || 0}`, col1, statsY);
    doc.text(`Connects: ${stmt.totalConnects || 0}`, col1 + 120, statsY);
    doc.text(`Mobile Lines: ${stmt.totalMobileLines || 0}`, col1 + 260, statsY);

    doc.moveDown(2);
    doc.fontSize(7).fillColor("gray");
    doc.text(`Generated: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET`, col1, doc.y, { align: "center" });

    doc.end();
  });
}
