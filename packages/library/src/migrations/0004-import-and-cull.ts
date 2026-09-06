export const migration0004 = `
  ALTER TABLE photos
    ADD COLUMN rating integer NOT NULL DEFAULT 0
      CONSTRAINT photos_rating_check CHECK (rating BETWEEN 0 AND 5),
    ADD COLUMN flag text NOT NULL DEFAULT 'none'
      CONSTRAINT photos_flag_check CHECK (flag IN ('pick', 'reject', 'none')),
    ADD COLUMN label text
      CONSTRAINT photos_label_check CHECK (label IN ('red', 'yellow', 'green', 'blue', 'purple'));

  CREATE INDEX originals_shot_id_idx ON originals(shot_at, id);
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
