import type { NewsItem } from '../models/NewsItem.js';

export interface InoreaderCredentials {
  readonly appId: string;
  readonly appSecret: string;
  readonly accessToken: string;
  readonly refreshToken: string;
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
const STREAM_PATH = '/stream/contents/user/-/state/com.google/reading-list';
const MAX_ARTICLES = 50;
const SECONDS_PER_DAY = 86400;

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

  constructor(credentials: InoreaderCredentials) {
    this.appId = credentials.appId;
    this.appSecret = credentials.appSecret;
    this.accessToken = credentials.accessToken;
    this.refreshToken = credentials.refreshToken;
  }

  async fetch(): Promise<NewsItem[]> {
    try {
      console.log('[InoreaderFetcher] Fetching articles since 24h ago...');
      const since = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY;
      const url = `${BASE_URL}${STREAM_PATH}?n=${MAX_ARTICLES}&ot=${since}&output=json`;

      let response = await this.callStream(url);

      if (response.status === 401) {
        console.log('[InoreaderFetcher] Access token expired, refreshing...');
        await this.refreshAccessToken();
        response = await this.callStream(url);
      }

      if (!response.ok) {
        const body = await response.text();
        throw new InoreaderFetcherError(
          `Inoreader API returned ${response.status}: ${body.slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as InoreaderStreamResponse;
      const rawItems = data.items ?? [];
      console.log(`[InoreaderFetcher] Received ${rawItems.length} articles`);

      return rawItems.map((item) => this.mapToNewsItem(item));
    } catch (cause) {
      if (cause instanceof InoreaderFetcherError) throw cause;
      console.error('[InoreaderFetcher] Failed to fetch articles', cause);
      throw new InoreaderFetcherError('Failed to fetch Inoreader articles', cause);
    }
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
    return {
      id: item.id,
      title: item.title,
      description: stripHtml(item.summary?.content ?? ''),
      url: item.canonical?.[0]?.href ?? '',
      source: item.origin?.title ?? 'Unknown',
      publishedAt: new Date(item.published * 1000),
      content: stripHtml(item.content?.content ?? ''),
    };
  }
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
