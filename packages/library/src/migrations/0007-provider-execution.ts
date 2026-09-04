export const migration0007 = `
  ALTER TABLE node_executions
    ADD COLUMN provider_execution jsonb;

  ALTER TABLE node_executions
    ADD CONSTRAINT node_executions_provider_execution_check CHECK (
      provider_execution IS NULL OR jsonb_typeof(provider_execution) = 'object'
    );
`;
