export const migration0004 = `
  ALTER TABLE photos
    DROP CONSTRAINT photos_content_key_key,
    ADD COLUMN content_hash text,
    ADD COLUMN rating integer NOT NULL DEFAULT 0
      CONSTRAINT photos_rating_check CHECK (rating BETWEEN 0 AND 5),
    ADD COLUMN flag text NOT NULL DEFAULT 'none'
      CONSTRAINT photos_flag_check CHECK (flag IN ('pick', 'reject', 'none')),
    ADD COLUMN label text
      CONSTRAINT photos_label_check CHECK (label IN ('red', 'yellow', 'green', 'blue', 'purple'));

  CREATE UNIQUE INDEX photos_unpromoted_content_key_idx
    ON photos(content_key) WHERE content_hash IS NULL;
  CREATE UNIQUE INDEX photos_promoted_content_hash_idx
    ON photos(content_key, content_hash) WHERE content_hash IS NOT NULL;
  CREATE INDEX photos_shot_id_idx ON photos(shot_at, id);
  CREATE INDEX photos_rating_idx ON photos(rating);
  CREATE INDEX photos_flag_idx ON photos(flag);
  CREATE INDEX photos_label_idx ON photos(label);

  CREATE TABLE xmp_state (
    photo_id uuid PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
    sidecar_path text NOT NULL,
    read_at timestamptz NOT NULL,
    sidecar_mtime timestamptz NOT NULL
  );
`;
