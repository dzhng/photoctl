import type { PGlite } from "@electric-sql/pglite";
import { migration0001 } from "./0001-init.js";
import { migration0002 } from "./0002-photo-core.js";
import { migration0003 } from "./0003-tags-and-daemon.js";
import { migration0004 } from "./0004-import-and-cull.js";
import { migration0005 } from "./0005-image-graph.js";
import { migration0006 } from "./0006-export-history.js";
import { migration0007 } from "./0007-provider-execution.js";
import { migration0008 } from "./0008-search.js";
import { migration0009 } from "./0009-layers.js";

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
}

const migrations = [
  { version: 1, sql: migration0001 },
  { version: 2, sql: migration0002 },
  { version: 3, sql: migration0003 },
  { version: 4, sql: migration0004 },
  { version: 5, sql: migration0005 },
  { version: 6, sql: migration0006 },
  { version: 7, sql: migration0007 },
  { version: 8, sql: migration0008 },
  { version: 9, sql: migration0009 },
] as const;

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;
const latestTables = [
  "cache_index",
  "document_revision_roots",
  "document_revision_layers",
  "document_revisions",
  "exports",
  "embeddings",
  "files",
  "image_artifacts",
  "node_execution_inputs",
  "image_node_inputs",
  "image_nodes",
  "layers",
  "node_executions",
  "photo_documents",
  "photos",
  "schema_version",
  "settings",
  "tags",
  "volumes",
  "xmp_state",
] as const;
const latestConstraints = [
  "cache_index_bytes_check",
  "cache_index_pkey",
  "document_revision_roots_pkey",
  "document_revision_roots_photo_id_revision_id_fkey",
  "document_revision_roots_photo_id_node_id_fkey",
  "document_revision_roots_name_check",
  "document_revision_layers_pkey",
  "document_revision_layers_photo_id_revision_id_fkey",
  "document_revision_layers_photo_id_layer_id_fkey",
  "document_revision_layers_photo_id_content_node_id_fkey",
  "document_revision_layers_photo_id_mask_node_id_fkey",
  "document_revision_layers_photo_id_revision_id_z_key",
  "document_revision_layers_z_check",
  "document_revision_layers_opacity_check",
  "document_revision_layers_blend_check",
  "document_revisions_photo_id_parent_revision_id_fkey",
  "document_revisions_photo_id_fkey",
  "document_revisions_pkey",
  "files_photo_id_fkey",
  "files_pkey",
  "files_volume_uuid_rel_path_key",
  "files_volume_uuid_fkey",
  "exports_bytes_check",
  "exports_photo_id_fkey",
  "exports_pkey",
  "photos_flag_check",
  "image_artifacts_artifact_hash_check",
  "image_artifacts_bytes_check",
  "image_artifacts_h_check",
  "image_artifacts_pkey",
  "image_artifacts_w_check",
  "image_node_inputs_not_self_check",
  "image_node_inputs_input_index_check",
  "image_node_inputs_photo_id_node_id_fkey",
  "image_node_inputs_photo_id_input_node_id_fkey",
  "image_node_inputs_pkey",
  "image_nodes_id_check",
  "image_nodes_kind_check",
  "image_nodes_photo_id_fkey",
  "image_nodes_pkey",
  "image_nodes_photo_id_recipe_hash_key",
  "image_nodes_recipe_hash_check",
  "image_nodes_recipe_version_check",
  "layers_pkey",
  "layers_photo_id_fkey",
  "layers_photo_id_of_layer_fkey",
  "layers_role_check",
  "node_execution_inputs_index_check",
  "node_execution_inputs_input_artifact_hash_fkey",
  "node_execution_inputs_photo_id_execution_id_fkey",
  "node_execution_inputs_pkey",
  "node_executions_evaluation_hash_check",
  "node_executions_id_check",
  "node_executions_photo_id_node_id_fkey",
  "node_executions_output_artifact_hash_fkey",
  "node_executions_pkey",
  "node_executions_source_h_check",
  "node_executions_source_provenance_check",
  "node_executions_source_w_check",
  "node_executions_provider_execution_check",
  "photo_documents_photo_id_active_revision_id_fkey",
  "photo_documents_photo_id_fkey",
  "photo_documents_pkey",
  "photos_h_check",
  "photos_label_check",
  "embeddings_photo_id_fkey",
  "embeddings_pkey",
  "photos_orientation_check",
  "photos_pkey",
  "photos_rating_check",
  "photos_shot_offset_min_check",
  "photos_size_check",
  "photos_w_check",
  "schema_version_pkey",
  "settings_pkey",
  "tags_photo_id_fkey",
  "tags_pkey",
  "tags_tag_check",
  "volumes_pkey",
  "xmp_state_photo_id_fkey",
  "xmp_state_pkey",
] as const;

export async function migrate(db: PGlite): Promise<MigrationResult> {
  await db.exec('SET search_path TO "$user", public');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const recorded = await db.query<{ version: number }>("SELECT version FROM schema_version");
  const versions = recorded.rows.map((row) => row.version).toSorted((left, right) => left - right);
  for (const [index, version] of versions.entries()) {
    if (version !== index + 1 || version > LATEST_SCHEMA_VERSION) {
      throw new Error(`Invalid schema migration ledger: ${versions.join(",")}`);
    }
  }
  const applied = new Set(versions);
  const fromVersion = versions.at(-1) ?? 0;
  const newlyApplied: number[] = [];
  async function apply(index: number): Promise<void> {
    const migration = migrations[index];
    if (!migration) return;
    if (!applied.has(migration.version)) {
      await db.transaction(async (tx) => {
        await tx.exec(migration.sql);
        await tx.query("INSERT INTO schema_version (version) VALUES ($1)", [migration.version]);
      });
      newlyApplied.push(migration.version);
    }
    await apply(index + 1);
  }
  await apply(0);
  return { fromVersion, toVersion: LATEST_SCHEMA_VERSION, applied: newlyApplied };
}

export async function verifyLatestSchema(db: PGlite): Promise<void> {
  const [tables, constraints, indexes, triggers] = await Promise.all([
    db.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    ),
    db.query<{ name: string }>(
      `SELECT constraint_name AS name
       FROM information_schema.table_constraints
       WHERE constraint_schema = 'public'`,
    ),
    db.query<{ name: string }>(
      "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'",
    ),
    db.query<{ name: string }>(
      `SELECT tgname AS name FROM pg_trigger
       WHERE NOT tgisinternal AND tgrelid IN ('files'::regclass, 'tags'::regclass)`,
    ),
  ]);
  const missing = [
    ...missingNames(latestTables, tables.rows),
    ...missingNames(latestConstraints, constraints.rows),
    ...missingNames(
      [
        "document_revision_roots_revision_idx",
        "document_revisions_id_idx",
        "document_revisions_photo_created_idx",
        "files_photo_id_idx",
        "image_node_inputs_input_idx",
        "image_nodes_id_idx",
        "layers_id_idx",
        "node_executions_deterministic_eval_idx",
        "node_executions_node_id_idx",
        "exports_photo_at_idx",
        "embeddings_vec_hnsw_idx",
        "photos_flag_idx",
        "photos_label_idx",
        "photos_promoted_content_hash_idx",
        "photos_rating_idx",
        "photos_searchable_gin_idx",
        "photos_shot_id_idx",
        "photos_unpromoted_content_key_idx",
      ],
      indexes.rows,
    ),
    ...missingNames(["files_refresh_search_text", "tags_refresh_search_text"], triggers.rows),
  ];
  if (missing.length > 0) throw new Error(`Library schema is incomplete: ${missing.join(",")}`);
}

function missingNames(expected: readonly string[], rows: Array<{ name: string }>): string[] {
  const found = new Set(rows.map(({ name }) => name));
  return expected.filter((name) => !found.has(name));
}
