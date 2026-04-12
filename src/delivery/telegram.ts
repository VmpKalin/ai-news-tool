import { Telegraf } from 'telegraf';
import type { NewsItem } from '../models/NewsItem.js';
import { CallbackHandler } from './callbackHandler.js';
import { articleAlias } from '../store/articleStore.js';

export class TelegramDeliveryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TelegramDeliveryError';
  }
}

export class TelegramDelivery {
  private readonly bot: Telegraf;
  private launched = false;

  constructor(
    botToken: string,
    private readonly chatId: string,
    callbackHandler: CallbackHandler,
  ) {
    this.bot = new Telegraf(botToken);
    callbackHandler.register(this.bot);
  }

  async launch(): Promise<void> {
    try {
      this.bot.launch().catch((error: unknown) => {
        console.error('[TelegramDelivery] Bot polling error', error);
      });
      this.launched = true;
      const me = await this.bot.telegram.getMe();
      console.log(`[TelegramDelivery] Bot started as @${me.username}`);
    } catch (cause) {
      console.error('[TelegramDelivery] Failed to launch bot', cause);
      throw new TelegramDeliveryError('Failed to launch Telegram bot', cause);
    }
  }

  stop(signal?: string): void {
    if (!this.launched) return;
    try {
      this.bot.stop(signal);
      this.launched = false;
      console.log('[TelegramDelivery] Bot stopped');
    } catch (cause) {
      console.error('[TelegramDelivery] Error while stopping bot', cause);
    }
  }

  async sendDigest(items: NewsItem[]): Promise<void> {
    if (items.length === 0) {
      console.log('[TelegramDelivery] No items to send');
      return;
    }
    console.log(`[TelegramDelivery] Sending ${items.length} items to chat ${this.chatId}`);
    for (const item of items) {
      try {
        await this.sendItem(item);
      } catch (cause) {
        console.error(`[TelegramDelivery] Failed to send item ${item.id}`, cause);
      }
    }
  }

  private async sendItem(item: NewsItem): Promise<void> {
    const text = formatMessage(item);
    const alias = articleAlias(item.id);
    await this.bot.telegram.sendMessage(this.chatId, text, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔍 Детальніше', callback_data: `deep:${alias}` },
            { text: '🌐 Читати', url: item.url },
          ],
          [
            { text: '✍️ Створити пост', callback_data: `post:${alias}` },
            { text: '🗑 Видалити', callback_data: 'del' },
          ],
        ],
      },
    });
  }
}

function formatMessage(item: NewsItem): string {
  const title = escapeMd(item.title);
  const description = escapeMd(item.description);
  const source = escapeMd(item.source);
  const ago = timeAgo(item.publishedAt);
  return `🗞 *${title}*\n\n${description}\n\n📌 ${source} · ${ago}`;
}

function escapeMd(text: string): string {
  return text.replace(/([_*`[\]])/g, '\\$1');
}

function timeAgo(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return 'щойно';
  if (diffMin < 60) return `${diffMin} хв тому`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} год тому`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays} дн тому`;
}
