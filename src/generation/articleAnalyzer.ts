import Anthropic from '@anthropic-ai/sdk';
import type { NewsItem } from '../models/NewsItem.js';

const SYSTEM_PROMPT = `Ти аналітик новин. Надай розгорнутий аналіз статті українською мовою за такою структурою:

*1. Що сталось*
(2-3 речення — конкретні факти)

*2. Чому це важливо*
(2-3 речення — значення події)

*3. Контекст і передісторія*
(2-3 речення — як це співвідноситься з попередніми подіями)

*4. Можливі наслідки*
(2-3 речення — що це може означати далі)

Використовуй маркдаун для заголовків (*жирний*). Пиши стисло, фактологічно, без води.`;

export class ArticleAnalyzerError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ArticleAnalyzerError';
  }
}

export class ArticleAnalyzer {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async analyze(item: NewsItem): Promise<string> {
    try {
      console.log(`[ArticleAnalyzer] Analyzing "${item.title.slice(0, 60)}..."`);

      const userMessage = `Стаття:\n\nЗаголовок: ${item.title}\nДжерело: ${item.source}\nОпис: ${item.description}\n\nПовний текст: ${item.content || '(не доступний)'}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1536,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new ArticleAnalyzerError('Claude response contained no text block');
      }
      return textBlock.text;
    } catch (cause) {
      if (cause instanceof ArticleAnalyzerError) throw cause;
      console.error('[ArticleAnalyzer] Failed to analyze article', cause);
      throw new ArticleAnalyzerError('Failed to analyze article', cause);
    }
  }
}
