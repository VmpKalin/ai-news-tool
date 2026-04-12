import { createHash } from 'node:crypto';
import type { NewsItem } from '../models/NewsItem.js';

export function articleAlias(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

export class ArticleStore {
  private readonly items = new Map<string, NewsItem>();

  save(items: NewsItem[]): void {
    for (const item of items) {
      this.items.set(articleAlias(item.id), item);
    }
    console.log(`[ArticleStore] Saved ${items.length} items (total: ${this.items.size})`);
  }

  getByAlias(alias: string): NewsItem | null {
    return this.items.get(alias) ?? null;
  }

  size(): number {
    return this.items.size;
  }
}
