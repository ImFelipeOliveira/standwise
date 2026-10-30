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

## API

O changelog da API é mantido em inglês.

<!--@include: ../../api/CHANGELOG.md{3,}-->
