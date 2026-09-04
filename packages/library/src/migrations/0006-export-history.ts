export const migration0006 = `
  CREATE TABLE exports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    path text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    render_hash text NOT NULL,
    bytes bigint NOT NULL CONSTRAINT exports_bytes_check CHECK (bytes > 0)
  );

  CREATE INDEX exports_photo_at_idx ON exports(photo_id, at DESC, id DESC);
`;
