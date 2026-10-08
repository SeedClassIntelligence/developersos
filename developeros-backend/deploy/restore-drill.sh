#!/usr/bin/env bash
# deploy/restore-drill.sh — prove a backup restores into a usable database.
#
#   deploy/restore-drill.sh [path/to/<db>-<ts>.dump]   (default: newest in deploy/backups)
#
# 1. checks the dump against its .sha256
# 2. starts a throwaway PostgreSQL container (POSTGRES_IMAGE, no network, tmpfs
#    storage) — production is never touched
# 3. creates the owner and a runtime role, pg_restore --exit-on-error
# 4. compares the exact row count of every table with the .counts.tsv taken
#    from the same snapshot as the dump
# 5. runs scripts/verify-database.js from the app image (DEVOS_APP_IMAGE) as the
#    runtime role against the restored copy: runtime-role guard, no pending
#    migrations, runtime reads, and full audit-ledger verification using
#    AUDIT_SIGNING_KEY / AUDIT_TRUSTED_PUBLIC_KEYS from the env file
# 6. removes the container. Exit 0 only if every check passed.
#
# Reads DEVOS_ENV_FILE (default deploy/.env.production) for POSTGRES_IMAGE,
# POSTGRES_DB, POSTGRES_OWNER_USER, DEVOS_RUNTIME_USER, DEVOS_APP_IMAGE and the
# audit keys. Requires docker; does not need the compose stack to be running.
set -euo pipefail
umask 077

here=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${DEVOS_ENV_FILE:-$here/.env.production}
BACKUP_DIR=${BACKUP_DIR:-$here/backups}

envval() { # envval KEY DEFAULT — read KEY from the env file without sourcing it
  local v=""
  [ -f "$ENV_FILE" ] && v=$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)
  printf '%s' "${v:-$2}"
}

DUMP=${1:-$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -n1 || true)}
[ -n "$DUMP" ] && [ -f "$DUMP" ] || { echo "[DRILL] no dump given and none found in $BACKUP_DIR" >&2; exit 1; }
DUMP=$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")
STEM=${DUMP%.dump}
COUNTS="$STEM.counts.tsv"
SUMS="$STEM.sha256"

PG_IMAGE=$(envval POSTGRES_IMAGE postgres:18)
APP_IMAGE=$(envval DEVOS_APP_IMAGE developeros:local)
DB_NAME=$(envval POSTGRES_DB developeros)
OWNER=$(envval POSTGRES_OWNER_USER devos_owner)
RUNTIME=$(envval DEVOS_RUNTIME_USER devos_app)
export AUDIT_SIGNING_KEY AUDIT_TRUSTED_PUBLIC_KEYS
AUDIT_SIGNING_KEY=$(envval AUDIT_SIGNING_KEY "")
AUDIT_TRUSTED_PUBLIC_KEYS=$(envval AUDIT_TRUSTED_PUBLIC_KEYS "")

echo "[DRILL] dump:   $DUMP"
if [ -f "$SUMS" ]; then
  ( cd "$(dirname "$SUMS")" && sha256sum -c --quiet "$(basename "$SUMS")" ) && echo "[DRILL] sha256: OK"
else
  echo "[DRILL] sha256: no checksum file, skipped"
fi
[ -f "$COUNTS" ] || { echo "[DRILL] missing row-count manifest $COUNTS" >&2; exit 1; }

NAME="devos-restore-drill-$(date -u +%Y%m%d%H%M%S)-$$"
DRILL_PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
RUNTIME_PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[DRILL] starting scratch PostgreSQL ($PG_IMAGE) as container $NAME"
docker run -d --name "$NAME" --network none --tmpfs /var/lib/postgresql:rw \
  -e POSTGRES_USER="$OWNER" -e POSTGRES_PASSWORD="$DRILL_PW" -e POSTGRES_DB="$DB_NAME" \
  "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker logs "$NAME" 2>&1 | grep -q 'PostgreSQL init process complete' \
     && docker exec "$NAME" pg_isready -q -U "$OWNER" -d "$DB_NAME"; then break; fi
  sleep 1
done
docker exec "$NAME" pg_isready -U "$OWNER" -d "$DB_NAME" >/dev/null || { docker logs "$NAME" | tail -20; exit 1; }
PSQL=(docker exec -i "$NAME" psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$OWNER" -d "$DB_NAME")

# The dump grants privileges to the runtime role, so it must exist first.
"${PSQL[@]}" -v role="$RUNTIME" -v pw="$RUNTIME_PW" <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL

echo "[DRILL] pg_restore --exit-on-error into fresh database \"$DB_NAME\""
docker exec -i "$NAME" pg_restore --exit-on-error -U "$OWNER" -d "$DB_NAME" < "$DUMP"

COUNTS_SQL="SELECT format('%s.%s', n.nspname, c.relname) || E'\\t' ||
  (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY 1;"
RESTORED=$(mktemp)
trap 'cleanup; rm -f "$RESTORED"' EXIT
SOURCE_COUNTS=$(mktemp)
trap 'cleanup; rm -f "$RESTORED" "$SOURCE_COUNTS"' EXIT
printf '%s\n' "$COUNTS_SQL" | "${PSQL[@]}" | LC_ALL=C sort > "$RESTORED"
LC_ALL=C sort "$COUNTS" > "$SOURCE_COUNTS"

echo "[DRILL] row counts (source snapshot vs restored):"
LC_ALL=C join -t $'\t' -a1 -a2 -e MISSING -o 0,1.2,2.2 "$SOURCE_COUNTS" "$RESTORED" \
  | awk -F'\t' '{ s = ($2 == $3) ? "ok" : "MISMATCH"; printf "  %-40s %10s %10s  %s\n", $1, $2, $3, s }'
if diff -q "$SOURCE_COUNTS" "$RESTORED" >/dev/null; then
  echo "[DRILL] row counts: all $(wc -l < "$COUNTS" | tr -d ' ') tables match ($(awk -F'\t' '{s+=$2} END {print s+0}' "$COUNTS") rows)"
else
  echo "[DRILL] row counts: MISMATCH" >&2; exit 1
fi

echo "[DRILL] schema_migrations in restored copy: $(printf '%s\n' "SELECT string_agg(version, ', ' ORDER BY version) FROM schema_migrations;" | "${PSQL[@]}")"

echo "[DRILL] verifying restored copy with $APP_IMAGE as runtime role \"$RUNTIME\""
docker run --rm --network "container:$NAME" \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://$RUNTIME:$RUNTIME_PW@127.0.0.1:5432/$DB_NAME" \
  -e AUDIT_SIGNING_KEY -e AUDIT_TRUSTED_PUBLIC_KEYS \
  "$APP_IMAGE" node scripts/verify-database.js

echo "[DRILL] PASSED: $DUMP restores into a usable database"
