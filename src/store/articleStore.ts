import { createHash } from 'node:crypto';
import type { NewsItem } from '../models/NewsItem.js';
import { redis } from './redisClient.js';

const ARTICLE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SENT_TTL_SECONDS = 30 * 24 * 60 * 60;

export function articleAlias(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

interface SerializedNewsItem extends Omit<NewsItem, 'publishedAt'> {
  publishedAt: string;
}

export class ArticleStore {
  async save(items: NewsItem[]): Promise<void> {
    if (items.length === 0) return;
    try {
      await Promise.all(
        items.map((item) => {
          const key = `article:${articleAlias(item.id)}`;
          const value: SerializedNewsItem = {
            ...item,
            publishedAt: item.publishedAt.toISOString(),
          };
          return redis.set(key, JSON.stringify(value), 'EX', ARTICLE_TTL_SECONDS);
        }),
      );
      console.log(`[ArticleStore] Saved ${items.length} items to Redis (TTL 7d)`);
    } catch (cause) {
      console.error('[ArticleStore] Failed to save items', cause);
    }
  }

  async getByAlias(alias: string): Promise<NewsItem | null> {
    try {
      const raw = await redis.get(`article:${alias}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SerializedNewsItem;
      return { ...parsed, publishedAt: new Date(parsed.publishedAt) };
    } catch (cause) {
      console.error(`[ArticleStore] Failed to load alias ${alias}`, cause);
      return null;
    }
  }

  async isAlreadySent(articleId: string): Promise<boolean> {
    try {
      const exists = await redis.exists(`sent:${articleId}`);
      return exists === 1;
    } catch (cause) {
      console.error(`[ArticleStore] isAlreadySent failed for ${articleId}`, cause);
      return false;
    }
  }

  async markAsSent(articleId: string): Promise<void> {
    try {
      await redis.set(`sent:${articleId}`, '1', 'EX', SENT_TTL_SECONDS);
    } catch (cause) {
      console.error(`[ArticleStore] markAsSent failed for ${articleId}`, cause);
    }
  }

  async markManyAsSent(articleIds: string[]): Promise<void> {
    if (articleIds.length === 0) return;
    await Promise.all(articleIds.map((id) => this.markAsSent(id)));
  }
}
