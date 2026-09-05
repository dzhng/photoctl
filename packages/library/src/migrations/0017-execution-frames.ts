export const migration0017 = `
  ALTER TABLE node_executions ADD COLUMN render_frame jsonb
    CONSTRAINT node_executions_render_frame_check CHECK (
      render_frame IS NULL OR jsonb_typeof(render_frame) = 'object'
    );
`;
