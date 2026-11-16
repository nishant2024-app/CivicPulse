-- Hand-written migration: restricted application role, row-level security,
-- and append-only enforcement. See docs/database/DATABASE_DESIGN.md §6.
--
-- Tenant-scoped transactions run `SET LOCAL ROLE civicpulse_app` after setting
-- `app.organization_id`. Policies target that role only, so privileged code paths
-- (authentication, workers, migrations) running as the table owner are unaffected.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'civicpulse_app') THEN
    CREATE ROLE civicpulse_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  -- The connecting role must be able to SET ROLE into civicpulse_app.
  IF NOT pg_has_role(current_user, 'civicpulse_app', 'SET') THEN
    IF current_setting('server_version_num')::int >= 160000 THEN
      EXECUTE format('GRANT civicpulse_app TO %I WITH SET TRUE, INHERIT FALSE', current_user);
    ELSE
      EXECUTE format('GRANT civicpulse_app TO %I', current_user);
    END IF;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO civicpulse_app;
--> statement-breakpoint

-- Tenant tables with full DML.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  departments, organization_members, worker_profiles, invitations,
  complaint_categories, sla_policies, complaints, complaint_assignments,
  complaint_attachments, complaint_comments, complaint_feedback, notifications
TO civicpulse_app;
--> statement-breakpoint
-- Append-only tables: no UPDATE/DELETE privilege at all for the application role.
GRANT SELECT, INSERT ON complaint_status_history, audit_logs TO civicpulse_app;
--> statement-breakpoint
GRANT INSERT ON outbox_events TO civicpulse_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON organizations TO civicpulse_app;
--> statement-breakpoint
-- Column-level grant: the application role can never read password hashes.
GRANT SELECT (id, email, full_name, phone, status, created_at) ON users TO civicpulse_app;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments', 'organization_members', 'worker_profiles', 'invitations',
    'complaint_categories', 'sla_policies', 'complaints', 'complaint_assignments',
    'complaint_attachments', 'complaint_comments', 'complaint_feedback', 'notifications',
    'complaint_status_history', 'audit_logs', 'outbox_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    -- current_setting(..., true) is NULL when unset, so the comparison is NULL and
    -- the policy fails closed: no rows visible, no rows insertable.
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I FOR ALL TO civicpulse_app
      USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
      WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END
$$;
--> statement-breakpoint

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON organizations;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations FOR ALL TO civicpulse_app
  USING (id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint

-- Users are global, but a tenant transaction may only see itself and members of
-- the active organization. The subquery is itself filtered by RLS.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_visible_users ON users;
--> statement-breakpoint
CREATE POLICY tenant_visible_users ON users FOR SELECT TO civicpulse_app
  USING (
    id = nullif(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM organization_members m
      WHERE m.user_id = users.id
    )
  );
--> statement-breakpoint

-- Append-only enforcement for every role, including the table owner.
CREATE OR REPLACE FUNCTION civicpulse_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Retention jobs may delete (never update) after explicitly opting in for the transaction.
  IF TG_OP = 'DELETE' AND current_setting('app.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS complaint_status_history_immutable ON complaint_status_history;
--> statement-breakpoint
CREATE TRIGGER complaint_status_history_immutable
  BEFORE UPDATE OR DELETE ON complaint_status_history
  FOR EACH ROW EXECUTE FUNCTION civicpulse_reject_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION civicpulse_reject_mutation();
