import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { NewsItem } from '../models/NewsItem.js';

const STYLE_PATH = resolve(process.cwd(), 'data/writingStyle.md');

const DEFAULT_STYLE =
  'Tone: informal, direct, conversational, analytical, occasionally blunt but without pathos or clichés. Style: lively text, as if a person is thinking out loud and getting to the point — no filler, no artificial polish, focused on real observations, personal stance, and substance. Structure: 2-3 short paragraphs or compact semantic blocks, simple phrasing, clear thoughts, natural transitions, light emotionality and boldness allowed. Avoid bureaucratic language, excessive motivation, promotional tone, and formulaic phrases. Language: Ukrainian.';

function buildSystemPrompt(style: string): string {
  return `You help the user write social media posts in their personal style. You receive a news article as input and produce a ready-to-publish first-person post, as if the user just saw this news and is sharing their take.

Below is the user's style description, sample posts, and rules. Mimic this style as closely as possible: tone, length, syntax, typical sentence structure, word choice.

=== STYLE DESCRIPTION START ===
${style}
=== STYLE DESCRIPTION END ===

Important:
- Write in FIRST PERSON
- Natural voice, matching the samples above
- A specific reaction or opinion, not a retelling of the news
- Language: Ukrainian
- NO preambles like "Here's a post:" or "Here's my version:" — start immediately with the post text
- No hashtags unless the style dictates otherwise`;
}

export class PostGeneratorError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PostGeneratorError';
  }
}

export class PostGenerator {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generate(item: NewsItem): Promise<string> {
    try {
      console.log(`[PostGenerator] Generating post for "${item.title.slice(0, 60)}..."`);
      const style = await this.loadStyle();
      const systemPrompt = buildSystemPrompt(style);

      const userMessage = `News article:\nTitle: ${item.title}\nDescription: ${item.description}\nSource: ${item.source}\n\nWrite a post about this in my style.`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new PostGeneratorError('Claude returned no text block');
      }
      return textBlock.text;
    } catch (cause) {
      if (cause instanceof PostGeneratorError) throw cause;
      console.error('[PostGenerator] Failed', cause);
      throw new PostGeneratorError('Failed to generate post', cause);
    }
  }

  private async loadStyle(): Promise<string> {
    try {
      return await readFile(STYLE_PATH, 'utf-8');
    } catch (cause) {
      console.warn(
        `[PostGenerator] Could not load ${STYLE_PATH}, using default style`,
        cause,
      );
      return DEFAULT_STYLE;
    }
  }
}
