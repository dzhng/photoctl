export const migration0022 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_recipe_version_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_recipe_version_check CHECK (
    (kind IN ('generate', 'composite') AND recipe_version IN (1, 2, 3))
    OR (kind IN ('resample', 'mask', 'source', 'transform', 'mask_composite') AND recipe_version IN (1, 2))
    OR (kind NOT IN ('composite', 'resample', 'generate', 'mask', 'source', 'transform', 'mask_composite') AND recipe_version = 1)
  );
`;
