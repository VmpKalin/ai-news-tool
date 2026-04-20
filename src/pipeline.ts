import { config } from './config.js';
import { InoreaderFetcher } from './ingestion/inoreaderFetcher.js';
import { ArticleValidator } from './ingestion/articleValidator.js';
import { Embedder } from './ingestion/embedder.js';
import { Searcher } from './retrieval/searcher.js';
import { getUserProfileEmbedding } from './retrieval/userProfile.js';
import { Summarizer } from './generation/summarizer.js';
import { ArticleTranslator } from './generation/articleTranslator.js';
import type { NewsItem } from './models/NewsItem.js';
import type { ArticleStore } from './store/articleStore.js';
import type { TelegramDelivery } from './delivery/telegram.js';

export interface PipelineDeps {
  readonly store: ArticleStore;
  readonly telegram: TelegramDelivery;
}

const FETCH_ATTEMPTS = 2;

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
    const validator = new ArticleValidator();
    const embedder = new Embedder(config.voyageApiKey, config.embeddingModel);
    const searcher = new Searcher(config.topK);
    const translator = new ArticleTranslator(config.anthropicApiKey, config.summaryModel);
    const summarizer = new Summarizer(config.anthropicApiKey, config.summaryModel);

    const step1Start = Date.now();
    const validItems = await fetchAndValidateWithRetry(fetcher, validator, deps.store);
    console.log(`[Pipeline] Step 1 (fetch + validate) done in ${elapsed(step1Start)}s`);

    if (validItems.length === 0) {
      console.log('[Pipeline] No valid articles after filtering, skipping');
      return 'Немає нових статей за останні 24 години.';
    }

    const step2Start = Date.now();
    const vectorized = await embedder.embedItems(validItems);
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

async function fetchAndValidateWithRetry(
  fetcher: InoreaderFetcher,
  validator: ArticleValidator,
  store: ArticleStore,
): Promise<NewsItem[]> {
  const allSeen = new Map<string, NewsItem>();
  let validItems: NewsItem[] = [];

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const fetched = await fetcher.fetch({
      windowHours: config.fetchWindowHours * attempt,
      maxArticles: config.fetchMaxArticles * attempt,
    });

    for (const item of fetched) {
      if (!allSeen.has(item.id)) allSeen.set(item.id, item);
    }

    const fresh = await filterAlreadySent([...allSeen.values()], store);
    const { valid } = validator.filter(fresh);
    validItems = valid;

    console.log(
      `[Pipeline] Attempt ${attempt}: fetched=${fetched.length}, accumulated=${allSeen.size}, fresh=${fresh.length}, valid=${valid.length}`,
    );

    if (validItems.length >= config.topK) return validItems;

    if (attempt < FETCH_ATTEMPTS) {
      console.warn(
        `[Pipeline] Only ${validItems.length} valid < TOP_K=${config.topK}. Retrying with widened window.`,
      );
    }
  }

  if (validItems.length === 0) {
    console.warn('[Pipeline] No valid articles after all fetch attempts');
  } else if (validItems.length < config.topK) {
    console.warn(
      `[Pipeline] Still fewer than TOP_K after ${FETCH_ATTEMPTS} attempts: delivering ${validItems.length} articles.`,
    );
  }

  return validItems;
}

async function filterAlreadySent(items: NewsItem[], store: ArticleStore): Promise<NewsItem[]> {
  const flags = await Promise.all(items.map((item) => store.isAlreadySent(item.id)));
  return items.filter((_, idx) => !flags[idx]);
}

function elapsed(startMs: number): string {
  return ((Date.now() - startMs) / 1000).toFixed(2);
}
