#!/usr/bin/env bash
# Recreate the local test database from migrations (+ auth stub) and seed.
# Usage: scripts/db-reset-local.sh [dbname]
set -euo pipefail
DB="${1:-lcos_dev}"
PSQL="psql -v ON_ERROR_STOP=1 -q"
cd "$(dirname "$0")/.."
su postgres -c "psql -q -c 'drop database if exists $DB with (force)' -c 'create database $DB'" >/dev/null
# app schema must exist before the auth stub grants on it
su postgres -c "$PSQL -d $DB -c 'create schema if not exists app'"
su postgres -c "$PSQL -d $DB -f supabase/local/00_auth_stub.sql"
su postgres -c "$PSQL -d $DB -f supabase/local/01_users_stub.sql"
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  su postgres -c "$PSQL -d $DB -f $f"
done
su postgres -c "$PSQL -d $DB -c 'grant all on all tables in schema public to authenticated, service_role; grant usage, select on all sequences in schema public to authenticated, service_role; grant execute on all functions in schema app to authenticated, service_role;'"
if [ "${SEED:-1}" = "1" ] && ls supabase/seed/*.sql >/dev/null 2>&1; then
  for f in supabase/seed/*.sql; do
    echo "seeding $f"
    su postgres -c "$PSQL -d $DB -f $f"
  done
fi
echo "ok: $DB"
