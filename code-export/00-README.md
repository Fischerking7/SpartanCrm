# Iron Crest CRM - Source Code Export for Review

## File Index

### Core Backend
1. **01-schema.ts** - Database schema (Drizzle ORM) - All tables, relations, types
2. **02-routes-part1.ts** - API routes lines 1-3500 (Auth, Orders, Pay Runs, Approvals)
3. **03-routes-part2.ts** - API routes lines 3501-7000 (Admin, Bulk ops, Commissions)
4. **04-routes-part3.ts** - API routes lines 7001-10500 (Payroll, Knowledge, QuickBooks)
5. **05-routes-part4.ts** - API routes lines 10501-14300 (Finance/AR, Notifications, Install Sync)
6. **06-storage.ts** - Data access layer (all CRUD operations)

### Business Logic
7. **07-scheduler.ts** - Background jobs (daily reports, alerts, automated tasks)
8. **08-email.ts** - Email service (SMTP, HTML report templates)
9. **09-claude-matching.ts** - AI-powered install sync matching
10. **10-mcp-server.ts** - Claude Desktop MCP connector

### Key Frontend
11. **11-payruns.tsx** - Pay Runs management page
12. **12-finance.tsx** - Finance/AR reconciliation page
13. **13-reports.tsx** - Reports & analytics page
14. **14-pdf-generator.ts** - PDF export for pay statements
