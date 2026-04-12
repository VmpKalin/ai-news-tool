import type { Telegraf, Context } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { ArticleStore } from '../store/articleStore.js';
import type { ArticleAnalyzer } from '../generation/articleAnalyzer.js';
import type { PostGenerator } from '../generation/postGenerator.js';

const DEEP_PREFIX = 'deep:';
const POST_PREFIX = 'post:';
const DEL_ACTION = 'del';

export class CallbackHandler {
  constructor(
    private readonly store: ArticleStore,
    private readonly analyzer: ArticleAnalyzer,
    private readonly postGenerator: PostGenerator,
  ) {}

  register(bot: Telegraf): void {
    bot.on('callback_query', async (ctx) => {
      try {
        await this.handle(ctx);
      } catch (cause) {
        console.error('[CallbackHandler] Unhandled callback error', cause);
        await safeAnswer(ctx, '⚠️ Помилка обробки');
      }
    });
    console.log('[CallbackHandler] Registered callback_query listener');
  }

  private async handle(ctx: Context): Promise<void> {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) {
      await safeAnswer(ctx);
      return;
    }

    const data = callbackQuery.data;

    if (data === DEL_ACTION) {
      await this.handleDelete(ctx);
      return;
    }

    if (data.startsWith(DEEP_PREFIX)) {
      const alias = data.slice(DEEP_PREFIX.length);
      await this.handleDeep(ctx, alias);
      return;
    }

    if (data.startsWith(POST_PREFIX)) {
      const alias = data.slice(POST_PREFIX.length);
      await this.handlePost(ctx, alias);
      return;
    }

    await safeAnswer(ctx, 'Невідома дія');
  }

  private async handleDelete(ctx: Context): Promise<void> {
    try {
      await ctx.deleteMessage();
      await safeAnswer(ctx);
    } catch (cause) {
      console.error('[CallbackHandler] Failed to delete message', cause);
      await safeAnswer(ctx, '⚠️ Не вдалося видалити');
    }
  }

  private async handleDeep(ctx: Context, alias: string): Promise<void> {
    const article = await this.store.getByAlias(alias);
    if (!article) {
      console.warn(`[CallbackHandler] Article ${alias} not in store`);
      await safeAnswer(ctx, '⚠️ Стаття більше недоступна');
      return;
    }

    console.log(`[CallbackHandler] Deep analysis requested for ${alias}`);
    await safeAnswer(ctx, '⏳ Готую аналіз...');

    try {
      const analysis = await this.analyzer.analyze(article);
      await ctx.reply(analysis, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: postAndDeleteKeyboard(alias),
      });
    } catch (cause) {
      console.error('[CallbackHandler] Analysis failed', cause);
      await ctx.reply('⚠️ Не вдалося згенерувати аналіз. Спробуй ще раз пізніше.');
    }
  }

  private async handlePost(ctx: Context, alias: string): Promise<void> {
    const article = await this.store.getByAlias(alias);
    if (!article) {
      console.warn(`[CallbackHandler] Article ${alias} not in store`);
      await safeAnswer(ctx, '⚠️ Стаття більше недоступна');
      return;
    }

    console.log(`[CallbackHandler] Post generation requested for ${alias}`);
    await safeAnswer(ctx, '✍️ Пишу пост у твоєму стилі...');

    try {
      const post = await this.postGenerator.generate(article);
      await ctx.reply(post, {
        link_preview_options: { is_disabled: true },
        reply_markup: deleteOnlyKeyboard(),
      });
    } catch (cause) {
      console.error('[CallbackHandler] Post generation failed', cause);
      await ctx.reply('⚠️ Не вдалося згенерувати пост. Спробуй ще раз пізніше.');
    }
  }
}

function postAndDeleteKeyboard(alias: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✍️ Створити пост', callback_data: `${POST_PREFIX}${alias}` },
        { text: '🗑 Видалити', callback_data: DEL_ACTION },
      ],
    ],
  };
}

function deleteOnlyKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: '🗑 Видалити', callback_data: DEL_ACTION }]],
  };
}

async function safeAnswer(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCbQuery(text);
  } catch (cause) {
    console.error('[CallbackHandler] Failed to answer callback query', cause);
  }
}
