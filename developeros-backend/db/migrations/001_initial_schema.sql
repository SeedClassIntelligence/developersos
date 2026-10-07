-- -------------------------------------------------------------
-- Migration 001: Initial Relational Persistence Schema
-- Establishes organizations, users, projects, SOW execution, 
-- permits, capital stack, communications, and audit primitives.
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100),
  projects_count INT DEFAULT 0,
  users_count INT DEFAULT 0,
  plan VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(100) PRIMARY KEY,
  org_id VARCHAR(100) REFERENCES organizations(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(100) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Partners
CREATE TABLE IF NOT EXISTS partners (
  id VARCHAR(100) PRIMARY KEY,
  org_id VARCHAR(100) REFERENCES organizations(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100) NOT NULL,
  initials VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Projects
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(100) PRIMARY KEY,
  organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100),
  units INT DEFAULT 0,
  affordable_units INT DEFAULT 0,
  budget NUMERIC(15,2) DEFAULT 0.00,
  progress INT DEFAULT 0,
  phase INT DEFAULT 1,
  phase_label VARCHAR(100),
  status VARCHAR(50) DEFAULT 'on-track',
  alert_count INT DEFAULT 0,
  city VARCHAR(100),
  program VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Contracts
CREATE TABLE IF NOT EXISTS contracts (
  id VARCHAR(100) PRIMARY KEY,
  project_id VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  partner_id VARCHAR(100) REFERENCES partners(id) ON DELETE SET NULL,
  type VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  value NUMERIC(15,2),
  executed_date DATE,
  linked_task_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(100) PRIMARY KEY,
  project_id VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  discipline VARCHAR(100),
  partner_id VARCHAR(100) REFERENCES partners(id) ON DELETE SET NULL,
  contract_id VARCHAR(100) REFERENCES contracts(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'not-started',
  due_date DATE,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Task Dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id VARCHAR(100) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id VARCHAR(100) NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);

-- 8. Permits
CREATE TABLE IF NOT EXISTS permits (
  id VARCHAR(100) PRIMARY KEY,
  project_id VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  jurisdiction VARCHAR(255),
  type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'draft',
  submitted_date DATE,
  approved_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Permit Corrections
CREATE TABLE IF NOT EXISTS permit_corrections (
  id VARCHAR(100) PRIMARY KEY,
  permit_id VARCHAR(100) NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'not-started',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Capital Stacks
CREATE TABLE IF NOT EXISTS capital_stacks (
  id VARCHAR(100) PRIMARY KEY,
  project_id VARCHAR(100) UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total_cost NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Capital Sources
CREATE TABLE IF NOT EXISTS capital_sources (
  id VARCHAR(100) PRIMARY KEY,
  capital_stack_id VARCHAR(100) NOT NULL REFERENCES capital_stacks(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  pct NUMERIC(5,2),
  status VARCHAR(50) DEFAULT 'pending',
  color VARCHAR(50),
  deadline DATE,
  alert TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Channels
CREATE TABLE IF NOT EXISTS channels (
  id VARCHAR(100) PRIMARY KEY,
  project_id VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  unread INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Messages
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(100) PRIMARY KEY,
  channel_id VARCHAR(100) NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_name VARCHAR(255) NOT NULL,
  sender_initials VARCHAR(10),
  sender_color VARCHAR(50),
  role VARCHAR(100),
  text TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Documents
CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(100) PRIMARY KEY,
  project_id VARCHAR(100) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  uploaded_by VARCHAR(255),
  date DATE,
  type VARCHAR(50),
  icon VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Team Members
CREATE TABLE IF NOT EXISTS team_members (
  id VARCHAR(100) PRIMARY KEY,
  organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100) NOT NULL,
  projects VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contract ON tasks(contract_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_permits_project ON permits(project_id);
CREATE INDEX IF NOT EXISTS idx_permit_corrections_permit ON permit_corrections(permit_id);
CREATE INDEX IF NOT EXISTS idx_capital_sources_stack ON capital_sources(capital_stack_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_channels_project ON channels(project_id);
