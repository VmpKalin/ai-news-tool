import type { NewsItem } from '../models/NewsItem.js';

export type InvalidReason =
  | 'empty_description'
  | 'too_short'
  | 'medium_teaser'
  | 'reddit_metadata'
  | 'timecodes_only';

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: InvalidReason;
}

export interface ValidationStats {
  readonly total: number;
  readonly kept: number;
  readonly filtered: number;
  readonly byReason: Record<InvalidReason, number>;
}

export class ArticleValidatorError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ArticleValidatorError';
  }
}

const MIN_DESCRIPTION_LENGTH = 120;

const MEDIUM_TEASER_PATTERNS = [
  /Continue reading on\s+.+?»?\s*$/i,
  /Продовження читайте на\s+.+?»?\s*$/i,
  /Read more on\s+.+?»?\s*$/i,
  /\sContinue reading\s*»?\s*$/i,
];

const REDDIT_METADATA_RE = /^submitted by \/u\/\S+.*\[link\].*\[comments\]\s*$/i;

const TIMECODE_LINE_RE = /^[\s[\(]?(?:\d{1,2}:)?\d{1,2}:\d{2}[\s\]\)\-–—]/;

export class ArticleValidator {
  validate(item: NewsItem): ValidationResult {
    const desc = item.description.trim();

    if (desc.length === 0) {
      return { valid: false, reason: 'empty_description' };
    }

    const descUnescaped = desc.replace(/\\(.)/g, '$1');
    if (REDDIT_METADATA_RE.test(descUnescaped)) {
      return { valid: false, reason: 'reddit_metadata' };
    }

    for (const pattern of MEDIUM_TEASER_PATTERNS) {
      if (pattern.test(desc)) {
        return { valid: false, reason: 'medium_teaser' };
      }
    }

    const lines = desc.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length >= 3) {
      const timecodeCount = lines.filter((l) => TIMECODE_LINE_RE.test(l)).length;
      if (timecodeCount / lines.length >= 0.5) {
        return { valid: false, reason: 'timecodes_only' };
      }
    }

    if (desc.length < MIN_DESCRIPTION_LENGTH) {
      return { valid: false, reason: 'too_short' };
    }

    return { valid: true };
  }

  filter(items: NewsItem[]): { valid: NewsItem[]; stats: ValidationStats } {
    const byReason: Record<InvalidReason, number> = {
      empty_description: 0,
      too_short: 0,
      medium_teaser: 0,
      reddit_metadata: 0,
      timecodes_only: 0,
    };

    const valid: NewsItem[] = [];

    for (const item of items) {
      const result = this.validate(item);
      if (result.valid) {
        valid.push(item);
      } else {
        const reason = result.reason!;
        byReason[reason]++;
        const shortTitle = item.title.slice(0, 60);
        console.log(`[Validator] Skipped "${shortTitle}" — reason: ${reason}`);
      }
    }

    const filtered = items.length - valid.length;
    const stats: ValidationStats = {
      total: items.length,
      kept: valid.length,
      filtered,
      byReason,
    };

    if (filtered > 0) {
      const reasons = Object.entries(byReason)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(', ');
      console.error(
        `[Validator] Filtered ${filtered}/${items.length} articles (${reasons})`,
      );
    }

    return { valid, stats };
  }
}
