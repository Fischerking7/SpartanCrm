import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, gte, lte, desc, sql, ilike, or } from "drizzle-orm";
import * as schema from "../shared/schema";

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const server = new McpServer({
  name: "iron-crest-crm",
  version: "1.0.0",
});

server.tool(
  "get_orders",
  "Get sales orders with optional filters. Returns order details including rep, provider, service, commissions, and status.",
  {
    startDate: z.string().optional().describe("Filter orders sold on or after this date (YYYY-MM-DD)"),
    endDate: z.string().optional().describe("Filter orders sold on or before this date (YYYY-MM-DD)"),
    repId: z.string().optional().describe("Filter by rep ID (e.g. 'R01')"),
    providerId: z.string().optional().describe("Filter by provider UUID"),
    providerName: z.string().optional().describe("Filter by provider name (partial match)"),
    jobStatus: z.enum(["PENDING", "COMPLETED", "CANCELED"]).optional().describe("Filter by job status"),
    approvalStatus: z.enum(["UNAPPROVED", "APPROVED", "REJECTED"]).optional().describe("Filter by approval status"),
    paymentStatus: z.enum(["UNPAID", "PAID", "PARTIALLY_PAID"]).optional().describe("Filter by payment status"),
    limit: z.number().optional().default(100).describe("Max results (default 100)"),
  },
  async (params) => {
    const conditions: any[] = [];
    if (params.startDate) conditions.push(gte(schema.salesOrders.dateSold, params.startDate));
    if (params.endDate) conditions.push(lte(schema.salesOrders.dateSold, params.endDate));
    if (params.repId) conditions.push(eq(schema.salesOrders.repId, params.repId));
    if (params.jobStatus) conditions.push(eq(schema.salesOrders.jobStatus, params.jobStatus));
    if (params.approvalStatus) conditions.push(eq(schema.salesOrders.approvalStatus, params.approvalStatus));
    if (params.paymentStatus) conditions.push(eq(schema.salesOrders.paymentStatus, params.paymentStatus));

    if (params.providerName) {
      const providers = await db.select().from(schema.providers).where(ilike(schema.providers.name, `%${params.providerName}%`));
      if (providers.length > 0) {
        conditions.push(sql`${schema.salesOrders.providerId} IN (${sql.join(providers.map(p => sql`${p.id}`), sql`, `)})`);
      } else {
        return { content: [{ type: "text" as const, text: "No providers match that name." }] };
      }
    }
    if (params.providerId) conditions.push(eq(schema.salesOrders.providerId, params.providerId));

    const orders = await db.select().from(schema.salesOrders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.salesOrders.dateSold))
      .limit(params.limit);

    const providers = await db.select().from(schema.providers);
    const services = await db.select().from(schema.services);
    const users = await db.select().from(schema.users);
    const provMap = new Map(providers.map(p => [p.id, p.name]));
    const svcMap = new Map(services.map(s => [s.id, s.name]));
    const userMap = new Map(users.map(u => [u.repId, u.name]));

    const rows = orders.map(o => ({
      id: o.id,
      repId: o.repId,
      repName: userMap.get(o.repId || "") || "Unknown",
      customerName: o.customerName,
      accountNumber: o.accountNumber,
      provider: provMap.get(o.providerId) || o.providerId,
      service: svcMap.get(o.serviceId) || o.serviceId,
      dateSold: o.dateSold,
      installDate: o.installDate,
      jobStatus: o.jobStatus,
      approvalStatus: o.approvalStatus,
      baseCommission: o.baseCommissionEarned,
      incentive: o.incentiveEarned,
      grossCommission: ((Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0)).toFixed(2),
      overrideDeduction: o.overrideDeduction,
      paymentStatus: o.paymentStatus,
      commissionPaid: o.commissionPaid,
      paidDate: o.paidDate,
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ count: rows.length, orders: rows }, null, 2) }],
    };
  }
);

server.tool(
  "get_order_details",
  "Get detailed information about a specific order including commission line items.",
  {
    orderId: z.string().describe("The order UUID"),
  },
  async ({ orderId }) => {
    const [order] = await db.select().from(schema.salesOrders).where(eq(schema.salesOrders.id, orderId));
    if (!order) return { content: [{ type: "text" as const, text: "Order not found." }] };

    const lineItems = await db.select().from(schema.commissionLineItems)
      .where(eq(schema.commissionLineItems.salesOrderId, orderId));

    const [provider] = await db.select().from(schema.providers).where(eq(schema.providers.id, order.providerId));
    const [service] = await db.select().from(schema.services).where(eq(schema.services.id, order.serviceId));
    const users = await db.select().from(schema.users).where(eq(schema.users.repId, order.repId || ""));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ...order,
          providerName: provider?.name,
          serviceName: service?.name,
          repName: users[0]?.name || "Unknown",
          commissionLineItems: lineItems,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "search_orders",
  "Search orders by customer name, account number, or invoice number.",
  {
    searchTerm: z.string().describe("Search term to match against customer name, account number, or invoice number"),
    limit: z.number().optional().default(50),
  },
  async ({ searchTerm, limit }) => {
    const term = `%${searchTerm}%`;
    const orders = await db.select().from(schema.salesOrders)
      .where(or(
        ilike(schema.salesOrders.customerName, term),
        sql`${schema.salesOrders.accountNumber} ILIKE ${term}`,
        sql`${schema.salesOrders.invoiceNumber} ILIKE ${term}`,
      ))
      .orderBy(desc(schema.salesOrders.dateSold))
      .limit(limit);

    const providers = await db.select().from(schema.providers);
    const services = await db.select().from(schema.services);
    const provMap = new Map(providers.map(p => [p.id, p.name]));
    const svcMap = new Map(services.map(s => [s.id, s.name]));

    const rows = orders.map(o => ({
      id: o.id,
      repId: o.repId,
      customerName: o.customerName,
      accountNumber: o.accountNumber,
      invoiceNumber: o.invoiceNumber,
      provider: provMap.get(o.providerId) || "",
      service: svcMap.get(o.serviceId) || "",
      dateSold: o.dateSold,
      jobStatus: o.jobStatus,
      approvalStatus: o.approvalStatus,
      grossCommission: ((Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0)).toFixed(2),
      paymentStatus: o.paymentStatus,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify({ count: rows.length, orders: rows }, null, 2) }] };
  }
);

server.tool(
  "get_reps",
  "List all sales reps with their role, status, and supervisor assignments.",
  {
    role: z.enum(["REP", "MDU", "LEAD", "MANAGER", "EXECUTIVE", "ADMIN", "OPERATIONS"]).optional().describe("Filter by role"),
    status: z.enum(["ACTIVE", "DEACTIVATED"]).optional().describe("Filter by status"),
  },
  async (params) => {
    const conditions: any[] = [];
    if (params.role) conditions.push(eq(schema.users.role, params.role));
    if (params.status) conditions.push(eq(schema.users.status, params.status));
    conditions.push(sql`${schema.users.deletedAt} IS NULL`);

    const users = await db.select().from(schema.users)
      .where(and(...conditions))
      .orderBy(schema.users.name);

    const allUsers = await db.select().from(schema.users);
    const userMap = new Map(allUsers.map(u => [u.id, u.name]));

    const rows = users.map(u => ({
      id: u.id,
      repId: u.repId,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      supervisor: u.assignedSupervisorId ? userMap.get(u.assignedSupervisorId) : null,
      manager: u.assignedManagerId ? userMap.get(u.assignedManagerId) : null,
      executive: u.assignedExecutiveId ? userMap.get(u.assignedExecutiveId) : null,
      lastLoginAt: u.lastLoginAt,
      lastActiveAt: u.lastActiveAt,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify({ count: rows.length, users: rows }, null, 2) }] };
  }
);

server.tool(
  "get_rep_performance",
  "Get a rep's sales performance summary for a date range including order count, commission totals, and provider breakdown.",
  {
    repId: z.string().describe("Rep ID (e.g. 'R01')"),
    startDate: z.string().optional().describe("Period start date (YYYY-MM-DD), defaults to first of current month"),
    endDate: z.string().optional().describe("Period end date (YYYY-MM-DD), defaults to today"),
  },
  async (params) => {
    const now = new Date();
    const startDate = params.startDate || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const endDate = params.endDate || now.toISOString().split("T")[0];

    const orders = await db.select().from(schema.salesOrders).where(
      and(
        eq(schema.salesOrders.repId, params.repId),
        gte(schema.salesOrders.dateSold, startDate),
        lte(schema.salesOrders.dateSold, endDate),
      )
    );

    const providers = await db.select().from(schema.providers);
    const provMap = new Map(providers.map(p => [p.id, p.name]));

    const approved = orders.filter(o => o.approvalStatus === "APPROVED");
    const totalGross = orders.reduce((s, o) => s + (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0), 0);
    const approvedGross = approved.reduce((s, o) => s + (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0), 0);
    const paidTotal = orders.reduce((s, o) => s + (Number(o.commissionPaid) || 0), 0);

    const providerBreakdown: Record<string, { count: number; gross: number }> = {};
    for (const o of orders) {
      const pName = provMap.get(o.providerId) || "Unknown";
      if (!providerBreakdown[pName]) providerBreakdown[pName] = { count: 0, gross: 0 };
      providerBreakdown[pName].count++;
      providerBreakdown[pName].gross += (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0);
    }

    const statusBreakdown = {
      approved: approved.length,
      unapproved: orders.filter(o => o.approvalStatus === "UNAPPROVED").length,
      rejected: orders.filter(o => o.approvalStatus === "REJECTED").length,
      completed: orders.filter(o => o.jobStatus === "COMPLETED").length,
      pending: orders.filter(o => o.jobStatus === "PENDING").length,
      canceled: orders.filter(o => o.jobStatus === "CANCELED").length,
      paid: orders.filter(o => o.paymentStatus === "PAID").length,
      unpaid: orders.filter(o => o.paymentStatus === "UNPAID").length,
    };

    const users = await db.select().from(schema.users).where(eq(schema.users.repId, params.repId));
    const rep = users[0];

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          repId: params.repId,
          repName: rep?.name || "Unknown",
          role: rep?.role,
          period: { startDate, endDate },
          totalOrders: orders.length,
          totalGrossCommission: totalGross.toFixed(2),
          approvedGrossCommission: approvedGross.toFixed(2),
          totalPaid: paidTotal.toFixed(2),
          statusBreakdown,
          providerBreakdown,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "get_commissions_summary",
  "Get commission totals aggregated by rep, provider, or overall for a date range.",
  {
    startDate: z.string().describe("Period start (YYYY-MM-DD)"),
    endDate: z.string().describe("Period end (YYYY-MM-DD)"),
    groupBy: z.enum(["rep", "provider", "service"]).optional().default("rep").describe("How to group the summary"),
    approvedOnly: z.boolean().optional().default(true).describe("Only include approved orders"),
  },
  async (params) => {
    const conditions: any[] = [
      gte(schema.salesOrders.dateSold, params.startDate),
      lte(schema.salesOrders.dateSold, params.endDate),
    ];
    if (params.approvedOnly) conditions.push(eq(schema.salesOrders.approvalStatus, "APPROVED"));

    const orders = await db.select().from(schema.salesOrders).where(and(...conditions));

    const providers = await db.select().from(schema.providers);
    const services = await db.select().from(schema.services);
    const users = await db.select().from(schema.users);
    const provMap = new Map(providers.map(p => [p.id, p.name]));
    const svcMap = new Map(services.map(s => [s.id, s.name]));
    const userMap = new Map(users.map(u => [u.repId, u.name]));

    const groups: Record<string, { count: number; grossCommission: number; paid: number; overrideDeductions: number }> = {};

    for (const o of orders) {
      let key: string;
      if (params.groupBy === "provider") key = provMap.get(o.providerId) || "Unknown";
      else if (params.groupBy === "service") key = svcMap.get(o.serviceId) || "Unknown";
      else key = `${o.repId} - ${userMap.get(o.repId || "") || "Unknown"}`;

      if (!groups[key]) groups[key] = { count: 0, grossCommission: 0, paid: 0, overrideDeductions: 0 };
      groups[key].count++;
      groups[key].grossCommission += (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0);
      groups[key].paid += Number(o.commissionPaid) || 0;
      groups[key].overrideDeductions += Number(o.overrideDeduction) || 0;
    }

    const totalGross = Object.values(groups).reduce((s, g) => s + g.grossCommission, 0);
    const totalPaid = Object.values(groups).reduce((s, g) => s + g.paid, 0);

    const summary = Object.entries(groups)
      .sort((a, b) => b[1].grossCommission - a[1].grossCommission)
      .map(([name, data]) => ({
        name,
        ...data,
        grossCommission: data.grossCommission.toFixed(2),
        paid: data.paid.toFixed(2),
        overrideDeductions: data.overrideDeductions.toFixed(2),
      }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          period: { startDate: params.startDate, endDate: params.endDate },
          groupBy: params.groupBy,
          totalOrders: orders.length,
          totalGrossCommission: totalGross.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          groups: summary,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "get_pay_runs",
  "List pay runs with status, totals, and order counts.",
  {
    status: z.enum(["DRAFT", "PENDING_REVIEW", "PENDING_APPROVAL", "APPROVED", "FINALIZED"]).optional(),
    limit: z.number().optional().default(20),
  },
  async (params) => {
    const conditions: any[] = [];
    if (params.status) conditions.push(eq(schema.payRuns.status, params.status));

    const runs = await db.select().from(schema.payRuns)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.payRuns.createdAt))
      .limit(params.limit);

    const result = [];
    for (const run of runs) {
      const orders = await db.select().from(schema.salesOrders)
        .where(eq(schema.salesOrders.payRunId, run.id));

      const totalGross = orders.reduce((s, o) => s + (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0), 0);
      const totalPaid = orders.reduce((s, o) => s + (Number(o.commissionPaid) || 0), 0);
      const uniqueReps = new Set(orders.map(o => o.repId));

      result.push({
        id: run.id,
        name: run.name,
        weekEndingDate: run.weekEndingDate,
        status: run.status,
        orderCount: orders.length,
        repCount: uniqueReps.size,
        totalGrossCommission: totalGross.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        createdAt: run.createdAt,
      });
    }

    return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.length, payRuns: result }, null, 2) }] };
  }
);

server.tool(
  "get_provider_mix",
  "Get provider mix breakdown (count and percentage) for a date range.",
  {
    startDate: z.string().describe("Period start (YYYY-MM-DD)"),
    endDate: z.string().describe("Period end (YYYY-MM-DD)"),
    approvedOnly: z.boolean().optional().default(false),
  },
  async (params) => {
    const conditions: any[] = [
      gte(schema.salesOrders.dateSold, params.startDate),
      lte(schema.salesOrders.dateSold, params.endDate),
    ];
    if (params.approvedOnly) conditions.push(eq(schema.salesOrders.approvalStatus, "APPROVED"));

    const orders = await db.select().from(schema.salesOrders).where(and(...conditions));
    const providers = await db.select().from(schema.providers);
    const provMap = new Map(providers.map(p => [p.id, p.name]));

    const counts: Record<string, { count: number; gross: number }> = {};
    for (const o of orders) {
      const name = provMap.get(o.providerId) || "Unknown";
      if (!counts[name]) counts[name] = { count: 0, gross: 0 };
      counts[name].count++;
      counts[name].gross += (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0);
    }

    const total = orders.length;
    const mix = Object.entries(counts)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([provider, data]) => ({
        provider,
        count: data.count,
        percent: total > 0 ? ((data.count / total) * 100).toFixed(1) + "%" : "0%",
        grossCommission: data.gross.toFixed(2),
      }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          period: { startDate: params.startDate, endDate: params.endDate },
          totalOrders: total,
          totalGross: Object.values(counts).reduce((s, c) => s + c.gross, 0).toFixed(2),
          mix,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "get_chargebacks",
  "List chargebacks with optional date filtering.",
  {
    startDate: z.string().optional().describe("Filter by chargeback date (YYYY-MM-DD)"),
    endDate: z.string().optional(),
    repId: z.string().optional().describe("Filter by rep ID"),
    limit: z.number().optional().default(50),
  },
  async (params) => {
    const conditions: any[] = [];
    if (params.startDate) conditions.push(gte(schema.chargebacks.chargebackDate, params.startDate));
    if (params.endDate) conditions.push(lte(schema.chargebacks.chargebackDate, params.endDate));
    if (params.repId) conditions.push(eq(schema.chargebacks.repId, params.repId));

    const cbs = await db.select().from(schema.chargebacks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.chargebacks.chargebackDate))
      .limit(params.limit);

    return { content: [{ type: "text" as const, text: JSON.stringify({ count: cbs.length, chargebacks: cbs }, null, 2) }] };
  }
);

server.tool(
  "get_install_sync_runs",
  "Get install sync run history showing match counts, approval counts, and status.",
  {
    limit: z.number().optional().default(20),
  },
  async ({ limit }) => {
    const runs = await db.select().from(schema.installSyncRuns)
      .orderBy(desc(schema.installSyncRuns.createdAt))
      .limit(limit);

    const users = await db.select().from(schema.users);
    const userMap = new Map(users.map(u => [u.id, u.name]));

    const result = runs.map(r => ({
      id: r.id,
      sourceType: r.sourceType,
      status: r.status,
      totalSheetRows: r.totalSheetRows,
      matchedCount: r.matchedCount,
      approvedCount: r.approvedCount,
      unmatchedCount: r.unmatchedCount,
      emailSent: r.emailSent,
      summary: r.summary,
      runBy: userMap.get(r.runByUserId) || r.runByUserId,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.length, runs: result }, null, 2) }] };
  }
);

server.tool(
  "get_providers",
  "List all providers.",
  {},
  async () => {
    const providers = await db.select().from(schema.providers).orderBy(schema.providers.name);
    return { content: [{ type: "text" as const, text: JSON.stringify(providers, null, 2) }] };
  }
);

server.tool(
  "get_services",
  "List all services.",
  {},
  async () => {
    const services = await db.select().from(schema.services).orderBy(schema.services.name);
    return { content: [{ type: "text" as const, text: JSON.stringify(services, null, 2) }] };
  }
);

server.tool(
  "get_clients",
  "List all clients.",
  {},
  async () => {
    const clients = await db.select().from(schema.clients).orderBy(schema.clients.name);
    return { content: [{ type: "text" as const, text: JSON.stringify(clients, null, 2) }] };
  }
);

server.tool(
  "get_dashboard_summary",
  "Get a high-level dashboard summary: total orders, commissions, top reps, and recent activity for a date range.",
  {
    startDate: z.string().describe("Period start (YYYY-MM-DD)"),
    endDate: z.string().describe("Period end (YYYY-MM-DD)"),
  },
  async ({ startDate, endDate }) => {
    const orders = await db.select().from(schema.salesOrders).where(
      and(
        gte(schema.salesOrders.dateSold, startDate),
        lte(schema.salesOrders.dateSold, endDate),
      )
    );

    const users = await db.select().from(schema.users).where(sql`${schema.users.deletedAt} IS NULL`);
    const userMap = new Map(users.map(u => [u.repId, u.name]));

    const approved = orders.filter(o => o.approvalStatus === "APPROVED");
    const totalGross = orders.reduce((s, o) => s + (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0), 0);
    const approvedGross = approved.reduce((s, o) => s + (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0), 0);

    const repTotals: Record<string, { name: string; count: number; gross: number }> = {};
    for (const o of orders) {
      const key = o.repId || "Unknown";
      if (!repTotals[key]) repTotals[key] = { name: userMap.get(key) || key, count: 0, gross: 0 };
      repTotals[key].count++;
      repTotals[key].gross += (Number(o.baseCommissionEarned) || 0) + (Number(o.incentiveEarned) || 0);
    }

    const topReps = Object.entries(repTotals)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([repId, data]) => ({
        repId,
        name: data.name,
        orderCount: data.count,
        grossCommission: data.gross.toFixed(2),
      }));

    const activeReps = users.filter(u => ["REP", "MDU"].includes(u.role) && u.status === "ACTIVE").length;

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          period: { startDate, endDate },
          totalOrders: orders.length,
          approvedOrders: approved.length,
          pendingApproval: orders.filter(o => o.approvalStatus === "UNAPPROVED").length,
          rejectedOrders: orders.filter(o => o.approvalStatus === "REJECTED").length,
          completedJobs: orders.filter(o => o.jobStatus === "COMPLETED").length,
          canceledJobs: orders.filter(o => o.jobStatus === "CANCELED").length,
          totalGrossCommission: totalGross.toFixed(2),
          approvedGrossCommission: approvedGross.toFixed(2),
          totalPaid: orders.reduce((s, o) => s + (Number(o.commissionPaid) || 0), 0).toFixed(2),
          activeReps,
          topRepsByOrderCount: topReps,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "run_sql_query",
  "Run a read-only SQL query against the CRM database. Only SELECT statements are allowed. The connection is forced into read-only mode for safety.",
  {
    query: z.string().describe("SQL SELECT query to execute"),
  },
  async ({ query }) => {
    const trimmed = query.trim();
    const upper = trimmed.toUpperCase();
    if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
      return { content: [{ type: "text" as const, text: "Error: Only SELECT/WITH queries are allowed." }] };
    }
    if (trimmed.includes(";")) {
      return { content: [{ type: "text" as const, text: "Error: Multiple statements (semicolons) are not allowed." }] };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const result = await client.query(trimmed);
      await client.query("ROLLBACK");
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ rowCount: result.rowCount, rows: result.rows.slice(0, 500) }, null, 2),
        }],
      };
    } catch (error: any) {
      try { await client.query("ROLLBACK"); } catch {}
      return { content: [{ type: "text" as const, text: `SQL Error: ${error.message}` }] };
    } finally {
      client.release();
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Iron Crest CRM MCP Server running on stdio");
}

main().catch(console.error);
