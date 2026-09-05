export type SearchSource = "text" | "vector";

export interface FusedHit {
  id: string;
  score: number;
  sources: SearchSource[];
}

export function reciprocalRankFusion(rankedIds: readonly (readonly string[])[]): FusedHit[] {
  const scores = new Map<string, { score: number; sources: SearchSource[] }>();
  for (const [listIndex, ids] of rankedIds.entries()) {
    const source: SearchSource = listIndex === 0 ? "text" : "vector";
    for (const [rank, id] of ids.entries()) {
      const existing = scores.get(id);
      if (existing) {
        existing.score += 1 / (60 + rank + 1);
        if (!existing.sources.includes(source)) existing.sources.push(source);
      } else {
        scores.set(id, {
          score: 1 / (60 + rank + 1),
          sources: [source],
        });
      }
    }
  }
  return Array.from(scores, ([id, hit]) => ({
    id,
    score: hit.score,
    sources: hit.sources,
  })).toSorted((left, right) => right.score - left.score || compareIds(left.id, right.id));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
