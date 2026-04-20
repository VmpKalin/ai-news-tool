import Anthropic from '@anthropic-ai/sdk';
import type { NewsItem } from '../models/NewsItem.js';

const SYSTEM_PROMPT = `You are a professional news translator. Translate the article title and description into Ukrainian.

Rules:
- Preserve all facts and numbers
- Write in natural Ukrainian, no calques from English
- Keep company and brand names untranslated (Apple, OpenAI, NATO)
- Transliterate proper names into Ukrainian
- If the original is already in Ukrainian, return as-is

Return ONLY a JSON object, no comments before or after. Format:
{"title": "...", "description": "..."}`;

interface TranslationPayload {
  title: string;
  description: string;
}

export class ArticleTranslatorError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ArticleTranslatorError';
  }
}

export class ArticleTranslator {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async translateBatch<T extends NewsItem>(items: T[]): Promise<T[]> {
    if (items.length === 0) return [];
    console.log(`[ArticleTranslator] Translating ${items.length} items in parallel`);
    const results = await Promise.allSettled(items.map((item) => this.translate(item)));
    return results.map((result, idx) => {
      if (result.status === 'fulfilled') return result.value;
      console.error(
        `[ArticleTranslator] Item ${idx} failed, keeping original`,
        result.reason,
      );
      return items[idx]!;
    });
  }

  async translate<T extends NewsItem>(item: T): Promise<T> {
    try {
      const userMessage = `Title: ${item.title}\n\nDescription: ${item.description}`;
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new ArticleTranslatorError('Claude returned no text block');
      }

      const parsed = parseTranslation(textBlock.text);
      if (!parsed) {
        throw new ArticleTranslatorError(
          `Could not parse translation JSON: ${textBlock.text.slice(0, 200)}`,
        );
      }

      return { ...item, title: parsed.title, description: parsed.description };
    } catch (cause) {
      if (cause instanceof ArticleTranslatorError) throw cause;
      throw new ArticleTranslatorError('Failed to translate article', cause);
    }
  }
}

function parseTranslation(text: string): TranslationPayload | null {
  const cleaned = stripCodeFence(text.trim());

  const direct = tryParse(cleaned);
  if (direct) return direct;

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    const fromRegex = tryParse(match[0]);
    if (fromRegex) return fromRegex;
  }

  return null;
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
}

function tryParse(candidate: string): TranslationPayload | null {
  try {
    const raw: unknown = JSON.parse(candidate);
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'title' in raw &&
      'description' in raw
    ) {
      const obj = raw as { title: unknown; description: unknown };
      if (typeof obj.title === 'string' && typeof obj.description === 'string') {
        return { title: obj.title, description: obj.description };
      }
    }
    return null;
  } catch {
    return null;
  }
}
