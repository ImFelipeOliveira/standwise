---
outline: [2, 3]
---

# Changelog

O que mudou no Standcast. As versões são as mesmas dos [releases no GitHub](https://github.com/ImFelipeOliveira/standcast/releases). A seção da API segue a [política de versionamento](/pt-BR/api/overview#versionamento).

## Produto

### Não lançado

### 0.3.1 — 01/11/2026

- O site de documentação publica `robots.txt` e um `sitemap.xml`, e a landing page serve as próprias fontes.

### 0.3.0 — 01/11/2026

- O Standwise agora é **Standcast**: novo nome, binário da CLI `standcast`, arquivo de configuração `standcast.yml`, variáveis de ambiente `STANDCAST_*`, headers de webhook `Standcast-*`, prefixos de token `sc_`/`sck_` e novas URLs (`api-standcast.usefachada.dev`, `docs-standcast.usefachada.dev`). As sessões e API keys existentes deixam de funcionar: entre de novo e crie keys novas.
- Landing page em [standcast.usefachada.dev](https://standcast.usefachada.dev/pt-BR/), em inglês e português, com um formulário para entrar no beta público. Depois de enviar, você vai para o guia de instalação.
- Documentação para agentes de IA: `llms.txt`, `llms-full.txt` e uma cópia em Markdown de cada página, em inglês e português. A API serve o próprio `llms.txt`, com links para o documento OpenAPI e os guias da API.
- A página de privacidade explica o que o formulário do beta guarda e por quanto tempo.
- Os arquivos CODEOWNERS são lidos em tempo linear.

### 0.2.1 — 31/10/2026

- Só ferramentas de release: as versões batem com os releases do GitHub em todo lugar. Nenhuma mudança no produto.

### 0.2.0 — 31/10/2026

Primeiro beta público.

- Reforço de robustez:
  - A página de setup mostra um aviso quando um time do GitHub no `standwise.yml` não é encontrado ou é grande demais (só os primeiros 5.000 membros são usados).
  - **Sair** na página de setup encerra a sessão web.
  - Links de pull request são comparados sem diferenciar maiúsculas de minúsculas, então um impedimento não é encaminhado duas vezes para a mesma pull request.
  - Revisões, eventos da timeline e check runs são lidos página por página no GitHub, então pull requests grandes não são mais cortadas.
  - O health check tem limite de tempo e não acumula consultas quando o banco está lento.
  - O instalador funciona em shells BusyBox.
  - Uma identidade antiga do Slack é removida automaticamente quando o Slack responde `user_not_found` ou `user_disabled`. A pessoa entra de novo para vincular outra vez.

- Site de documentação em inglês e português, com a visão geral do produto, guias para admins e membros, a referência do `standwise.yml` e os guias da API.
- Plugin do Claude Code com a skill `/daily` e o servidor MCP incluído.
- `standwise mcp`: servidor MCP local com as tools de rascunho e de envio confirmado, mais tools de leitura para gestores e admins.
- CLI `standwise`: `login`, `logout`, `whoami`, `draft`, `submit` e `suggestion`.
- Consolidado do time no Slack no `digest_at`, com as dailies atrasadas na thread.
- Página de setup: estado da configuração, conexão com o Slack, entregas com falha, API keys e webhooks.
- Lembretes por mensagem direta no `remind_at`, uma vez por pessoa por dia. O `remind_at` precisa ser anterior ao `digest_at`.
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
