export const migration0021 = `
  ALTER TABLE image_nodes DROP CONSTRAINT image_nodes_recipe_version_check;
  ALTER TABLE image_nodes ADD CONSTRAINT image_nodes_recipe_version_check CHECK (
    (kind IN ('generate', 'composite') AND recipe_version IN (1, 2, 3))
    OR (kind IN ('resample', 'mask', 'source', 'transform') AND recipe_version IN (1, 2))
    OR (kind NOT IN ('composite', 'resample', 'generate', 'mask', 'source', 'transform') AND recipe_version = 1)
  );
  ALTER TABLE layers DROP CONSTRAINT layers_role_check;
  ALTER TABLE layers ADD CONSTRAINT layers_role_check
    CHECK (role IN ('subject', 'vacancy', 'reimagine', 'retouch', 'border'));
`;
