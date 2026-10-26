#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export npm_config_cache="${npm_config_cache:-/workspace/.npm}"
export DOCKER_CONFIG="${DOCKER_CONFIG:-/workspace/.docker}"
if [ ! -f .env ]; then cp .env.example .env; fi
npm ci
if node --env-file-if-exists=.env -e 'process.exit(process.env.STORAGE_DRIVER === "supabase" ? 0 : 1)'; then
  npm run supabase:preflight
  npm run db:migrate
  npm run storage:prepare
  if node --env-file-if-exists=.env -e 'process.exit(process.env.APP_MODE === "demo" ? 0 : 1)'; then npm run db:seed; fi
  exit 0
fi
node --env-file-if-exists=.env -e 'const u=new URL(process.env.DATABASE_URL || "postgres://localhost/yolda"); if(!["localhost","127.0.0.1"].includes(u.hostname))throw new Error("External databases require explicit STORAGE_DRIVER=supabase and the cloud preflight")'
docker compose up -d db
for attempt in {1..20}; do
  if docker compose exec -T db pg_isready -U yolda >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 20 ]; then echo 'PostgreSQL did not become ready' >&2; exit 1; fi
  sleep 1
done
npm run db:migrate
npm run db:seed
