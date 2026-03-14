import PDFDocument from "pdfkit";
import { storage } from "./storage";
import type { PayStatement, PayStatementLineItem } from "@shared/schema";

export async function generatePayStubPdf(payStatementId: string): Promise<Buffer> {
  const statement = await storage.getPayStatementById(payStatementId);
  if (!statement) throw new Error(`Pay statement ${payStatementId} not found`);

  const lineItems = await storage.getPayStatementLineItems(payStatementId);
  const deductions = await storage.getPayStatementDeductions(payStatementId);

  return buildPdf(statement, lineItems, deductions);
}

function buildPdf(
  stmt: PayStatement,
  lineItems: any[],
  deductions: any[]
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
    const tableHeaders = ["Description", "Type", "Amount"];
    const colWidths = [250, 120, 100];
    const startX = 50;
    let currentY = doc.y;

    tableHeaders.forEach((header, i) => {
      let x = startX;
      for (let j = 0; j < i; j++) x += colWidths[j];
      doc.text(header, x, currentY, { width: colWidths[i], align: i === 2 ? "right" : "left" });
    });

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.2);

    const commissionItems = lineItems.filter(li => li.category === "COMMISSION");
    const overrideItems = lineItems.filter(li => li.category === "OVERRIDE");
    const bonusItems = lineItems.filter(li => li.category === "BONUS");

    const drawLineItem = (description: string, type: string, amount: string) => {
      currentY = doc.y;
      if (currentY > 680) {
        doc.addPage();
        currentY = 50;
      }
      doc.text(description, startX, currentY, { width: colWidths[0] });
      doc.text(type, startX + colWidths[0], currentY, { width: colWidths[1] });
      doc.text(`$${parseFloat(amount).toFixed(2)}`, startX + colWidths[0] + colWidths[1], currentY, { width: colWidths[2], align: "right" });
      doc.moveDown(0.3);
    };

    for (const item of commissionItems) {
      const desc = item.customerName
        ? `${item.invoiceNumber || ""} - ${item.customerName}`
        : item.description;
      drawLineItem(desc, "Commission", item.amount);
    }

    for (const item of overrideItems) {
      drawLineItem(item.description, "Override", item.amount);
    }

    for (const item of bonusItems) {
      drawLineItem(item.description, "Bonus", item.amount);
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

    doc.moveDown(0.2);
    doc.moveTo(summaryCol, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.3);

    summaryLine("Net Pay:", stmt.netPay, true);

    doc.moveDown(1);

    doc.fontSize(9);
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
