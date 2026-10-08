#!/usr/bin/env bash
# deploy/backup.sh — logical backup of the DeveloperOS database.
#
#   deploy/backup.sh [output-dir]          (default: deploy/backups)
#
# Produces, from ONE consistent snapshot:
#   developeros-<UTC timestamp>.dump        pg_dump custom format (-Fc)
#   developeros-<UTC timestamp>.counts.tsv  exact row count of every table in that snapshot
#   developeros-<UTC timestamp>.sha256      checksums of both files
# deploy/restore-drill.sh restores the dump and checks it against the counts.
#
# Source database (choose one):
#   default            the compose stack's db container (docker compose exec);
#                      reads deploy/compose.yaml + DEVOS_ENV_FILE
#                      (default deploy/.env.production)
#   BACKUP_DATABASE_URL=postgresql://owner:pw@host:5432/developeros
#                      any reachable server, using the local pg_dump/psql
#                      clients (major version 18 or newer required)
#
# The dump does NOT contain AUDIT_SIGNING_KEY (it lives only in the app
# environment). Back up the env file / secrets-manager entry together with
# the dumps: checkpoint receipts and stored checkpoints only verify with it.
set -euo pipefail
umask 077

here=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${DEVOS_ENV_FILE:-$here/.env.production}
OUT_DIR=${1:-${BACKUP_DIR:-$here/backups}}

envval() { # envval KEY DEFAULT — read KEY from the env file without sourcing it
  local v=""
  [ -f "$ENV_FILE" ] && v=$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)
  printf '%s' "${v:-$2}"
}

if [ -n "${BACKUP_DATABASE_URL:-}" ]; then
  major=$(pg_dump --version | grep -oE '[0-9]+' | head -n1)
  if [ "${major:-0}" -lt 18 ]; then echo "[BACKUP] pg_dump $major found; version 18+ required" >&2; exit 1; fi
  PSQL=(psql "$BACKUP_DATABASE_URL")
  PGDUMP=(pg_dump "$BACKUP_DATABASE_URL")
  DB_NAME=$(basename "${BACKUP_DATABASE_URL%%\?*}")
  SOURCE="$BACKUP_DATABASE_URL"
  SOURCE="${SOURCE/\/\/*@/\/\/***@}"
else
  [ -f "$ENV_FILE" ] || { echo "[BACKUP] env file not found: $ENV_FILE (set DEVOS_ENV_FILE)" >&2; exit 1; }
  DB_NAME=$(envval POSTGRES_DB developeros)
  DB_USER=$(envval POSTGRES_OWNER_USER devos_owner)
  DC=(docker compose -f "$here/compose.yaml" --env-file "$ENV_FILE")
  # Local socket inside the db container; no password leaves the container.
  PSQL=("${DC[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME")
  PGDUMP=("${DC[@]}" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME")
  SOURCE="compose service db, database $DB_NAME"
fi

mkdir -p "$OUT_DIR"
ts=$(date -u +%Y%m%dT%H%M%SZ)
base="$OUT_DIR/${DB_NAME}-${ts}"

# Row counts of every ordinary table, as "schema.table<TAB>count", sorted.
COUNTS_SQL="SELECT format('%s.%s', n.nspname, c.relname) || E'\\t' ||
  (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY 1;"

# Hold one REPEATABLE READ transaction open, export its snapshot, count rows
# in it, and dump with --snapshot so the counts describe exactly the dump.
coproc SNAP { "${PSQL[@]}" -X -q -A -t -v ON_ERROR_STOP=1 2>&1; }
exec {to_psql}>&"${SNAP[1]}" {from_psql}<&"${SNAP[0]}"
read_until_end() { local line; while IFS= read -r -t 60 line <&"$from_psql"; do [ "$line" = "__END__" ] && return 0; printf '%s\n' "$line"; done; echo "[BACKUP] psql session ended unexpectedly" >&2; return 1; }

printf '%s\n' "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" "SELECT pg_export_snapshot();" "SELECT '__END__';" >&"$to_psql"
snapshot=$(read_until_end)
[[ "$snapshot" =~ ^[0-9A-F-]+$ ]] || { echo "[BACKUP] could not export snapshot: $snapshot" >&2; exit 1; }

printf '%s\n' "$COUNTS_SQL" "SELECT '__END__';" >&"$to_psql"
read_until_end | LC_ALL=C sort > "$base.counts.tsv.part"

"${PGDUMP[@]}" -Fc --snapshot="$snapshot" > "$base.dump.part"

printf '%s\n' "COMMIT;" "\\q" >&"$to_psql"
exec {to_psql}>&- {from_psql}<&-
wait "$SNAP_PID" 2>/dev/null || true

mv "$base.counts.tsv.part" "$base.counts.tsv"
mv "$base.dump.part" "$base.dump"
( cd "$OUT_DIR" && sha256sum "$(basename "$base.dump")" "$(basename "$base.counts.tsv")" > "$(basename "$base.sha256")" )

tables=$(wc -l < "$base.counts.tsv" | tr -d ' ')
rows=$(awk -F'\t' '{s+=$2} END {print s+0}' "$base.counts.tsv")
echo "[BACKUP] source:   $SOURCE"
echo "[BACKUP] snapshot: $snapshot"
echo "[BACKUP] dump:     $base.dump ($(du -h "$base.dump" | cut -f1))"
echo "[BACKUP] counts:   $base.counts.tsv ($tables tables, $rows rows)"
echo "[BACKUP] sha256:   $base.sha256"
echo "[BACKUP] Reminder: AUDIT_SIGNING_KEY is not in the dump; keep the matching key backup with it."
