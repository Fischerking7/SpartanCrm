# Database Backup Strategy

## Overview

SalesOps Pro uses Neon PostgreSQL as its database provider. Neon provides built-in backup and point-in-time recovery features.

## Neon Built-in Features

### Automatic Backups
- Neon automatically creates point-in-time recovery snapshots
- Retention period depends on your Neon plan
- Access via Neon Console: https://console.neon.tech

### Branching for Recovery
- Create a branch from any point in time to recover data
- Branches are instant and don't affect production
- Useful for recovering from accidental deletions

## Manual Backup Procedure

### Prerequisites
- `pg_dump` and `pg_restore` utilities installed
- Database connection string from `DATABASE_URL` environment variable

### Export Database (pg_dump)

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl -f backup_$(date +%Y%m%d_%H%M%S).dump
```

### Restore Database (pg_restore)

```bash
pg_restore --dbname="$DATABASE_URL" --no-owner --no-acl --clean backup_YYYYMMDD_HHMMSS.dump
```

## Recommended Backup Schedule

| Type | Frequency | Retention |
|------|-----------|-----------|
| Neon Auto | Continuous | Per plan (7-30 days) |
| Manual Export | Weekly | 30 days minimum |
| Pre-Migration | Before any schema changes | Permanent |

## Recovery Scenarios

### Accidental Data Deletion
1. Go to Neon Console
2. Create a branch from a point before the deletion
3. Export the needed data from the branch
4. Import into production

### Corrupted Data
1. Identify the last known good timestamp
2. Create a Neon branch from that point
3. Compare data between branch and production
4. Restore specific tables or records as needed

### Full Disaster Recovery
1. Obtain latest backup dump file
2. Create a new Neon database or branch
3. Run pg_restore command above
4. Update DATABASE_URL in environment

## Critical Data to Preserve

- `users` - All user accounts and role assignments
- `sales_orders` - Historical sales data
- `chargebacks` - Chargeback records
- `audit_logs` - Compliance audit trail
- `rate_cards` - Commission rate configuration

## Environment Variables

Ensure these are backed up separately (stored in Replit Secrets):
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Session encryption key
- `JWT_SECRET` - Authentication token secret

## Contact

For Neon-related issues: https://neon.tech/docs/support
