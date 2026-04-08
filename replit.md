# Iron Crest CRM

## Overview
Iron Crest CRM is a comprehensive platform designed to streamline sales operations, automate commission tracking, and facilitate QuickBooks reconciliation. It aims to enhance sales efficiency, ensure accurate and timely commission payouts, and integrate seamlessly with financial systems, supporting various organizational sizes with robust role-based access and detailed audit logging. Key capabilities include automated commission calculations, payment and chargeback management, and a full compensation plan with tiered payouts and override approvals. The platform also features extensive payroll management, a knowledge database, mobile line tracking, and advanced AI-powered order matching and data capture functionalities.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Tech Stack
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT-based
- **UI Components**: shadcn/ui

### Core Architectural Decisions
- **Monorepo Structure**: Organized into `client/`, `server/`, `shared/`, and `migrations/`.
- **Role-Based Access Control**: Granular permissions across nine distinct user roles, including an EXECUTIVE view mode and a centralized `permissions.ts` system.
- **Commission Management**: Handles Earned/Paid Commissions, Chargebacks, immutability, and role-based overrides with a dedicated approval workflow and compensation plan.
- **Payroll System**: Comprehensive management of pay statements, deductions, advances, YTD tracking, multi-stage approval, 1099-NEC generation, ACH exports, and forecasting.
- **Knowledge Database**: Centralized, role-permissioned repository for reference documents.
- **Mobile Optimization**: Fully responsive design for field sales and mobile order entry.
- **User Activity Tracking**: Logs user logins, device types, and page usage with IP geolocation.
- **Financial Reconciliation**: Client finance data import, multi-factor auto-matching, and per-service AR tracking with audit logging and commission cascading.
- **AI-Powered Order Matching (Install Sync)**: Automates matching installation records against CRM orders using Claude AI, with carrier-specific profiles and admin UI for management.
- **Automated Payroll Pipeline**: End-to-end payroll automation from AR-gated readiness to pay stub generation and accounting reconciliation.
- **Dedicated User Interfaces**: Specialized desktop interfaces for Operations (12 screens), Accounting (8 screens), Director (5 screens), and Executive (5 screens), each with role-specific dashboards and functionalities.
- **Reporting System**: Role-based dashboards with six API endpoints for comprehensive reporting and performance monitoring.
- **Predictive Intelligence**: Five integrated features for risk scoring, performance prediction, AR collection, profit anomaly detection, and cash flow projection.
- **Contractor Onboarding System**: OTP-gated portal for 1099 contractors, including e-signature, document generation, admin review, compliance tracking, and audit logging.
- **AI Screenshot-to-Order Capture**: Mobile-first feature using Claude AI vision to extract order details from screenshots and pre-populate forms, with images stored securely.
- **Negative Balance Carry-Forward**: Floors negative net pay to $0 and carries forward the outstanding balance to future pay periods.
- **Rolling Reserve System**: Implements a comprehensive chargeback and rolling reserve policy with withholding, chargeback deductions, equipment recovery, separation handling, and maturity-based release.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Drizzle ORM & Drizzle Kit**: Database interaction.
- **jsonwebtoken & bcryptjs**: Authentication.
- **csv-parse & csv-stringify**: CSV processing.
- **multer**: File uploads.
- **@radix-ui/*, tailwindcss, class-variance-authority, lucide-react**: UI frameworks and icons.
- **@tanstack/react-query, react-hook-form, zod**: Frontend state, forms, and validation.
- **QuickBooks Online Integration**: OAuth 2.0 integration for financial sync.
- **pdfkit & pdf-lib**: PDF generation.
- **archiver**: ZIP archive generation.
- **Background Scheduler**: Task automation.
- **SMTP**: Email notifications.
- **Claude AI (Replit AI Integrations, claude-sonnet-4-6)**: Used for Install Sync and AI Screenshot-to-Order Capture.