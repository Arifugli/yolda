#!/usr/bin/env sh
set -eu
if [ "${STORAGE_DRIVER:-}" = "supabase" ]; then npm run supabase:preflight; fi
npm run db:migrate
npm run storage:prepare
if [ "${APP_MODE:-}" = "demo" ]; then npm run db:seed; fi
exec node scripts/runtime.mjs
