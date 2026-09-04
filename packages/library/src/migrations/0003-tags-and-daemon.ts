export const migration0003 = `
  CREATE TABLE tags (
    photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    tag text NOT NULL CHECK (length(tag) > 0),
    PRIMARY KEY (photo_id, tag)
  );

  INSERT INTO settings (key, value)
  VALUES ('daemon_queue_max', '8'::jsonb)
  ON CONFLICT (key) DO NOTHING;
`;
