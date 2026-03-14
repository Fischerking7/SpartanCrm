# Iron Crest CRM - Replit Configuration

## Overview

Iron Crest CRM is a comprehensive full-stack platform designed to streamline sales operations, automate commission tracking, and facilitate QuickBooks reconciliation. It supports various organizational sizes by providing robust role-based access, automated commission calculations, payment and chargeback management, and detailed audit logging. The platform aims to enhance sales efficiency, ensure accurate and timely commission payouts, and integrate seamlessly with financial systems.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Tech Stack
- **Frontend**: React 18 with TypeScript, Vite, TailwindCSS
- **Backend**: Node.js with Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT-based with bcrypt hashing
- **UI Components**: shadcn/ui

### Project Structure
The application uses a monorepo structure with `client/` for the React frontend, `server/` for the Express backend API, `shared/` for common TypeScript types and Drizzle schema, and `migrations/` for database migration files.

### Core Architectural Decisions
- **Role-Based Access Control**: Implements eight distinct user roles (REP, MDU, LEAD, MANAGER, EXECUTIVE, ADMIN, OPERATIONS, ACCOUNTING) with granular permissions and data isolation. An EXECUTIVE view mode toggle allows different data visibility levels (My Sales, My Team, Global).
- **Commission Management**:
  - Distinguishes between Earned and Paid Commissions, and handles Chargebacks as separate negative entries.
  - Enforces immutability for approved order fields, with formal Adjustments required for changes.
  - Supports role-based override amounts via `rate_card_role_overrides` for flexible net commission calculations.
- **Iron Crest Commission Extension**: Full compensation plan with role-tiered payouts, four override tiers, and dynamic profit tracking:
  - **Rate Card Fields**: `ironCrestRackRateCents` (carrier pay/rack rate), `ironCrestProfitBaseCents` (profit when REP sells), `directorOverrideCents` (EXECUTIVE upline override), `adminOverrideCents` (OPERATIONS/ADMIN upline override), `accountingOverrideCents` (ACCOUNTING role override)
  - **Sales Order Fields**: `repRoleAtSale` (role captured at approval time), `ironCrestRackRateCents`, `ironCrestProfitCents` (dynamic), `directorOverrideCents`, `adminOverrideCents`, `accountingOverrideCents`
  - **Accounting Identity**: Iron Crest Rack Rate = Rep Payout + Director Override + Admin Override + Accounting Override + Iron Crest Profit
  - **Dynamic Profit**: Profit varies by who sold the order (REP/LEAD/MANAGER get different payouts from role-tiered rate cards)
  - **Profit Flooring**: If computed profit goes negative, logs a CONFLICT_RATE rate issue and floors at $0
  - **Override Earnings**: Three Iron Crest override types — DIRECTOR_OVERRIDE (to hierarchy executive), ADMIN_OVERRIDE (to OPERATIONS/ADMIN user), ACCOUNTING_OVERRIDE (split evenly among all active ACCOUNTING users). All start as PENDING_APPROVAL. $0 overrides skip record creation. Missing ACCOUNTING recipients log MISSING_ACCOUNTING_RECIPIENT rate issue.
  - **Override Approval Workflow**: `approvalStatus` (PENDING_APPROVAL, APPROVED, REJECTED, VOIDED) with audit trail. Only APPROVED earnings link to pay runs. Role-specific approval: EXECUTIVE approves DIRECTOR_OVERRIDE and ACCOUNTING_OVERRIDE; OPERATIONS approves ADMIN_OVERRIDE and ACCOUNTING_OVERRIDE. Self-approval guard prevents approving own overrides. In-app notifications on creation (to approvers) and on approve/reject (to recipient).
  - **Override Approval Endpoints**: `GET /api/admin/override-earnings/pending` (enriched with order data, filterable by overrideType/recipientUserId/orderId), `GET /api/admin/override-earnings/pending/count`, `POST .../approve`, `POST .../reject`, `POST .../bulk-approve`, `POST .../bulk-reject` — all restricted to EXECUTIVE and OPERATIONS roles.
  - **Commission Breakdown API**: `GET /api/orders/:id/commission-breakdown` returns repRole, repPayout, directorOverride, adminOverride, accountingOverride, rackRate, ironCrestProfit, profitMarginPercent, bundleComponents
  - **Profit Report**: `GET /api/admin/reports/iron-crest-profit` with date range filtering, includes totalAccountingOverride
  - **Seed Endpoint**: `POST /api/admin/seed-iron-crest-rate-cards` for idempotent rate card seeding (supports accountingOverrideCents)
- **Payroll System**: Comprehensive system managing pay statements, deductions, advances, year-to-date tracking, and a multi-stage pay run approval workflow (DRAFT, PENDING_REVIEW, PENDING_APPROVAL, APPROVED, FINALIZED).
- **Manual Override Distribution System**: Allows flexible distribution of override-eligible amounts from a central pool.
- **Knowledge Database**: Central repository for categorized reference documents with role-based permissions.
- **Mobile Line Tracking**: Granular tracking and commission calculation for individual mobile lines within sales orders.
- **MDU Staging Order Workflow**: MDU users submit orders to a staging table for admin review before promotion to the main sales orders.
- **Advanced Payroll Features**: Includes 1099-NEC generation, ACH/Direct Deposit exports, flexible Bonuses & SPIFFs, Draw Against Commission, Split Commission Agreements, Commission Tiers & Caps, Scheduled Pay Runs, Commission Forecasting, and a Payroll Reports Dashboard.
- **MCP Server (Claude Desktop Connector)**: A standalone server (`server/mcp-server.ts`) exposes read-only CRM data tools for Claude Desktop, enabling programmatic access to CRM data.
- **Frontend Architecture**: Utilizes React Query for server state, Wouter for routing, React Hook Form with Zod for forms, and supports light/dark themes.
- **Mobile Optimization**: Comprehensive mobile-responsive design including dedicated mobile order entry, responsive dialogs and card views, collapsible filters, and a fixed bottom navigation for field roles (REP/MDU/LEAD). Phase 1 rep-facing mobile screens: Rep Home (`/dashboard` with greeting, MTD stats, alerts, recent orders), New Order (`/orders/new` with 4-step progressive form), My Orders (`/my-orders` with filter chips, pagination, detail dialog), My Earnings (`/my-earnings` with period breakdown, 12-month history chart, pay stubs). Backend APIs: `/api/my/summary`, `/api/my/orders`, `/api/my/earnings` with repId guards.
- **User Activity Tracking**: Tracks user logins, device types, and page usage with IP geolocation, storing activity logs and providing an admin dashboard for monitoring.
- **Client Finance Import & AR Reconciliation**: Allows import of client finance data with column mapping, multi-factor auto-matching against approved orders, and admin reconciliation capabilities with audit logging and commission cascade on paid orders.
- **Install Sync (AI-Powered Order Matching)**: Automated workflow using Claude AI to match installation records against CRM orders from Google Sheets or CSV uploads, updating order statuses based on installation outcomes.
- **Automated Payroll Pipeline**: End-to-end payroll automation with AR-gated readiness (auto-triggers on AR satisfaction), manual override/hold/release endpoints, auto-build pay runs from payroll-ready orders, pay stub generation with atomic stub numbering (`stub_sequences` table), PDF generation (pdfkit), bulk ZIP export (archiver), full-cycle endpoint (build + stubs + optional finalize in one call), accounting reconciliation dashboard (summary, AR-payroll reconciliation, variance report), and daily stale AR alerts (30+ day threshold). Key files: `server/payStubGenerator.ts`, `server/payStubPdf.ts`.
- **Operations Interface (Phase 2)**: 6-screen ops center at `/ops/*` with exception dashboard, order management, install sync, finance imports, rep management, and reports. Tab-based navigation via `OpsNav`. Accessible by OPERATIONS/ADMIN/EXECUTIVE roles. Backend endpoints: `/api/ops/exceptions`, `/api/ops/activity-summary`.
- **Accounting Interface (Phase 3)**: 7-screen accounting center at `/accounting/*` with home dashboard (3-column: Money In, Money Out, Net Position), pay runs (guided workflow with step progress bar), pay stubs (search/filter/detail modal/PDF download), AR management (table/reconciliation/variance views), override approvals (admin/accounting tabs with bulk approve), advances & deductions (pending/active/history/deductions tabs), and financial reports (6 report cards with date range and CSV export). Tab-based navigation via `AcctNav`. Accessible by ACCOUNTING/ADMIN/EXECUTIVE roles. Backend endpoint: `/api/accounting/home-summary`. Pages: `client/src/pages/accounting/acct-*.tsx`.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Drizzle ORM & Drizzle Kit**: Database interaction and migrations.
- **jsonwebtoken & bcryptjs**: Authentication and password security.
- **csv-parse & csv-stringify**: CSV data processing.
- **multer**: File uploads.
- **@radix-ui/*, tailwindcss, class-variance-authority, lucide-react**: UI development.
- **@tanstack/react-query, react-hook-form, zod**: State management, forms, and validation.
- **QuickBooks Online Integration**: Deep OAuth 2.0 integration for two-way payment sync, account mapping, reconciliation, exception handling, and health monitoring.
- **pdfkit**: PDF generation for pay stubs.
- **archiver**: ZIP archive generation for bulk pay stub PDF export.
- **Background Scheduler**: Manages automated tasks like pay run creation, chargeback auto-matching, email notifications, and stale AR alerts.
- **Email Notifications**: Queue-based system for user notifications via SMTP.
- **Automated Alerts System**: Sends alerts for pending approvals, low performance warnings, stale AR (30+ days), and in-app notifications.
- **Claude AI (Replit AI Integrations, claude-sonnet-4-6)**: Used for the Install Sync feature for intelligent order matching.
