-- -------------------------------------------------------------
-- 003_integrity_hardening.sql
-- Audit remediation: referential integrity, ownership and value constraints
--
-- Delete-rule policy (documented decision):
--   * Children of a project (contracts, tasks, permits, capital_stacks,
--     channels, documents)  -> ON DELETE RESTRICT.  Historical / financial
--     records must never be destroyed implicitly by deleting a project.
--     Projects with dependents must be archived/cleaned deliberately; the
--     API returns 409 Conflict.
--   * Tenant ownership (projects / partners / team_members -> organizations)
--     -> RESTRICT + NOT NULL: a tenant-owned row can never become ownerless.
--     (users.org_id stays nullable/SET NULL: platform-level users are unaffiliated.)
--   * Pure sub-records (permit_corrections, capital_sources, task_dependencies,
--     messages) keep ON DELETE CASCADE from their direct parent - they have no
--     meaning without it and are unreachable via project delete now.
--   * tasks.contract_id: SET NULL (only the contract column) when a contract
--     is removed.
-- -------------------------------------------------------------

-- 1. Project children: CASCADE -> RESTRICT
ALTER TABLE contracts       DROP CONSTRAINT IF EXISTS contracts_project_id_fkey;
ALTER TABLE contracts       ADD  CONSTRAINT contracts_project_id_fkey       FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE tasks           DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;
ALTER TABLE tasks           ADD  CONSTRAINT tasks_project_id_fkey           FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE permits         DROP CONSTRAINT IF EXISTS permits_project_id_fkey;
ALTER TABLE permits         ADD  CONSTRAINT permits_project_id_fkey         FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE capital_stacks  DROP CONSTRAINT IF EXISTS capital_stacks_project_id_fkey;
ALTER TABLE capital_stacks  ADD  CONSTRAINT capital_stacks_project_id_fkey  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE channels        DROP CONSTRAINT IF EXISTS channels_project_id_fkey;
ALTER TABLE channels        ADD  CONSTRAINT channels_project_id_fkey        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE documents       DROP CONSTRAINT IF EXISTS documents_project_id_fkey;
ALTER TABLE documents       ADD  CONSTRAINT documents_project_id_fkey       FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;

-- 2. Mandatory tenant ownership
ALTER TABLE projects     DROP CONSTRAINT IF EXISTS projects_organization_id_fkey;
ALTER TABLE projects     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE projects     ADD  CONSTRAINT projects_organization_id_fkey     FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE partners     DROP CONSTRAINT IF EXISTS partners_org_id_fkey;
ALTER TABLE partners     ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE partners     ADD  CONSTRAINT partners_org_id_fkey              FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_organization_id_fkey;
ALTER TABLE team_members ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE team_members ADD  CONSTRAINT team_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- 3. A task may only reference a contract of its OWN project (DB-enforced)
ALTER TABLE contracts ADD CONSTRAINT uq_contracts_id_project UNIQUE (id, project_id);
ALTER TABLE tasks     DROP CONSTRAINT IF EXISTS tasks_contract_id_fkey;
ALTER TABLE tasks     ADD  CONSTRAINT tasks_contract_project_fkey
  FOREIGN KEY (contract_id, project_id) REFERENCES contracts(id, project_id) ON DELETE SET NULL (contract_id);

-- 4. Value constraints
ALTER TABLE projects        ADD CONSTRAINT chk_projects_units      CHECK (units >= 0 AND affordable_units >= 0 AND affordable_units <= units);
ALTER TABLE projects        ADD CONSTRAINT chk_projects_budget     CHECK (budget >= 0);
ALTER TABLE projects        ADD CONSTRAINT chk_projects_progress   CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE contracts       ADD CONSTRAINT chk_contracts_value     CHECK (value IS NULL OR value >= 0);
ALTER TABLE capital_stacks  ADD CONSTRAINT chk_capital_total       CHECK (total_cost >= 0);
ALTER TABLE capital_sources ADD CONSTRAINT chk_capital_amount      CHECK (amount >= 0);
ALTER TABLE capital_sources ADD CONSTRAINT chk_capital_pct         CHECK (pct IS NULL OR pct BETWEEN 0 AND 100);
ALTER TABLE tasks           ADD CONSTRAINT chk_tasks_status        CHECK (status IN ('not-started', 'in-progress', 'blocked', 'complete'));
