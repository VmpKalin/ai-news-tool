import { config } from './config.js';
import { Scheduler } from './scheduler.js';
import { HttpServer } from './server.js';
import { getState, loadState } from './runState.js';
import { ArticleStore } from './store/articleStore.js';
import { connectRedis, disconnectRedis } from './store/redisClient.js';
import { ArticleAnalyzer } from './generation/articleAnalyzer.js';
import { PostGenerator } from './generation/postGenerator.js';
import { TelegramDelivery } from './delivery/telegram.js';
import { CallbackHandler } from './delivery/callbackHandler.js';
import { createPipelineRunner } from './pipeline.js';

async function main(): Promise<void> {
  console.log('[Index] Starting News Digest Bot daemon');

  await connectRedis();
  await loadState();

  const store = new ArticleStore();
  const analyzer = new ArticleAnalyzer(config.anthropicApiKey, config.summaryModel);
  const postGenerator = new PostGenerator(config.anthropicApiKey, config.summaryModel);
  const callbackHandler = new CallbackHandler(store, analyzer, postGenerator);
  const telegram = new TelegramDelivery(
    config.telegramBotToken,
    config.telegramChatId,
    callbackHandler,
  );

  const runner = createPipelineRunner({ store, telegram });

  const scheduler = new Scheduler(config.cronSchedule, config.timezone, runner);
  const server = new HttpServer({
    port: config.port,
    triggerToken: config.triggerToken,
    scheduler,
    runner,
  });

  await telegram.launch();
  scheduler.start();
  await server.start();

  const authNote = config.triggerToken
    ? 'Bearer token required on POST /digest/run'
    : 'No auth on POST /digest/run (TRIGGER_TOKEN not set)';
  console.log(`[Index] Daemon ready. ${authNote}`);

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      console.log(`[Index] Received ${signal} again — forcing exit`);
      process.exit(130);
    }
    shuttingDown = true;

    console.log(`[Index] Received ${signal}, shutting down gracefully...`);

    telegram.stop(signal);
    await scheduler.stop();

    const waitStart = Date.now();
    while (getState().isRunning) {
      if (Date.now() - waitStart > 30_000) {
        console.warn('[Index] Timed out waiting for pipeline — forcing exit');
        break;
      }
      console.log('[Index] Waiting for current pipeline run to finish...');
      await new Promise((r) => setTimeout(r, 1000));
    }

    try {
      await server.stop();
    } catch (error) {
      console.error('[Index] Error closing server', error);
    }

    await disconnectRedis();

    console.log('[Index] Shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGINT', () => {
    if (shuttingDown) {
      console.log('[Index] Received SIGINT again — forcing exit');
      process.exit(130);
    }
  });
  process.on('SIGTERM', () => {
    if (shuttingDown) {
      console.log('[Index] Received SIGTERM again — forcing exit');
      process.exit(143);
    }
  });
}

main().catch((error: unknown) => {
  console.error('[Index] Fatal startup error', error);
  process.exit(1);
});
