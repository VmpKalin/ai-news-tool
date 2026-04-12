# Архітектура News Digest Bot

Документ описує, як побудований проект, які є компоненти, як між ними ходять дані, і що саме відбувається від запуску daemon'а до отримання поста в Telegram.

---

## 1. Що це таке

Довгоживучий daemon на Node.js + TypeScript, який:

1. Раз на день (за крон-розкладом) тягне свіжі новини з Inoreader
2. Векторизує їх через Voyage AI embeddings
3. Шукає найрелевантніші для користувача через косинусну схожість з профілем інтересів
4. Перекладає top-K українською через Claude
5. Генерує короткий дайджест українською через Claude
6. Шле кожну новину окремим повідомленням у Telegram з інтерактивними кнопками
7. Обробляє callback'и від кнопок: глибокий аналіз, генерація поста у стилі користувача, видалення

Поряд з цим piece крутиться HTTP сервер з health/docs/manual-trigger endpoint'ами і Telegraf бот, який слухає callback_query.

---

## 2. Високорівнева діаграма

```
                            ┌───────────────────┐
                            │    Daemon process │
                            │    (src/index.ts) │
                            └─────────┬─────────┘
                                      │ запускає 3 підсистеми
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
   ┌──────────────┐            ┌─────────────┐             ┌──────────────┐
   │  Scheduler   │            │ HttpServer  │             │  TelegramDelivery│
   │ (node-cron)  │            │ (node:http) │             │   (Telegraf)    │
   └──────┬───────┘            └──────┬──────┘             └────────┬────────┘
          │ tick                      │ POST /digest/run            │ callback_query
          ▼                           ▼                             ▼
   ┌─────────────────────────────────────────────────────────┐     ┌──────────────────┐
   │              runOnce(pipelineRunner)                    │     │ CallbackHandler  │
   │              (src/runState.ts — мutex)                  │     │ deep / post / del│
   └──────────────────────┬──────────────────────────────────┘     └──────┬──────────┘
                          │                                               │
                          ▼                                               │
   ┌─────────────────────────────────────────────────────────┐             │
   │                    runPipeline(deps)                    │             │
   │  fetch → embed → search → translate → summarize → save  │             │
   │         → telegram.sendDigest                           │             │
   └──────────────────────┬──────────────────────────────────┘             │
                          │                                               │
                          ▼                                               │
                   ┌─────────────┐                                        │
                   │ArticleStore │◄───────────────────────────────────────┘
                   │(in-memory)  │       getByAlias(id)
                   └─────────────┘
```

Три підсистеми (Scheduler, HttpServer, TelegramDelivery) працюють незалежно. Pipeline виконується через спільний mutex (`runState.runOnce`), тому крон і HTTP не зіштовхуються. CallbackHandler читає зі `ArticleStore` незалежно від pipeline.

---

## 3. Структура файлів

```
src/
├── config.ts                      # env-змінні, fail-fast валідація, typed AppConfig
├── index.ts                       # entry point: стартує всі підсистеми, graceful shutdown
├── pipeline.ts                    # оркестратор усіх кроків обробки новин
├── runState.ts                    # in-memory mutex + lastRun + latestDigest
├── scheduler.ts                   # обгортка над node-cron
├── server.ts                      # HTTP API (native node:http)
├── docs.ts                        # OpenAPI spec + Scalar HTML
│
├── models/
│   └── NewsItem.ts                # інтерфейси: NewsItem, NewsItemWithVector, ScoredNewsItem
│
├── ingestion/
│   ├── inoreaderFetcher.ts        # реальний Inoreader клієнт з auto-refresh токена
│   ├── mockFetcher.ts             # читає data/mockNews.json (fallback, не в pipeline)
│   └── embedder.ts                # Voyage AI embeddings, batch, document/query input_type
│
├── retrieval/
│   ├── userProfile.ts             # hardcoded текст інтересів + embedQuery helper
│   └── searcher.ts                # cosine similarity, повертає top-K
│
├── generation/
│   ├── summarizer.ts              # Claude → загальний дайджест українською
│   ├── articleTranslator.ts       # Claude → перекладає title+description на UK
│   ├── articleAnalyzer.ts         # Claude → 4-секційний глибокий аналіз статті
│   └── postGenerator.ts           # Claude → пост у стилі користувача з writingStyle.md
│
├── store/
│   └── articleStore.ts            # Map<alias, NewsItem>, SHA-256 truncated alias
│
└── delivery/
    ├── telegram.ts                # Telegraf v4 бот, sendDigest, 2-row keyboard
    └── callbackHandler.ts         # routes deep / post / del, attaches reply keyboards

data/
├── mockNews.json                  # 10+ мок-новин для офлайн розробки
└── writingStyle.md                # опис стилю користувача для PostGenerator

docs/ (нема — документація в корені)

ARCHITECTURE.md                    # цей файл
CLAUDE.md                          # правила проекту + progress log
.env.example                       # шаблон усіх env-змінних
package.json
tsconfig.json
```

---

## 4. Життєвий цикл daemon'а

### 4.1 Запуск (`src/index.ts → main()`)

1. **Валідація конфігу** — `import { config }` виконує `config.ts`, який викликає `requireEnv` для кожного обов'язкового поля. Якщо щось відсутнє — процес падає з помилкою ДО того, як щось стартує.
2. **Інстанціація сервісів:**
   - `ArticleStore` — порожня Map
   - `ArticleAnalyzer` — Claude client для глибокого аналізу
   - `PostGenerator` — Claude client для постів у стилі користувача
   - `CallbackHandler` — тримає посилання на store, analyzer, postGenerator
   - `TelegramDelivery` — Telegraf бот, реєструє `CallbackHandler.register(bot)` на `callback_query`
   - `runner = createPipelineRunner({ store, telegram })` — closure, яка при виклику запускає `runPipeline(deps)`
   - `Scheduler` — отримує runner у конструкторі
   - `HttpServer` — отримує runner і scheduler в options
3. **Старт підсистем (послідовно):**
   - `await telegram.launch()` — запускає long polling, перевіряє через `getMe()` що бот валідний
   - `scheduler.start()` — реєструє cron task (node-cron сам тримає таймер)
   - `await server.start()` — слухає порт
4. **Реєстрація signal handlers** — `SIGTERM` і `SIGINT` через `process.once` (один раз через `shutdown()`, повторні ^C через `process.on` роблять force-exit).
5. **Daemon готовий** — процес чекає event'ів: крон-тіків, HTTP запитів, callback_query.

### 4.2 Робота (event-driven)

Між запуском і shutdown daemon не робить нічого "сам по собі". Все — реакція на:

- **Cron tick** → `Scheduler` викликає `runOnce(runner)`
- **HTTP `POST /digest/run`** → `HttpServer` викликає `runOnce(this.options.runner)`
- **Telegram callback_query** → `CallbackHandler.handle(ctx)` розгалужує за `data`

### 4.3 Shutdown

Принцип: нічого не втратити, нічого не залишити висіти.

```
SIGTERM/SIGINT (перший раз)
    ↓
telegram.stop(signal)          ← зупиняє long polling бота
    ↓
scheduler.stop()               ← task.stop() + task.destroy()
    ↓
while (runState.isRunning)     ← чекає, поки поточний pipeline добіжить
    ↓  (до 30 секунд)
server.stop()                  ← close() + closeAllConnections() щоб
    ↓                            примусово розірвати keep-alive сокети
process.exit(0)

SIGINT другий раз → process.exit(130)  ← force-exit, якщо застряг
```

`closeAllConnections()` критичний: без нього `server.close()` зависає, якщо хтось тримає keep-alive з'єднання (напр. відкритий `/docs` у браузері).

---

## 5. Pipeline (покроково)

`src/pipeline.ts → runPipeline(deps: { store, telegram })`

```
Step 1: fetch           InoreaderFetcher.fetch()
                        └→ GET /stream/contents/... з Bearer токеном
                        └→ 401? → POST /oauth2/token → retry
                        └→ map JSON → NewsItem[] (strip HTML)

Step 2: embed (news)    Embedder.embedItems(items)
                        └→ POST voyage-3-lite embeddings, input_type=document
                        └→ NewsItem[] → NewsItemWithVector[]

Step 3: embed (profile) getUserProfileEmbedding(embedder)
                        └→ embedder.embedQuery(USER_PROFILE_TEXT)
                        └→ input_type=query (асиметричні ембединги Voyage)
                        └→ number[]

Step 4: search          Searcher.search(vectorized, profileVec)
                        └→ для кожного item рахує cosine similarity
                        └→ сортує спадно, повертає top-K (default K=5)
                        └→ ScoredNewsItem[]

Step 5: translate       ArticleTranslator.translateBatch(topItems)
                        └→ Promise.allSettled — 5 паралельних Claude викликів
                        └→ кожен: Claude повертає JSON {title, description}
                        └→ якщо item fail'нув → fallback на оригінал
                        └→ ScoredNewsItem[] (зі збереженим score завдяки generic)

Step 6: summarize       Summarizer.summarize(translated)
                        └→ Claude з system prompt "ведучий дайджесту українською"
                        └→ повертає готовий маркований список 8-10 bullets

Step 7: deliver         store.save(translated)
                        └→ Map<alias, NewsItem>, alias = SHA-256(id).slice(0,12)

                        telegram.sendDigest(translated)
                        └→ для кожного item: bot.telegram.sendMessage з клавіатурою
                        └→ 2 рядки: [Детальніше][Читати] / [Створити пост][Видалити]

return digest           ← pipeline повертає рядок summary
```

**Чому переклад після searcher, а не до:**
Embedding якість на оригінальній мові (переважно англ) краща, ніж на перекладі. User profile hardcoded теж англ. Якщо перекладати до embedder, то:
- втрачається семантика (кальки, неточності перекладу)
- асиметрія з user profile погіршує retrieval
- марно переклали б N items, а використаємо тільки top-K

Переклад після searcher → перекладаємо тільки top-K (5), що дешевше і точніше.

**Чому generic `translate<T extends NewsItem>`:**
`ScoredNewsItem` extends `NewsItem` з додатковим полем `score`. Без generic'а TS втрачає тип після translate і summarizer не може прийняти результат. Generic гарантує: якщо зайшло `ScoredNewsItem[]` — вийшло `ScoredNewsItem[]` зі всіма полями.

---

## 6. Telegram інтерактивність

### 6.1 Формат повідомлення (кожна новина)

```
🗞 *Заголовок*

Опис статті, 1-2 речення.

📌 Джерело · 2 год тому

[🔍 Детальніше]    [🌐 Читати]
[✍️ Створити пост] [🗑 Видалити]
```

Parsing: `parse_mode: 'Markdown'`. Спецсимволи (`_*\`[`) екрануються через `escapeMd()`.
Time ago: спрощені UA скорочення (`хв` / `год` / `дн`), без повного відмінювання.
Link preview: вимкнено (`link_preview_options.is_disabled: true`) щоб не дублювати URL з кнопки.

### 6.2 Callback routing

Telegraf шле `bot.on('callback_query', ...)` → `CallbackHandler.handle(ctx)`:

```
callback.data
    │
    ├── "del"              → handleDelete()
    │                         └→ ctx.deleteMessage() + answerCbQuery()
    │
    ├── "deep:a1b2c3d4..."  → handleDeep(alias)
    │                         └→ store.getByAlias(alias) → article
    │                         └→ answerCbQuery("⏳ Готую аналіз...")
    │                         └→ analyzer.analyze(article) → Claude 4-секційний аналіз
    │                         └→ ctx.reply(analysis, {
    │                               parse_mode: 'Markdown',
    │                               reply_markup: [[Створити пост][Видалити]]
    │                            })
    │
    └── "post:a1b2c3d4..."  → handlePost(alias)
                              └→ store.getByAlias(alias) → article
                              └→ answerCbQuery("✍️ Пишу пост у твоєму стилі...")
                              └→ postGenerator.generate(article)
                                 ├→ loadStyle() — читає data/writingStyle.md на кожен запит
                                 └→ Claude з system prompt що містить стиль
                              └→ ctx.reply(post, {
                                    reply_markup: [[Видалити]]
                                 })
```

### 6.3 Article alias

**Проблема:** Inoreader ID має формат `tag:google.com,2005:reader/item/00000005add63c0c` — це 50+ chars. Разом з префіксом `deep:` вилазить за 64-байтний ліміт Telegram callback_data.

**Рішення:** `articleAlias(id)` в `articleStore.ts` — SHA-256 від повного ID, truncated до 12 hex-символів. `deep:a1b2c3d4e5f6` = 17 байт. Детермінований, тому той самий item.id дає той самий alias навіть після рестарту (доки store живий).

**Що стається зі старими кнопками після рестарту процесу:**
- `del` працює (не потребує store)
- `deep:...` і `post:...` → `getByAlias` повертає `null` → callback відповідає "⚠️ Стаття більше недоступна"

---

## 7. HTTP API

Native `node:http` server, якісь if/else routing без framework'ів.

| Метод | Path             | Опис                                     |
|-------|------------------|------------------------------------------|
| GET   | `/health`        | Статус daemon'а, lastRun, nextRun        |
| POST  | `/digest/run`    | Мануально тригернути pipeline            |
| GET   | `/digest/latest` | Останній згенерований дайджест (рядок)   |
| GET   | `/openapi.json`  | OpenAPI 3.0.3 spec                       |
| GET   | `/docs`          | Scalar API Reference UI (HTML з CDN)     |

### 7.1 `POST /digest/run` — детально

```
HTTP request
    ↓
checkAuth(req)           ← якщо TRIGGER_TOKEN set, вимагає Authorization: Bearer
    ↓
runOnce(this.options.runner)   ← mutex з runState.ts
    ↓
    ├── isRunning? → 409 { error: "already_running" }
    └── не running → запускає runner(), чекає
            ↓
            └── ok → 202 { status: "ok", digest: "..." }
            └── error → 500 { error: "pipeline_failed", message: "..." }
```

### 7.2 Auth

Опціональний bearer token. Якщо `TRIGGER_TOKEN=` порожній в `.env` → auth відключений (для localhost/dev). Якщо заданий → `Authorization: Bearer <token>` обов'язковий на `POST /digest/run`. Інші endpoint'и (`/health`, `/docs`) завжди відкриті.

### 7.3 Документація

- **`GET /openapi.json`** — віддає `openApiSpec` object з `src/docs.ts` як JSON
- **`GET /docs`** — віддає HTML сторінку з `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">` який підтягує `/openapi.json` і рендерить UI

Нуль npm залежностей для UI. Працює тільки при наявності інтернет на клієнті (CDN).

---

## 8. Конфігурація

Усе йде через `src/config.ts` → typed `AppConfig` object. Валідація на старті, fail-fast.

### 8.1 Обов'язкові змінні

| Змінна                    | Для чого                                   |
|---------------------------|--------------------------------------------|
| `ANTHROPIC_API_KEY`       | Claude API (summarize, translate, analyze, post) |
| `VOYAGE_API_KEY`          | Voyage AI embeddings                       |
| `INOREADER_APP_ID`        | OAuth client id                            |
| `INOREADER_APP_SECRET`    | OAuth client secret                        |
| `INOREADER_ACCESS_TOKEN`  | Початковий токен (auto-refresh в пам'яті) |
| `INOREADER_REFRESH_TOKEN` | Refresh токен                              |
| `TELEGRAM_BOT_TOKEN`      | Токен бота від @BotFather                  |
| `TELEGRAM_CHAT_ID`        | Куди слати дайджест (число або @channel)   |
| `TOP_K`                   | Скільки топ-новин брати (типово 5)         |

### 8.2 Опціональні з fallback

| Змінна           | Default           | Опис                          |
|------------------|-------------------|-------------------------------|
| `PORT`           | `3000`            | HTTP сервер                   |
| `CRON_SCHEDULE`  | `0 8 * * *`       | Щодня о 08:00                 |
| `TZ`             | `Europe/Kyiv`     | Часовий пояс крону            |
| `TRIGGER_TOKEN`  | — (null)          | Якщо заданий — вмикає auth    |

### 8.3 Жорстко прошиті

| Поле              | Значення                |
|-------------------|-------------------------|
| `embeddingModel`  | `voyage-3-lite`         |
| `summaryModel`    | `claude-sonnet-4-5`     |

---

## 9. State і persistence

**Короткий варіант: усе в пам'яті. Нічого не персистимо на диск.**

| Що                  | Де                          | Що з цим при рестарті           |
|---------------------|-----------------------------|---------------------------------|
| `ArticleStore`      | `Map<alias, NewsItem>`      | Втрачається → старі кнопки deep/post не працюють |
| `runState`          | module-level змінні         | Втрачається → lastRun = null     |
| `latestDigest`      | module-level змінна         | Втрачається → 404 на /digest/latest |
| Inoreader токени    | `InoreaderFetcher.accessToken` | Втрачається → наступний запит падає 401, робить refresh з env токенів |
| `writingStyle.md`   | Файл                        | Зберігається, читається на кожен `post:` callback |
| `mockNews.json`     | Файл                        | Зберігається (не використовується в pipeline) |

**Наслідки:**
- Рестарт процесу = "все заново". Кнопки на старих Telegram-повідомленнях стають частково неробочими (крім `del`).
- Якщо Inoreader повертає новий refresh_token після використання старого (OAuth specs дозволяють), після рестарту daemon буде йти зі старими env токенами і при наступному 401 знову оновлювати.
- Якщо потрібен persistence — додати SQLite або JSON-file store у `articleStore.ts` (~30 рядків) і окремо для runState. Поки YAGNI.

---

## 10. Mutex (`runState.ts`)

Критична частина: крон і HTTP manual trigger обидва хочуть запускати pipeline. Паралельний запуск = подвійні API виклики, подвійні повідомлення в Telegram, race condition на store.

```typescript
// runState.ts (спрощено)
let isRunning = false;

export async function runOnce(runner: () => Promise<string>): Promise<RunResult> {
  if (isRunning) return { status: 'already_running' };
  isRunning = true;
  try {
    const digest = await runner();
    latestDigest = digest;
    return { status: 'ok', digest };
  } catch (error) {
    return { status: 'error', error: String(error) };
  } finally {
    isRunning = false;
  }
}
```

І крон, і HTTP викликають `runOnce(runner)`. Якщо запускається повторно — отримують `already_running`, не запускають нічого.

`node-cron` v4 сам підтримує `noOverlap: true`, але це захищає тільки від самого себе (якщо попередній cron tick ще крутиться). `runOnce` — ширша гарантія через обидва entry point'и.

---

## 11. Graceful shutdown (детально)

Мета: при SIGTERM/SIGINT не зламати поточний pipeline, не втратити з'єднань, не залишити підвисаючих handle'ів.

```typescript
const shutdown = async (signal: string) => {
  if (shuttingDown) process.exit(130);   // другий ^C — force
  shuttingDown = true;

  telegram.stop(signal);                  // 1. зупинити бота (long polling)
  await scheduler.stop();                 // 2. зупинити крон

  const waitStart = Date.now();
  while (getState().isRunning) {          // 3. чекати поточний pipeline
    if (Date.now() - waitStart > 30_000) {
      console.warn('[Index] Timeout — forcing exit');
      break;
    }
    await sleep(1000);
  }

  await server.stop();                    // 4. закрити HTTP (з closeAllConnections)
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shuttingDown && process.exit(130));   // повторні → force
process.on('SIGTERM', () => shuttingDown && process.exit(143));
```

**Чому `process.once` + `process.on` одночасно:** `once` гарантує, що shutdown виконається тільки один раз. Додатковий `on` ловить повторні сигнали і робить force-exit якщо daemon застряг на pipeline > 30 сек.

**Чому `server.closeAllConnections()`:** `close()` сам по собі чекає поки всі keep-alive з'єднання завершаться природно. Якщо `/docs` був відкритий у браузері, це може тривати нескінченно. `closeAllConnections()` примусово розриває їх, і `close()` резолвиться одразу.

---

## 12. Обробка помилок

**Принцип:** жодна помилка не має крашити daemon. Все ловиться, логується з контекстом, і або перетворюється на user-friendly повідомлення, або повертає fallback.

### 12.1 Типізовані custom errors

Кожен сервіс визначає свій error type:
- `InoreaderFetcherError`
- `EmbedderError`
- `SummarizerError`
- `ArticleTranslatorError`
- `ArticleAnalyzerError`
- `PostGeneratorError`
- `TelegramDeliveryError`
- `MockFetcherError`

Усі extends `Error` зі `name` і опціональним `cause`. Дозволяють в catch блоках розрізняти "моя помилка vs unknown".

### 12.2 Graceful degradation у pipeline

- `translator.translateBatch` — `Promise.allSettled`, item-level fallback на оригінал при fail
- `telegram.sendDigest` — catch всередині циклу, якщо один item не відправився — решта все одно йдуть
- `pipeline.ts` зовнішній try/catch — логує `[Pipeline] Failed after Xs` і кидає далі в runOnce
- `runOnce` ловить все, записує у `lastRun.error`, повертає `{ status: 'error' }`

### 12.3 Callback handler

- `handle()` обгорнутий у try/catch → `safeAnswer(ctx, '⚠️ Помилка обробки')`
- `handleDeep` і `handlePost` окремо ловлять помилки Claude → відповідають "⚠️ Не вдалося згенерувати..."
- `safeAnswer` ловить помилки `answerCbQuery` (Telegram може відхилити старий callback) щоб вони не каскадили

### 12.4 Startup

- `config.ts` валідація → fail fast, `process.exit(1)` до запуску підсистем
- `telegram.launch()` падіння → `main().catch` → `process.exit(1)`
- `server.start()` падіння → те саме

Принцип: якщо щось обов'язкове зламалось на старті — падай голосно, не треба крутитись як zombie.

---

## 13. Key decisions and trade-offs

| Рішення                                 | Альтернатива                   | Чому так                                               |
|-----------------------------------------|--------------------------------|--------------------------------------------------------|
| DI через closure (`createPipelineRunner`) | Class `Pipeline` з конструктором | Простіше, менше boilerplate, TS добре виводить типи    |
| Native `node:http`                      | Express / Fastify              | 5 endpoint'ів не виправдовують framework               |
| Scalar через CDN                        | Swagger UI self-hosted         | Нуль npm залежностей, сучасніший UI                    |
| SHA-256 alias                           | Індексовані aliases            | Детермінований, виживає рестарт store                  |
| Translate після searcher                 | Перекладати до embedder        | Економія токенів + краща якість retrieval              |
| In-memory store                         | SQLite/JSON file               | YAGNI для поточного use case                          |
| `noOverlap` + `runOnce` разом            | Тільки одне з них              | Belt-and-suspenders: noOverlap для cron, runOnce для обидвох entry points |
| Markdown parse_mode                     | HTML / MarkdownV2              | Простіше escaping, спеці хочу візуально бачити `*bold*` |
| `writingStyle.md` читається на кожен запит | Load once at startup         | User може ітерувати стиль без рестарту daemon'а         |

---

## 14. Як додати нову функціональність

### 14.1 Новий тип callback (напр. "закладка")

1. У `telegram.ts` — додати кнопку в клавіатуру з `callback_data: 'bookmark:${alias}'`
2. У `callbackHandler.ts` — додати гілку в `handle()` для `BOOKMARK_PREFIX`, написати `handleBookmark()`
3. Якщо закладка персистентна — додати новий store (напр. `BookmarkStore`) або розширити `ArticleStore`
4. Якщо потрібна нова залежність — інжектити через конструктор `CallbackHandler` → зробити update в `index.ts`

### 14.2 Новий HTTP endpoint

1. У `server.ts` → `handle()` — додати `if (method === 'GET' && path === '/something')`
2. Написати `handleSomething()` метод
3. Додати опис в `docs.ts` → `openApiSpec.paths`
4. Якщо потрібен новий respons type — додати схему в `openApiSpec.components.schemas`

### 14.3 Новий крок у pipeline

1. Написати сервіс (`src/generation/newService.ts` чи куди підходить)
2. У `pipeline.ts` — інстанціювати всередині `runPipeline()`, додати `stepNStart` + log
3. Передавати результат у наступний крок типобезпечно
4. Якщо сервіс тримає стан між run'ами (рідко треба) — підняти в `index.ts` і передавати через `PipelineDeps`

### 14.4 Нова env-змінна

1. У `config.ts` — додати поле в `AppConfig` і в `config` об'єкт через `requireEnv` або `optionalEnv`
2. У `.env.example` — додати з коментарем
3. Використовувати `config.newField` там де треба

---

## 15. Корисні команди

```bash
# Dev (tsx, без build step)
npm run dev

# Production build + run
npm run build && npm start

# Перевірка типів
npm run build   # tsc strict

# Мануально тригернути pipeline (без auth)
curl -X POST http://localhost:3000/digest/run

# Мануально з auth
curl -X POST http://localhost:3000/digest/run \
  -H "Authorization: Bearer <TRIGGER_TOKEN>"

# Подивитись стан
curl http://localhost:3000/health | jq

# Відкрити Swagger-подібний UI
open http://localhost:3000/docs
```

---

## 16. TL;DR

- Daemon запускає 3 підсистеми: cron scheduler, HTTP сервер, Telegram бот
- Pipeline: Inoreader → Voyage embeddings → cosine search → Claude translate → Claude summarize → save + Telegram send
- Кожна новина в Telegram = окреме повідомлення з 4 кнопками в 2 рядах
- CallbackHandler обробляє `deep`, `post`, `del` — кожен з них або викликає Claude, або маніпулює повідомленням
- Усе in-memory, нема БД
- Mutex через `runState.runOnce` гарантує, що cron і HTTP trigger не зіштовхнуться
- Graceful shutdown чекає поточний pipeline до 30 сек, повторний ^C робить force-exit
- Конфігурація через `.env`, fail-fast валідація на старті
- 0 npm залежностей для HTTP сервера і API docs, telegraf для бота, node-cron для розкладу
