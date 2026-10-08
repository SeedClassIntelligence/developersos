-- WP2: tenant provisioning and account recovery.
--
-- platform:orgs:manage lets a platform administrator create organizations
-- (with their first organization administrator invited). Organization roles
-- never receive it.
--
-- password_reset_tokens holds single-use, expiring self-service reset tokens.
-- Only a SHA-256 hash of each token is stored; the column is named token_hash
-- so the EF-3 capture trigger redacts it from ledger snapshots.

INSERT INTO permissions (id, name, description) VALUES
  ('platform:orgs:manage', 'Provision organizations', 'Create organizations and invite their first administrator')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('platform-admin', 'platform:orgs:manage')
ON CONFLICT DO NOTHING;

CREATE TABLE password_reset_tokens (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens (user_id);

CREATE TRIGGER devos_audit_capture AFTER INSERT OR UPDATE OR DELETE ON password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION devos_capture_audit_event();
