#!/bin/bash
set -e

npm install
npm run db:push
npx tsx server/runSeedSystemSettings.ts
