# Standwise

O Standwise organiza a daily do seu time. Cada pessoa escreve a própria daily com o agente de IA dela, a partir de um rascunho do que fez no GitHub. O Standwise junta as dailies e publica um consolidado por time no Slack, no horário que você escolher.

## O que é

O Standwise tem duas partes que trabalham juntas:

- **Um GitHub App** que o admin da organização instala. Ele lê a configuração dos times no arquivo `standwise.yml`, recebe as dailies e publica o consolidado do time no Slack.
- **Uma skill, uma CLI e um servidor MCP** que cada pessoa usa com o agente de IA dela (Claude Code, Cursor, Codex, Claude Desktop, VS Code). O agente busca um rascunho do trabalho de ontem, a pessoa corrige, escreve o plano de hoje e os impedimentos e confirma antes de qualquer envio.

Ele resolve três problemas que aparecem quando o time escreve a daily com IA:

- **Dailies soltas.** Cada mensagem vem num formato diferente, num lugar diferente.
- **Gestor sem visão consolidada.** O gestor lê mensagens espalhadas e não tem um retrato único do time.
- **Ninguém orquestra.** Ninguém acompanha quem mandou a daily, e os impedimentos ficam parados até alguém perceber.

## Para quem é

- **Membros** escrevem a própria daily pelo agente de IA. Comece por [Primeiros passos](/pt-BR/members/getting-started).
- **Gestores** recebem o consolidado do time no Slack e leem as dailies, os consolidados e os impedimentos do time pela própria IA. Comece pelo [Servidor MCP](/pt-BR/members/mcp).
- **Admins** instalam o GitHub App, conectam o Slack e escrevem o `standwise.yml`. Comece pela [Instalação](/pt-BR/admin/install).
- **Integradores** leem os dados da organização com uma API key e recebem webhooks. Comece pela [visão geral da API](/pt-BR/api/overview).

## Como funciona

```text
  Agente de IA da pessoa                Standwise                        Slack
 ┌──────────────────────┐ rascunho  ┌────────────────────────┐      ┌───────────────────┐
 │ skill /daily         │ ◀──────── │ API                    │      │ #daily-backend    │
 │ CLI standwise        │           │  · lê o GitHub         │      │                   │
 │ standwise mcp        │ ────────▶ │  · guarda a daily      │ ───▶ │ um consolidado    │
 │ (pessoa confirma)    │   envio   │ Worker                 │      │ por time por dia, │
 └──────────────────────┘           │  · consolidado no      │      │ dailies atrasadas │
                                    │    digest_at           │      │ na thread         │
                                    │  · atrasada → thread   │      └───────────────────┘
                                    └────────────────────────┘
                                                 │
                                                 └──▶ API keys e webhooks para os seus sistemas
```

1. A pessoa roda `/daily` no Claude Code, ou pede a daily a qualquer cliente MCP.
2. O Standwise monta um rascunho do "ontem" a partir da atividade da pessoa no GitHub desde a última daily: pull requests abertos e mergeados, revisões e commits.
3. A pessoa ajusta o ontem, escreve o hoje e os impedimentos e confirma. Nada é enviado antes disso.
4. No `digest_at`, no fuso do time, o Standwise publica uma mensagem no canal do time: impedimentos no topo, depois a daily de cada pessoa e, no fim, quem não enviou.
5. Uma daily enviada depois do consolidado vai como resposta na thread dele.

Em volta disso, o Standwise orquestra o dia:

- no `remind_at`, quem ainda não enviou a daily recebe uma mensagem direta;
- cada impedimento novo vai por mensagem direta para quem pode ajudar: os revisores do pull request, os CODEOWNERS dele ou os gestores do time;
- impedimentos sugeridos, como um pull request esperando revisão ou com CI falhando, aparecem só para você, no seu rascunho;
- toda mudança no `standwise.yml` é validada por um check run no GitHub.

Os cards do Linear aparecem no rascunho e no encaminhamento de impedimentos. Em breve: Google Chat e Jira.

Veja [Como funciona](/pt-BR/how-it-works) para o ciclo completo de um dia.

## O que o Standwise não faz

- **Não é ferramenta de vigilância.** A pessoa tem sempre a palavra final sobre a própria daily. Nada é enviado em nome de ninguém sem a confirmação explícita da pessoa.
- **Não mede produtividade.** Não há ranking, nota, contagem de commits por pessoa nem agregados por pessoa, nem no consolidado, nem na API, nem nas tools do MCP.
- **Não escreve a daily por você.** O rascunho é um ponto de partida. O plano de hoje e os impedimentos são escritos pela pessoa.
- **Não lê o seu código nem as suas mensagens no Slack.** Veja [Privacidade](/pt-BR/privacy).
- **Não manda os seus dados para um modelo de IA.** Nenhum LLM processa os seus dados nos servidores do Standwise. O seu agente roda na sua máquina, com a sua conta.

## Comece aqui

| Você é | Leia |
| --- | --- |
| Admin configurando a organização | [Instalação](/pt-BR/admin/install) e depois a [referência do standwise.yml](/pt-BR/admin/configuration) |
| Membro escrevendo a primeira daily | [Primeiros passos](/pt-BR/members/getting-started) |
| Usuário do Claude Code | [Skill do Claude Code](/pt-BR/members/claude-code) |
| Usuário do Cursor, Codex, Claude Desktop ou VS Code | [Servidor MCP](/pt-BR/members/mcp) |
| Gestor | [Servidor MCP](/pt-BR/members/mcp#tools-de-gestor) e [Como funciona](/pt-BR/how-it-works) |
| Integrador | [Visão geral da API](/pt-BR/api/overview) e [Webhooks](/pt-BR/api/webhooks) |

Não conhece os termos? Veja [Conceitos](/pt-BR/concepts).
