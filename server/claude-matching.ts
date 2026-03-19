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
  accountNumber?: string;
  isMobileOrder?: boolean;
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
    if (bestScore >= 0.7 && bestIdx >= 0) {
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

function findColumn(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const lowerAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const key of Object.keys(row)) {
      const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (lowerKey === lowerAlias) return row[key] || "";
    }
  }
  return "";
}

function getCustomerName(row: Record<string, string>): string {
  const direct = findColumn(row,
    "CUSTOMER_NAME", "Customer_Name", "Customer Name", "CustomerName",
    "customer", "name", "client_name", "Client Name", "subscriber",
    "Subscriber Name", "SUBSCRIBER_NAME", "cust_name", "CUST_NAME"
  );
  if (direct) return direct;

  const first = findColumn(row, "FIRST_NAME", "First Name", "FirstName", "first_name", "FNAME");
  const last = findColumn(row, "LAST_NAME", "Last Name", "LastName", "last_name", "LNAME");
  if (first || last) return [first, last].filter(Boolean).join(" ");

  return "";
}

function getAddress(row: Record<string, string>): string {
  const line1 = findColumn(row,
    "ADDR_LINE_1", "Address", "ADDRESS", "address_line_1", "Address Line 1",
    "Street", "STREET", "street_address", "Street Address",
    "service_address", "Service Address", "SERVICE_ADDRESS",
    "install_address", "Install Address"
  );
  const line2 = findColumn(row,
    "ADDR_LINE_2", "Address2", "ADDRESS_2", "address_line_2", "Address Line 2",
    "Apt", "APT", "Unit", "UNIT", "Suite", "SUITE"
  );
  return [line1, line2].filter(Boolean).join(" ");
}

function getCity(row: Record<string, string>): string {
  return findColumn(row, "CITY", "City", "city", "TOWN", "Town");
}

function getZip(row: Record<string, string>): string {
  return findColumn(row,
    "ZIP", "Zip", "zip", "ZIP_CODE", "Zip Code", "ZipCode",
    "zip_code", "ZIPCODE", "Postal", "POSTAL", "postal_code"
  );
}

function getRepName(row: Record<string, string>): string {
  return findColumn(row,
    "SALESMAN_NAME", "Salesman Name", "SalesmanName", "salesman",
    "REP_NAME", "Rep Name", "RepName", "rep_name", "rep",
    "sales_rep", "Sales Rep", "SALES_REP", "agent", "Agent", "AGENT",
    "consultant", "Consultant"
  );
}

function getAccountNumber(row: Record<string, string>): string {
  return findColumn(row,
    "ACCT_NBR", "Account Number", "AccountNumber", "account_number",
    "ACCOUNT_NUMBER", "Acct", "ACCT", "acct_number", "Account",
    "ACCOUNT", "account_nbr", "Account_Nbr", "acct_num",
    "subscriber_id", "SUBSCRIBER_ID", "customer_id", "CUSTOMER_ID"
  );
}

function getWoStatus(row: Record<string, string>): string {
  return findColumn(row,
    "WO_STATUS", "Status", "STATUS", "status", "Work Order Status",
    "wo_status", "WorkOrderStatus", "ORDER_STATUS", "Order Status",
    "order_status", "JOB_STATUS", "Job Status", "job_status",
    "install_status", "Install Status", "INSTALL_STATUS"
  );
}

export function getWorkOrderType(row: Record<string, string>): string {
  return findColumn(row,
    "WORK_ORDER_TYPE", "Work_Order_Type", "Work Order Type", "WorkOrderType",
    "work_order_type", "WO_TYPE", "wo_type", "ORDER_TYPE", "Order Type",
    "order_type", "OrderType"
  ).trim().toUpperCase();
}

export function isSheetRowMobile(row: Record<string, string>): boolean {
  const woType = getWorkOrderType(row);
  return woType === "IN";
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

function scoreMatch(row: Record<string, string>, order: OrderSummary): ScoreBreakdown {
  const reasons: string[] = [];

  const sheetName = getCustomerName(row);
  const nameScore = nameTokenMatch(sheetName, order.customerName);
  if (nameScore >= 0.9) reasons.push("Strong name match");
  else if (nameScore >= 0.7) reasons.push("Good name match");
  else if (nameScore >= 0.5) reasons.push("Partial name match");

  const sheetAddr = getAddress(row);
  const orderAddr = [order.houseNumber, order.streetName, order.aptUnit].filter(Boolean).join(" ");
  const addressScore = addressSimilarity(sheetAddr, orderAddr);
  if (addressScore >= 0.7) reasons.push("Address matched");
  else if (addressScore >= 0.4) reasons.push("Partial address match");

  const sheetCity = normalize(getCity(row));
  const orderCity = normalize(order.city || "");
  const cityScore = sheetCity && orderCity ? similarity(sheetCity, orderCity) : 0;
  if (cityScore >= 0.8) reasons.push("City matched");

  const sheetZip = getZip(row).replace(/\D/g, "").slice(0, 5);
  const orderZip = (order.zipCode || "").replace(/\D/g, "").slice(0, 5);
  const zipScore = sheetZip && orderZip && sheetZip === orderZip ? 1 : 0;
  if (zipScore > 0) reasons.push("ZIP matched");

  const sheetRep = normalize(getRepName(row));
  const orderRep = normalize(order.repName || "");
  let repScore = 0;
  if (sheetRep && orderRep) {
    repScore = nameTokenMatch(sheetRep, orderRep);
    if (repScore >= 0.7) reasons.push("Rep name matched");
  }

  const sheetAcct = normalize(getAccountNumber(row));
  let acctScore = 0;
  if (sheetAcct) {
    const orderInv = normalize(order.invoiceNumber || "");
    const orderAcct = normalize(order.accountNumber || "");
    if ((orderInv && sheetAcct === orderInv) || (orderAcct && sheetAcct === orderAcct)) {
      acctScore = 1;
      reasons.push("Account/Invoice number matched");
    }
  }

  const sheetIsMobile = isSheetRowMobile(row);
  const orderIsMobile = !!order.isMobileOrder;
  let mobileTypeBonus = 0;
  if (sheetIsMobile && orderIsMobile) {
    mobileTypeBonus = 10;
    reasons.push("Mobile order type matched");
  } else if (sheetIsMobile !== orderIsMobile) {
    mobileTypeBonus = -15;
    reasons.push(sheetIsMobile ? "Sheet row is mobile but order is not" : "Order is mobile but sheet row is not");
  }

  let total: number;
  if (acctScore === 1 && nameScore >= 0.4) {
    total = 95;
    reasons.unshift("High-confidence: account + name match");
  } else if (acctScore === 1) {
    total = 85;
    reasons.unshift("Account number matched (name weak)");
  } else {
    const hasAddr = sheetAddr.length > 0;
    const hasCity = sheetCity.length > 0;
    const hasZip = sheetZip.length > 0;
    const hasRep = sheetRep.length > 0;
    const fieldsAvailable = 1 + (hasAddr ? 1 : 0) + (hasCity ? 1 : 0) + (hasZip ? 1 : 0) + (hasRep ? 1 : 0);

    if (fieldsAvailable <= 2) {
      total = Math.round(nameScore * 60 + addressScore * 25 + cityScore * 5 + zipScore * 5 + repScore * 5);
    } else {
      total = Math.round(
        nameScore * 35 +
        addressScore * 25 +
        cityScore * 10 +
        zipScore * 10 +
        repScore * 15 +
        acctScore * 5
      );
    }
  }

  total = Math.max(0, Math.min(100, total + mobileTypeBonus));

  return { nameScore, addressScore, cityScore, zipScore, repScore, acctScore, total, reasons };
}

export function normalizeWoStatus(row: Record<string, string>): string {
  const raw = getWoStatus(row).trim().toUpperCase();
  const statusMap: Record<string, string> = {
    "CP": "CP",
    "COMPLETED": "CP",
    "CONNECTED": "CP",
    "INSTALLED": "CP",
    "DONE": "CP",
    "IN": "CP",
    "CN": "CN",
    "CANCELED": "CN",
    "CANCELLED": "CN",
    "OP": "OP",
    "OPEN": "OP",
    "IN PROGRESS": "OP",
    "ACTIVE": "OP",
    "ND": "ND",
    "NO DISPATCH": "ND",
    "NO_DISPATCH": "ND",
    "PENDING": "OP",
    "SCHEDULED": "OP",
  };
  return statusMap[raw] || raw;
}

const MATCH_THRESHOLD = 45;

export async function matchInstallationsToOrders(
  sheetRows: SheetRow[],
  orders: OrderSummary[]
): Promise<MatchingResponse> {
  if (sheetRows.length === 0) {
    return { matches: [], unmatched: [], summary: "No installation records to match." };
  }

  const matchableRows: SheetRow[] = [];
  const skippedRows: { rowIndex: number; data: Record<string, string>; reason: string }[] = [];
  const validStatuses = new Set(["CP", "CN", "OP", "ND", "IN", "COMPLETED", "CONNECTED", "OPEN", "NO DISPATCH", "CANCELED", "CANCELLED", "INSTALLED", "ACTIVE", "PENDING", "SCHEDULED", "IN PROGRESS"]);

  for (const row of sheetRows) {
    const woStatus = getWoStatus(row.data).trim().toUpperCase();
    if (!woStatus || validStatuses.has(woStatus)) {
      matchableRows.push(row);
    } else {
      skippedRows.push({ rowIndex: row.rowIndex, data: row.data, reason: `Skipped: status is '${woStatus}' (not a recognized status)` });
    }
  }

  const statusCounts: Record<string, number> = {};
  for (const r of matchableRows) {
    const s = getWoStatus(r.data).trim().toUpperCase() || "EMPTY";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }
  const statusStr = Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(", ");

  console.log(`[Install Sync] Filtered: ${matchableRows.length} matchable (${statusStr}), ${skippedRows.length} skipped out of ${sheetRows.length} total rows`);

  if (matchableRows.length > 0) {
    const sampleRow = matchableRows[0].data;
    const detectedCols = {
      name: getCustomerName(sampleRow) ? "found" : "MISSING",
      address: getAddress(sampleRow) ? "found" : "MISSING",
      city: getCity(sampleRow) ? "found" : "MISSING",
      zip: getZip(sampleRow) ? "found" : "MISSING",
      rep: getRepName(sampleRow) ? "found" : "MISSING",
      acct: getAccountNumber(sampleRow) ? "found" : "MISSING",
    };
    console.log(`[Install Sync] Column detection: ${JSON.stringify(detectedCols)}`);
    console.log(`[Install Sync] Available headers: ${Object.keys(sampleRow).join(", ")}`);
  }

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

  console.log(`[Install Sync] Matching ${matchableRows.length} sheet rows against ${orders.length} orders (threshold: ${MATCH_THRESHOLD}%)`);

  const candidates: { rowIndex: number; data: Record<string, string>; orderId: string; score: ScoreBreakdown }[] = [];

  for (const row of matchableRows) {
    for (const order of orders) {
      const score = scoreMatch(row.data, order);
      if (score.total >= MATCH_THRESHOLD) {
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
      let bestReasons: string[] = [];
      for (const order of orders) {
        const s = scoreMatch(r.data, order);
        if (s.total > bestScore) {
          bestScore = s.total;
          bestReasons = s.reasons;
        }
      }
      const customerName = getCustomerName(r.data);
      const addr = getAddress(r.data);
      const detail = customerName ? ` (customer: ${customerName})` : addr ? ` (address: ${addr.slice(0, 40)})` : "";
      return {
        rowIndex: r.rowIndex,
        data: r.data,
        reason: bestScore > 0
          ? `Best score ${bestScore}% (below ${MATCH_THRESHOLD}% threshold)${detail}. Partial: ${bestReasons.join(", ") || "none"}`
          : `No matching order found${detail}`,
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
