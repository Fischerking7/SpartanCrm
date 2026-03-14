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
File: server/routes.ts (line ~12373)
Issue: GET /api/admin/employee-credentials/user/:userId returned raw user object with passwordHash and onboardingOtpHash
Fix: Added sensitive field stripping to the response
