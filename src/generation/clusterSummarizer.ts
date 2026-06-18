import Anthropic from '@anthropic-ai/sdk';
import type { ScoredNewsItem } from '../models/NewsItem.js';

const SYSTEM_PROMPT = `Ти — редактор дайджесту для українських IT-спеціалістів у Німеччині.
Пиши зводку новин про IT-індустрію Німеччини та Європи.
Формат: 6-8 буллет-поінтів українською мовою.
Тон: професійний, корисний для девелоперів які живуть або планують переїхати до Німеччини.
Фокус: що відбувається в German/European tech, що важливо знати IT-спеціалісту.
Без вступу, висновків чи преамбули — одразу список.`;

export class ClusterSummarizerError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ClusterSummarizerError';
  }
}

export class ClusterSummarizer {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async summarize(items: ScoredNewsItem[]): Promise<string> {
    try {
      console.log(`[ClusterSummarizer] Summarizing ${items.length} items with ${this.model}`);

      const newsBlock = items
        .map(
          (item, idx) =>
            `${idx + 1}. [${item.source}] ${item.title}\n   ${item.description}\n   Source: ${item.url}`,
        )
        .join('\n\n');

      const userMessage = `Here is a selection of the most relevant German/European IT news. Compile a digest:\n\n${newsBlock}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new ClusterSummarizerError('Claude response contained no text block');
      }

      return textBlock.text;
    } catch (cause) {
      if (cause instanceof ClusterSummarizerError) throw cause;
      console.error('[ClusterSummarizer] Failed to generate summary', cause);
      throw new ClusterSummarizerError('Failed to generate cluster news summary', cause);
    }
  }
}
