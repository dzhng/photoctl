export const migration0002 = `
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
`;
