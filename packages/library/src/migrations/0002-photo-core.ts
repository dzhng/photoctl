export const migration0002 = `
  CREATE TABLE photos (
    id uuid PRIMARY KEY,
    primary_original_id uuid NOT NULL,
    w integer NOT NULL CHECK (w > 0),
    h integer NOT NULL CHECK (h > 0),
    orientation integer NOT NULL CHECK (orientation BETWEEN 1 AND 8),
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE originals (
    id uuid PRIMARY KEY,
    photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('raw', 'jpeg', 'image')),
    content_key text NOT NULL,
    content_hash text,
    size bigint NOT NULL CHECK (size >= 0),
    w integer NOT NULL CHECK (w > 0),
    h integer NOT NULL CHECK (h > 0),
    orientation integer NOT NULL CHECK (orientation BETWEEN 1 AND 8),
    camera jsonb NOT NULL DEFAULT '{}'::jsonb,
    exposure jsonb NOT NULL DEFAULT '{}'::jsonb,
    shot_at timestamptz,
    shot_offset_min integer CHECK (shot_offset_min BETWEEN -840 AND 840),
    UNIQUE (photo_id, id),
    UNIQUE (photo_id, kind)
  );

  ALTER TABLE photos ADD CONSTRAINT photos_primary_original_fkey
    FOREIGN KEY (id, primary_original_id) REFERENCES originals(photo_id, id)
    DEFERRABLE INITIALLY DEFERRED;
  CREATE UNIQUE INDEX originals_unpromoted_content_key_idx
    ON originals(content_key) WHERE content_hash IS NULL;
  CREATE UNIQUE INDEX originals_promoted_content_hash_idx
    ON originals(content_key, content_hash) WHERE content_hash IS NOT NULL;
  CREATE INDEX originals_photo_id_idx ON originals(photo_id);

  CREATE TABLE volumes (
    uuid text PRIMARY KEY,
    label text,
    last_mount text NOT NULL,
    last_seen timestamptz NOT NULL
  );

  CREATE TABLE files (
    id uuid PRIMARY KEY,
    original_id uuid NOT NULL REFERENCES originals(id) ON DELETE CASCADE,
    volume_uuid text NOT NULL REFERENCES volumes(uuid),
    rel_path text NOT NULL,
    mtime timestamptz NOT NULL,
    embedded jsonb NOT NULL DEFAULT '[]'::jsonb,
    UNIQUE (volume_uuid, rel_path)
  );

  CREATE INDEX files_original_id_idx ON files(original_id);

  CREATE TABLE cache_index (
    path text PRIMARY KEY,
    bytes bigint NOT NULL CHECK (bytes >= 0),
    last_used timestamptz NOT NULL,
    pinned boolean NOT NULL DEFAULT false
  );
`;
