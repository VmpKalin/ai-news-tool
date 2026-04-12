import Anthropic from '@anthropic-ai/sdk';
import type { NewsItem } from '../models/NewsItem.js';

const SYSTEM_PROMPT = `Ти професійний перекладач новин. Переклади заголовок та опис статті українською мовою.

Правила:
- Зберігай фактологію і цифри
- Пиши природною українською, без калькування з англійської
- Назви компаній та брендів залишай без перекладу (Apple, OpenAI, NATO)
- Власні імена транслітеруй українською
- Якщо оригінал вже українською — поверни як є

Поверни ТІЛЬКИ JSON об'єкт, без коментарів до чи після. Формат:
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
        max_tokens: 1024,
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
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw: unknown = JSON.parse(match[0]);
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
