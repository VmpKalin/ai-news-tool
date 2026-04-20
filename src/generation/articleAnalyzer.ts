import Anthropic from '@anthropic-ai/sdk';
import type { NewsItem } from '../models/NewsItem.js';

const SYSTEM_PROMPT = `You are a news analyst. Provide a detailed analysis of the article in Ukrainian, using this structure:

*1. Що сталось*
(2-3 sentences — concrete facts)

*2. Чому це важливо*
(2-3 sentences — significance of the event)

*3. Контекст і передісторія*
(2-3 sentences — how it relates to previous events)

*4. Можливі наслідки*
(2-3 sentences — what it could mean going forward)

Use markdown for headers (*bold*). Write concisely, fact-based, no filler.`;

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

      const userMessage = `Article:\n\nTitle: ${item.title}\nSource: ${item.source}\nDescription: ${item.description}\n\nFull text: ${item.content || '(not available)'}`;

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
