import { db } from "./db";
import { 
  quickbooksConnection, 
  quickbooksAccountMappings, 
  quickbooksSyncLog,
  salesOrders,
  payRuns,
  payStatements,
  clients,
  providers,
  users
} from "@shared/schema";
import { eq, and, isNull, desc, inArray, sql } from "drizzle-orm";
import crypto from "crypto";

const QB_OAUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_API_BASE = "https://quickbooks.api.intuit.com";
const QB_SANDBOX_API_BASE = "https://sandbox-quickbooks.api.intuit.com";
const QB_API_MINOR_VERSION = "65";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 10000];
const TOKEN_REFRESH_BUFFER_MINUTES = 5;

let tokenRefreshInProgress: Promise<string | null> | null = null;

interface QBAuditLog {
  action: string;
  entityType: string;
  entityId?: string;
  endpoint: string;
  method: string;
  requestPayload?: string;
  responseStatus?: number;
  responsePayload?: string;
  errorMessage?: string;
  duration?: number;
  userId?: string;
  idempotencyKey?: string;
}

const auditLogs: QBAuditLog[] = [];

function generateIdempotencyKey(entityType: string, entityId: string, action: string): string {
  const dateKey = new Date().toISOString().split('T')[0];
  return crypto.createHash('sha256')
    .update(`${entityType}:${entityId}:${action}:${dateKey}`)
    .digest('hex')
    .substring(0, 32);
}

async function logQBApiCall(log: QBAuditLog): Promise<void> {
  auditLogs.push({ ...log, ...{ timestamp: new Date().toISOString() } } as any);
  if (auditLogs.length > 1000) auditLogs.shift();
  
  console.log(`[QB API] ${log.method} ${log.endpoint} - ${log.responseStatus || 'pending'} (${log.duration || 0}ms)`);
}

export function getQBAuditLogs(limit = 100): QBAuditLog[] {
  return auditLogs.slice(-limit).reverse();
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries = MAX_RETRIES,
  entityType?: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      const isRetryable = error.message?.includes('rate limit') || 
                          error.message?.includes('timeout') ||
                          error.message?.includes('ETIMEDOUT') ||
                          error.message?.includes('ECONNRESET') ||
                          (error.status >= 500 && error.status < 600);
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
      console.log(`[QB] Retrying ${entityType || 'operation'} in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

interface QBConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox" | "production";
}

interface QBTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

interface QBInvoiceLineItem {
  Description: string;
  Amount: number;
  DetailType: "SalesItemLineDetail";
  SalesItemLineDetail: {
    ItemRef?: { value: string; name: string };
    Qty: number;
    UnitPrice: number;
  };
}

interface QBJournalEntryLine {
  Description: string;
  Amount: number;
  DetailType: "JournalEntryLineDetail";
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { value: string; name?: string };
  };
}

function getConfig(): QBConfig {
  const clientId = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri = process.env.QB_REDIRECT_URI || `${process.env.REPLIT_DEV_DOMAIN || "http://localhost:5000"}/api/quickbooks/callback`;
  const environment = (process.env.QB_ENVIRONMENT || "sandbox") as "sandbox" | "production";

  if (!clientId || !clientSecret) {
    throw new Error("QuickBooks credentials not configured. Please set QB_CLIENT_ID and QB_CLIENT_SECRET.");
  }

  return { clientId, clientSecret, redirectUri, environment };
}

function getApiBase(environment: "sandbox" | "production"): string {
  return environment === "production" ? QB_API_BASE : QB_SANDBOX_API_BASE;
}

export function getAuthorizationUrl(state: string): string {
  const config = getConfig();
  const scopes = "com.intuit.quickbooks.accounting";
  
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes,
    state,
  });

  return `${QB_OAUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string, realmId: string, userId: string): Promise<void> {
  console.log("exchangeCodeForTokens called with:", { realmId, userId });
  const config = getConfig();
  
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  
  const response = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${error}`);
  }

  const tokens: QBTokenResponse = await response.json();
  
  const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const refreshTokenExpiresAt = new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000);

  const companyInfo = await fetchCompanyInfo(tokens.access_token, realmId, config.environment);

  const existing = await db.query.quickbooksConnection.findFirst();
  console.log("Existing connection:", existing ? "found" : "none");
  console.log("Attempting to save connection for userId:", userId);
  
  // Verify the user exists before attempting to use the foreign key
  const userCheck = await db.query.users.findFirst({
    where: eq(users.id, userId)
  });
  console.log("User check result:", userCheck ? `found: ${userCheck.repId}` : "NOT FOUND");
  
  const connectedBy = userCheck ? userId : null;
  
  if (existing) {
    console.log("Updating existing connection");
    await db.update(quickbooksConnection)
      .set({
        realmId,
        companyName: companyInfo?.CompanyName || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        isConnected: true,
        connectedByUserId: connectedBy,
        updatedAt: new Date(),
      })
      .where(eq(quickbooksConnection.id, existing.id));
    console.log("Update successful");
  } else {
    console.log("Inserting new connection");
    try {
      await db.insert(quickbooksConnection).values({
        realmId,
        companyName: companyInfo?.CompanyName || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        isConnected: true,
        connectedByUserId: connectedBy,
      });
      console.log("Insert successful");
    } catch (insertError: any) {
      console.error("Insert error:", insertError.message);
      console.error("Insert error details:", insertError);
      throw insertError;
    }
  }
}

async function fetchCompanyInfo(accessToken: string, realmId: string, environment: "sandbox" | "production"): Promise<any> {
  const apiBase = getApiBase(environment);
  
  try {
    const response = await fetch(
      `${apiBase}/v3/company/${realmId}/companyinfo/${realmId}`,
      {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/json",
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.CompanyInfo;
    }
  } catch (error) {
    console.error("Failed to fetch company info:", error);
  }
  return null;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (tokenRefreshInProgress) {
    return tokenRefreshInProgress;
  }
  
  tokenRefreshInProgress = (async () => {
    try {
      const connection = await db.query.quickbooksConnection.findFirst();
      
      if (!connection) {
        return null;
      }

      const bufferMs = TOKEN_REFRESH_BUFFER_MINUTES * 60 * 1000;
      const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
      const now = Date.now();
      
      if (now + bufferMs < expiresAt) {
        return connection.accessToken;
      }

      if (now > new Date(connection.refreshTokenExpiresAt).getTime()) {
        await db.update(quickbooksConnection)
          .set({ isConnected: false, updatedAt: new Date() })
          .where(eq(quickbooksConnection.id, connection.id));
        throw new Error("QuickBooks refresh token expired. Please reconnect.");
      }

      console.log("[QB] Proactively refreshing access token...");
      
      const config = getConfig();
      const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

      const response = await fetch(QB_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${auth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: connection.refreshToken,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        await db.update(quickbooksConnection)
          .set({ isConnected: false, updatedAt: new Date() })
          .where(eq(quickbooksConnection.id, connection.id));
        throw new Error(`Failed to refresh token: ${error}`);
      }

      const tokens: QBTokenResponse = await response.json();
      
      const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const refreshTokenExpiresAt = new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000);

      await db.update(quickbooksConnection)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(quickbooksConnection.id, connection.id));

      console.log("[QB] Access token refreshed successfully");
      return tokens.access_token;
    } finally {
      tokenRefreshInProgress = null;
    }
  })();
  
  return tokenRefreshInProgress;
}

export async function getConnection() {
  return db.query.quickbooksConnection.findFirst();
}

export async function disconnectQuickBooks(): Promise<void> {
  const connection = await db.query.quickbooksConnection.findFirst();
  if (connection) {
    await db.update(quickbooksConnection)
      .set({ isConnected: false, updatedAt: new Date() })
      .where(eq(quickbooksConnection.id, connection.id));
  }
}

export async function getAccountMappings() {
  return db.select().from(quickbooksAccountMappings).where(eq(quickbooksAccountMappings.isActive, true));
}

export async function fetchQBAccounts(): Promise<any[]> {
  const accessToken = await refreshAccessToken();
  if (!accessToken) throw new Error("QuickBooks not connected");

  const connection = await db.query.quickbooksConnection.findFirst();
  if (!connection) throw new Error("QuickBooks not connected");

  const config = getConfig();
  const apiBase = getApiBase(config.environment);

  const query = "SELECT * FROM Account WHERE Active = true MAXRESULTS 1000";
  const response = await fetch(
    `${apiBase}/v3/company/${connection.realmId}/query?query=${encodeURIComponent(query)}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch accounts: ${error}`);
  }

  const data = await response.json();
  return data.QueryResponse?.Account || [];
}

export async function saveAccountMapping(mappingType: string, qbAccountId: string, qbAccountName: string, qbAccountType: string): Promise<void> {
  const existing = await db.query.quickbooksAccountMappings.findFirst({
    where: eq(quickbooksAccountMappings.mappingType, mappingType),
  });

  if (existing) {
    await db.update(quickbooksAccountMappings)
      .set({
        qbAccountId,
        qbAccountName,
        qbAccountType,
        updatedAt: new Date(),
      })
      .where(eq(quickbooksAccountMappings.id, existing.id));
  } else {
    await db.insert(quickbooksAccountMappings).values({
      mappingType,
      qbAccountId,
      qbAccountName,
      qbAccountType,
    });
  }
}

export async function syncInvoiceToQuickBooks(orderId: string, userId: string): Promise<{ success: boolean; qbInvoiceId?: string; error?: string }> {
  try {
    const accessToken = await refreshAccessToken();
    if (!accessToken) throw new Error("QuickBooks not connected");

    const connection = await db.query.quickbooksConnection.findFirst();
    if (!connection) throw new Error("QuickBooks not connected");

    const order = await db.query.salesOrders.findFirst({
      where: eq(salesOrders.id, orderId),
      with: {
        client: true,
        provider: true,
        service: true,
      },
    });

    if (!order) throw new Error("Order not found");
    if (order.approvalStatus !== "APPROVED") throw new Error("Order must be approved before syncing");

    const config = getConfig();
    const apiBase = getApiBase(config.environment);

    const lineItems: QBInvoiceLineItem[] = [{
      Description: `${order.provider?.name || "Provider"} - ${order.service?.name || "Service"} - ${order.customerName}`,
      Amount: parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        Qty: 1,
        UnitPrice: parseFloat(order.baseCommissionEarned) + parseFloat(order.incentiveEarned),
      },
    }];

    const invoiceData = {
      DocNumber: order.invoiceNumber,
      CustomerRef: { value: "1" },
      Line: lineItems,
      PrivateNote: `Iron Crest Order ID: ${order.id}`,
    };

    await db.insert(quickbooksSyncLog).values({
      entityType: "INVOICE",
      entityId: orderId,
      action: "CREATE",
      status: "PENDING",
      requestPayload: JSON.stringify(invoiceData),
      createdByUserId: userId,
    });

    let response: Response;
    let qbInvoiceId: string;

    if (order.qbInvoiceId) {
      const existingInvoice = await fetch(
        `${apiBase}/v3/company/${connection.realmId}/invoice/${order.qbInvoiceId}`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        }
      );
      
      if (existingInvoice.ok) {
        const existing = await existingInvoice.json();
        response = await fetch(
          `${apiBase}/v3/company/${connection.realmId}/invoice`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify({
              ...invoiceData,
              Id: order.qbInvoiceId,
              SyncToken: existing.Invoice.SyncToken,
            }),
          }
        );
      } else {
        response = await fetch(
          `${apiBase}/v3/company/${connection.realmId}/invoice`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify(invoiceData),
          }
        );
      }
    } else {
      response = await fetch(
        `${apiBase}/v3/company/${connection.realmId}/invoice`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(invoiceData),
        }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      
      await db.update(quickbooksSyncLog)
        .set({
          status: "FAILED",
          errorMessage: errorText,
          lastAttemptAt: new Date(),
        })
        .where(and(
          eq(quickbooksSyncLog.entityType, "INVOICE"),
          eq(quickbooksSyncLog.entityId, orderId),
          eq(quickbooksSyncLog.status, "PENDING")
        ));

      await db.update(salesOrders)
        .set({
          qbInvoiceSyncStatus: "FAILED",
          qbInvoiceSyncError: errorText,
          updatedAt: new Date(),
        })
        .where(eq(salesOrders.id, orderId));

      return { success: false, error: errorText };
    }

    const result = await response.json();
    qbInvoiceId = result.Invoice.Id;

    await db.update(salesOrders)
      .set({
        qbInvoiceId,
        qbInvoiceSyncStatus: "SYNCED",
        qbInvoiceSyncedAt: new Date(),
        qbInvoiceSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, orderId));

    await db.update(quickbooksSyncLog)
      .set({
        status: "SYNCED",
        qbEntityId: qbInvoiceId,
        qbDocNumber: order.invoiceNumber,
        responsePayload: JSON.stringify(result),
        syncedAt: new Date(),
        lastAttemptAt: new Date(),
      })
      .where(and(
        eq(quickbooksSyncLog.entityType, "INVOICE"),
        eq(quickbooksSyncLog.entityId, orderId),
        eq(quickbooksSyncLog.status, "PENDING")
      ));

    return { success: true, qbInvoiceId };
  } catch (error: any) {
    console.error("Invoice sync error:", error);
    
    await db.update(salesOrders)
      .set({
        qbInvoiceSyncStatus: "FAILED",
        qbInvoiceSyncError: error.message,
        updatedAt: new Date(),
      })
      .where(eq(salesOrders.id, orderId));

    return { success: false, error: error.message };
  }
}

export async function postPayRunJournalEntry(payRunId: string, userId: string): Promise<{ success: boolean; qbJournalEntryId?: string; error?: string }> {
  try {
    const accessToken = await refreshAccessToken();
    if (!accessToken) throw new Error("QuickBooks not connected");

    const connection = await db.query.quickbooksConnection.findFirst();
    if (!connection) throw new Error("QuickBooks not connected");

    const payRun = await db.query.payRuns.findFirst({
      where: eq(payRuns.id, payRunId),
    });

    if (!payRun) throw new Error("Pay run not found");
    if (payRun.status !== "FINALIZED") throw new Error("Pay run must be finalized before posting");

    const mappings = await getAccountMappings();
    const commissionExpenseAccount = mappings.find(m => m.mappingType === "COMMISSION_EXPENSE");
    const apAccount = mappings.find(m => m.mappingType === "ACCOUNTS_PAYABLE");

    if (!commissionExpenseAccount || !apAccount) {
      throw new Error("Account mappings not configured. Please set up Commission Expense and Accounts Payable accounts.");
    }

    const payStatementsResult = await db.query.payStatements.findMany({
      where: eq(payStatements.payRunId, payRunId),
      with: { user: true },
    });

    let totalCommission = 0;
    const lineDescriptions: string[] = [];

    for (const stmt of payStatementsResult) {
      const gross = parseFloat(stmt.grossCommission) + parseFloat(stmt.overrideEarningsTotal) + parseFloat(stmt.incentivesTotal);
      totalCommission += gross;
      lineDescriptions.push(`${stmt.user?.name || "Unknown"}: $${gross.toFixed(2)}`);
    }

    if (totalCommission <= 0) {
      await db.update(payRuns)
        .set({
          qbSyncStatus: "SKIPPED",
          qbSyncError: "No commission to post",
        })
        .where(eq(payRuns.id, payRunId));
      return { success: true };
    }

    const config = getConfig();
    const apiBase = getApiBase(config.environment);

    const journalEntry = {
      DocNumber: `PR-${payRun.weekEndingDate}`,
      TxnDate: payRun.weekEndingDate,
      PrivateNote: `Pay Run: ${payRun.name || payRun.weekEndingDate}\nIron Crest Pay Run ID: ${payRunId}\n${lineDescriptions.join("\n")}`,
      Line: [
        {
          Description: `Commission Expense - Pay Run ${payRun.weekEndingDate}`,
          Amount: totalCommission,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: commissionExpenseAccount.qbAccountId, name: commissionExpenseAccount.qbAccountName },
          },
        },
        {
          Description: `Accounts Payable - Pay Run ${payRun.weekEndingDate}`,
          Amount: totalCommission,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: apAccount.qbAccountId, name: apAccount.qbAccountName },
          },
        },
      ],
    };

    await db.insert(quickbooksSyncLog).values({
      entityType: "JOURNAL_ENTRY",
      entityId: payRunId,
      action: "CREATE",
      status: "PENDING",
      requestPayload: JSON.stringify(journalEntry),
      createdByUserId: userId,
    });

    const response = await fetch(
      `${apiBase}/v3/company/${connection.realmId}/journalentry`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(journalEntry),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      
      await db.update(quickbooksSyncLog)
        .set({
          status: "FAILED",
          errorMessage: errorText,
          lastAttemptAt: new Date(),
        })
        .where(and(
          eq(quickbooksSyncLog.entityType, "JOURNAL_ENTRY"),
          eq(quickbooksSyncLog.entityId, payRunId),
          eq(quickbooksSyncLog.status, "PENDING")
        ));

      await db.update(payRuns)
        .set({
          qbSyncStatus: "FAILED",
          qbSyncError: errorText,
        })
        .where(eq(payRuns.id, payRunId));

      return { success: false, error: errorText };
    }

    const result = await response.json();
    const qbJournalEntryId = result.JournalEntry.Id;

    await db.update(payRuns)
      .set({
        qbJournalEntryId,
        qbSyncStatus: "SYNCED",
        qbSyncedAt: new Date(),
        qbSyncError: null,
      })
      .where(eq(payRuns.id, payRunId));

    await db.update(quickbooksSyncLog)
      .set({
        status: "SYNCED",
        qbEntityId: qbJournalEntryId,
        qbDocNumber: `PR-${payRun.weekEndingDate}`,
        responsePayload: JSON.stringify(result),
        syncedAt: new Date(),
        lastAttemptAt: new Date(),
      })
      .where(and(
        eq(quickbooksSyncLog.entityType, "JOURNAL_ENTRY"),
        eq(quickbooksSyncLog.entityId, payRunId),
        eq(quickbooksSyncLog.status, "PENDING")
      ));

    await db.update(quickbooksConnection)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(quickbooksConnection.id, connection.id));

    return { success: true, qbJournalEntryId };
  } catch (error: any) {
    console.error("Journal entry sync error:", error);
    
    await db.update(payRuns)
      .set({
        qbSyncStatus: "FAILED",
        qbSyncError: error.message,
      })
      .where(eq(payRuns.id, payRunId));

    return { success: false, error: error.message };
  }
}

export async function getSyncLogs(entityType?: string, limit = 50) {
  if (entityType) {
    return db.select()
      .from(quickbooksSyncLog)
      .where(eq(quickbooksSyncLog.entityType, entityType as any))
      .orderBy(quickbooksSyncLog.createdAt)
      .limit(limit);
  }
  return db.select()
    .from(quickbooksSyncLog)
    .orderBy(quickbooksSyncLog.createdAt)
    .limit(limit);
}

export async function retryFailedSync(syncLogId: string, userId: string): Promise<{ success: boolean; error?: string }> {
  const log = await db.query.quickbooksSyncLog.findFirst({
    where: eq(quickbooksSyncLog.id, syncLogId),
  });

  if (!log) return { success: false, error: "Sync log not found" };
  if (log.status !== "FAILED") return { success: false, error: "Only failed syncs can be retried" };

  await db.update(quickbooksSyncLog)
    .set({ 
      retryCount: sql`${quickbooksSyncLog.retryCount} + 1`,
      lastAttemptAt: new Date() 
    })
    .where(eq(quickbooksSyncLog.id, syncLogId));

  if (log.entityType === "INVOICE") {
    return syncInvoiceToQuickBooks(log.entityId, userId);
  } else if (log.entityType === "JOURNAL_ENTRY") {
    return postPayRunJournalEntry(log.entityId, userId);
  }

  return { success: false, error: "Unknown entity type" };
}

export async function getFailedSyncs(limit = 100) {
  return db.select()
    .from(quickbooksSyncLog)
    .where(eq(quickbooksSyncLog.status, "FAILED"))
    .orderBy(desc(quickbooksSyncLog.createdAt))
    .limit(limit);
}

export async function getExceptionQueue(limit = 50) {
  const failedLogs = await db.select()
    .from(quickbooksSyncLog)
    .where(eq(quickbooksSyncLog.status, "FAILED"))
    .orderBy(desc(quickbooksSyncLog.createdAt))
    .limit(limit);

  const enrichedLogs = await Promise.all(failedLogs.map(async (log) => {
    let entityDetails: any = null;
    
    if (log.entityType === "INVOICE") {
      const order = await db.query.salesOrders.findFirst({
        where: eq(salesOrders.id, log.entityId),
        with: { client: true, provider: true },
      });
      if (order) {
        entityDetails = {
          customerName: order.customerName,
          clientName: order.client?.name,
          providerName: order.provider?.name,
          invoiceNumber: order.invoiceNumber,
          dateSold: order.dateSold,
        };
      }
    } else if (log.entityType === "JOURNAL_ENTRY") {
      const payRun = await db.query.payRuns.findFirst({
        where: eq(payRuns.id, log.entityId),
      });
      if (payRun) {
        entityDetails = {
          payRunName: payRun.name,
          weekEndingDate: payRun.weekEndingDate,
          status: payRun.status,
        };
      }
    }

    return { ...log, entityDetails };
  }));

  return enrichedLogs;
}

export async function getReconciliationData() {
  const orders = await db.query.salesOrders.findMany({
    where: eq(salesOrders.approvalStatus, "APPROVED"),
    with: { client: true, provider: true },
    orderBy: [desc(salesOrders.dateSold)],
    limit: 500,
  });

  const payRunsData = await db.query.payRuns.findMany({
    where: eq(payRuns.status, "FINALIZED"),
    orderBy: [desc(payRuns.createdAt)],
    limit: 100,
  });

  const syncLogs = await getSyncLogs(undefined, 200);

  const ordersByStatus = {
    synced: orders.filter(o => o.qbInvoiceSyncStatus === "SYNCED").length,
    failed: orders.filter(o => o.qbInvoiceSyncStatus === "FAILED").length,
    pending: orders.filter(o => !o.qbInvoiceSyncStatus || o.qbInvoiceSyncStatus === "PENDING").length,
    notApplicable: orders.filter(o => o.qbInvoiceSyncStatus === "NOT_APPLICABLE").length,
  };

  const payRunsByStatus = {
    synced: payRunsData.filter(p => p.qbSyncStatus === "SYNCED").length,
    failed: payRunsData.filter(p => p.qbSyncStatus === "FAILED").length,
    pending: payRunsData.filter(p => !p.qbSyncStatus || p.qbSyncStatus === "PENDING").length,
    skipped: payRunsData.filter(p => p.qbSyncStatus === "SKIPPED").length,
  };

  const totalOrdersValue = orders.reduce((sum, o) => {
    return sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned);
  }, 0);

  const syncedOrdersValue = orders
    .filter(o => o.qbInvoiceSyncStatus === "SYNCED")
    .reduce((sum, o) => sum + parseFloat(o.baseCommissionEarned) + parseFloat(o.incentiveEarned), 0);

  const recentFailures = syncLogs.filter(l => l.status === "FAILED").slice(0, 10);

  return {
    orders: ordersByStatus,
    payRuns: payRunsByStatus,
    totals: {
      totalOrdersValue: totalOrdersValue.toFixed(2),
      syncedOrdersValue: syncedOrdersValue.toFixed(2),
      unsyncedOrdersValue: (totalOrdersValue - syncedOrdersValue).toFixed(2),
    },
    recentFailures,
    lastSyncAt: null,
  };
}

export async function fetchQBPayments(): Promise<any[]> {
  const accessToken = await refreshAccessToken();
  if (!accessToken) throw new Error("QuickBooks not connected");

  const connection = await db.query.quickbooksConnection.findFirst();
  if (!connection) throw new Error("QuickBooks not connected");

  const config = getConfig();
  const apiBase = getApiBase(config.environment);

  const startTime = Date.now();
  const query = "SELECT * FROM Payment WHERE TxnDate > '2024-01-01' MAXRESULTS 500";
  
  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch(
        `${apiBase}/v3/company/${connection.realmId}/query?query=${encodeURIComponent(query)}&minorversion=${QB_API_MINOR_VERSION}`,
        {
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json",
          },
        }
      );
      
      if (!res.ok) {
        const error = await res.text();
        throw Object.assign(new Error(`Failed to fetch payments: ${error}`), { status: res.status });
      }
      
      return res;
    }, MAX_RETRIES, "fetchPayments");

    const data = await response.json();
    
    await logQBApiCall({
      action: "QUERY",
      entityType: "PAYMENT",
      endpoint: `/v3/company/${connection.realmId}/query`,
      method: "GET",
      responseStatus: 200,
      duration: Date.now() - startTime,
    });
    
    return data.QueryResponse?.Payment || [];
  } catch (error: any) {
    await logQBApiCall({
      action: "QUERY",
      entityType: "PAYMENT",
      endpoint: `/v3/company/${connection.realmId}/query`,
      method: "GET",
      errorMessage: error.message,
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

export async function syncPaymentStatus(qbInvoiceId: string): Promise<{ isPaid: boolean; paymentDate?: string; paymentAmount?: number }> {
  const accessToken = await refreshAccessToken();
  if (!accessToken) throw new Error("QuickBooks not connected");

  const connection = await db.query.quickbooksConnection.findFirst();
  if (!connection) throw new Error("QuickBooks not connected");

  const config = getConfig();
  const apiBase = getApiBase(config.environment);

  const query = `SELECT * FROM Payment WHERE Line.LinkedTxn.TxnId = '${qbInvoiceId}'`;
  
  const response = await fetch(
    `${apiBase}/v3/company/${connection.realmId}/query?query=${encodeURIComponent(query)}&minorversion=${QB_API_MINOR_VERSION}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to check payment status");
  }

  const data = await response.json();
  const payments = data.QueryResponse?.Payment || [];
  
  if (payments.length === 0) {
    return { isPaid: false };
  }

  const latestPayment = payments[0];
  return {
    isPaid: true,
    paymentDate: latestPayment.TxnDate,
    paymentAmount: parseFloat(latestPayment.TotalAmt),
  };
}

export async function syncPaymentStatuses(): Promise<{ updated: number; errors: number }> {
  const ordersToCheck = await db.query.salesOrders.findMany({
    where: and(
      eq(salesOrders.qbInvoiceSyncStatus, "SYNCED"),
      isNull(salesOrders.payRunId)
    ),
    limit: 100,
  });

  let updated = 0;
  let errors = 0;

  for (const order of ordersToCheck) {
    if (!order.qbInvoiceId) continue;

    try {
      const paymentStatus = await syncPaymentStatus(order.qbInvoiceId);
      
      if (paymentStatus.isPaid) {
        updated++;
      }
    } catch (error) {
      errors++;
      console.error(`Failed to check payment for order ${order.id}:`, error);
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return { updated, errors };
}

export function getEnvironmentInfo() {
  const env = process.env.QB_ENVIRONMENT || "sandbox";
  return {
    currentEnvironment: env,
    isSandbox: env === "sandbox",
    isProduction: env === "production",
    sandboxApiBase: QB_SANDBOX_API_BASE,
    productionApiBase: QB_API_BASE,
    apiMinorVersion: QB_API_MINOR_VERSION,
  };
}

export async function fetchQBClasses(): Promise<any[]> {
  const accessToken = await refreshAccessToken();
  if (!accessToken) throw new Error("QuickBooks not connected");

  const connection = await db.query.quickbooksConnection.findFirst();
  if (!connection) throw new Error("QuickBooks not connected");

  const config = getConfig();
  const apiBase = getApiBase(config.environment);

  const query = "SELECT * FROM Class WHERE Active = true MAXRESULTS 200";
  const response = await fetch(
    `${apiBase}/v3/company/${connection.realmId}/query?query=${encodeURIComponent(query)}&minorversion=${QB_API_MINOR_VERSION}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch classes: ${error}`);
  }

  const data = await response.json();
  return data.QueryResponse?.Class || [];
}

export async function fetchQBDepartments(): Promise<any[]> {
  const accessToken = await refreshAccessToken();
  if (!accessToken) throw new Error("QuickBooks not connected");

  const connection = await db.query.quickbooksConnection.findFirst();
  if (!connection) throw new Error("QuickBooks not connected");

  const config = getConfig();
  const apiBase = getApiBase(config.environment);

  const query = "SELECT * FROM Department WHERE Active = true MAXRESULTS 200";
  const response = await fetch(
    `${apiBase}/v3/company/${connection.realmId}/query?query=${encodeURIComponent(query)}&minorversion=${QB_API_MINOR_VERSION}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch departments: ${error}`);
  }

  const data = await response.json();
  return data.QueryResponse?.Department || [];
}

export async function fetchQBItems(): Promise<any[]> {
  const accessToken = await refreshAccessToken();
  if (!accessToken) throw new Error("QuickBooks not connected");

  const connection = await db.query.quickbooksConnection.findFirst();
  if (!connection) throw new Error("QuickBooks not connected");

  const config = getConfig();
  const apiBase = getApiBase(config.environment);

  const query = "SELECT * FROM Item WHERE Active = true MAXRESULTS 500";
  const response = await fetch(
    `${apiBase}/v3/company/${connection.realmId}/query?query=${encodeURIComponent(query)}&minorversion=${QB_API_MINOR_VERSION}`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch items: ${error}`);
  }

  const data = await response.json();
  return data.QueryResponse?.Item || [];
}

export async function saveAdvancedMapping(
  mappingType: string,
  qbId: string,
  qbName: string,
  additionalData?: { qbAccountType?: string }
): Promise<void> {
  const existingCheck = await db.query.quickbooksAccountMappings.findFirst({
    where: eq(quickbooksAccountMappings.mappingType, mappingType),
  });

  if (existingCheck) {
    await db.update(quickbooksAccountMappings)
      .set({
        qbAccountId: qbId,
        qbAccountName: qbName,
        qbAccountType: additionalData?.qbAccountType || null,
        updatedAt: new Date(),
      })
      .where(eq(quickbooksAccountMappings.id, existingCheck.id));
  } else {
    await db.insert(quickbooksAccountMappings).values({
      mappingType,
      qbAccountId: qbId,
      qbAccountName: qbName,
      qbAccountType: additionalData?.qbAccountType || null,
    });
  }
}

export async function getSyncHealthMetrics() {
  const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const recentLogs = await db.select()
    .from(quickbooksSyncLog)
    .where(sql`${quickbooksSyncLog.createdAt} > ${last24Hours}`)
    .orderBy(desc(quickbooksSyncLog.createdAt));

  const successCount = recentLogs.filter(l => l.status === "SYNCED").length;
  const failureCount = recentLogs.filter(l => l.status === "FAILED").length;
  const pendingCount = recentLogs.filter(l => l.status === "PENDING").length;
  const totalCount = recentLogs.length;

  const successRate = totalCount > 0 ? ((successCount / totalCount) * 100).toFixed(1) : "100";

  const failuresByType = recentLogs
    .filter(l => l.status === "FAILED")
    .reduce((acc, l) => {
      const type = l.entityType;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  return {
    last24Hours: {
      total: totalCount,
      success: successCount,
      failed: failureCount,
      pending: pendingCount,
      successRate: `${successRate}%`,
    },
    failuresByType,
    auditLogsCount: auditLogs.length,
    lastApiCalls: auditLogs.slice(-5),
  };
}
