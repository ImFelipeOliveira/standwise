# Landing, Beta Requests and Docs for Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public landing at standwise.usefachada.dev whose beta form stores requests, emails support through Resend and redirects to the install guide, and make the landing and the docs easy for AI agents to read.

**Architecture:** The landing is static files in `apps/landing/public`, served by a Cloudflare Worker. Its form posts to a thin `POST /beta` route in the API. That route calls the `submitBetaRequest` use case, which upserts a `beta_requests` row and enqueues a worker job. The job sends the email through a small Resend adapter. The docs site gains `llms.txt`, `llms-full.txt` and per-page markdown through `vitepress-plugin-llms`.

**Tech Stack:** Bun 1.4.4, TypeScript, Hono, Drizzle/Postgres, pg-boss, VitePress 1.6.4, Cloudflare Workers static assets.

**Spec:** `docs/superpowers/specs/2026-11-01-landing-and-beta-design.md`. The approved visual is the HTML at https://claude.ai/artifact/MGfAqeBiDDqUgzRhBq9dND. The controller saves a copy to `apps/landing/design/approved.html` before Task 6. It is reference only and is deleted at the end of Task 6.

## Global Constraints

- No comments in any code file: TS, TSX, CSS, HTML, JS, shell, YAML, JSONC.
- Commits, identifiers and engineering docs in English. User copy in en and pt-BR.
- Business rules live in use cases and throw `DomainError(code, message)`. Routes and jobs stay thin.
- Every outbound HTTP call uses `AbortSignal.timeout`. The Resend timeout is `10_000` ms.
- Never log a beta request's name or email. Log only through `logError(label, error, extra)`.
- A package imports only what its own `package.json` declares (`bun run check-deps`).
- `queue.enqueue` and `queue.work` for `notify-beta-request` both use the `plain` policy.
- The landing has no inline `<script>` bodies and no `style=` attributes. Scripts are `/app.js` only.
- URLs: API `https://api-standwise.usefachada.dev`, docs `https://docs-standwise.usefachada.dev`, landing `https://standwise.usefachada.dev`.
- Every task ends green on `bun test`, `bun run lint`, `bun run typecheck` and `bun run check-deps`.

## Review Focus

1. The same email submitted twice in a row creates one row and one email, and both submissions still land on the install guide (Task 3 test `duplicate within 24h`).
2. A worker retry after Resend succeeded but before `notified_at` was written must not send twice in normal operation. The CAS on `notified_at` stops a second send once the first has been marked (Task 4 test `already notified`).
3. Uppercase or padded emails (`" Ana@Example.COM "`) dedupe with `ana@example.com` (Task 2 test `normalizes email`).
4. A form posted with a missing or unknown enum value redirects to the landing's `#beta-invalid` anchor in the right language and never returns a JSON 422 page to a browser (Task 5 test `invalid pt-BR`).
5. The landing still works with JavaScript off. The form submits, and every section is visible with no `opacity:0` at rest (Task 6 test `no hidden-at-rest content`).

---

### Task 1: Docs for agents (llms.txt)

**Files:**
- Modify: `package.json` (root devDependency `vitepress-plugin-llms` pinned to `1.14.0`)
- Modify: `docs/site/.vitepress/config.mts`
- Modify: `docs/site/index.md` and `docs/site/pt-BR/index.md` (a short "For AI agents" section linking the files of that language)
- Modify: `apps/api/src/routes/docs.ts` (`GET /llms.txt` on the API host)
- Create: `llms.txt` at the repository root
- Test: `scripts/docs-llms.test.ts`, `apps/api/test/llms.test.ts`

**Interfaces:**
- Produces:
  - **Docs site, both languages:**
    - en: `/llms.txt`, `/llms-full.txt` and `/<page>.md` for every page;
    - pt-BR: `/pt-BR/llms.txt`, `/pt-BR/llms-full.txt` and `/pt-BR/<page>.md`;
    - the root `/llms.txt` lists the pt-BR index under an "Optional" section.
  - **API host:** `GET https://api-standwise.usefachada.dev/llms.txt` answers `text/plain; charset=utf-8`. It links:
    - `/openapi.json`;
    - `/reference`;
    - `${DOCS_URL}/llms.txt` and `${DOCS_URL}/llms-full.txt`;
    - `${DOCS_URL}/api/overview.md` and `${DOCS_URL}/api/webhooks.md`.

    It says the public API is read-only and that dailies are sent through MCP or the CLI.
  - **Repository root `llms.txt`:** the GitHub-readable entry for agents that clone or browse the repo. It links the docs `llms.txt`, the API `llms.txt`, `README.md`, `CONTRIBUTING.md`, `docs/engineering/review-guide.md` and `docs/api/CHANGELOG.md`.
  - Task 6 links the docs and API `llms.txt` from the landing `llms.txt`.

- [ ] **Step 1: Write the failing tests:**
  - `scripts/docs-llms.test.ts` runs `vitepress build docs/site` once in `beforeAll`, with `SUPPORT_EMAIL=test@example.com` and a 120 s timeout. It asserts:
    - `llms.txt` exists, starts with `# Standwise` and contains `/admin/configuration.md` and `/pt-BR/llms.txt`;
    - `llms-full.txt` contains `remind_at` and `digest_at` and no pt-BR page text, for example no `Visão geral da API`;
    - `pt-BR/llms.txt` exists and contains `/pt-BR/admin/configuration.md`;
    - `pt-BR/llms-full.txt` contains `Visão geral da API`;
    - `admin/configuration.md` and `pt-BR/admin/configuration.md` exist.
  - `apps/api/test/llms.test.ts`:
    - `GET /llms.txt` is 200 `text/plain` and contains `/openapi.json` and the configured docs URL;
    - it does not appear in `openapi.json` paths.
- [ ] **Step 2:** Run `bun test scripts/docs-llms.test.ts apps/api/test/llms.test.ts` and expect them to FAIL.
- [ ] **Step 3: Implement.**
  - Register `vitepress-plugin-llms` (`import llmstxt from 'vitepress-plugin-llms'`) in the VitePress `vite.plugins` with `domain: 'https://docs-standwise.usefachada.dev'`. Configure it so the en files exclude `pt-BR/**`. Produce the pt-BR pair:
    - either with a second plugin instance scoped to `pt-BR` (the plugin's `workDir` option);
    - or, if the plugin cannot do that, with a `buildEnd` step in `scripts/docs-llms.ts` that writes `pt-BR/llms.txt` and `pt-BR/llms-full.txt` from the pt-BR `.md` outputs.
  - Add the API route, built from `deps.env.docsUrl` and `deps.env.publicUrl`, with no request data in the text.
  - Write the root `llms.txt`.
  - Add the "For AI agents" sections in en and pt-BR (`bun run check-docs` parity).
  - Run `bun install`.
- [ ] **Step 4:** Run `bun test scripts/docs-llms.test.ts apps/api/test/llms.test.ts`, `bun run check-docs` and `bun run check-deps`. Expect PASS.
- [ ] **Step 5:** Commit `feat(docs): llms.txt for the docs, the api and the repository`.

### Task 2: beta_requests table and repository

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/test/setup.ts` (add `beta_requests` to the TRUNCATE list)
- Create: `packages/db/src/repo/beta-requests.ts`, the migration generated by `bun run --cwd packages/db generate`
- Test: `packages/db/test/beta-requests.test.ts`

**Interfaces:**
- Produces:
  - `type BetaTeamSize = '3-5' | '6-15' | '16+'`
  - `type BetaChat = 'slack' | 'google_chat' | 'other'`
  - `type BetaTracker = 'linear' | 'jira' | 'github' | 'other'`
  - `type BetaLocale = 'en' | 'pt-BR'`
  - `type BetaRequestInput = { name: string; email: string; teamSize: BetaTeamSize; chat: BetaChat; tracker: BetaTracker; locale: BetaLocale }`
  - `type BetaRequest = BetaRequestInput & { id: string; createdAt: Date; notifiedAt: Date | null }`
  - `upsertBetaRequest(db, input: BetaRequestInput, now: Date): Promise<{ id: string } | null>`. It returns `null` when the same normalized email already has a row created less than 24 hours before `now`.
  - `getBetaRequest(db, id: string): Promise<BetaRequest | null>`
  - `markBetaRequestNotified(db, id: string, now: Date): Promise<boolean>`. It is a CAS on `notified_at IS NULL`.
  - `deleteBetaRequestsCreatedBefore(db, cutoff: Date): Promise<number>`

Table `beta_requests` columns:
- `id` uuid primary key;
- `name` text;
- `email` text, stored lowercased and trimmed;
- `team_size`, `chat`, `tracker`, `locale` text;
- `created_at` timestamptz;
- `notified_at` timestamptz null.

Indexes: unique on `email`, plain on `created_at`. This table is global, not per installation; say so in the PR description so a reviewer does not flag missing `installation_id`.

- [ ] **Step 1: Write the failing tests:**
  - `inserts a new request` returns an id, and `getBetaRequest` returns the fields with `notifiedAt: null`.
  - `duplicate within 24h` asserts that a second upsert of the same email at `now + 23h` returns `null`.
  - `re-request after 24h` asserts that an upsert at `now + 25h` returns the same id and resets `notifiedAt` to `null`.
  - `normalizes email` asserts that `" Ana@Example.COM "` then `"ana@example.com"` gives `null` on the second call.
  - `markBetaRequestNotified` returns `true` once, then `false`.
  - `deleteBetaRequestsCreatedBefore` deletes only older rows and returns the count.
- [ ] **Step 2:** Run `bun test packages/db/test/beta-requests.test.ts` and expect it to FAIL.
- [ ] **Step 3:** Implement `upsertBetaRequest` as one statement: `INSERT … ON CONFLICT (email) DO UPDATE SET <all fields>, created_at = $now, notified_at = NULL WHERE beta_requests.created_at <= $now - interval '24 hours' RETURNING id`. Zero rows returned means `null`. Generate the migration.
- [ ] **Step 4:** Run the test and expect PASS.
- [ ] **Step 5:** Commit `feat(db): beta_requests table`.

### Task 3: submitBetaRequest use case

**Files:**
- Create: `packages/orchestrator/src/use-cases/submit-beta-request.ts`
- Modify: `packages/orchestrator/src/use-cases/index.ts`
- Test: `packages/orchestrator/test/use-cases/submit-beta-request.test.ts`

**Interfaces:**
- Consumes: the Task 2 repository functions.
- Produces:
  - `NOTIFY_BETA_REQUEST_JOB = 'notify-beta-request'`
  - `type NotifyBetaRequestJob = { requestId: string }`
  - `submitBetaRequest(deps: Pick<Deps, 'db' | 'queue' | 'now'>, form: Record<string, unknown>): Promise<{ outcome: 'stored' | 'duplicate' | 'spam'; locale: BetaLocale }>`
  - It throws `DomainError('invalid_beta_request', 'invalid beta request')` with `details: { locale }`; add `'invalid_beta_request'` to `DomainErrorCode` in `use-cases/errors.ts` (it never reaches a JSON response, so the docs error tables do not change).

Validation rules (zod):
- `name`: trimmed, 1–120 characters.
- `email`: trimmed, valid email, up to 254 characters.
- `team_size`, `chat`, `tracker`: must be one of their enum values.
- `locale`: `en` or `pt-BR`; anything else becomes `en` and is not an error.
- `company_website`: non-empty means `spam`. Spam stores nothing and enqueues nothing.

- [ ] **Step 1: Write the failing tests**, using `test/use-cases/fakes.ts` and the Postgres test db:
  - `stores and enqueues once`: a `plain` job `{ requestId }` lands in the memory queue.
  - `duplicate within 24h`: outcome `duplicate`, no second job.
  - `honeypot filled`: outcome `spam`, no row, no job.
  - `missing tracker`: throws `invalid_beta_request`.
  - `locale pt-BR carried on error`.
  - `name over 120 chars rejected`.
- [ ] **Step 2:** Run `bun test packages/orchestrator/test/use-cases/submit-beta-request.test.ts` and expect it to FAIL.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the test and expect PASS.
- [ ] **Step 5:** Commit `feat: submit beta request use case`.

### Task 4: Resend adapter and notify job

**Files:**
- Create: `packages/adapters/resend/package.json` (`@standwise/resend`, depends on nothing), `packages/adapters/resend/src/index.ts`
- Create: `packages/orchestrator/src/use-cases/notify-beta-request.ts`, `apps/worker/src/jobs/notify-beta-request.ts`
- Modify:
  - `packages/orchestrator/src/deps.ts`: `WorkerDeps` gains `email: { send(message: EmailMessage): Promise<void> } | null` and `env.supportEmail: string`;
  - `packages/orchestrator/package.json`;
  - `apps/worker/src/env.ts`: `RESEND_API_KEY` optional, `BETA_EMAIL_FROM` required only when the key is set, `SUPPORT_EMAIL` required;
  - `apps/worker/src/main.ts`: `queue.work(NOTIFY_BETA_REQUEST_JOB, …, plain)`;
  - `packages/orchestrator/src/use-cases/prune-data.ts`: delete beta requests older than 365 days;
  - `.env.example`.
- Test: `packages/adapters/resend/test/send.test.ts`, `packages/orchestrator/test/use-cases/notify-beta-request.test.ts`, extend `packages/orchestrator/test/use-cases/prune-data.test.ts`

**Interfaces:**
- Produces:
  - `type EmailMessage = { from: string; to: string; replyTo?: string; subject: string; text: string }`
  - `class EmailDeliveryError extends Error { code: 'timeout' | 'request_failed' | 'http_error' | 'rejected' }`
  - `sendEmail(apiKey: string, message: EmailMessage, opts?: { fetch?: typeof fetch; baseUrl?: string }): Promise<void>`. It POSTs `https://api.resend.com/emails` with `Authorization: Bearer <key>` and JSON `{ from, to: [to], reply_to, subject, text }`, with a timeout of 10 000 ms.
  - `notifyBetaRequest(deps: Pick<WorkerDeps, 'db' | 'now' | 'email' | 'env'>, job: NotifyBetaRequestJob): Promise<void>`

Behaviour of `notifyBetaRequest`:
- Row missing or already notified: return.
- `deps.email === null`: call `logError('beta email disabled', new Error('RESEND_API_KEY not set'))` once per job and return without marking.
- Otherwise, send to `env.supportEmail` with `replyTo` = the requester's email:
  - subject `Beta request: <name> (<team size>, <chat>, <tracker>)`;
  - the text lists every field and the locale.
- Then call `markBetaRequestNotified`. If sending throws, rethrow so pg-boss retries.

Tests:
- Adapter, against a fake fetch:
  - `sends with bearer and json`;
  - `4xx maps to rejected`, without the key in the message;
  - `timeout maps to timeout`, using `AbortSignal` with a 10 ms timeout through an options override;
  - `network error maps to request_failed`.
- Job:
  - `sends once and marks`;
  - `already notified`: no send;
  - `email disabled`: no send, row stays unmarked;
  - `send failure rethrows and leaves unmarked`;
  - `log never contains the requester email`: capture `console.error` and assert the email string is absent.
- Prune: a 366-day-old request is deleted and a 364-day-old one is kept.

- [ ] **Step 1:** Write the failing tests above.
- [ ] **Step 2:** Run them and expect FAIL.
- [ ] **Step 3:** Implement the adapter, the use case, the job wrapper (zod parse of `{ requestId: uuid }`), the env and the wiring.
- [ ] **Step 4:** Run `bun test packages/adapters/resend packages/orchestrator apps/worker`, `bun run check-deps` and `bun run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit `feat: email beta requests to support through resend`.

### Task 5: POST /beta route

**Files:**
- Create: `apps/api/src/routes/beta.ts`
- Modify:
  - `apps/api/src/app.ts`: mount it and pass `{ getClientIp, docsUrl, landingUrl }`;
  - `apps/api/src/env.ts`: `LANDING_URL`, https, no trailing slash, default `https://standwise.usefachada.dev`;
  - `apps/api/src/main.ts`;
  - `apps/api/src/middleware/rate-limit.ts`: export `BETA_LIMIT = 5`.
- Test: `apps/api/test/beta.test.ts`

**Interfaces:**
- Consumes: `submitBetaRequest` from Task 3.
- Produces: `POST /beta`, taking `application/x-www-form-urlencoded` and answering `303`. It is not in the OpenAPI document.

Redirect rules:

| Outcome | Locale | `Location` |
| --- | --- | --- |
| `stored`, `duplicate` or `spam` | `en` | `${DOCS_URL}/admin/install` |
| `stored`, `duplicate` or `spam` | `pt-BR` | `${DOCS_URL}/pt-BR/admin/install` |
| `invalid_beta_request` | `en` | `${LANDING_URL}/#beta-invalid` |
| `invalid_beta_request` | `pt-BR` | `${LANDING_URL}/pt-BR/#beta-invalid` |

Rate limit: `ipRateLimit(deps, getClientIp, 'beta', BETA_LIMIT)`. Over the limit returns the standard `429`.

- [ ] **Step 1: Write the failing tests:**
  - `valid en redirects to install`;
  - `valid pt-BR redirects to pt-BR install`;
  - `invalid pt-BR redirects to landing anchor`;
  - `json body is rejected as invalid` (it redirects to the en anchor);
  - `sixth request in a minute is 429`;
  - `beta is absent from openapi.json paths`;
  - `Location never uses request headers`: send `Host: evil.example` and `X-Forwarded-Host` and assert the configured docs URL.
- [ ] **Step 2:** Run `bun test apps/api/test/beta.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement it with `c.req.parseBody()`. Catch only `DomainError` with code `invalid_beta_request`; any other error propagates to `onError`.
- [ ] **Step 4:** Run `bun test apps/api` and expect PASS.
- [ ] **Step 5:** Commit `feat(api): beta request form endpoint`.

### Task 6: Landing site

**Files:**
- Create in `apps/landing/`:
  - `package.json` (`@standwise/landing`, private, no dependencies);
  - `wrangler.jsonc`: name `standwise-landing`, `assets.directory` `./public`, `html_handling` `auto-trailing-slash`, `not_found_handling` `404-page`.
- Create in `apps/landing/public/`:
  - `index.html`, `pt-BR/index.html`, `404.html`;
  - `styles.css`, `app.js`;
  - `favicon.svg` (copy of `docs/site/public/logo.svg`), `og.png` (1280×640, from the social preview the controller places at `apps/landing/design/og.png`);
  - `robots.txt`, `sitemap.xml`, `llms.txt`, `index.md`, `pt-BR/index.md`;
  - `_headers`.
- Test: `apps/landing/test/landing.test.ts`

**Interfaces:**
- Consumes: `POST https://api-standwise.usefachada.dev/beta` (Task 5) with the field names `name`, `email`, `team_size`, `chat`, `tracker`, `locale`, `company_website`; the docs `llms.txt` (Task 1).

Build the pages from `apps/landing/design/approved.html`:
- Move every `style` attribute into classes and the inline CSS into `styles.css`. Move the copy and animation script into `app.js`, loaded with `defer`.
- Remove the mockup's prefilled values and its `submit` handler. The form becomes:
  - `action="https://api-standwise.usefachada.dev/beta" method="post"`;
  - real `required`, `type="email"` and `maxlength` attributes;
  - select `value`s equal to the enum values;
  - a hidden `locale`;
  - the honeypot inside an `aria-hidden` wrapper with `tabindex="-1"` and `autocomplete="off"`, hidden by CSS.
- Add an error box with `id="beta-invalid"` that is shown only when it is the `:target`.
- The pt-BR page translates every visible string, keeps the same structure and links the pt-BR docs.

Head of each page:
- unique `<title>` and `meta description` (en ≤ 155 characters);
- `link rel=canonical`;
- `hreflang` `en`, `pt-BR` and `x-default`;
- Open Graph and Twitter card tags with `og.png`;
- `theme-color`, `link rel=icon`;
- `link rel="alternate" type="text/markdown" href="/index.md"`;
- JSON-LD `SoftwareApplication` and `FAQPage`, where the FAQPage questions equal the FAQ `summary` texts.

Other files:
- `robots.txt`: `User-agent: *` with `Allow: /`, explicit `Allow: /` groups for `GPTBot`, `ClaudeBot`, `Claude-SearchBot`, `PerplexityBot`, `Google-Extended` and `OAI-SearchBot`, then a `Sitemap:` line.
- `_headers`:
  - CSP `default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action https://api-standwise.usefachada.dev; base-uri 'none'; frame-ancestors 'none'`;
  - HSTS, `nosniff`, `Referrer-Policy strict-origin-when-cross-origin`;
  - `Content-Type: text/markdown; charset=utf-8` for `/*.md`.
- `llms.txt`: llmstxt.org format. An H1, a blockquote summary, then sections linking:
  - the landing markdown;
  - the docs `llms.txt`/`llms-full.txt` (en and pt-BR);
  - the API `llms.txt`;
  - install, configuration, MCP and API overview;
  - OpenAPI JSON;
  - the repository `llms.txt`.

- [ ] **Step 1: Write the failing tests** in `apps/landing/test/landing.test.ts`, reading the files from disk:
  - `no inline scripts or style attributes` in every HTML file.
  - `head tags present` on both pages: title, description, canonical, three hreflang, og:image, a JSON-LD that parses.
  - `faq json-ld matches the page`.
  - `form posts to the api`: action, method, every field name, a hidden locale value per page.
  - `no hidden-at-rest content`: `styles.css` contains no `opacity:0` outside rules nested in `@media (prefers-reduced-motion:no-preference)` under a `.play` selector.
  - `robots allows ai crawlers and points to the sitemap`.
  - `sitemap lists both locales`.
  - `llms.txt links docs llms and openapi`.
  - `internal links resolve`: every `href` starting with `/` exists under `public/`.
- [ ] **Step 2:** Run `bun test apps/landing` and expect FAIL.
- [ ] **Step 3:** Build the files.
- [ ] **Step 4:** Run `bun test apps/landing` and `bun run lint` and expect PASS. Then serve the folder (`bunx wrangler dev -c apps/landing/wrangler.jsonc` or `bunx serve apps/landing/public`) and run Lighthouse on `/` and `/pt-BR/`, mobile and desktop: `bunx lighthouse <url> --only-categories=seo,accessibility,best-practices --output=json --chrome-flags="--headless"`. Expect SEO ≥ 99, accessibility ≥ 95 and best practices ≥ 95. Fix and rerun until they pass, and record the scores in the commit body.
- [ ] **Step 5:** Delete `apps/landing/design/`. Commit `feat: landing page with beta form`.

### Task 7: Docs, privacy and operations

**Files:**
- Modify: `docs/site/privacy.md` and `docs/site/pt-BR/privacy.md` (a "Beta requests" section: the fields, the purpose of contacting the team after install, email through Resend, deletion after 12 months, a request to delete via the support email)
- Modify: `README.md` (landing link in the top link row and in Quick start)
- Modify: `docs/cloudflare-pages.md` (a second Worker `standwise-landing`: build command none, deploy command `npx wrangler deploy -c apps/landing/wrangler.jsonc`, custom domain `standwise.usefachada.dev`)
- Modify: `docs/deploy.md` (`LANDING_URL`, `RESEND_API_KEY`, `BETA_EMAIL_FROM`, `SUPPORT_EMAIL` for the worker)
- Test: `bun run check-docs`

- [ ] **Step 1:** Write the docs changes in en and pt-BR.
- [ ] **Step 2:** Run `bun run check-docs`, `bun run lint` and `bun test`. Expect PASS.
- [ ] **Step 3:** Commit `docs: beta requests, landing deploy and new settings`.
