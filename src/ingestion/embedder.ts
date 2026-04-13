import type { NewsItem, NewsItemWithVector } from '../models/NewsItem.js';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

interface VoyageEmbedding {
  embedding?: number[];
  index?: number;
}

interface VoyageEmbeddingsResponse {
  data?: VoyageEmbedding[];
  model?: string;
  usage?: { total_tokens?: number };
}

export class EmbedderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EmbedderError';
  }
}

export class Embedder {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embedItems(items: NewsItem[]): Promise<NewsItemWithVector[]> {
    try {
      console.log(`[Embedder] Embedding ${items.length} items with ${this.model}`);
      const inputs = items.map((i) => `${i.title}\n\n${i.description}`);
      const vectors = await this.embedBatch(inputs, 'document');
      return items.map((item, idx) => ({ ...item, vector: vectors[idx]! }));
    } catch (cause) {
      if (cause instanceof EmbedderError) throw cause;
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
    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: inputs,
        input_type: inputType,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new EmbedderError(
        `Voyage API returned ${response.status}: ${errorBody.slice(0, 200)}`,
      );
    }

    const parsed = (await response.json()) as VoyageEmbeddingsResponse;
    const data = parsed.data;

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
