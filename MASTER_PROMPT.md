# Iron Crest CRM - Master Prompt for Replit Agent

## Project Overview

Build **Iron Crest CRM**, a comprehensive sales operations, commissions tracking, payroll system, and QuickBooks Online integration platform. The application is designed to scale from small sales teams (5 reps) to mid-size organizations (50-200 reps).

---

## Tech Stack

- **Frontend**: React 18 with TypeScript, Vite bundler, TailwindCSS, shadcn/ui components
- **Backend**: Node.js with Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT-based auth with bcrypt password hashing
- **State Management**: TanStack React Query
- **Routing**: Wouter
- **File Storage**: Replit Object Storage

---

## User Role Hierarchy (6 Tiers)

| Role | Level | Access |
|------|-------|--------|
| REP | 1 | Own orders, commissions, leads, credentials |
| SUPERVISOR | 2 | Team oversight, assigned reps' data |
| MANAGER | 3 | Department management, assigned supervisors/reps |
| EXECUTIVE | 4 | Division oversight, reporting, credentials view |
| ADMIN | 5 | Full system access, user management, accounting |
| FOUNDER | 6 | Ultimate access, all features |

Each user can be assigned to a supervisor, manager, and/or executive for hierarchical reporting.

---

## Core Business Rules

### Commission Definitions
- **Earned**: Orders where `jobStatus=COMPLETED` AND `approvalStatus=APPROVED`
- **Paid**: Orders with imported payment data (paidDate exists)
- **Chargebacks**: Negative commission entries tied to invoiceNumber; original orders are never modified
- **Immutability**: After approval, key order fields are locked; corrections require formal Adjustments

### Pay Run Status Flow
```
DRAFT → PENDING_REVIEW → PENDING_APPROVAL → APPROVED → FINALIZED
```
- **DRAFT**: Initial state, orders can be linked/unlinked
- **PENDING_REVIEW**: Submitted for accounting review
- **PENDING_APPROVAL**: Submitted for management approval
- **APPROVED**: Ready for finalization, override distributions can be created
- **FINALIZED**: Locked and immutable, triggers pay statement generation

---

## Database Schema (Key Tables)

### Core Entities
```typescript
// Users - 6-tier role hierarchy
users: {
  id, name, repId (unique), role, status (ACTIVE/DEACTIVATED),
  passwordHash, mustChangePassword, tempPasswordExpiresAt,
  assignedSupervisorId, assignedManagerId, assignedExecutiveId,
  createdAt, updatedAt, deletedAt, deletedByUserId
}

// Providers (carrier companies)
providers: { id, name, active, deletedAt, createdAt, updatedAt }

// Clients (business accounts)
clients: { id, name, active, deletedAt, createdAt, updatedAt }

// Services (product offerings)
services: { id, code (unique), name, category, unitType, active, notes }
```

### Rate Cards & Commissions
```typescript
// Rate Cards - Commission rates by provider/client/service
rateCards: {
  id, providerId, clientId, serviceId,
  mobileProductType, mobilePortedStatus,
  baseAmount, tvAddonAmount, mobilePerLineAmount,
  overrideDeduction, tvOverrideDeduction, mobileOverrideDeduction,
  effectiveStart, effectiveEnd, active
}

// Sales Orders
salesOrders: {
  id, repId, clientId, providerId, serviceId,
  dateSold, installDate, accountNumber,
  tvSold, mobileSold, mobileProductType, mobilePortedStatus, mobileLinesQty,
  customerName, customerAddress, customerPhone, customerEmail,
  jobStatus (PENDING/COMPLETED/CANCELED),
  completionDate, approvalStatus (UNAPPROVED/APPROVED/REJECTED),
  rejectionNote, approvedByUserId, approvedAt,
  invoiceNumber (unique, auto-generated),
  baseCommissionEarned, incentiveEarned, commissionSource,
  appliedRateCardId, calcAt,
  commissionPaid, paymentStatus, paidDate, payRunId,
  qbInvoiceId, qbInvoiceSyncStatus (for QuickBooks)
}

// Mobile Line Items - Individual lines per order
mobileLineItems: {
  id, salesOrderId, lineNumber,
  mobileProductType (UNLIMITED/3_GIG/1_GIG/BYOD/OTHER),
  mobilePortedStatus (PORTED/NON_PORTED),
  appliedRateCardId, commissionAmount
}

// Commission Line Items - Per-category breakdown
commissionLineItems: {
  id, salesOrderId, serviceCategory (INTERNET/MOBILE/VIDEO),
  quantity, unitAmount, totalAmount, mobileProductType, mobilePortedStatus
}
```

### Override System
```typescript
// Override Agreements - Supervisor/Manager earns from rep's sales
overrideAgreements: {
  id, recipientUserId, amountFlat,
  providerId, clientId, serviceId,
  mobileProductType, mobilePortedFilter, tvSoldFilter,
  effectiveStart, effectiveEnd, active
}

// Override Earnings - Computed per approved order
overrideEarnings: {
  id, salesOrderId, recipientUserId, sourceRepId,
  sourceLevelUsed, amount, overrideAgreementId, payRunId
}

// Override Deduction Pool - Pending for distribution
overrideDeductionPool: {
  id, salesOrderId, rateCardId, amount,
  deductionType (MOBILE/TV/BASE), status (PENDING/DISTRIBUTED), payRunId
}

// Override Distributions - Manual allocation
overrideDistributions: {
  id, payRunId, poolEntryId, recipientUserId,
  allocationType (PERCENT/FIXED), allocationValue, calculatedAmount,
  status (PENDING/APPLIED)
}
```

### Payroll System
```typescript
// Pay Runs
payRuns: {
  id, name, weekEndingDate, status, createdByUserId,
  finalizedAt, qbJournalEntryId, qbSyncStatus
}

// Pay Statements - Individual pay stubs
payStatements: {
  id, payRunId, userId, periodStart, periodEnd,
  grossCommission, overrideEarningsTotal, incentivesTotal,
  chargebacksTotal, adjustmentsTotal, deductionsTotal,
  advancesApplied, taxWithheld, netPay,
  status (DRAFT/ISSUED/PAID/VOIDED),
  ytdGross, ytdDeductions, ytdNetPay
}

// Deduction Types & User Deductions
deductionTypes: { id, name, description, isTaxable, isPreTax, active }
userDeductions: {
  id, userId, deductionTypeId,
  calculationMethod (FLAT/PERCENT), amount,
  frequency (ONE_TIME/WEEKLY/BI_WEEKLY/MONTHLY),
  effectiveStart, effectiveEnd, active
}

// Advances (draws against future commissions)
advances: {
  id, userId, requestedAmount, approvedAmount, paidAmount, remainingBalance,
  status (PENDING/APPROVED/REJECTED/PAID/REPAYING/REPAID),
  repaymentPercentage, reason, approvedById
}

// Chargebacks
chargebacks: {
  id, invoiceNumber, salesOrderId, repId, amount,
  reason (CANCELLATION/NON_PAYMENT/SERVICE_ISSUE/DUPLICATE/OTHER),
  chargebackDate, payRunId
}

// Adjustments
adjustments: {
  id, payeeType, payeeUserId, sourceRepId, invoiceNumber,
  type (BONUS/CORRECTION/PENALTY/ADVANCE/CLAWBACK/OTHER),
  amount, reason, adjustmentDate, approvalStatus
}
```

### Advanced Payroll Features
```typescript
// Bonuses/SPIFFs
bonuses: {
  id, userId, bonusType (SPIFF/PERFORMANCE/REFERRAL/RETENTION/SIGNING/CONTEST/OTHER),
  name, amount, status (PENDING/APPROVED/PAID/CANCELLED), effectiveDate
}

// Draw Accounts - Guaranteed minimum pay
drawAccounts: {
  id, userId, drawType (RECOVERABLE/NON_RECOVERABLE),
  monthlyGuarantee, currentBalance, recoveryPercentage,
  status (ACTIVE/SETTLED/FORGIVEN/SUSPENDED)
}

// Split Commission Agreements
splitCommissionAgreements: {
  id, name, primaryRepId, isActive, effectiveStart, effectiveEnd
}
splitCommissionRecipients: {
  id, agreementId, userId, splitType (PERCENT/FIXED), splitValue
}

// Commission Tiers
commissionTiers: { id, name, tierBasis, providerId, clientId, isActive }
commissionTierLevels: {
  id, tierId, minVolume, maxVolume, bonusPercentage, bonusFlat, multiplier
}

// Scheduled Pay Runs
scheduledPayRuns: {
  id, name, frequency (WEEKLY/BIWEEKLY/SEMIMONTHLY/MONTHLY),
  dayOfWeek, dayOfMonth, isActive, nextRunAt,
  autoCreatePayRun, autoLinkOrders
}
```

### QuickBooks Integration
```typescript
// OAuth connection storage
quickbooksConnection: {
  id, realmId, companyName,
  accessToken, refreshToken (encrypted),
  accessTokenExpiresAt, refreshTokenExpiresAt,
  isConnected, lastSyncAt
}

// Account mappings
quickbooksAccountMappings: {
  id, mappingType (COMMISSION_EXPENSE/ACCOUNTS_PAYABLE/CASH/INCOME),
  qbAccountId, qbAccountName, qbAccountType, isActive
}

// Sync log
quickbooksSyncLog: {
  id, entityType, entityId, syncDirection,
  qbEntityId, status, errorMessage, syncedAt
}
```

### Other Tables
```typescript
// Leads
leads: {
  id, repId, customerName, customerAddress, customerPhone, customerEmail,
  houseNumber, aptUnit, streetName, city, state, zipCode,
  disposition (NONE/SOLD/NOT_HOME/RETURN/REJECT), notHomeCount
}

// Knowledge Documents (file storage)
knowledgeDocuments: {
  id, title, description, fileName, fileType, fileSize,
  mimeType, objectPath, category, tags, uploadedById
}

// Employee Credentials (multi-entry per user)
employeeCredentials: {
  id, userId, entryLabel (e.g., "Primary", "Secondary Device"),
  peopleSoftNumber, networkId, tempPassword, workEmail,
  rtr, rtrPassword, authenticatorUsername, authenticatorPassword,
  ipadPin, deviceNumber, gmail, gmailPassword, notes,
  lastUpdatedByUserId
}

// Email Notifications
emailNotifications: {
  id, userId, notificationType, subject, body, recipientEmail,
  status (PENDING/SENT/FAILED/SKIPPED)
}

// Notification Preferences
notificationPreferences: {
  id, userId, emailOrderApproved, emailOrderRejected,
  emailPayRunFinalized, emailChargebackApplied, emailAdvanceUpdates
}

// Audit Logs
auditLogs: {
  id, userId, action, tableName, recordId,
  beforeJson, afterJson, createdAt
}
```

---

## Frontend Pages Structure

### All Users
- `/login` - Authentication page
- `/change-password` - Password change (required after temp password)
- `/my-credentials` - Self-service credential management (multiple entries)
- `/notification-settings` - Email notification preferences
- `/my-pay-history` - Pay statements with YTD summary
- `/commission-forecast` - Personal commission projections

### REP Role
- `/` (rep-dashboard) - Personal stats, recent orders, earnings summary
- `/orders` - Create/edit own sales orders with mobile line items
- `/commissions` - View own commission breakdowns
- `/leads` - Manage assigned leads

### SUPERVISOR Role (+ REP access)
- `/` (supervisor-dashboard) - Team performance metrics
- All REP pages (filtered to team data)

### MANAGER Role (+ SUPERVISOR access)
- `/` (manager-dashboard) - Department overview
- `/approvals` - Approve/reject pending orders
- `/adjustments` - Create commission adjustments

### EXECUTIVE Role (+ MANAGER access)
- `/` (executive-dashboard) - Division-wide analytics
- `/executive-reports` - Advanced reporting
- `/sales-dashboard` - Sales performance analytics

### ADMIN Role (+ EXECUTIVE access)
- `/admin-dashboard` - System-wide overview
- `/payruns` - Pay run management with approval workflow
- `/accounting` - Financial reconciliation
- `/queues` - Exception queues (unmatched payments/chargebacks)
- `/recalculate` - Batch commission recalculation
- `/export-history` - Export batch history
- `/reports` - Comprehensive reporting
- `/knowledge` - Knowledge base document management
- `/audit` - Audit log viewer

### Admin Management Pages (`/admin/*`)
- `/admin/users` - User CRUD, role assignment, team assignment
- `/admin/providers` - Provider management
- `/admin/clients` - Client management
- `/admin/services` - Service catalog
- `/admin/rate-cards` - Commission rate configuration
- `/admin/incentives` - Incentive programs
- `/admin/overrides` - Override agreement setup
- `/admin/employee-credentials` - Manage all user credentials
- `/admin/payroll` - Payroll settings (schedules, deductions, advances)
- `/admin/payroll-advanced` - Advanced payroll features (bonuses, draws, splits, tiers, 1099s, ACH)
- `/admin/quickbooks` - QuickBooks OAuth connection and sync management

---

## API Routes Structure

### Authentication
```
POST /api/auth/login - JWT login
POST /api/auth/logout - Clear session
GET /api/auth/me - Current user info
POST /api/auth/change-password - Change password
```

### Sales Orders
```
GET /api/orders - List orders (role-filtered)
POST /api/orders - Create order
GET /api/orders/:id - Get single order
PATCH /api/orders/:id - Update order
DELETE /api/orders/:id - Soft delete
POST /api/orders/:id/calculate - Calculate commission
```

### Approvals
```
GET /api/approvals/pending - Pending orders for approval
POST /api/approvals/:id/approve - Approve order
POST /api/approvals/:id/reject - Reject order with note
```

### Pay Runs
```
GET /api/payruns - List pay runs
POST /api/payruns - Create pay run
GET /api/payruns/:id - Get pay run with linked orders
POST /api/payruns/:id/link-orders - Link approved orders
POST /api/payruns/:id/unlink-order/:orderId - Unlink order
POST /api/payruns/:id/submit-review - Submit for review
POST /api/payruns/:id/submit-approval - Submit for approval
POST /api/payruns/:id/approve - Approve pay run
POST /api/payruns/:id/reject - Reject to draft
POST /api/payruns/:id/finalize - Finalize (generate statements)
GET /api/payruns/:id/variance - Check blocking conditions
```

### Override Distribution (APPROVED pay runs only)
```
GET /api/payruns/:id/override-pool - Get pool entries
GET /api/payruns/:id/distributions - Get distributions
POST /api/payruns/:id/distributions - Create distribution
DELETE /api/payruns/:id/distributions/:distId - Delete distribution
```

### Employee Credentials (Self-Service)
```
GET /api/my-credentials - Get current user's all entries
POST /api/my-credentials - Create new entry
PATCH /api/my-credentials/:credentialId - Update entry (ownership verified)
DELETE /api/my-credentials/:credentialId - Delete entry (ownership verified)
```

### Admin Routes
```
GET /api/admin/users - List all users
POST /api/admin/users - Create user
PATCH /api/admin/users/:id - Update user
POST /api/admin/users/:id/reset-password - Reset password

GET/POST/PATCH/DELETE /api/admin/providers
GET/POST/PATCH/DELETE /api/admin/clients
GET/POST/PATCH/DELETE /api/admin/services
GET/POST/PATCH/DELETE /api/admin/rate-cards
GET/POST/PATCH/DELETE /api/admin/incentives
GET/POST/PATCH/DELETE /api/admin/overrides

GET /api/admin/employee-credentials - All credentials
GET /api/admin/employee-credentials/user/:userId - User's credentials
POST /api/admin/employee-credentials/:userId - Create for user
PATCH /api/admin/employee-credentials/:credentialId - Update entry
DELETE /api/admin/employee-credentials/:credentialId - Delete entry
```

### QuickBooks Integration
```
GET /api/quickbooks/auth-url - Get OAuth URL
GET /api/quickbooks/callback - OAuth callback
GET /api/quickbooks/status - Connection status
POST /api/quickbooks/disconnect - Disconnect
GET /api/quickbooks/accounts - Fetch QB accounts
POST /api/quickbooks/account-mappings - Save mappings
POST /api/quickbooks/sync-invoice/:orderId - Sync invoice
POST /api/quickbooks/sync-journal/:payRunId - Post journal entry
```

### Dashboard & Reports
```
GET /api/dashboard/rep - Rep dashboard stats
GET /api/dashboard/supervisor - Supervisor stats
GET /api/dashboard/manager - Manager stats
GET /api/dashboard/executive - Executive stats
GET /api/dashboard/admin - Admin stats
GET /api/commission-forecast - Personal forecast
GET /api/admin/commission-forecast - Team forecast
```

---

## Background Scheduler Jobs

The server runs a background scheduler with these automated tasks:

1. **Scheduled Pay Runs** (every 1 minute)
   - Checks `scheduledPayRuns` for due runs
   - Auto-creates pay runs based on schedule
   - Optionally auto-links eligible orders

2. **Chargeback Auto-Matching** (every 5 minutes)
   - Retries matching unmatched chargebacks to orders by invoice number

3. **Email Notification Sender** (every 1 minute)
   - Processes pending emails from `emailNotifications` queue
   - Respects user notification preferences

---

## Key Implementation Details

### Authentication Middleware
```typescript
// Use 'auth' middleware and 'AuthRequest' type
import { auth, AuthRequest } from "./auth";

app.get("/api/protected", auth, async (req: AuthRequest, res) => {
  const user = req.user!; // Guaranteed to exist after auth
});
```

### Audit Logging
```typescript
// Use beforeJson/afterJson fields (not oldData/newData)
await storage.createAuditLog({
  userId: user.id,
  action: "UPDATE",
  tableName: "sales_orders",
  recordId: orderId,
  beforeJson: JSON.stringify(before),
  afterJson: JSON.stringify(after),
});
```

### Commission Calculation Flow
1. Find matching rate card by provider/client/service/dates
2. Calculate base commission from `baseAmount`
3. Add TV addon if `tvSold=true` using `tvAddonAmount`
4. For mobile: process each line item individually with `mobilePerLineAmount`
5. Match override agreements for applicable uplines
6. Create commission line items for breakdown
7. Create override deduction pool entries

### Invoice Number Generation
- Auto-generated on order approval
- Format: `INV-YYYYMMDD-XXXXX` (5-digit sequence)
- Uses `counters` table for atomic incrementing

### Password Security
- Bcrypt with salt rounds
- Temporary passwords expire after 24 hours
- `mustChangePassword` flag forces password change on login

---

## Environment Variables Required

```
DATABASE_URL - PostgreSQL connection string
SESSION_SECRET - Session encryption key
JWT_SECRET - Token signing secret (required, no fallback)

# QuickBooks (optional)
QB_CLIENT_ID - QuickBooks OAuth client ID
QB_CLIENT_SECRET - QuickBooks OAuth client secret
QB_REDIRECT_URI - OAuth callback URL
QB_ENVIRONMENT - "sandbox" or "production"

# Email (optional)
SMTP_HOST - SMTP server hostname
SMTP_USER - SMTP username
SMTP_PASSWORD - SMTP password
```

---

## Security Features

- Rate limiting on auth endpoints (10 attempts/15 minutes/IP)
- File upload validation (10MB max, whitelist extensions)
- Input sanitization via explicit field extraction
- Role-based access control on all endpoints
- Ownership verification on self-service routes
- Soft deletes with audit trail

---

## Default Users (Bootstrap)

On first run, create:
1. **FOUNDER** account: repId `F01`, password `founder123`
2. **ADMIN** account: repId `A01`, password `admin123`

Both should have `mustChangePassword=true`.

---

## Build Instructions

1. Set up PostgreSQL database
2. Configure environment variables
3. Run `npm run db:push` to create schema
4. Start with `npm run dev` (Express + Vite)
5. Access at port 5000

The application will auto-bootstrap default users on first startup.
