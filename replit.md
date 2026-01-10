# Iron Crest CRM - Replit Configuration

## Overview

Iron Crest CRM is a comprehensive full-stack platform designed for sales operations, commissions tracking, and QuickBooks reconciliation. It supports organizations from small teams to mid-size enterprises by offering robust role-based access control, automated commission calculations, payment and chargeback management, and detailed audit logging. The platform aims to streamline sales processes, ensure accurate and timely commission payouts, and integrate seamlessly with financial systems.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Tech Stack
- **Frontend**: React 18 with TypeScript, Vite, TailwindCSS
- **Backend**: Node.js with Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT-based with bcrypt hashing
- **UI Components**: shadcn/ui (Radix primitives)

### Project Structure
The application uses a monorepo structure:
- `client/` for the React frontend
- `server/` for the Express backend API
- `shared/` for common TypeScript types and Drizzle schema
- `migrations/` for database migration files

### Role-Based Access Control
The system implements seven distinct user roles (REP, MDU, SUPERVISOR, MANAGER, EXECUTIVE, ADMIN, OPERATIONS) with strict data isolation and permissions tailored to sales operations.

### Core Business Logic
- **Earned Commissions**: Defined by orders with `jobStatus=COMPLETED` and `approvalStatus=APPROVED`.
- **Paid Commissions**: Linked to orders with imported payment data from QuickBooks.
- **Chargebacks**: Handled as negative commission entries, separate from original orders.
- **Immutability**: Approved order fields are locked, requiring formal Adjustments for changes.

### Commission Terminology (Exports)
- **Base Commission**: The base rate from the rate card (`baseCommissionEarned` on orders).
- **Incentive**: Additional incentive earnings (`incentiveEarned` on orders).
- **Gross Commission**: Base Commission + Incentive (total before deductions).
- **Override**: Override deduction amount taken from the commission pool.
- **Net Commission**: Gross Commission - Override (what the rep actually receives).

### Database Schema Highlights
Key entities include Users, Clients, SalesOrders, Incentives, Chargebacks, PayRuns, and an extensive payroll system covering Pay Statements, Deductions, Advances, and Tax Profiles. Specific tables exist for MobileLineItems and CommissionLineItems to support granular tracking.

### Key Features
- **Payroll System**: Manages pay statements, deductions, advances, and year-to-date tracking with a rep-facing "My Pay" page and admin settings.
- **Multi-Stage Pay Run Approval Workflow**: A workflow with DRAFT, PENDING_REVIEW, PENDING_APPROVAL, APPROVED, and FINALIZED stages, including rejection capabilities and variance reporting.
- **Manual Override Distribution System**: Allows flexible distribution of override-eligible amounts from a central pool to any eligible user, with detailed tracking and allocation options.
- **Knowledge Database**: A central repository for reference documents (PDFs, Word, images) categorized for easy access, with role-based upload and deletion permissions.
- **Mobile Line Tracking**: Tracks individual mobile lines within sales orders, enabling specific commission calculations and override agreement matching per line.
- **MDU Staging Order Workflow**: MDU role users submit orders to a staging table for admin review. Orders have PENDING/APPROVED/REJECTED status. Approved orders are promoted to the main sales_orders table.
- **Advanced Payroll**: Features for 1099-NEC generation, ACH/Direct Deposit exports, flexible Bonuses & SPIFFs, Draw Against Commission, Split Commission Agreements, Commission Tiers & Caps, Scheduled Pay Runs, Commission Forecasting, and a comprehensive Payroll Reports Dashboard.
- **API Design**: RESTful endpoints secured with JWT authentication and comprehensive audit logging for sensitive operations.
- **Frontend Architecture**: Utilizes React Query for server state, Wouter for routing, React Hook Form with Zod for forms, and supports light/dark themes.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Drizzle ORM & Drizzle Kit**: For database interaction and migrations.
- **jsonwebtoken & bcryptjs**: For authentication and password security.
- **csv-parse & csv-stringify**: For CSV data processing.
- **multer**: For handling file uploads.
- **@radix-ui/*, tailwindcss, class-variance-authority, lucide-react**: For UI development.
- **@tanstack/react-query, react-hook-form, zod**: For state management, forms, and validation.
- **QuickBooks Online Integration**: OAuth 2.0 connection for invoice syncing, journal entry posting, and account mapping. Requires `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI`, `QB_ENVIRONMENT`.
- **Background Scheduler**: Manages automated tasks like scheduled pay run creation, chargeback auto-matching, and email notifications.
- **Email Notifications**: Queue-based system for user notifications via SMTP. Requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`.
- **Automated Alerts System**: Background jobs for pending approval alerts (orders pending > X days, every 6 hours) and low performance warnings (reps below 50% quota, daily check after day 7). In-app notification center at `/notifications` with read/unread tracking. Notification types include ORDER_APPROVED, ORDER_REJECTED, PENDING_APPROVAL_ALERT, CHARGEBACK_ALERT, LOW_PERFORMANCE_WARNING, and PAY_RUN_FINALIZED.
- **Enhanced Reporting System**: Comprehensive reports page with multiple tabs including Profitability Analysis (revenue, margins, commission costs by provider/client) and Product Mix Analysis (commission cost breakdown by service type and provider). Features customizable date ranges, scheduled report exports with daily/weekly/monthly frequencies, and role-based access control (MANAGER+ for advanced reports).
- **Mobile Optimization**: Simplified mobile-first order entry page at `/mobile-entry` with Quick Entry mode for high-volume data entry. Features include large touch targets, persistent provider/client/service selection in quick mode, recent orders tracking, and streamlined forms for field reps.