import type { NewsItem } from '../models/NewsItem.js';

export interface InoreaderCredentials {
  readonly appId: string;
  readonly appSecret: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface InoreaderFetchOptions {
  readonly windowHours: number;
  readonly maxArticles: number;
  readonly folders: readonly string[];
}

interface InoreaderItem {
  id: string;
  title: string;
  published: number;
  summary?: { content?: string };
  content?: { content?: string };
  canonical?: Array<{ href: string }>;
  origin?: { title?: string };
}

interface InoreaderStreamResponse {
  items?: InoreaderItem[];
}

interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
}

const BASE_URL = 'https://www.inoreader.com/reader/api/0';
const TOKEN_URL = 'https://www.inoreader.com/oauth2/token';
const SECONDS_PER_HOUR = 3600;
const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 600;
const MAX_CONTENT_CHARS = 4000;

function folderStreamPath(folder: string): string {
  return `/stream/contents/user/-/label/${encodeURIComponent(folder)}`;
}

export class InoreaderFetcherError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'InoreaderFetcherError';
  }
}

export class InoreaderFetcher {
  private accessToken: string;
  private refreshToken: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly windowHours: number;
  private readonly maxArticles: number;
  private readonly folders: readonly string[];

  constructor(credentials: InoreaderCredentials, options: InoreaderFetchOptions) {
    if (options.folders.length === 0) {
      throw new Error('InoreaderFetcher requires at least one folder');
    }
    this.appId = credentials.appId;
    this.appSecret = credentials.appSecret;
    this.accessToken = credentials.accessToken;
    this.refreshToken = credentials.refreshToken;
    this.windowHours = options.windowHours;
    this.maxArticles = options.maxArticles;
    this.folders = options.folders;
  }

  async fetch(): Promise<NewsItem[]> {
    try {
      const label = this.folders.length === 1 ? 'folder' : 'folders';
      console.log(
        `[InoreaderFetcher] Fetching from ${label}: ${this.folders.join(', ')} (last ${this.windowHours}h, max ${this.maxArticles} per folder)`,
      );
      const since = Math.floor(Date.now() / 1000) - this.windowHours * SECONDS_PER_HOUR;

      const perFolderResults = await Promise.all(
        this.folders.map((folder) => this.fetchFolder(folder, since)),
      );

      const deduped = new Map<string, NewsItem>();
      for (const items of perFolderResults) {
        for (const item of items) {
          if (!deduped.has(item.id)) deduped.set(item.id, item);
        }
      }
      const merged = [...deduped.values()];
      console.log(
        `[InoreaderFetcher] Received ${merged.length} unique articles across ${this.folders.length} folder(s)`,
      );
      return merged;
    } catch (cause) {
      if (cause instanceof InoreaderFetcherError) throw cause;
      console.error('[InoreaderFetcher] Failed to fetch articles', cause);
      throw new InoreaderFetcherError('Failed to fetch Inoreader articles', cause);
    }
  }

  private async fetchFolder(folder: string, since: number): Promise<NewsItem[]> {
    const url = `${BASE_URL}${folderStreamPath(folder)}?n=${this.maxArticles}&ot=${since}&output=json`;

    let response = await this.callStream(url);

    if (response.status === 401) {
      console.log('[InoreaderFetcher] Access token expired, refreshing...');
      await this.refreshAccessToken();
      response = await this.callStream(url);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new InoreaderFetcherError(
        `Inoreader API returned ${response.status} for folder "${folder}": ${body.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as InoreaderStreamResponse;
    const rawItems = data.items ?? [];
    console.log(`[InoreaderFetcher] Folder "${folder}" → ${rawItems.length} articles`);
    return rawItems.map((item) => this.mapToNewsItem(item));
  }

  private async callStream(url: string): Promise<Response> {
    return fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        AppId: this.appId,
        AppKey: this.appSecret,
      },
    });
  }

  private async refreshAccessToken(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.appId,
      client_secret: this.appSecret,
    });

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new InoreaderFetcherError(
        `Token refresh failed with ${response.status}: ${errBody.slice(0, 200)}`,
      );
    }

    const tokens = (await response.json()) as TokenRefreshResponse;
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new InoreaderFetcherError(
        'Token refresh response missing access_token or refresh_token',
      );
    }

    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    console.log('[InoreaderFetcher] Token refreshed successfully');
  }

  private mapToNewsItem(item: InoreaderItem): NewsItem {
    const summary = cleanFeedNoise(stripHtml(item.summary?.content ?? ''));
    const fullContent = cleanFeedNoise(stripHtml(item.content?.content ?? ''));
    const description = pickBestDescription(summary, fullContent);

    return {
      id: item.id,
      title: truncate(item.title, MAX_TITLE_CHARS),
      description: truncate(description, MAX_DESCRIPTION_CHARS),
      url: item.canonical?.[0]?.href ?? '',
      source: item.origin?.title ?? 'Unknown',
      publishedAt: new Date(item.published * 1000),
      content: truncate(fullContent, MAX_CONTENT_CHARS),
    };
  }
}

function cleanFeedNoise(text: string): string {
  if (text.length === 0) return text;
  let cleaned = text;

  cleaned = cleaned.replace(
    /(?:Таймкоди|Тайм-коди|Timecodes?|Time stamps?|Chapters?)[\s\S]*$/i,
    '',
  );

  cleaned = cleaned.replace(
    /(?:\s\d{1,2}:\d{2}\s+[^\d:][^\d:]{2,80}){3,}/g,
    ' ',
  );

  return cleaned.replace(/\s+/g, ' ').trim();
}

function pickBestDescription(summary: string, content: string): string {
  if (isFeedMetadataOnly(summary)) {
    return content || '';
  }
  if (summary.length < 100 && content.length > summary.length * 1.5) {
    return content;
  }
  return summary || content;
}

function isFeedMetadataOnly(text: string): boolean {
  if (text.length === 0) return true;
  const stripped = text
    .replace(/submitted by \/u\/\S+/gi, '')
    .replace(/\[link\]/gi, '')
    .replace(/\[comments\]/gi, '')
    .replace(/Article URL:\s*\S+/gi, '')
    .replace(/Comments URL:\s*\S+/gi, '')
    .replace(/Points:\s*\d+/gi, '')
    .replace(/#\s*Comments:\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length < 30;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cutAt = text.lastIndexOf(' ', max - 1);
  const cutPoint = cutAt > max * 0.6 ? cutAt : max - 1;
  return text.slice(0, cutPoint).trimEnd() + '…';
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
