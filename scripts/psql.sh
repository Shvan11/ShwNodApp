#!/usr/bin/env bash
# Convenience psql wrapper: connect to the app's LOCAL or SUPABASE DB using .env credentials,
# WITHOUT putting secrets on the command line (creds are eval'd into env via scripts/_pgenv.mjs).
#   scripts/psql.sh local [psql args...]   # e.g. scripts/psql.sh local -c '\dt'
#   scripts/psql.sh supa  [psql args...]   # e.g. scripts/psql.sh supa  -f migrations/supabase/reverse-cdc.sql
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:-}"; shift || true
# Filter to ONLY the `export …` line — some dotenv shims print a banner to stdout that would
# otherwise pollute the eval.
eval "$(node scripts/_pgenv.mjs "$target" 2>/dev/null | grep '^export ')"
case "$target" in
  supa)  exec psql "$PGURL" -v ON_ERROR_STOP=1 "$@";;
  local) exec psql -v ON_ERROR_STOP=1 "$@";;
  *) echo "usage: scripts/psql.sh <local|supa> [psql args...]" >&2; exit 1;;
esac
