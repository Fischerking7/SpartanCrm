import Anthropic from "@anthropic-ai/sdk";
import type { SheetRow } from "./google-sheets";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_API_KEY ? {} : { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }),
});

export interface OrderSummary {
  id: string;
  invoiceNumber: string;
  customerName: string;
  houseNumber: string;
  streetName: string;
  aptUnit: string;
  city: string;
  zipCode: string;
  serviceType: string;
  providerName: string;
  repName: string;
  dateSold: string;
  jobStatus: string;
  approvalStatus: string;
}

export interface MatchResult {
  sheetRowIndex: number;
  sheetData: Record<string, string>;
  orderId: string;
  orderInvoice: string;
  orderCustomerName: string;
  confidence: number;
  reasoning: string;
}

export interface MatchingResponse {
  matches: MatchResult[];
  unmatched: { rowIndex: number; data: Record<string, string>; reason: string }[];
  summary: string;
}

const BATCH_SIZE = 25;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 65000;

interface CompactSheetRow {
  i: number;
  d: Record<string, string>;
}

interface CompactOrder {
  id: string;
  name: string;
  addr: string;
  city: string;
  zip: string;
  svc: string;
  rep: string;
  date: string;
}

function compactifySheetRows(rows: SheetRow[]): CompactSheetRow[] {
  return rows.map((r) => {
    const essentialKeys = [
      "CUSTOMER_NAME", "ADDR_LINE_1", "ADDR_LINE_2", "CITY", "ZIP", "STATE",
      "ACCT_NBR", "WORK_ORDER_NBR", "WO_STATUS", "SALESMAN_NAME", "SALESMAN_NBR",
      "DT_ENTERED", "SCHEDULE_DT", "WORK_ORDER_TYPE",
      "DATA_INSTALLS_QTY", "MOBILE_INSTALLS_QTY", "VIDEO_INSTALLS_QTY", "TELEPHONE_INSTALLS_QTY",
    ];
    const d: Record<string, string> = {};
    for (const key of essentialKeys) {
      if (r.data[key] && r.data[key].trim()) {
        d[key] = r.data[key].trim();
      }
    }
    if (Object.keys(d).length === 0) {
      for (const [k, v] of Object.entries(r.data)) {
        if (v && v.trim()) d[k] = v.trim();
      }
    }
    return { i: r.rowIndex, d };
  });
}

function compactifyOrders(orders: OrderSummary[]): CompactOrder[] {
  return orders.map((o) => ({
    id: o.id,
    name: o.customerName,
    addr: [o.houseNumber, o.streetName, o.aptUnit].filter(Boolean).join(" "),
    city: o.city,
    zip: o.zipCode,
    svc: o.serviceType,
    rep: o.repName,
    date: o.dateSold,
  }));
}

function buildPrompt(sheetRows: CompactSheetRow[], orders: CompactOrder[]): string {
  return `Match installation records to CRM orders by customer name + address/service.

INSTALLS (${sheetRows.length}):
${JSON.stringify(sheetRows)}

ORDERS (${orders.length}):
${JSON.stringify(orders)}

Rules: Match name similarity + address/account/service. Score 90-100=strong, 70-89=likely, 60-69=possible. Min 60. Each order max 1 match.

Return ONLY JSON:
{"matches":[{"i":<rowIndex>,"id":"<orderId>","c":<confidence>,"r":"<reason>"}],"u":[{"i":<rowIndex>,"r":"<reason>"}],"s":"<summary>"}`;
}

async function callClaude(prompt: string, attempt = 0): Promise<any> {
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    let responseText = content.text.trim();
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      responseText = jsonMatch[1].trim();
    }

    return JSON.parse(responseText);
  } catch (error: any) {
    const isRateLimit = error.message?.includes("429") || error.message?.includes("rate_limit");
    if (isRateLimit && attempt < MAX_RETRIES) {
      console.log(`[Claude Matching] Rate limited, waiting ${RETRY_DELAY_MS / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return callClaude(prompt, attempt + 1);
    }
    throw error;
  }
}

export async function matchInstallationsToOrders(
  sheetRows: SheetRow[],
  orders: OrderSummary[]
): Promise<MatchingResponse> {
  if (sheetRows.length === 0) {
    return { matches: [], unmatched: [], summary: "No installation records to match." };
  }

  const matchableRows: SheetRow[] = [];
  const skippedRows: { rowIndex: number; data: Record<string, string>; reason: string }[] = [];

  const validStatuses = new Set(["CP", "CN", "OP", "ND"]);

  for (const row of sheetRows) {
    const woStatus = (row.data["WO_STATUS"] || "").trim().toUpperCase();
    if (validStatuses.has(woStatus)) {
      matchableRows.push(row);
    } else {
      skippedRows.push({ rowIndex: row.rowIndex, data: row.data, reason: `Skipped: WO_STATUS is '${woStatus || "empty"}' (not a recognized status)` });
    }
  }

  const cpCount = matchableRows.filter(r => (r.data["WO_STATUS"] || "").trim().toUpperCase() === "CP").length;
  const cnCount = matchableRows.filter(r => (r.data["WO_STATUS"] || "").trim().toUpperCase() === "CN").length;
  const opCount = matchableRows.filter(r => (r.data["WO_STATUS"] || "").trim().toUpperCase() === "OP").length;
  const ndCount = matchableRows.filter(r => (r.data["WO_STATUS"] || "").trim().toUpperCase() === "ND").length;

  console.log(`[Claude Matching] Filtered: ${matchableRows.length} matchable (CP:${cpCount}, CN:${cnCount}, OP:${opCount}, ND:${ndCount}), ${skippedRows.length} skipped out of ${sheetRows.length} total rows`);

  if (matchableRows.length === 0) {
    return {
      matches: [],
      unmatched: skippedRows,
      summary: `No matchable installation records found. ${skippedRows.length} rows skipped.`,
    };
  }

  if (orders.length === 0) {
    return {
      matches: [],
      unmatched: [
        ...matchableRows.map((r) => ({
          rowIndex: r.rowIndex,
          data: r.data,
          reason: "No pending orders in the system to match against.",
        })),
        ...skippedRows,
      ],
      summary: "No pending orders available for matching.",
    };
  }

  const sheetRowMap = new Map(matchableRows.map((r) => [r.rowIndex, r]));
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const compactOrders = compactifyOrders(orders);
  const allRawMatches: any[] = [];
  const allRawUnmatched: any[] = [];

  const batches: SheetRow[][] = [];
  for (let i = 0; i < matchableRows.length; i += BATCH_SIZE) {
    batches.push(matchableRows.slice(i, i + BATCH_SIZE));
  }

  console.log(`[Claude Matching] Processing ${matchableRows.length} rows in ${batches.length} batch(es) against ${orders.length} orders`);

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const compactRows = compactifySheetRows(batch);
    const prompt = buildPrompt(compactRows, compactOrders);
    console.log(`[Claude Matching] Batch ${bIdx + 1}/${batches.length}: ${batch.length} rows, prompt ~${prompt.length} chars`);

    const parsed = await callClaude(prompt);

    if (parsed.matches && Array.isArray(parsed.matches)) {
      for (const m of parsed.matches) {
        allRawMatches.push({
          sheetRowIndex: m.i ?? m.sheetRowIndex,
          orderId: m.id ?? m.orderId,
          confidence: m.c ?? m.confidence,
          reasoning: m.r ?? m.reasoning,
        });
      }
    }
    if (parsed.u && Array.isArray(parsed.u)) {
      for (const u of parsed.u) {
        allRawUnmatched.push({ rowIndex: u.i ?? u.rowIndex, reason: u.r ?? u.reason });
      }
    }
    if (parsed.unmatched && Array.isArray(parsed.unmatched)) {
      for (const u of parsed.unmatched) {
        allRawUnmatched.push({ rowIndex: u.i ?? u.rowIndex, reason: u.r ?? u.reason });
      }
    }

    if (bIdx < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const usedOrderIds = new Set<string>();
  const usedRowIndices = new Set<number>();

  const sortedMatches = allRawMatches
    .filter((m) => typeof m.confidence === "number" && m.confidence >= 60)
    .sort((a, b) => b.confidence - a.confidence);

  const validMatches: MatchResult[] = [];
  for (const match of sortedMatches) {
    const sheetRow = sheetRowMap.get(match.sheetRowIndex);
    const order = orderMap.get(match.orderId);
    if (!sheetRow || !order) continue;
    if (usedOrderIds.has(match.orderId) || usedRowIndices.has(match.sheetRowIndex)) continue;

    usedOrderIds.add(match.orderId);
    usedRowIndices.add(match.sheetRowIndex);

    validMatches.push({
      sheetRowIndex: match.sheetRowIndex,
      sheetData: sheetRow.data,
      orderId: order.id,
      orderInvoice: order.invoiceNumber,
      orderCustomerName: order.customerName,
      confidence: Math.min(100, Math.round(match.confidence)),
      reasoning: match.reasoning || "Matched by Claude AI",
    });
  }

  const unmatchedRows = matchableRows
    .filter((r) => !usedRowIndices.has(r.rowIndex))
    .map((r) => {
      const unmatchedEntry = allRawUnmatched.find((u: any) => u.rowIndex === r.rowIndex);
      return {
        rowIndex: r.rowIndex,
        data: r.data,
        reason: unmatchedEntry?.reason || "No matching order found",
      };
    });

  const allUnmatched = [...unmatchedRows, ...skippedRows];

  console.log(`[Claude Matching] Done: ${validMatches.length} matched, ${unmatchedRows.length} unmatched, ${skippedRows.length} skipped`);

  return {
    matches: validMatches,
    unmatched: allUnmatched,
    summary: `Matched ${validMatches.length} of ${matchableRows.length} records across ${batches.length} batch(es). ${skippedRows.length} rows skipped (unrecognized status).`,
  };
}
