export const migration0018 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_recipe_version_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_recipe_version_check CHECK (
    (kind = 'generate' AND recipe_version IN (1, 2, 3))
    OR (kind IN ('composite', 'resample', 'mask', 'source') AND recipe_version IN (1, 2))
    OR (kind NOT IN ('composite', 'resample', 'generate', 'mask', 'source') AND recipe_version = 1)
  );
`;
