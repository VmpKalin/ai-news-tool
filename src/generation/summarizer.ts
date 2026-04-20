import Anthropic from '@anthropic-ai/sdk';
import type { ScoredNewsItem } from '../models/NewsItem.js';

const SYSTEM_PROMPT = `You are a daily news digest host writing in Ukrainian.

Your role: briefly and professionally summarize the most important news of the day.

Format:
- 8-10 bullet points, one sentence each
- Most important facts first
- Tone: professional but conversational
- Language: Ukrainian only
- No preamble, introduction, or conclusion — just a bulleted list

Start immediately with the first bullet point.`;

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
            `${idx + 1}. [${item.source}] ${item.title}\n   ${item.description}\n   Source: ${item.url}`,
        )
        .join('\n\n');

      const userMessage = `Here is a selection of the most relevant news from the last 24 hours. Compile a digest:\n\n${newsBlock}`;

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
