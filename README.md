# News Digest Bot

Automated daily news digest daemon: RSS → RAG filtering → Claude summary → Telegram delivery with interactive buttons.

Pulls articles from Inoreader, ranks them against a user-defined interest profile via [Voyage AI](https://voyageai.com) embeddings, translates the top picks to Ukrainian with Claude, and delivers them as individual Telegram messages with inline keyboards for deep analysis and post generation in the user's own writing style.

---

## What it does

1. **Fetch** — pulls recent articles from specified Inoreader folders (default: `AI`) via OAuth2 with auto token refresh
2. **Deduplicate** — filters out articles already sent in previous runs (Redis-backed, 30-day TTL)
3. **Embed** — vectorizes each article using `voyage-3-lite` (asymmetric embeddings: `document` type for articles, `query` type for user profile)
4. **Retrieve** — cosine similarity search against a static user interest profile, returns top K
5. **Translate** — Claude translates titles and descriptions to Ukrainian (JSON-structured output with regex fallback)
6. **Summarize** — Claude produces a Ukrainian news digest (8-10 bullet points)
7. **Persist** — stores top articles in Redis (7-day TTL) for later callback handling
8. **Deliver** — sends each article as a separate Telegram message with a 2-row inline keyboard

Each Telegram message includes buttons for:

| Button | Action |
|---|---|
| 🔍 Детальніше | Deep analysis via Claude (Що сталось / Чому важливо / Контекст / Наслідки) |
| 🌐 Читати | Direct URL to original article |
| ✍️ Створити пост | Generate a post in the user's personal writing style (reads `data/writingStyle.md` on each request) |
| 🗑 Видалити | Delete the message |

After all article cards, a summary message is sent with numbered clickable headlines of all delivered items.

---

## Features

- **Long-running daemon** — single Node.js process with HTTP server, cron scheduler, and Telegram long-polling bot
- **HTTP API** — health check, manual trigger, latest digest retrieval, OpenAPI 3.0 spec, Scalar UI docs
- **Redis persistence** — dedup flags, article store for callback resolution, last digest / last run record
- **Graceful shutdown** — SIGTERM/SIGINT handling, waits for in-flight pipeline up to 30s, force-exit on second signal
- **Discord error webhook** — all `console.error` calls and unhandled exceptions forwarded to Discord with rate limiting
- **Docker-ready** — multi-stage Alpine build, non-root user, `tini` for signal forwarding, compose stack with Redis + RedisInsight
- **Feed noise filtering** — strips timecode blocks, Reddit metadata, and other common RSS feed artifacts before sending
- **Multi-folder Inoreader support** — parallel fetch from multiple folders with deduplication by article ID
- **Auto token refresh** — Inoreader OAuth tokens refreshed on 401 and stored in-memory

---

## Architecture overview

```
                        ┌───────────────────┐
                        │    Daemon process │
                        │    (src/index.ts) │
                        └─────────┬─────────┘
                                  │ starts 3 subsystems
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
       ▼                          ▼                          ▼
┌──────────────┐           ┌─────────────┐          ┌──────────────────┐
│  Scheduler   │           │ HttpServer  │          │ TelegramDelivery │
│ (node-cron)  │           │ (node:http) │          │    (Telegraf)    │
└──────┬───────┘           └──────┬──────┘          └────────┬─────────┘
       │ tick                     │ POST /digest/run          │ callback_query
       ▼                          ▼                           ▼
┌─────────────────────────────────────────────────────┐   ┌──────────────────┐
│               runOnce(pipelineRunner)               │   │ CallbackHandler  │
│              (src/runState.ts — mutex)              │   │ deep / post / del│
└──────────────────────┬──────────────────────────────┘   └──────┬──────────┘
                       │                                         │
                       ▼                                         │
┌─────────────────────────────────────────────────────┐          │
│                   runPipeline(deps)                 │          │
│  fetch → dedup → embed → search → translate →       │          │
│           summarize → save → telegram → markSent    │          │
└──────────────────────┬──────────────────────────────┘          │
                       │                                         │
                       ▼                                         │
                ┌─────────────┐                                  │
                │ ArticleStore│◄─────────────────────────────────┘
                │  (Redis)    │     getByAlias(alias)
                └─────────────┘
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full deep dive: component responsibilities, lifecycle, mutex details, graceful shutdown, error handling philosophy, and trade-offs.

---

## Prerequisites

- **Docker + Docker Compose** (recommended path) — the `docker-compose.yml` spins up app, Redis, and RedisInsight together
- **OR** Node.js 20+ and Redis 5+ if running without Docker

You'll also need API credentials for:
- **Anthropic** — for Claude (summarizer, translator, analyzer, post generator)
- **Voyage AI** — for embeddings (free tier is 200M tokens, plenty for this use case)
- **Inoreader** — app ID/secret + OAuth access/refresh tokens (register at [inoreader.com/developers](https://www.inoreader.com/developers/))
- **Telegram Bot** — token from [@BotFather](https://t.me/BotFather) + your chat ID
- **Discord Webhook** — optional, for error reporting

---

## Quick start (Docker)

1. **Clone and enter the project:**
   ```bash
   git clone <repo-url>
   cd ai-rag-rss-reader
   ```

2. **Create `.env` from the template:**
   ```bash
   cp .env.example .env
   ```

3. **Fill in `.env`** — see [Environment variables](#environment-variables) below. At minimum you need `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `INOREADER_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

4. **Edit `data/writingStyle.md`** — describe your personal writing style and paste 2-3 sample posts you've written. Used by the "Створити пост" button.

5. **Build and start the full stack:**
   ```bash
   docker compose up -d --build
   ```

6. **Check logs:**
   ```bash
   docker compose logs -f app
   ```

   You should see:
   ```
   [Redis] connected
   [Index] Starting News Digest Bot daemon
   [TelegramDelivery] Bot started as @yourbot
   [Scheduler] Started with "0 8 * * *" (Europe/Kyiv). Next run: ...
   [Server] Listening on port 3000
   [Index] Daemon ready.
   ```

7. **Verify health:**
   ```bash
   curl http://localhost:3000/health
   ```

8. **Trigger a digest manually:**
   ```bash
   curl -X POST http://localhost:3000/digest/run
   ```

   Watch your Telegram chat for the news cards.

---

## Environment variables

Create `.env` from `.env.example` and fill in the required values.

### Required

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (`sk-ant-...`) |
| `VOYAGE_API_KEY` | Voyage AI key (`pa-...`) |
| `INOREADER_APP_ID` | Inoreader OAuth app ID |
| `INOREADER_APP_SECRET` | Inoreader OAuth app secret |
| `INOREADER_ACCESS_TOKEN` | Initial OAuth access token |
| `INOREADER_REFRESH_TOKEN` | OAuth refresh token (auto-rotated on 401) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Target chat ID (where digests go) |
| `TOP_K` | How many top articles to deliver (e.g. `5`) |

### Optional (with defaults)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `CRON_SCHEDULE` | `0 8 * * *` | Cron expression for scheduled pipeline |
| `TZ` | `Europe/Kyiv` | Timezone for cron and log timestamps |
| `TRIGGER_TOKEN` | — | Bearer token for `POST /digest/run`; if empty, auth is disabled |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL (auto-overridden to `redis://redis:6379` when running in Docker Compose) |
| `INOREADER_FOLDERS` | `AI` | Comma-separated list of Inoreader folders to fetch from |
| `FETCH_WINDOW_HOURS` | `24` | How many hours back to fetch articles |
| `FETCH_MAX_ARTICLES` | `50` | Max articles per folder per fetch |
| `DISCORD_WEBHOOK_URL` | — | Discord webhook URL for error reporting |

### Getting credentials

- **Telegram chat ID** — send any message to your bot, then run:
  ```bash
  curl "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
  ```

- **Inoreader OAuth** — follow the [Inoreader OAuth docs](https://www.inoreader.com/developers/oauth) to register an app and obtain initial access/refresh tokens. The daemon will auto-refresh the access token on 401.

- **Discord webhook** — in your Discord server: channel settings → Integrations → Webhooks → New Webhook → Copy URL

---

## Running without Docker (local dev)

If you prefer running the daemon directly via Node.js (for faster iteration):

1. **Start Redis in Docker (or install locally):**
   ```bash
   docker compose up -d redis redisinsight
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Dev mode (tsx, hot TypeScript without build):**
   ```bash
   npm run dev
   ```

4. **Production build + run:**
   ```bash
   npm run build && npm start
   ```

Logs go to stdout. `Ctrl+C` triggers graceful shutdown.

---

## Docker Compose commands

```bash
# Start everything (build image if needed)
docker compose up -d --build

# Start only infrastructure (Redis + RedisInsight) — useful for local dev
docker compose up -d redis redisinsight

# View app logs in real time
docker compose logs -f app

# View all service logs
docker compose logs -f

# Rebuild and restart just the app after code changes
docker compose up -d --build app

# Stop everything
docker compose down

# Stop everything AND delete volumes (Redis data, RedisInsight config)
docker compose down -v

# Run a one-off command inside the app container
docker compose exec app sh

# Inspect health status
docker compose ps
```

### Services exposed

| Service | Port | URL |
|---|---|---|
| App (HTTP API + docs) | 3000 | http://localhost:3000 |
| Redis | 6379 | `redis://localhost:6379` |
| RedisInsight UI | 5540 | http://localhost:5540 |

---

## HTTP API

All endpoints are documented via OpenAPI 3.0 at `/openapi.json` and rendered as an interactive Scalar UI at `/docs`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Current status, last run record, next scheduled run |
| `POST` | `/digest/run` | Manually trigger a pipeline run (respects mutex — returns 409 if already running) |
| `GET` | `/digest/latest` | Last generated digest text (in-memory, falls back to Redis on miss) |
| `GET` | `/openapi.json` | Raw OpenAPI 3.0 spec |
| `GET` | `/docs` | Interactive API reference (Scalar UI via CDN) |

### Auth

If `TRIGGER_TOKEN` is set in `.env`, `POST /digest/run` requires `Authorization: Bearer <token>`. All other endpoints are always open.

### Examples

```bash
# Health check
curl http://localhost:3000/health | jq

# Manual trigger (no auth)
curl -X POST http://localhost:3000/digest/run

# Manual trigger with auth
curl -X POST http://localhost:3000/digest/run \
  -H "Authorization: Bearer your-trigger-token"

# Get last digest
curl http://localhost:3000/digest/latest | jq '.digest'

# Open API docs
open http://localhost:3000/docs
```

---

## Telegram interaction

After a pipeline run, you receive one Telegram message per top article, followed by a summary message listing all headlines.

### Article card format

```
🗞 Title

Short description (translated to Ukrainian).

📌 Source · 2 год тому

[🔍 Детальніше] [🌐 Читати]
[✍️ Створити пост] [🗑 Видалити]
```

### Button actions

- **🔍 Детальніше** — Claude generates a 4-section analysis (Що сталось / Чому це важливо / Контекст / Наслідки) and replies in the same chat. The reply also has `[✍️ Створити пост]` and `[🗑 Видалити]` buttons.

- **🌐 Читати** — opens the original article URL in Telegram's in-app browser.

- **✍️ Створити пост** — Claude generates a post in your personal style, based on `data/writingStyle.md`. The reply has a `[🗑 Видалити]` button.

- **🗑 Видалити** — deletes the message from the chat (works up to 48 hours after sending).

### Headlines summary message

After all article cards, a final message is sent:

```
📰 Усі новини сьогодні (5):

1. Clickable headline of article 1
2. Clickable headline of article 2
...
```

Each title is a clickable link to the original article.

---

## Personal writing style

`data/writingStyle.md` is read fresh on every "Створити пост" callback — edit it without restarting the daemon.

For best results:
1. Describe your tone and approach in the "Тон та манера" section
2. Paste 2-3 real posts you've written in the "Приклади моїх постів" section
3. Adjust format rules in "Правила формату"

The more concrete the samples, the closer Claude's output will match your voice.

---

## Project structure

```
src/
├── config.ts                   # env validation, typed AppConfig
├── index.ts                    # daemon entry point
├── pipeline.ts                 # orchestrator: fetch → dedup → embed → search → translate → summarize → deliver
├── runState.ts                 # mutex + last run record + latest digest (Redis-backed)
├── scheduler.ts                # node-cron wrapper with runner injection
├── server.ts                   # native node:http server (5 routes)
├── docs.ts                     # OpenAPI 3.0 spec + Scalar HTML
│
├── models/
│   └── NewsItem.ts             # NewsItem, NewsItemWithVector, ScoredNewsItem interfaces
│
├── ingestion/
│   ├── inoreaderFetcher.ts     # Inoreader OAuth client with auto-refresh, folder filtering, feed noise cleanup
│   ├── mockFetcher.ts          # reads data/mockNews.json (fallback for offline dev)
│   └── embedder.ts             # Voyage AI batch embeddings (document / query types)
│
├── retrieval/
│   ├── userProfile.ts          # static interest profile + embedding helper
│   └── searcher.ts             # cosine similarity, returns top K
│
├── generation/
│   ├── summarizer.ts           # Claude → Ukrainian 8-10 bullet digest
│   ├── articleTranslator.ts    # Claude → translate title+description to Ukrainian
│   ├── articleAnalyzer.ts      # Claude → 4-section deep analysis
│   └── postGenerator.ts        # Claude → personal-style post from writingStyle.md
│
├── store/
│   ├── redisClient.ts          # ioredis singleton with lazy connect + error handler
│   └── articleStore.ts         # Redis-backed store: save, getByAlias, isAlreadySent, markAsSent
│
├── delivery/
│   ├── telegram.ts             # Telegraf v4 bot, sendDigest with 2-row keyboard, headlines summary
│   └── callbackHandler.ts      # routes deep/post/del callbacks, attaches reply keyboards
│
└── observability/
    └── errorReporter.ts        # console.error override + unhandled rejection hooks → Discord webhook

data/
├── mockNews.json               # mock articles for offline dev
└── writingStyle.md             # user's writing style description (edit without restart)

Dockerfile                      # multi-stage Alpine build, non-root, tini
docker-compose.yml              # app + redis + redisinsight stack
ARCHITECTURE.md                 # detailed architecture deep dive
CLAUDE.md                       # project rules and progress log
.env.example                    # env var template
```

---

## Development

### Running tests

No tests yet. Manual verification through:
- `npm run build` — TypeScript strict type check
- `curl -X POST http://localhost:3000/digest/run` — end-to-end pipeline test
- Docker Compose logs for runtime errors
- Discord webhook channel for errors surfaced in real time

### Adding a new pipeline step

1. Create a new service in `src/generation/` or `src/retrieval/` (whatever fits)
2. Instantiate it inside `runPipeline()` in `src/pipeline.ts`
3. Log with `[Pipeline] Step N (name) done in Xs`
4. Pass typed data to the next step

### Adding a new HTTP endpoint

1. Add route handling in `src/server.ts` → `handle()` method
2. Write a new `handleXxx()` method
3. Document in `src/docs.ts` → `openApiSpec.paths`
4. Add response schema to `openApiSpec.components.schemas` if new types are introduced

### Adding a new Telegram button / callback action

1. Add the button in `src/delivery/telegram.ts` → `sendItem()` inline keyboard
2. Add a route in `src/delivery/callbackHandler.ts` → `handle()` method
3. Write a `handleXxx()` method that calls the appropriate service
4. Attach a reply keyboard factory if the result needs follow-up buttons

---

## Tech stack

- **Runtime** — Node.js 20+ with TypeScript strict mode, ESM modules
- **AI** — [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) (Claude Sonnet 4.5), [`voyageai`](https://www.npmjs.com/package/voyageai) (voyage-3-lite embeddings)
- **Storage** — [`ioredis`](https://github.com/redis/ioredis) v5 (Redis-backed dedup + article store + state persistence)
- **Telegram** — [`telegraf`](https://github.com/telegraf/telegraf) v4 (long polling, inline keyboards, callback queries)
- **Scheduler** — [`node-cron`](https://github.com/node-cron/node-cron) v4 (timezone-aware, built-in noOverlap)
- **HTTP server** — native `node:http` (no framework, 5 routes hand-routed)
- **Config** — [`dotenv`](https://github.com/motdotla/dotenv) + `src/config.ts` fail-fast validation
- **API docs** — OpenAPI 3.0.3 + [Scalar API Reference](https://github.com/scalar/scalar) via CDN (zero npm deps for UI)
- **Container** — multi-stage `node:20-alpine` build with `tini` as PID 1

---

## License

MIT (or whatever — pick your own)
