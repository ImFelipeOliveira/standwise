# Standwise — Monetização

> Status: **direção, não decisão final** · 2026-10-28 · Dono: Felipe Oliveira
> Público: pessoas e agentes de IA trabalhando neste repositório. Leia antes de propor
> planos, limites, paywalls, tabelas de billing ou qualquer recurso "premium".
> Relacionado: `docs/superpowers/specs/2026-10-27-standwise-design.md` (§3 anti-objetivos, §7 hospedagem, §8 faseamento).

## Modelo

**Open-core + SaaS hospedado.** O código é público sob MIT (spec §7) e continua assim.
O que se cobra é o **serviço hospedado operado só pelo Felipe**: API, worker, Postgres,
GitHub App, Slack App e Google Chat app. O valor está em ninguém precisar operar isso.

## Planos (proposta)

| Plano | Para quem | Preço de referência | O que inclui |
|---|---|---|---|
| Grátis | times pequenos, adoção inicial | US$ 0 | até 5 pessoas, 1 time, histórico de 30 dias, Slack + Linear |
| Pago | organizações | US$ 2–4 por pessoa **ativa**/mês | vários times e organizações, histórico além de 30 dias com busca, painel web (tendências do time, edição de config por PR), Jira, Google Chat, depois Teams, mais sinais de impedimento sugerido e roteamento avançado |
| (fase 2) Análise com IA | organizações no plano pago | incluso no Pago (BYOK); opção com chave do Standwise a definir | classificação de impedimentos, PRs/branches que precisam de atenção e dependências, com relatórios no Slack, Google Chat e Linear/Jira (spec §8.1) |
| Empresarial | contratos maiores | negociado | SSO, retenção configurável, auditoria, DPA/LGPD, suporte com SLA |

Referência de mercado: Geekbot, DailyBot e Range custam ~US$ 2,50–4 por usuário/mês.

Canal de venda na fase 2: **GitHub Marketplace**. A cobrança vai na fatura do GitHub da
empresa e não exige aprovar um fornecedor novo.

## Regras para quem implementa

**DEVE**
- Cobrar a **organização ou o gestor**, nunca o membro do time.
- Manter a experiência do membro **idêntica em todos os planos**: `/daily`, rascunho,
  envio, lembrete e impedimentos sugeridos para a própria pessoa.
- Restringir só o que tem custo de operação ou de manutenção: quantidade de times e
  organizações, retenção, painel, integrações extras e sinais avançados.
- Manter todo dado com o escopo da instalação (multi-tenant). O plano é um atributo da instalação.

**NÃO DEVE**
- Vender, ou colocar atrás de paywall, recurso de vigilância: métricas por pessoa,
  ranking, contagem de commits, "produtividade" individual ou comparação entre pessoas.
  Isso fere o anti-objetivo da spec §3 e destrói a confiança de quem usa o `/daily` todo dia.
- Bloquear o envio de uma daily por limite de plano. Se a organização estourar o limite,
  degrade o lado do gestor (consolidado, painel), nunca o do membro.
- Mostrar paywall, upsell ou banner de upgrade para membros, seja na skill, na CLI ou nas DMs.
- Implementar billing antes da fase 2 sem pedido explícito do Felipe.

## Faseamento

1. **Fase 1 (atual):** tudo grátis. O objetivo é crescer a base de usuários para subir de nível
   no GitHub Developer Program. **Não implementar planos nem cobrança.**
2. **Fase 2:** o plano pago entra junto com o painel web e a listagem no GitHub Marketplace.
3. **Depois:** plano empresarial, conforme a demanda.

## Impacto no código (quando chegar a hora)

- `installations` ganha uma coluna de plano (por exemplo `plan text not null default 'free'`) e,
  se vier do Marketplace, o id da assinatura. Isso pode esperar a fase 2. Não adicione na fase 1
  sem pedido.
- "Pessoa ativa" para cobrança = membro com ao menos uma daily enviada no mês, por instalação.
  Assim, quem só está listado no config e nunca usou não é cobrado.
- Webhooks do GitHub Marketplace (`marketplace_purchase`) entram como eventos novos do App.
  Lembre que **adicionar permissão** ao App obriga as organizações a reaprovar (spec §6),
  então planeje isso junto com outras mudanças de permissão.

## Expectativa realista

É um mercado com demanda, mas concorrido e de ticket baixo. O provável é renda complementar
ou produto de nicho, não uma startup grande. O diferencial que justifica cobrar é a
combinação que nenhum concorrente pesquisado oferece:
- skill no agente de IA;
- orquestração (cobrança de quem não enviou, encaminhamento de impedimentos);
- Slack **e** Google Chat;
- Linear **e** Jira.

## Perguntas em aberto

- Limites exatos do plano grátis (5 pessoas e 1 time? histórico de 30 dias?).
- Preço final por pessoa e se haverá desconto anual.
- Se Jira e Google Chat (fase 1b) nascem pagos ou entram grátis e viram pagos depois.
