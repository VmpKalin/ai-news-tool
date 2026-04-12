import Anthropic from '@anthropic-ai/sdk';
import type { ScoredNewsItem } from '../models/NewsItem.js';

const SYSTEM_PROMPT = `Ти ведучий щоденного новинного дайджесту українською мовою.

Твоя роль: стисло та професійно переказати найважливіші новини дня.

Формат:
- 8-10 пунктів, по одному реченню кожен
- Найважливіші факти першими
- Тон: професійний, але розмовний
- Мова: виключно українська
- Без преамбул, вступу чи підсумку — лише маркований список

Починай одразу з першого пункту.`;

export class SummarizerError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SummarizerError';
  }
}

export class Summarizer {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async summarize(items: ScoredNewsItem[]): Promise<string> {
    try {
      console.log(`[Summarizer] Summarizing ${items.length} items with ${this.model}`);

      const newsBlock = items
        .map(
          (item, idx) =>
            `${idx + 1}. [${item.source}] ${item.title}\n   ${item.description}\n   Джерело: ${item.url}`,
        )
        .join('\n\n');

      const userMessage = `Ось добірка найрелевантніших новин за останні 24 години. Склади з них дайджест:\n\n${newsBlock}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new SummarizerError('Claude response contained no text block');
      }

      return textBlock.text;
    } catch (cause) {
      if (cause instanceof SummarizerError) throw cause;
      console.error('[Summarizer] Failed to generate summary', cause);
      throw new SummarizerError('Failed to generate news summary', cause);
    }
  }
}
