export const migration0019 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_kind_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_kind_check CHECK (kind IN (
    'source', 'develop', 'generate', 'upscale', 'resample', 'transform', 'solid',
    'mask', 'delta', 'heal', 'mask_composite', 'composite', 'crop', 'markup', 'output', 'geometry'
  ));
  ALTER TABLE document_revision_roots DROP CONSTRAINT document_revision_roots_name_check;
  ALTER TABLE document_revision_roots ADD CONSTRAINT document_revision_roots_name_check
    CHECK (root_name IN ('base', 'output', 'geometry'));
  ALTER TABLE layers ADD COLUMN authored_checkpoint_node_id text;
  ALTER TABLE layers ADD FOREIGN KEY (photo_id, authored_checkpoint_node_id)
    REFERENCES image_nodes(photo_id, id);
`;
