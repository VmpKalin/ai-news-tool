import { VoyageAIClient } from 'voyageai';
import type { NewsItem, NewsItemWithVector } from '../models/NewsItem.js';

export class EmbedderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EmbedderError';
  }
}

export class Embedder {
  private readonly client: VoyageAIClient;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new VoyageAIClient({ apiKey });
    this.model = model;
  }

  async embedItems(items: NewsItem[]): Promise<NewsItemWithVector[]> {
    try {
      console.log(`[Embedder] Embedding ${items.length} items with ${this.model}`);
      const inputs = items.map((i) => `${i.title}\n\n${i.description}`);
      const vectors = await this.embedBatch(inputs, 'document');
      return items.map((item, idx) => ({ ...item, vector: vectors[idx]! }));
    } catch (cause) {
      console.error('[Embedder] Failed to embed items', cause);
      throw new EmbedderError('Failed to embed news items', cause);
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    try {
      console.log('[Embedder] Embedding query text');
      const [vector] = await this.embedBatch([text], 'query');
      if (!vector) {
        throw new EmbedderError('Voyage returned empty embedding for query');
      }
      return vector;
    } catch (cause) {
      if (cause instanceof EmbedderError) throw cause;
      console.error('[Embedder] Failed to embed query', cause);
      throw new EmbedderError('Failed to embed query text', cause);
    }
  }

  private async embedBatch(
    inputs: string[],
    inputType: 'document' | 'query',
  ): Promise<number[][]> {
    const response = await this.client.embed({
      input: inputs,
      model: this.model,
      inputType,
    });

    const data = response.data;
    if (!data || data.length !== inputs.length) {
      throw new EmbedderError(
        `Voyage returned ${data?.length ?? 0} embeddings for ${inputs.length} inputs`,
      );
    }

    return data.map((item, idx) => {
      const vector = item.embedding;
      if (!vector || vector.length === 0) {
        throw new EmbedderError(`Voyage returned empty embedding at index ${idx}`);
      }
      return vector;
    });
  }
}
