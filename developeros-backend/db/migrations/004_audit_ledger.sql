-- DEVOS-EF-3: transactionally coupled, append-only, tamper-evident audit ledger.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  organization_id VARCHAR(100),
  actor_user_id VARCHAR(100),
  request_id VARCHAR(100),
  action VARCHAR(16) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  previous_hash VARCHAR(64),
  event_hash VARCHAR(64) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_time ON audit_events(organization_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_request ON audit_events(request_id);

INSERT INTO permissions (id, name, description) VALUES
  ('audit:read', 'Read organization audit ledger', 'Inspect and verify the active organization audit trail')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('org-admin', 'audit:read'),
  ('platform-admin', 'audit:read')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION devos_block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION devos_block_audit_mutation();

CREATE OR REPLACE FUNCTION devos_capture_audit_event() RETURNS trigger AS $$
DECLARE
  source_row JSONB;
  safe_old JSONB;
  safe_new JSONB;
  org_id TEXT;
  entity_key TEXT;
  actor_id TEXT;
  req_id TEXT;
  prior_hash TEXT;
  new_id UUID;
  new_time TIMESTAMPTZ;
  new_hash TEXT;
BEGIN
  source_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  safe_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) - 'password_hash' - 'token_hash' END;
  safe_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - 'password_hash' - 'token_hash' END;

  org_id := NULLIF(current_setting('app.organization_id', true), '');
  org_id := COALESCE(org_id, source_row->>'organization_id', source_row->>'org_id');
  IF org_id IS NULL AND TG_TABLE_NAME = 'organizations' THEN org_id := source_row->>'id'; END IF;

  actor_id := NULLIF(current_setting('app.actor_user_id', true), '');
  req_id := NULLIF(current_setting('app.request_id', true), '');
  entity_key := COALESCE(source_row->>'id', source_row->>'task_id', source_row->>'role_id', encode(digest(source_row::text, 'sha256'), 'hex'));

  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(org_id, '__platform__')));
  SELECT event_hash INTO prior_hash
  FROM audit_events
  WHERE organization_id IS NOT DISTINCT FROM org_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  new_id := gen_random_uuid();
  new_time := clock_timestamp();
  new_hash := encode(digest(concat_ws('|', new_id::text, new_time::text, COALESCE(org_id,''),
    COALESCE(actor_id,''), COALESCE(req_id,''), TG_OP, TG_TABLE_NAME, entity_key,
    COALESCE(safe_old::text,''), COALESCE(safe_new::text,''), COALESCE(prior_hash,'')), 'sha256'), 'hex');

  INSERT INTO audit_events (id, occurred_at, organization_id, actor_user_id, request_id,
    action, entity_type, entity_id, before_state, after_state, previous_hash, event_hash)
  VALUES (new_id, new_time, org_id, actor_id, req_id, TG_OP, TG_TABLE_NAME, entity_key,
    safe_old, safe_new, prior_hash, new_hash);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations','users','partners','projects','contracts','tasks','task_dependencies',
    'permits','permit_corrections','capital_stacks','capital_sources','channels','messages',
    'documents','team_members','roles','permissions','role_permissions','memberships','invitations'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS devos_audit_capture ON %I', table_name);
    EXECUTE format('CREATE TRIGGER devos_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION devos_capture_audit_event()', table_name);
  END LOOP;
END $$;
