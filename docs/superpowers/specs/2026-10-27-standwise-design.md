# Standwise — Design

> Status: rascunho para aprovação · 2026-10-27 · Autor: Felipe Oliveira
> Nome provisório: se "Standwise" não estiver disponível (domínio/marca), trocamos.

## 1. Intenção e porquê

Times de software já usam IA no dia a dia, e muitas pessoas já geram a própria daily com um agente (ex.: Claude Code lendo commits, PRs e cards). Isso funciona individualmente, mas:

- cada mensagem sai num formato diferente;
- o gestor recebe mensagens soltas e não tem uma visão consolidada;
- ninguém "orquestra" a daily: quem não mandou não é lembrado, e impedimentos ficam parados até alguém perceber.

**Standwise** é um orquestrador de daily: uma **skill** que cada pessoa instala no agente de IA para escrever a própria daily, e um **GitHub App** que recebe as dailies, consolida para o gestor, cobra quem não mandou, encaminha impedimentos para quem pode ajudar e sugere impedimentos que a pessoa não percebeu.

Objetivo imediato do autor: ter uma integração real com a API do GitHub para entrar no **GitHub Developer Program** (requisito: integração em produção ou desenvolvimento + e-mail de suporte). O objetivo de médio prazo é que outros times usem o app, já que o nível no programa depende do tamanho da base de usuários.

### Pesquisa de mercado (2026-10-27)
Existem ferramentas de standup a partir do GitHub (Taskade, GitMorning, Shogo, Swrly, standup-mcp, DailyBot, Daybrief), quase todas **apenas Slack** e **apenas gerando o relatório**. Nenhuma encontrada combina: skill no agente de IA + orquestração (cobrança, encaminhamento de impedimentos, impedimentos sugeridos) + Google Chat **e** Slack + Linear **e** Jira. Lembretes de PR no Google Chat já são cobertos pelo app oficial do GitHub e **não** são foco.

## 2. Usuários

- **Membro do time:** escreve a própria daily pelo agente de IA.
- **Gestor:** recebe o consolidado do time no chat e é acionado quando um impedimento não tem a quem ser encaminhado.
- **Admin da organização:** instala o GitHub App, conecta chat e gerenciador de projetos e define a configuração.

## 3. Objetivos, não-objetivos, anti-objetivos

**Objetivos (v1)**
1. Skill que gera um rascunho do "ontem" a partir da atividade real (GitHub + Linear/Jira); a pessoa confirma, escreve "hoje" e impedimentos, e envia.
2. Consolidado do time entregue no chat (Slack ou Google Chat) num horário configurado.
3. Lembrete para quem ainda não enviou, antes do consolidado.
4. Impedimento declarado → notificar quem pode ajudar.
5. Impedimentos sugeridos a partir de sinais (PR sem revisão, card parado) → a pessoa confirma ou ignora.
6. Arquitetura plugável: adicionar um novo chat ou gerenciador de projetos = implementar uma interface.
7. Painel web **opcional** (histórico e configuração visual). Nada da v1 depende dele.

**Não-objetivos (v1)**
- Métricas de produtividade, rankings, contagem de commits por pessoa.
- Reunião ao vivo, vídeo, transcrição.
- Lembretes genéricos de PR (o app oficial do GitHub para Google Chat já faz).
- Suporte a outros agentes além do Claude Code (a CLI é agnóstica, mas a skill empacotada na v1 é só para Claude Code).
- Outros gerenciadores (GitHub Projects, Asana, ClickUp…) e chats (Teams, Discord…) — a arquitetura prevê, mas a v1 não implementa.

**Anti-objetivos (falha mesmo que funcione)**
- **Virar ferramenta de vigilância.** A pessoa tem sempre a palavra final sobre a própria daily. Impedimentos sugeridos vão **primeiro e só para a pessoa**; o gestor só vê o que a pessoa confirmou. Nada é enviado em nome da pessoa sem a confirmação dela.
- Daily 100% automática: o "hoje" e os impedimentos são escritos por humanos.
- Encher o chat de ruído: cada pessoa recebe no máximo **1 lembrete por dia**, e cada impedimento sugerido aparece **no máximo uma vez** (se ignorado, não volta enquanto o sinal não mudar).

## 4. Fluxos

### 4.1 Instalação (admin)
1. Instala o GitHub App na organização (repositórios: todos ou selecionados).
2. É redirecionado para a **página de setup** (servida pela API, HTML simples), onde conecta:
   - chat: Slack (OAuth, bot token) e/ou Google Chat (Chat app do Google Workspace);
   - gerenciador: Linear (OAuth) e/ou Jira Cloud (OAuth 2.0 3LO).
3. Cria o arquivo `standwise.yml` **na raiz** do repositório `.github` da organização (ou da conta pessoal), no branch padrão. No resto do documento, "`.github/standwise.yml`" se refere a esse arquivo. A página de setup **não escreve no repositório**: ela mostra o template e um link `github.com/<owner>/.github/new/main?filename=standwise.yml&value=<template>` que abre o editor do GitHub já preenchido. O painel web, quando existir, edita a mesma configuração abrindo PR (fase 2).
4. A configuração vem **só do GitHub** na v1. Se o repositório `.github` não existir ou não estiver entre os repositórios liberados para o app, a instalação fica no estado "não configurada", e a página de setup explica como resolver (criar o repo ou liberar o acesso). *(Chamada minha.)*

### 4.2 Membro
1. Instala o plugin do Claude Code (skill + CLI `standwise`).
2. `standwise login` → GitHub **device flow** (user-to-server token do GitHub App). Isso identifica a pessoa e a vincula à(s) organização(ões) onde o app está instalado.
3. Vínculo de identidades no chat e no gerenciador: automático por e-mail; se não bater, por mapeamento manual no `standwise.yml` (seção `members`) ou com `standwise link slack|google-chat|linear|jira`.
4. Diariamente, a pessoa roda `/daily` no Claude Code:
   - a skill chama `standwise draft` → a **API** devolve o rascunho do "ontem" (atividade desde a última daily útil) e impedimentos sugeridos pendentes;
   - o agente pode enriquecer com contexto local (ex.: sessões do próprio agente), apresenta o rascunho, e a pessoa ajusta o "ontem", escreve o "hoje" e os impedimentos (cada impedimento pode referenciar um PR ou card);
   - a skill chama `standwise submit` com o JSON validado (schema Zod compartilhado).
5. Reenviar no mesmo dia **substitui** a daily anterior (só vale a última).
6. **Pessoa em vários times** *(chamada minha)*: a daily pertence à pessoa + data, não ao time. Uma única `/daily` aparece no consolidado de todos os times de que a pessoa participa. "Hoje" e "último dia útil" seguem o fuso e os dias úteis do **primeiro time** em que a pessoa aparece no config. O limite de 1 lembrete por dia é por pessoa. Pessoa em várias organizações: uma daily por organização, e a CLI pergunta qual (ou usa `--org`).

### 4.3 Orquestrador (worker)
Todos os horários são no fuso do time, apenas em dias úteis configurados.

- **Lembrete** (`remind_at`): mensagem direta no chat para quem não enviou.
- **Consolidado** (`digest_at`): uma mensagem no canal do time, com resumo por pessoa, impedimentos em destaque no topo e a lista de quem não enviou. Dailies enviadas depois do consolidado aparecem como resposta na thread.
- **Encaminhamento de impedimento** (ao receber uma daily com impedimentos), na ordem:
  1. Impedimento ligado a um PR → revisores solicitados do PR (ou os CODEOWNERS dos arquivos, se não houver revisor).
  2. Impedimento ligado a um card → responsável do card do qual a pessoa depende (relação "blocked by" no Linear e "is blocked by" no Jira); se não houver relação, responsável do próprio card ou o criador.
  3. Senão → gestor do time.
  A notificação vai como mensagem direta para quem pode ajudar, com link para o PR/card e para a daily.
- **Impedimentos sugeridos** (varredura diária antes do `remind_at` + webhooks do GitHub em tempo real):
  - PR da pessoa aberto, não-draft, sem nenhuma review há mais de `pr_review_hours` (padrão 48);
  - card da pessoa em status "em andamento" há mais de `card_stale_days` (padrão 5);
  - checks falhando no **head do PR aberto da própria pessoa** há mais de 24h (via `check_suite`/`check_run`). Branch padrão quebrado **não** entra, porque não dá para atribuir a uma pessoa de forma justa. *(Chamada minha.)*
  As sugestões aparecem no `standwise draft` e, opcionalmente, como mensagem direta. Se forem ignoradas, não voltam até o sinal mudar (ex.: nova review, mudança de status).

### 4.4 Configuração (`.github/standwise.yml`)
```yaml
teams:
  - name: backend
    timezone: America/Boa_Vista
    workdays: [mon, tue, wed, thu, fri]
    remind_at: "09:30"
    digest_at: "10:00"
    language: pt-BR            # pt-BR | en
    managers: [felipeoliveira]  # GitHub logins
    members: [alice, bob]       # GitHub logins, ou um GitHub team: "@org/backend"
    chat:
      provider: slack           # slack | google-chat
      channel: "#daily-backend"
    tracker:
      provider: linear          # linear | jira
      team: BE                  # chave do time no Linear / projeto no Jira
    signals:
      pr_review_hours: 48
      card_stale_days: 5
members:                        # opcional: mapeamento manual de identidades
  alice: { slack: U0123, linear: alice@acme.com }
```
Mudanças no arquivo chegam por webhook `push` e são validadas. Se a configuração for inválida, o app cria um **check run** com falha no commit, mostrando os erros, e mantém a última versão válida. O mesmo check roda em PRs que alteram o arquivo.

### 4.5 API pública (adicionado em 2026-10-28)
A API é um produto para integradores, com documentação de primeira classe. Ela tem três tipos de integrador:

1. **Agentes de IA** (Cursor, Codex, Copilot…) que escrevem a daily em nome da pessoa. Eles usam as mesmas rotas da CLI (`/v1/draft`, `/v1/dailies`) com token de sessão `sw_…`, obtido pelo GitHub device flow + `POST /v1/sessions`. A regra anti-vigilância vale igual: nada é enviado sem confirmação da pessoa.
2. **Sistemas da organização (leitura)** com **API key da instalação** (`swk_…`), criada e revogada por um admin na página de setup. As keys têm escopos (`teams:read`, `dailies:read`, `digests:read`, `blockers:read`). Elas leem só o que já aparece no consolidado: dailies e impedimentos confirmados. Nunca há sugestões, métricas por pessoa, ranking ou agregados por pessoa.
3. **Webhooks de saída** configurados pelo admin, com URL https e eventos `daily.submitted`, `blocker.opened` e `digest.sent`. A assinatura é HMAC-SHA256 no header `Standwise-Signature: t=<unix>,v1=<hex>`. As entregas são feitas com retentativa e backoff. Há proteção contra SSRF (só https; IPs privados, de loopback e link-local são bloqueados depois da resolução de DNS).

**MCP:** `standwise mcp` (servidor MCP local por stdio, no mesmo binário da CLI) expõe as tools `standwise_whoami`, `standwise_get_draft` e `standwise_submit_daily`. Esta última exige `confirmed: true`, que só pode ser passado depois de a pessoa confirmar. Assim qualquer cliente MCP (Cursor, Codex, Claude Desktop…) escreve a daily sem uma skill própria. O MCP remoto (HTTP + OAuth) fica para a fase 2.

**Admin da instalação** = dono da conta (conta pessoal) ou membro com papel `admin` na organização do GitHub.

**Documentação:** OpenAPI 3.1 gerado a partir dos schemas Zod das rotas, servido em `GET /openapi.json`, e referência navegável em `GET /docs`. Cada rota tem descrição, exemplos de request e response e todos os códigos de erro. A documentação inclui os guias: autenticação (sessão vs API key), integração de um agente de IA passo a passo, erros (envelope `{ error: { code, message } }`), paginação por cursor, limites de taxa (headers `RateLimit-*`), verificação de assinatura de webhook (com exemplo em TypeScript e Python), versionamento (`/v1`, mudanças incompatíveis só em `/v2`) e changelog.

## 5. Arquitetura

```
Claude Code (skill + CLI)  ──HTTPS──▶  API (Bun + Hono)  ◀── webhooks GitHub
                                          │      ▲              (push, pull_request,
                                          ▼      │               pull_request_review,
                                      Postgres ◀─┴── Worker      installation, check_suite)
                                          ▲      (pg-boss)
                                          │         │
                              Painel (Next.js,      ├──▶ ChatChannel: Slack | Google Chat
                              opcional)             └──▶ ProjectTracker: Linear | Jira
```

### 5.1 Stack (decidida)
| Parte | Escolha |
|---|---|
| Linguagem | TypeScript em tudo |
| Runtime, pacotes, testes | **Bun** (workspaces, `bun test`) |
| API + webhooks + páginas de setup/OAuth | **Hono** (páginas com Hono JSX) |
| Fila e agendamentos | **pg-boss**, por trás de uma interface `JobQueue` (permite trocar por BullMQ/Redis depois) |
| Banco | **Postgres + Drizzle** |
| Validação / contratos | **Zod** (schemas compartilhados entre CLI, API e painel) |
| GitHub | `@octokit/app`, `@octokit/webhooks` |
| Slack | `@slack/web-api` + verificação de assinatura no Hono (sem Bolt) |
| Google Chat | `googleapis` (Chat API) |
| Linear / Jira | `@linear/sdk` / `jira.js` |
| CLI | TS compilado com `bun build --compile` (binário único por SO) |
| Painel | **Next.js** (opcional, fase 1b) |
| Deploy | **Railway**: serviços `api`, `worker`, `web`, Postgres |

Se alguma biblioteca falhar no Bun, aquele serviço pode rodar em Node sem reescrita (o Hono roda em qualquer runtime).

### 5.2 Monorepo
```
apps/api        Hono: REST para a CLI, webhooks, setup/OAuth
apps/worker     pg-boss: lembretes, consolidado, varreduras, encaminhamento
apps/web        Next.js (opcional)
apps/cli        CLI standwise (login, draft, submit, link)
packages/core   domínio: daily, blockers, regras de encaminhamento, config schema
packages/db     Drizzle schema + migrações
packages/adapters/{github,slack,google-chat,linear,jira}
packages/plugin plugin do Claude Code (skill /daily + manifest)
```

### 5.3 Interfaces dos adaptadores (forma, não assinatura final)
- `ProjectTracker`: `listActivity(user, since)`, `getIssue(ref)`, `getBlockingIssues(ref)`, `listStaleInProgress(user, days)`, `findUserByEmail(email)`.
- `ChatChannel`: `postToChannel(channel, message)`, `replyInThread(ref, message)`, `sendDirect(user, message)`, `findUserByEmail(email)`.
- As mensagens são um modelo neutro (blocos: título, seção, lista, link, menção), e cada adaptador renderiza no formato próprio (Slack Block Kit, Google Chat cards v2).

### 5.4 Dados (esboço)
`installations`, `teams` (config materializada), `members` (github_user_id + identidades vinculadas), `connections` (tokens OAuth por instalação, **criptografados**), `dailies` (team, member, data, yesterday, today, raw JSON), `blockers` (daily, texto, ref PR/card, status, notificados), `suggestions` (member, tipo de sinal, ref, estado: pending/confirmed/ignored, fingerprint do sinal), `deliveries` (log de mensagens enviadas, para idempotência e auditoria).

## 6. Restrições

- **Segurança:** tokens OAuth criptografados em repouso (AES-256-GCM, chave em variável de ambiente); verificação de assinatura em todos os webhooks (GitHub, Slack, Google); permissões do GitHub App, **fixadas antes do lançamento** (adicionar uma depois obriga toda organização a aprovar de novo): Metadata (read), Contents (read: `standwise.yml` e CODEOWNERS), Pull requests (read), Checks (**write**: ler checks dos PRs e publicar o check run de validação do config), Commit statuses (read), Members (read: GitHub teams no config); permissão de conta Email addresses (read), para vincular identidades por e-mail *(chamada minha, adicionada no planejamento)*. Eventos: `installation`, `installation_repositories`, `push`, `pull_request`, `pull_request_review`, `check_suite`, `check_run`. Nenhuma outra permissão de escrita.
- **Gerenciadores de projeto** *(chamada minha)*: uma conexão por instalação, feita pelo admin. No Linear, OAuth com `actor=app` (o app age como ele mesmo e vê os times autorizados). No Jira, token 3LO do admin que conectou; limitação documentada: cards que o admin não vê ficam de fora. Tokens por membro ficam para a fase 2.
- **Google Chat** *(chamada minha)*: no serviço hospedado, um único Chat app no projeto Google Cloud do Standwise, publicado na Google Workspace Marketplace, que o cliente instala. A tabela `connections` guarda credenciais por instalação de qualquer forma.
- **Idempotência:** jobs agendados e envios usam chave única (team + data + tipo), para que um retry nunca duplique mensagens.
- **Multi-tenant:** todo dado tem o escopo da instalação do GitHub App.
- **Google Chat:** mensagens diretas e posts em espaços exigem um Chat app configurado num projeto do Google Cloud e instalado no Workspace do cliente. Isso é mais atrito que no Slack e precisa estar documentado no setup.
- **Developer Program:** o README e a página do app têm e-mail de suporte.
- **Idioma:** código e identificadores em inglês; mensagens ao usuário em pt-BR e en (i18n desde o início).

## 7. Decisões tomadas por mim (Claude) — revisar
- **Hospedagem (decidido pelo Felipe):** serviço multi-tenant **hospedado apenas pelo Felipe**. Não há opção de rodar no próprio servidor. Segredos e URLs vêm de variáveis de ambiente (boa prática, não promessa de self-host).
- Código **público no GitHub, licença MIT** *(chamada minha)*.
- O rascunho do "ontem" é montado pela **API** (que tem as conexões), não localmente pelo agente. Assim fica igual em qualquer agente; o agente pode enriquecer.
- Configuração no `.github/standwise.yml` do repositório `.github` da organização.
- Reenvio no mesmo dia substitui a daily anterior.
- Sinal de CI falhando como terceiro tipo de impedimento sugerido.

## 8. Faseamento
Sem prazo: o projeto anda no ritmo do autor. A fase 1a é construída por completo, na ordem das dependências.

- **1a (MVP):** GitHub App + API + worker + CLI/skill; Slack + Linear; lembrete, consolidado, encaminhamento, sugestões e check run de validação do config. Deploy no Railway, README com e-mail de suporte. Inscrição no Developer Program.
- **1b:** Google Chat + Jira (completa a v1 prometida).
- **2:** Painel Next.js (histórico, tendências, edição de configuração), listagem na GitHub Marketplace, outros agentes e adaptadores.

## 9. Deixado para o builder
- Formato visual exato das mensagens (dentro das regras: impedimentos no topo, uma mensagem por consolidado).
- Estrutura de rotas da API, nomes de tabelas e colunas, estratégia de migração.
- Como a CLI guarda o token localmente (keychain do SO quando disponível).
- Biblioteca de i18n.
- Estratégia de testes (unitário no `core` e nos adaptadores com fixtures; integração da API com Postgres real).
- Conteúdo da skill `/daily` (prompt), respeitando o fluxo da seção 4.2.
