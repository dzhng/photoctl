CREATE TABLE schema_version (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE photos (
  id uuid PRIMARY KEY,
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
  created_at timestamptz NOT NULL DEFAULT now(),
  rating integer NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  flag text NOT NULL DEFAULT 'none' CHECK (flag IN ('pick', 'reject', 'none')),
  label text CHECK (label IN ('red', 'yellow', 'green', 'blue', 'purple'))
);

CREATE UNIQUE INDEX photos_unpromoted_content_key_idx
  ON photos(content_key) WHERE content_hash IS NULL;
CREATE UNIQUE INDEX photos_promoted_content_hash_idx
  ON photos(content_key, content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX photos_shot_id_idx ON photos(shot_at, id);
CREATE INDEX photos_rating_idx ON photos(rating);
CREATE INDEX photos_flag_idx ON photos(flag);
CREATE INDEX photos_label_idx ON photos(label);

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

CREATE TABLE tags (
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (length(tag) > 0),
  PRIMARY KEY (photo_id, tag)
);

CREATE TABLE xmp_state (
  photo_id uuid PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  sidecar_path text NOT NULL,
  read_at timestamptz NOT NULL,
  sidecar_mtime timestamptz NOT NULL
);

CREATE TABLE exports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  path text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  render_hash text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0)
);

CREATE INDEX exports_photo_at_idx ON exports(photo_id, at DESC, id DESC);

INSERT INTO schema_version (version) VALUES (1), (2), (3), (4), (5), (6);
INSERT INTO settings (key, value) VALUES
  ('library_id', '"0199a7c2-0000-7000-8000-000000000001"'::jsonb),
  ('cache_max_bytes', '21474836480'::jsonb),
  ('daemon_idle_ms', '900000'::jsonb),
  ('daemon_queue_max', '8'::jsonb);
INSERT INTO photos
  (id, content_key, content_hash, size, w, h, orientation, camera, exposure,
   shot_at, shot_offset_min, rating, flag, label)
VALUES
  ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ck_3dac5c943a33dcc4',
   'sha256_3dac5c943a33dcc4', 73400320, 7008, 4672, 1,
   '{"make":"SONY","model":"ILCE-7CM2"}', '{}', '2023-10-02T16:18:37Z', 120,
   5, 'pick', 'green');
INSERT INTO volumes (uuid, label, last_mount, last_seen)
VALUES ('6A1F-0C3B', 'A7C2', '/Volumes/A7C2', '2023-10-02T16:18:37Z');
INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime, embedded)
VALUES
  ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002',
   '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '6A1F-0C3B', 'a7c2.ARW',
   '2023-10-02T16:18:37Z',
   '[{"width":160,"height":120,"offset":44146,"length":8217},{"width":1616,"height":1080,"offset":192674,"length":466017},{"width":7008,"height":4672,"offset":659456,"length":6730200}]');
INSERT INTO cache_index (path, bytes, last_used, pinned)
VALUES ('emb/0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001.jpg', 466017,
        '2023-10-02T16:18:37Z', true);
INSERT INTO tags (photo_id, tag)
VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ceremony');
INSERT INTO xmp_state (photo_id, sidecar_path, read_at, sidecar_mtime)
VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '/Volumes/A7C2/a7c2.xmp',
        '2023-10-02T16:20:00Z', '2023-10-02T16:18:37Z');

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

INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
VALUES (
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001',
  'node_1111111111111111111111111111111111111111111111111111111111111111',
  'source', 1, '{"orientation":1}',
  'recipe_2222222222222222222222222222222222222222222222222222222222222222'
);
INSERT INTO document_revisions (id, photo_id, pinned)
VALUES (
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003',
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001',
  true
);
INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
VALUES (
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003',
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001',
  'output',
  'node_1111111111111111111111111111111111111111111111111111111111111111'
);
INSERT INTO photo_documents (photo_id, active_revision_id)
VALUES (
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001',
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003'
);
INSERT INTO exports (photo_id, path, at, render_hash, bytes)
VALUES (
  '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001',
  '/delivery/a7c2.jpg',
  '2023-10-02T16:30:00Z',
  'r_3333333333333333333333333333333333333333333333333333333333333333',
  6730200
);
