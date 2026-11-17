-- WP7: execution and collaboration write paths.
--
-- 1. partners:manage — organization administrators and developers maintain the
--    tenant's partner (consultant, contractor) directory.
-- 2. Task dependencies must stay inside one project. task_dependencies only
--    referenced tasks(id), so a dependency on another tenant's task could be
--    stored. A trigger now refuses any dependency whose two tasks are not in
--    the same project (and self-dependencies), at the database boundary.
-- 3. Messages record the authenticated sender (sender_user_id); display fields
--    are derived from that identity, never from the request.
-- 4. Documents gain stored-file metadata. Files live in document storage keyed
--    by organization/project/document; the database keeps the key, size,
--    content type and SHA-256 so downloads can be verified. Rows created
--    before WP7 have no file (metadata-only register entries).

INSERT INTO permissions (id, name, description) VALUES
  ('partners:manage', 'Manage partners', 'Create and update the organization''s partner directory')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('org-admin', 'partners:manage'),
  ('developer', 'partners:manage')
ON CONFLICT DO NOTHING;

-- Existing cross-project dependencies are data defects: refuse to migrate over them.
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(d.task_id || '→' || d.depends_on_task_id, ', ') INTO bad
  FROM task_dependencies d
  JOIN tasks a ON a.id = d.task_id
  JOIN tasks b ON b.id = d.depends_on_task_id
  WHERE a.project_id <> b.project_id OR d.task_id = d.depends_on_task_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'WP7: task dependencies must stay within one project; correct these first: %', bad;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION devos_task_dependency_same_project() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a_project TEXT;
  b_project TEXT;
BEGIN
  IF NEW.task_id = NEW.depends_on_task_id THEN
    RAISE EXCEPTION 'a task cannot depend on itself' USING ERRCODE = '23514';
  END IF;
  SELECT project_id INTO a_project FROM tasks WHERE id = NEW.task_id;
  SELECT project_id INTO b_project FROM tasks WHERE id = NEW.depends_on_task_id;
  IF a_project IS DISTINCT FROM b_project THEN
    RAISE EXCEPTION 'task dependencies must stay within one project' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_dependencies_same_project BEFORE INSERT OR UPDATE ON task_dependencies
FOR EACH ROW EXECUTE FUNCTION devos_task_dependency_same_project();

ALTER TABLE messages ADD COLUMN sender_user_id VARCHAR(100) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE documents
  ADD COLUMN storage_key TEXT,
  ADD COLUMN original_filename VARCHAR(255),
  ADD COLUMN content_type VARCHAR(127),
  ADD COLUMN size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
  ADD COLUMN sha256 CHAR(64),
  ADD COLUMN uploaded_by_user_id VARCHAR(100) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD CONSTRAINT documents_file_complete CHECK (
  (storage_key IS NULL AND sha256 IS NULL AND size_bytes IS NULL)
  OR (storage_key IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL AND content_type IS NOT NULL));
