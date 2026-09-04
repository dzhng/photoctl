CREATE TABLE schema_version (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

INSERT INTO schema_version (version) VALUES (1);
INSERT INTO settings (key, value) VALUES
  ('library_id', '"0199a7c2-0000-7000-8000-000000000001"'::jsonb),
  ('cache_max_bytes', '21474836480'::jsonb),
  ('daemon_idle_ms', '900000'::jsonb);
