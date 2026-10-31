# Standwise — Plano 5: UI das páginas da API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar à página de setup e às páginas de erro o visual aprovado pelo Felipe (artifact `https://claude.ai/artifact/J2SZs8BR1Dti9gxNxyLYVd`). O setup vira um checklist em etapas, ganha cards laterais e passa a funcionar bem no celular e no modo escuro.

**Architecture:**
- As páginas continuam renderizadas no servidor com Hono JSX, **sem JavaScript no cliente** e com a CSP atual. `style-src` segue com um único hash, sem `'unsafe-inline'`.
- Um kit pequeno de componentes JSX (`apps/api/src/web/ui.tsx`) usa classes de um CSS escrito à mão (`apps/api/src/web/styles.ts`). O CSS segue a linguagem visual do shadcn: tokens de cor em variáveis CSS, raio de 12 px, bordas finas, Inter e badges de status.
- *Chamada minha:* CSS escrito à mão em vez de Tailwind. São duas páginas e umas 300 linhas de CSS. O Tailwind traria etapa de build, um arquivo estático novo e uma rota para servi-lo, sem ganho real nesse tamanho. Os tokens têm os mesmos nomes do tema do shadcn (`--background`, `--foreground`, `--muted`, `--border`, `--primary`…), para virarem o tema do shadcn/ui na fase 2 sem retrabalho.
- O shadcn/ui de verdade (React) fica para a fase 2, junto com o painel.

**Tech Stack:** a mesma dos planos anteriores.

**Spec:** `docs/superpowers/specs/2026-10-27-standwise-design.md`, §4.1 (setup). O design aprovado está no artifact acima: as duas telas são a referência visual, e as cores e o espaçamento valem como especificação.

**Base:** `dev` em `54efa42` (planos 1–4).

## Global Constraints

- **Sem comentários no código**, CSS incluído.
- **Nenhum atributo `style=`** e nenhum `<script>` no HTML gerado. A CSP bloqueia os dois, então todo estilo vem de classes no `<style>` com hash.
- **I18N:** todo texto visível passa por `t(lang, key)`, com chaves em pt-BR e en; o padrão é **en**.
- **Paleta clara:**
  - base `#F8FAFC`;
  - cartões `#FFFFFF`;
  - texto `#0F172A`;
  - texto secundário `#475569`;
  - borda `#E2E8F0`;
  - destaque `#3B4BC8` (hover `#2A3796`);
  - sucesso `#16A34A`, com fundo `#DCFCE7` e texto `#166534`;
  - aviso: fundo `#FFFBEB`, borda `#FDE68A`, texto `#92400E`;
  - erro: fundo `#FEF2F2`, borda `#FECACA`, texto `#7F1D1D`, botão `#B91C1C`.
- **Modo escuro** via `prefers-color-scheme: dark`, com os mesmos tokens. Todo texto precisa de contraste de pelo menos 4,5:1.
- **Medidas:** raio de 12 px nos cartões e 8 px nos botões e campos; alvos de toque de pelo menos 44 px no celular.
- **Fonte:** Inter, se instalada, com a pilha de sistema como fallback. Sem Google Fonts, porque a CSP bloqueia origens externas e o objetivo é não depender delas.
- **Nada de funcionalidade nova** além do seletor de organização (Task 2) e do link "Editar no GitHub" (Task 3). Todos os formulários e fluxos atuais continuam funcionando:
  - API keys: criar, revogar e mostrar a chave uma única vez;
  - webhooks: criar, testar, desativar e mostrar o segredo uma única vez;
  - Slack e Linear: conectar e reconectar;
  - logout.

## Review Focus

1. **CSP:** um `style="…"` ou um `<script>` que escape no HTML quebra o visual em produção sem quebrar nenhum teste. Por isso, um teste percorre todas as variantes de página e afirma que não há nenhum dos dois. *(Task 1)*
2. **Membro sem admin:** vê o checklist e os estados, mas nenhum botão de ação de admin. A página não pode parecer quebrada ou vazia para essa pessoa. *(Task 3)*
3. **Textos longos:**
  - nome de organização ou workspace grande, URLs de webhook longas, mensagens de erro do config extensas e textos em pt-BR (mais longos que em inglês) quebram linha sem rolagem horizontal na página;
  - tabelas largas rolam dentro de uma caixa.
  *(Tasks 1 e 3)*
4. **Modo escuro:** nenhum texto ilegível e nenhum fundo branco esquecido. As cores de estado (sucesso, aviso, erro) também têm versão escura. *(Task 1)*
5. **Uma organização só:** com uma instalação, o seletor de organização não aparece. Com várias, ele troca de organização sem JavaScript. *(Task 2)*

---

### Task 1: Tokens, CSS e kit de componentes

**Files:**
- Create: `apps/api/src/web/styles.ts`, `apps/api/src/web/ui.tsx`
- Modify:
  - `apps/api/src/web/layout.tsx`: deixa de definir o CSS e passa a importar `PAGE_CSS` de `styles.ts`; mantém o export `PAGE_CSS` usado pela CSP;
  - `apps/api/src/routes/web.tsx`: só o import de `PAGE_CSS`, se ele mudar de lugar.
- Test: `apps/api/test/ui.test.tsx` (new), `apps/api/test/web.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PAGE_CSS: string
  type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  function Card(props: { children; class?: string; tone?: Tone; as?: 'section' | 'article' | 'aside' }): JSX
  function Badge(props: { tone: Tone; children }): JSX
  function ButtonLink(props: { href: string; variant?: 'primary' | 'secondary' | 'danger'; children }): JSX
  function SubmitButton(props: { variant?: 'primary' | 'secondary' | 'danger'; children }): JSX
  function Alert(props: { tone: 'warning' | 'danger' | 'info'; title: string; children?; action? }): JSX
  function StepStatus(props: { state: 'done' | 'todo' | 'error'; index: number }): JSX
  function Icon(props: { name: 'check' | 'x' | 'alert' | 'external' }): JSX
  function ScrollTable(props: { children }): JSX
  function Code(props: { children }): JSX
  ```
  Icons are inline SVG with `aria-hidden="true"` and `stroke="currentColor"`.
- CSS rules:
  - **Theming:** every token is a CSS variable on `:root`, with a `@media (prefers-color-scheme: dark)` block that redefines them. Components use only `var(--…)`.
  - **Layout utilities:** `.stack` (vertical gap), `.row` (horizontal wrap), `.grid-2` (two columns that become one below 640 px), `.page` (max-width 1120 px with 24 px padding, 16 px on a phone), `.layout` (main area plus aside, which become a single column below 900 px).
  - **Text wrapping:** `overflow-wrap: anywhere` on text containers, so long values never push the page wider.
  - **Focus:** visible focus ring (`outline: 2px solid var(--ring)`) on links, buttons and fields.
  - **Touch targets:** buttons and fields at least 36 px tall on desktop and 44 px below 640 px.

- [ ] **Step 1: Write the failing tests:**
  - every exported component renders with the expected class and tone class;
  - `PAGE_CSS` defines `--background`, `--foreground`, `--primary`, `--border` and `--muted-foreground`, and has a `prefers-color-scheme: dark` block that redefines them;
  - the dark palette meets 4.5:1 for `--foreground` on `--background` and `--muted-foreground` on `--card`: a small luminance contrast helper in the test parses the hex tokens from `PAGE_CSS`;
  - the CSP `style-src` hash on `/setup` matches `PAGE_CSS`;
  - **no inline styles:** render `SetupPage` (admin with keys and webhooks, non-admin, invalid config, Linear invalid, a team notice) and `ErrorPage` (every code), and assert none of the HTML contains `style="` or `<script`.
- [ ] **Step 2: Run** `bun test apps/api` → FAIL.
- [ ] **Step 3: Implement.** Map the colors from Global Constraints to the light tokens. Choose the dark tokens on the slate scale, using `#0B1120` as background, `#111827` as card and `#E2E8F0` as text, and check them with the contrast test.
- [ ] **Step 4: Run** → PASS. Then run the full `bun test`, lint and typecheck.
- [ ] **Step 5: Commit** `feat(web): design tokens and a small component kit for server pages`

### Task 2: Cabeçalho e seletor de organização

**Files:**
- Modify:
  - `apps/api/src/web/layout.tsx`: new header bar;
  - `packages/orchestrator/src/use-cases/get-setup-status.ts`: adds `installations`;
  - `apps/api/src/routes/web.tsx`;
  - `packages/core/src/i18n.ts`.
- Test: `apps/api/test/web.test.ts`, `packages/orchestrator/test/use-cases/get-setup-status.test.ts`

**Interfaces:**
- Produces:
  ```ts
  SetupStatus.installations: { id: number; owner: string }[]
  function Layout(props: { lang: Language; title: string; header?: { owner: string; installations: { id: number; owner: string }[]; currentId: number; csrf: string }; children }): JSX
  ```
  - **`installations` list:**
    - It holds every installation the member is linked to (`listMemberInstallations` plus `getInstallation` for the owner), sorted by owner.
    - It does not check membership again for each one. Opening another installation goes through `authorizeInstallation` as it does today.
  - **Header contents:** logo and "Standwise", then a `/` separator and the organization, then a "Docs" link to `/docs/`, then a "Sign out" form that posts to `/logout`.
  - **Organization switcher:**
    - With a single installation, the organization is plain text.
    - With more than one, it is a `<form method="get" action="/setup">` holding a `<select name="installation_id">` with a `<label>` (visually hidden class `.sr-only`) and a "Go"/"Ir" submit button.
    - There is no JavaScript, so the button is required.
  - **Error pages** keep the simple header: logo and name, with no session-dependent links.

- [ ] **Step 1: Write the failing tests:**
  - a member with one installation sees the owner as text and no `<select`;
  - with two, there is a `<select name="installation_id">` containing both owners, the current one selected, and a submit button;
  - GET `/setup?installation_id=<other>` opens the other organization;
  - an installation id the member is not linked to stays forbidden (existing behaviour);
  - "Docs" and "Sign out" appear in en and pt-BR.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): header with organization switcher, docs and sign out`

### Task 3: Setup como checklist

**Files:**
- Modify:
  - `apps/api/src/web/setup.tsx`: restructure it, and split it if it passes about 400 lines, e.g. `setup-steps.tsx` and `setup-admin.tsx` for API keys and webhooks;
  - `packages/orchestrator/src/use-cases/get-setup-status.ts`: adds `teams` and `configFileUrl`;
  - `packages/core/src/i18n.ts`.
- Test: `apps/api/test/web.test.ts`, `apps/api/test/admin.test.ts`, `packages/orchestrator/test/use-cases/get-setup-status.test.ts`

**Interfaces:**
- Consumes: the Task 1 kit and the Task 2 `Layout`.
- Produces:
  ```ts
  SetupStatus.teams: { name: string; channel: string | null; remindAt: string; digestAt: string; tracker: 'linear' | 'jira' | null }[]
  SetupStatus.configFileUrl: string | null
  ```
  - `teams` comes from the operational config, in config order. It is empty when there is no config.
  - `configFileUrl` is `https://github.com/<owner>/.github/blob/<defaultBranch>/standwise.yml` when the config exists, and `null` otherwise.
- **Layout, matching the approved desktop artboard:**
  - **Title row:** "Setup" plus a one-line subtitle, and a progress badge "{done} of {total} steps done" (i18n with placeholders).
    - total = 3, or 4 when some team uses `tracker: linear`.
    - done counts the GitHub App, which is always done on this page; Slack when it is connected; Linear when it is connected and valid (only if it counts toward the total); and the config when it is `configured`.
  - **Main column, one step card per step, each with a `StepStatus` icon, a title, a badge, a description and an action:**
    1. **GitHub App:** done, with "Installed on {owner}". When `accessWarning` is set, an inline warning `Alert`.
    2. **Slack:**
       - done with "Connected to {workspace}";
       - the admin gets a secondary "Reconnect" action, a member gets no action;
       - when it is not connected, the state is todo, the admin gets a primary "Connect Slack", and a member gets the existing admin-only text.
    3. **Linear:**
       - an "Optional" badge when no team uses it;
       - connected and valid is done;
       - invalid is the error state, with a danger `Alert` "Linear stopped working" and a "Reconnect Linear" action for the admin;
       - not connected is todo, with "Connect Linear" for the admin.
       - The tracker notices (`linear_not_connected`, `jira_coming_soon`) show here as warning `Alert`s.
    4. **`standwise.yml`:**
       - configured: done, with a secondary "Edit on GitHub" action linking `configFileUrl`, and a `.grid-2` of team cards showing name, channel, and "reminder {remindAt} · digest {digestAt}";
       - a team with a `teamNotices` entry gets the warning tone, with the notice text inside its card;
       - invalid: the error state, keeping the current error list (path and message) inside a `ScrollTable`, and the "keeps the last valid version" note;
       - unconfigured: todo, with the current reason, the "Create standwise.yml from the template" / "Create the .github repository" actions, and the template in a `<pre>`.
  - **Aside**, in this order:
    1. "Failed deliveries": `teamFailures` and `personFailures`, each as compact rows in a `ScrollTable`; "No failed deliveries." when both are empty.
    2. "API keys" (admin, when `apiKeys.manage`).
    3. "Webhooks" (admin, when `webhooks.manage`).
    4. The support line, with a `mailto:` link to `supportEmail`.
    
    The forms for creating and revoking API keys and webhooks keep their current fields, actions and csrf. Restyle only.
  - **One-time secrets** (new API key, new webhook secret) render first in the main column as an info `Alert`, with the value in `Code` and the existing "copy now, you won't see it again" text.
- **Phone layout**, matching the approved artboard: below 900 px the aside stacks under the main column; below 640 px step actions take the full width.

- [ ] **Step 1: Write the failing tests.** Keep every existing setup, admin and webhook test passing; update only selectors that were purely structural. Add:
  - the progress badge reads "3 of 3 steps done" for a configured install with Slack and no Linear teams, and "3 of 4" when a team uses Linear but it is not connected;
  - Slack-connected renders the done state; for a non-admin there is no "Reconnect" and no admin form (`action="/setup/`);
  - Linear invalid renders the danger alert and, for the admin, "Reconnect Linear";
  - a configured config renders one team card per team, with channel and times, and an "Edit on GitHub" link to `https://github.com/acme/.github/blob/main/standwise.yml`;
  - a team notice renders inside the right team card;
  - an invalid config renders every error path;
  - a 300-character webhook URL and a 120-character organization name render inside wrapping containers; assert the classes `ScrollTable` and `overflow-wrap` are used;
  - pt-BR renders the same structure with translated labels.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; also the full `bun test`, lint and typecheck.
- [ ] **Step 5: Commit** `feat(web): setup page as a step checklist with side cards`

### Task 4: Páginas de erro, documentação e revisão visual

**Files:**
- Modify: `apps/api/src/web/error.tsx`, `docs/site/admin/install.md` and the pt-BR version (only where they describe what the setup page shows), `packages/core/src/i18n.ts`
- Test: `apps/api/test/web.test.ts`

**Interfaces:**
- Consumes: the kit (Task 1) and `Layout` (Task 2).
- The error page is a centered `Card` with a `StepStatus`-style icon:
  - danger for `forbidden`, `invalid_state`, `access_denied`, `slack_oauth_failed`, `linear_oauth_failed`;
  - warning for `rate_limited`, `installation_pending`;
  - neutral for the others.
  
  It shows the title, the body, the existing action as a primary `ButtonLink`, and a "Questions? {supportEmail}" line. `ErrorPage` gains `supportEmail`; pass it in from `deps.env.supportEmail`.

- [ ] **Step 1: Write the failing tests:**
  - each error code renders its tone class, its title and the support line;
  - the `signIn` and `refresh` actions render as buttons;
  - the 500 page still renders without a session.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5:** Update `docs/site/admin/install.md` (en and pt-BR) so the steps match the new labels: "Connect Slack", "Connect Linear", "Edit on GitHub", and the progress badge. Run `bun run check-docs` and `SUPPORT_EMAIL=x@y.z bun run docs:build`.
- [ ] **Step 6: Visual check.** Run the api locally against the test database with a seeded installation, using a small script under `scripts/` (not committed) or the existing test harness. Render `/setup` for admin, member, invalid config and Linear invalid, plus one error page, into HTML files in the scratchpad. In the report, describe how each one looks in light and dark mode, at 1280 px and at 390 px wide. If a headless browser is available, attach screenshots; if not, say so.
- [ ] **Step 7: Commit** `feat(web): error pages in the new design; install docs match the setup labels`
