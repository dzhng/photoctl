import type { LibraryHandle } from "../open.js";
import { reciprocalRankFusion, type FusedHit } from "./rrf.js";

export interface EmbeddingCandidate {
  id: string;
}

export async function countEmbeddingCandidates(
  handle: LibraryHandle,
  model: string,
): Promise<number> {
  const result = await handle.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM photos p
     LEFT JOIN embeddings e ON e.photo_id = p.id AND e.model = $1
     WHERE e.photo_id IS NULL`,
    [model],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function selectEmbeddingCandidates(
  handle: LibraryHandle,
  model: string,
  options: {
    ids?: readonly string[];
    limit?: number;
    includeCurrent?: boolean;
    afterId?: string;
  } = {},
): Promise<EmbeddingCandidate[]> {
  const ids = options.ids ?? [];
  const result = await handle.query<{ id: string }>(
    `SELECT p.id::text
     FROM photos p
     LEFT JOIN embeddings e ON e.photo_id = p.id AND e.model = $1
     WHERE ($4::boolean OR e.photo_id IS NULL)
       AND (cardinality($2::uuid[]) = 0 OR p.id = ANY($2::uuid[]))
       AND ($5::uuid IS NULL OR p.id > $5)
     ORDER BY p.id
     LIMIT $3`,
    [
      model,
      [...ids],
      options.limit ?? 50,
      options.includeCurrent === true,
      options.afterId ?? null,
    ],
  );
  return result.rows;
}

export async function upsertPhotoEmbedding(
  handle: LibraryHandle,
  photoId: string,
  model: string,
  vector: readonly number[],
): Promise<void> {
  if (vector.length !== 3_072 || !vector.every(Number.isFinite)) {
    throw new Error("A photo embedding must contain 3072 finite values");
  }
  await handle.query(
    `INSERT INTO embeddings (photo_id, model, vec, created_at)
     VALUES ($1, $2, $3::halfvec, now())
     ON CONFLICT (photo_id) DO UPDATE SET
       model = EXCLUDED.model,
       vec = EXCLUDED.vec,
       created_at = EXCLUDED.created_at`,
    [photoId, model, `[${vector.join(",")}]`],
  );
}

export async function hybridSearch(
  handle: LibraryHandle,
  query: string,
  limit: number,
  vectorSearch?: { vector: readonly number[]; model: string },
): Promise<FusedHit[]> {
  const candidateLimit = Math.min(200, Math.max(limit * 4, 50));
  const text = await handle.query<{ id: string }>(
    `WITH normalized_query AS MATERIALIZED (
       SELECT websearch_to_tsquery(
         'english',
         NULLIF(btrim(regexp_replace($1, '[^[:alnum:]]+', ' ', 'g')), '')
       ) AS document
     )
     SELECT photos.id::text
     FROM photos CROSS JOIN normalized_query
     WHERE searchable @@ normalized_query.document
     ORDER BY ts_rank(searchable, normalized_query.document) DESC, photos.id
     LIMIT $2`,
    [query, candidateLimit],
  );
  let vector: Array<{ id: string }> = [];
  if (vectorSearch) {
    const queryVector = vectorSearch.vector;
    if (queryVector.length !== 3_072 || !queryVector.every(Number.isFinite)) {
      throw new Error("A search embedding must contain 3072 finite values");
    }
    vector = (
      await handle.query<{ id: string }>(
        `WITH matching AS MATERIALIZED (
           SELECT photo_id, vec FROM embeddings WHERE model = $2
         )
         SELECT photo_id::text AS id
         FROM matching
         ORDER BY vec <=> $1::halfvec, photo_id
         LIMIT $3`,
        [`[${queryVector.join(",")}]`, vectorSearch.model, candidateLimit],
      )
    ).rows;
  }
  return reciprocalRankFusion([text.rows.map((row) => row.id), vector.map((row) => row.id)]).slice(
    0,
    limit,
  );
}
