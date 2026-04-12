# News Digest Bot

## Project Goal
Automated daily news digest: RSS feeds → RAG filtering → Claude summary → Telegram

## Documentation
Always use context7 for any library or framework documentation.
Before implementing anything with external libraries, fetch their
current docs via context7 first.

## Tech Stack
- Runtime: Node.js 20+ with TypeScript (strict mode)
- AI: Anthropic SDK — Claude for summarization, embeddings for RAG
- Vector DB: Qdrant (local via Docker)
- Telegram: telegraf
- Scheduler: node-cron

## Architecture
```
src/
├── ingestion/
│   ├── rssFetcher.ts      # fetch + parse RSS, filter last 24h
│   ├── embedder.ts        # text → vector via Anthropic embeddings
│   └── vectorStore.ts     # upsert/query Qdrant
├── retrieval/
│   ├── userProfile.ts     # static interest profile for similarity
│   └── searcher.ts        # cosine similarity search
├── generation/
│   └── summarizer.ts      # Claude API → Ukrainian digest
├── delivery/
│   └── telegram.ts        # send message to chat
├── pipeline.ts            # orchestrator — runs all steps in order
└── config.ts              # all config/env vars in one place
```

## Code Style

### General
- TypeScript strict mode — no `any`, ever
- `async/await` only — never raw `.then()` chains
- Named exports only — no default exports
- `interface` over `type` for object shapes
- Keep files under 150 lines — extract if bigger

### Error Handling
- Every async function must have try/catch
- Never swallow errors silently — always log with context
- Use typed custom errors where it makes sense:
```typescript
class RssFetchError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Failed to fetch RSS: ${url}`);
    this.cause = cause;
  }
}
```

### Environment & Config
- All secrets in `.env` only — never hardcode
- All env vars accessed through `src/config.ts` only
- Validate env vars at startup — fail fast if missing:
```typescript
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required');
}
```

### Service Pattern
Each service is a class with a single responsibility:
```typescript
export class RssFetcher {
  constructor(private readonly config: RssConfig) {}
  async fetch(url: string): Promise<NewsItem[]> { ... }
}
```

### Logging
- Use `console.log` with structured prefix:
```
[RssFetcher] Fetching 3 feeds...
[Embedder] Generated 12 embeddings
[Pipeline] Done in 4.2s
```

### Data Flow
- Each step returns typed data to the next — no shared mutable state
- Pipeline steps are independent and testable in isolation

## File Naming
- `camelCase.ts` for all source files
- Interfaces: `NewsItem`, `EpisodeScript` — PascalCase
- Constants: `MAX_ARTICLES`, `DEFAULT_LIMIT` — UPPER_SNAKE_CASE

## Rules
- DO NOT modify `.env` — only `.env.example`
- DO NOT install new packages without mentioning it
- DO NOT use `any` type
- Run `npm run build` after every major change to check types
- Summary language is always Ukrainian
- After completing each task or file, automatically update 
  the ## Progress section in CLAUDE.md
- If ## Progress section does not exist, create it
- Format: checkboxes with filename and one-line description
- At the start of each new session, read CLAUDE.md and 
  git log to understand current state before doing anything

## Progress

- [x] `package.json` — deps: @anthropic-ai/sdk, voyageai, dotenv; scripts: dev/build/start
- [x] `tsconfig.json` — ES2022, strict mode, bundler resolution, dist output
- [x] `.env.example` — ANTHROPIC_API_KEY, VOYAGE_API_KEY
- [x] `.gitignore` — node_modules, dist, .env
- [x] `src/config.ts` — fail-fast env validation, typed AppConfig export
- [x] `src/models/NewsItem.ts` — NewsItem, NewsItemWithVector, ScoredNewsItem interfaces
- [x] `src/ingestion/mockFetcher.ts` — reads `data/mockNews.json` at runtime, validates shape, computes publishedAt from `hoursAgo` (kept as fallback, unused in pipeline)
- [x] `data/mockNews.json` — mock items for offline development
- [x] `src/ingestion/inoreaderFetcher.ts` — real Inoreader API client with 401 auto-refresh, HTML stripping, field mapping; replaces MockFetcher in pipeline
- [x] `src/ingestion/embedder.ts` — Voyage voyage-3-lite, batch embed, query/document input types
- [x] `src/retrieval/userProfile.ts` — static profile text + embedding helper
- [x] `src/retrieval/searcher.ts` — cosine similarity, returns top K scored items
- [x] `src/generation/summarizer.ts` — Claude claude-sonnet-4-5, Ukrainian digest prompt
- [x] `src/pipeline.ts` — orchestrates fetch → embed → search → summarize → save-to-store → telegram-deliver; takes store/telegram deps; returns digest string
- [x] `src/store/articleStore.ts` — in-memory Map<id, NewsItem>, save/getById
- [x] `src/generation/articleAnalyzer.ts` — Claude-powered deep analysis for single article (4-section Ukrainian breakdown)
- [x] `src/generation/articleTranslator.ts` — translates title+description to Ukrainian via Claude+JSON, generic batch with per-item fallback
- [x] `src/generation/postGenerator.ts` — generates personal-style post using writingStyle.md (read on each request, no restart needed)
- [x] `data/writingStyle.md` — user-editable voice/style config with sample posts
- [x] `src/delivery/telegram.ts` — Telegraf v4 bot, 2-row keyboard: [Детальніше][Читати] / [Створити пост][Видалити], uses article alias
- [x] `src/delivery/callbackHandler.ts` — routes deep/post/del actions, attaches post+del buttons to analyzer reply, del-only on post reply
- [x] `src/store/articleStore.ts` — SHA-256 truncated alias (12 chars) fits Telegram callback_data 64-byte limit
- [x] `src/runState.ts` — in-memory mutex + state (isRunning, lastRun, latestDigest) via `runOnce()`
- [x] `src/scheduler.ts` — node-cron v4 wrapper with timezone + built-in noOverlap
- [x] `src/server.ts` — native `node:http` server: `/health`, `POST /digest/run`, `/digest/latest`, `/openapi.json`, `/docs`, optional bearer auth
- [x] `src/docs.ts` — OpenAPI 3.0.3 spec as const object + Scalar API Reference HTML (via CDN)
- [x] `src/index.ts` — daemon entry point: starts scheduler + server, handles SIGTERM/SIGINT graceful shutdown
- [x] `npm run build` — compiles cleanly, no type errors
