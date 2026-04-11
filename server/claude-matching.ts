import type { SheetRow } from "./google-sheets";
import type { CarrierProfile, CarrierRepMapping } from "@shared/schema";

export interface CarrierContext {
  profile: CarrierProfile;
  columnMapping: Record<string, string[]>;
  speedTierMap: Record<string, string>;
  statusCodeMap: Record<string, string>;
  repMappings: Map<string, { userId: string; repId: string; userName: string }>;
}

export function detectCarrierProfile(headers: string[], profiles: CarrierProfile[]): CarrierProfile | null {
  const headerSet = new Set(headers.map(h => h.trim().toUpperCase()));
  let bestProfile: CarrierProfile | null = null;
  let bestScore = 0;

  for (const profile of profiles) {
    if (!profile.active) continue;
    const sigs = profile.signatureHeaders || [];
    if (sigs.length === 0) continue;

    let matched = 0;
    for (const sig of sigs) {
      if (headerSet.has(sig.trim().toUpperCase())) matched++;
    }
    const score = matched / sigs.length;
    if (score > bestScore) {
      bestScore = score;
      bestProfile = profile;
    }
  }

  return bestScore >= 0.4 ? bestProfile : null;
}

export function buildCarrierContext(
  profile: CarrierProfile,
  repMappings: CarrierRepMapping[],
  userMap: Map<string, { name: string; repId: string }>,
): CarrierContext {
  let columnMapping: Record<string, string[]> = {};
  let speedTierMap: Record<string, string> = {};
  let statusCodeMap: Record<string, string> = {};
  try { columnMapping = JSON.parse(profile.columnMapping || "{}"); } catch { console.warn(`[Carrier] Invalid columnMapping JSON for profile ${profile.name}, using defaults`); }
  try { speedTierMap = JSON.parse(profile.speedTierMap || "{}"); } catch { console.warn(`[Carrier] Invalid speedTierMap JSON for profile ${profile.name}, using defaults`); }
  try { statusCodeMap = JSON.parse(profile.statusCodeMap || "{}"); } catch { console.warn(`[Carrier] Invalid statusCodeMap JSON for profile ${profile.name}, using defaults`); }

  const repMap = new Map<string, { userId: string; repId: string; userName: string }>();
  for (const m of repMappings) {
    const user = userMap.get(m.userId);
    if (user) {
      repMap.set(m.salesmanNbr.toUpperCase(), { userId: m.userId, repId: user.repId, userName: user.name });
    }
  }

  return { profile, columnMapping, speedTierMap, statusCodeMap, repMappings: repMap };
}

function findColumnWithProfile(row: Record<string, string>, field: string, ctx: CarrierContext | null): string {
  if (ctx && ctx.columnMapping[field]) {
    for (const alias of ctx.columnMapping[field]) {
      const lowerAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const key of Object.keys(row)) {
        const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (lowerKey === lowerAlias) return row[key] || "";
      }
    }
  }
  return "";
}

export function extractField(row: Record<string, string>, field: string, ctx: CarrierContext | null, fallback: (...args: any[]) => string): string {
  if (ctx) {
    const val = findColumnWithProfile(row, field, ctx);
    if (val) return val;
  }
  return fallback(row);
}

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
  repId: string;
  dateSold: string;
  jobStatus: string;
  approvalStatus: string;
  accountNumber?: string;
  isMobileOrder?: boolean;
}

export interface ScoreDetail {
  nameScore: number;
  addressScore: number;
  cityScore: number;
  zipScore: number;
  repScore: number;
  acctScore: number;
  confidenceTier: "definitive" | "high" | "medium" | "low";
}

export interface MatchResult {
  sheetRowIndex: number;
  sheetData: Record<string, string>;
  orderId: string;
  orderInvoice: string;
  orderCustomerName: string;
  confidence: number;
  reasoning: string;
  scoreBreakdown?: ScoreDetail;
  serviceLineType?: string;
  workOrderNumber?: string;
  isUpgrade?: boolean;
}

export interface MatchingResponse {
  matches: MatchResult[];
  unmatched: { rowIndex: number; data: Record<string, string>; reason: string }[];
  dedupSkipped: { rowIndex: number; data: Record<string, string>; workOrderNumber: string; previousSyncRunId: string; matchedOrderId: string; classification?: "unchanged" | "changed" }[];
  summary: string;
  rowClassifications?: { new: number; changed: number; unchanged: number };
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

export function getCustomerName(row: Record<string, string>): string {
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

export function getAddress(row: Record<string, string>): string {
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

export function getCity(row: Record<string, string>): string {
  return findColumn(row, "CITY", "City", "city", "TOWN", "Town");
}

export function getZip(row: Record<string, string>): string {
  return findColumn(row,
    "ZIP", "Zip", "zip", "ZIP_CODE", "Zip Code", "ZipCode",
    "zip_code", "ZIPCODE", "Postal", "POSTAL", "postal_code"
  );
}

export function getRepName(row: Record<string, string>): string {
  return findColumn(row,
    "SALESMAN_NAME", "Salesman Name", "SalesmanName", "salesman",
    "REP_NAME", "Rep Name", "RepName", "rep_name", "rep",
    "sales_rep", "Sales Rep", "SALES_REP", "agent", "Agent", "AGENT",
    "consultant", "Consultant"
  );
}

export function getAccountNumber(row: Record<string, string>): string {
  return findColumn(row,
    "ACCT_NBR", "Account Number", "AccountNumber", "account_number",
    "ACCOUNT_NUMBER", "Acct", "ACCT", "acct_number", "Account",
    "ACCOUNT", "account_nbr", "Account_Nbr", "acct_num",
    "subscriber_id", "SUBSCRIBER_ID", "customer_id", "CUSTOMER_ID"
  );
}

export function getWoStatus(row: Record<string, string>): string {
  return findColumn(row,
    "WO_STATUS", "Status", "STATUS", "status", "Work Order Status",
    "wo_status", "WorkOrderStatus", "ORDER_STATUS", "Order Status",
    "order_status", "JOB_STATUS", "Job Status", "job_status",
    "install_status", "Install Status", "INSTALL_STATUS"
  );
}

export function getWorkOrderNumber(row: Record<string, string>): string {
  return findColumn(row,
    "WORK_ORDER_NBR", "Work_Order_Nbr", "Work Order Number", "WorkOrderNumber",
    "work_order_nbr", "WO_NBR", "wo_nbr", "WO_NUMBER", "wo_number"
  );
}

export function getScheduleDate(row: Record<string, string>): string {
  return findColumn(row,
    "SCHEDULE_DT", "Schedule_Dt", "Schedule Date", "ScheduleDate",
    "schedule_date", "SCHEDULED_DATE", "scheduled_dt"
  );
}

export function getCheckInDate(row: Record<string, string>): string {
  return findColumn(row,
    "CHECK_IN_DT", "Check_In_Dt", "Check In Date", "CheckInDate",
    "check_in_date", "CHECKIN_DATE", "checkin_dt", "INSTALL_DATE", "Install Date"
  );
}

export function getCancelCode(row: Record<string, string>): string {
  return findColumn(row,
    "WO_CANCEL_CODE", "Cancel_Code", "Cancel Code", "CancelCode",
    "wo_cancel_code", "CANCEL_CODE", "cancel_code"
  );
}

export function getCancelCodeDesc(row: Record<string, string>): string {
  return findColumn(row,
    "WO_CANCEL_CODE_DESC", "Cancel_Code_Desc", "Cancel Code Description",
    "wo_cancel_code_desc", "CANCEL_REASON", "Cancel Reason", "cancel_reason"
  );
}

export function getInternetMdm(row: Record<string, string>): string {
  return findColumn(row,
    "WO_INTERNET_MDM", "Internet_Mdm", "Internet MDM", "InternetMdm",
    "wo_internet_mdm", "INTERNET_SPEED", "Internet Speed", "internet_speed",
    "SPEED_TIER", "Speed Tier", "speed_tier"
  );
}

export function getSalesmanNumber(row: Record<string, string>): string {
  return findColumn(row,
    "SALESMAN_NBR", "Salesman_Nbr", "Salesman Number", "SalesmanNumber",
    "salesman_nbr", "SALES_NBR", "sales_nbr", "REP_NBR", "rep_nbr"
  );
}

export function getOffice(row: Record<string, string>): string {
  return findColumn(row,
    "OFFICE", "Office", "office", "BRANCH", "Branch", "branch",
    "LOCATION", "Location", "location"
  );
}

export function getDataInstallsQty(row: Record<string, string>): string {
  return findColumn(row,
    "DATA_INSTALLS_QTY", "Data_Installs_Qty", "Data Installs", "data_installs_qty",
    "DATA_QTY", "data_qty", "DataInstalls", "INTERNET_INSTALLS_QTY"
  ).trim();
}

export function getMobileInstallsQty(row: Record<string, string>): string {
  return findColumn(row,
    "MOBILE_INSTALLS_QTY", "Mobile_Installs_Qty", "Mobile Installs", "mobile_installs_qty",
    "MOBILE_QTY", "mobile_qty", "MobileInstalls"
  ).trim();
}

export function getVideoInstallsQty(row: Record<string, string>): string {
  return findColumn(row,
    "VIDEO_INSTALLS_QTY", "Video_Installs_Qty", "Video Installs", "video_installs_qty",
    "VIDEO_QTY", "video_qty", "VideoInstalls"
  ).trim();
}

export function getWorkOrderType(row: Record<string, string>): string {
  return findColumn(row,
    "WORK_ORDER_TYPE", "Work_Order_Type", "Work Order Type", "WorkOrderType",
    "work_order_type", "WO_TYPE", "wo_type", "ORDER_TYPE", "Order Type",
    "order_type", "OrderType"
  ).trim().toUpperCase();
}

export function isSheetRowMobile(row: Record<string, string>): boolean {
  const mobileQty = findColumn(row,
    "MOBILE_INSTALLS_QTY", "Mobile_Installs_Qty", "Mobile Installs", "mobile_installs_qty",
    "MOBILE_QTY", "mobile_qty", "MobileInstalls"
  ).trim();
  const dataQty = findColumn(row,
    "DATA_INSTALLS_QTY", "Data_Installs_Qty", "Data Installs", "data_installs_qty",
    "DATA_QTY", "data_qty", "DataInstalls", "INTERNET_INSTALLS_QTY"
  ).trim();
  const hasMobile = mobileQty !== "" && mobileQty !== "0";
  const hasData = dataQty !== "" && dataQty !== "0";
  return hasMobile && !hasData;
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
  confidenceTier: "definitive" | "high" | "medium" | "low";
}

function scoreMatch(row: Record<string, string>, order: OrderSummary, ctx: CarrierContext | null = null): ScoreBreakdown {
  const reasons: string[] = [];

  const sheetName = extractField(row, "customer_name", ctx, getCustomerName);
  const nameScore = nameTokenMatch(sheetName, order.customerName);
  if (nameScore >= 0.9) reasons.push("Strong name match");
  else if (nameScore >= 0.7) reasons.push("Good name match");
  else if (nameScore >= 0.5) reasons.push("Partial name match");

  const sheetAddr = extractField(row, "address", ctx, getAddress);
  const orderAddr = [order.houseNumber, order.streetName, order.aptUnit].filter(Boolean).join(" ");
  const addressScore = addressSimilarity(sheetAddr, orderAddr);
  if (addressScore >= 0.7) reasons.push("Address matched");
  else if (addressScore >= 0.4) reasons.push("Partial address match");

  const sheetCity = normalize(extractField(row, "city", ctx, getCity));
  const orderCity = normalize(order.city || "");
  const cityScore = sheetCity && orderCity ? similarity(sheetCity, orderCity) : 0;
  if (cityScore >= 0.8) reasons.push("City matched");

  const sheetZip = extractField(row, "zip", ctx, getZip).replace(/\D/g, "").slice(0, 5);
  const orderZip = (order.zipCode || "").replace(/\D/g, "").slice(0, 5);
  const zipScore = sheetZip && orderZip && sheetZip === orderZip ? 1 : 0;
  if (zipScore > 0) reasons.push("ZIP matched");

  let repScore = 0;
  let repMappedDeterministic = false;
  const salesmanNbr = extractField(row, "salesman_number", ctx, getSalesmanNumber).trim().toUpperCase();
  if (ctx && salesmanNbr && ctx.repMappings.has(salesmanNbr)) {
    const mappedUser = ctx.repMappings.get(salesmanNbr)!;
    const orderRepId = order.repId || "";
    if (orderRepId && mappedUser.repId === orderRepId) {
      repScore = 1.0;
      repMappedDeterministic = true;
      reasons.push(`Rep confirmed via carrier ID ${salesmanNbr} → ${mappedUser.userName}`);
    } else {
      const orderRep = normalize(order.repName || "");
      const mappedNorm = normalize(mappedUser.userName);
      if (mappedNorm && orderRep && nameTokenMatch(mappedNorm, orderRep) >= 0.7) {
        repScore = 1.0;
        repMappedDeterministic = true;
        reasons.push(`Rep mapped via carrier ID ${salesmanNbr} → ${mappedUser.userName}`);
      }
    }
  }
  const sheetRepRaw = extractField(row, "rep_name", ctx, getRepName);
  if (repScore === 0) {
    const sheetRep = normalize(sheetRepRaw);
    const orderRep = normalize(order.repName || "");
    if (sheetRep && orderRep) {
      repScore = nameTokenMatch(sheetRep, orderRep);
      if (repScore >= 0.7) reasons.push("Rep name matched");
    }
  }

  const sheetAcct = normalize(extractField(row, "account_number", ctx, getAccountNumber));
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
  if (acctScore === 1) {
    total = nameScore >= 0.4 ? 97 : 95;
    reasons.unshift(nameScore >= 0.4 ? "Definitive: account + name match" : "Account number exact match");
  } else {
    const hasAddr = sheetAddr.length > 0;
    const hasCity = sheetCity.length > 0;
    const hasZip = sheetZip.length > 0;
    const hasRep = sheetRepRaw.length > 0;
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

  let confidenceTier: "definitive" | "high" | "medium" | "low" = "low";
  if (acctScore === 1) confidenceTier = nameScore >= 0.4 ? "definitive" : "high";
  else if (addressScore >= 0.7 && nameScore >= 0.7 && repScore >= 0.7) confidenceTier = "high";
  else if (nameScore >= 0.5 && addressScore >= 0.4) confidenceTier = "medium";

  return { nameScore, addressScore, cityScore, zipScore, repScore, acctScore, total, reasons, confidenceTier };
}

export function determineServiceLine(row: Record<string, string>, ctx: CarrierContext | null = null): string {
  const dataQty = extractField(row, "data_installs_qty", ctx, getDataInstallsQty).trim();
  const videoQty = extractField(row, "video_installs_qty", ctx, getVideoInstallsQty).trim();
  const mobileQty = extractField(row, "mobile_installs_qty", ctx, getMobileInstallsQty).trim();
  const hasData = dataQty !== "" && dataQty !== "0";
  const hasVideo = videoQty !== "" && videoQty !== "0";
  const hasMobile = mobileQty !== "" && mobileQty !== "0";
  if (hasMobile && !hasData && !hasVideo) return "MOBILE";
  if (hasVideo && !hasData && !hasMobile) return "TV";
  if (hasData) return "INTERNET";
  return "INTERNET";
}

export function normalizeWoStatus(row: Record<string, string>, ctx: CarrierContext | null = null): string {
  const raw = extractField(row, "wo_status", ctx, getWoStatus).trim().toUpperCase();
  if (ctx && Object.keys(ctx.statusCodeMap).length > 0) {
    return ctx.statusCodeMap[raw] || ctx.statusCodeMap[raw.toUpperCase()] || raw;
  }
  const statusMap: Record<string, string> = {
    "CP": "CP", "COMPLETED": "CP", "CONNECTED": "CP", "INSTALLED": "CP", "DONE": "CP",
    "CN": "CN", "CANCELED": "CN", "CANCELLED": "CN",
    "OP": "OP", "OPEN": "OP", "IN PROGRESS": "OP", "ACTIVE": "OP",
    "ND": "ND", "NO DISPATCH": "ND", "NO_DISPATCH": "ND",
    "PENDING": "OP", "SCHEDULED": "OP",
  };
  return statusMap[raw] || raw;
}

const MATCH_THRESHOLD = 45;

export interface DedupEntry {
  syncRunId: string;
  matchedOrderId: string;
  woStatus?: string;
  rowHash?: string;
  processedWoId?: string;
}

export type RowClassification = "new" | "changed" | "unchanged";

export function computeRowHash(row: Record<string, string>, ctx: CarrierContext | null): string {
  const wo = extractField(row, "work_order_number", ctx, getWorkOrderNumber).trim().toUpperCase();
  const status = extractField(row, "wo_status", ctx, getWoStatus).trim().toUpperCase();
  const checkIn = extractField(row, "check_in_date", ctx, getCheckInDate).trim();
  return `${wo}|${status}|${checkIn}`;
}

export interface MatchProgressCallback {
  (processedRows: number, totalRows: number): Promise<void>;
}

interface OrderIndex {
  byZip: Map<string, OrderSummary[]>;
  byAccount: Map<string, OrderSummary[]>;
  byNameToken: Map<string, OrderSummary[]>;
  all: OrderSummary[];
}

function buildOrderIndex(orders: OrderSummary[]): OrderIndex {
  const byZip = new Map<string, OrderSummary[]>();
  const byAccount = new Map<string, OrderSummary[]>();
  const byNameToken = new Map<string, OrderSummary[]>();

  for (const order of orders) {
    const zip = (order.zipCode || "").replace(/\D/g, "").slice(0, 5);
    if (zip) {
      const arr = byZip.get(zip) || [];
      arr.push(order);
      byZip.set(zip, arr);
    }

    const acctNorm = normalize(order.accountNumber || "");
    if (acctNorm) {
      const arr = byAccount.get(acctNorm) || [];
      arr.push(order);
      byAccount.set(acctNorm, arr);
    }
    const invNorm = normalize(order.invoiceNumber || "");
    if (invNorm) {
      const arr = byAccount.get(invNorm) || [];
      arr.push(order);
      byAccount.set(invNorm, arr);
    }

    const nameTokens = normalize(order.customerName).split(" ").filter(t => t.length >= 3);
    for (const token of nameTokens) {
      const arr = byNameToken.get(token) || [];
      arr.push(order);
      byNameToken.set(token, arr);
    }
  }

  return { byZip, byAccount, byNameToken, all: orders };
}

function getCandidateOrders(row: Record<string, string>, ctx: CarrierContext | null, index: OrderIndex): OrderSummary[] {
  const candidateIds = new Set<string>();
  const candidates: OrderSummary[] = [];

  const sheetAcct = normalize(extractField(row, "account_number", ctx, getAccountNumber));
  if (sheetAcct) {
    const acctMatches = index.byAccount.get(sheetAcct);
    if (acctMatches) {
      for (const o of acctMatches) {
        if (!candidateIds.has(o.id)) {
          candidateIds.add(o.id);
          candidates.push(o);
        }
      }
    }
  }

  const sheetZip = extractField(row, "zip", ctx, getZip).replace(/\D/g, "").slice(0, 5);
  if (sheetZip) {
    const zipMatches = index.byZip.get(sheetZip);
    if (zipMatches) {
      for (const o of zipMatches) {
        if (!candidateIds.has(o.id)) {
          candidateIds.add(o.id);
          candidates.push(o);
        }
      }
    }
  }

  const sheetName = extractField(row, "customer_name", ctx, getCustomerName);
  const nameTokens = normalize(sheetName).split(" ").filter(t => t.length >= 3);
  for (const token of nameTokens) {
    const nameMatches = index.byNameToken.get(token);
    if (nameMatches) {
      for (const o of nameMatches) {
        if (!candidateIds.has(o.id)) {
          candidateIds.add(o.id);
          candidates.push(o);
        }
      }
    }
  }

  if (candidates.length === 0) {
    return index.all;
  }

  return candidates;
}

export async function matchInstallationsToOrders(
  sheetRows: SheetRow[],
  orders: OrderSummary[],
  carrierCtx: CarrierContext | null = null,
  processedWoMap?: Map<string, DedupEntry>,
  incrementalOnly: boolean = false,
  options?: {
    onProgress?: MatchProgressCallback;
    progressInterval?: number;
    timeoutMs?: number;
  },
): Promise<MatchingResponse> {
  const progressInterval = options?.progressInterval ?? 50;
  const timeoutMs = options?.timeoutMs ?? 30 * 60 * 1000;
  const startTime = Date.now();

  if (sheetRows.length === 0) {
    return { matches: [], unmatched: [], dedupSkipped: [], summary: "No installation records to match.", rowClassifications: { new: 0, changed: 0, unchanged: 0 } };
  }

  const matchableRows: SheetRow[] = [];
  const skippedRows: { rowIndex: number; data: Record<string, string>; reason: string }[] = [];
  const dedupSkipped: MatchingResponse["dedupSkipped"] = [];
  const validStatuses = new Set(["CP", "CN", "OP", "ND", "COMPLETED", "CONNECTED", "OPEN", "NO DISPATCH", "CANCELED", "CANCELLED", "INSTALLED", "ACTIVE", "PENDING", "SCHEDULED", "IN PROGRESS", "DONE"]);
  const rowClassifications = { new: 0, changed: 0, unchanged: 0 };

  for (const row of sheetRows) {
    const woNumber = extractField(row.data, "work_order_number", carrierCtx, getWorkOrderNumber).trim();
    if (woNumber && processedWoMap) {
      const prev = processedWoMap.get(woNumber.toUpperCase());
      if (prev) {
        const currentStatus = normalizeWoStatus(row.data, carrierCtx);
        const currentHash = computeRowHash(row.data, carrierCtx);
        const statusChanged = prev.woStatus && prev.woStatus !== currentStatus;
        const hashChanged = prev.rowHash && prev.rowHash !== currentHash;

        const missingPriorData = !prev.woStatus && !prev.rowHash;
        if (statusChanged || hashChanged || missingPriorData) {
          rowClassifications.changed++;
          matchableRows.push(row);
        } else {
          rowClassifications.unchanged++;
          if (incrementalOnly) {
            dedupSkipped.push({
              rowIndex: row.rowIndex,
              data: row.data,
              workOrderNumber: woNumber,
              previousSyncRunId: prev.syncRunId,
              matchedOrderId: prev.matchedOrderId,
              classification: "unchanged" as const,
            });
          } else {
            matchableRows.push(row);
          }
        }
        continue;
      }
    }

    const woStatus = extractField(row.data, "wo_status", carrierCtx, getWoStatus).trim().toUpperCase();
    if (!woStatus || validStatuses.has(woStatus)) {
      rowClassifications.new++;
      matchableRows.push(row);
    } else {
      skippedRows.push({ rowIndex: row.rowIndex, data: row.data, reason: `Skipped: status is '${woStatus}' (not a recognized status)` });
    }
  }

  const statusCounts: Record<string, number> = {};
  for (const r of matchableRows) {
    const s = extractField(r.data, "wo_status", carrierCtx, getWoStatus).trim().toUpperCase() || "EMPTY";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }
  const statusStr = Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(", ");

  console.log(`[Install Sync] Filtered: ${matchableRows.length} matchable (${statusStr}), ${skippedRows.length} skipped, ${dedupSkipped.length} dedup-skipped out of ${sheetRows.length} total rows`);

  if (matchableRows.length > 0) {
    const sampleRow = matchableRows[0].data;
    const detectedCols = {
      name: extractField(sampleRow, "customer_name", carrierCtx, getCustomerName) ? "found" : "MISSING",
      address: extractField(sampleRow, "address", carrierCtx, getAddress) ? "found" : "MISSING",
      city: extractField(sampleRow, "city", carrierCtx, getCity) ? "found" : "MISSING",
      zip: extractField(sampleRow, "zip", carrierCtx, getZip) ? "found" : "MISSING",
      rep: extractField(sampleRow, "rep_name", carrierCtx, getRepName) ? "found" : "MISSING",
      acct: extractField(sampleRow, "account_number", carrierCtx, getAccountNumber) ? "found" : "MISSING",
    };
    console.log(`[Install Sync] Column detection: ${JSON.stringify(detectedCols)}`);
    console.log(`[Install Sync] Available headers: ${Object.keys(sampleRow).join(", ")}`);
  }

  if (matchableRows.length === 0) {
    return { matches: [], unmatched: skippedRows, dedupSkipped, summary: `No matchable installation records found. ${skippedRows.length} rows skipped. ${dedupSkipped.length} previously synced.`, rowClassifications };
  }

  if (orders.length === 0) {
    return {
      matches: [],
      unmatched: [
        ...matchableRows.map(r => ({ rowIndex: r.rowIndex, data: r.data, reason: "No pending orders in the system to match against." })),
        ...skippedRows,
      ],
      dedupSkipped,
      summary: "No pending orders available for matching.",
      rowClassifications,
    };
  }

  console.log(`[Install Sync] Matching ${matchableRows.length} sheet rows against ${orders.length} orders (threshold: ${MATCH_THRESHOLD}%)`);

  const orderIndex = buildOrderIndex(orders);

  const candidates: { rowIndex: number; data: Record<string, string>; orderId: string; score: ScoreBreakdown; serviceLine: string; woNumber: string; woType: string }[] = [];
  const rowBestScores = new Map<number, { score: number; reasons: string[] }>();
  let processedCount = 0;
  let timedOut = false;

  for (const row of matchableRows) {
    if (Date.now() - startTime > timeoutMs) {
      timedOut = true;
      console.warn(`[Install Sync] Timeout after ${Math.round((Date.now() - startTime) / 1000)}s at row ${processedCount}/${matchableRows.length}`);
      break;
    }

    const serviceLine = determineServiceLine(row.data, carrierCtx);
    const woNumber = extractField(row.data, "work_order_number", carrierCtx, getWorkOrderNumber).trim();
    const woType = extractField(row.data, "work_order_type", carrierCtx, getWorkOrderType).trim().toUpperCase();

    const candidateOrders = getCandidateOrders(row.data, carrierCtx, orderIndex);

    let rowBest = 0;
    let rowBestReasons: string[] = [];

    for (const order of candidateOrders) {
      const score = scoreMatch(row.data, order, carrierCtx);
      if (score.total > rowBest) {
        rowBest = score.total;
        rowBestReasons = score.reasons;
      }
      if (score.total >= MATCH_THRESHOLD) {
        candidates.push({ rowIndex: row.rowIndex, data: row.data, orderId: order.id, score, serviceLine, woNumber, woType });
      }
    }

    if (rowBest < MATCH_THRESHOLD && candidateOrders !== orderIndex.all && orderIndex.all.length > candidateOrders.length) {
      const candidateIdSet = new Set(candidateOrders.map(o => o.id));
      for (const order of orderIndex.all) {
        if (candidateIdSet.has(order.id)) continue;
        const score = scoreMatch(row.data, order, carrierCtx);
        if (score.total > rowBest) {
          rowBest = score.total;
          rowBestReasons = score.reasons;
        }
        if (score.total >= MATCH_THRESHOLD) {
          candidates.push({ rowIndex: row.rowIndex, data: row.data, orderId: order.id, score, serviceLine, woNumber, woType });
        }
      }
    }

    rowBestScores.set(row.rowIndex, { score: rowBest, reasons: rowBestReasons });

    processedCount++;
    if (options?.onProgress && processedCount % progressInterval === 0) {
      await options.onProgress(processedCount, matchableRows.length);
    }
  }

  if (options?.onProgress && !timedOut) {
    await options.onProgress(processedCount, matchableRows.length);
  }

  candidates.sort((a, b) => b.score.total - a.score.total);

  const usedRowIndices = new Set<number>();
  const orderServiceLineUsed = new Map<string, Set<string>>();
  const validMatches: MatchResult[] = [];
  const orderMap = new Map(orders.map(o => [o.id, o]));

  for (const c of candidates) {
    if (usedRowIndices.has(c.rowIndex)) continue;
    const order = orderMap.get(c.orderId);
    if (!order) continue;

    const orderServiceLines = orderServiceLineUsed.get(c.orderId) || new Set();
    if (orderServiceLines.has(c.serviceLine)) continue;

    usedRowIndices.add(c.rowIndex);
    orderServiceLines.add(c.serviceLine);
    orderServiceLineUsed.set(c.orderId, orderServiceLines);

    const isUpgrade = c.woType === "UP";

    validMatches.push({
      sheetRowIndex: c.rowIndex,
      sheetData: c.data,
      orderId: order.id,
      orderInvoice: order.invoiceNumber,
      orderCustomerName: order.customerName,
      confidence: Math.min(100, c.score.total),
      reasoning: c.score.reasons.join("; ") || "Matched by deterministic scoring",
      scoreBreakdown: {
        nameScore: Math.round(c.score.nameScore * 100),
        addressScore: Math.round(c.score.addressScore * 100),
        cityScore: Math.round(c.score.cityScore * 100),
        zipScore: Math.round(c.score.zipScore * 100),
        repScore: Math.round(c.score.repScore * 100),
        acctScore: Math.round(c.score.acctScore * 100),
        confidenceTier: c.score.confidenceTier,
      },
      serviceLineType: c.serviceLine,
      workOrderNumber: c.woNumber || undefined,
      isUpgrade,
    });
  }

  const unmatchedRows = matchableRows
    .filter(r => !usedRowIndices.has(r.rowIndex))
    .map(r => {
      const cached = rowBestScores.get(r.rowIndex);
      const bestScore = cached?.score ?? 0;
      const bestReasons = cached?.reasons ?? [];
      const customerName = extractField(r.data, "customer_name", carrierCtx, getCustomerName);
      const addr = extractField(r.data, "address", carrierCtx, getAddress);
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
  const elapsedSec = Math.round((Date.now() - startTime) / 1000);

  console.log(`[Install Sync] Done in ${elapsedSec}s: ${validMatches.length} matched, ${unmatchedRows.length} unmatched, ${skippedRows.length} skipped, ${dedupSkipped.length} dedup-skipped (new:${rowClassifications.new} changed:${rowClassifications.changed} unchanged:${rowClassifications.unchanged})${timedOut ? " [TIMED OUT]" : ""}`);

  const timeoutNote = timedOut ? ` (timed out after ${elapsedSec}s, processed ${processedCount}/${matchableRows.length} rows)` : "";

  return {
    matches: validMatches,
    unmatched: allUnmatched,
    dedupSkipped,
    summary: `Matched ${validMatches.length} of ${matchableRows.length} records. ${skippedRows.length} rows skipped. ${dedupSkipped.length} previously synced (dedup).${timeoutNote}`,
    rowClassifications,
  };
}
