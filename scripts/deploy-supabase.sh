#!/usr/bin/env bash
# Apply migrations to a Supabase project's Postgres. Usage: DATABASE_URL=postgres://... scripts/deploy-supabase.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?set DATABASE_URL to the Supabase connection string}"
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  psql -v ON_ERROR_STOP=1 -q "$DATABASE_URL" -f "$f"
done
psql -v ON_ERROR_STOP=1 -q "$DATABASE_URL" -c "grant usage on schema app to authenticated, service_role; grant execute on all functions in schema app to authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant usage, select on all sequences in schema public to authenticated, service_role;"
echo "migrations applied"
