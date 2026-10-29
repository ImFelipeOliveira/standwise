# Standwise — Plano 1: Fundação ponta a ponta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma pessoa instala a skill, faz login com o GitHub, gera o rascunho do "ontem" a partir da atividade no GitHub, envia a daily, e o time recebe o consolidado no Slack no horário configurado em `standwise.yml`.

**Architecture:** Monorepo Bun. `packages/core` concentra o domínio puro (config, calendário, daily, mensagens), sem I/O. `packages/db` (Drizzle), `packages/queue` (pg-boss atrás de `JobQueue`) e `packages/adapters/*` fazem o I/O. `apps/api` (Hono) atende CLI, webhooks e páginas de setup; `apps/worker` roda os jobs; `apps/cli` é compilada em binário; `packages/plugin` é o plugin do Claude Code.

**Tech Stack:** Bun ≥ 1.2, TypeScript (strict), Hono, Drizzle ORM + `postgres` (driver), pg-boss, Zod 4, `yaml`, `date-fns` 4 + `@date-fns/tz`, `@octokit/app`, `@octokit/webhooks`, `@slack/web-api`, Biome.

**Spec:** `docs/superpowers/specs/2026-10-27-standwise-design.md`

**Sequência:** este é o plano 1 de 3 da fase 1a. Plano 2: orquestração (lembretes, encaminhamento de impedimentos, impedimentos sugeridos, check run do config). Plano 3: Linear (adaptador `ProjectTracker`, atividade de cards no draft).

## Global Constraints

- Código, identificadores e commits em inglês; textos para o usuário em **pt-BR e en** (chave `language` do time; padrão `pt-BR`).
- Hospedado só pelo Felipe; multi-tenant: **toda consulta filtra por `installation_id`**.
- Tokens OAuth de terceiros criptografados em repouso com **AES-256-GCM**; chave em `STANDWISE_ENCRYPTION_KEY` (32 bytes, base64).
- Toda requisição de webhook tem a assinatura verificada antes de qualquer processamento.
- Permissões do GitHub App exatamente as da spec §6: Metadata (read), Contents (read), Pull requests (read), Checks (write), Commit statuses (read), Members (read), conta: Email addresses (read). Eventos: `installation`, `installation_repositories`, `push`, `pull_request`, `pull_request_review`, `check_suite`, `check_run`.
- Config: arquivo `standwise.yml` na **raiz** do repositório `.github` do dono da instalação, branch padrão.
- Padrões de config: `language: en` (regra do Felipe, 2026-10-28: sem idioma definido, inglês; vale para CLI, web e config), `workdays: [mon,tue,wed,thu,fri]`, `signals.pr_review_hours: 48`, `signals.card_stale_days: 5`.
- Reenvio da daily no mesmo dia **substitui** a anterior. A daily pertence a pessoa + instalação + data.
- "Hoje" e "último dia útil" usam o fuso e os dias úteis do **primeiro time** (ordem do config) em que a pessoa aparece.
- Uma `/daily` aparece no consolidado de **todos** os times da pessoa.
- Consolidado: **uma** mensagem por time por dia, impedimentos no topo, lista de quem não enviou no fim; daily enviada depois do consolidado vai como **resposta na thread**.
- Nada é enviado em nome da pessoa sem confirmação explícita dela (anti-vigilância).
- **Camadas (regra do Felipe, 2026-10-28):** as regras de negócio vivem em casos de uso em `packages/orchestrator/src/use-cases/`, que recebem `Deps` e entradas já validadas, devolvem resultados tipados e lançam `DomainError(code, message, details?)`, sem importar Hono nem conhecer HTTP. Rotas (`apps/api/src/routes/*`), jobs do worker e comandos da CLI/MCP são **finos**: autenticam, validam a entrada (Zod), chamam o caso de uso e traduzem o resultado. O mapeamento `DomainError.code` → status HTTP fica numa tabela única em `apps/api/src/http/errors.ts`. Casos de uso têm testes próprios, sem HTTP.
- **Sem comentários no código** (regra do Felipe).
- Testes: `bun test`. Testes de `db`, `api` e `worker` usam Postgres real via `TEST_DATABASE_URL` (docker compose). APIs externas (GitHub, Slack) são substituídas por fakes injetados, nunca chamadas reais.

## Review Focus

1. **Daily enviada em dia não útil ou perto da meia-noite** → a data é calculada no fuso do time; sábado/domingo contam para o próximo dia útil. *(teste na Task 2)*
2. **Pessoa sem identidade no Slack** (e-mail não bate, sem mapeamento) → o consolidado mostra `@login` do GitHub em texto, sem quebrar. *(teste na Task 4 e na Task 12)*
3. **Tick duplicado, webhook repetido ou worker reiniciado no meio do envio** → nunca dois consolidados para o mesmo time/dia. *(teste na Task 12)*
4. **Worker fora do ar no minuto exato do `digest_at`** → o consolidado sai quando o worker volta, desde que dentro de 120 minutos; depois disso, não sai. *(teste na Task 2 e na Task 12)*
5. **Token do Slack revogado ou bot fora de canal privado** → a entrega fica `failed` com o erro gravado e visível na página de setup, sem loop infinito de retry (máx. 3 tentativas). *(teste na Task 12 e na Task 11)*

---

### Task 1: Monorepo e parser do config

**Files:**
- Create: `package.json` (workspaces `apps/*`, `packages/*`, `packages/adapters/*`; scripts `test`, `lint`, `typecheck`), `tsconfig.base.json` (strict, `moduleResolution: bundler`), `biome.json`, `docker-compose.yml` (Postgres 17 na porta 5433, bancos `standwise` e `standwise_test`), `.env.example`, `.gitignore`, `LICENSE` (MIT)
- Create: `packages/core/package.json` (`@standwise/core`), `packages/core/src/config.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Weekday = 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'
  type Language = 'pt-BR'|'en'
  type TeamConfig = {
    name: string; timezone: string; workdays: Weekday[]
    remindAt: string; digestAt: string            // "HH:MM"
    language: Language; managers: string[]; members: string[] // logins ou "@org/slug"
    chat: { provider: 'slack'|'google-chat'; channel: string }
    tracker?: { provider: 'linear'|'jira'; team: string }
    signals: { prReviewHours: number; cardStaleDays: number }
  }
  type MemberOverrides = { slack?: string; googleChat?: string; linear?: string; jira?: string }
  type StandwiseConfig = { teams: TeamConfig[]; members: Record<string, MemberOverrides> }
  type ConfigError = { path: string; message: string }
  function parseConfig(source: string): { ok: true; config: StandwiseConfig } | { ok: false; errors: ConfigError[] }
  ```
  O YAML usa snake_case (`remind_at`, `pr_review_hours`); o tipo TS usa camelCase.

- [ ] **Step 1: Write the failing tests** em `config.test.ts`:
  - `parses the spec example` → com o YAML da spec §4.4, `ok === true`, `teams[0].digestAt === "10:00"`, `teams[0].signals.prReviewHours === 48`, `members.alice.slack === "U0123"`.
  - `applies defaults` → time só com `name`, `timezone`, `remind_at`, `digest_at`, `managers`, `members`, `chat` resulta em `language === 'pt-BR'`, `workdays` seg–sex, `cardStaleDays === 5`, `tracker === undefined`.
  - `rejects bad time` → `digest_at: "25:00"` dá `ok === false` com erro de `path === "teams.0.digest_at"`.
  - `rejects unknown timezone` → `timezone: "Mars/Base"` dá um erro em `teams.0.timezone` (validar com `Intl.DateTimeFormat`).
  - `rejects duplicate team names` → erro em `teams.1.name`.
  - `rejects invalid yaml` → `ok === false`, `errors[0].path === ""`.
  - `rejects empty members` → `members: []` dá erro.
  - `rejects empty workdays` → `workdays: []` dá erro em `teams.0.workdays`.
- [ ] **Step 2: Run** `bun test packages/core` → FAIL (module not found).
- [ ] **Step 3: Implement `parseConfig`** com `yaml.parse` + schema Zod (`z.strictObject` para pegar chaves desconhecidas). Os paths de erro são os do Zod juntados com `.`, em snake_case como no YAML.
- [ ] **Step 4: Run** `bun test packages/core` → PASS; `bun run lint` e `bun run typecheck` limpos.
- [ ] **Step 5: Commit** `feat(core): workspace scaffold and standwise.yml parser`

### Task 2: Calendário (fuso e dias úteis)

**Files:**
- Create: `packages/core/src/calendar.ts`
- Test: `packages/core/test/calendar.test.ts`

**Interfaces:**
- Consumes: `TeamConfig`, `Weekday` (Task 1)
- Produces:
  ```ts
  type Calendar = Pick<TeamConfig, 'timezone'|'workdays'>
  function localDate(now: Date, tz: string): string                  // "YYYY-MM-DD"
  function isWorkday(date: string, cal: Calendar): boolean
  function dailyDateFor(now: Date, cal: Calendar): string            // hoje se útil, senão próximo dia útil
  function previousWorkday(date: string, cal: Calendar): string
  function startOfLocalDay(date: string, tz: string): Date
  function isDue(now: Date, date: string, hhmm: string, tz: string, graceMinutes?: number): boolean // padrão 120
  ```

- [ ] **Step 1: Write the failing tests:**
  - `localDate near midnight` → `2026-10-28T02:30:00Z` em `America/Boa_Vista` (UTC−4) dá `"2026-10-27"`.
  - `saturday counts for monday` → `dailyDateFor` num sábado local (`2026-10-31`) dá `"2026-11-02"`.
  - `previousWorkday skips weekend` → `previousWorkday("2026-11-02")` dá `"2026-10-30"`.
  - `custom workdays` → com `workdays: ['sun','mon','tue','wed','thu']`, `isWorkday("2026-11-01") === true`.
  - `startOfLocalDay across DST` → `startOfLocalDay("2026-11-01", "America/New_York").toISOString() === "2026-11-01T04:00:00.000Z"`.
  - `isDue window` → com `hhmm "10:00"`: 09:59 local `false`; 10:00 `true`; 11:59 `true`; 12:01 `false` (grace 120); dia local diferente de `date` dá `false`.
- [ ] **Step 2: Run** `bun test packages/core/test/calendar.test.ts` → FAIL.
- [ ] **Step 3: Implement** com `@date-fns/tz` (`TZDate`) e `date-fns`. `previousWorkday`/`dailyDateFor` andam no máximo 7 dias; se nenhum dia for útil, lançam `Error("no workdays")` (o parser da Task 1 já impede `workdays: []`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): timezone-aware workday calendar`

### Task 3: Daily, times da pessoa e janela de atividade

**Files:**
- Create: `packages/core/src/daily.ts`, `packages/core/src/activity.ts`
- Test: `packages/core/test/daily.test.ts`

**Interfaces:**
- Consumes: `TeamConfig` (Task 1); `previousWorkday`, `startOfLocalDay` (Task 2)
- Produces:
  ```ts
  type Ref = { kind: 'pull_request'|'issue'|'commit'|'card'; url: string; title?: string }
  type Item = { text: string; ref?: Ref }                          // text 1..500
  type DailySubmission = { org: string; yesterday: Item[]; today: Item[]; blockers: Item[] }
  const DailySubmissionSchema: z.ZodType<DailySubmission>          // yesterday ≤ 30, today 1..30, blockers ≤ 10
  type ResolvedTeam = TeamConfig & { memberLogins: string[] }      // "@org/slug" já expandido, logins em minúsculas
  function teamsForMember(login: string, teams: ResolvedTeam[]): ResolvedTeam[] // ordem do config, case-insensitive
  function activitySince(input: { date: string; cal: Calendar; lastDaily?: { date: string; submittedAt: Date } }): Date
  type ActivityItem = { kind: 'pr_opened'|'pr_merged'|'review'|'commits'; title: string; url: string; repo: string; at: Date; count?: number }
  ```
  `activitySince`: se `lastDaily.date >= previousWorkday(date)`, devolve `lastDaily.submittedAt`; senão, `startOfLocalDay(previousWorkday(date))`.

- [ ] **Step 1: Write the failing tests:**
  - `schema requires today` → `today: []` falha; `text` com 501 caracteres falha; `ref.url` inválida falha.
  - `teamsForMember order and case` → `"Alice"` em `backend` e `platform` (nessa ordem no config) dá `['backend','platform']`.
  - `activitySince uses last daily` → `lastDaily` em `previousWorkday` às 09:10 devolve aquele instante.
  - `activitySince ignores stale daily` → `lastDaily` de 10 dias atrás devolve o início do dia útil anterior.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): daily schema, member teams, activity window`

### Task 4: Modelo de mensagem, i18n e consolidado

**Files:**
- Create: `packages/core/src/message.ts`, `packages/core/src/i18n.ts`, `packages/core/src/digest.ts`, `packages/core/src/ports.ts`
- Test: `packages/core/test/digest.test.ts`

**Interfaces:**
- Consumes: `TeamConfig`, `Language` (Task 1); `DailySubmission`, `Item` (Task 3)
- Produces:
  ```ts
  type Inline = string | { mention: string } | { link: { text: string; url: string } }
  type Block =
    | { type: 'heading'; text: string }
    | { type: 'paragraph'; content: Inline[] }
    | { type: 'list'; items: Inline[][] }
    | { type: 'divider' }
  type Message = { fallbackText: string; blocks: Block[] }
  type Person = { login: string; chatUserId?: string }
  type DigestEntry = Person & { daily: DailySubmission }
  function t(lang: Language, key: MessageKey, vars?: Record<string, string|number>): string
  function buildDigest(input: { team: TeamConfig; date: string; entries: DigestEntry[]; missing: Person[] }): Message
  function buildLateDaily(entry: DigestEntry, lang: Language): Message
  // ports.ts
  type MessageRef = { channel: string; id: string }
  interface ChatChannel {
    postToChannel(channel: string, msg: Message): Promise<MessageRef>
    replyInThread(ref: MessageRef, msg: Message): Promise<MessageRef>
    sendDirect(userId: string, msg: Message): Promise<MessageRef>
    findUserByEmail(email: string): Promise<string | null>
  }
  ```
  `Person` sem `chatUserId` é renderizado como o texto `@login`, nunca como `{ mention }`.

- [ ] **Step 1: Write the failing tests:**
  - `blockers come first` → com 2 pessoas e 1 impedimento, o primeiro bloco depois do `heading` é a seção de impedimentos, e ela contém `{ mention: 'U1' }` e o texto do impedimento.
  - `no blockers section when none`.
  - `one section per person in config member order` → as pessoas aparecem na ordem de `team.members`, não na ordem de envio.
  - `missing listed last` → o último bloco lista quem não enviou; uma pessoa sem `chatUserId` aparece como `"@bob"`.
  - `nobody missing` → não há seção de ausentes.
  - `localized` → `language: 'en'` produz o heading `"Daily — backend — 2026-10-27"`; `pt-BR` produz `"Daily — backend — 27/10/2026"`.
  - `refs become links` → um `Item` com `ref` vira `{ link: { text: ref.title ?? text, url } }`.
  - `fallbackText` não é vazio e não contém `[object`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (as chaves de i18n ficam num objeto `as const` por idioma; o tipo `MessageKey` é derivado dele). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): neutral message model and team digest`

### Task 5: Banco de dados e criptografia

**Files:**
- Create: `packages/db/package.json` (`@standwise/db`), `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/crypto.ts`, `packages/db/src/repo/{installations,members,sessions,dailies,deliveries,connections}.ts`, `packages/db/src/index.ts`, `packages/db/migrations/*` (gerado)
- Test: `packages/db/test/crypto.test.ts`, `packages/db/test/repo.test.ts`, `packages/db/test/setup.ts` (migra o `TEST_DATABASE_URL` e trunca as tabelas entre testes)

**Interfaces:**
- Consumes: `StandwiseConfig`, `ConfigError` (Task 1); `DailySubmission` (Task 3); `MessageRef` (Task 4)
- Produces (tabelas):
  - `installations`: `id bigint pk` (id da instalação no GitHub), `account_login`, `account_type ('Organization'|'User')`, `status ('unconfigured'|'configured'|'invalid')`, `config jsonb null` (último válido), `config_errors jsonb null`, `unconfigured_reason text null`, timestamps.
  - `members`: `id uuid pk`, `github_user_id bigint unique`, `login`, `email null`.
  - `member_installations`: `(member_id, installation_id) pk`.
  - `member_identities`: `(installation_id, member_id, provider) pk`, `external_id`; provider `'slack'|'google-chat'|'linear'|'jira'`.
  - `connections`: `(installation_id, provider) pk`, `external_id` (ex.: Slack team id), `secret_ciphertext`, `created_at`.
  - `sessions`: `token_hash text pk` (sha256 hex), `member_id`, `kind ('cli'|'web')`, `created_at`, `last_used_at`.
  - `dailies`: `id uuid pk`, `installation_id`, `member_id`, `date date`, `payload jsonb`, `submitted_at`; `unique(installation_id, member_id, date)`.
  - `deliveries`: `id uuid pk`, `installation_id`, `team_name`, `date`, `kind ('digest'|'late_daily')`, `subject text not null default ''`, `status ('pending'|'sent'|'failed')`, `attempts int`, `ref jsonb null`, `error text null`; `unique(installation_id, team_name, date, kind, subject)`.
- Produces (funções):
  ```ts
  function createDb(url: string): Db
  function encryptSecret(plain: string, key: Uint8Array): string   // base64(iv12 | tag16 | ciphertext)
  function decryptSecret(blob: string, key: Uint8Array): string
  // repo — todas recebem db como 1º argumento
  upsertInstallation(db, i: { id: number; accountLogin: string; accountType: 'Organization'|'User' }): Promise<void>
  deleteInstallation(db, id: number): Promise<void>                // cascata
  setInstallationConfig(db, id: number, r: { status: 'configured'; config: StandwiseConfig } | { status: 'invalid'; errors: ConfigError[] } | { status: 'unconfigured'; reason: string }): Promise<void> // 'invalid' preserva o config anterior
  listConfiguredInstallations(db): Promise<{ id: number; accountLogin: string; config: StandwiseConfig }[]>
  getInstallation(db, id: number): Promise<InstallationRow | null>
  upsertMember(db, m: { githubUserId: number; login: string; email: string | null }): Promise<MemberRow>
  setMemberInstallations(db, memberId: string, installationIds: number[]): Promise<void>  // substitui o conjunto
  setIdentity(db, installationId: number, memberId: string, provider: Provider, externalId: string): Promise<void>
  getIdentities(db, installationId: number, provider: Provider): Promise<Map<string /*login lower*/, string>>
  createSession(db, memberId: string, kind: 'cli'|'web'): Promise<string>  // devolve o token "sw_" + 32 bytes base64url; grava só o hash
  resolveSession(db, token: string, kind: 'cli'|'web'): Promise<MemberRow | null>
  upsertDaily(db, d: { installationId: number; memberId: string; date: string; payload: DailySubmission; submittedAt: Date }): Promise<void>
  getLastDaily(db, installationId: number, memberId: string, before: string): Promise<{ date: string; submittedAt: Date } | null>
  listDailies(db, installationId: number, date: string): Promise<{ login: string; memberId: string; payload: DailySubmission; submittedAt: Date }[]>
  claimDelivery(db, k: DeliveryKey): Promise<'claimed' | 'already_sent' | 'in_progress'> // insere 'pending'; reabre 'failed' se attempts < 3
  completeDelivery(db, k: DeliveryKey, ref: MessageRef): Promise<void>
  failDelivery(db, k: DeliveryKey, error: string): Promise<void>
  getDelivery(db, k: DeliveryKey): Promise<DeliveryRow | null>
  listFailedDeliveries(db, installationId: number, limit: number): Promise<DeliveryRow[]>
  saveConnection(db, installationId: number, provider: Provider, externalId: string, secret: string, key: Uint8Array): Promise<void>
  getConnection(db, installationId: number, provider: Provider, key: Uint8Array): Promise<{ externalId: string; secret: string } | null>
  type DeliveryKey = { installationId: number; teamName: string; date: string; kind: 'digest'|'late_daily'; subject?: string }
  ```

- [ ] **Step 1: Write the failing tests:**
  - `crypto roundtrip`; `decrypt with wrong key throws`; `two encryptions differ` (IV aleatório).
  - `upsertDaily replaces same day` → dois upserts na mesma data deixam 1 linha com o payload do segundo.
  - `claimDelivery is exclusive` → `Promise.all` com dois `claimDelivery` iguais dá exatamente um `'claimed'`.
  - `claimDelivery after sent` → `'already_sent'`.
  - `claimDelivery retries failed up to 3` → depois de 3 `failDelivery`, o próximo claim devolve `'already_sent'` e não reabre.
  - `invalid config keeps last valid` → `configured(A)` e depois `invalid(errs)` deixam `config = A`, `status = 'invalid'`, `config_errors = errs`.
  - `sessions store only hashes` → a tabela não contém o token em texto puro; `resolveSession` com o token certo devolve o member, e com o `kind` errado devolve `null`.
  - `connection secret encrypted` → `secret_ciphertext` diferente do segredo; `getConnection` devolve o segredo original.
  - `deleteInstallation cascades` → dailies e deliveries da instalação somem.
- [ ] **Step 2: Run** `docker compose up -d && bun test packages/db` → FAIL.
- [ ] **Step 3: Implement** o schema e `bun drizzle-kit generate`; repo com Drizzle; crypto com `node:crypto` (`aes-256-gcm`). `claimDelivery` usa `INSERT … ON CONFLICT DO UPDATE … WHERE status = 'failed' AND attempts < 3 RETURNING`, e um `pending` com mais de 10 minutos também pode ser reaberto (worker que morreu no meio do envio).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(db): schema, repositories and secret encryption`

### Task 6: Fila de jobs

**Files:**
- Create: `packages/queue/package.json` (`@standwise/queue`), `packages/queue/src/index.ts`, `packages/queue/src/pgboss.ts`, `packages/queue/src/memory.ts`
- Test: `packages/queue/test/queue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type EnqueueOptions = { singletonKey?: string; startAfter?: Date; retryLimit?: number } // retryLimit padrão 3
  interface JobQueue {
    start(): Promise<void>; stop(): Promise<void>
    enqueue<T extends object>(name: string, data: T, opts?: EnqueueOptions): Promise<void>
    schedule(name: string, cron: string): Promise<void>
    work<T extends object>(name: string, handler: (data: T) => Promise<void>): Promise<void>
  }
  function createPgBossQueue(databaseUrl: string): JobQueue
  function createMemoryQueue(): JobQueue & { drain(): Promise<void>; enqueued: { name: string; data: object }[] }
  ```

- [ ] **Step 1: Write the failing tests** (rodam nas duas implementações via `describe.each`):
  - `work receives enqueued data`.
  - `singletonKey dedupes` → dois enqueues com a mesma chave executam o handler uma vez.
  - `failing handler retries up to retryLimit` → um handler que sempre lança é chamado `1 + retryLimit` vezes (no pg-boss, `retryDelay: 0` no teste).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (no pg-boss, `createQueue(name)` é chamado antes de `send`/`work`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(queue): JobQueue with pg-boss and in-memory implementations`

### Task 7: Adaptador GitHub

**Files:**
- Create: `packages/adapters/github/package.json` (`@standwise/github`), `src/app.ts`, `src/config-source.ts`, `src/members.ts`, `src/activity.ts`, `src/user.ts`, `src/index.ts`
- Test: `packages/adapters/github/test/*.test.ts`, com o Octokit falso via `request.fetch` injetado e fixtures JSON em `test/fixtures/`

**Interfaces:**
- Consumes: `ActivityItem` (Task 3)
- Produces:
  ```ts
  type GitHubEnv = { appId: string; privateKey: string; webhookSecret: string; clientId: string; clientSecret: string }
  function createGitHubApp(env: GitHubEnv, opts?: { fetch?: typeof fetch }): App   // @octokit/app
  function fetchConfigSource(octokit: Octokit, owner: string): Promise<{ found: true; source: string } | { found: false; reason: 'no_repo'|'no_access'|'no_file' }>
  function resolveTeamMembers(octokit: Octokit, owner: string, members: string[]): Promise<string[]> // expande "@owner/slug"; minúsculas; sem duplicatas
  function listActivity(octokit: Octokit, owner: string, login: string, since: Date): Promise<ActivityItem[]>
  function getUserProfile(userToken: string, opts?: { fetch?: typeof fetch }): Promise<{ githubUserId: number; login: string; email: string | null; installationIds: number[] }>
  ```
  `listActivity` faz 4 buscas (`search/issues` com `is:pr author:… org:… created:>=…`; `is:pr author:… is:merged merged:>=…`; `is:pr reviewed-by:… -author:… updated:>=…`; `search/commits` com `author:… org:… committer-date:>=…`). Commits são agrupados por repositório num item `kind:'commits'` com `count`. Resultado ordenado por `at` desc, no máximo 50 itens. Para conta `User`, troca `org:` por `user:`. `email` é o e-mail primário verificado de `/user/emails`; `installationIds` vem de `/user/installations`, filtrado pelo nosso app.

- [ ] **Step 1: Write the failing tests:**
  - `config source found` → `GET /repos/acme/.github/contents/standwise.yml` com 200 base64 devolve o texto decodificado.
  - `config source no_repo` → `GET /repos/acme/.github` 404 dá `reason 'no_repo'`; repo existe mas o contents dá 404 → `'no_file'`; 403 → `'no_access'`.
  - `resolveTeamMembers expands teams` → `["Alice","@acme/backend"]` com o time devolvendo `[bob, alice]` dá `["alice","bob"]`.
  - `listActivity groups commits` → 3 commits em `acme/api` viram 1 item `{kind:'commits', count:3, repo:'acme/api'}`.
  - `listActivity excludes own PRs from reviews` → a query de reviews contém `-author:alice`.
  - `getUserProfile picks primary verified email`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(github): app client, config source, members and activity`

### Task 8: Adaptador Slack

**Files:**
- Create: `packages/adapters/slack/package.json` (`@standwise/slack`), `src/render.ts`, `src/channel.ts`, `src/oauth.ts`, `src/index.ts`
- Test: `packages/adapters/slack/test/*.test.ts` (WebClient com `slackApiUrl` apontando para um servidor `Bun.serve` falso)

**Interfaces:**
- Consumes: `Message`, `ChatChannel`, `MessageRef` (Task 4)
- Produces:
  ```ts
  function renderSlack(msg: Message): { text: string; blocks: object[] }
  function createSlackChannel(botToken: string, opts?: { slackApiUrl?: string }): ChatChannel
  const SLACK_SCOPES = ['chat:write','chat:write.public','im:write','users:read','users:read.email','channels:read','groups:read'] as const
  function slackAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string
  function exchangeSlackCode(p: { clientId: string; clientSecret: string; code: string; redirectUri: string; slackApiUrl?: string }): Promise<{ teamId: string; botToken: string }>
  class ChatDeliveryError extends Error { constructor(public code: string, message: string) }
  ```
  `postToChannel` aceita `"#nome"` (resolvido com `conversations.list`, públicos e privados, com cache em memória por instância) ou um id `C…`/`G…`. `MessageRef = { channel: <id>, id: <ts> }`. Os erros do Slack (`not_in_channel`, `channel_not_found`, `invalid_auth`, `token_revoked`) viram `ChatDeliveryError` com o `code` original.

- [ ] **Step 1: Write the failing tests:**
  - `render heading/paragraph/list/divider` → `heading` vira um bloco `header`; `list` vira `section` mrkdwn com linhas `• …`; `divider` vira `divider`.
  - `render inline` → `{mention:'U1'}` vira `<@U1>`, link vira `<https://x|t>`, e `&`, `<`, `>` no texto são escapados.
  - `header truncated to 150 chars`.
  - `postToChannel resolves #name` → `#daily-backend` vira o `channel` id certo no `chat.postMessage`.
  - `replyInThread sets thread_ts`.
  - `sendDirect opens im` → `conversations.open` e depois `postMessage` no canal da DM.
  - `maps not_in_channel` → lança `ChatDeliveryError` com `code === 'not_in_channel'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(slack): block kit renderer, chat channel and oauth`

### Task 9: API — sessões, draft e envio da daily

**Files:**
- Create: `packages/orchestrator/package.json` (`@standwise/orchestrator`: código compartilhado por api e worker), `packages/orchestrator/src/deps.ts`, `packages/orchestrator/src/teams.ts`, `packages/orchestrator/src/identity.ts`, `packages/orchestrator/src/chat.ts`
- Create: `apps/api/package.json`, `apps/api/src/env.ts` (Zod sobre `process.env`), `apps/api/src/app.ts` (`createApp(deps): Hono`), `apps/api/src/routes/v1.ts`, `apps/api/src/main.ts`
- Test: `apps/api/test/v1.test.ts`, `packages/orchestrator/test/teams.test.ts`

**Interfaces:**
- Consumes: Tasks 2–8
- Produces:
  ```ts
  type Deps = {
    db: Db; queue: JobQueue; now: () => Date; encryptionKey: Uint8Array
    github: { app: App; getUserProfile: typeof getUserProfile; listActivity: typeof listActivity; resolveTeamMembers: typeof resolveTeamMembers; fetchConfigSource: typeof fetchConfigSource }
    chatFor: (installationId: number, provider: 'slack') => Promise<ChatChannel | null>
    env: { publicUrl: string; supportEmail: string; githubClientId: string }
  }
  // packages/orchestrator — Deps, resolveTeams, linkChatIdentities e createChatFor ficam aqui
  function createChatFor(db: Db, encryptionKey: Uint8Array): Deps['chatFor'] // lê a connection 'slack' e devolve createSlackChannel(token), ou null
  function linkChatIdentities(deps: Deps, memberId: string, email: string | null, installationIds: number[]): Promise<void>
  function resolveTeams(deps: Deps, installationId: number, owner: string, config: StandwiseConfig): Promise<ResolvedTeam[]>
  ```
  Rotas (JSON; erros como `{ error: { code, message } }`; autenticadas com `Authorization: Bearer sw_…`, sessão `cli`):
  - `GET /health` → `{ ok: true }`
  - `GET /v1/meta` → `{ githubClientId, supportEmail }`
  - `POST /v1/sessions` `{ githubToken }` → `{ token, login, orgs: { installationId, login }[] }`. Não guarda o `githubToken`. Faz upsert do member, substitui `member_installations` e chama `linkChatIdentities` (overrides do config primeiro, depois e-mail).
  - `GET /v1/draft?org=<login>` → `{ org, date, since, teams: string[], activity: ActivityItem[], suggestions: [] }`
  - `POST /v1/dailies` (`DailySubmissionSchema`) → `{ date, teams: string[], late: boolean }`; se `late`, enfileira `send-late-daily` `{ installationId, memberId, date }`.
  - Códigos: `401 unauthorized`, `404 org_not_found` (org não está nas instalações da pessoa), `409 org_not_configured`, `422 not_in_team`, `422 invalid_daily` (com os issues do Zod).

- [ ] **Step 1: Write the failing tests** (`app.request()` com o DB de teste, `createMemoryQueue`, fakes de GitHub e Slack):
  - `resolveTeams expands github teams` (em `teams.test.ts`) → devolve `ResolvedTeam[]` com `memberLogins` em minúsculas, na ordem do config.
  - `sessions creates member and links slack by email` → o fake do Slack devolve `U9` para o e-mail; depois, `getIdentities` contém `alice → U9`.
  - `config override wins over email` → `members.alice.slack: U1` no config faz a identidade ser `U1`.
  - `draft requires auth` → 401.
  - `draft unknown org` → 404 `org_not_found`.
  - `draft not configured` → instalação `unconfigured` dá 409.
  - `draft window` → sem daily anterior, `since` é o início do dia útil anterior no fuso do primeiro time; o fake do `listActivity` recebe esse `since`.
  - `submit not in team` → 422.
  - `submit replaces same day` → dois POSTs deixam 1 daily.
  - `submit on saturday` → `date` é a segunda-feira seguinte.
  - `submit after digest is late` → com a entrega `digest` `sent` para o time/data, a resposta tem `late: true` e `send-late-daily` é enfileirado.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): cli sessions, draft and daily submission`

### Task 10: API — webhooks do GitHub e carga do config

**Files:**
- Create: `apps/api/src/routes/webhooks.ts`, `apps/api/src/services/config-loader.ts`
- Test: `apps/api/test/webhooks.test.ts`

**Interfaces:**
- Consumes: `fetchConfigSource`, `parseConfig`, `setInstallationConfig`, `upsertInstallation`, `deleteInstallation`
- Produces:
  ```ts
  function loadInstallationConfig(deps: Deps, installationId: number, owner: string): Promise<'configured'|'invalid'|'unconfigured'>
  ```
  `POST /webhooks/github`: verifica `x-hub-signature-256` (`@octokit/webhooks` `verify`; inválida dá 401 sem efeito colateral) e responde `202` rápido.
  - `installation.created` / `installation_repositories.*` → upsert + `loadInstallationConfig`.
  - `installation.deleted` → `deleteInstallation`.
  - `push` no repo `.github`, branch padrão, que toca `standwise.yml` (em `added`/`modified`/`removed` dos commits) → `loadInstallationConfig`.
  - Os demais eventos assinados são aceitos e ignorados neste plano (o plano 2 os usa).

- [ ] **Step 1: Write the failing tests:**
  - `rejects bad signature` → 401; nada gravado.
  - `installation created with valid config` → `status 'configured'`.
  - `installation created without .github repo` → `'unconfigured'`, `unconfigured_reason 'no_repo'`.
  - `push with invalid config keeps last valid` → `status 'invalid'`, config anterior preservado.
  - `push to other repo ignored` → `fetchConfigSource` não é chamado.
  - `installation deleted cascades`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): github webhooks and config loading`

### Task 11: API — login web, página de setup e conexão do Slack

**Files:**
- Create: `apps/api/src/routes/web.tsx` (Hono JSX), `apps/api/src/web/layout.tsx`, `apps/api/src/web/setup.tsx`, `apps/api/src/web/config-template.ts`
- Test: `apps/api/test/web.test.ts`

**Interfaces:**
- Consumes: `createSession`/`resolveSession` (`kind 'web'`), `getUserProfile`, `slackAuthorizeUrl`, `exchangeSlackCode`, `saveConnection`, `listFailedDeliveries`, `getInstallation`
- Produces (rotas; cookie `sw_web` HttpOnly, Secure, SameSite=Lax, 7 dias):
  - `GET /auth/github/login?next=` → redireciona ao OAuth web do GitHub App com `state` assinado (HMAC com `STANDWISE_SESSION_SECRET`, inclui `next` e expira em 10 min).
  - `GET /auth/github/callback` → troca o code, chama `getUserProfile`, cria a sessão web e redireciona para `next` (só caminhos relativos).
  - `GET /setup?installation_id=` (Setup URL do GitHub App) → exige sessão web **e** `installation_id` entre as instalações da pessoa (senão 403). Mostra: status do config (configurado / inválido com a lista de erros / não configurado com o motivo e a instrução); template do `standwise.yml` com o link `https://github.com/<owner>/.github/new/<branch>?filename=standwise.yml&value=<template url-encoded>` (se não houver repo `.github`, link para criar o repo); status do Slack (conectar / conectado ao workspace X); as últimas 5 entregas com falha (time, data, erro); e-mail de suporte.
  - `GET /connect/slack?installation_id=` → mesma autorização; redireciona para `slackAuthorizeUrl` com `state` assinado contendo `installation_id` e o id da sessão.
  - `GET /oauth/slack/callback` → valida o `state` contra a sessão atual; `exchangeSlackCode`; `saveConnection(…, 'slack', teamId, botToken)`; redireciona para `/setup`.

- [ ] **Step 1: Write the failing tests:**
  - `setup requires login` → 302 para `/auth/github/login?next=…`.
  - `setup forbids foreign installation` → 403.
  - `setup shows errors for invalid config` → o HTML contém a mensagem e o path do erro.
  - `setup prefilled link` → o HTML contém `filename=standwise.yml&value=`.
  - `setup lists failed deliveries` → uma entrega `failed` com `not_in_channel` aparece.
  - `slack callback rejects tampered state` → 400; nada salvo.
  - `slack callback saves encrypted connection` → `getConnection` devolve o token.
  - `open redirect blocked` → `next=https://evil.com` redireciona para `/`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (HTML simples, sem framework de front; estilos inline mínimos; textos em pt-BR e en pelo `Accept-Language`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): web login, setup page and slack connection`

### Task 12: Worker — tick, consolidado e daily atrasada

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/src/jobs/tick.ts`, `apps/worker/src/jobs/send-digest.ts`, `apps/worker/src/jobs/send-late-daily.ts`, `apps/worker/src/main.ts`
- Test: `apps/worker/test/*.test.ts`

**Interfaces:**
- Consumes: `isDue`, `dailyDateFor` (Task 2); `buildDigest`, `buildLateDaily` (Task 4); repo de deliveries/dailies (Task 5); `JobQueue` (Task 6); `Deps`, `resolveTeams`, `createChatFor` de `@standwise/orchestrator` (Task 9)
- Produces:
  ```ts
  type WorkerDeps = Pick<Deps, 'db'|'queue'|'now'|'chatFor'|'github'|'encryptionKey'>
  function runTick(deps: WorkerDeps): Promise<void>                       // agendado com cron "* * * * *"
  function sendDigest(deps: WorkerDeps, job: { installationId: number; teamName: string; date: string }): Promise<void>
  function sendLateDaily(deps: WorkerDeps, job: { installationId: number; memberId: string; date: string }): Promise<void>
  ```
  `runTick`: para cada instalação configurada e cada time com `isWorkday(localDate)` e `isDue(now, date, digestAt, tz)`, enfileira `send-digest` com `singletonKey "digest:<inst>:<team>:<date>"`.
  `sendDigest`: `claimDelivery` (se não for `'claimed'`, retorna); resolve os membros; carrega as dailies da data; monta as `entries` na ordem de membros e a lista `missing`; mapeia o `chatUserId` por `getIdentities`; `postToChannel(team.chat.channel, buildDigest(…))`; `completeDelivery`. Em `ChatDeliveryError`, chama `failDelivery` com `code: message` e relança (pg-boss tenta de novo, até 3). Time com `chat.provider !== 'slack'` neste plano: falha com `unsupported_provider` e não relança.
  `sendLateDaily`: para cada time da pessoa com o `digest` da data em `sent`, `claimDelivery({kind:'late_daily', subject: memberId})` e `replyInThread(ref, buildLateDaily(…))`.

- [ ] **Step 1: Write the failing tests:**
  - `tick enqueues once per due team` → às 10:00 local, 1 job; às 09:59, nenhum.
  - `tick catches up within grace` → às 11:30 local, sem entrega, 1 job.
  - `tick skips non-workday`.
  - `digest posts once` → `sendDigest` chamado duas vezes (inclusive em paralelo) gera 1 `postToChannel`.
  - `digest marks missing and unknown identity` → a mensagem enviada contém `"@bob"` para quem não tem identidade e a seção de ausentes.
  - `digest failure recorded` → o fake lança `ChatDeliveryError('not_in_channel')`; a entrega fica `failed` com `error` começando com `not_in_channel`; depois de 3 falhas, um novo `sendDigest` não chama mais o Slack.
  - `late daily replies in thread` → `replyInThread` recebe o `ref` gravado no `digest`.
  - `removed team gets no digest` → um config sem o time não enfileira nada para ele.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (e `main.ts` registra `work` dos 3 jobs e `schedule('tick', '* * * * *')`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(worker): scheduled team digest and late daily replies`

### Task 13: CLI `standwise`

**Files:**
- Create: `apps/cli/package.json`, `apps/cli/src/main.ts`, `apps/cli/src/commands/{login,logout,whoami,draft,submit}.ts`, `apps/cli/src/credentials.ts`, `apps/cli/src/api.ts`
- Test: `apps/cli/test/*.test.ts` (API e GitHub falsos com `Bun.serve`; `HOME` temporário)

**Interfaces:**
- Consumes: rotas da Task 9; `DailySubmissionSchema` (Task 3)
- Produces:
  - `standwise login` → `GET /v1/meta`; GitHub device flow (`POST https://github.com/login/device/code` com `client_id`, polling em `/login/oauth/access_token` respeitando `interval` e `slow_down`); `POST /v1/sessions`; grava as credenciais.
  - `standwise logout`, `standwise whoami` (imprime JSON `{ login, orgs }` ou sai com código 2 se não logado).
  - `standwise draft [--org <login>]` → imprime o JSON do `/v1/draft` em stdout. Sem `--org` e com mais de uma org, sai com código 3 e lista as orgs em stderr.
  - `standwise submit [--org <login>] [--file <path>]` → lê o JSON (`--file` ou stdin), valida localmente com o schema, faz `POST /v1/dailies` e imprime a resposta.
  - Credenciais em `$XDG_CONFIG_HOME/standwise/credentials.json` (padrão `~/.config/standwise`), modo `0600`: `{ apiUrl, token, login, orgs }`.
  - `STANDWISE_API_URL` sobrepõe a URL padrão `https://api.standwise.dev`.
  - Códigos de saída: 0 ok; 1 erro genérico; 2 não autenticado; 3 org ambígua; 4 validação. Erros da API aparecem em stderr como `error <code>: <message>`.

- [ ] **Step 1: Write the failing tests:**
  - `login stores credentials with 0600` (device flow falso respondendo primeiro `authorization_pending`, depois `slow_down`, depois o token).
  - `draft without login exits 2`.
  - `draft ambiguous org exits 3`.
  - `submit validates locally` → `today: []` sai com 4 sem chamar a API.
  - `submit reads stdin`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (argumentos com `util.parseArgs`). **Step 4: Run** → PASS.
- [ ] **Step 5: Add build script** `bun build --compile` para `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64` em `dist/`; rodar o binário local com `--help` imprime o uso.
- [ ] **Step 6: Commit** `feat(cli): login, draft and submit commands`

### Task 14: Plugin do Claude Code (skill `/daily`)

**Files:**
- Create: `packages/plugin/.claude-plugin/plugin.json`, `packages/plugin/skills/daily/SKILL.md`, `.claude-plugin/marketplace.json` (na raiz do repositório, apontando para `packages/plugin`)
- Test: `packages/plugin/test/plugin.test.ts`

**Interfaces:**
- Consumes: comandos da CLI (Task 13) e os códigos de saída dela.
- Produces: a skill `daily` com frontmatter `name: daily` e uma `description` que dispara com "daily", "standup", "minha daily". O fluxo do `SKILL.md`:
  1. `standwise whoami`; se der código 2 ou o comando não existir, orientar a instalação (`curl -fsSL https://standwise.dev/install.sh | sh`) e o `standwise login`, e parar.
  2. `standwise draft` (se der código 3, perguntar a org e repetir com `--org`).
  3. Montar o "ontem" a partir de `activity` (pode enriquecer com o contexto da sessão atual) e mostrar para a pessoa.
  4. Perguntar o "hoje" e os impedimentos, no idioma da pessoa.
  5. Mostrar o JSON final legível e **pedir confirmação explícita**; sem confirmação, não envia.
  6. `standwise submit --file <tmp>`; informar se foi `late` (vai para a thread).
  Regras escritas na skill: nunca inventar atividade que não esteja no draft ou que a pessoa não tenha dito; nunca enviar sem confirmação.

- [ ] **Step 1: Write the failing test** → `plugin.json` é JSON válido com `name: "standwise"`; o `SKILL.md` tem frontmatter com `name` e `description`, e contém os comandos `standwise draft` e `standwise submit` e a regra de confirmação.
- [ ] **Step 2: Run** → FAIL. **Step 3: Write the files.** **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check** → `claude --plugin-dir packages/plugin`, rodar `/daily` contra a API local, conferir o fluxo até o envio.
- [ ] **Step 6: Commit** `feat(plugin): claude code /daily skill`

### Task 15: Deploy, release e documentação

**Files:**
- Create: `Dockerfile` (base `oven/bun`, multi-stage; `ARG APP=api|worker`), `apps/api/railway.json`, `apps/worker/railway.json`, `.github/workflows/ci.yml` (lint, typecheck e test com o serviço Postgres), `.github/workflows/release.yml` (tag `cli-v*` compila os binários da Task 13 e publica no GitHub Releases), `scripts/install.sh`, `docs/github-app.md`, `docs/slack-app-manifest.yml`, `README.md`
- Modify: `apps/api/src/routes/web.tsx` (servir `GET /install.sh`)

**Interfaces:**
- Consumes: tudo.
- Produces:
  - `api` roda `bun run db:migrate && bun run apps/api/src/main.ts`; `worker` roda `bun run apps/worker/src/main.ts`.
  - Variáveis de ambiente documentadas no `.env.example`: `DATABASE_URL`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `STANDWISE_ENCRYPTION_KEY`, `STANDWISE_SESSION_SECRET`, `PUBLIC_URL`, `SUPPORT_EMAIL`.
  - `docs/github-app.md`: o passo a passo para registrar o app, com as permissões e eventos exatos das Global Constraints, Setup URL `<PUBLIC_URL>/setup`, callback `<PUBLIC_URL>/auth/github/callback`, webhook `<PUBLIC_URL>/webhooks/github`, "Enable Device Flow" ligado e "Request user authorization during installation" desligado.
  - `install.sh`: detecta SO e arquitetura, baixa o binário da última release para `~/.local/bin/standwise` e mostra como adicionar ao `PATH`.
  - README: o que é, instalação (admin e membro), formato do `standwise.yml`, privacidade (o que é lido e o que nunca é feito), **e-mail de suporte**.

- [ ] **Step 1:** `docker build --build-arg APP=api .` e `--build-arg APP=worker .` concluem; os containers sobem com `.env` local e `GET /health` responde `{ ok: true }`.
- [ ] **Step 2:** `bash -n scripts/install.sh` sem erros; `shellcheck scripts/install.sh` limpo.
- [ ] **Step 3:** CI verde num PR de teste.
- [ ] **Step 4 (manual, Felipe):** registrar o GitHub App e o Slack App, criar o projeto no Railway (api, worker e Postgres), configurar as variáveis, instalar o app numa org de teste, criar o `standwise.yml` e rodar `/daily` de ponta a ponta até o consolidado chegar no Slack.
- [ ] **Step 5: Commit** `chore: deploy, release pipeline and docs`

---

## Extensão: API pública (adicionada em 2026-10-28, spec §4.5)

**Ordem de execução:** 9 → 10 → 11 → 12 → **16 → 17 → 18** → 13 → **19** → 14 → **20** → 15. Os webhooks de saída dependem do worker, e o deploy (15) sai com a API documentada.
**Regra do usuário que vale para todas as tasks:** não há comentários no código. A documentação vive no OpenAPI e nos guias em markdown, nunca em comentários.

### Task 16: OpenAPI 3.1, `/docs` e guias para integradores

**Files:**
- Modify: `apps/api/src/routes/v1.ts`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/app.ts` (migrar as rotas JSON para `@hono/zod-openapi` com `createRoute`; as rotas HTML de `web.tsx` ficam de fora do OpenAPI)
- Create: `apps/api/src/openapi/schemas.ts` (schemas Zod reutilizáveis com `.openapi({ example })`: `Error`, `ActivityItem`, `Draft`, `DailySubmission`, `SubmitResult`, `Session`), `apps/api/src/openapi/document.ts`, `apps/api/src/routes/docs.ts`, `docs/api/guides/{authentication,ai-agents,errors,pagination,rate-limits,versioning}.md`, `docs/api/CHANGELOG.md`
- Create: `apps/api/src/middleware/rate-limit.ts`, `packages/db/src/repo/rate-limits.ts` (tabela `rate_limits(key text, window_start timestamptz, count int, pk(key, window_start))`, com migração)
- Test: `apps/api/test/openapi.test.ts`, `apps/api/test/rate-limit.test.ts`

**Interfaces:**
- **Rotas internas vs públicas (decisão do Felipe):** `/v1/meta`, `/v1/sessions`, `/v1/draft` e `/v1/dailies` são **internas** (CLI, skill, MCP). Elas também usam `createRoute` e schemas Zod (tipagem e validação), mas ficam **fora** do `/openapi.json` público, registradas com `hide: true` ou equivalente. Um segundo documento, `GET /openapi.internal.json`, exige sessão `sw_` e serve à CLI e aos testes. O documento público contém só `Organization` (Task 17), `Webhooks` (Task 18) e `GET /health`.
- `GET /openapi.json` → documento OpenAPI 3.1 com `info` (título "Standwise API", versão `1.0.0`, `contact.email` = `SUPPORT_EMAIL`, descrição que inclui o conteúdo dos guias), `servers: [{ url: PUBLIC_URL }]`, `securitySchemes`: `apiKey` (bearer `swk_…`, Task 17), e as tags `Organization` (Task 17), `Webhooks` (Task 18) e `Meta` (`/health`).
- `GET /docs/api` → página HTML com a referência Scalar (`@scalar/hono-api-reference`) apontando para `/openapi.json`, título "Standwise API". Até a Task 20 existir, `GET /docs` redireciona para `/docs/api`.
- Toda rota documentada tem: `summary`, `description` (pt-BR e en no mesmo texto, en primeiro), schema de request e response com `example`, e **todas** as respostas de erro possíveis (`401`, `404`, `409`, `422`, `429`) com o schema `Error` e um exemplo de cada `code`.
- Os guias em `docs/api/guides/*.md` são importados como texto e montados na `description` do documento (seções `## Authentication`, `## Integrating an AI agent` etc.), para aparecerem no `/docs`. Conteúdo mínimo:
  - `authentication.md`: API key `swk_` (Task 17): criação pelo admin, escopos, revogação e boas práticas de armazenamento.
  - `ai-agents.md`: "Agentes de IA escrevem a daily pelo MCP ou pela skill, não pela API". Traz o porquê (confirmação explícita da pessoa garantida num só lugar), um link para `mcp.md` (Task 19) e para a skill do Claude Code (Task 14), e a configuração do MCP pronta para Cursor, Codex, Claude Desktop e VS Code.
  - `errors.md`: envelope `{ error: { code, message, issues? } }` e tabela de todos os `code` com status HTTP e o que fazer.
  - `pagination.md`: cursor opaco (`cursor`/`next_cursor`, `limit` de 1 a 100, padrão 50).
  - `rate-limits.md`: limites e headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`.
  - `versioning.md`: `/v1` estável; campos novos podem aparecer; mudança incompatível só em `/v2`, com aviso de 90 dias no changelog.
- Rate limit: janela fixa de 60 s em Postgres, por token (hash) ou por IP quando não há token. Limites: sessões 120/min, API keys 600/min, `POST /v1/sessions` 10/min por IP. Excedeu → `429 rate_limited` com `Retry-After`.

- [ ] **Step 1: Write the failing tests:**
  - `openapi is valid` → `GET /openapi.json` responde 200, `openapi === "3.1.0"`, e o documento passa no validador (`@seriousme/openapi-schema-validator` ou equivalente).
  - `every public route documented` → cada rota pública registrada aparece em `paths`, e cada operação tem `summary`, `description`, ao menos um `example` de resposta 2xx e as respostas de erro listadas acima.
  - `guides embedded` → `info.description` contém `## AI agents` e aponta para o MCP.
  - `internal routes hidden` → `/openapi.json` não contém `/v1/sessions`, `/v1/draft` nem `/v1/dailies`; `/openapi.internal.json` sem sessão dá 401 e, com sessão, contém as três.
  - `docs page` → `GET /docs/api` responde 200 HTML e referencia `/openapi.json`.
  - `rate limit` → a 11ª chamada a `POST /v1/sessions` do mesmo IP em 60 s dá 429 com `Retry-After`; os headers `RateLimit-*` aparecem nas respostas 2xx.
  - Todos os testes existentes de `v1` e `webhooks` continuam passando sem mudar as asserções de comportamento.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): openapi 3.1, /docs reference, integrator guides and rate limits`

### Task 17: API keys da instalação e endpoints de leitura

**Files:**
- Create: `packages/db/src/repo/api-keys.ts` (tabela `api_keys`: `id uuid pk`, `installation_id` (FK, cascata), `name`, `prefix text` (primeiros 8 caracteres, para exibir), `secret_hash text unique` (sha256 hex), `scopes text[]`, `created_by uuid` (member), `created_at`, `last_used_at null`, `revoked_at null`, com migração), `apps/api/src/routes/org.ts`, `apps/api/src/middleware/api-key.ts`, `apps/api/src/services/admin.ts`
- Modify: `apps/api/src/web/setup.tsx`, `apps/api/src/routes/web.tsx` (seção "API keys": criar, listar e revogar), `docs/api/guides/authentication.md`, `docs/api/CHANGELOG.md`
- Test: `packages/db/test/api-keys.test.ts`, `apps/api/test/org.test.ts`, `apps/api/test/admin.test.ts`

**Interfaces:**
  ```ts
  type ApiKeyScope = 'teams:read'|'dailies:read'|'digests:read'|'blockers:read'
  createApiKey(db, p: { installationId: number; name: string; scopes: ApiKeyScope[]; createdBy: string }): Promise<{ id: string; key: string }> // key = "swk_" + 32 bytes base64url; só o hash é gravado; o texto puro aparece uma única vez
  resolveApiKey(db, key: string): Promise<{ id: string; installationId: number; scopes: ApiKeyScope[] } | null> // ignora revogadas; atualiza last_used_at
  listApiKeys(db, installationId: number): Promise<{ id; name; prefix; scopes; createdAt; lastUsedAt; revokedAt }[]>
  revokeApiKey(db, installationId: number, id: string): Promise<boolean>
  isInstallationAdmin(deps, installationId: number, login: string): Promise<boolean> // User: login === dono da conta; Organization: GET /orgs/{org}/memberships/{login} com role === 'admin'
  ```
- Rotas (`security: apiKey`, tag `Organization`, todas com escopo da instalação da key, paginadas por cursor e documentadas como na Task 16):
  - `GET /v1/org/teams` (`teams:read`) → times do config: `name`, `timezone`, `workdays`, `remindAt`, `digestAt`, `memberLogins`.
  - `GET /v1/org/dailies?date=&team=&cursor=&limit=` (`dailies:read`) → `{ data: [{ id, login, date, submittedAt, teams, yesterday, today, blockers }], next_cursor }`.
  - `GET /v1/org/dailies/{id}` (`dailies:read`).
  - `GET /v1/org/digests?team=&from=&to=&cursor=` (`digests:read`) → `{ data: [{ team, date, status, sentAt, missing: string[] }] }`.
  - `GET /v1/org/blockers?date=&team=&cursor=` (`blockers:read`) → impedimentos **confirmados** extraídos das dailies: `{ text, ref, author, date, teams }`.
  - Sem key, key inválida ou revogada → 401. Escopo ausente → `403 insufficient_scope`, com `required_scope` no `error`. Nenhuma rota devolve sugestões, contagens por pessoa ou rankings.
- Setup page: só um admin (`isInstallationAdmin`) vê e usa a seção. Ao criar a key, o texto puro aparece uma vez, com o aviso "copie agora". A lista mostra prefixo, escopos, criação, último uso e o botão revogar. Os formulários POST usam um token CSRF ligado à sessão web.

- [ ] **Step 1: Write the failing tests:**
  - `key stored as hash` → a tabela não contém o texto puro; `resolveApiKey` com a key certa devolve a instalação.
  - `revoked key rejected` → 401.
  - `scope enforced` → key só com `teams:read` em `/v1/org/dailies` dá 403 `insufficient_scope`.
  - `tenant isolation` → key da instalação A nunca vê dailies da B, mesmo passando `team` de B.
  - `pagination` → 120 dailies com `limit=50` dão 3 páginas sem repetição nem perda.
  - `no surveillance fields` → as respostas não têm chaves fora do schema documentado (o teste valida contra o schema OpenAPI da rota com `additionalProperties: false`).
  - `only admins manage keys` → membro comum no `/setup` não vê a seção e recebe 403 no POST; admin cria e a key aparece uma única vez.
  - `csrf required` → POST de criação sem o token CSRF dá 403.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): installation api keys and read-only organization endpoints`

### Task 18: Webhooks de saída

**Files:**
- Create: `packages/db/src/repo/webhooks.ts` (tabelas `webhook_endpoints`: `id uuid pk`, `installation_id` (FK, cascata), `url`, `secret_ciphertext`, `events text[]`, `active bool`, `created_at`; e `webhook_deliveries`: `id uuid pk`, `endpoint_id` (FK, cascata), `event`, `event_id uuid`, `payload jsonb`, `status ('pending'|'delivered'|'failed')`, `attempts int`, `next_attempt_at`, `last_status_code int null`, `last_error text null`, `created_at`; `unique(endpoint_id, event_id)`; com migração), `packages/orchestrator/src/events.ts`, `packages/orchestrator/src/webhook-sign.ts`, `packages/orchestrator/src/safe-fetch.ts`, `apps/worker/src/jobs/deliver-webhook.ts`, `docs/api/guides/webhooks.md`
- Modify: `apps/api/src/routes/v1.ts` (emitir `daily.submitted` e `blocker.opened`), `apps/worker/src/jobs/send-digest.ts` (emitir `digest.sent`), `apps/worker/src/main.ts`, `apps/api/src/routes/web.tsx` e `apps/api/src/web/setup.tsx` (seção "Webhooks": criar, listar, desativar, "enviar evento de teste", últimas 20 entregas), `apps/api/src/openapi/document.ts` (seção `webhooks` do OpenAPI 3.1, com o payload de cada evento), `docs/api/CHANGELOG.md`
- Test: `packages/orchestrator/test/{webhook-sign,safe-fetch,events}.test.ts`, `apps/worker/test/deliver-webhook.test.ts`, `apps/api/test/webhooks-admin.test.ts`

**Interfaces:**
  ```ts
  type WebhookEvent =
    | { type: 'daily.submitted'; data: { id: string; login: string; date: string; teams: string[]; yesterday: Item[]; today: Item[]; blockers: Item[]; replaced: boolean } }
    | { type: 'blocker.opened'; data: { dailyId: string; login: string; date: string; text: string; ref?: Ref; teams: string[] } }
    | { type: 'digest.sent'; data: { team: string; date: string; submitted: string[]; missing: string[] } }
  type Envelope = { id: string; type: WebhookEvent['type']; created_at: string; installation: { id: number; login: string }; data: WebhookEvent['data'] }
  function emitEvent(deps: Deps, installationId: number, event: WebhookEvent): Promise<void> // cria 1 delivery por endpoint ativo inscrito e enfileira 'deliver-webhook'
  function signWebhook(secret: string, body: string, t: number): string                     // "t=<t>,v1=<hex hmac-sha256(secret, `${t}.${body}`)>"
  function verifyWebhookSignature(secret: string, body: string, header: string, now: number, toleranceSeconds?: number): boolean // padrão 300 s, comparação em tempo constante
  function safeFetch(url: string, init: RequestInit, opts?: { resolve?: (host: string) => Promise<string[]>; fetch?: typeof fetch; timeoutMs?: number }): Promise<Response>
  ```
  - Envio: `POST` com JSON, headers `Standwise-Signature`, `Standwise-Event`, `Standwise-Delivery` (id da delivery), `User-Agent: Standwise-Webhooks/1`. Timeout de 10 s, sem seguir redirects. Qualquer resposta 2xx conta como entregue.
  - Retentativas: até 8 tentativas com backoff (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h), via `startAfter` da fila. Depois disso, `failed`. Um endpoint com 20 falhas seguidas é desativado e a falha aparece no setup.
  - `safeFetch`: só `https:`; resolve o DNS e recusa IPs privados, de loopback, link-local, CGNAT, multicast e metadata (`169.254.169.254`), em IPv4 e IPv6; conecta ao IP validado, sem resolver de novo (contra DNS rebinding).
  - O segredo do endpoint (`whsec_` + 32 bytes) aparece uma única vez na criação e fica criptografado com AES-256-GCM (mesma chave da Task 5).
  - Só admins (`isInstallationAdmin`) gerenciam webhooks; os formulários usam CSRF, como na Task 17.
  - O `daily.submitted` com `replaced: true` sai quando a pessoa reenvia no mesmo dia. `blocker.opened` sai uma vez por impedimento novo, comparando o texto normalizado com o da versão anterior da daily.
  - `webhooks.md`: lista de eventos com payload de exemplo, cabeçalhos, verificação da assinatura com código completo em **TypeScript (Node/Bun) e Python**, idempotência pelo `id` do envelope, política de retentativas e como testar com "enviar evento de teste".

- [ ] **Step 1: Write the failing tests:**
  - `signature roundtrip` → `verifyWebhookSignature` aceita a própria assinatura, recusa body alterado, segredo errado e `t` fora da tolerância.
  - `ssrf blocked` → `http://`, `https://127.0.0.1`, `https://10.0.0.5`, `https://[::1]`, `https://169.254.169.254` e um host cujo resolver fake devolve `192.168.1.10` são todos recusados sem chamar o `fetch`.
  - `delivery succeeds` → o servidor fake recebe o POST com os 4 headers, e a assinatura verifica com o segredo do endpoint.
  - `retry with backoff` → 500 reagenda com `startAfter` de +1 min; na 8ª falha fica `failed`.
  - `no duplicate per event` → emitir o mesmo `event_id` duas vezes cria uma delivery por endpoint.
  - `events emitted` → `POST /v1/dailies` com 1 impedimento gera `daily.submitted` e `blocker.opened`; reenviar com o mesmo impedimento gera só `daily.submitted` com `replaced: true`; `sendDigest` gera `digest.sent`.
  - `tenant isolation` → um endpoint da instalação A nunca recebe evento da B.
  - `admin only and csrf` → membro comum recebe 403; POST sem CSRF recebe 403.
  - `openapi webhooks` → `GET /openapi.json` tem `webhooks` com os 3 eventos.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(webhooks): signed outbound webhooks with retries and ssrf protection`

### Task 19: Servidor MCP local (`standwise mcp`)

**Files:**
- Create: `apps/cli/src/commands/mcp.ts`, `apps/cli/src/mcp/tools.ts`, `docs/api/guides/mcp.md`
- Modify: `apps/cli/src/main.ts` (subcomando `mcp`), `apps/cli/package.json` (`@modelcontextprotocol/sdk`), `docs/api/CHANGELOG.md`, `README.md` (seção "Usar com Cursor, Codex, Claude Desktop…")
- Test: `apps/cli/test/mcp.test.ts` (cliente MCP do SDK conectado por transporte em memória; API falsa com `Bun.serve`)

**Interfaces:**
- `standwise mcp` sobe um servidor MCP por **stdio** (nome `standwise`, versão do pacote) e usa as credenciais gravadas pelo `standwise login`. Sem login, toda tool responde com erro instruindo a rodar `standwise login`.
- Tools (com `inputSchema` e `outputSchema` em JSON Schema derivados dos schemas Zod existentes; descrições em en):
  - `standwise_whoami` → `{ login, orgs }`.
  - `standwise_get_draft` `{ org?: string }` → o JSON de `GET /v1/draft`. Com org ambígua, devolve erro listando as orgs.
  - `standwise_submit_daily` `{ org?: string; yesterday; today; blockers; confirmed: true }` → `POST /v1/dailies`. O campo `confirmed` é obrigatório e precisa ser o literal `true`. A descrição da tool diz que o agente **deve mostrar a daily final à pessoa e obter confirmação explícita** antes de chamar; com qualquer outro valor, a tool recusa sem chamar a API.
- **Tools de gestor (decisão do Felipe, 2026-10-28)**, apoiadas em rotas **internas** novas `GET /v1/manage/teams`, `/v1/manage/digests`, `/v1/manage/dailies` e `/v1/manage/blockers`. As rotas usam sessão `sw_`, ficam no `/openapi.internal.json` e reusam os casos de uso de leitura da Task 17, com autorização própria:
  - `canReadTeam(deps, installationId, member, team)` → verdadeiro se o login (atual, por id) está em `managers` do time no config, ou se a pessoa é admin da instalação (`isInstallationAdmin`). Caso contrário, `403 forbidden`.
  - Histórico limitado a **90 dias** a partir de hoje no fuso do time. Fora disso, `422 invalid_request`.
  - Mesmos dados das rotas de API key: só o que foi confirmado, sem sugestões nem agregados por pessoa.
  - Tools MCP: `standwise_list_teams` (só os times que a pessoa pode ler), `standwise_get_digest { org?, team, date }`, `standwise_list_dailies { org?, team, from, to }` e `standwise_list_blockers { org?, team, from?, to? }`.
  - As `instructions` do servidor MCP dizem que os dados servem para destravar o time (impedimentos, contexto, resumos do time). Dizem também que o Standwise não oferece nem incentiva comparação, ranking ou avaliação individual.
  - Testes: um gestor de `backend` lê `backend` e recebe 403 em `platform`; um admin lê os dois; um membro comum recebe 403; a janela de 90 dias é respeitada; as tools listam e devolvem os dados da API falsa.
- Prompt MCP `daily` com o mesmo fluxo da skill da Task 14 (rascunho → perguntar "hoje" e impedimentos → confirmar → enviar), para clientes que suportam prompts.
- **Idioma (decisão do Felipe, 2026-10-28):** descrições de tools, `instructions` do servidor e mensagens de erro ficam em inglês, com `code` estável. As `instructions` e o prompt `daily` mandam o agente **conversar no idioma da pessoa** e **nunca traduzir nem reescrever** o texto da daily: o que a pessoa disser vai como ela disse. Teste: o texto do prompt `daily` contém essas duas regras.
- `mcp.md`: configuração pronta para copiar em Claude Desktop, Cursor, Codex e VS Code (`{"command": "standwise", "args": ["mcp"]}`), as tools e a regra de confirmação.
- Fase 2 (fora deste plano): MCP remoto em `/mcp` (Streamable HTTP + OAuth 2.1).

- [ ] **Step 1: Write the failing tests:**
  - `lists tools` → `tools/list` devolve as 3 tools com `inputSchema`.
  - `draft passthrough` → `standwise_get_draft` devolve o JSON da API falsa.
  - `submit requires confirmation` → sem `confirmed`, ou com `confirmed: false`, dá erro e a API falsa não recebe nada; com `confirmed: true`, recebe o POST.
  - `not logged in` → sem credenciais, as tools devolvem erro com "standwise login".
  - `daily prompt` → `prompts/get daily` devolve mensagens que citam a confirmação explícita.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(cli): local mcp server with draft and confirmed submit tools`

### Task 20: Site de documentação completo (`/docs`)

**Files:**
- Create: `docs/site/` (VitePress): `.vitepress/config.ts` (pt-BR como padrão e en via i18n do VitePress, sidebar, busca local, logo SVG da marca, cores `#3B4BC8`/`#15171C`), e as páginas em pt-BR e en (`docs/site/<página>.md` e `docs/site/en/<página>.md`):
  - `index.md`: **Overview**.
    - O que é o Standwise e o problema que resolve: dailies soltas, gestor sem visão consolidada, ninguém orquestrando.
    - Para quem é: membro, gestor e admin.
    - Como funciona, em diagrama: agente/skill/MCP → API → consolidado no Slack, com lembrete, encaminhamento e sugestões.
    - O que **não** é (vigilância, métricas de produtividade).
    - Links de "comece aqui" por perfil.
  - `concepts.md`: glossário com instalação, organização, time, membro, gestor, admin, daily, "ontem/hoje/impedimentos", rascunho, consolidado, daily atrasada (thread), lembrete, impedimento sugerido, encaminhamento, entrega, API key e webhook.
  - `how-it-works.md`: o ciclo de um dia com horários de exemplo:
    - rascunho a partir do GitHub;
    - lembrete no `remind_at`;
    - consolidado no `digest_at`;
    - atrasadas na thread;
    - encaminhamento de impedimentos (PR → revisores/CODEOWNERS; card → bloqueador; senão gestor);
    - fuso, dias úteis e pessoa em vários times.
  - `privacy.md`: o que é lido no GitHub, Slack e Linear, o que é guardado (com criptografia), o que **nunca** é feito, quem vê o quê, retenção, remoção de dados ao desinstalar e o e-mail de suporte.
  - `admin/install.md`: passo a passo para instalar o GitHub App, abrir a página de setup, conectar o Slack, criar o `standwise.yml` (link pré-preenchido) e resolver os estados "não configurado" e "inválido".
  - `admin/configuration.md`: referência **completa** do `standwise.yml`. Cada chave com tipo, padrão, exemplo e erros de validação comuns (com a mensagem real do check run). Inclui o exemplo da spec §4.4, times do GitHub (`@org/slug`) e mapeamento manual de identidades.
  - `admin/slack.md`: permissões do bot, canais privados (convidar o bot) e a tabela dos erros de entrega com a solução de cada um.
  - `admin/api-keys.md` e `admin/webhooks.md`: criação, escopos, rotação e revogação.
  - `members/getting-started.md`: instalar a CLI, `standwise login`, `/daily` no Claude Code e o que acontece depois de enviar.
  - `members/cli.md`: todos os comandos, flags, códigos de saída e o local das credenciais.
  - `members/claude-code.md`: a skill `/daily`, com o fluxo, a regra de confirmação e exemplos de conversa.
  - `members/mcp.md`: a configuração do `standwise mcp` em Claude Desktop, Cursor, Codex e VS Code, as tools e a confirmação explícita.
  - `api/overview.md`: o que a API pública oferece (leitura e webhooks) e o que não oferece (escrita de daily: use MCP/skill, com o porquê). Inclui os guias da Task 16 (autenticação, erros, paginação, limites, versionamento) e um link para a referência em `/docs/api`.
  - `api/webhooks.md`: o guia da Task 18.
  - `faq.md`, `troubleshooting.md` (problemas mais prováveis: "não recebi lembrete", "meu nome aparece como @login", "consolidado não chegou", "org ambígua", "token expirado") e `changelog.md` (inclui o `docs/api/CHANGELOG.md`).
- Modify: os guias `docs/api/guides/*.md` da Task 16 passam a ser a fonte única. O site os inclui com o `<!--@include: ...-->` do VitePress, e o `/openapi.json` continua montando a `description` a partir deles. O `/docs/api` ganha um link de volta para o site.
- Modify: `apps/api/src/routes/docs.ts` passa a servir o build estático do VitePress em `/docs/*` (com `serveStatic`), e `/docs/api` continua com o Scalar. Mudam também `package.json` (scripts `docs:dev`, `docs:build`) e o `Dockerfile` da Task 15 (o build do site entra na imagem da api). O `README.md` resume o produto e linka o site.
- Test: `apps/api/test/docs-site.test.ts`, mais um script `scripts/check-docs.ts` rodado no CI.

**Regras de conteúdo:**
- Tudo em **pt-BR e en**, com o mesmo conteúdo.
- Exemplos reais e copiáveis (YAML, `curl`, JSON de webhook, config do MCP) que batem com o código. Os exemplos de `standwise.yml` da documentação passam pelo `parseConfig` num teste.
- Sem placeholders vazios. O e-mail de suporte vem de `SUPPORT_EMAIL` no build.
- Tom direto, "você", frases curtas e sem marketing.

- [ ] **Step 1: Write the failing tests:**
  - `site builds` → `bun run docs:build` termina sem erro e sem links quebrados (o `ignoreDeadLinks` do VitePress fica desligado).
  - `served` → `GET /docs/` responde 200 com o título "Standwise"; `GET /docs/en/` responde 200; `GET /docs/api` continua com o Scalar.
  - `config examples valid` → `scripts/check-docs.ts` extrai todo bloco ```yaml de `admin/configuration.md` (pt e en) e todos passam no `parseConfig`.
  - `parity` → cada página em pt-BR tem a equivalente em en, e vice-versa.
  - `overview present` → `index.md` contém as seções "O que é", "Para quem é", "Como funciona" e "O que o Standwise não faz".
- [ ] **Step 2: Run** → FAIL. **Step 3: Write the site.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `docs: complete documentation site with overview, guides and api reference`
