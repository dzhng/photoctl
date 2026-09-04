export const migration0001 = `
  CREATE TABLE settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL
  );
`;
