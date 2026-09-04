CREATE TABLE schema_version (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE photos (
  id uuid PRIMARY KEY,
  content_key text NOT NULL UNIQUE,
  size bigint NOT NULL CHECK (size >= 0),
  w integer NOT NULL CHECK (w > 0),
  h integer NOT NULL CHECK (h > 0),
  orientation integer NOT NULL CHECK (orientation BETWEEN 1 AND 8),
  camera jsonb NOT NULL DEFAULT '{}'::jsonb,
  exposure jsonb NOT NULL DEFAULT '{}'::jsonb,
  shot_at timestamptz,
  shot_offset_min integer CHECK (shot_offset_min BETWEEN -840 AND 840),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE volumes (
  uuid text PRIMARY KEY,
  label text,
  last_mount text NOT NULL,
  last_seen timestamptz NOT NULL
);

CREATE TABLE files (
  id uuid PRIMARY KEY,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  volume_uuid text NOT NULL REFERENCES volumes(uuid),
  rel_path text NOT NULL,
  mtime timestamptz NOT NULL,
  embedded jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (volume_uuid, rel_path)
);

CREATE INDEX files_photo_id_idx ON files(photo_id);

CREATE TABLE cache_index (
  path text PRIMARY KEY,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  last_used timestamptz NOT NULL,
  pinned boolean NOT NULL DEFAULT false
);

CREATE TABLE tags (
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (length(tag) > 0),
  PRIMARY KEY (photo_id, tag)
);

INSERT INTO schema_version (version) VALUES (1), (2), (3);
INSERT INTO settings (key, value) VALUES
  ('library_id', '"0199a7c2-0000-7000-8000-000000000001"'::jsonb),
  ('cache_max_bytes', '21474836480'::jsonb),
  ('daemon_idle_ms', '900000'::jsonb),
  ('daemon_queue_max', '8'::jsonb);
INSERT INTO photos
  (id, content_key, size, w, h, orientation, camera, exposure, shot_at, shot_offset_min)
VALUES
  ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ck_3dac5c943a33dcc4', 73400320,
   7008, 4672, 1, '{"make":"SONY","model":"ILCE-7CM2"}', '{}',
   '2023-10-02T16:18:37Z', 120);
INSERT INTO volumes (uuid, label, last_mount, last_seen)
VALUES ('6A1F-0C3B', 'A7C2', '/Volumes/A7C2', '2023-10-02T16:18:37Z');
INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime, embedded)
VALUES
  ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002',
   '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '6A1F-0C3B', 'a7c2.ARW',
   '2023-10-02T16:18:37Z',
   '[{"width":160,"height":120,"offset":44146,"length":8217},{"width":1616,"height":1080,"offset":192674,"length":466017},{"width":7008,"height":4672,"offset":659456,"length":6730200}]');
INSERT INTO cache_index (path, bytes, last_used, pinned)
VALUES
  ('emb/0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001.jpg', 466017,
   '2023-10-02T16:18:37Z', true);
INSERT INTO tags (photo_id, tag)
VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ceremony');
