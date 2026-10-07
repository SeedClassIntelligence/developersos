-- DEVOS-DI-1: Development Intelligence Foundation.
-- Contract: docs/DEVOS-DI1-ACCEPTANCE-CONTRACT.md
--
-- Tenant integrity is relational: every table carries organization_id, and
-- every same-tenant reference is a composite foreign key onto
-- (organization_id, id) of the referenced row, so a cross-tenant reference
-- cannot be stored even if application checks are bypassed.
-- EF-3 is used, not modified: each table gets the existing capture trigger.

-- ── Relationships ───────────────────────────────────────────────────────────
CREATE TABLE di_relationships (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  relationship_type VARCHAR(120) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('USER_ENTRY', 'PUBLIC_RECORD', 'DOCUMENT', 'CONNECTED_SYSTEM', 'SYSTEM_DERIVED')),
  source_reference TEXT,
  recorded_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT di_relationships_tenant_key UNIQUE (organization_id, id)
);

-- ── Properties ──────────────────────────────────────────────────────────────
CREATE TABLE di_properties (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  street_address VARCHAR(255),
  city VARCHAR(120),
  region VARCHAR(120),
  postal_code VARCHAR(32),
  country VARCHAR(64),
  apn VARCHAR(64),
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('USER_ENTRY', 'PUBLIC_RECORD', 'DOCUMENT', 'CONNECTED_SYSTEM', 'SYSTEM_DERIVED')),
  source_reference TEXT,
  recorded_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT di_properties_tenant_key UNIQUE (organization_id, id)
);

-- ── Opportunities ───────────────────────────────────────────────────────────
-- An Opportunity never references projects: it is not a Project.
CREATE TABLE di_opportunities (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  property_id VARCHAR(64),
  relationship_id VARCHAR(64),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'SCREENING', 'INFORMATION_REQUIRED', 'READY_FOR_QUALIFICATION', 'DECLINED', 'WITHDRAWN', 'EXPIRED')),
  concept_description TEXT,
  responsible_user_id VARCHAR(64),
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('USER_ENTRY', 'PUBLIC_RECORD', 'DOCUMENT', 'CONNECTED_SYSTEM', 'SYSTEM_DERIVED')),
  source_reference TEXT,
  recorded_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT di_opportunities_tenant_key UNIQUE (organization_id, id),
  CONSTRAINT di_opportunities_property_same_tenant FOREIGN KEY (organization_id, property_id)
    REFERENCES di_properties (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT di_opportunities_relationship_same_tenant FOREIGN KEY (organization_id, relationship_id)
    REFERENCES di_relationships (organization_id, id) ON DELETE RESTRICT,
  -- The responsible party must be a member of the same organization.
  CONSTRAINT di_opportunities_responsible_member FOREIGN KEY (responsible_user_id, organization_id)
    REFERENCES memberships (user_id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX idx_di_opportunities_org_status ON di_opportunities (organization_id, status);

CREATE TABLE di_opportunity_status_history (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  opportunity_id VARCHAR(64) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  changed_by VARCHAR(100) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT di_status_history_same_tenant FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES di_opportunities (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_di_status_history_org_opp ON di_opportunity_status_history (organization_id, opportunity_id, changed_at);

-- ── Site Intelligence (Property aggregate, versioned per fact) ─────────────
CREATE TABLE di_site_facts (
  id VARCHAR(100) PRIMARY KEY,
  organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  property_id VARCHAR(64) NOT NULL,
  fact_key VARCHAR(64) NOT NULL CHECK (fact_key IN (
    'apn', 'ownership', 'lot_area_sqft', 'acquisition_basis', 'acquisition_structure', 'current_use',
    'zoning', 'future_land_use', 'overlays', 'density_du_per_acre', 'far', 'height_limit_ft',
    'setbacks', 'parking', 'utilities', 'access', 'easements', 'flood_zone', 'environmental',
    'demolition', 'entitlement_path', 'known_constraints')),
  value JSONB,
  value_status VARCHAR(16) NOT NULL CHECK (value_status IN ('KNOWN', 'UNKNOWN', 'NOT_APPLICABLE')),
  version INT NOT NULL CHECK (version >= 1),
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('USER_ENTRY', 'PUBLIC_RECORD', 'DOCUMENT', 'CONNECTED_SYSTEM', 'SYSTEM_DERIVED')),
  source_reference TEXT,
  recorded_by VARCHAR(100) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Unknown stays distinguishable from known: no manufactured values.
  CONSTRAINT di_site_facts_value_matches_status CHECK (
    (value_status = 'KNOWN' AND value IS NOT NULL AND value <> 'null'::jsonb) OR
    (value_status <> 'KNOWN' AND value IS NULL)),
  CONSTRAINT di_site_facts_version_unique UNIQUE (property_id, fact_key, version),
  CONSTRAINT di_site_facts_same_tenant FOREIGN KEY (organization_id, property_id)
    REFERENCES di_properties (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_di_site_facts_org_property ON di_site_facts (organization_id, property_id, fact_key, version DESC);

-- ── Findings ────────────────────────────────────────────────────────────────
CREATE TABLE intelligence_findings (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  rule_id VARCHAR(100) NOT NULL,
  rule_version INT NOT NULL,
  condition_key TEXT NOT NULL,
  finding_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  sources JSONB NOT NULL CHECK (jsonb_typeof(sources) = 'array'),
  state VARCHAR(16) NOT NULL CHECK (state IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  as_of TIMESTAMPTZ NOT NULL,
  first_detected_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolution VARCHAR(64),
  recurrence_of VARCHAR(64),
  CONSTRAINT intelligence_findings_tenant_key UNIQUE (organization_id, id),
  CONSTRAINT intelligence_findings_recurrence_same_tenant FOREIGN KEY (organization_id, recurrence_of)
    REFERENCES intelligence_findings (organization_id, id) ON DELETE RESTRICT
);
-- No duplicate active finding for one unchanged condition.
CREATE UNIQUE INDEX intelligence_findings_one_active
  ON intelligence_findings (organization_id, rule_id, condition_key)
  WHERE state <> 'RESOLVED';
CREATE INDEX idx_intelligence_findings_org_state ON intelligence_findings (organization_id, state);

CREATE TABLE intelligence_finding_events (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  finding_id VARCHAR(64) NOT NULL,
  from_state VARCHAR(16),
  to_state VARCHAR(16) NOT NULL CHECK (to_state IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  actor_user_id VARCHAR(100),
  note TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT intelligence_finding_events_same_tenant FOREIGN KEY (organization_id, finding_id)
    REFERENCES intelligence_findings (organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_intelligence_finding_events_org_finding ON intelligence_finding_events (organization_id, finding_id, occurred_at);

-- ── Durable history ─────────────────────────────────────────────────────────
-- History rows are never deleted by any principal while protections are on.
-- (TRUNCATE ... CASCADE from the test seeder's organization reset does not
-- fire row triggers; the runtime role holds no TRUNCATE privilege.)
CREATE OR REPLACE FUNCTION devos_di_block_history_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is durable history and cannot be deleted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER di_status_history_no_delete BEFORE DELETE ON di_opportunity_status_history
FOR EACH ROW EXECUTE FUNCTION devos_di_block_history_delete();
CREATE TRIGGER di_site_facts_no_delete BEFORE DELETE ON di_site_facts
FOR EACH ROW EXECUTE FUNCTION devos_di_block_history_delete();
CREATE TRIGGER intelligence_findings_no_delete BEFORE DELETE ON intelligence_findings
FOR EACH ROW EXECUTE FUNCTION devos_di_block_history_delete();
CREATE TRIGGER intelligence_finding_events_no_delete BEFORE DELETE ON intelligence_finding_events
FOR EACH ROW EXECUTE FUNCTION devos_di_block_history_delete();

-- Status history, site facts and finding events are also immutable once written.
CREATE OR REPLACE FUNCTION devos_di_block_history_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only history', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER di_status_history_no_update BEFORE UPDATE ON di_opportunity_status_history
FOR EACH ROW EXECUTE FUNCTION devos_di_block_history_update();
CREATE TRIGGER di_site_facts_no_update BEFORE UPDATE ON di_site_facts
FOR EACH ROW EXECUTE FUNCTION devos_di_block_history_update();
CREATE TRIGGER intelligence_finding_events_no_update BEFORE UPDATE ON intelligence_finding_events
FOR EACH ROW EXECUTE FUNCTION devos_di_block_history_update();

-- ── EF-3 audit capture (existing frozen function, attached to new tables) ──
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['di_relationships', 'di_properties', 'di_opportunities', 'di_opportunity_status_history',
                           'di_site_facts', 'intelligence_findings', 'intelligence_finding_events'] LOOP
    EXECUTE format('CREATE TRIGGER devos_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION devos_capture_audit_event()', t);
  END LOOP;
END $$;

-- ── Permissions (EF-2 catalog) ──────────────────────────────────────────────
INSERT INTO permissions (id, name, description) VALUES
  ('relationships:read', 'View development relationships', 'Read relationships through which opportunities originate'),
  ('relationships:create', 'Create development relationship', 'Record a new development relationship'),
  ('relationships:update', 'Update development relationship', 'Modify development relationship attributes'),
  ('properties:read', 'View properties', 'Read development properties'),
  ('properties:create', 'Create property', 'Record a new property'),
  ('properties:update', 'Update property', 'Modify property attributes'),
  ('opportunities:read', 'View opportunities', 'Read development opportunities, history and readiness'),
  ('opportunities:create', 'Create opportunity', 'Record a new development opportunity'),
  ('opportunities:update', 'Update opportunity', 'Modify opportunity attributes'),
  ('opportunities:transition', 'Transition opportunity', 'Move an opportunity through its information lifecycle'),
  ('site_intelligence:read', 'View site intelligence', 'Read property site facts and their history'),
  ('site_intelligence:update', 'Update site intelligence', 'Record new versions of property site facts'),
  ('findings:read', 'View findings', 'Read deterministic findings, history and the rule registry'),
  ('findings:evaluate', 'Evaluate findings', 'Run deterministic rule evaluation for the organization'),
  ('findings:acknowledge', 'Acknowledge findings', 'Acknowledge an open finding'),
  ('findings:resolve', 'Resolve findings', 'Resolve an active finding')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.id
FROM (VALUES ('org-admin'), ('developer')) AS r(role_id)
CROSS JOIN permissions p
WHERE p.id IN ('relationships:read', 'relationships:create', 'relationships:update',
               'properties:read', 'properties:create', 'properties:update',
               'opportunities:read', 'opportunities:create', 'opportunities:update', 'opportunities:transition',
               'site_intelligence:read', 'site_intelligence:update',
               'findings:read', 'findings:evaluate', 'findings:acknowledge', 'findings:resolve')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('viewer', 'relationships:read'),
  ('viewer', 'properties:read'),
  ('viewer', 'opportunities:read'),
  ('viewer', 'site_intelligence:read'),
  ('viewer', 'findings:read')
ON CONFLICT DO NOTHING;
-- platform-admin deliberately receives no Development Intelligence permission.
