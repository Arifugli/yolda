#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export npm_config_cache="${npm_config_cache:-/workspace/.npm}"
export DOCKER_CONFIG="${DOCKER_CONFIG:-/workspace/.docker}"
if [ ! -f .env ]; then cp .env.example .env; fi
npm ci
docker compose up -d db
for attempt in {1..20}; do
  if docker compose exec -T db pg_isready -U yolda >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 20 ]; then echo 'PostgreSQL did not become ready' >&2; exit 1; fi
  sleep 1
done
npm run db:migrate
npm run db:seed
