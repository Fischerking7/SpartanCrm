# SalesOps Pro - Master Class Rebuild Prompt

Use this complete prompt to recreate the SalesOps Pro application from scratch. This document contains all requirements, data models, business logic, and technical specifications.

---

## 1. APPLICATION OVERVIEW

### Vision
Build a production-ready Sales Operations, Commissions Tracking, and QuickBooks Reconciliation platform for scaling from small teams (5 reps) to mid-size organizations (50-200 reps).

### Core Capabilities
- Role-based access control with 6-tier hierarchy
- Sales order management with approval workflows
- Commission calculations with rate cards and overrides
- QuickBooks payment and chargeback import/reconciliation
- Lead management with external lookup services
- Knowledge document repository
- Comprehensive audit logging
- Excel import/export workflows

### Tech Stack
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, shadcn/ui (Radix primitives)
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: JWT-based with bcrypt password hashing
- **State Management**: TanStack React Query
- **Routing**: Wouter

---

## 2. ROLE HIERARCHY & PERMISSIONS

### Six-Tier Hierarchy (lowest to highest authority)
```
REP (1) < SUPERVISOR (2) < MANAGER (3) < EXECUTIVE (4) < ADMIN (5) < FOUNDER (6)
```

### Role Capabilities

| Capability | REP | SUPERVISOR | MANAGER | EXECUTIVE | ADMIN | FOUNDER |
|------------|-----|------------|---------|-----------|-------|---------|
| View own orders/commissions | Yes | Yes | Yes | Yes | Yes | Yes |
| View team orders | No | Direct reps | Org tree | All | All | All |
| Create orders | Yes | Yes | Yes | Yes | Yes | Yes |
| Approve orders | No | No | No | Yes | Yes | Yes |
| Manage users | No | No | No | No | Yes | Yes |
| Configure rate cards | No | No | No | No | Yes | Yes |
| Accounting functions | No | No | No | View | Full | Full |
| System configuration | No | No | No | No | Yes | Yes |

### Org Hierarchy Assignment
- REPs are assigned to a SUPERVISOR
- SUPERVISORs are assigned to a MANAGER
- MANAGERs are assigned to an EXECUTIVE
- This creates a tree structure for visibility and override calculations

### Password Reset Authority
- FOUNDER: Can reset any password
- ADMIN: Can reset any except FOUNDER
- MANAGER: Can reset SUPERVISOR and REP in their org tree
- SUPERVISOR: Can reset only their assigned REPs
- REP: Self-service only (change own password)

---

## 3. DATABASE SCHEMA

### Core Tables

#### users
```sql
- id: UUID primary key
- name: text (display name)
- repId: text unique (login identifier, e.g., "A01", "R123")
- role: enum (REP, SUPERVISOR, MANAGER, EXECUTIVE, ADMIN, FOUNDER)
- status: enum (ACTIVE, DEACTIVATED)
- passwordHash: text
- mustChangePassword: boolean (for temp passwords)
- tempPasswordExpiresAt: timestamp
- assignedSupervisorId: FK to users
- assignedManagerId: FK to users
- assignedExecutiveId: FK to users
- deletedAt: timestamp (soft delete)
- deletedByUserId: FK to users
- createdAt, updatedAt: timestamps
```

#### providers
```sql
- id: UUID primary key
- name: text unique (e.g., "Frontier", "AT&T")
- active: boolean
- deletedAt, deletedByUserId, createdAt, updatedAt
```

#### clients
```sql
- id: UUID primary key
- name: text unique (e.g., "DISH", "DirectTV")
- active: boolean
- deletedAt, deletedByUserId, createdAt, updatedAt
```

#### services
```sql
- id: UUID primary key
- code: text unique (e.g., "FIOS-100", "MOBILE-UNL")
- name: text
- category: text (optional)
- unitType: text (optional)
- active: boolean
- notes: text
- deletedAt, deletedByUserId, createdAt, updatedAt
```

#### rate_cards
```sql
- id: UUID primary key
- providerId: FK to providers (required)
- clientId: FK to clients (optional, null = any client)
- serviceId: FK to services (optional, null = any service)
- mobileProductType: enum (UNLIMITED, 3_GIG, 1_GIG, BYOD, OTHER) - for mobile rate matching
- mobilePortedStatus: enum (PORTED, NON_PORTED) - for mobile rate matching
- baseAmount: decimal (base internet commission)
- tvAddonAmount: decimal (additional TV commission)
- mobilePerLineAmount: decimal (per mobile line commission)
- overrideDeduction: decimal (amount pooled for hierarchy overrides - base/internet)
- tvOverrideDeduction: decimal (amount pooled for TV overrides)
- mobileOverrideDeduction: decimal (amount pooled per mobile line)
- effectiveStart: date
- effectiveEnd: date (null = no end)
- active: boolean
- deletedAt, deletedByUserId, createdAt, updatedAt
```

#### sales_orders
```sql
- id: UUID primary key
- repId: text (the selling rep's ID)
- clientId, providerId, serviceId: FKs
- dateSold: date
- installDate: date (optional)
- accountNumber: text
- tvSold: boolean
- mobileSold: boolean
- mobileProductType: enum (legacy aggregate)
- mobilePortedStatus: enum (legacy aggregate)
- mobileLinesQty: integer
- customerName, customerAddress, customerPhone, customerEmail: text
- jobStatus: enum (PENDING, COMPLETED, CANCELED)
- completionDate: date
- approvalStatus: enum (UNAPPROVED, APPROVED, REJECTED)
- rejectionNote: text
- approvedByUserId: FK, approvedAt: timestamp
- invoiceNumber: text unique (auto-generated on approval: INV-YYYYMMDD-XXXX)
- exportedToAccounting: boolean
- exportBatchId: FK, exportedAt: timestamp
- baseCommissionEarned, incentiveEarned, commissionPaid: decimal
- commissionSource: enum (CALCULATED, MANUAL_OVERRIDE)
- appliedRateCardId: FK
- calcAt: timestamp
- paymentStatus: enum (UNPAID, PARTIALLY_PAID, PAID)
- paidDate: date
- quickbooksRefId: text
- payRunId: FK
- createdAt, updatedAt: timestamps
```

#### mobile_line_items
```sql
- id: UUID primary key
- salesOrderId: FK
- lineNumber: integer
- mobileProductType: enum
- mobilePortedStatus: enum
- appliedRateCardId: FK
- commissionAmount: decimal
- createdAt: timestamp
```

#### commission_line_items
```sql
- id: UUID primary key
- salesOrderId: FK
- serviceCategory: enum (INTERNET, MOBILE, VIDEO)
- quantity: integer
- unitAmount, totalAmount: decimal
- mobileProductType, mobilePortedStatus: enum (for mobile lines)
- appliedRateCardId: FK
- createdAt: timestamp
```

#### override_agreements
```sql
- id: UUID primary key
- recipientUserId: FK (who receives the override)
- amountFlat: decimal (flat rate per qualifying order/line)
- providerId, clientId, serviceId: FKs (optional filters)
- mobileProductType, mobilePortedFilter, tvSoldFilter: optional filters
- effectiveStart, effectiveEnd: dates
- active: boolean
- notes: text
- createdAt, updatedAt
```

#### override_earnings
```sql
- id: UUID primary key
- salesOrderId: FK
- recipientUserId: FK
- sourceRepId: text
- sourceLevelUsed: enum (REP, SUPERVISOR, MANAGER, EXECUTIVE, ADMIN)
- amount: decimal
- overrideAgreementId: FK
- payRunId: FK
- createdAt: timestamp
```

#### override_deduction_pool
```sql
- id: UUID primary key
- salesOrderId: FK
- rateCardId: FK
- amount: decimal
- deductionType: enum (BASE, TV, MOBILE)
- status: enum (PENDING, DISTRIBUTED)
- exportBatchId: FK
- distributedAt: timestamp
- createdAt: timestamp
```

#### chargebacks
```sql
- id: UUID primary key
- invoiceNumber: text
- salesOrderId: FK (optional - may not match)
- repId: text
- amount: decimal (always positive)
- reason: enum (CANCELLATION, NON_PAYMENT, SERVICE_ISSUE, DUPLICATE, OTHER)
- chargebackDate: date
- quickbooksRefId: text
- payRunId: FK
- notes: text
- createdByUserId: FK
- createdAt: timestamp
```

#### adjustments
```sql
- id: UUID primary key
- payeeType: enum (REP, SUPERVISOR, MANAGER, EXECUTIVE, ADMIN)
- payeeUserId: FK
- sourceRepId: text (optional)
- invoiceNumber: text (optional)
- type: enum (BONUS, CORRECTION, PENALTY, ADVANCE, CLAWBACK, OTHER)
- amount: decimal
- reason: text
- adjustmentDate: date
- createdByUserId: FK
- approvalStatus: enum (UNAPPROVED, APPROVED, REJECTED)
- approvedByUserId: FK, approvedAt: timestamp
- createdAt: timestamp
```

#### pay_runs
```sql
- id: UUID primary key
- weekEndingDate: date unique
- status: enum (DRAFT, FINALIZED)
- createdByUserId: FK
- createdAt, finalizedAt: timestamps
```

#### leads
```sql
- id: UUID primary key
- repId: text (assigned rep)
- customerName, customerAddress, customerPhone, customerEmail: text
- houseNumber, aptUnit, streetName, street: text (parsed address components)
- city, state, zipCode: text
- accountNumber: text
- customerStatus, discoReason: text
- notes: text
- disposition: enum (NONE, SOLD, NOT_HOME, RETURN, REJECT)
- dispositionAt: timestamp
- importedAt, importedBy: tracking
- status: text (NEW, WORKING, etc.)
- deletedAt, deletedByUserId: soft delete
- createdAt, updatedAt
```

#### knowledge_documents
```sql
- id: UUID primary key
- title, description: text
- fileName, mimeType, objectPath: text
- fileType: enum (PDF, WORD, IMAGE, OTHER)
- fileSize: integer
- category: text (Training, Policies, Procedures, Product Info, Sales Materials, Templates, Other)
- tags: text[] array
- uploadedById: FK
- deletedAt, deletedByUserId
- createdAt, updatedAt
```

#### Exception Queues
- unmatched_payments: rawRowJson, reason, resolvedByUserId, resolvedAt, resolutionNote
- unmatched_chargebacks: same structure
- rate_issues: salesOrderId, type (MISSING_RATE, CONFLICT_RATE), details, resolution fields

#### audit_logs
```sql
- id: UUID primary key
- action: text (login, create_order, approve_order, etc.)
- tableName: text
- recordId: text
- beforeJson, afterJson: text (JSON snapshots)
- userId: FK
- createdAt: timestamp
```

#### counters
```sql
- key: text primary key (e.g., "invoice_number")
- value: integer (auto-incrementing counter)
```

---

## 4. COMMISSION CALCULATION LOGIC

### Order Approval Flow
1. Order created with status UNAPPROVED, jobStatus PENDING
2. Rep marks jobStatus = COMPLETED when install is done
3. EXECUTIVE+ approves the order
4. On approval:
   - Find matching rate card (provider + client + service + effectiveDate)
   - Calculate base commission from rate card
   - Add TV addon if tvSold = true
   - Calculate mobile line commissions per line (using mobile_line_items)
   - Generate invoice number (INV-YYYYMMDD-XXXX)
   - Pool override deductions for later distribution
   - Generate override earnings for hierarchy

### Rate Card Matching Priority
1. Exact match: provider + client + service
2. Provider + client (any service)
3. Provider only (any client, any service)
4. Date range: effectiveStart <= dateSold <= effectiveEnd (or effectiveEnd is null)

### Mobile Line Commission
Each mobile line is tracked individually:
- Find rate card matching mobileProductType and mobilePortedStatus
- Apply mobilePerLineAmount from rate card
- Pool mobileOverrideDeduction per line
- Store in mobile_line_items table

### Override Calculation
When order is approved:
1. Get the selling rep's assigned supervisor, manager, executive
2. For each level in hierarchy with an override agreement:
   - Check if agreement filters match (provider, client, service, mobileProductType, etc.)
   - Create override_earning record with the flat amount
3. Pool rate card deductions to override_deduction_pool for later distribution

### Commission Recalculation
- Can be triggered for individual orders or all approved orders
- Deletes existing commission_line_items and mobile_line_items
- Recalculates using current rate cards
- Preserves override agreements

---

## 5. BUSINESS RULES

### Core Definitions
- **Earned**: Orders where jobStatus=COMPLETED AND approvalStatus=APPROVED
- **Paid**: Orders with paidDate (imported from QuickBooks)
- **Chargebacks**: Negative entries tied to invoiceNumber; original orders are NEVER modified
- **Immutability**: After approval, key order fields are locked; corrections require formal Adjustments

### Invoice Number Generation
Format: `INV-YYYYMMDD-XXXX` where XXXX is a sequential number per day
Use atomic counter increment to prevent duplicates

### Soft Delete Pattern
All main entities use soft delete:
- `deletedAt` timestamp (null = active)
- `deletedByUserId` for audit trail
- Queries filter `WHERE deletedAt IS NULL`

---

## 6. API ENDPOINTS

### Authentication
- POST /api/auth/login (rate limited: 10/15min)
- GET /api/auth/me
- PUT /api/users/me/password (self-service password change)
- POST /api/users/:id/password-reset (rate limited, authority checked)

### Orders
- GET /api/orders (role-filtered)
- POST /api/orders
- GET /api/orders/:id
- GET /api/orders/:id/commission-lines
- POST /api/orders/:id/recalculate-commission

### Admin - Approvals
- GET /api/admin/approvals/queue
- POST /api/admin/orders/:id/approve (EXECUTIVE+)
- POST /api/admin/orders/:id/reject
- POST /api/admin/orders/bulk-approve

### Admin - Configuration
- CRUD: /api/admin/users, /api/admin/providers, /api/admin/clients, /api/admin/services, /api/admin/rate-cards
- GET /api/admin/overrides, POST /api/admin/overrides

### Admin - Accounting
- POST /api/admin/accounting/export-approved (creates CSV, marks exported)
- POST /api/admin/accounting/import-payments (CSV with invoiceNumber matching)
- POST /api/admin/chargebacks/import
- GET /api/admin/accounting/export-batches
- GET /api/admin/override-pool

### Admin - Pay Runs
- CRUD: /api/admin/payruns
- POST /api/admin/payruns/:id/link-orders
- POST /api/admin/payruns/:id/finalize

### Leads
- GET /api/leads (role-filtered)
- POST /api/leads
- PATCH /api/leads/:id
- POST /api/leads/import (Excel with column matching)
- POST /api/leads/bulk-delete
- POST /api/leads/bulk-assign

### Reports
- GET /api/reports/production
- GET /api/reports/summary
- GET /api/reports/sales-by-rep
- GET /api/commissions (role-filtered)

### Dashboard
- GET /api/dashboard/stats (role-appropriate)
- GET /api/dashboard/production
- GET /api/dashboard/next-day-installs

### Knowledge Database
- GET /api/knowledge/documents
- POST /api/knowledge/documents (with file upload to object storage)
- DELETE /api/knowledge/documents/:id (MANAGER+)

---

## 7. FRONTEND ARCHITECTURE

### Navigation (role-based sidebar)
All Roles:
- Dashboard
- My Orders (filtered to own)
- My Leads
- Commissions
- Knowledge Database

SUPERVISOR+:
- Team view options

EXECUTIVE+:
- Approval Queue

ADMIN+:
- User Management
- Reference Data (Providers, Clients, Services)
- Rate Cards
- Override Agreements
- Accounting (Export, Import Payments, Chargebacks)
- Pay Runs
- Audit Log
- Exception Queues

### Key Pages
- Login with password change flow
- Dashboard with role-appropriate stats
- Orders list with filters, create/edit modal
- Leads list with import, bulk actions, external lookup links
- Commissions breakdown table
- Knowledge document library with upload

### External Lookup Integration
Leads page provides lookup buttons:
- TruePeopleSearch: `https://www.truepeoplesearch.com/results?streetaddress={street}&citystatezip={state}+{zip5}`
- FastPeopleSearch: `https://www.fastpeoplesearch.com/address/{street}-{city}-{state}-{zip}_id`

Note: Use only 5-digit ZIP (not ZIP+4), format addresses with dashes for FastPeopleSearch

---

## 8. SECURITY FEATURES

### Rate Limiting
- express-rate-limit on auth endpoints
- 10 attempts per 15 minutes per IP
- Trust proxy enabled for correct IP detection

### File Upload Validation
- 10MB max file size
- File type whitelist: xlsx, xls, csv (by extension)
- 10,000 row maximum per import
- MIME type checking

### Input Sanitization
- Update routes use explicit field extraction (whitelist approach)
- Never spread req.body directly to database updates
- Role changes only through dedicated endpoints

### Password Security
- bcrypt with salt rounds for hashing
- Temporary passwords with expiration
- Must-change-password flag for first login
- Authority checks for password resets

### Audit Logging
- All sensitive operations logged
- Before/after JSON snapshots
- User ID tracking
- Timestamps

---

## 9. IMPORT/EXPORT WORKFLOWS

### Order Import (Excel)
Columns: repId, customerName, dateSold, installDate, accountNumber, providerName, clientName, serviceName, tvSold, mobileSold, mobileLinesQty, mobileProductType, mobilePortedStatus, jobStatus, customerAddress, customerPhone, customerEmail

### Lead Import (Excel)
Flexible column matching with normalization:
- house_number, apt_unit, street_name, street
- city, state, zip_code
- customer_name, customer_phone, customer_email
- account_number, customer_status, disco_reason, notes

### Payment Import (CSV)
Columns: invoiceNumber, amount, paidDate, refId
Matches to orders by invoiceNumber, creates unmatched_payments if no match

### Chargeback Import (CSV)
Columns: invoiceNumber, amount, chargebackDate, reason, notes, refId
Creates chargeback record linked to order if found

### Accounting Export (CSV)
Exports approved, unexported orders with commission details
Creates export batch record, marks orders as exported

---

## 10. KNOWLEDGE DATABASE

### Features
- Upload PDFs, Word docs, images to Replit Object Storage
- Organize by categories: Training, Policies, Procedures, Product Info, Sales Materials, Templates, Other
- Tag support for search
- All users can view and upload
- MANAGER+ can delete

### File Storage
- Use Replit Object Storage integration
- Store file path in objectPath field
- Generate signed URLs for access

---

## 11. BOOTSTRAP BEHAVIOR

### First Run
1. Check if FOUNDER user exists
2. If not, create with repId from FOUNDER_REP_ID env var (default: "FOUNDER")
3. Password from FOUNDER_PASSWORD env var (required for creation)
4. Similarly bootstrap ADMIN user with ADMIN_REP_ID and ADMIN_PASSWORD

---

## 12. ENVIRONMENT VARIABLES

Required:
- DATABASE_URL: PostgreSQL connection string
- JWT_SECRET: Token signing secret (no fallback - required)
- SESSION_SECRET: Session encryption key

Optional:
- FOUNDER_REP_ID, FOUNDER_PASSWORD: Bootstrap founder
- ADMIN_REP_ID, ADMIN_PASSWORD: Bootstrap admin
- RESET_TTL_HOURS: Temp password validity (default: 24)

---

## 13. DATABASE INDEXES

Add indexes for performance on high-volume queries:
- sales_orders: repId, dateSold, jobStatus, approvalStatus, paymentStatus
- leads: repId, disposition, status, deletedAt
- users: repId, role, status, assignedSupervisorId, assignedManagerId
- audit_logs: userId, action, createdAt, tableName

---

## 14. ACCEPTANCE CRITERIA

### Order Lifecycle
1. Rep creates order -> UNAPPROVED, PENDING
2. Rep marks COMPLETED when installed
3. Executive approves -> calculates commission, generates invoice
4. Accounting exports -> marks exportedToAccounting
5. Payment import -> matches by invoiceNumber, sets paidDate

### Commission Accuracy
- Base commission matches rate card for provider/client/service
- TV addon added only when tvSold = true
- Each mobile line calculated individually with matching rate card
- Overrides generated for hierarchy based on active agreements

### Role Enforcement
- REP sees only own data
- SUPERVISOR sees own + direct reports
- MANAGER sees own + full org tree
- EXECUTIVE+ sees all, can approve
- ADMIN+ can configure everything

### Audit Trail
- Every create/update/delete logged
- Password changes and resets logged
- Approvals logged with approver info
- Import/export operations logged

---

## END OF MASTER CLASS PROMPT

This document should be sufficient to rebuild the SalesOps Pro application from scratch with all business logic, data models, and technical specifications intact.
