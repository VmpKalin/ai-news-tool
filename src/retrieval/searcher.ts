import type { NewsItemWithVector, ScoredNewsItem } from '../models/NewsItem.js';

export class Searcher {
  constructor(private readonly topK: number) {}

  search(items: NewsItemWithVector[], profileVector: number[]): ScoredNewsItem[] {
    try {
      console.log(`[Searcher] Scoring ${items.length} items, returning top ${this.topK}`);

      const scored: ScoredNewsItem[] = items.map(({ vector, ...rest }) => ({
        ...rest,
        score: cosineSimilarity(vector, profileVector),
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, this.topK);
    } catch (cause) {
      console.error('[Searcher] Similarity search failed', cause);
      throw new Error('Searcher failed');
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
