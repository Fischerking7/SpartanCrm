import { db } from "./db";
import { 
  quickbooksConnection, 
  quickbooksAccountMappings, 
  quickbooksSyncLog,
  salesOrders,
  payRuns,
  payStatements
} from "@shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

const QB_OAUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_API_BASE = "https://quickbooks.api.intuit.com";
const QB_SANDBOX_API_BASE = "https://sandbox-quickbooks.api.intuit.com";

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
  
  if (existing) {
    await db.update(quickbooksConnection)
      .set({
        realmId,
        companyName: companyInfo?.CompanyName || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        isConnected: true,
        connectedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(eq(quickbooksConnection.id, existing.id));
  } else {
    await db.insert(quickbooksConnection).values({
      realmId,
      companyName: companyInfo?.CompanyName || null,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      isConnected: true,
      connectedByUserId: userId,
    });
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
  const connection = await db.query.quickbooksConnection.findFirst();
  
  if (!connection) {
    return null;
  }

  if (new Date() < new Date(connection.accessTokenExpiresAt)) {
    return connection.accessToken;
  }

  if (new Date() > new Date(connection.refreshTokenExpiresAt)) {
    await db.update(quickbooksConnection)
      .set({ isConnected: false, updatedAt: new Date() })
      .where(eq(quickbooksConnection.id, connection.id));
    throw new Error("QuickBooks refresh token expired. Please reconnect.");
  }

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

  return tokens.access_token;
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

  if (log.entityType === "INVOICE") {
    return syncInvoiceToQuickBooks(log.entityId, userId);
  } else if (log.entityType === "JOURNAL_ENTRY") {
    return postPayRunJournalEntry(log.entityId, userId);
  }

  return { success: false, error: "Unknown entity type" };
}
