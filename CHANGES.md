# Iron Crest CRM — Comprehensive Audit Changes Log

Generated during the full-system audit pass.

---

## Phase 1 — Dependency and Environment Audit

### [REMOVED] 15 unused packages
Files: package.json
Packages: @jridgewell/trace-mapping, connect-pg-simple, express-session, google-auth-library, memorystore, passport, passport-local, tw-animate-css, ws, zod-validation-error, @types/connect-pg-simple, @types/express-session, @types/passport, @types/passport-local, @types/ws
Reason: Identified by depcheck as unused — no imports reference them anywhere in the codebase

### [ADDED] Centralized config module
File: server/config.ts
Reason: Centralizes all environment variable access with requireEnv() for critical vars and fallback defaults for optional ones

### [VERIFIED] TypeScript strict mode already enabled
File: tsconfig.json
Detail: "strict": true was already set — no changes needed

## Phase 2 — Database and Schema Audit

### [ADDED] 26 database indexes for high-traffic queries
Tables affected: sales_orders (8), override_earnings (4), ar_expectations (2), finance_import_rows (2), users (4), pay_statements (2), onboarding_submissions (2), onboarding_audit_log (2)
Reason: Missing indexes on frequently queried columns identified during audit

### [VERIFIED] Data integrity checks
Issue: 19 orders found with null rep_id (pre-existing test/import data)
Detail: No orphaned override_earnings, pay_statements, ar_expectations, or finance_import_rows found

## Phase 3 — Role and Permission System Audit

### [FIXED] Removed FOUNDER role reference
File: server/storage.ts (line 2219)
Issue: Dead code case "FOUNDER" in scope resolution switch
Fix: Removed the FOUNDER case — "ADMIN" case already covers this path

### [ADDED] Notification type enum values for onboarding
File: shared/schema.ts
Added: ONBOARDING_APPROVED, ONBOARDING_REJECTED, ONBOARDING_SUBMITTED, ONBOARDING_OTP_LOCKED, COMPLIANCE_CLEARED
Reason: Onboarding routes were inserting notification types not in the enum, which would cause DB errors

## Phase 8 — Onboarding System Audit

### [FIXED] OTP plaintext logging removed
File: server/onboarding/otpService.ts
Issue: OTP value was logged to console in dev mode when Twilio is not configured
Fix: Changed log to only indicate OTP was sent, without including the actual code

### [ADDED] Onboarding app access gate
File: server/auth.ts
Issue: REP/MDU/LEAD users with incomplete onboarding could access all app routes
Fix: Auth middleware now blocks these users from non-exempt routes, returning 403 with onboardingStatus and redirectTo: '/onboarding'

### [FIXED] Onboarding JWT isolation
File: server/auth.ts
Issue: Main auth middleware did not reject tokens with purpose:'onboarding'
Fix: Added explicit check to reject onboarding-purpose tokens from normal API auth

### [FIXED] Approve/reject state safety
File: server/routes.ts
Issue: Already-approved/rejected submissions could be reprocessed
Fix: Added PENDING status check before allowing approve or reject actions

### [FIXED] Admin role access to onboarding admin routes
File: server/routes.ts
Issue: Backend only allowed OPERATIONS/EXECUTIVE but sidebar showed it to ADMIN too
Fix: Changed opsOrExec to include ADMIN role

## Phase 9 — Code Quality Cleanup

### [ADDED] Global error handler
File: server/routes.ts
Reason: Catches unhandled errors and returns structured JSON responses; hides stack traces in production

### [FIXED] Sensitive data exposure — onboardingOtpHash
File: server/routes.ts
Issue: User objects returned by API endpoints included onboardingOtpHash field
Fix: Added onboardingOtpHash: undefined to all user-returning endpoints alongside existing passwordHash stripping

## Phase 10 — Scheduler Audit

### [ADDED] Scheduler concurrency protection
File: server/scheduler.ts
Issue: No protection against concurrent job execution
Fix: Added runJobWithLock() wrapper with in-memory Set-based locking — skips job if already running

## Phase 13 — Startup Verification

### [ADDED] Startup health check
File: server/index.ts
Checks: Database connection, JWT_SECRET configured, Rate cards configured
Detail: Runs on server start, logs pass/fail for each check

## Code Review Fixes (post-audit)

### [FIXED] Scheduler startup bootstrap not using concurrency lock
File: server/scheduler.ts
Issue: The startup setTimeout bootstrap called jobs directly, bypassing runJobWithLock
Fix: Wrapped startup bootstrap calls with runJobWithLock to prevent overlap with first interval runs

### [FIXED] Employee credentials endpoint leaking sensitive data
File: server/routes.ts
Issue: GET /api/admin/employee-credentials/user/:userId returned raw user object with passwordHash and onboardingOtpHash
Fix: Added sensitive field stripping to the response

## Commission Calculation & Exception Queue Deep Audit

### [FIXED] Agreement-based overrides creating $0 records
File: server/routes.ts (generateOverrideEarnings)
Issue: processAgreements did not filter out zero-amount agreements, creating $0.00 override earnings
Fix: Added `parseFloat(agreement.amountFlat) <= 0` guard for both non-mobile and mobile agreement loops

### [FIXED] Director override notification gap
File: server/routes.ts (generateOverrideEarnings)
Issue: When only one EXECUTIVE user exists (the override recipient), no one got notified of the PENDING_APPROVAL override
Fix: Director override notifications now also go to OPERATIONS users, ensuring at least one person is always notified

### [FIXED] Admin override notification gap
File: server/routes.ts (generateOverrideEarnings)
Issue: When no OPERATIONS users exist and admin override falls back to an ADMIN user, notification list was empty (only notified OPERATIONS)
Fix: Notification now falls back to ADMIN users when no OPERATIONS users exist; also excludes the recipient from self-notification

### [FIXED] Accounting override penny rounding loss
File: server/routes.ts (generateOverrideEarnings)
Issue: Dividing cents evenly across N accounting users could lose pennies (e.g., 1000c / 3 = $3.33 × 3 = $9.99 instead of $10.00)
Fix: Uses floor division with remainder — first accounting user absorbs the leftover cents

### [FIXED] Exception queue showing REJECTED orders as overdue
File: server/routes.ts (GET /api/ops/exceptions)
Issue: Overdue approval query only checked `approved_at IS NULL AND job_status = 'COMPLETED'` — rejected orders matched this filter
Fix: Added `approval_status != 'REJECTED'` to the SQL filter

### [FIXED] Auto-approval using stale chargeback risk score
File: server/routes.ts (Install Sync auto-approve)
Issue: Used cached `order.chargebackRiskScore` field which may be null or outdated
Fix: Now calls `scoreChargebackRisk(order.id)` in real-time to compute fresh risk before deciding auto-approval. Wrapped in try/catch — on scoring failure, defaults to riskScore=100 (safe: skips auto-approval) and continues processing remaining orders

## Phase 7 — OPERATIONS Role Elevation

### [ADDED] Centralized permissions system
File: server/permissions.ts
Detail: Created comprehensive PERMISSIONS object with 80+ granular permission keys mapping to allowed roles. Added `requirePermission(key)` middleware, `hasPermission(role, key)` helper, and `canCreateRole` hierarchy map. OPERATIONS gets near-full-admin access with four explicit exclusions: creating EXECUTIVE/OPERATIONS users, editing rate card amounts, overriding reserve caps above $2,500, and viewing Iron Crest profit margins.

### [UPDATED] All route guards migrated to permission-based system
File: server/routes.ts
Detail: Replaced ~150+ `adminOnly` and `executiveOrAdmin` middleware calls with `requirePermission()` calls using specific permission keys. Every admin route now uses granular permission checks instead of blanket role guards. Categories updated: orders, users, providers, clients, services, rate cards, incentives, overrides, pay runs, pay statements, deductions, advances, tax profiles, payment methods, ACH exports, QuickBooks, tax documents, bank accounts, reconciliations, bonuses, draws, splits, tiers, disputes, finance imports, AR management, column mappings, scheduled pay runs, background jobs, chargebacks, notifications, integration endpoints, audit logs, and reports.

### [ADDED] User creation hierarchy enforcement
File: server/routes.ts (POST /api/admin/users)
Detail: Added `canCreateRole` check — OPERATIONS can create all roles except EXECUTIVE and OPERATIONS. EXECUTIVE can create all roles. MANAGER can create REP, LEAD. Other roles cannot create users. Returns 403 with descriptive message on violation.

### [UPDATED] Override approval expanded for OPERATIONS
File: server/routes.ts (canApproveOverrideType function)
Detail: OPERATIONS can now approve DIRECTOR_OVERRIDE, ADMIN_OVERRIDE, and ACCOUNTING_OVERRIDE overrides. Previously only had ADMIN_OVERRIDE and ACCOUNTING_OVERRIDE. Self-approval prohibition remains enforced for all roles including OPERATIONS.

### [UPDATED] Storage scope for OPERATIONS
File: server/storage.ts (getRepIdsForScope)
Detail: Added OPERATIONS to the EXECUTIVE/ADMIN case in getRepIdsForScope so OPERATIONS users see all active reps company-wide for dashboard and reporting purposes.

### [ADDED] Permissions health check
File: server/index.ts
Detail: Added startup health check verifying the permissions system is loaded with >10 permission keys. Now shows "4 passed, 0 failed" on startup.

### Rate card protection
Files: server/routes.ts, server/permissions.ts
Detail: Rate card GET routes use `system:ratecards:view` (DIRECTOR, OPERATIONS, ACCOUNTING, EXECUTIVE). Rate card POST/PATCH/DELETE routes use `system:ratecards:edit` (EXECUTIVE only). OPERATIONS can view rate cards but cannot create, modify amounts, or delete them.

### Reserve cap override protection
Files: server/permissions.ts
Detail: `reserves:override:cap` and `financial:override:reserve:cap` permissions restricted to EXECUTIVE only. OPERATIONS can view reserves, make manual adjustments, and handle separations, but cannot override the $2,500 cap.

### Iron Crest profit margin protection
Files: server/routes.ts, server/permissions.ts
Detail: `/api/admin/reports/iron-crest-profit` route uses `financial:view:profit` permission which is restricted to ACCOUNTING and EXECUTIVE only. OPERATIONS cannot view Iron Crest profit margins.
