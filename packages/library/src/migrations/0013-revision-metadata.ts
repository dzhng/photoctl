export const migration0013 = `
  ALTER TABLE document_revisions
    ADD COLUMN metadata jsonb;

  ALTER TABLE document_revisions
    ADD CONSTRAINT document_revisions_metadata_check CHECK (
      metadata IS NULL OR jsonb_typeof(metadata) = 'object'
    );
`;
