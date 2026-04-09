#!/bin/bash
set -e

npm install
yes "" | npx drizzle-kit push --force || true
npx tsx server/runSeedSystemSettings.ts
