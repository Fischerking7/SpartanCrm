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
- **Role-Based Access Control**: Implements nine distinct user roles (REP, MDU, LEAD, MANAGER, DIRECTOR, EXECUTIVE, ADMIN, OPERATIONS, ACCOUNTING) with granular permissions and data isolation, including an EXECUTIVE view mode toggle. OPERATIONS role has full admin-level access equivalent to EXECUTIVE, including creating any user role (EXECUTIVE, OPERATIONS, etc.), editing rate card amounts, overriding reserve caps, and viewing profit data.
- **Centralized Permissions System**: `server/permissions.ts` defines 80+ granular permission keys with role mappings. `requirePermission(key)` middleware replaces legacy `adminOnly`/`executiveOrAdmin` guards. `canCreateRole` enforces user creation hierarchy. All route guards in `routes.ts` use this permission-based system.
- **Commission Management**: Differentiates between Earned and Paid Commissions, handles Chargebacks, enforces immutability for approved orders, and supports role-based override amounts.
- **Iron Crest Commission Extension**: Full compensation plan with role-tiered payouts, four override tiers, dynamic profit tracking, profit flooring, and an override approval workflow with role-specific approvals and in-app notifications. Override Rules: Leader Override ($10/internet sale, requires 35 weekly team connects minimum); Manager Override ($10/sale normally, $15/sale for 600 Mbps/1 Gig/1 Gig+ when team reaches 100 weekly internet connects, 300 Mbps capped at $10). Director/Operations/Accounting overrides stored per rate card in cents fields.
- **Payroll System**: Comprehensive system for managing pay statements, deductions, advances, year-to-date tracking, and a multi-stage pay run approval workflow. Includes 1099-NEC generation, ACH/Direct Deposit exports, bonuses, SPIFFs, draw against commission, split commission agreements, tiers, caps, scheduled pay runs, forecasting, and a payroll reports dashboard.
- **Manual Override Distribution System**: Allows flexible distribution of override-eligible amounts.
- **Knowledge Database**: Central repository for categorized reference documents with role-based permissions.
- **Mobile Line Tracking**: Granular tracking and commission calculation for individual mobile lines.
- **MDU Staging Order Workflow**: MDU users submit orders for admin review before promotion to main sales orders.
- **MCP Server (Claude Desktop Connector)**: A standalone server exposing read-only CRM data tools for programmatic access.
- **Frontend Architecture**: Utilizes React Query for server state, Wouter for routing, React Hook Form with Zod for forms, and supports light/dark themes.
- **Mobile Optimization**: Comprehensive mobile-responsive design for field roles including dedicated order entry, responsive dialogs, card views, collapsible filters, and fixed bottom navigation.
- **User Activity Tracking**: Tracks user logins, device types, and page usage with IP geolocation, providing an admin dashboard.
- **Client Finance Import & AR Reconciliation**: Allows import of client finance data, multi-factor auto-matching, and admin reconciliation with audit logging and commission cascade.
- **Per-Service AR Tracking**: Orders with multiple services (Internet/TV/Mobile) get independent AR records per service line. Each AR record has `serviceType`, `serviceInstallDate`, and `commissionAmountCents`. AR satisfaction cascade: order only marked PAID when ALL service ARs are SATISFIED. Pay run `link-all-orders` filters by AR `serviceInstallDate` for per-service orders, falling back to order-level `installDate`. Override deduction attributed to INTERNET portion. Schema additions: `ar_expectations` (serviceType, serviceInstallDate, commissionAmountCents); `sales_orders` (tvInstallDate, mobileInstallDate).
- **Install Sync (AI-Powered Order Matching)**: Automated workflow using Claude AI to match installation records against CRM orders from various sources, updating order statuses. Supports carrier-specific profiles (Astound, Optimum) with configurable column mappings, speed tier maps, status code maps, and signature header auto-detection. Carrier rep mapping links carrier salesman numbers to CRM users for improved match scoring. Admin UI at `/admin/carrier-profiles` and `/admin/carrier-rep-mappings` with CSV bulk import support.
- **Automated Payroll Pipeline**: End-to-end payroll automation with AR-gated readiness, manual override/hold/release endpoints, auto-build pay runs, pay stub generation (PDF), bulk ZIP export, full-cycle endpoint, accounting reconciliation dashboard, and daily stale AR alerts.
- **Operations Interface**: A 12-screen operations center with desktop sidebar navigation (navy/gold design). Screens: Home (exception queue with severity levels, system health strip, quick stats), Orders (approval queue with bulk approve, full order table), Reps (roster with search/filter, detail pages), Install Sync (upload, Google Sheets, auto-approve), Finance Imports (upload, match rates, post), Pay Runs (6-step workflow UI, finalize confirmation), Pay Stubs (table, detail view, bulk PDF export), AR Management (summary cards, payment recording, reconciliation), Override Approvals (tabbed, bulk approve, self-owned blocking), Advances (approve/mark-paid workflow), Reports (builder with date range, CSV export, quick reports), Settings (system status, security, integrations). All pages in `client/src/pages/ops/`. Layout uses `OpsLayout` wrapper with navy sidebar on desktop, collapsible grid on mobile.
- **Accounting Interface**: An 8-screen accounting center with desktop sidebar navigation (navy/gold design matching Operations). Screens: Home dashboard, Pay Runs (guided workflow), Pay Stubs, AR Management, Override Approvals, Advances & Deductions, Financial Reports, 1099 Preparation (year picker, eligible contractor table, bulk generate). All pages in `client/src/pages/accounting/`. Layout uses `AcctLayout` wrapper. Accessible to ACCOUNTING, ADMIN, EXECUTIVE, OPERATIONS roles.
- **Director Interface**: A 5-screen director center with desktop sidebar navigation (navy/gold design matching Operations). Screens: Scoreboard, Production, Trends, Approvals, Knowledge & Goals. All pages in `client/src/pages/director/`. Layout uses `DirLayout` wrapper. Accessible to EXECUTIVE role only. DIRECTOR role has full admin-level sidebar with collapsible sections (Dashboard, Operations, Insights, Settings, My Account, Resources). DIRECTOR can view all orders, approve LEADER_OVERRIDE and MANAGER_OVERRIDE overrides, access user activity, view reports and executive reports, and view users/rate cards. Permissions aligned across frontend guards (App.tsx, orders.tsx, override-approvals.tsx, user-activity.tsx) and backend (permissions.ts, routes.ts).
- **Executive Interface**: A 5-screen executive center for the EXECUTIVE role, focusing on financial metrics (revenue, profit, margin), production, override approvals, and company settings.
- **Reporting System & Role-Based Dashboards**: Six report API endpoints under `/api/reports/` (my/dashboard, manager/dashboard, executive/summary, director/team-comparison, director/rep-leaderboard, operations/dashboard). Semi-monthly pay period helper. Dashboard router renders role-specific views: MyDashboard (REP/LEAD/MDU), ManagerDashboard (MANAGER), ExecutiveReportDashboard (EXECUTIVE/ADMIN), DirectorDashboard (DIRECTOR), OperationsReportDashboard (OPERATIONS/ACCOUNTING). Shared components: KpiCard (variant-colored border cards), TimeHorizonSelector (Today/Pay Period/MTD toggle). All dashboards auto-refresh every 60 seconds. Dashboard pages in `client/src/pages/reports/`.
- **Predictive Intelligence**: Integrates five intelligence features: Chargeback Risk Scoring, Rep Performance Prediction, AR Collection Prediction, Profit Anomaly Detection, and Pay Run Cash Flow Projection.
- **External Integration Points**: Provides admin management UI for carrier file automation (email webhooks, SFTP polling), ACH payment processing (NACHA generation, submission, settlement), calendar integration (Google Calendar sync), and reporting webhooks & API keys. Also includes an integration activity log.
- **Contractor Onboarding System**: OTP-gated onboarding portal for 1099 independent contractors. Includes 6 legal documents (background check, chargeback policy, contractor application, direct deposit, drug test consent, NDA), e-signature capture with E-SIGN Act compliance, encrypted SSN/bank info storage, PDF generation via pdf-lib, admin review queue with approve/reject workflow, compliance tracking (background check and drug test statuses), SMS notifications via Twilio (optional), and a full append-only audit log.
- **Rolling Reserve System**: Full implementation of Chargebacks & Rolling Reserve Policy (Sections 1-10). Per-rep rolling reserves with 15% withholding up to $2,500 cap, automated chargeback deductions, equipment recovery ($500 iPad), rep separation handling (voluntary/terminated), and maturity-based release (Optimum: 120d voluntary/180d non-pay; Astound: 120d both). Tables: `rolling_reserves` (balance, cap, withholding rate, separation fields, lifetime totals), `reserve_transactions` (withholdings, releases, forfeitures, chargeback offsets, equipment recovery, adjustments), `system_exceptions` (RESERVE_DEFICIT, RESERVE_MATURITY_RELEASE_DUE, RESERVE_CAP_OVERRIDE_ACTIVE). Services: `server/reserves/maturityService.ts`, `server/reserves/reserveService.ts`. Daily scheduler jobs at 6AM ET (maturity release) and 8AM ET (deficit check). Reserve withholding integrated into pay stub generation. Onboarding Document 2 contains verbatim policy text (Sections 1-10). Eligible roles: REP, LEAD, MANAGER only.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Drizzle ORM & Drizzle Kit**: Database interaction and migrations.
- **jsonwebtoken & bcryptjs**: Authentication and password security.
- **csv-parse & csv-stringify**: CSV data processing.
- **multer**: File uploads.
- **@radix-ui/*, tailwindcss, class-variance-authority, lucide-react**: UI development.
- **@tanstack/react-query, react-hook-form, zod**: State management, forms, and validation.
- **QuickBooks Online Integration**: Deep OAuth 2.0 integration for payment sync, account mapping, reconciliation, and monitoring.
- **pdfkit**: PDF generation (pay stubs).
- **pdf-lib**: PDF generation (onboarding documents).
- **archiver**: ZIP archive generation.
- **Background Scheduler**: Manages automated tasks.
- **Email Notifications**: Queue-based system for user notifications via SMTP.
- **Automated Alerts System**: Sends alerts for various events.
- **Claude AI (Replit AI Integrations, claude-sonnet-4-6)**: Used for intelligent order matching in the Install Sync feature.

## Quality Assurance
- **Centralized Config**: `server/config.ts` centralizes all environment variables with required/optional patterns.
- **Database Indexes**: 26 indexes on high-traffic columns (sales_orders, override_earnings, ar_expectations, users, pay_statements, onboarding tables).
- **Startup Health Checks**: Server verifies DB connection, JWT configuration, and rate card availability on boot.
- **Scheduler Concurrency**: All scheduled jobs wrapped in `runJobWithLock()` to prevent concurrent execution.
- **Onboarding Access Gate**: REP/MDU/LEAD users without completed onboarding are blocked from app routes (403 with redirect).
- **Auth Isolation**: Main auth middleware rejects onboarding-purpose JWTs; onboarding auth rejects main app JWTs.
- **Sensitive Data Stripping**: All user-returning endpoints strip passwordHash and onboardingOtpHash; encrypted fields stripped from submission detail responses.
- **Global Error Handler**: Catches unhandled errors, returns structured JSON, hides stack traces in production.