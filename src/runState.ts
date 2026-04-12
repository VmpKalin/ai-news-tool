import { redis } from './store/redisClient.js';

const DIGEST_KEY = 'digest:latest';
const LAST_RUN_KEY = 'run:lastRun';

export interface RunRecord {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: string;
}

export interface RunState {
  readonly isRunning: boolean;
  readonly lastRun: RunRecord | null;
  readonly latestDigest: string | null;
}

export type RunResult =
  | { readonly status: 'ok'; readonly digest: string }
  | { readonly status: 'already_running' }
  | { readonly status: 'error'; readonly error: string };

let isRunning = false;
let lastRun: RunRecord | null = null;
let latestDigest: string | null = null;

export function getState(): RunState {
  return { isRunning, lastRun, latestDigest };
}

export async function getLatestDigest(): Promise<string | null> {
  if (latestDigest !== null) return latestDigest;
  try {
    const cached = await redis.get(DIGEST_KEY);
    if (cached) {
      latestDigest = cached;
      return cached;
    }
  } catch (cause) {
    console.error('[RunState] Failed to read digest from Redis', cause);
  }
  return null;
}

export async function loadState(): Promise<void> {
  try {
    const [digestRaw, runRaw] = await Promise.all([
      redis.get(DIGEST_KEY),
      redis.get(LAST_RUN_KEY),
    ]);
    if (digestRaw) {
      latestDigest = digestRaw;
      console.log('[RunState] Restored latestDigest from Redis');
    }
    if (runRaw) {
      const parsed = parseRunRecord(runRaw);
      if (parsed) {
        lastRun = parsed;
        console.log('[RunState] Restored lastRun from Redis');
      }
    }
  } catch (cause) {
    console.error('[RunState] Failed to load state from Redis', cause);
  }
}

export async function runOnce(runner: () => Promise<string>): Promise<RunResult> {
  if (isRunning) {
    console.log('[RunState] Skipped — pipeline already running');
    return { status: 'already_running' };
  }

  isRunning = true;
  const startedAt = new Date();

  try {
    const digest = await runner();
    const finishedAt = new Date();
    latestDigest = digest;
    lastRun = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      success: true,
    };
    await persistState();
    return { status: 'ok', digest };
  } catch (cause) {
    const finishedAt = new Date();
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    lastRun = {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      success: false,
      error: errorMessage,
    };
    await persistLastRun();
    console.error('[RunState] Pipeline failed:', errorMessage);
    return { status: 'error', error: errorMessage };
  } finally {
    isRunning = false;
  }
}

async function persistState(): Promise<void> {
  if (latestDigest !== null) {
    try {
      await redis.set(DIGEST_KEY, latestDigest);
    } catch (cause) {
      console.error('[RunState] Failed to persist latestDigest', cause);
    }
  }
  await persistLastRun();
}

async function persistLastRun(): Promise<void> {
  if (lastRun === null) return;
  try {
    await redis.set(LAST_RUN_KEY, JSON.stringify(lastRun));
  } catch (cause) {
    console.error('[RunState] Failed to persist lastRun', cause);
  }
}

function parseRunRecord(raw: string): RunRecord | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (
      typeof obj === 'object' &&
      obj !== null &&
      'startedAt' in obj &&
      'finishedAt' in obj &&
      'durationMs' in obj &&
      'success' in obj
    ) {
      return obj as RunRecord;
    }
    return null;
  } catch {
    return null;
  }
}
