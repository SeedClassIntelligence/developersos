-- DEVOS-EF-3 REMEDIATION: audit ledger hash version 2.
--
--   EF3-D1  privilege separation: ledger writes only through SECURITY DEFINER
--           functions owned by the migration role; runtime grants are applied
--           per runtime role by devos_apply_runtime_grants(); TRUNCATE guard.
--   EF3-D2  one canonical hash function per version, shared by the capture
--           trigger and by product verification.
--   EF3-D3  per-organization chain_seq (unique) + protected chain heads +
--           append-only signed checkpoints.
--   EF3-D4  v2 hash input is a canonical JSON document with a UTC timestamp;
--           no dependency on session TimeZone, DateStyle, or locale.
--
-- Historical hash_version 1 events are NOT rewritten. Each organization that
-- already has v1 events receives a v2 GENESIS event whose payload attests the
-- legacy segment (count, head hash, and the session settings its digests
-- depend on) and whose previous_hash links to the legacy head.

-- ── Ledger columns ──────────────────────────────────────────────────────────
-- ADD COLUMN with a constant default is a catalog-only change: existing rows
-- are labelled hash_version 1 without being rewritten or firing UPDATE triggers.
ALTER TABLE audit_events ADD COLUMN hash_version SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE audit_events ALTER COLUMN hash_version DROP DEFAULT;
ALTER TABLE audit_events ADD COLUMN chain_seq BIGINT;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_version_position CHECK (
  (hash_version = 1 AND chain_seq IS NULL) OR (hash_version >= 2 AND chain_seq >= 1)
);
CREATE UNIQUE INDEX audit_events_chain_position
  ON audit_events (organization_id, chain_seq) NULLS NOT DISTINCT
  WHERE chain_seq IS NOT NULL;

-- ── Canonical serialization (hash_version 2) ────────────────────────────────
-- Objects: keys sorted by Unicode code point (COLLATE "C" on UTF-8), no
-- whitespace. Arrays keep order. Scalars use jsonb's text form (strings are
-- JSON-escaped, numbers keep their stored digits).
CREATE OR REPLACE FUNCTION devos_canonical_json(j jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = public, pg_temp AS $$
DECLARE
  result text;
BEGIN
  CASE jsonb_typeof(j)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(string_agg(to_jsonb(k)::text || ':' || devos_canonical_json(v), ',' ORDER BY k COLLATE "C"), '') || '}'
        INTO result FROM jsonb_each(j) AS e(k, v);
    WHEN 'array' THEN
      SELECT '[' || COALESCE(string_agg(devos_canonical_json(v), ',' ORDER BY ord), '') || ']'
        INTO result FROM jsonb_array_elements(j) WITH ORDINALITY AS a(v, ord);
    ELSE
      result := j::text;
  END CASE;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION devos_audit_chain_key(p_organization_id text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_organization_id IS NULL THEN 'platform' ELSE 'org:' || p_organization_id END;
$$;

-- The single authoritative v2 algorithm: SHA-256 over the UTF-8 bytes of the
-- canonical JSON document below. occurred_at is rendered in UTC with
-- microseconds, so the digest is identical from every session timezone.
CREATE OR REPLACE FUNCTION devos_audit_hash_v2(
  p_id uuid, p_chain_seq bigint, p_occurred_at timestamptz, p_organization_id text,
  p_actor_user_id text, p_request_id text, p_action text, p_entity_type text,
  p_entity_id text, p_before_state jsonb, p_after_state jsonb, p_previous_hash text
) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT encode(digest(convert_to(devos_canonical_json(jsonb_build_object(
    'hash_version', 2,
    'id', p_id::text,
    'chain_seq', p_chain_seq,
    'occurred_at', to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'organization_id', p_organization_id,
    'actor_user_id', p_actor_user_id,
    'request_id', p_request_id,
    'action', p_action,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'before_state', p_before_state,
    'after_state', p_after_state,
    'previous_hash', p_previous_hash
  )), 'UTF8'), 'sha256'), 'hex');
$$;

-- hash_version 1 (legacy, EF-3 original). Its digest embeds occurred_at::text,
-- which depends on the session TimeZone/DateStyle; verification pins those
-- settings to the values attested in the organization's GENESIS event.
CREATE OR REPLACE FUNCTION devos_audit_hash_v1(e audit_events) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT encode(digest(concat_ws('|', e.id::text, e.occurred_at::text, COALESCE(e.organization_id, ''),
    COALESCE(e.actor_user_id, ''), COALESCE(e.request_id, ''), e.action, e.entity_type, e.entity_id,
    COALESCE(e.before_state::text, ''), COALESCE(e.after_state::text, ''), COALESCE(e.previous_hash, '')), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION devos_audit_event_hash(e audit_events) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE e.hash_version
    WHEN 2 THEN devos_audit_hash_v2(e.id, e.chain_seq, e.occurred_at, e.organization_id, e.actor_user_id,
      e.request_id, e.action, e.entity_type, e.entity_id, e.before_state, e.after_state, e.previous_hash)
    WHEN 1 THEN devos_audit_hash_v1(e)
  END;
$$;

-- ── Chain heads: the ledger's own record of each chain's latest position ───
CREATE TABLE audit_chain_heads (
  chain_key VARCHAR(110) PRIMARY KEY,
  organization_id VARCHAR(100),
  last_seq BIGINT NOT NULL CHECK (last_seq >= 0),
  last_hash VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION devos_guard_chain_head() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_chain_heads is append-only: heads cannot be deleted';
  END IF;
  IF NEW.chain_key IS DISTINCT FROM devos_audit_chain_key(NEW.organization_id) THEN
    RAISE EXCEPTION 'audit chain head key does not match its organization';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_seq <> 0 THEN
      RAISE EXCEPTION 'audit chain heads must start at position 0';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.chain_key <> OLD.chain_key OR NEW.last_seq <> OLD.last_seq + 1 THEN
    RAISE EXCEPTION 'audit chain head may only advance by exactly one position';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events
                 WHERE organization_id IS NOT DISTINCT FROM NEW.organization_id
                   AND chain_seq = NEW.last_seq AND event_hash = NEW.last_hash) THEN
    RAISE EXCEPTION 'audit chain head must reference an existing ledger event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_chain_heads_guard
BEFORE INSERT OR UPDATE OR DELETE ON audit_chain_heads
FOR EACH ROW EXECUTE FUNCTION devos_guard_chain_head();

-- ── Signed checkpoints (append-only) ───────────────────────────────────────
-- Signatures are produced by the application with an Ed25519 key that is
-- never stored in the database. Receipts handed to tenants/auditors are the
-- trust anchor that survives a full database compromise.
CREATE TABLE audit_checkpoints (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_key VARCHAR(110) NOT NULL,
  organization_id VARCHAR(100) NOT NULL,
  chain_seq BIGINT NOT NULL CHECK (chain_seq >= 1),
  event_hash VARCHAR(64) NOT NULL,
  hash_version SMALLINT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  key_id VARCHAR(64) NOT NULL,
  signature TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_checkpoints_position UNIQUE (chain_key, chain_seq, key_id)
);

CREATE OR REPLACE FUNCTION devos_block_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_checkpoints_append_only
BEFORE UPDATE OR DELETE ON audit_checkpoints
FOR EACH ROW EXECUTE FUNCTION devos_block_audit_mutation();

-- Row triggers do not fire on TRUNCATE; these statement triggers close that gap
-- for every principal, including the owner, unless the trigger is disabled.
CREATE OR REPLACE FUNCTION devos_block_ledger_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% cannot be truncated: audit evidence is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION devos_block_ledger_truncate();
CREATE TRIGGER audit_chain_heads_no_truncate BEFORE TRUNCATE ON audit_chain_heads
FOR EACH STATEMENT EXECUTE FUNCTION devos_block_ledger_truncate();
CREATE TRIGGER audit_checkpoints_no_truncate BEFORE TRUNCATE ON audit_checkpoints
FOR EACH STATEMENT EXECUTE FUNCTION devos_block_ledger_truncate();

-- New evidence must be v2 with a chain position: no downgrade to the
-- timezone-dependent v1 format and no position-less rows.
CREATE OR REPLACE FUNCTION devos_guard_audit_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.hash_version IS DISTINCT FROM 2 OR NEW.chain_seq IS NULL THEN
    RAISE EXCEPTION 'audit_events accepts only hash_version 2 events with a chain position';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_events_insert_guard
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION devos_guard_audit_insert();

-- ── Append path ─────────────────────────────────────────────────────────────
-- The only way evidence enters the ledger. Locks the chain head row, so
-- concurrent writers to one organization serialize into one position each.
CREATE OR REPLACE FUNCTION devos_audit_append(
  p_organization_id text, p_actor_user_id text, p_request_id text, p_action text,
  p_entity_type text, p_entity_id text, p_before_state jsonb, p_after_state jsonb
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_chain_key text := devos_audit_chain_key(p_organization_id);
  v_prev_seq bigint;
  v_prev_hash text;
  v_id uuid := gen_random_uuid();
  v_time timestamptz := clock_timestamp();
  v_seq bigint;
  v_hash text;
BEGIN
  INSERT INTO audit_chain_heads (chain_key, organization_id, last_seq, last_hash, updated_at)
  VALUES (v_chain_key, p_organization_id, 0, NULL, v_time)
  ON CONFLICT (chain_key) DO NOTHING;

  SELECT last_seq, last_hash INTO v_prev_seq, v_prev_hash
  FROM audit_chain_heads WHERE chain_key = v_chain_key FOR UPDATE;

  v_time := clock_timestamp();
  v_seq := v_prev_seq + 1;
  v_hash := devos_audit_hash_v2(v_id, v_seq, v_time, p_organization_id, p_actor_user_id, p_request_id,
    p_action, p_entity_type, p_entity_id, p_before_state, p_after_state, v_prev_hash);

  INSERT INTO audit_events (id, occurred_at, organization_id, actor_user_id, request_id, action,
    entity_type, entity_id, before_state, after_state, previous_hash, event_hash, hash_version, chain_seq)
  VALUES (v_id, v_time, p_organization_id, p_actor_user_id, p_request_id, p_action,
    p_entity_type, p_entity_id, p_before_state, p_after_state, v_prev_hash, v_hash, 2, v_seq);

  UPDATE audit_chain_heads SET last_seq = v_seq, last_hash = v_hash, updated_at = v_time
  WHERE chain_key = v_chain_key;
END;
$$;

-- Capture trigger: runs as the migration (owner) role, so the runtime role
-- needs no write privilege on any ledger table.
CREATE OR REPLACE FUNCTION devos_capture_audit_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  source_row JSONB;
  safe_old JSONB;
  safe_new JSONB;
  org_id TEXT;
  entity_key TEXT;
BEGIN
  source_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  safe_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - 'password_hash' - 'token_hash' END;
  safe_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - 'password_hash' - 'token_hash' END;

  org_id := NULLIF(current_setting('app.organization_id', true), '');
  org_id := COALESCE(org_id, source_row->>'organization_id', source_row->>'org_id');
  IF org_id IS NULL AND TG_TABLE_NAME = 'organizations' THEN org_id := source_row->>'id'; END IF;
  entity_key := COALESCE(source_row->>'id', source_row->>'task_id', source_row->>'role_id', encode(digest(source_row::text, 'sha256'), 'hex'));

  PERFORM devos_audit_append(org_id, NULLIF(current_setting('app.actor_user_id', true), ''),
    NULLIF(current_setting('app.request_id', true), ''), TG_OP, TG_TABLE_NAME, entity_key, safe_old, safe_new);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ── Checkpoint recording ────────────────────────────────────────────────────
-- Callable by the runtime role. It can only record a checkpoint that points at
-- a real v2 event and never behind an existing checkpoint; it cannot alter or
-- remove checkpoints already recorded.
CREATE OR REPLACE FUNCTION devos_audit_record_checkpoint(
  p_organization_id text, p_chain_seq bigint, p_event_hash text, p_issued_at timestamptz,
  p_key_id text, p_signature text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_chain_key text := devos_audit_chain_key(p_organization_id);
  v_latest bigint;
  v_id bigint;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'checkpoints are issued for organization chains only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events WHERE organization_id = p_organization_id
                 AND chain_seq = p_chain_seq AND event_hash = p_event_hash AND hash_version = 2) THEN
    RAISE EXCEPTION 'checkpoint does not reference a ledger event';
  END IF;
  SELECT max(chain_seq) INTO v_latest FROM audit_checkpoints WHERE chain_key = v_chain_key;
  IF v_latest IS NOT NULL AND p_chain_seq < v_latest THEN
    RAISE EXCEPTION 'checkpoints cannot move behind position %', v_latest;
  END IF;
  IF p_issued_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'checkpoint issue time is in the future';
  END IF;
  INSERT INTO audit_checkpoints (chain_key, organization_id, chain_seq, event_hash, hash_version, issued_at, key_id, signature)
  VALUES (v_chain_key, p_organization_id, p_chain_seq, p_event_hash, 2, p_issued_at, p_key_id, p_signature)
  ON CONFLICT ON CONSTRAINT audit_checkpoints_position DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM audit_checkpoints
    WHERE chain_key = v_chain_key AND chain_seq = p_chain_seq AND key_id = p_key_id;
  END IF;
  RETURN v_id;
END;
$$;

-- ── Genesis boundary for organizations with v1 history ─────────────────────
DO $$
DECLARE
  r record;
  v_head text;
BEGIN
  FOR r IN SELECT organization_id, count(*) AS n FROM audit_events WHERE hash_version = 1 GROUP BY organization_id LOOP
    SELECT event_hash INTO v_head FROM audit_events
    WHERE organization_id IS NOT DISTINCT FROM r.organization_id AND hash_version = 1
    ORDER BY occurred_at DESC, id DESC LIMIT 1;

    INSERT INTO audit_chain_heads (chain_key, organization_id, last_seq, last_hash, updated_at)
    VALUES (devos_audit_chain_key(r.organization_id), r.organization_id, 0, v_head, clock_timestamp());

    PERFORM devos_audit_append(r.organization_id, NULL, 'migration-005', 'GENESIS', 'audit_ledger', 'hash-version-2',
      NULL, jsonb_build_object(
        'reason', 'hash_version_2_genesis',
        'legacy_hash_version', 1,
        'legacy_event_count', r.n,
        'legacy_head_hash', v_head,
        'legacy_timezone', current_setting('TimeZone'),
        'legacy_datestyle', current_setting('DateStyle')));
  END LOOP;
END $$;

-- ── Privileges ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION devos_audit_append(text, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION devos_audit_record_checkpoint(text, bigint, text, timestamptz, text, text) FROM PUBLIC;

-- Applied by the migration runner to the runtime login role after every
-- migration run, so tables added later receive grants too. Ledger tables and
-- the migration history are read-only for the runtime role.
CREATE OR REPLACE FUNCTION devos_apply_runtime_grants(p_role text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t record;
  protected text[] := ARRAY['audit_events', 'audit_chain_heads', 'audit_checkpoints', 'schema_migrations'];
BEGIN
  IF p_role IS NULL OR p_role = current_user THEN
    RAISE EXCEPTION 'runtime role must be a dedicated role distinct from the migration role';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', p_role);
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t.tablename, p_role);
    IF t.tablename = ANY (protected) THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO %I', t.tablename, p_role);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', t.tablename, p_role);
    END IF;
  END LOOP;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class o ON o.oid = d.refobjid
                             WHERE d.objid = c.oid AND o.relname = ANY (protected)) LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO %I', t.relname, p_role);
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION devos_audit_record_checkpoint(text, bigint, text, timestamptz, text, text) TO %I', p_role);
END;
$$;

REVOKE ALL ON FUNCTION devos_apply_runtime_grants(text) FROM PUBLIC;
