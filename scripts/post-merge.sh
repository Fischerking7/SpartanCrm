#!/bin/bash
set -e
npm install
psql "$DATABASE_URL" -f migrations/8-repid-reuse.sql 2>/dev/null || true
npm run db:push
