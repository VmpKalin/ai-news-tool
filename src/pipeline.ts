import { config } from './config.js';
import { InoreaderFetcher } from './ingestion/inoreaderFetcher.js';
import { Embedder } from './ingestion/embedder.js';
import { Searcher } from './retrieval/searcher.js';
import { getUserProfileEmbedding } from './retrieval/userProfile.js';
import { Summarizer } from './generation/summarizer.js';
import { ArticleTranslator } from './generation/articleTranslator.js';
import type { ArticleStore } from './store/articleStore.js';
import type { TelegramDelivery } from './delivery/telegram.js';

export interface PipelineDeps {
  readonly store: ArticleStore;
  readonly telegram: TelegramDelivery;
}

export function createPipelineRunner(deps: PipelineDeps): () => Promise<string> {
  return () => runPipeline(deps);
}

export async function runPipeline(deps: PipelineDeps): Promise<string> {
  const pipelineStart = Date.now();

  try {
    const fetcher = new InoreaderFetcher(
      {
        appId: config.inoreaderAppId,
        appSecret: config.inoreaderAppSecret,
        accessToken: config.inoreaderAccessToken,
        refreshToken: config.inoreaderRefreshToken,
      },
      {
        windowHours: config.fetchWindowHours,
        maxArticles: config.fetchMaxArticles,
        folders: config.inoreaderFolders,
      },
    );
    const embedder = new Embedder(config.voyageApiKey, config.embeddingModel);
    const searcher = new Searcher(config.topK);
    const translator = new ArticleTranslator(config.anthropicApiKey, config.summaryModel);
    const summarizer = new Summarizer(config.anthropicApiKey, config.summaryModel);

    const step1Start = Date.now();
    const rawItems = await fetcher.fetch();
    console.log(`[Pipeline] Step 1 (fetch) done in ${elapsed(step1Start)}s`);

    const dedupStart = Date.now();
    const sentFlags = await Promise.all(
      rawItems.map((item) => deps.store.isAlreadySent(item.id)),
    );
    const freshItems = rawItems.filter((_, idx) => !sentFlags[idx]);
    console.log(
      `[Pipeline] Deduplicated: ${freshItems.length} fresh out of ${rawItems.length} total (${elapsed(dedupStart)}s)`,
    );

    if (freshItems.length === 0) {
      console.log('[Pipeline] No new articles, skipping');
      return 'Немає нових статей за останні 24 години.';
    }

    const step2Start = Date.now();
    const vectorized = await embedder.embedItems(freshItems);
    console.log(`[Pipeline] Step 2 (embed news) done in ${elapsed(step2Start)}s`);

    const step3Start = Date.now();
    const profileVector = await getUserProfileEmbedding(embedder);
    console.log(`[Pipeline] Step 3 (embed profile) done in ${elapsed(step3Start)}s`);

    const step4Start = Date.now();
    const topItems = searcher.search(vectorized, profileVector);
    console.log(`[Pipeline] Step 4 (search) done in ${elapsed(step4Start)}s`);

    const step5Start = Date.now();
    const translated = await translator.translateBatch(topItems);
    console.log(`[Pipeline] Step 5 (translate) done in ${elapsed(step5Start)}s`);

    const step6Start = Date.now();
    const digest = await summarizer.summarize(translated);
    console.log(`[Pipeline] Step 6 (summarize) done in ${elapsed(step6Start)}s`);

    const step7Start = Date.now();
    await deps.store.save(translated);
    await deps.telegram.sendDigest(translated);
    await deps.store.markManyAsSent(translated.map((item) => item.id));
    console.log(`[Pipeline] Step 7 (deliver + mark sent) done in ${elapsed(step7Start)}s`);

    console.log(`\n[Pipeline] Total time: ${elapsed(pipelineStart)}s\n`);
    console.log('===== DAILY NEWS DIGEST =====\n');
    console.log(digest);
    console.log('\n=============================');
    return digest;
  } catch (cause) {
    console.error(`[Pipeline] Failed after ${elapsed(pipelineStart)}s`, cause);
    throw cause;
  }
}

function elapsed(startMs: number): string {
  return ((Date.now() - startMs) / 1000).toFixed(2);
}
