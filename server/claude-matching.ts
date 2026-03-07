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

const BATCH_SIZE = 50;

function buildPrompt(sheetRows: SheetRow[], orders: OrderSummary[]): string {
  return `You are a data matching assistant for a CRM system. Your job is to match installation confirmation records from a spreadsheet against pending sales orders in our database.

## Installation Records from Spreadsheet (${sheetRows.length} records)
${JSON.stringify(sheetRows)}

## Pending Orders in CRM (${orders.length} orders)
${JSON.stringify(orders)}

## Matching Rules
1. Match by customer name similarity (first priority - names may have slight variations, typos, or abbreviations)
2. Match by address similarity (house number, street, city, zip - partial matches count)
3. Match by service type or provider if columns exist in the sheet
4. A match needs BOTH a reasonable name match AND at least one supporting factor (address, date, service type, account number, etc.)
5. Confidence scoring: 90-100 = strong match (name + address match well), 70-89 = likely match (name matches, some supporting evidence), 60-69 = possible match (partial name or address match)
6. Only report matches with confidence >= 60
7. Each order can only be matched to ONE sheet row (the best match). Do not match multiple sheet rows to the same order.

## Output Format
Return ONLY valid JSON (no markdown, no code fences) in this exact structure:
{
  "matches": [
    {
      "sheetRowIndex": <number - the rowIndex from the sheet row>,
      "orderId": "<string - the CRM order id>",
      "confidence": <number 60-100>,
      "reasoning": "<brief explanation of why this is a match>"
    }
  ],
  "unmatched": [
    {
      "rowIndex": <number>,
      "reason": "<why no match was found>"
    }
  ],
  "summary": "<1-2 sentence overall summary>"
}`;
}

async function callClaude(prompt: string): Promise<any> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
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

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`Failed to parse Claude's response as JSON. Response: ${responseText.substring(0, 500)}`);
  }
}

export async function matchInstallationsToOrders(
  sheetRows: SheetRow[],
  orders: OrderSummary[]
): Promise<MatchingResponse> {
  if (sheetRows.length === 0) {
    return { matches: [], unmatched: [], summary: "No installation records to match." };
  }
  if (orders.length === 0) {
    return {
      matches: [],
      unmatched: sheetRows.map((r) => ({
        rowIndex: r.rowIndex,
        data: r.data,
        reason: "No pending orders in the system to match against.",
      })),
      summary: "No pending orders available for matching.",
    };
  }

  const sheetRowMap = new Map(sheetRows.map((r) => [r.rowIndex, r]));
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const allRawMatches: any[] = [];
  const allRawUnmatched: any[] = [];

  const batches: SheetRow[][] = [];
  for (let i = 0; i < sheetRows.length; i += BATCH_SIZE) {
    batches.push(sheetRows.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const prompt = buildPrompt(batch, orders);
    const parsed = await callClaude(prompt);

    if (parsed.matches && Array.isArray(parsed.matches)) {
      allRawMatches.push(...parsed.matches);
    }
    if (parsed.unmatched && Array.isArray(parsed.unmatched)) {
      allRawUnmatched.push(...parsed.unmatched);
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

  const unmatched = sheetRows
    .filter((r) => !usedRowIndices.has(r.rowIndex))
    .map((r) => {
      const unmatchedEntry = allRawUnmatched.find((u: any) => u.rowIndex === r.rowIndex);
      return {
        rowIndex: r.rowIndex,
        data: r.data,
        reason: unmatchedEntry?.reason || "No matching order found",
      };
    });

  return {
    matches: validMatches,
    unmatched,
    summary: `Matched ${validMatches.length} of ${sheetRows.length} installation records across ${batches.length} batch(es).`,
  };
}
