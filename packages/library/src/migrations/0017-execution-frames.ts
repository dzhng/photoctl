export const migration0017 = `
  ALTER TABLE node_executions ADD COLUMN render_frame jsonb
    CONSTRAINT node_executions_render_frame_check CHECK (
      render_frame IS NULL OR jsonb_typeof(render_frame) = 'object'
    );
  ALTER TABLE node_executions ADD COLUMN render_identity text
    CONSTRAINT node_executions_render_identity_check CHECK (render_identity ~ '^r_[0-9a-f]{64}$');
  ALTER TABLE node_executions ADD COLUMN render_source_tier text
    CONSTRAINT node_executions_render_source_tier_check CHECK (render_source_tier IN ('online-file', 'online-jpeg-range', 'pinned-preview'));
`;
