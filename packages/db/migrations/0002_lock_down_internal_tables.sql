-- Internal tables are only ever touched by the connection (owner) role. Enabling RLS
-- with no policies denies every other role by default. This matters on hosted
-- platforms that expose the `public` schema through an auto-generated HTTP API
-- (for example Supabase's `anon` / `authenticated` roles).
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dead_letter_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Belt and braces: if such API roles exist, they get nothing in this schema.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;
END
$$;
