# News Digest Bot — Project Context

Automated daemon: Inoreader RSS -> Voyage embeddings -> cosine ranking -> Claude translation/summary -> Telegram delivery. Single-user, Docker-deployed.

## Tech Stack

- **Runtime:** Node.js 20+, TypeScript strict, ESM
- **AI:** Anthropic SDK (Claude Sonnet 4.5) — summarization, translation, analysis, post generation
- **Embeddings:** Voyage AI (voyage-3-lite) via HTTP — asymmetric document/query types
- **Storage:** Redis (ioredis v5) — article cache (7d TTL), dedup flags (30d), run state
- **Telegram:** Telegraf v4 — long polling, inline keyboards, callback queries
- **Scheduler:** node-cron v4 — `0 8,12,15,18,22 * * *` Europe/Kyiv (5x/day)
- **HTTP:** native `node:http` — 5 endpoints, optional bearer auth, Scalar docs UI
- **Container:** Docker multi-stage Alpine + tini, docker-compose with Redis + healthchecks

## Architecture

```
src/
├── config.ts              # env validation, typed AppConfig, fail-fast
├── index.ts               # daemon entry: Redis → services → scheduler + server + telegram
├── pipeline.ts            # ETL orchestrator: fetch → dedup → embed → search → translate → summarize → deliver
├── runState.ts            # mutex (isRunning), state persistence (Redis), RunResult union
├── scheduler.ts           # node-cron wrapper, PipelineRunner type, getNextRun()
├── server.ts              # HTTP: /health, POST /digest/run, /digest/latest, /openapi.json, /docs
├── docs.ts                # OpenAPI 3.0.3 spec + Scalar HTML
├── models/
│   └── NewsItem.ts        # NewsItem, NewsItemWithVector, ScoredNewsItem interfaces
├── ingestion/
│   ├── inoreaderFetcher.ts # Inoreader OAuth client, 401 auto-refresh, HTML strip, multi-folder
│   ├── embedder.ts         # Voyage batch embed, document/query input types
│   └── mockFetcher.ts      # reads data/mockNews.json (fallback, unused)
├── retrieval/
│   ├── userProfile.ts      # static interest profile text + embedding helper
│   └── searcher.ts         # cosine similarity, top-K scoring
├── generation/
│   ├── summarizer.ts       # Claude: 8-10 bullet Ukrainian digest
│   ├── articleTranslator.ts # Claude: title+desc → Ukrainian JSON, batch with per-item fallback
│   ├── articleAnalyzer.ts   # Claude: 4-section deep analysis (Telegram "Детальніше")
│   └── postGenerator.ts    # Claude: personal post from writingStyle.md (read fresh each time)
├── delivery/
│   ├── telegram.ts         # Telegraf bot: sendDigest, commands (/updates /status /help), inline KB
│   └── callbackHandler.ts  # routes deep/post/del callbacks, attaches keyboards
├── store/
│   ├── redisClient.ts      # ioredis singleton, lazy connect, connectRedis/disconnectRedis
│   └── articleStore.ts     # save/getByAlias/isAlreadySent/markAsSent, SHA-256 alias (12 hex)
├── observability/
│   └── errorReporter.ts    # hooks console.error → Discord webhook, rate-limited, deduped
data/
└── writingStyle.md         # user-editable voice/style config for post generation
```

## Pipeline Flow

```
Cron tick / HTTP POST /digest/run / Telegram /updates
  → runOnce() mutex check
  → InoreaderFetcher.fetch() → NewsItem[]
  → ArticleStore.isAlreadySent() dedup → fresh items only
  → Embedder.embedItems() (document type) → NewsItemWithVector[]
  → Embedder.embedQuery(USER_PROFILE_TEXT) (query type) → number[]
  → Searcher.search() cosine similarity → top-K ScoredNewsItem[]
  → ArticleTranslator.translateBatch() → ScoredNewsItem[] (Ukrainian)
  → Summarizer.summarize() → string (8-10 bullet digest)
  → ArticleStore.save() + TelegramDelivery.sendDigest() + markManyAsSent()
  → persist digest + lastRun to Redis
```

## Telegram Interaction

Each article sent with 2-row inline keyboard:
- Row 1: `[Детальніше]` (deep analysis via Claude) + `[Читати]` (URL)
- Row 2: `[Створити пост]` (personal post via writingStyle.md) + `[Видалити]`

After all articles: headlines summary (HTML links) with delete button.

Bot commands (filtered by TELEGRAM_CHAT_ID):
- `/updates` — manually trigger pipeline
- `/status` — isRunning, lastRun, nextRun
- `/help` — command list

Callback routing in `callbackHandler.ts`: `deep:{alias}` → analyze, `post:{alias}` → generate, `del` → delete message.

## AI: Relevance Filtering (RAG)

Filtering uses asymmetric vector search — articles embedded as `document`, user profile as `query` (Voyage AI optimizes retrieval for this split).

**User interest profile** (`src/retrieval/userProfile.ts`):
```
I am a software engineer interested ONLY in:
- Artificial intelligence and machine learning (LLMs, agents, tools)
- Software engineering and developer tools
- TypeScript, Node.js, .NET, C#
- Cloud infrastructure: AWS, Docker, Kubernetes
- Cybersecurity and DevOps
- European and Ukrainian tech industry news
- Crypto technology (blockchain, protocols) — NOT prices or crime

I am NOT interested in:
- Crime, violence, accidents, disasters
- Politics and government (unless directly tech policy)
- Sports, entertainment, celebrities
- General world news, human interest stories
- Health, medicine (unless health tech)
- War coverage (unless Ukrainian tech sector impact)
```

**Embedding input per article:** `"{title}\n\n{description}"` — embedded as batch via Voyage `voyage-3-lite`, input_type=`document`.

**Scoring:** cosine similarity between each article vector and profile vector → sort descending → take top K (env `TOP_K`, default 5).

**Key design choice:** translate AFTER search — retrieval works better on original English text, and we only pay for translating top-K items instead of all.

## AI: Claude Prompts

All prompts use Claude Sonnet 4.5, max_tokens varies per task.

### 1. Summarizer (max_tokens: 2048)

**System prompt:**
```
Ти ведучий щоденного новинного дайджесту українською мовою.
Твоя роль: стисло та професійно переказати найважливіші новини дня.
Формат:
- 8-10 пунктів, по одному реченню кожен
- Найважливіші факти першими
- Тон: професійний, але розмовний
- Мова: виключно українська
- Без преамбул, вступу чи підсумку — лише маркований список
Починай одразу з першого пункту.
```

**User message format:**
```
Ось добірка найрелевантніших новин за останні 24 години. Склади з них дайджест:

1. [Source] Title
   Description
   Джерело: url
```

### 2. Article Translator (max_tokens: 2048)

**System prompt:**
```
Ти професійний перекладач новин. Переклади заголовок та опис статті українською мовою.
Правила:
- Зберігай фактологію і цифри
- Пиши природною українською, без калькування з англійської
- Назви компаній та брендів залишай без перекладу (Apple, OpenAI, NATO)
- Власні імена транслітеруй українською
- Якщо оригінал вже українською — поверни як є
Поверни ТІЛЬКИ JSON об'єкт, без коментарів до чи після. Формат:
{"title": "...", "description": "..."}
```

**User message:** `Title: {title}\n\nDescription: {description}`

**JSON parsing:** strips code fences → tries JSON.parse → regex fallback `/{[\s\S]*}/` → validates title+description strings. Per-item `Promise.allSettled` — failed items keep original text.

### 3. Article Analyzer (max_tokens: 1536)

Triggered by Telegram "Детальніше" button.

**System prompt:**
```
Ти аналітик новин. Надай розгорнутий аналіз статті українською мовою за такою структурою:
*1. Що сталось* (2-3 речення — конкретні факти)
*2. Чому це важливо* (2-3 речення — значення події)
*3. Контекст і передісторія* (2-3 речення — як це співвідноситься з попередніми подіями)
*4. Можливі наслідки* (2-3 речення — що це може означати далі)
Використовуй маркдаун для заголовків (*жирний*). Пиши стисло, фактологічно, без води.
```

**User message:** `Заголовок: {title}\nДжерело: {source}\nОпис: {description}\n\nПовний текст: {content || "(не доступний)"}`

### 4. Post Generator (max_tokens: 1024)

Triggered by Telegram "Створити пост" button. Reads `data/writingStyle.md` fresh on every request.

**System prompt (dynamic, includes writingStyle.md content):**
```
Ти допомагаєш користувачу писати пости в його особистому стилі для соцмережі.
На вхід отримуєш новину, на виході — готовий пост від першої особи.

=== ПОЧАТОК ОПИСУ СТИЛЮ ===
{content of data/writingStyle.md}
=== КІНЕЦЬ ОПИСУ СТИЛЮ ===

Важливо:
- Пиши ВІД ПЕРШОЇ ОСОБИ
- Природний голос, як у зразках вище
- Конкретна реакція або думка, а не переказ новини
- Українською
- БЕЗ вступів типу "Ось пост:" — починай одразу з тексту поста
- Без хештегів, якщо інакше не сказано у стилі
```

**Default style** (if writingStyle.md missing): неформальний, прямий, розмовний, аналітичний, місцями жорсткий, без пафосу і кліше, 2-3 короткі абзаци, українська.

**User message:** `Новина:\nЗаголовок: {title}\nОпис: {description}\nДжерело: {source}\n\nНапиши про це пост у моєму стилі.`

## Key Data Types

```typescript
interface NewsItem { id, title, description, url, source, publishedAt: Date, content }
interface NewsItemWithVector extends NewsItem { vector: number[] }
interface ScoredNewsItem extends NewsItem { score: number }
type RunResult = { status: 'ok', digest } | { status: 'already_running' } | { status: 'error', error }
interface RunState { isRunning, lastRun: RunRecord | null, latestDigest: string | null }
interface RunRecord { startedAt, finishedAt, durationMs, success, error? }
type PipelineRunner = () => Promise<string>
```

## Redis Keys

| Key | Value | TTL |
|-----|-------|-----|
| `article:{alias}` | JSON NewsItem | 7 days |
| `sent:{articleId}` | `'1'` | 30 days |
| `digest:latest` | digest string | none |
| `run:lastRun` | JSON RunRecord | none |

`articleAlias(id)` = SHA-256 of Inoreader ID, truncated to 12 hex chars.

## HTTP API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | no | status, isRunning, lastRun, nextRun |
| POST | `/digest/run` | bearer (if TRIGGER_TOKEN set) | trigger pipeline |
| GET | `/digest/latest` | no | last digest + lastRun |
| GET | `/openapi.json` | no | OpenAPI spec |
| GET | `/docs` | no | Scalar API Reference UI |

## Environment Variables

**Required:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `TOP_K`, `INOREADER_APP_ID`, `INOREADER_APP_SECRET`, `INOREADER_ACCESS_TOKEN`, `INOREADER_REFRESH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

**Optional (with defaults):** `PORT` (3000), `CRON_SCHEDULE` (0 8,12,15,18,22 * * *), `TZ` (Europe/Kyiv), `TRIGGER_TOKEN` (none), `REDIS_URL` (redis://localhost:6379), `INOREADER_FOLDERS` (AI), `FETCH_WINDOW_HOURS` (24), `FETCH_MAX_ARTICLES` (50), `DISCORD_WEBHOOK_URL` (none)

**Hardcoded:** embeddingModel = `voyage-3-lite`, summaryModel = `claude-sonnet-4-5`

## Concurrency Control

- `runOnce()` in-memory mutex prevents parallel pipeline runs
- node-cron `noOverlap: true` as secondary guard
- Telegram callbacks independent, don't block pipeline
- Redis ioredis handles connection pooling/retries

## Error Handling

- Startup: fail-fast on missing env vars (exit 1)
- Inoreader 401: auto-refresh token, retry
- Translation: `Promise.allSettled` per-item, fallback to original
- Telegram send: catch per item, continue with others
- Callbacks: try/catch with `safeAnswer()`, user-facing error messages
- Redis: catch + log, don't crash (graceful degradation)
- Discord webhook: rate-limited (20/min), deduped (60s window)
- Custom error classes per service: `InoreaderFetcherError`, `EmbedderError`, `SummarizerError`, etc.

## Graceful Shutdown

SIGTERM/SIGINT → stop telegram polling → stop scheduler → wait up to 30s for in-flight pipeline → close HTTP server (+ `closeAllConnections()` for keep-alive) → disconnect Redis → exit 0. Repeated signal forces exit.

## Design Decisions

- **Translate after search** — better retrieval on original language, cheaper (top-K only)
- **SHA-256 alias** — deterministic, survives restart, fits Telegram 64-byte callback_data limit
- **Native node:http** — only 5 routes, zero framework overhead
- **writingStyle.md read per request** — edit without restart
- **Generic `translate<T extends NewsItem>`** — preserves ScoredNewsItem type through pipeline
- **DI via closure** — `createPipelineRunner(deps)` returns runner fn, simple + testable

## Code Style

- TypeScript strict — no `any`
- `async/await` only
- Named exports only
- `interface` over `type` for object shapes
- Files under 150 lines
- Logging: `[Component] message` prefix
- All env vars through `src/config.ts`
- Output language: Ukrainian
