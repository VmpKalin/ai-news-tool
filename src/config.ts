import 'dotenv/config';

export interface AppConfig {
  readonly anthropicApiKey: string;
  readonly voyageApiKey: string;
  readonly embeddingModel: string;
  readonly summaryModel: string;
  readonly topK: number;
  readonly inoreaderAppId: string;
  readonly inoreaderAppSecret: string;
  readonly inoreaderAccessToken: string;
  readonly inoreaderRefreshToken: string;
  readonly port: number;
  readonly cronSchedule: string;
  readonly timezone: string;
  readonly triggerToken: string | null;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`[config] Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

export const config: AppConfig = {
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
  voyageApiKey: requireEnv('VOYAGE_API_KEY'),
  embeddingModel: 'voyage-3-lite',
  summaryModel: 'claude-sonnet-4-5',
  topK: parseInt(requireEnv('TOP_K'), 10),
  inoreaderAppId: requireEnv('INOREADER_APP_ID'),
  inoreaderAppSecret: requireEnv('INOREADER_APP_SECRET'),
  inoreaderAccessToken: requireEnv('INOREADER_ACCESS_TOKEN'),
  inoreaderRefreshToken: requireEnv('INOREADER_REFRESH_TOKEN'),
  port: parseInt(optionalEnv('PORT', '3000'), 10),
  cronSchedule: optionalEnv('CRON_SCHEDULE', '0 8 * * *'),
  timezone: optionalEnv('TZ', 'Europe/Kyiv'),
  triggerToken: process.env.TRIGGER_TOKEN?.trim() || null,
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  telegramChatId: requireEnv('TELEGRAM_CHAT_ID'),
};
