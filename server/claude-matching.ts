import type { SheetRow } from "./google-sheets";

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

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddress(s: string): string {
  let addr = normalize(s);
  const replacements: [RegExp, string][] = [
    [/\bstreet\b/g, "st"],
    [/\bavenue\b/g, "ave"],
    [/\bboulevard\b/g, "blvd"],
    [/\bdrive\b/g, "dr"],
    [/\blane\b/g, "ln"],
    [/\broad\b/g, "rd"],
    [/\bcourt\b/g, "ct"],
    [/\bplace\b/g, "pl"],
    [/\bcircle\b/g, "cir"],
    [/\bterrace\b/g, "ter"],
    [/\bapartment\b/g, "apt"],
    [/\bunit\b/g, "apt"],
    [/\bsuite\b/g, "ste"],
    [/\bnorth\b/g, "n"],
    [/\bsouth\b/g, "s"],
    [/\beast\b/g, "e"],
    [/\bwest\b/g, "w"],
  ];
  for (const [pattern, replacement] of replacements) {
    addr = addr.replace(pattern, replacement);
  }
  return addr;
}

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lb; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[la][lb];
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / maxLen);
}

function nameTokenMatch(a: string, b: string): number {
  const tokensA = normalize(a).split(" ").filter(Boolean);
  const tokensB = normalize(b).split(" ").filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let matched = 0;
  const usedB = new Set<number>();
  for (const ta of tokensA) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let j = 0; j < tokensB.length; j++) {
      if (usedB.has(j)) continue;
      const s = similarity(ta, tokensB[j]);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = j;
      }
    }
    if (bestScore >= 0.75 && bestIdx >= 0) {
      matched += bestScore;
      usedB.add(bestIdx);
    }
  }

  return matched / Math.max(tokensA.length, tokensB.length);
}

function addressSimilarity(sheetAddr: string, orderAddr: string): number {
  const na = normalizeAddress(sheetAddr);
  const nb = normalizeAddress(orderAddr);
  if (!na && !nb) return 0.5;
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tokensA = na.split(" ").filter(Boolean);
  const tokensB = nb.split(" ").filter(Boolean);

  let matched = 0;
  const usedB = new Set<number>();
  for (const ta of tokensA) {
    for (let j = 0; j < tokensB.length; j++) {
      if (usedB.has(j)) continue;
      if (ta === tokensB[j]) {
        matched++;
        usedB.add(j);
        break;
      }
    }
  }

  const total = Math.max(tokensA.length, tokensB.length);
  return total > 0 ? matched / total : 0;
}

interface ScoreBreakdown {
  nameScore: number;
  addressScore: number;
  cityScore: number;
  zipScore: number;
  repScore: number;
  acctScore: number;
  total: number;
  reasons: string[];
}

function scoreMatch(row: Record<string, string>, order: OrderSummary, repMap: Map<string, string>): ScoreBreakdown {
  const reasons: string[] = [];

  const sheetName = row["CUSTOMER_NAME"] || "";
  const nameScore = nameTokenMatch(sheetName, order.customerName);
  if (nameScore >= 0.9) reasons.push("Strong name match");
  else if (nameScore >= 0.7) reasons.push("Good name match");
  else if (nameScore >= 0.5) reasons.push("Partial name match");

  const sheetAddr = [row["ADDR_LINE_1"], row["ADDR_LINE_2"]].filter(Boolean).join(" ");
  const orderAddr = [order.houseNumber, order.streetName, order.aptUnit].filter(Boolean).join(" ");
  const addressScore = addressSimilarity(sheetAddr, orderAddr);
  if (addressScore >= 0.7) reasons.push("Address matched");
  else if (addressScore >= 0.4) reasons.push("Partial address match");

  const sheetCity = normalize(row["CITY"] || "");
  const orderCity = normalize(order.city || "");
  const cityScore = sheetCity && orderCity ? similarity(sheetCity, orderCity) : 0;
  if (cityScore >= 0.8) reasons.push("City matched");

  const sheetZip = (row["ZIP"] || "").replace(/\D/g, "").slice(0, 5);
  const orderZip = (order.zipCode || "").replace(/\D/g, "").slice(0, 5);
  const zipScore = sheetZip && orderZip && sheetZip === orderZip ? 1 : 0;
  if (zipScore > 0) reasons.push("ZIP matched");

  const sheetRep = normalize(row["SALESMAN_NAME"] || "");
  const orderRep = normalize(order.repName || "");
  let repScore = 0;
  if (sheetRep && orderRep) {
    repScore = nameTokenMatch(sheetRep, orderRep);
    if (repScore >= 0.7) reasons.push("Rep name matched");
  }

  const sheetAcct = (row["ACCT_NBR"] || "").trim();
  let acctScore = 0;
  if (sheetAcct && order.invoiceNumber && normalize(sheetAcct) === normalize(order.invoiceNumber)) {
    acctScore = 1;
    reasons.push("Account/Invoice number matched");
  }

  let total: number;
  if (acctScore === 1 && nameScore >= 0.5) {
    total = 95;
    reasons.unshift("High-confidence: account + name match");
  } else {
    total = Math.round(
      nameScore * 40 +
      addressScore * 25 +
      cityScore * 10 +
      zipScore * 10 +
      repScore * 10 +
      acctScore * 5
    );
  }

  return { nameScore, addressScore, cityScore, zipScore, repScore, acctScore, total, reasons };
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

  console.log(`[Install Sync] Filtered: ${matchableRows.length} matchable (CP:${cpCount}, CN:${cnCount}, OP:${opCount}, ND:${ndCount}), ${skippedRows.length} skipped out of ${sheetRows.length} total rows`);

  if (matchableRows.length === 0) {
    return { matches: [], unmatched: skippedRows, summary: `No matchable installation records found. ${skippedRows.length} rows skipped.` };
  }

  if (orders.length === 0) {
    return {
      matches: [],
      unmatched: [
        ...matchableRows.map(r => ({ rowIndex: r.rowIndex, data: r.data, reason: "No pending orders in the system to match against." })),
        ...skippedRows,
      ],
      summary: "No pending orders available for matching.",
    };
  }

  const repMap = new Map<string, string>();

  const candidates: { rowIndex: number; data: Record<string, string>; orderId: string; score: ScoreBreakdown }[] = [];

  for (const row of matchableRows) {
    for (const order of orders) {
      const score = scoreMatch(row.data, order, repMap);
      if (score.total >= 60) {
        candidates.push({ rowIndex: row.rowIndex, data: row.data, orderId: order.id, score });
      }
    }
  }

  candidates.sort((a, b) => b.score.total - a.score.total);

  const usedOrderIds = new Set<string>();
  const usedRowIndices = new Set<number>();
  const validMatches: MatchResult[] = [];
  const orderMap = new Map(orders.map(o => [o.id, o]));

  for (const c of candidates) {
    if (usedOrderIds.has(c.orderId) || usedRowIndices.has(c.rowIndex)) continue;
    const order = orderMap.get(c.orderId);
    if (!order) continue;

    usedOrderIds.add(c.orderId);
    usedRowIndices.add(c.rowIndex);

    validMatches.push({
      sheetRowIndex: c.rowIndex,
      sheetData: c.data,
      orderId: order.id,
      orderInvoice: order.invoiceNumber,
      orderCustomerName: order.customerName,
      confidence: Math.min(100, c.score.total),
      reasoning: c.score.reasons.join("; ") || "Matched by deterministic scoring",
    });
  }

  const unmatchedRows = matchableRows
    .filter(r => !usedRowIndices.has(r.rowIndex))
    .map(r => {
      let bestScore = 0;
      for (const order of orders) {
        const s = scoreMatch(r.data, order, repMap);
        if (s.total > bestScore) bestScore = s.total;
      }
      return {
        rowIndex: r.rowIndex,
        data: r.data,
        reason: bestScore > 0 ? `Best match score ${bestScore}% (below 60% threshold)` : "No matching order found",
      };
    });

  const allUnmatched = [...unmatchedRows, ...skippedRows];

  console.log(`[Install Sync] Done: ${validMatches.length} matched, ${unmatchedRows.length} unmatched, ${skippedRows.length} skipped`);

  return {
    matches: validMatches,
    unmatched: allUnmatched,
    summary: `Matched ${validMatches.length} of ${matchableRows.length} records. ${skippedRows.length} rows skipped (unrecognized status).`,
  };
}
