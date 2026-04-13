import { Telegraf } from 'telegraf';
import type { NewsItem } from '../models/NewsItem.js';
import { CallbackHandler } from './callbackHandler.js';
import { articleAlias } from '../store/articleStore.js';
import { runOnce, getState } from '../runState.js';
import type { PipelineRunner } from '../scheduler.js';

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

  registerCommands(runner: PipelineRunner, getNextRun?: () => Date | null): void {
    this.bot.command('updates', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      await ctx.reply('⏳ Запускаю дайджест, зачекай...');
      const result = await runOnce(runner);
      if (result.status === 'ok') {
        await ctx.reply('✅ Готово!');
      } else if (result.status === 'already_running') {
        await ctx.reply('⏳ Дайджест вже виконується, зачекай...');
      } else {
        await ctx.reply(`❌ Помилка: ${result.error}`);
      }
    });

    this.bot.command('status', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const state = getState();
      const running = state.isRunning ? 'так' : 'ні';
      const lastRun = state.lastRun?.finishedAt ?? 'ніколи';
      const nextRun = getNextRun?.()?.toISOString() ?? 'невідомо';
      await ctx.reply(
        `📊 Статус:\n• Виконується: ${running}\n• Останній запуск: ${lastRun}\n• Наступний запуск: ${nextRun}`,
      );
    });

    this.bot.command('help', async (ctx) => {
      if (String(ctx.chat.id) !== this.chatId) return;
      await ctx.reply(
        '📋 Команди:\n/updates — запустити дайджест вручну\n/status — показати поточний стан\n/help — показати цю довідку',
      );
    });

    console.log('[TelegramDelivery] Commands registered: /updates /status /help');
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
    try {
      await this.sendHeadlines(items);
    } catch (cause) {
      console.error('[TelegramDelivery] Failed to send headlines summary', cause);
    }
  }

  private async sendHeadlines(items: NewsItem[]): Promise<void> {
    const lines = items.map(
      (item, idx) =>
        `${idx + 1}. <a href="${escapeHtmlAttr(item.url)}">${escapeHtml(item.title)}</a>`,
    );
    const text = `📰 <b>Усі новини сьогодні (${items.length}):</b>\n\n${lines.join('\n')}`;
    await this.bot.telegram.sendMessage(this.chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: '🗑 Видалити', callback_data: 'del' }]],
      },
    });
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
  const source = escapeMd(item.source);
  const ago = timeAgo(item.publishedAt);
  const trimmedDescription = item.description.trim();
  const body = trimmedDescription ? `\n\n${escapeMd(trimmedDescription)}` : '';
  return `🗞 *${title}*${body}\n\n📌 ${source} · ${ago}`;
}

function escapeMd(text: string): string {
  return text.replace(/([_*`[\]])/g, '\\$1');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
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
