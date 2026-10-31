---
outline: [2, 3]
---

# Changelog

O que mudou no Standwise. A seção da API segue a [política de versionamento](/pt-BR/api/overview#versionamento): mudanças incompatíveis são anunciadas com pelo menos 90 dias de antecedência.

## Produto

### Não lançado

- Site de documentação em inglês e português, com a visão geral do produto, guias para admins e membros, a referência do `standwise.yml` e os guias da API.
- Plugin do Claude Code com a skill `/daily` e o servidor MCP incluído.
- `standwise mcp`: servidor MCP local com as tools de rascunho e de envio confirmado, mais tools de leitura para gestores e admins.
- CLI `standwise`: `login`, `logout`, `whoami`, `draft`, `submit` e `suggestion`.
- Consolidado do time no Slack no `digest_at`, com as dailies atrasadas na thread.
- Página de setup: estado da configuração, conexão com o Slack, entregas com falha, API keys e webhooks.
- Lembretes por mensagem direta no `remind_at`, uma vez por pessoa por dia.
- Encaminhamento de impedimentos por mensagem direta: revisores, depois CODEOWNERS, depois gestores.
- Impedimentos sugeridos para pull requests sem revisão e CI falhando, visíveis só para a pessoa, com `signals.direct_message` para receber também por mensagem direta.
- Check run `Standwise config` nas mudanças do `standwise.yml`.
- Retenção: logs de entrega de webhook depois de 30 dias, sugestões resolvidas depois de 90 dias, sessões expiradas removidas.
- O inglês é o idioma padrão quando nenhum é definido.
- Integração com o Linear: um admin conecta um workspace do Linear por instalação na página de setup (app OAuth que age como ele mesmo, escopo só de leitura `read`, tokens criptografados e renovados automaticamente). **Requisito de deploy:** a api e o worker agora precisam de `LINEAR_CLIENT_ID` e `LINEAR_CLIENT_SECRET` e não iniciam sem elas.
- `tracker: { provider: linear, team: <CHAVE> }` por time e `members.<login>.linear` (e-mail); as pessoas também são ligadas pelo e-mail do GitHub. `tracker.provider: jira` é aceito, com um aviso no setup.
- Os seus cards do Linear (`card_started`, `card_done`) no rascunho, e impedimentos de card encaminhados aos responsáveis pelos cards que travam, depois ao responsável pelo card, a quem o criou ou aos gestores.
- Impedimento sugerido `card_stale` para cards em andamento há `signals.card_stale_days` (padrão 5), visível só para a pessoa.

## API

O changelog da API é mantido em inglês.

<!--@include: ../../api/CHANGELOG.md{3,}-->
