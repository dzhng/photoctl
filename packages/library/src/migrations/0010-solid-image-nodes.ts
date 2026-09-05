export const migration0010 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_kind_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_kind_check CHECK (kind IN (
    'source', 'develop', 'generate', 'upscale', 'resample', 'transform', 'solid',
    'mask', 'delta', 'mask_composite', 'composite', 'crop', 'markup', 'output'
  ));

  CREATE UNIQUE INDEX layers_one_vacancy_per_subject_idx
    ON layers(photo_id, of_layer) WHERE role = 'vacancy';
`;
