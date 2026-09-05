export const migration0015 = `
  CREATE TABLE markup (
    photo_id uuid PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT markup_items_array_check CHECK (jsonb_typeof(items) = 'array')
  );
`;
