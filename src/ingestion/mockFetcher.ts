import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NewsItem } from '../models/NewsItem.js';

interface MockNewsRecord {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  hoursAgo: number;
  content: string;
}

const DEFAULT_MOCK_PATH = resolve(process.cwd(), 'data/mockNews.json');

export class MockFetcherError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MockFetcherError';
  }
}

export class MockFetcher {
  constructor(private readonly filePath: string = DEFAULT_MOCK_PATH) {}

  async fetch(): Promise<NewsItem[]> {
    try {
      console.log(`[MockFetcher] Loading mock data from ${this.filePath}`);
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const records = this.validate(parsed);

      const now = Date.now();
      const items: NewsItem[] = records.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        url: r.url,
        source: r.source,
        publishedAt: new Date(now - r.hoursAgo * 60 * 60 * 1000),
        content: r.content,
      }));

      console.log(`[MockFetcher] Loaded ${items.length} items`);
      return items;
    } catch (cause) {
      if (cause instanceof MockFetcherError) throw cause;
      console.error('[MockFetcher] Failed to load mock data', cause);
      throw new MockFetcherError(`Failed to load mock data from ${this.filePath}`, cause);
    }
  }

  private validate(parsed: unknown): MockNewsRecord[] {
    if (!Array.isArray(parsed)) {
      throw new MockFetcherError('Mock data root must be a JSON array');
    }
    if (parsed.length === 0) {
      throw new MockFetcherError('Mock data array is empty');
    }

    return parsed.map((record, idx) => {
      if (typeof record !== 'object' || record === null) {
        throw new MockFetcherError(`Record at index ${idx} is not an object`);
      }
      const r = record as Record<string, unknown>;
      if (
        typeof r.id !== 'string' ||
        typeof r.title !== 'string' ||
        typeof r.description !== 'string' ||
        typeof r.url !== 'string' ||
        typeof r.source !== 'string' ||
        typeof r.hoursAgo !== 'number' ||
        typeof r.content !== 'string'
      ) {
        throw new MockFetcherError(`Record at index ${idx} has missing or invalid fields`);
      }
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        url: r.url,
        source: r.source,
        hoursAgo: r.hoursAgo,
        content: r.content,
      };
    });
  }
}
