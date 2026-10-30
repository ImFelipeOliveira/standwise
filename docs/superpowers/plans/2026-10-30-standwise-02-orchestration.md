# Standwise — Plano 2: Orquestração

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Standwise passa de "recebe e consolida" para **orquestrador**:
- cobra quem não enviou, com no máximo um lembrete por pessoa por dia;
- encaminha impedimentos a quem pode ajudar;
- sugere impedimentos (PR sem review, CI falhando) só para a própria pessoa;
- valida o `standwise.yml` com um check run no GitHub.

**Architecture:**
- O código segue o plano 1. As regras ficam em casos de uso em `packages/orchestrator/src/use-cases/`, e o worker agenda e executa jobs finos.
- As novas leituras do GitHub entram no adaptador `@standwise/github`. As regras puras (CODEOWNERS, fingerprints de sinal, localização de erro no YAML) entram em `@standwise/core`.
- Os webhooks do GitHub passam a apenas **enfileirar** jobs, nada roda inline. Isso também resolve a pendência do plano 1.
- O Linear fica no plano 3. Este plano deixa a porta `ProjectTracker` pronta com uma implementação nula.

**Tech Stack:** a mesma do plano 1 (Bun, Hono, Drizzle/Postgres, pg-boss, Zod 4, `yaml`, `@octokit/*`, `@slack/web-api`, MCP SDK, VitePress).

**Spec:** `docs/superpowers/specs/2026-10-27-standwise-design.md`, §3 (anti-objetivos), §4.3 (orquestrador), §4.4 (check run) e §6 (permissões).

**Base:** branch `dev` com o plano 1 mergeado. Os nomes de funções e tipos citados como existentes vêm do plano 1; em dúvida, leia o código.

## Global Constraints

- **Sem comentários no código** (TS, TSX, shell, YAML, Dockerfile).
- **Camadas:** regras de negócio em casos de uso, que lançam `DomainError`. Rotas, jobs, CLI e MCP ficam finos. Casos de uso têm testes sem HTTP.
- **I18N:** todo texto visível passa por `t(lang, key)`, com chaves em pt-BR e en (chave faltando é erro de tipo). Sem idioma definido, o padrão é **en**. O chat usa o `language` do time.
- **Anti-vigilância (spec §3):**
  - Sugestões de impedimento vão **primeiro e só** para a própria pessoa.
  - Elas nunca aparecem no consolidado, em `/v1/org/*`, `/v1/manage/*`, webhooks de saída ou na página de setup.
  - O gestor só vê impedimentos que a pessoa confirmou.
  - Nada é enviado em nome da pessoa.
- **Ruído:**
  - No máximo **1 lembrete por pessoa por dia**, mesmo que ela esteja em vários times.
  - Cada sugestão aparece **uma vez**. Se a pessoa ignorar, ela só volta quando o sinal mudar.
  - Cada impedimento é encaminhado **uma vez**; reenviar a daily com o mesmo impedimento não gera outra DM.
- **Multi-tenant:** toda consulta filtra por `installation_id`. Um PR referenciado só é usado se o dono do repositório for a conta da instalação.
- **Permissões do GitHub App:** exatamente as do plano 1 (o manifest já tem `checks: write` e os eventos `pull_request`, `pull_request_review`, `check_suite` e `check_run`). Não adicionar permissões.
- **Padrões de config:**
  - `signals.pr_review_hours: 48`;
  - CI falhando conta a partir de **24 h**;
  - nova chave `signals.direct_message: false`, para que as sugestões também saiam por DM (spec §4.3, "opcionalmente").
- **Testes:** `bun test`, com o Postgres de teste e fakes para GitHub e Slack. Nada de rede real.

## Review Focus

1. **Pessoa sem identidade no Slack** (sem override no config e sem vínculo por e-mail) → o lembrete ou o encaminhamento falha com `no_chat_identity`, que aparece em "entregas com falha" no setup. O tick nunca quebra. *(Tasks 4 e 5)*
2. **Impedimento com link de PR de outro dono, URL malformada ou PR inexistente** → o encaminhamento cai para os gestores do time, sem erro e sem chamar a API para repositórios de fora. *(Task 5)*
3. **Pessoa reenvia a daily com o mesmo impedimento, ou envia depois do lembrete** → nenhuma segunda DM de encaminhamento. Lembrete só para quem ainda não enviou, conferido imediatamente antes de mandar. *(Tasks 4 e 5)*
4. **Sugestão ignorada e varredura rodando de novo** → não reaparece. Só reaparece se o fingerprint mudar (novo head SHA com CI falhando, ou o PR voltar a ficar sem review depois de uma review ser descartada). *(Task 6)*
5. **`remind_at` igual ou depois de `digest_at`** → erro de validação do config. Um lembrete atrasado (worker fora do ar) nunca sai depois que o consolidado do time já foi enviado. *(Tasks 1 e 4)*

---

### Task 1: Config, modelo de sinais e regras puras no core

**Files:**
- Modify: `packages/core/src/config.ts`, `packages/core/src/i18n.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/signals.ts`, `packages/core/src/codeowners.ts`, `packages/core/src/github-ref.ts`, `packages/core/src/config-locate.ts`
- Test: `packages/core/test/{config,signals,codeowners,github-ref,config-locate}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  TeamConfig.signals: { prReviewHours: number; cardStaleDays: number; directMessage: boolean }
  type SignalKind = 'pr_no_review' | 'ci_failing' | 'card_stale'
  type Signal = { kind: SignalKind; ref: Ref; fingerprint: string; since: Date }
  function prNoReviewFingerprint(repo: string, number: number): string
  function ciFailingFingerprint(repo: string, number: number, headSha: string): string
  type PullRequestSnapshot = { repo: string; number: number; url: string; title: string; draft: boolean; readyAt: Date; reviewCount: number; headSha: string; failingChecksSince: Date | null }
  function detectPullRequestSignals(prs: PullRequestSnapshot[], now: Date, prReviewHours: number, ciFailingHours?: number): Signal[]
  type GitHubPullRef = { owner: string; repo: string; number: number }
  function parsePullRequestUrl(url: string): GitHubPullRef | null
  type CodeownersRule = { pattern: string; owners: string[] }
  function parseCodeowners(source: string): CodeownersRule[]
  function ownersForFiles(rules: CodeownersRule[], files: string[]): string[]
  function locateConfigPath(source: string, path: string): { line: number; column: number } | null
  ```

- [ ] **Step 1: Write the failing tests:**
  - `config.test.ts`:
    - `signals.direct_message defaults to false`;
    - `remind_at must be before digest_at` → `remind_at: "10:00"` with `digest_at: "10:00"` gives an error at `teams.0.remind_at`.
  - `signals.test.ts`:
    - an open, non-draft PR with `reviewCount 0` and `readyAt` 49 h ago gives `pr_no_review`; 47 h gives nothing; a draft gives nothing;
    - `failingChecksSince` 25 h ago gives `ci_failing` whose fingerprint contains the `headSha`; 23 h gives nothing;
    - the fingerprints are stable for the same input.
  - `github-ref.test.ts`: `https://github.com/acme/api/pull/412` gives `{owner:'acme',repo:'api',number:412}`; `/pull/412/files`, a trailing `#…` and a `?…` query are accepted; `http://`, another host, `/issues/1` or a non-numeric number give `null`.
  - `codeowners.test.ts`:
    - the last matching rule wins;
    - `*`, `/docs/`, `*.ts`, `apps/**/x` and comments or blank lines are handled;
    - `@acme/backend` and `@alice` are kept as-is, and an email owner is dropped;
    - `ownersForFiles` deduplicates.
  - `config-locate.test.ts`: for the spec §4.4 YAML, `teams.0.digest_at` points to the right line and column; an unknown path gives `null`.
- [ ] **Step 2: Run** `bun test packages/core` → FAIL.
- [ ] **Step 3: Implement.**
  - `locateConfigPath` uses `yaml.parseDocument` with `LineCounter` and the snake_case path that `parseConfig` already reports.
  - `parseCodeowners` follows GitHub's gitignore-style syntax, implementing only `*`, `**`, a leading `/`, a trailing `/` and extensions.
  - Add the i18n keys used by Tasks 4–8 in pt-BR and en:
    - `reminder.title`, `reminder.body`;
    - `blockerRouted.title`, `blockerRouted.body`;
    - `suggestion.pr_no_review`, `suggestion.ci_failing`, `suggestion.card_stale`, `suggestion.dm.title`;
    - `checkRun.success.title`, `checkRun.failure.title`, `checkRun.summary`.
- [ ] **Step 4: Run** → PASS; also `bun run lint` and `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(core): signal model, codeowners, pull request refs and config locations`

### Task 2: Leituras de PR e check run no adaptador GitHub

**Files:**
- Create: `packages/adapters/github/src/pulls.ts`, `packages/adapters/github/src/checks.ts`, `packages/adapters/github/src/codeowners-source.ts`
- Modify: `packages/adapters/github/src/config-source.ts` (accepts `ref`), `packages/adapters/github/src/index.ts`, `packages/orchestrator/src/deps.ts` (add the new functions to `Deps.github`), the fakes in `packages/orchestrator/test/use-cases/fakes.ts` and `apps/api/test/support.ts`
- Test: `packages/adapters/github/test/{pulls,checks,codeowners-source,config-source}.test.ts` with JSON fixtures

**Interfaces:**
- Consumes: `PullRequestSnapshot`, `GitHubPullRef` (Task 1)
- Produces:
  ```ts
  type PullRequestDetail = { ref: GitHubPullRef; url: string; title: string; author: string; state: 'open' | 'closed'; draft: boolean; headSha: string; baseRef: string; requestedReviewers: string[]; requestedTeams: string[] }
  function getPullRequest(octokit: Octokit, ref: GitHubPullRef): Promise<PullRequestDetail | null>
  function listPullRequestFiles(octokit: Octokit, ref: GitHubPullRef): Promise<string[]>
  function listOpenPullRequestSnapshots(octokit: Octokit, owner: string, ownerType: 'Organization' | 'User', author: string): Promise<PullRequestSnapshot[]>
  function fetchCodeowners(octokit: Octokit, owner: string, repo: string, ref: string): Promise<string | null>
  type CheckRunInput = { owner: string; repo: string; headSha: string; name: string; conclusion: 'success' | 'failure'; title: string; summary: string; annotations: { path: string; line: number; message: string }[] }
  function createCheckRun(octokit: Octokit, input: CheckRunInput): Promise<void>
  function fetchConfigSource(octokit: Octokit, owner: string, options?: { ref?: string }): Promise<ConfigSource>
  ```
  - `listOpenPullRequestSnapshots`:
    - search: `is:pr is:open draft:false author:<login> org:<owner>` (`user:` for User accounts), at most 30;
    - for each PR: `GET /repos/{o}/{r}/pulls/{n}/reviews` gives `reviewCount`, counting only reviews in state `APPROVED`, `CHANGES_REQUESTED` or `COMMENTED`;
    - `readyAt` is the `ready_for_review` time when present (timeline `ready_for_review`), otherwise `created_at`;
    - `failingChecksSince` comes from `GET /repos/{o}/{r}/commits/{sha}/check-runs`: the earliest `completed_at` among runs with `conclusion` `failure` or `timed_out`, while no run with the same name succeeded later; otherwise `null`.
  - `fetchCodeowners` tries `.github/CODEOWNERS`, then `CODEOWNERS`, then `docs/CODEOWNERS`. A 404 on every path gives `null`.
  - `createCheckRun` POSTs to `/repos/{o}/{r}/check-runs` with `status: 'completed'` and at most 50 annotations, all with `annotation_level: 'failure'`.

- [ ] **Step 1: Write the failing tests** using the existing fake fetch and fixtures:
  - `getPullRequest` maps requested users and teams, and a 404 gives `null`;
  - `listPullRequestFiles` paginates (`per_page=100`) up to 30 pages;
  - snapshots: a PR with only a `DISMISSED` review counts as 0 reviews; a later green run of the same check clears `failingChecksSince`; the query uses `user:` for User accounts;
  - `fetchCodeowners` falls back to the second path, and three 404s give `null`;
  - `createCheckRun` sends the exact body and truncates annotations to 50;
  - `fetchConfigSource` with `ref` sends `?ref=<sha>`, and without `ref` the behaviour is unchanged.
- [ ] **Step 2: Run** `bun test packages/adapters/github` → FAIL.
- [ ] **Step 3: Implement.** Update `Deps.github` and both fakes so that later tasks can inject PR, review, check and file fixtures through `fakeDeps({ pulls, files, codeowners, checks })`.
- [ ] **Step 4: Run** → PASS, then the full `bun test`.
- [ ] **Step 5: Commit** `feat(github): pull request, review, checks and codeowners reads; check runs`

### Task 3: Persistência de sugestões e novos tipos de entrega

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/repo/deliveries.ts`, `packages/db/src/index.ts`, `packages/db/test/setup.ts` (truncate the new table)
- Create: `packages/db/src/repo/suggestions.ts`, a migration (`cd packages/db && bun run generate`)
- Test: `packages/db/test/suggestions.test.ts`, `packages/db/test/repo.test.ts`

**Interfaces:**
- Consumes: `Signal`, `SignalKind` (Task 1)
- Produces:
  ```ts
  table suggestions: id uuid pk; installation_id (fk cascade); member_id (fk members cascade); kind text; ref jsonb Ref; fingerprint text; state 'pending'|'confirmed'|'ignored'|'resolved'; created_at; decided_at null; notified_at null; unique(installation_id, member_id, fingerprint)
  DeliveryKey.kind: 'digest' | 'late_daily' | 'reminder' | 'blocker_route' | 'suggestion_dm'
  type SuggestionRow = { id: string; kind: SignalKind; ref: Ref; fingerprint: string; state: 'pending'|'confirmed'|'ignored'|'resolved'; createdAt: Date }
  function syncSuggestions(db: Db, installationId: number, memberId: string, kinds: SignalKind[], signals: Signal[]): Promise<{ created: SuggestionRow[] }>
  function listPendingSuggestions(db: Db, installationId: number, memberId: string): Promise<SuggestionRow[]>
  function decideSuggestion(db: Db, installationId: number, memberId: string, id: string, decision: 'confirmed' | 'ignored'): Promise<boolean>
  function confirmSuggestionsByUrl(db: Db, installationId: number, memberId: string, urls: string[]): Promise<number>
  function markSuggestionNotified(db: Db, id: string): Promise<boolean>
  ```
  - `syncSuggestions`:
    - inserts each new fingerprint as `pending`;
    - never revives an existing row, whatever its state;
    - marks `resolved` every `pending` row of those `kinds` whose fingerprint is not in `signals`;
    - returns only the rows created in this call.
  - Person-level deliveries (`reminder`, `suggestion_dm`) use `teamName: ''`.
- [ ] **Step 1: Write the failing tests:**
  - an ignored suggestion stays ignored after a sync with the same fingerprint;
  - a new fingerprint creates a new row;
  - a pending row is resolved when its signal disappears, and a pending row of another kind is not touched;
  - `decideSuggestion` on another member's suggestion returns `false`;
  - `confirmSuggestionsByUrl` confirms only that member's pending rows with the same `ref.url`;
  - tenant isolation;
  - `claimDelivery` with `kind 'reminder'` and `teamName ''` is exclusive per login and day.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, including the migration. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(db): suggestions and person-level delivery kinds`

### Task 4: Lembrete para quem não enviou

**Files:**
- Create: `packages/orchestrator/src/use-cases/send-reminder.ts`, `packages/orchestrator/src/chat-identity.ts`, `packages/core/src/reminder.ts`, `apps/worker/src/jobs/send-reminder.ts`
- Modify: `packages/orchestrator/src/use-cases/run-tick.ts`, `packages/orchestrator/src/use-cases/send-digest.ts` and `send-late-daily.ts` (reuse `chatUserIdFor`), `apps/worker/src/main.ts`, the fakes (`fakeChat().sendDirect` records DMs instead of throwing)
- Test: `packages/orchestrator/test/use-cases/{send-reminder,run-tick}.test.ts`, `packages/core/test/reminder.test.ts`

**Interfaces:**
- Consumes: `isDue`, `isWorkday`, `localDate`, `addCalendarDays`, `teamsForMember`, `resolveTeams`, `listDailies`, `claimDelivery`/`completeDelivery`/`failDelivery`, `getDelivery`, `memberOverrides`, `getIdentities`, `ChatChannel.sendDirect`
- Produces:
  ```ts
  function chatUserIdFor(deps: Pick<Deps,'db'>, installationId: number, config: StandwiseConfig, login: string): Promise<string | null>
  function buildReminder(input: { team: TeamConfig; date: string; digestAt: string }): Message
  type SendReminderJob = { installationId: number; login: string; date: string }
  function sendReminder(deps: WorkerDeps, job: SendReminderJob): Promise<void>
  job 'send-reminder'
  ```
  - `chatUserIdFor` returns the config override (`members.<login>.slack`), then the `member_identities` value, then `null`. `sendDigest` and `sendLateDaily` switch to it with no behaviour change.
  - `runTick`: for each operational installation, each team, and `date ∈ {today, yesterday}` (same rule as the digest), when `isWorkday(date)` and `isDue(now, date, team.remindAt, tz, 60)`, enqueue `send-reminder` for every lowercased login in `team.memberLogins` that has no daily for `date`. Use `singletonKey "reminder:<inst>:<login>:<date>"`. Skip the whole team when its `digest` delivery for `date` is already `sent`.
  - `sendReminder`:
    1. Re-check right before sending, and skip silently without claiming if any of these hold:
       - the person already has a daily for `date` (match by login through `listDailies`);
       - every team of the person on that date already had its digest `sent`;
       - the person is no longer in any team.
    2. `claimDelivery({ kind: 'reminder', teamName: '', subject: login })`.
    3. If there is no chat id, call `failDelivery(…, 'no_chat_identity: …')` and do not rethrow.
    4. Otherwise `sendDirect(id, buildReminder(...))`, using the first team that has the person (config order) for the language and `digest_at`.
- [ ] **Step 1: Write the failing tests:**
  - at 09:00 local on a workday, one job per missing member; at 08:59 none; on a weekend none;
  - a person in two teams with different `remind_at` gets exactly one DM;
  - submitting between enqueue and send produces no DM;
  - a person without a chat id gets a failed delivery `no_chat_identity…`, and the next people are still processed;
  - a delayed tick at 10:30, after the digest was sent at 10:00, sends no reminder;
  - `buildReminder` in en and pt-BR includes the `digest_at` time and the `/daily` hint.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: daily reminder for people who have not sent their daily`

### Task 5: Encaminhamento de impedimentos

**Files:**
- Create: `packages/orchestrator/src/use-cases/route-blocker.ts`, `packages/orchestrator/src/project-tracker.ts`, `packages/core/src/blocker-routed.ts`, `apps/worker/src/jobs/route-blocker.ts`
- Modify: `packages/orchestrator/src/use-cases/submit-daily.ts` (enqueue one job per new blocker, using the existing `newBlockers`), `packages/orchestrator/src/deps.ts` (`tracker`), `apps/worker/src/main.ts`, `apps/api/src/main.ts` (wire `nullTracker`)
- Test: `packages/orchestrator/test/use-cases/route-blocker.test.ts`, `submit-daily.test.ts`

**Interfaces:**
- Consumes: `parsePullRequestUrl`, `parseCodeowners`, `ownersForFiles` (Task 1); `getPullRequest`, `listPullRequestFiles`, `fetchCodeowners`, `resolveTeamMembers` (Task 2); `chatUserIdFor` (Task 4)
- Produces:
  ```ts
  interface ProjectTracker { blockingAssignee(installationId: number, ref: Ref): Promise<string | null> }
  const nullTracker: ProjectTracker
  Deps.tracker: ProjectTracker   (also add 'tracker' to the WorkerDeps Pick)
  type RouteBlockerJob = { installationId: number; dailyId: string; blockerIndex: number }
  type RouteTarget = { reason: 'pr_reviewers' | 'codeowners' | 'card_blocker' | 'manager'; logins: string[] }
  function resolveRouteTarget(deps: WorkerDeps, ctx: { installationId: number; owner: string; config: StandwiseConfig; author: string; firstTeam: ResolvedTeam; blocker: Item }): Promise<RouteTarget>
  function routeBlocker(deps: WorkerDeps, job: RouteBlockerJob): Promise<void>
  function buildBlockerRouted(input: { lang: Language; author: Person; blocker: Item; reason: RouteTarget['reason']; date: string }): Message
  job 'route-blocker'
  ```
  - `resolveRouteTarget`, in order (spec §4.3), always removing the author:
    1. If `ref.kind === 'pull_request'` and `parsePullRequestUrl(url).owner` equals the installation owner, case-insensitive:
       - use `requestedReviewers` plus the members of `requestedTeams` (via `resolveTeamMembers`);
       - if that is empty, use the CODEOWNERS of the PR files at the base ref (teams expanded);
       - if that is still empty, continue to the next rule.
    2. If `ref.kind === 'card'`, use `deps.tracker.blockingAssignee`. `nullTracker` returns `null`, and Linear plugs in here in plan 3.
    3. Otherwise, use the `managers` of the author's first team.
  - Cap the result at **5 logins**. When none of the chosen logins has a chat id, fall back to the managers.
  - `routeBlocker`:
    - load the daily with `getDailyById` (tenant scoped); a missing daily or index means return;
    - for each target login, `claimDelivery({ kind: 'blocker_route', teamName: '', subject: dailyId + ':' + normalizedBlockerHash + ':' + login })`, then `sendDirect`;
    - a missing chat id gives `failDelivery` with `no_chat_identity`;
    - the DM is in the language of the author's first team and links to the PR or card and to the daily's date.
  - `submitDaily`: the existing `newBlockers(previous, current)` decides which blockers are new. Enqueue `route-blocker` per new blocker with `singletonKey "route:<dailyId>:<hash>"`. A failure to enqueue never breaks the submit (log and continue).
- [ ] **Step 1: Write the failing tests:**
  - a PR with requested reviewer `carla` routes to `carla`;
  - a PR with no reviewers routes to the CODEOWNERS of the changed files, with `@acme/backend` expanded;
  - the PR author is never included;
  - a PR of another owner, a malformed URL or a 404 PR routes to the managers without calling `getPullRequest` for the foreign owner;
  - a card ref with `nullTracker` routes to the managers;
  - targets are capped at 5;
  - resubmitting the same blocker on the same day enqueues nothing new and sends no new DM;
  - a target without a chat id makes the delivery fail as `no_chat_identity`;
  - the DM text in en and pt-BR contains the blocker text and the link;
  - an exception in the enqueue does not fail `submitDaily`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: route blockers to reviewers, codeowners or managers`

### Task 6: Impedimentos sugeridos (varredura e tempo real)

**Files:**
- Create: `packages/orchestrator/src/use-cases/scan-member-signals.ts`, `packages/orchestrator/src/use-cases/notify-suggestions.ts`, `apps/worker/src/jobs/scan-member-signals.ts`
- Modify: `packages/orchestrator/src/use-cases/run-tick.ts`, `packages/orchestrator/src/use-cases/handle-github-event.ts` (PR, review and check events enqueue a scan), `apps/worker/src/main.ts`
- Test: `packages/orchestrator/test/use-cases/{scan-member-signals,run-tick,handle-github-event}.test.ts`

**Interfaces:**
- Consumes: `detectPullRequestSignals` (Task 1); `listOpenPullRequestSnapshots` (Task 2); `syncSuggestions` and `markSuggestionNotified` (Task 3); `chatUserIdFor` (Task 4)
- Produces:
  ```ts
  type ScanMemberSignalsJob = { installationId: number; login: string }
  function scanMemberSignals(deps: WorkerDeps, job: ScanMemberSignalsJob): Promise<void>
  job 'scan-member-signals'
  ```
  - `scanMemberSignals`:
    - only for logins with a `members` row that is in some team (a person never logged in has nowhere to see suggestions);
    - `prReviewHours` comes from the person's first team;
    - call `syncSuggestions(..., ['pr_no_review','ci_failing'], signals)`;
    - when the first team has `signals.directMessage`, send a DM for each **created** suggestion. Use `claimDelivery({ kind: 'suggestion_dm', teamName: '', subject: fingerprint })` and `markSuggestionNotified`. The DM goes **only** to the person.
  - `runTick`: once per installation, team and workday, when `isDue(now, date, remindAt − 60 min, tz, 60)`, enqueue `scan-member-signals` per member login with `singletonKey "scan:<inst>:<login>:<date>"`. If `remindAt` is before 01:00, use 00:00.
  - `handleGitHubEvent` enqueues `scan-member-signals` for the PR author (only if the author is a team member of that installation's config) on:
    - `pull_request` (opened, ready_for_review, synchronize, closed, reopened);
    - `pull_request_review` (submitted, dismissed);
    - `check_suite` (completed), for each PR in `check_suite.pull_requests`.
    Use `singletonKey "scan:<inst>:<login>"`. The handler only enqueues.
- [ ] **Step 1: Write the failing tests:**
  - a PR open for 49 h with no review creates one pending `pr_no_review`; running the scan again creates nothing new;
  - after `decideSuggestion(ignored)`, a rescan does not revive it;
  - a new review resolves it;
  - CI failing for 25 h on sha A creates `ci_failing`; a push to sha B, still failing, creates a new suggestion only after 24 h on B;
  - `directMessage: true` sends one DM per created suggestion and none on rescan; `false` sends no DM;
  - a `pull_request_review` webhook for a member enqueues a scan; for a non-member it does not;
  - the tick enqueues the scan at `remind_at − 60 min`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: suggested blockers from pull request reviews and failing checks`

### Task 7: Sugestões no rascunho, decisões, CLI, MCP e skill

**Files:**
- Modify:
  - `packages/orchestrator/src/use-cases/get-draft.ts` (suggestions);
  - `submit-daily.ts` (`confirmSuggestionsByUrl` with the URLs of the submitted blockers);
  - `apps/api/src/openapi/schemas.ts` (`DraftSchema.suggestions` becomes objects);
  - `apps/api/src/routes/v1.ts` (new internal route);
  - `apps/cli/src/api.ts`, `apps/cli/src/commands/` (new command), `apps/cli/src/mcp/tools.ts`;
  - `packages/plugin/skills/daily/SKILL.md`;
  - `docs/api/guides/mcp.md`.
- Create: `packages/orchestrator/src/use-cases/decide-suggestion.ts`, `apps/cli/src/commands/suggestion.ts`
- Test: `packages/orchestrator/test/use-cases/{get-draft,decide-suggestion,submit-daily}.test.ts`, `apps/api/test/v1.test.ts`, `apps/cli/test/{cli,mcp}.test.ts`, `packages/plugin/test/plugin.test.ts`, plus an anti-surveillance test file `apps/api/test/no-suggestion-leak.test.ts`

**Interfaces:**
- Consumes: `listPendingSuggestions`, `decideSuggestion`, `confirmSuggestionsByUrl` (Task 3)
- Produces:
  ```ts
  type DraftSuggestion = { id: string; kind: SignalKind; ref: Ref; since: string }
  Draft.suggestions: DraftSuggestion[]
  function decideDraftSuggestion(deps: Deps, isMember: MembershipCheck, member: MemberRow, org: string, id: string, decision: 'confirmed' | 'ignored'): Promise<void>
  POST /v1/suggestions/{id}/decision  body { org, decision }  → 204   (internal, session auth, rate limited; 404 not_found for foreign or unknown ids)
  CLI: standwise suggestion ignore <id> [--org], standwise suggestion confirm <id> [--org]
  MCP tool: standwise_decide_suggestion { org?, id, decision }   (readOnlyHint false, idempotentHint true)
  ```
  - The draft returns suggestions marked as **untrusted** in MCP, using the same fence as the activity.
  - `SKILL.md` and the MCP `daily` prompt present each suggestion to the person and ask whether it is a real blocker:
    - **yes:** the agent adds it to `blockers`, with the person's own words and the `ref`;
    - **no:** the agent calls ignore.
    They never add a suggestion without the person's answer.
- [ ] **Step 1: Write the failing tests:**
  - the draft lists only the member's pending suggestions;
  - deciding another member's id gives 404;
  - submitting a blocker whose `ref.url` equals a suggestion's url marks it confirmed;
  - the CLI `suggestion ignore` returns 204 and exits 0; an unknown id exits 1 with `error not_found`;
  - MCP `standwise_decide_suggestion` works and the draft output is fenced;
  - the plugin test asserts `SKILL.md` mentions `standwise_decide_suggestion`, `standwise suggestion ignore` and the rule "never add a suggestion without the person's answer";
  - **`no-suggestion-leak.test.ts`:** with pending, confirmed and ignored suggestions in the DB, none of these contains any suggestion id, fingerprint or the strings `pr_no_review`/`ci_failing`: `/v1/org/*`, `/v1/manage/*`, the webhook envelopes produced by `submitDaily` and `sendDigest`, the digest `Message`, and the `/setup` HTML.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: suggestions in the draft with confirm and ignore across api, cli, mcp and skill`

### Task 8: Check run do `standwise.yml` e webhooks só enfileiram

**Files:**
- Create: `packages/orchestrator/src/use-cases/validate-config-at-ref.ts`, `apps/worker/src/jobs/{validate-config,load-config}.ts`
- Modify:
  - `packages/orchestrator/src/use-cases/handle-github-event.ts`: no inline config load, only enqueue;
  - `apps/worker/src/main.ts`;
  - `apps/api/test/webhooks.test.ts` and the orchestrator tests that assumed the inline load.
- Test: `packages/orchestrator/test/use-cases/{validate-config-at-ref,handle-github-event}.test.ts`

**Interfaces:**
- Consumes: `fetchConfigSource` with `ref` and `createCheckRun` (Task 2); `parseConfig`; `locateConfigPath` (Task 1); `loadInstallationConfig` (plan 1)
- Produces:
  ```ts
  type ValidateConfigJob = { installationId: number; owner: string; headSha: string }
  function validateConfigAtRef(deps: WorkerDeps, job: ValidateConfigJob): Promise<'success' | 'failure' | 'skipped'>
  type LoadConfigJob = { installationId: number; owner: string }
  jobs 'validate-config', 'load-config'
  ```
  - `handleGitHubEvent`:
    - `installation.created` and `installation_repositories` → upsert, then enqueue `load-config`.
    - `push` to `.github` touching `standwise.yml`, on **any** branch → enqueue `validate-config` with `after` as `headSha`. On the default branch, also enqueue `load-config`.
    - `pull_request` (opened, synchronize, reopened) on `.github` → enqueue `validate-config` with the PR head sha. The job checks the changed files and returns `skipped` when `standwise.yml` is not among them.
    - `installation.deleted` stays inline.
    - Singleton keys: `"validate:<inst>:<sha>"` and `"load-config:<inst>"`.
  - `validateConfigAtRef`:
    - fetch `standwise.yml` at the sha. A missing file gives `skipped`, with no check run.
    - `parseConfig`: success creates the check run `Standwise config` with conclusion `success`. Failure creates conclusion `failure` with one annotation per error at `locateConfigPath` (line 1 when not located) and a summary listing every `path: message`.
    - The texts use i18n, in the language from the parsed config's first team when available, otherwise **en**.
    - The last valid config remains in effect, because `loadInstallationConfig` already keeps it.
- [ ] **Step 1: Write the failing tests:**
  - a push with an invalid `digest_at` creates a failure check run with an annotation on the right line and the path in the summary;
  - a valid push creates a success check run;
  - a push on a non-default branch validates but does not load;
  - a PR that does not touch the file is `skipped`, with no API call to check-runs;
  - the webhook handler no longer awaits the config load: it returns 202 with only jobs enqueued;
  - after an invalid push the operational config is still the previous one.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: standwise.yml check runs; github webhooks only enqueue jobs`

### Task 9: Pendências do plano 1 que tocam esta área

**Files:** the files each item names.

- [ ] **Step 1: Write a failing test per item**, then implement and run:
  1. **Web rate limit:** `apps/api/src/routes/web.tsx` lists `/setup` and `/setup/*` in `PAGE_PATHS`, so `/setup` is counted twice. Drop `/setup`. Test: 60 GETs to `/setup` in a minute are allowed, and the 61st gets 429.
  2. **Slack 429:** `packages/adapters/slack/src/channel.ts` sets `rejectRateLimitedCalls: true`, and the error maps to `ChatDeliveryError('ratelimited')`. Test: a fake 429 gives `ratelimited` immediately, with no sleep.
  3. **Logs:**
     - `emitEventSafely`, `deliverWebhook` and `linkChatIdentities` log only the error `name`, `code` and `message`, never Drizzle params or payloads;
     - `linkChatIdentities` logs instead of an empty `catch {}`;
     - Test: a captured `console.error` never contains the daily text.
  4. **Cleanup:** a new daily job `prune-data` (cron `17 3 * * *`) deletes `webhook_deliveries` older than 30 days, expired `sessions`, and `suggestions` in a terminal state older than 90 days. Test it.
  5. **Negative membership cache:** the cache entry is cleared when `syncMemberFromGitHub` (login) runs, so a member who was just added gets in without waiting 10 minutes. Test it.
  6. **`managers` with `@org/team`:**
     - `parseConfig` rejects `managers` entries that start with `@`, with an error that explains it (`managers must be GitHub logins`);
     - update `docs/site/admin/configuration.md` in en and pt-BR, and keep `check-docs` green.
- [ ] **Step 2: Commit** `fix: plan 1 follow-ups (rate limit, slack 429, safe logs, data pruning, membership cache, managers validation)`

### Task 10: Documentação e CHANGELOG

**Files:**
- Modify: `docs/site/{how-it-works,concepts,privacy,faq,troubleshooting}.md`, `docs/site/admin/{configuration,slack,install}.md`, `docs/site/members/{getting-started,cli,claude-code,mcp}.md` and their pt-BR counterparts; `docs/api/CHANGELOG.md`; `README.md`
- Test: `scripts/check-docs.ts` and `bun run docs:build`

- [ ] **Step 1:** Remove "coming soon" / "em breve" from reminders, blocker routing, suggested blockers and the check run. Keep it for Linear, Jira and Google Chat. Document:
  - the reminder (time, one per day, only for those who have not sent);
  - the routing order (reviewers, then CODEOWNERS, then managers; cards in plan 3);
  - suggestions: what triggers them, that they go **only to the person**, and how to confirm or ignore them in CLI, MCP and skill;
  - `signals.direct_message`;
  - the check run;
  - the troubleshooting entries `no_chat_identity` and "nobody received my blocker";
  - in privacy, what is read from PRs, reviews, checks and CODEOWNERS, and that suggestions are visible only to the person.
- [ ] **Step 2:** Extend `check-docs` so it fails if `pr_no_review` or `ci_failing` appear in docs describing org or manager outputs. Run `bun run docs:build` (with `SUPPORT_EMAIL`), `bun run scripts/check-docs.ts` and the full `bun test`.
- [ ] **Step 3: Commit** `docs: reminders, blocker routing, suggested blockers and config check runs`
