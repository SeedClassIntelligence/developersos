-- -------------------------------------------------------------
-- 002_security_rbac_schema.sql
-- DEVOS-EF-2 Multi-Tenant Identity, Memberships, RBAC & Invitations
-- -------------------------------------------------------------

-- 1. Roles Table
CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  scope VARCHAR(32) NOT NULL DEFAULT 'organization',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Permissions Table
CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Role Permissions Join Table
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id VARCHAR(64) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id VARCHAR(64) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 4. Memberships Table
CREATE TABLE IF NOT EXISTS memberships (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id VARCHAR(64) NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE', 'REVOKED')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_user_organization UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(organization_id, status);

-- 5. Invitations Table
CREATE TABLE IF NOT EXISTS invitations (
  id VARCHAR(64) PRIMARY KEY,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role_id VARCHAR(64) NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')) DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- -------------------------------------------------------------
-- Seed Core Roles
-- -------------------------------------------------------------
INSERT INTO roles (id, name, description, scope) VALUES
  ('platform-admin', 'Platform Administrator', 'Full platform-wide administration and metrics inspection', 'platform'),
  ('org-admin', 'Organization Administrator', 'Full administrative authority within active organization', 'organization'),
  ('developer', 'Developer / Project Lead', 'Project execution, task management, contracts and permits', 'organization'),
  ('viewer', 'Read-Only Viewer', 'Auditor and read-only project participant', 'organization')
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------
-- Seed Granular Permissions
-- -------------------------------------------------------------
INSERT INTO permissions (id, name, description) VALUES
  ('projects:read', 'View projects in organization', 'Read project details and summaries'),
  ('projects:create', 'Create project', 'Create new projects owned by organization'),
  ('projects:update', 'Update project', 'Modify project attributes'),
  ('projects:delete', 'Delete project', 'Delete project from organization'),
  ('tasks:read', 'View tasks', 'Read project tasks and dependencies'),
  ('tasks:create', 'Create task', 'Create new tasks in project'),
  ('tasks:update', 'Update task', 'Modify task metadata and dependencies'),
  ('tasks:status:update', 'Update task status', 'Transition task progress status'),
  ('tasks:delete', 'Delete task', 'Remove task from project'),
  ('contracts:read', 'View contracts', 'Read contract documents and values'),
  ('contracts:create', 'Create contract', 'Create new partner contract'),
  ('contracts:update', 'Update contract', 'Modify contract metadata'),
  ('contracts:execute', 'Execute contract', 'Execute contract and trigger task unblocking'),
  ('contracts:delete', 'Delete contract', 'Remove partner contract'),
  ('permits:read', 'View permits', 'Read permit tracking records'),
  ('permits:status:update', 'Update permit status', 'Advance permit workflow status'),
  ('permits:corrections:update', 'Update permit correction item', 'Mark correction complete/resolved'),
  ('capital:read', 'View capital stack', 'Read capital stack breakdown and sources'),
  ('capital:update', 'Update capital stack', 'Modify project capital sources and budgets'),
  ('messages:read', 'View channels and messages', 'Read team communication streams'),
  ('messages:send', 'Send message', 'Post message to channel'),
  ('channels:read', 'View channel directory', 'List available project channels'),
  ('documents:read', 'View documents', 'List and inspect project document records'),
  ('documents:create', 'Upload/create document', 'Create new document metadata'),
  ('documents:delete', 'Delete document', 'Remove project document record'),
  ('team:read', 'View team members', 'Read internal organization directory'),
  ('team:manage', 'Manage team members', 'Create or update organization directory members'),
  ('invitations:create', 'Issue invitations', 'Invite new users to organization'),
  ('invitations:revoke', 'Revoke invitations', 'Cancel pending organization invitations'),
  ('org:admin:manage', 'Organization administration', 'Manage organization settings and members'),
  ('platform:admin:stats', 'Platform statistics', 'Inspect cross-tenant system metrics'),
  ('platform:admin:health', 'Platform health', 'Inspect global system runtime health')
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------
-- Associate Role Permissions
-- -------------------------------------------------------------
-- Platform Admin: platform stats, health, and read capabilities
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('platform-admin', 'platform:admin:stats'),
  ('platform-admin', 'platform:admin:health'),
  ('platform-admin', 'projects:read'),
  ('platform-admin', 'tasks:read'),
  ('platform-admin', 'contracts:read'),
  ('platform-admin', 'permits:read'),
  ('platform-admin', 'capital:read'),
  ('platform-admin', 'messages:read'),
  ('platform-admin', 'channels:read'),
  ('platform-admin', 'documents:read'),
  ('platform-admin', 'team:read')
ON CONFLICT DO NOTHING;

-- Org Admin: All organization permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'org-admin', id FROM permissions WHERE id NOT LIKE 'platform:%'
ON CONFLICT DO NOTHING;

-- Developer: Project management, task execution, contracts, permits, capital, chat, docs (no projects:delete, no invitations, no org:admin)
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('developer', 'projects:read'),
  ('developer', 'projects:create'),
  ('developer', 'projects:update'),
  ('developer', 'tasks:read'),
  ('developer', 'tasks:create'),
  ('developer', 'tasks:update'),
  ('developer', 'tasks:status:update'),
  ('developer', 'tasks:delete'),
  ('developer', 'contracts:read'),
  ('developer', 'contracts:create'),
  ('developer', 'contracts:update'),
  ('developer', 'contracts:execute'),
  ('developer', 'contracts:delete'),
  ('developer', 'permits:read'),
  ('developer', 'permits:status:update'),
  ('developer', 'permits:corrections:update'),
  ('developer', 'capital:read'),
  ('developer', 'capital:update'),
  ('developer', 'messages:read'),
  ('developer', 'messages:send'),
  ('developer', 'channels:read'),
  ('developer', 'documents:read'),
  ('developer', 'documents:create'),
  ('developer', 'documents:delete'),
  ('developer', 'team:read')
ON CONFLICT DO NOTHING;

-- Viewer: Read-only access across all domains
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('viewer', 'projects:read'),
  ('viewer', 'tasks:read'),
  ('viewer', 'contracts:read'),
  ('viewer', 'permits:read'),
  ('viewer', 'capital:read'),
  ('viewer', 'messages:read'),
  ('viewer', 'channels:read'),
  ('viewer', 'documents:read'),
  ('viewer', 'team:read')
ON CONFLICT DO NOTHING;
