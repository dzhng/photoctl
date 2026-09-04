export const migration0005 = `
  CREATE TABLE image_artifacts (
    artifact_hash text PRIMARY KEY
      CONSTRAINT image_artifacts_artifact_hash_check CHECK (artifact_hash ~ '^a_[0-9a-f]{64}$'),
    media_type text NOT NULL,
    bytes bigint NOT NULL CONSTRAINT image_artifacts_bytes_check CHECK (bytes >= 0),
    w integer NOT NULL CONSTRAINT image_artifacts_w_check CHECK (w > 0),
    h integer NOT NULL CONSTRAINT image_artifacts_h_check CHECK (h > 0),
    artifact_available boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE image_nodes (
    photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    id text NOT NULL CONSTRAINT image_nodes_id_check CHECK (id ~ '^node_[0-9a-f]{64}$'),
    kind text NOT NULL CONSTRAINT image_nodes_kind_check CHECK (kind IN (
      'source', 'develop', 'generate', 'upscale', 'resample', 'transform',
      'mask_composite', 'composite', 'crop', 'markup', 'output'
    )),
    recipe_version integer NOT NULL
      CONSTRAINT image_nodes_recipe_version_check CHECK (recipe_version = 1),
    parameters jsonb NOT NULL,
    recipe_hash text NOT NULL
      CONSTRAINT image_nodes_recipe_hash_check CHECK (recipe_hash ~ '^recipe_[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (photo_id, id),
    UNIQUE (photo_id, recipe_hash)
  );

  CREATE INDEX image_nodes_id_idx ON image_nodes(id);

  CREATE TABLE image_node_inputs (
    photo_id uuid NOT NULL,
    node_id text NOT NULL,
    input_index integer NOT NULL
      CONSTRAINT image_node_inputs_input_index_check CHECK (input_index >= 0),
    input_node_id text NOT NULL,
    PRIMARY KEY (photo_id, node_id, input_index),
    CONSTRAINT image_node_inputs_not_self_check CHECK (node_id <> input_node_id),
    FOREIGN KEY (photo_id, node_id) REFERENCES image_nodes(photo_id, id) ON DELETE CASCADE,
    FOREIGN KEY (photo_id, input_node_id) REFERENCES image_nodes(photo_id, id)
  );

  CREATE INDEX image_node_inputs_input_idx ON image_node_inputs(photo_id, input_node_id);

  CREATE TABLE node_executions (
    photo_id uuid NOT NULL,
    execution_id text NOT NULL
      CONSTRAINT node_executions_id_check CHECK (execution_id ~ '^exec_[0-9a-f]{64}$'),
    node_id text NOT NULL,
    evaluation_hash text NOT NULL
      CONSTRAINT node_executions_evaluation_hash_check CHECK (evaluation_hash ~ '^eval_[0-9a-f]{64}$'),
    deterministic boolean NOT NULL,
    output_artifact_hash text NOT NULL REFERENCES image_artifacts(artifact_hash),
    source_locator jsonb,
    source_tier text,
    source_w integer CONSTRAINT node_executions_source_w_check CHECK (source_w > 0),
    source_h integer CONSTRAINT node_executions_source_h_check CHECK (source_h > 0),
    decoder_id text,
    decoder_version text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (photo_id, execution_id),
    FOREIGN KEY (photo_id, node_id) REFERENCES image_nodes(photo_id, id) ON DELETE CASCADE,
    CONSTRAINT node_executions_source_provenance_check CHECK (
      (source_locator IS NULL AND source_tier IS NULL AND source_w IS NULL AND source_h IS NULL
       AND decoder_id IS NULL AND decoder_version IS NULL)
      OR
      (source_locator IS NOT NULL AND source_tier IS NOT NULL AND source_w IS NOT NULL AND source_h IS NOT NULL
       AND decoder_id IS NOT NULL AND decoder_version IS NOT NULL)
    )
  );

  CREATE UNIQUE INDEX node_executions_deterministic_eval_idx
    ON node_executions(photo_id, node_id, evaluation_hash) WHERE deterministic;
  CREATE INDEX node_executions_node_id_idx ON node_executions(photo_id, node_id);

  CREATE TABLE node_execution_inputs (
    photo_id uuid NOT NULL,
    execution_id text NOT NULL,
    input_index integer NOT NULL
      CONSTRAINT node_execution_inputs_index_check CHECK (input_index >= 0),
    input_artifact_hash text NOT NULL REFERENCES image_artifacts(artifact_hash),
    PRIMARY KEY (photo_id, execution_id, input_index),
    FOREIGN KEY (photo_id, execution_id)
      REFERENCES node_executions(photo_id, execution_id) ON DELETE CASCADE
  );

  CREATE TABLE document_revisions (
    id uuid NOT NULL,
    photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    parent_revision_id uuid,
    pinned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (photo_id, id),
    FOREIGN KEY (photo_id, parent_revision_id) REFERENCES document_revisions(photo_id, id)
  );

  CREATE INDEX document_revisions_id_idx ON document_revisions(id);
  CREATE INDEX document_revisions_photo_created_idx ON document_revisions(photo_id, created_at);

  CREATE TABLE document_revision_roots (
    revision_id uuid NOT NULL,
    photo_id uuid NOT NULL,
    root_name text NOT NULL
      CONSTRAINT document_revision_roots_name_check CHECK (root_name = 'output'),
    node_id text NOT NULL,
    PRIMARY KEY (photo_id, revision_id, root_name),
    FOREIGN KEY (photo_id, revision_id) REFERENCES document_revisions(photo_id, id) ON DELETE CASCADE,
    FOREIGN KEY (photo_id, node_id) REFERENCES image_nodes(photo_id, id)
  );

  CREATE INDEX document_revision_roots_revision_idx ON document_revision_roots(revision_id);

  CREATE TABLE photo_documents (
    photo_id uuid PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
    active_revision_id uuid,
    FOREIGN KEY (photo_id, active_revision_id) REFERENCES document_revisions(photo_id, id)
  );
`;
