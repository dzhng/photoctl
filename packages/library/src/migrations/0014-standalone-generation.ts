export const migration0014 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_recipe_version_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_recipe_version_check CHECK (
    (kind IN ('composite', 'resample', 'generate') AND recipe_version IN (1, 2))
    OR (kind NOT IN ('composite', 'resample', 'generate') AND recipe_version = 1)
  );
`;
