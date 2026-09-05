export const migration0012 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_kind_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_kind_check CHECK (kind IN (
    'source', 'develop', 'generate', 'upscale', 'resample', 'transform', 'solid',
    'mask', 'delta', 'heal', 'mask_composite', 'composite', 'crop', 'markup', 'output'
  ));
`;
