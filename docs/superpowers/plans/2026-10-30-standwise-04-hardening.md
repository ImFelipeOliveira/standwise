# Standwise — Plano 4: Hardening antes do `dev → main`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as pendências das revisões dos planos 1–3 que afetam pessoas ou operação, antes do primeiro merge `dev → main` e do lançamento.

**Architecture:** Nenhuma funcionalidade nova. Cada task corrige um grupo de pendências no lugar onde o código já vive, seguindo os padrões existentes:
- casos de uso em `packages/orchestrator`;
- adaptadores em `packages/adapters/*`;
- jobs finos no worker;
- `logError` para logs.

**Tech Stack:** a mesma dos planos 1–3.

**Spec:** `docs/superpowers/specs/2026-10-27-standwise-design.md`, §3 (anti-objetivos), §4.3 (orquestrador) e §6 (restrições). A origem de cada item está na memória do projeto, `standwise-project-context.md`, em "Follow-ups still owed before dev → main".

**Base:** `dev` em `26e9297`, com os planos 1–3 mergeados.

## Global Constraints

- **Sem comentários no código** (TS, TSX, shell, YAML, Dockerfile).
- **Camadas:** regras nos casos de uso, que lançam `DomainError`. Rotas, jobs, CLI e MCP ficam finos.
- **I18N:** todo texto visível via `t(lang, key)`, em pt-BR e en; o padrão é **en**.
- **Logs:** só via `logError` (name, code, message). Nunca payloads, tokens, e-mails ou texto de daily ou card.
- **Anti-vigilância:** nada novo aparece para gestores, org ou setup sobre sugestões ou atividade individual.
- **Multi-tenant:** toda consulta filtra por `installation_id`.
- **Permissões do GitHub App:** nenhuma mudança.
- **Testes:** `bun test` com Postgres de teste e fakes. Nada de rede real, exceto na Task 6, que consulta SHAs de actions e digests de imagem com `gh api` e `docker` para fixá-los.

## Fora deste plano (decidido)

- **Lista de instalações pendentes em memória:** só importa com mais de uma réplica da API. O deploy roda uma réplica, e isso é documentado na Task 7.
- **Transação do refresh do Linear durando a chamada HTTP:** aceita, com timeout de 10 s e `lock_timeout` de 15 s.
- **`retry-after` só logado:** o pg-boss não aceita atraso por falha.
- **Falha transitória de DM de sugestão invisível:** é intencional (anti-vigilância).
- **Configs antigos com `remind_at ≥ digest_at`:** não existem, porque nada foi para produção.
- **HSTS `includeSubDomains`:** o `secureHeaders` do Hono já envia esse valor por padrão. A Task 5 só adiciona um teste que fixa isso.

## Review Focus

1. **Paginação:** um PR com mais de 100 eventos na timeline, mais de 100 reviews ou mais de 100 check runs mantém `readyAt`, `reviewCount` e `failingChecksSince` corretos, sem sugestões falsas nem perdidas. *(Task 1)*
2. **Caixa da URL:** a mesma URL de PR escrita com caixa diferente (`Acme/API` × `acme/api`) é o mesmo impedimento e gera um único encaminhamento. *(Task 2)*
3. **Identidade inválida no Slack:** um usuário do Slack desativado ou removido do workspace não fica preso numa identidade velha. O próximo envio que falhar com `user_not_found` ou `account_inactive` apaga a identidade, e o próximo login refaz o vínculo. *(Task 3)*
4. **Time do GitHub fora do alcance:** um time do config que não existe ou que o app não enxerga aparece como aviso no setup, em vez de sumir com as pessoas em silêncio. *(Task 4)*
5. **Banco lento:** o `/health` responde 503 em até ~2 s quando o banco trava, em vez de pendurar o health check do Railway. *(Task 5)*

---

### Task 1: Leituras do GitHub sem truncar

**Files:**
- Modify: `packages/adapters/github/src/pulls.ts` (reviews, timeline, check-runs), `packages/adapters/github/src/codeowners-source.ts`
- Test: `packages/adapters/github/test/{pulls,codeowners-source}.test.ts`

**Interfaces:**
- Produces: same signatures. The behaviour changes as follows.
  - **Reviews, timeline (`ready_for_review`) and check-runs** paginate with `per_page=100` up to 10 pages each (constant `MAX_DETAIL_PAGES = 10`). Pagination stops at the first short page.
  - **`readyAt`** uses the LAST `ready_for_review` event across all pages.
  - **Check runs** use `filter=latest`, so a re-run replaces the earlier result.
  - **`fetchCodeowners`** requests `Accept: application/vnd.github.raw+json` and reads the body as text, so files over 1 MB come back whole. An empty file returns `''`; 404 on all paths returns `null`.

- [ ] **Step 1: Write the failing tests:**
  - 150 reviews where only page 2 has an `APPROVED`: `reviewCount` is 1;
  - a `ready_for_review` event on timeline page 2 wins over one on page 1;
  - 120 check runs where the failure is on page 2 is detected;
  - the check-runs request carries `filter=latest`;
  - a raw CODEOWNERS of 1.5 MB is returned whole;
  - each paginated read stops at 10 pages.
- [ ] **Step 2: Run** `bun test packages/adapters/github` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; run the full `bun test`, lint and typecheck.
- [ ] **Step 5: Commit** `fix(github): paginate review, timeline and check-run reads; raw codeowners`

### Task 2: Varredura, encaminhamento e rascunho

**Files:**
- Modify:
  - `packages/orchestrator/src/use-cases/scan-member-signals.ts`
  - `packages/orchestrator/src/events.ts` (`normalizeRefUrl`)
  - `packages/orchestrator/src/use-cases/get-draft.ts`
- Test: `packages/orchestrator/test/use-cases/{scan-member-signals,route-blocker,get-draft}.test.ts`, `packages/orchestrator/test/events.test.ts`

**Interfaces:**
- Produces:
  - **`scanMemberSignals`:** when `job.date` is set and the `signal_scan` marker for that login, installation and date is already `sent`, return right away, with no GitHub or Linear call.
  - **`normalizeRefUrl(url)`:** for a host that is `github.com` or `linear.app` (case-insensitive), lowercase the host and the path. For other hosts, lowercase only the host. Then drop the trailing slash, the `#fragment` and the query.
    - GitHub and Linear paths are case-insensitive.
    - The query is dropped because PR and card URLs carry no identity in it.
  - **`getDraft`:** fetch GitHub activity, Linear activity and pending suggestions concurrently with `Promise.all`. Error handling stays per source.

- [ ] **Step 1: Write the failing tests:**
  - a scan job with `date` and an existing marker makes zero snapshot and zero Linear calls;
  - `normalizeRefUrl('https://github.com/Acme/API/pull/7/')` equals `normalizeRefUrl('https://github.com/acme/api/pull/7#discussion')`;
  - a resubmitted daily whose blocker URL differs only in case does not route again;
  - a Linear URL with a different-case identifier is the same identity;
  - the draft starts the GitHub and Linear calls before either resolves (assert with deferred promises);
  - a failure in one source still yields the other.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix: skip completed daily scans, case-insensitive ref identity, concurrent draft sources`

### Task 3: Higiene de identidades

**Files:**
- Modify:
  - `packages/orchestrator/src/identity.ts` (Slack identity writes)
  - `packages/orchestrator/src/tracker-identity.ts` (login enqueues; the relink job goes past 200)
  - the login path (`start-session.ts`)
  - `packages/orchestrator/src/use-cases/{send-reminder,route-blocker,notify-suggestions,send-digest}.ts` (stale Slack identity cleanup on DM failure)
  - `packages/db/src/repo/members.ts` (remove unused `deleteIdentities` and `deleteIdentity` if still unused after this task)
  - `apps/worker/src/main.ts`
- Create: `apps/worker/src/jobs/link-tracker-identity.ts`
- Test: `packages/orchestrator/test/{identity,tracker-identity}.test.ts`, `packages/orchestrator/test/use-cases/{send-reminder,route-blocker}.test.ts`

**Interfaces:**
- Consumes: `writeIdentityIfConnected` (plan 3), `enqueueLinkTrackerIdentities` (plan 3), `ChatDeliveryError` codes from `@standwise/slack`.
- Produces:
  ```ts
  job 'link-tracker-identity' { installationId: number; memberId: string }
  LinkTrackerIdentitiesJob: { installationId: number; afterLogin?: string }
  function forgetChatIdentity(deps: Pick<Deps,'db'>, installationId: number, memberLogin: string): Promise<void>
  ```
  - **Slack identity writes** in `linkChatIdentities` go through `writeIdentityIfConnected`, like Linear's, so a Slack reconnect to another team can't receive identities from the old team.
  - **Login enqueues instead of calling Linear.**
    - Login no longer calls Linear inline. It enqueues `link-tracker-identity` per installation, with singletonKey `link-tracker:<inst>:<memberId>`, policy `stately`, and the GitHub email read from `members.email` inside the job.
    - Login latency no longer depends on Linear.
    - Slack linking stays inline: one Slack call, and Slack is mandatory.
  - **`link-tracker-identities` paginates.**
    - It processes members ordered by login, after `afterLogin`, 200 per run.
    - When 200 were processed, it enqueues itself again with the last login as `afterLogin`. The singletonKey includes the cursor: `link-tracker:<inst>:<afterLogin ?? ''>`, policy `stately`.
    - A run with fewer than 200 members ends the chain.
  - **Stale Slack identity cleanup.**
    - When `sendDirect` fails with `ChatDeliveryError` code `user_not_found` or `account_inactive`, the DM use cases call `forgetChatIdentity` for that recipient and still record the failed delivery.
    - A config override (`members.<login>.slack`) is never deleted, because only stored identities are deleted.
    - Check the existing `ChatDeliveryError` codes, and add the two codes to the Slack error mapping if they are missing.

- [ ] **Step 1: Write the failing tests:**
  - a login with Linear connected enqueues `link-tracker-identity` and makes no Linear call during login;
  - the job links the person;
  - a relink with 450 eligible members runs as three chained jobs, and every member is linked;
  - a Slack reconnect to another team during `linkChatIdentities` writes nothing;
  - a reminder that fails with `user_not_found` deletes the stored Slack identity and records the failure;
  - an override identity is not deleted.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; the full `bun test`.
- [ ] **Step 5: Commit** `fix: guarded slack identity writes, queued tracker linking and stale identity cleanup`

### Task 4: Aviso de time do GitHub inacessível

**Files:**
- Modify:
  - `packages/adapters/github/src/members.ts` (`resolveTeamMembers` reports missing and truncated teams)
  - `packages/orchestrator/src/teams.ts` (cache keeps the report)
  - `packages/orchestrator/src/use-cases/get-setup-status.ts`
  - `apps/api/src/web/setup.tsx`
  - `packages/core/src/i18n.ts`
- Test: `packages/adapters/github/test/members.test.ts`, `packages/orchestrator/test/use-cases/get-setup-status.test.ts`, `apps/api/test/web.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type TeamResolution = { logins: string[]; missingTeams: string[]; truncatedTeams: string[] }
  function resolveTeamMembers(octokit: Octokit, owner: string, members: string[]): Promise<TeamResolution>
  SetupStatus.teamNotices: { team: string; reference: string; kind: 'missing' | 'truncated' }[]
  ```
  - **Missing:** a 404 on the first page of a team listing.
  - **Truncated:** reaching `MAX_PAGES` (50) with full pages.
  - **Callers that only need logins** read `.logins`. Update every caller.
  - **Setup notices:**
    - shown per standwise team, with the config reference (`@acme/backend`) and the i18n keys `setup.teams.missing` and `setup.teams.truncated` in pt-BR and en;
    - the copy explains that the team must exist and that the app needs the Members permission on the organization;
    - only references are shown, never member lists.

- [ ] **Step 1: Write the failing tests:**
  - a 404 team is reported as missing, and the other entries still resolve;
  - 50 full pages are reported as truncated;
  - the setup page shows both notices in en and pt-BR;
  - no notice appears when everything resolves.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: setup notice for github teams that cannot be resolved`

### Task 5: Web e operação

**Files:**
- Modify:
  - `apps/api/src/routes/web.tsx` and `apps/api/src/web/setup.tsx` (logout)
  - `packages/orchestrator/src/use-cases/` (a `logout` use case reusing the session revoke from the CLI logout)
  - `apps/api/src/routes/public.ts` (`/health` timeout)
  - `scripts/install.sh`
  - `packages/core/src/i18n.ts`
- Test: `apps/api/test/{web,public}.test.ts`

**Interfaces:**
- Produces:
  - **`POST /logout`:**
    - same-origin form, CSRF-safe the same way the existing setup forms are;
    - revokes the web session, clears the cookie, then redirects to `/`;
    - the setup page shows a "Sign out" button (i18n `web.setup.logout` in pt-BR and en).
  - **`/health`:**
    - runs `select 1` with a 2-second timeout (`Promise.race` with a timer, or `statement_timeout` on the query);
    - on timeout it returns 503 `{ ok: false }`;
    - the timer is cleared on success.
  - **`install.sh`:**
    - the `wget` branch becomes `wget -q -O "$2" "$1"`, dropping `--https-only`, which BusyBox lacks;
    - every URL in the script is a literal `https://` URL, and the SHA256SUMS check is the integrity guard.
  - **HSTS test:** pins that page responses carry `Strict-Transport-Security` with `includeSubDomains`.

- [ ] **Step 1: Write the failing tests:**
  - a logout revokes the session (a later `/setup` redirects to login) and clears the cookie;
  - a cross-origin POST to `/logout` is rejected;
  - `/health` with a db that never answers returns 503 within 2.5 s;
  - `install.sh` has no `--https-only`, and every download URL starts with `https://`;
  - the HSTS header carries `includeSubDomains`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix: web logout, bounded health check and busybox-safe installer`

### Task 6: Supply chain — actions e imagens fixadas

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`, `Dockerfile`, `docker-compose.yml` (if it uses images by tag)
- Create: `.github/dependabot.yml`
- Test: `scripts/check-pins.ts` (new), wired into `ci.yml` after lint

**Interfaces:**
- Produces:
  - **Workflow actions:** every `uses:` line is pinned to a full 40-character commit SHA. YAML comments are forbidden, so the human-readable version goes in the step `name:` (e.g. `name: checkout v4.2.2`). Resolve each SHA with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, and dereference annotated tags.
  - **Docker images:**
    - every `FROM` uses `image:tag@sha256:<digest>`, resolved with `docker buildx imagetools inspect` or the registry API;
    - the `docker-compose.yml` Postgres image too, if pinned by tag.
  - **Dependabot:** `.github/dependabot.yml` updates `github-actions`, `docker` and `npm` weekly, so pins don't rot.
  - **`scripts/check-pins.ts`:** exits non-zero if any workflow `uses:` is not a 40-hex SHA, or any Dockerfile `FROM` lacks `@sha256:`.

- [ ] **Step 1: Write the failing check:** add `scripts/check-pins.ts` with a test in `scripts/check-pins.test.ts` covering a good file and a bad one. Run it on the repo → FAIL.
- [ ] **Step 2: Pin everything.** Run → PASS.
- [ ] **Step 3: Run** the full `bun test`, lint, and `docker build --build-arg APP=api --build-arg SUPPORT_EMAIL=x@y.z .`, which must succeed with the pinned images.
- [ ] **Step 4: Commit** `ci: pin actions and base images by digest; dependabot`

### Task 7: Documentação e changelog

**Files:**
- Modify: `docs/deploy.md`, `docs/api/CHANGELOG.md`, `docs/site/changelog.md` and the pt-BR version, `docs/site/admin/install.md`, `docs/site/troubleshooting.md` and the pt-BR version
- Test: `bun run check-docs`, `SUPPORT_EMAIL=x@y.z bun run docs:build`

- [ ] **Step 1:**
  - `docs/deploy.md`: run **exactly one api replica**, because pending installations are cached in memory and migrations run on start. The worker can scale.
  - `docs/deploy.md`: deploying without a custom domain, using the Railway-generated `*.up.railway.app` as `PUBLIC_URL`, and what to change when a domain arrives (`PUBLIC_URL`, `SUPPORT_EMAIL`, and the callbacks in the GitHub, Slack and Linear apps). The CLI points at it with `STANDWISE_API_URL`.
  - `docs/api/CHANGELOG.md` lists only public API changes. Move the behaviour bullets (reminders, routing, check run, retention) to the site changelog, if they are not there already.
  - Troubleshooting (en and pt-BR):
    - the new GitHub team notice;
    - "Sign out";
    - a stale Slack identity is now cleaned up automatically, so sign in again to relink.
- [ ] **Step 2:** Run the docs checks and the full `bun test`.
- [ ] **Step 3: Commit** `docs: single api replica, deploying without a domain, hardening notes`
