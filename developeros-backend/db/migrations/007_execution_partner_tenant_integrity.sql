-- DEVOS-DI1-D1: execution Partner tenant integrity at the relational boundary.
--
-- tasks.partner_id and contracts.partner_id referenced partners(id) alone, so
-- PostgreSQL accepted another organization's partner; only the API refused.
-- This migration gives tasks and contracts an explicit tenant column and
-- enforces same-tenant references with composite foreign keys, the same
-- architecture DI-1 uses:
--
--   (project_id, organization_id) -> projects (id, organization_id)  ON UPDATE CASCADE
--   (partner_id, organization_id) -> partners (id, org_id)            ON DELETE SET NULL (partner_id)
--
-- organization_id is derived from the project when omitted (existing INSERT
-- statements are unchanged). A supplied value that disagrees with the project
-- fails the project key, so it cannot be forged. Moving a project to another
-- organization cascades to its rows and is rejected while any of them still
-- references the previous tenant's partner.

-- Referenced tenant keys.
ALTER TABLE projects ADD CONSTRAINT projects_tenant_key UNIQUE (id, organization_id);
ALTER TABLE partners ADD CONSTRAINT partners_tenant_key UNIQUE (id, org_id);

ALTER TABLE contracts ADD COLUMN organization_id VARCHAR(100);
ALTER TABLE tasks ADD COLUMN organization_id VARCHAR(100);

UPDATE contracts c SET organization_id = p.organization_id FROM projects p WHERE p.id = c.project_id;
UPDATE tasks t SET organization_id = p.organization_id FROM projects p WHERE p.id = t.project_id;

-- Existing cross-tenant rows are data defects: refuse to migrate over them
-- rather than silently clearing or rewriting a partner reference.
DO $$
DECLARE
  bad_contracts TEXT;
  bad_tasks TEXT;
BEGIN
  SELECT string_agg(c.id, ', ') INTO bad_contracts FROM contracts c JOIN partners pa ON pa.id = c.partner_id WHERE pa.org_id <> c.organization_id;
  SELECT string_agg(t.id, ', ') INTO bad_tasks FROM tasks t JOIN partners pa ON pa.id = t.partner_id WHERE pa.org_id <> t.organization_id;
  IF bad_contracts IS NOT NULL OR bad_tasks IS NOT NULL THEN
    RAISE EXCEPTION 'DI1-D1: cross-tenant partner references must be corrected before this migration (contracts: %; tasks: %)',
      COALESCE(bad_contracts, 'none'), COALESCE(bad_tasks, 'none');
  END IF;
END $$;

ALTER TABLE contracts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN organization_id SET NOT NULL;

-- Derivation only: integrity is carried by the foreign keys below.
CREATE OR REPLACE FUNCTION devos_derive_execution_tenant() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NULL THEN
      SELECT organization_id INTO NEW.organization_id FROM projects WHERE id = NEW.project_id;
    END IF;
  ELSIF NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    SELECT organization_id INTO NEW.organization_id FROM projects WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contracts_derive_tenant BEFORE INSERT OR UPDATE OF project_id ON contracts
FOR EACH ROW EXECUTE FUNCTION devos_derive_execution_tenant();
CREATE TRIGGER tasks_derive_tenant BEFORE INSERT OR UPDATE OF project_id ON tasks
FOR EACH ROW EXECUTE FUNCTION devos_derive_execution_tenant();

ALTER TABLE contracts ADD CONSTRAINT contracts_project_same_tenant
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id) ON UPDATE CASCADE;
ALTER TABLE contracts ADD CONSTRAINT contracts_partner_same_tenant
  FOREIGN KEY (partner_id, organization_id) REFERENCES partners (id, org_id) ON DELETE SET NULL (partner_id);

ALTER TABLE tasks ADD CONSTRAINT tasks_project_same_tenant
  FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id) ON UPDATE CASCADE;
ALTER TABLE tasks ADD CONSTRAINT tasks_partner_same_tenant
  FOREIGN KEY (partner_id, organization_id) REFERENCES partners (id, org_id) ON DELETE SET NULL (partner_id);

CREATE INDEX idx_contracts_org ON contracts (organization_id);
CREATE INDEX idx_tasks_org ON tasks (organization_id);
