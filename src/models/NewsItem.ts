export interface NewsItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly source: string;
  readonly publishedAt: Date;
  readonly content: string;
}

export interface NewsItemWithVector extends NewsItem {
  readonly vector: number[];
}

export interface ScoredNewsItem extends NewsItem {
  readonly score: number;
}
