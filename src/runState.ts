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
    console.error('[RunState] Pipeline failed:', errorMessage);
    return { status: 'error', error: errorMessage };
  } finally {
    isRunning = false;
  }
}
