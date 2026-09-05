export const migration0008 = `
  ALTER TABLE photos
    ADD COLUMN search_text text NOT NULL DEFAULT '',
    ADD COLUMN searchable tsvector
      GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED;

  CREATE TABLE embeddings (
    photo_id uuid PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
    model text NOT NULL,
    vec halfvec(3072) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX embeddings_vec_hnsw_idx
    ON embeddings USING hnsw (vec halfvec_cosine_ops);
  CREATE INDEX photos_searchable_gin_idx
    ON photos USING gin (searchable);

  CREATE FUNCTION refresh_photo_search_text(target_photo_id uuid) RETURNS void
  LANGUAGE sql AS $$
    UPDATE photos
    SET search_text = concat_ws(
      ' ',
      COALESCE((
        SELECT string_agg(regexp_replace(rel_path, '[^[:alnum:]]+', ' ', 'g'), ' ' ORDER BY rel_path)
        FROM files
        WHERE photo_id = target_photo_id
      ), ''),
      COALESCE((
        SELECT string_agg(regexp_replace(tag, '[^[:alnum:]]+', ' ', 'g'), ' ' ORDER BY tag)
        FROM tags
        WHERE photo_id = target_photo_id
      ), '')
    )
    WHERE id = target_photo_id
  $$;

  CREATE FUNCTION refresh_file_search_text() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      PERFORM refresh_photo_search_text(OLD.photo_id);
    END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      PERFORM refresh_photo_search_text(NEW.photo_id);
    END IF;
    RETURN NULL;
  END
  $$;

  CREATE FUNCTION refresh_tag_search_text() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      PERFORM refresh_photo_search_text(OLD.photo_id);
    END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      PERFORM refresh_photo_search_text(NEW.photo_id);
    END IF;
    RETURN NULL;
  END
  $$;

  CREATE TRIGGER files_refresh_search_text
    AFTER INSERT OR UPDATE OR DELETE ON files
    FOR EACH ROW EXECUTE FUNCTION refresh_file_search_text();
  CREATE TRIGGER tags_refresh_search_text
    AFTER INSERT OR UPDATE OR DELETE ON tags
    FOR EACH ROW EXECUTE FUNCTION refresh_tag_search_text();

  SELECT refresh_photo_search_text(id) FROM photos;

  INSERT INTO settings (key, value)
  VALUES ('embed_mode', '"manual"'::jsonb)
  ON CONFLICT (key) DO NOTHING;
`;
