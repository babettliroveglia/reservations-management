#!/bin/sh
# Runs both Workers locally with a local D1 database in .state/ (docker-compose.yml, service "dev"):
#   booking pages  http://localhost:8787
#   staff admin    http://localhost:8788  (signed in as staff@localhost: local only, no Cloudflare Access)
#   locked admin   http://localhost:8789  (set up as deployed, Access required: the tests check it refuses everything)
set -e
cd "$(dirname "$0")"
[ -d node_modules/wrangler ] || npm ci --no-audit --no-fund
npx wrangler d1 migrations apply prenota-test --local --persist-to .state
npx wrangler dev --ip 0.0.0.0 --port 8787 --inspector-port 9229 --persist-to .state --show-interactive-dev-session=false &
npx wrangler dev -c wrangler.admin.toml --ip 0.0.0.0 --port 8788 --inspector-port 9230 --persist-to .state --show-interactive-dev-session=false \
  --var DEV_ADMIN_EMAIL:staff@localhost &
npx wrangler dev -c wrangler.admin.toml --ip 0.0.0.0 --port 8789 --inspector-port 9231 --persist-to .state --show-interactive-dev-session=false \
  --var DEV_ADMIN_EMAIL:staff@localhost --var ACCESS_TEAM_DOMAIN:example.cloudflareaccess.invalid --var ACCESS_AUD:test-audience &
trap 'kill 0' INT TERM
wait
