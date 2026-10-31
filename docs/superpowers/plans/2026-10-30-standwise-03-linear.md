# Standwise — Plano 3: Linear

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar o Linear ao Standwise, completando a fase 1a da spec:
- o admin conecta o workspace do Linear na página de setup;
- o rascunho do "ontem" inclui os cards da pessoa;
- um impedimento ligado a um card é encaminhado ao responsável do card bloqueador;
- o sinal "card parado" vira impedimento sugerido, visível só para a pessoa.

**Architecture:**
- Novo adaptador `@standwise/linear` em `packages/adapters/linear`: GraphQL sobre `fetch` injetável (como o adaptador do GitHub), mais OAuth.
- A porta `ProjectTracker` do plano 2 ganha a forma da spec §5.3 e uma implementação Linear criada por instalação (`createTrackerFor`). `nullTracker` continua valendo quando não há conexão.
- As regras ficam nos casos de uso e em `@standwise/core`, como nos planos anteriores:
  - mapeamento de pessoa Linear → login GitHub;
  - ordem de encaminhamento;
  - fingerprint do sinal.
- Webhooks do Linear ficam fora: o sinal de card é diário e a atividade é lida sob demanda.

**Tech Stack:** a mesma dos planos 1 e 2. *Chamada minha:* GraphQL direto em vez de `@linear/sdk` (spec §5.2). As consultas são poucas e fixas, os testes usam o mesmo `fetch` falso do GitHub, e evitamos uma dependência grande. Revisar.

**Spec:** `docs/superpowers/specs/2026-10-27-standwise-design.md`:
- §4.1 (setup: Linear OAuth);
- §4.2.3 (vínculo de identidade por e-mail ou `members.<login>.linear`);
- §4.3 (encaminhamento por card e `card_stale_days`);
- §4.4 (`tracker`);
- §5.3 (`ProjectTracker`);
- §6 ("No Linear, OAuth com `actor=app`").

**Base:** branch `dev` com os planos 1 e 2 mergeados (PR #3). Nomes citados como existentes vêm desses planos; em dúvida, leia o código.

## Global Constraints

- **Sem comentários no código** (TS, TSX, shell, YAML, Dockerfile).
- **Camadas:** regras em casos de uso que lançam `DomainError`; rotas, jobs, CLI e MCP finos; casos de uso testados sem HTTP.
- **I18N:** todo texto visível via `t(lang, key)`, com chaves em pt-BR e en; sem idioma definido, **en**. Erros JSON da API em inglês; o `code` é o contrato.
- **Anti-vigilância (spec §3):**
  - Atividade de cards só aparece no rascunho da própria pessoa.
  - `card_stale` segue as regras das sugestões do plano 2: só a pessoa vê, nunca no consolidado, em `/v1/org/*`, `/v1/manage/*`, webhooks ou setup.
  - O Linear nunca é usado para medir pessoas.
- **Conexão (spec §6):**
  - Uma conexão Linear por instalação, feita só pelo admin, com OAuth `actor=app` e escopo `read`.
  - O token é guardado criptografado em `connections` (provider `linear`).
  - Nenhum token por membro.
- **Multi-tenant:**
  - Toda consulta filtra por `installation_id`.
  - Um card só é lido se a URL for do workspace conectado (`urlKey`).
- **Identidade Linear → pessoa:**
  - `members.<login>.linear` no config (e-mail) tem prioridade.
  - Depois vem o vínculo automático pelo e-mail primário verificado do GitHub, gravado em `member_identities` (provider `linear`, `externalId` = id do usuário Linear).
- **Fora deste plano:** o comando `standwise link linear` da spec §4.2.3. O vínculo por e-mail mais `members.<login>.linear` cobre os casos, e `standwise link slack` também não existe ainda. Fica para quando houver um `link` geral.
- **Padrões:** `signals.card_stale_days: 5` (já existe no config). `tracker.team` é a chave do time no Linear e limita atividade e sinais a esse time.
- **Jira:** continua "em breve". `tracker.provider: jira` é aceito pelo config e mostra um aviso no setup, sem quebrar nada.
- **Permissões do GitHub App:** nenhuma mudança.
- **Testes:** `bun test`, com Postgres de teste e fakes para GitHub, Slack e Linear. Nada de rede real.

## Review Focus

1. **Token do Linear revogado ou expirado sem refresh possível:**
   - o encaminhamento cai para o gestor;
   - o rascunho sai sem cards;
   - a varredura não resolve sugestões de card pendentes;
   - o setup mostra "reconectar Linear".
   Nada quebra o tick, o submit ou o draft. *(Tasks 3, 5, 6, 7)*
2. **URL de card de outro workspace, malformada ou de card inexistente:** nenhuma chamada fora do workspace conectado, e o encaminhamento segue para o próximo passo. *(Tasks 1, 5)*
3. **Responsável do card bloqueador sem vínculo com uma pessoa do Standwise** (contratado externo, e-mail diferente): a regra passa para o responsável do próprio card, depois para o criador, depois para os gestores. O autor nunca entra. *(Task 5)*
4. **Linear com rate limit ou fora do ar durante a varredura:**
   - as sugestões `pr_no_review` e `ci_failing` continuam funcionando;
   - as de `card_stale` não são resolvidas por engano;
   - o job tenta de novo.
   *(Task 7)*
5. **Card que volta para "em andamento" depois de ter saído:** gera uma sugestão nova se ficar parado de novo. Ignorar um episódio não silencia o próximo. *(Tasks 1, 7)*

---

### Task 1: Core — refs de card, sinal `card_stale` e atividade de cards

**Files:**
- Create: `packages/core/src/linear-ref.ts`, `packages/core/src/card-signals.ts`
- Modify:
  - `packages/core/src/activity.ts` (novos kinds);
  - `packages/core/src/config.ts` (aviso para `jira`; `members.<login>.linear` precisa ser e-mail);
  - `packages/core/src/i18n.ts`;
  - `packages/core/src/index.ts`.
- Test: `packages/core/test/{linear-ref,card-signals,config,activity}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type LinearIssueRef = { workspace: string; identifier: string }
  function parseLinearIssueUrl(url: string): LinearIssueRef | null
  type CardSnapshot = { id: string; identifier: string; url: string; title: string; startedAt: Date }
  function cardStaleFingerprint(id: string, startedAt: Date): string
  function detectCardSignals(cards: CardSnapshot[], now: Date, cardStaleDays: number): Signal[]
  ActivityItem.kind: 'pr_opened' | 'pr_merged' | 'review' | 'commits' | 'card_started' | 'card_done'
  ```

- [ ] **Step 1: Write the failing tests:**
  - `parseLinearIssueUrl`:
    - `https://linear.app/acme/issue/BE-123/fix-login` gives `{ workspace: 'acme', identifier: 'BE-123' }`;
    - URL without slug, with `#comment-…` or with `?…` is accepted;
    - `http://`, another host, `/project/…` or identifier without `-<number>` give `null`;
    - the identifier is uppercased.
  - `detectCardSignals`:
    - `startedAt` 5 days and 1 minute ago with `cardStaleDays 5` gives `card_stale`; 4 days 23 h gives nothing;
    - exactly 5 days counts (`>=`);
    - `ref` is `{ kind: 'card', url, title }`;
    - fingerprint `card_stale:<id>@<startedAt ISO>`, so a new `startedAt` gives a new fingerprint.
  - config:
    - `members.alice.linear: "alice@acme.com"` is accepted; `"alice"` gives an error at `members.alice.linear` (`linear must be an email address`);
    - `tracker.provider: jira` still parses.
  - activity: `clampTitle` and sorting cover the new kinds, newest first.
- [ ] **Step 2: Run** `bun test packages/core` → FAIL.
- [ ] **Step 3: Implement.** i18n keys in pt-BR and en:
  - `setup.linear.title`, `setup.linear.connect`, `setup.linear.connected` (`{workspace}`), `setup.linear.reconnect`;
  - `setup.tracker.jiraComingSoon`;
  - `setup.tracker.notConnected` (time com `tracker: linear` mas sem conexão);
  - `activity.card_started`, `activity.card_done`, if the CLI/MCP renders kind labels (check how `pr_opened` is labelled).
- [ ] **Step 4: Run** → PASS; `bun run lint`, `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(core): linear issue refs, card stale signal and card activity kinds`

### Task 2: Adaptador `@standwise/linear`

**Files:**
- Create: `packages/adapters/linear/{package.json,tsconfig.json}`, `packages/adapters/linear/src/{client,oauth,issues,users,activity,errors,index}.ts`
- Test: `packages/adapters/linear/test/{oauth,issues,users,activity,client}.test.ts`, with JSON fixtures in `packages/adapters/linear/test/fixtures/`.
- Modify: root `tsconfig.json`/workspace references, if new packages need registering (follow `packages/adapters/slack`).

**Interfaces:**
- Consumes: `CardSnapshot`, `ActivityItem` (Task 1)
- Produces:
  ```ts
  type LinearFetch = typeof fetch
  type LinearClient = { query<T>(query: string, variables: Record<string, unknown>): Promise<T> }
  function createLinearClient(accessToken: string, fetchImpl?: LinearFetch): LinearClient
  class LinearAuthError extends Error {}
  class LinearRateLimitError extends Error { retryAfterSeconds: number | null }
  function linearAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string
  type LinearTokens = { accessToken: string; refreshToken: string | null; expiresAt: string | null }
  function exchangeLinearCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }, fetchImpl?: LinearFetch): Promise<LinearTokens>
  function refreshLinearToken(input: { clientId: string; clientSecret: string; refreshToken: string }, fetchImpl?: LinearFetch): Promise<LinearTokens>
  type LinearOrganization = { id: string; name: string; urlKey: string }
  function getOrganization(client: LinearClient): Promise<LinearOrganization>
  type LinearUser = { id: string; email: string | null }
  function findUserByEmail(client: LinearClient, email: string): Promise<LinearUser | null>
  type LinearIssue = { id: string; identifier: string; url: string; title: string; assignee: LinearUser | null; creator: LinearUser | null; blockedBy: { identifier: string; assignee: LinearUser | null }[] }
  function getIssue(client: LinearClient, identifier: string): Promise<LinearIssue | null>
  function listCardActivity(client: LinearClient, input: { userId: string; teamKey: string; since: Date }): Promise<ActivityItem[]>
  function listStaleInProgress(client: LinearClient, input: { userId: string; teamKey: string }): Promise<CardSnapshot[]>
  ```
  - **Endpoints and auth:**
    - GraphQL `POST https://api.linear.app/graphql`, header `Authorization: Bearer <token>`.
    - OAuth authorize `https://linear.app/oauth/authorize` with `response_type=code`, `scope=read`, `actor=app`, `state` and `redirect_uri`.
    - Token `POST https://api.linear.app/oauth/token`, form-encoded, with `grant_type=authorization_code` or `refresh_token`.
    - `expiresAt` is `now + expires_in` as ISO; `null` when there is no `expires_in`.
  - **Errors:**
    - HTTP 401, or a GraphQL error with `extensions.code === 'AUTHENTICATION_ERROR'`, gives `LinearAuthError`.
    - HTTP 429, or `extensions.code === 'RATELIMITED'`, gives `LinearRateLimitError`, with `retryAfterSeconds` from `X-RateLimit-Requests-Reset` (epoch ms) or `Retry-After`.
    - Any other GraphQL error throws `Error` with only the error code and message.
  - **`getIssue`:**
    - `issue(id: $identifier)`; "Entity not found" gives `null`.
    - `blockedBy` comes from `inverseRelations` whose `type` is `blocks` (the related `issue` is the blocker).
  - **`listCardActivity`:**
    - `issues(filter: { assignee: { id: { eq } }, team: { key: { eq } }, updatedAt: { gte: since } }, first: 50)`.
    - `completedAt >= since` gives `card_done` at `completedAt`.
    - Otherwise `startedAt >= since` gives `card_started` at `startedAt`.
    - Everything else is dropped.
    - Each item carries `title`, `url`, and `repo` = the team key.
  - **`listStaleInProgress`:**
    - Same assignee and team filter plus `state: { type: { eq: "started" } }`, `first: 50`.
    - Issues without `startedAt` are dropped.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` that records requests:
  - the authorize URL has `actor=app` and `scope=read`;
  - code exchange and refresh send the exact form bodies and map `expires_in`;
  - 401 gives `LinearAuthError`, and `RATELIMITED` gives `LinearRateLimitError` with the reset hint;
  - `getIssue`:
    - maps assignee, creator and blockers;
    - returns `null` on not found;
    - sends the identifier as a variable, never interpolated into the query string;
  - `listCardActivity` classifies done, started and other;
  - `listStaleInProgress` drops issues without `startedAt`;
  - no request ever goes to a host other than `api.linear.app`.
- [ ] **Step 2: Run** `bun test packages/adapters/linear` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, then the full `bun test`, lint and typecheck.
- [ ] **Step 5: Commit** `feat(linear): graphql client, oauth and issue, user and activity reads`

### Task 3: Conexão do Linear no setup

**Files:**
- Create:
  - `packages/orchestrator/src/use-cases/start-linear-connect.ts`, `complete-linear-connect.ts`;
  - `packages/orchestrator/src/linear-access.ts`, which provides a valid token for an installation, with refresh and invalidation.
- Modify:
  - `packages/db/src/schema.ts` (`connections.invalidated_at timestamptz null`), with a migration;
  - `packages/db/src/repo/connections.ts` (`markConnectionInvalid`, and `saveConnection` clears it);
  - `packages/orchestrator/src/deps.ts` (`linear` deps: `exchangeCode`, `refreshToken`, `fetch?`; `env.linearClientId`, `env.linearClientSecret`);
  - `get-setup-status.ts` (linear state);
  - `apps/api/src/routes/web.tsx` (`/connect/linear`, `/oauth/linear/callback`) and `apps/api/src/web/setup.tsx`;
  - `apps/api/src/env.ts`, `apps/worker` env;
  - `.env.example`;
  - the fakes.
- Test: `packages/orchestrator/test/use-cases/{linear-connect,linear-access,get-setup-status}.test.ts`, `packages/db/test/repo.test.ts`, `apps/api/test/web.test.ts`

**Interfaces:**
- Consumes: `linearAuthorizeUrl`, `exchangeLinearCode`, `refreshLinearToken`, `getOrganization`, `LinearAuthError` (Task 2); `signState`/`verifyState`, `requireAdmin` (plan 1)
- Produces:
  ```ts
  function startLinearConnect(deps: Deps, isMember: MembershipCheck, member: MemberRow, input: { sessionToken: string; installationId: number | undefined }): Promise<{ url: string }>
  function completeLinearConnect(deps: Deps, isMember: MembershipCheck, member: MemberRow, input: { sessionToken: string; code?: string; state?: string; error?: string }): Promise<{ installationId: number }>
  function linearClientFor(deps: Pick<Deps,'db'|'encryptionKey'|'linear'|'env'|'now'>, installationId: number): Promise<{ client: LinearClient; organization: { id: string; urlKey: string } } | null>
  function markConnectionInvalid(db: Db, installationId: number, provider: Provider): Promise<void>
  SetupStatus.linear: { connected: false } | { connected: true; workspace: string; urlKey: string; invalid: boolean }
  ```
  - The `connections` row for `linear` has:
    - `externalId` = organization id;
    - `externalName` = `<name>|<urlKey>`, or a separate column if cleaner (decide and document);
    - secret = JSON `LinearTokens`, encrypted.
  - **`linearClientFor`:**
    - returns `null` when there is no connection or `invalidated_at` is set;
    - refreshes when `expiresAt` is within 5 minutes and saves the new tokens;
    - a refresh that fails with `LinearAuthError` marks the connection invalid and returns `null`;
    - any `LinearAuthError` raised later by a caller is handled by the caller, which calls `markConnectionInvalid` (see Tasks 5–7).
  - Reconnecting with a different organization deletes the `linear` identities of that installation (same rule as Slack).
  - After a successful connect, enqueue `link-tracker-identities` for the installation (Task 4).
  - **Setup page:**
    - "Connect Linear" button (admin only), state "connected to `<workspace>`" or "reconnect";
    - notice `setup.tracker.notConnected` when some team has `tracker.provider: linear` and there is no valid connection;
    - notice `setup.tracker.jiraComingSoon` for `jira`.
- [ ] **Step 1: Write the failing tests:**
  - a non-admin cannot start or complete;
  - the state is bound to the session;
  - `access_denied` gives the DomainError `access_denied`;
  - the stored secret is encrypted and round-trips;
  - reconnecting to another organization clears the `linear` identities;
  - refresh near expiry saves the new tokens;
  - a refresh auth failure marks the connection invalid and the setup shows "reconnect";
  - the setup notices for not connected and for jira;
  - the web routes redirect to Linear and back to `/setup`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, including the migration (`cd packages/db && bun run generate`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: connect linear from the setup page`

### Task 4: Vínculo de identidades no Linear

**Files:**
- Create: `packages/orchestrator/src/tracker-identity.ts`, `apps/worker/src/jobs/link-tracker-identities.ts`
- Modify:
  - `packages/orchestrator/src/identity.ts` or the login path (`syncMemberFromGitHub`), so that login also links the tracker;
  - `packages/db/src/repo/members.ts` (`findMemberByIdentity(db, installationId, provider, externalId)`);
  - `apps/worker/src/main.ts`.
- Test: `packages/orchestrator/test/tracker-identity.test.ts`

**Interfaces:**
- Consumes: `linearClientFor` (Task 3); `findUserByEmail` (Task 2); `memberOverrides`, `setIdentity`, `getIdentities` (plan 1)
- Produces:
  ```ts
  function linkTrackerIdentity(deps: Deps, installationId: number, memberId: string, githubEmail: string | null): Promise<void>
  function linkTrackerIdentities(deps: WorkerDeps, installationId: number): Promise<void>
  function loginForLinearUser(deps: Pick<Deps,'db'>, installationId: number, config: StandwiseConfig, user: LinearUser): Promise<string | null>
  job 'link-tracker-identities' { installationId }
  ```
  - **Linking:**
    - The email comes from `memberOverrides(config, login).linear` when present, otherwise from the GitHub primary verified email that login already fetches.
    - When `findUserByEmail` finds a Linear user, store `setIdentity(..., 'linear', user.id)`.
    - When it finds none, delete any stale `linear` identity of that member.
  - **`linkTrackerIdentities`:**
    - runs for every `members` row linked to the installation that appears in the config;
    - sequential, at most 200 per run.
  - **`loginForLinearUser`:**
    1. a config override whose email equals `user.email`, case-insensitive;
    2. otherwise the member whose `linear` identity is `user.id`;
    3. otherwise `null`.
    The match is restricted to logins in some team of the config.
  - Errors are logged with `logError` and never break login. A `LinearAuthError` marks the connection invalid.
- [ ] **Step 1: Write the failing tests:**
  - login links by GitHub email;
  - the config override wins over the GitHub email;
  - no Linear user removes a stale identity;
  - `loginForLinearUser` resolves by override and by identity, and returns `null` for an unknown user and for a login outside the config;
  - a Linear failure during login does not fail login;
  - tenant isolation (an identity of installation A is never used for B).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: link linear users to people by email or config`

### Task 5: Encaminhamento de impedimentos ligados a cards

**Files:**
- Create: `packages/orchestrator/src/linear-tracker.ts`
- Modify:
  - `packages/orchestrator/src/project-tracker.ts`: the port gains the spec shape (below) and becomes a factory;
  - `packages/orchestrator/src/use-cases/route-blocker.ts` (card step);
  - `packages/orchestrator/src/deps.ts` (`trackerFor` replaces `tracker`);
  - `apps/api/src/main.ts`, `apps/worker/src/main.ts`;
  - the fakes.
- Test: `packages/orchestrator/test/use-cases/route-blocker.test.ts`, `packages/orchestrator/test/linear-tracker.test.ts`

**Interfaces:**
- Consumes: `parseLinearIssueUrl` (Task 1); `getIssue` (Task 2); `linearClientFor` (Task 3); `loginForLinearUser` (Task 4)
- Produces:
  ```ts
  type CardOwners = { blockers: string[]; assignee: string | null; creator: string | null }
  interface ProjectTracker {
    cardOwners(ref: Ref): Promise<CardOwners | null>
    listActivity(login: string, since: Date): Promise<ActivityItem[]>
    listStaleInProgress(login: string): Promise<CardSnapshot[]>
  }
  const nullTracker: ProjectTracker
  Deps.trackerFor: (installationId: number, config: StandwiseConfig, team: TeamConfig) => Promise<ProjectTracker>
  ```
  - All logins in `CardOwners` are GitHub logins, resolved with `loginForLinearUser`. Unknown people are left out.
  - **Linear tracker (`trackerFor`):**
    - returns `nullTracker` when the team has no `tracker`, the provider is not `linear`, or there is no valid connection;
    - `cardOwners` returns `null` without any API call when `parseLinearIssueUrl(ref.url)` is `null` or the workspace is not the connected `urlKey`;
    - a `LinearAuthError` marks the connection invalid and returns `null`; any other error is logged and returns `null`.
  - **`resolveRouteTarget` card step (spec §4.3, item 2):**
    1. the logins of the blockers' assignees (`blockedBy`);
    2. otherwise the card's assignee;
    3. otherwise the creator;
    4. otherwise continue to the managers.

    The author is always removed and the cap of 5 still applies. The reason is `card_blocker` for step 1 and `card_owner` for steps 2–3; reuse or add the `blockerRouted.reason.*` key in both languages.
  - The team passed to `trackerFor` is the author's first team.
- [ ] **Step 1: Write the failing tests:**
  - a card blocked by `BE-9`, assigned to a linked person, routes to that person with reason `card_blocker`;
  - with no blocker relation it goes to the card's assignee, then to the creator;
  - when the blocker assignee is the author, routing falls through to the next step;
  - a blocker assignee not linked to anyone falls through;
  - a card URL from another workspace or a malformed one causes no fetch and routes to the managers;
  - a card that is not found routes to the managers;
  - a `LinearAuthError` marks the connection invalid and routes to the managers;
  - with no connection, `nullTracker` routes to the managers;
  - the DM reason line differs for `card_blocker` and `card_owner`, in en and pt-BR.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: route card blockers to the blocking card's owner`

### Task 6: Cards no rascunho

**Files:**
- Modify:
  - `packages/orchestrator/src/use-cases/get-draft.ts`;
  - `apps/api/src/openapi/schemas.ts` (internal `ActivitySchema` kinds);
  - `apps/cli/src/mcp/tools.ts` and the CLI draft output, if they label kinds;
  - `packages/plugin/skills/daily/SKILL.md` (cards in "ontem"; a blocker can reference a card URL);
  - `docs/api/guides/mcp.md`.
- Test: `packages/orchestrator/test/use-cases/get-draft.test.ts`, `apps/cli/test/mcp.test.ts`, `packages/plugin/test/plugin.test.ts`

**Interfaces:**
- Consumes: `trackerFor` / `ProjectTracker.listActivity` (Task 5)
- Produces: `Draft.activity` may contain `card_started` and `card_done` items, merged with GitHub activity, newest first, 50 items in total.
  - Card activity uses the same `since` as GitHub activity and the person's first team.
  - A failure in the tracker never fails the draft: the draft goes out without cards, and the error is logged.
  - Card titles go through `clampTitle`, and the MCP output keeps them inside the untrusted fence.
- [ ] **Step 1: Write the failing tests:**
  - a linked person with a connection gets card items merged with PRs in date order;
  - an unlinked person or a missing connection gets GitHub activity only, with no Linear call;
  - a tracker error leaves the draft OK, without cards;
  - the 50-item cap applies across both sources;
  - in MCP, a card title containing `</untrusted-data>` stays fenced;
  - the plugin test checks that SKILL.md mentions card references in blockers.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: linear cards in the daily draft`

### Task 7: Sinal `card_stale`

**Files:**
- Modify: `packages/orchestrator/src/use-cases/scan-member-signals.ts`
- Test: `packages/orchestrator/test/use-cases/scan-member-signals.test.ts`, `apps/api/test/no-suggestion-leak.test.ts`

**Interfaces:**
- Consumes: `detectCardSignals` (Task 1); `ProjectTracker.listStaleInProgress` (Task 5); `syncSuggestions` (plan 2)
- Produces: the scan creates and resolves `card_stale` suggestions in their own `syncSuggestions(..., ['card_stale'], …)` call, separate from the GitHub one.
  - **GitHub and Linear are independent.** A GitHub failure must not stop the card sync, and a Linear failure must not stop the PR sync. Each source that fails is skipped. After both are attempted, the job rethrows the first error so it retries. A source that failed never calls `syncSuggestions` with an empty list.
  - **`cardStaleDays`** comes from the person's first team.
  - **No tracker (`nullTracker`):** skip the card sync entirely. Pending `card_stale` rows are not resolved, so disconnecting Linear does not wipe suggestions; they stay until the next real scan.
  - The DM, the decide flow and the draft already handle any `SignalKind`. Check that the DM copy for `card_stale` uses `suggestion.card_stale` with `{title}` and `{days}`.
- [ ] **Step 1: Write the failing tests:**
  - a card in progress for 6 days creates one pending `card_stale`, and rescanning creates nothing new;
  - a card moved out of progress resolves it;
  - after it is ignored, the same `startedAt` does not revive it, while a new `startedAt` (the card was restarted) creates a new suggestion;
  - Linear failing keeps PR suggestions syncing and leaves card suggestions untouched, and the job rethrows;
  - GitHub failing keeps card suggestions syncing;
  - with no connection, no card sync happens and pending cards remain;
  - the leak test also seeds a `card_stale` suggestion and asserts the string `card_stale` and its fingerprint never appear in the org and manage routes, webhooks, the digest or setup.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: suggested blockers for cards stuck in progress`

### Task 8: Documentação, registro do app Linear e CHANGELOG

**Files:**
- Create: `docs/linear-app.md` (how to register the Linear OAuth app: name, callback `https://api.standwise.dev/oauth/linear/callback`, scope `read`, actor `app`, and where to set `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET`)
- Modify:
  - `docs/site/{how-it-works,concepts,privacy,faq,troubleshooting}.md`;
  - `docs/site/admin/{install,configuration}.md`;
  - `docs/site/members/{getting-started,cli,claude-code}.md`;
  - their pt-BR counterparts;
  - `docs/deploy.md`;
  - `docs/api/CHANGELOG.md`;
  - `docs/site/changelog.md` (en and pt-BR);
  - `README.md` (roadmap: Linear done; features; privacy line).
- Test: `bun run check-docs`, `SUPPORT_EMAIL=x@y.z bun run docs:build`

- [ ] **Step 1:** Remove "coming soon" / "em breve" for Linear and keep it for Jira and Google Chat. Document:
  - connecting Linear (admin, `actor=app`, read only, one workspace per installation);
  - `tracker: { provider: linear, team: <KEY> }`;
  - `members.<login>.linear` (email) and automatic linking by GitHub email;
  - cards in the draft;
  - the card routing order;
  - `card_stale` and `card_stale_days`, visible only to the person;
  - what is read from Linear in privacy: issue title, url, state type, started and completed dates, assignee, creator, "blocks" relations, user emails for linking; never descriptions or comments;
  - troubleshooting for "Linear shows reconnect" and "my cards don't show in the draft".
- [ ] **Step 2:** Run the docs checks and the full `bun test`.
- [ ] **Step 3: Commit** `docs: linear integration`
