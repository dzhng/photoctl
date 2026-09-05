export const migration0009 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_kind_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_kind_check CHECK (kind IN (
    'source', 'develop', 'generate', 'upscale', 'resample', 'transform',
    'mask', 'delta', 'mask_composite', 'composite', 'crop', 'markup', 'output'
  ));

  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_recipe_version_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_recipe_version_check CHECK (
    (kind = 'composite' AND recipe_version IN (1, 2))
    OR (kind <> 'composite' AND recipe_version = 1)
  );

  ALTER TABLE document_revision_roots DROP CONSTRAINT document_revision_roots_name_check;
  ALTER TABLE document_revision_roots ADD CONSTRAINT document_revision_roots_name_check
    CHECK (root_name IN ('base', 'output'));

  INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
  SELECT revision_id, photo_id, 'base', node_id
  FROM document_revision_roots
  WHERE root_name = 'output';

  CREATE TABLE layers (
    photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    id uuid NOT NULL,
    role text NOT NULL CONSTRAINT layers_role_check
      CHECK (role IN ('subject', 'vacancy', 'reimagine', 'retouch')),
    of_layer uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (photo_id, id),
    FOREIGN KEY (photo_id, of_layer) REFERENCES layers(photo_id, id)
  );

  CREATE INDEX layers_id_idx ON layers(id);

  CREATE TABLE document_revision_layers (
    photo_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    layer_id uuid NOT NULL,
    name text NOT NULL,
    z integer NOT NULL CONSTRAINT document_revision_layers_z_check CHECK (z >= 0),
    content_node_id text NOT NULL,
    mask_node_id text NOT NULL,
    opacity double precision NOT NULL CONSTRAINT document_revision_layers_opacity_check
      CHECK (opacity BETWEEN 0 AND 1),
    blend text NOT NULL CONSTRAINT document_revision_layers_blend_check
      CHECK (blend = 'normal'),
    enabled boolean NOT NULL,
    PRIMARY KEY (photo_id, revision_id, layer_id),
    UNIQUE (photo_id, revision_id, z),
    FOREIGN KEY (photo_id, revision_id)
      REFERENCES document_revisions(photo_id, id) ON DELETE CASCADE,
    FOREIGN KEY (photo_id, layer_id) REFERENCES layers(photo_id, id),
    FOREIGN KEY (photo_id, content_node_id) REFERENCES image_nodes(photo_id, id),
    FOREIGN KEY (photo_id, mask_node_id) REFERENCES image_nodes(photo_id, id)
  );
`;
