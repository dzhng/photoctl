export const migration0020 = `
  ALTER TABLE image_artifacts ADD COLUMN validation_profile text;
  UPDATE image_artifacts SET validation_profile = CASE media_type
    WHEN 'image/tiff' THEN 'linear-rgb-tiff'
    WHEN 'image/vnd.photoctl.mask+tiff' THEN 'mask-tiff'
    WHEN 'image/png' THEN 'encoded-image' END;
  ALTER TABLE image_artifacts ALTER COLUMN validation_profile SET NOT NULL;
  ALTER TABLE image_artifacts ADD CONSTRAINT image_artifacts_validation_profile_check
    CHECK (validation_profile IN ('linear-rgb-tiff', 'mask-tiff', 'encoded-image'));
  CREATE TABLE provider_image_attempts (
    id uuid PRIMARY KEY,
    request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
    provenance jsonb NOT NULL DEFAULT '{"schema":1,"request_id":null,"transport_attempts":null,"cost_usd":null}' CHECK (jsonb_typeof(provenance) = 'object'),
    original_artifact_hash text REFERENCES image_artifacts(artifact_hash),
    state text NOT NULL CHECK (state IN ('started', 'retained', 'committed', 'rejected', 'failed')),
    outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (state NOT IN ('retained', 'committed', 'rejected') OR original_artifact_hash IS NOT NULL)
  );
  ALTER TABLE node_executions ADD COLUMN provider_image_attempt_id uuid
    REFERENCES provider_image_attempts(id);
  CREATE INDEX provider_image_attempts_created_idx ON provider_image_attempts(created_at DESC, id DESC);
  CREATE INDEX node_executions_provider_image_attempt_idx ON node_executions(provider_image_attempt_id) WHERE provider_image_attempt_id IS NOT NULL;
`;
