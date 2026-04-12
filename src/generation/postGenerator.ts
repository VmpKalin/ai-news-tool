import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { NewsItem } from '../models/NewsItem.js';

const STYLE_PATH = resolve(process.cwd(), 'data/writingStyle.md');

const DEFAULT_STYLE =
  'Тон: неформальний, прямий, розмовний, аналітичний, місцями жорсткий, але без пафосу і без кліше. Стиль: живий текст, ніби людина думає вголос і говорить по суті, без води, без штучної "красивості", з акцентом на реальні спостереження, особисту позицію і зміст. Структура: 2–3 короткі абзаци або короткі смислові блоки, прості формулювання, чіткі думки, природні переходи, допускається легка емоційність і категоричність. Уникати канцеляризмів, надмірної мотиваційності, рекламного тону і шаблонних фраз. Мова: українська.';

function buildSystemPrompt(style: string): string {
  return `Ти допомагаєш користувачу писати пости в його особистому стилі для соцмережі. На вхід отримуєш новину, на виході — готовий пост від першої особи, ніби користувач щойно побачив цю новину і ділиться думкою.

Нижче — опис стилю користувача, зразки його постів та правила. Імітуй цей стиль якомога точніше: тон, довжину, синтаксис, типову структуру речень, вибір лексики.

=== ПОЧАТОК ОПИСУ СТИЛЮ ===
${style}
=== КІНЕЦЬ ОПИСУ СТИЛЮ ===

Важливо:
- Пиши ВІД ПЕРШОЇ ОСОБИ
- Природний голос, як у зразках вище
- Конкретна реакція або думка, а не переказ новини
- Українською
- БЕЗ вступів типу "Ось пост:" чи "Ось мій варіант:" — починай одразу з тексту поста
- Без хештегів, якщо інакше не сказано у стилі`;
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

      const userMessage = `Новина:\nЗаголовок: ${item.title}\nОпис: ${item.description}\nДжерело: ${item.source}\n\nНапиши про це пост у моєму стилі.`;

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
