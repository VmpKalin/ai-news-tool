import cron, { type ScheduledTask } from 'node-cron';
import { runOnce } from './runState.js';

export type PipelineRunner = () => Promise<string>;

export class Scheduler {
  private task: ScheduledTask | null = null;

  constructor(
    private readonly expression: string,
    private readonly timezone: string,
    private readonly runner: PipelineRunner,
  ) {}

  start(): void {
    try {
      if (!cron.validate(this.expression)) {
        throw new Error(`Invalid cron expression: ${this.expression}`);
      }

      this.task = cron.schedule(
        this.expression,
        async () => {
          console.log('[Scheduler] Cron tick — triggering pipeline');
          const result = await runOnce(this.runner);
          if (result.status === 'already_running') {
            console.log('[Scheduler] Skipped — previous run still in progress');
          } else if (result.status === 'error') {
            console.error(`[Scheduler] Run failed: ${result.error}`);
          } else {
            console.log('[Scheduler] Run completed successfully');
          }
        },
        {
          timezone: this.timezone,
          noOverlap: true,
        },
      );

      const next = this.task.getNextRun();
      console.log(
        `[Scheduler] Started with "${this.expression}" (${this.timezone}). Next run: ${next?.toISOString() ?? 'unknown'}`,
      );
    } catch (cause) {
      console.error('[Scheduler] Failed to start', cause);
      throw new Error(
        `Scheduler failed to start: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  async stop(): Promise<void> {
    if (!this.task) return;
    try {
      await this.task.stop();
      await this.task.destroy();
      this.task = null;
      console.log('[Scheduler] Stopped');
    } catch (cause) {
      console.error('[Scheduler] Error while stopping', cause);
    }
  }

  getNextRun(): Date | null {
    return this.task?.getNextRun() ?? null;
  }
}
