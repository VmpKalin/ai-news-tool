import { config } from '../config.js';

const MAX_DESCRIPTION_CHARS = 3800;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const DEDUP_WINDOW_MS = 60_000;
const DISCORD_RED = 0xe74c3c;

const webhookUrl = config.discordWebhookUrl;
const recentTimestamps: number[] = [];
const recentMessageHashes = new Map<string, number>();
let installed = false;

export function initErrorReporter(): void {
  if (installed) return;
  installed = true;

  const originalConsoleError = console.error.bind(console);

  console.error = (...args: unknown[]): void => {
    originalConsoleError(...args);
    const text = args.map(formatArg).join(' ');
    void sendToDiscord(text);
  };

  process.on('uncaughtException', (error) => {
    console.error('[UncaughtException]', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[UnhandledRejection]', reason);
  });

  if (webhookUrl) {
    originalConsoleError('[ErrorReporter] Discord webhook enabled');
  } else {
    originalConsoleError('[ErrorReporter] DISCORD_WEBHOOK_URL not set — errors go to stderr only');
  }
}

async function sendToDiscord(text: string): Promise<void> {
  if (!webhookUrl) return;
  if (isDuplicate(text)) return;
  if (!checkRateLimit()) return;

  const truncated = truncate(text, MAX_DESCRIPTION_CHARS);
  const payload = {
    embeds: [
      {
        title: '🚨 News Digest Bot Error',
        description: '```\n' + truncated + '\n```',
        color: DISCORD_RED,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      process.stderr.write(
        `[DiscordReporter] webhook returned ${response.status}: ${body.slice(0, 200)}\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`[DiscordReporter] network error: ${String(err)}\n`);
  }
}

function checkRateLimit(): boolean {
  const now = Date.now();
  while (recentTimestamps.length > 0 && now - recentTimestamps[0]! > RATE_LIMIT_WINDOW_MS) {
    recentTimestamps.shift();
  }
  if (recentTimestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recentTimestamps.push(now);
  return true;
}

function isDuplicate(text: string): boolean {
  const now = Date.now();
  for (const [hash, ts] of recentMessageHashes) {
    if (now - ts > DEDUP_WINDOW_MS) recentMessageHashes.delete(hash);
  }
  const fingerprint = hashMessage(text);
  if (recentMessageHashes.has(fingerprint)) return true;
  recentMessageHashes.set(fingerprint, now);
  return false;
}

function hashMessage(text: string): string {
  const normalized = text.slice(0, 500).replace(/\s+/g, ' ').trim();
  return normalized;
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
