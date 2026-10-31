---
title: Visão geral da API
outline: [2, 3]
---

# Visão geral da API

A API do Standwise permite que os seus sistemas leiam os dados da sua organização e recebam eventos. Ela é versionada em `/v1` e descrita por um documento OpenAPI 3.1.

- URL base: `https://api.standwise.dev`
- Documento OpenAPI: `https://api.standwise.dev/openapi.json`
- Referência interativa, com cada operação, parâmetro, exemplo e erro: [referência da API](https://api.standwise.dev/reference) (em inglês)

## O que a API oferece

- **Ler os dados da organização** com uma [API key](/pt-BR/admin/api-keys):

  | Operação | Escopo | Devolve |
  | --- | --- | --- |
  | `GET /v1/org/teams` | `teams:read` | Os times do `standwise.yml`: nome, fuso, dias úteis, horários e membros |
  | `GET /v1/org/dailies` | `dailies:read` | Dailies confirmadas, filtradas por `date` e `team` |
  | `GET /v1/org/dailies/{id}` | `dailies:read` | Uma daily |
  | `GET /v1/org/digests` | `digests:read` | Entregas do consolidado, com quem não enviou a daily, filtradas por `team`, `from` e `to` |
  | `GET /v1/org/blockers` | `blockers:read` | Impedimentos confirmados, filtrados por `date` e `team` |
  | `GET /health` | nenhum | Saúde do serviço |

- **Receber eventos** com [webhooks](/pt-BR/api/webhooks): `daily.submitted`, `blocker.opened` e `digest.sent`.

A API devolve só o que as pessoas confirmaram e o que já aparece no consolidado. Ela nunca devolve rascunhos, sugestões, métricas por pessoa, rankings ou agregados.

## O que a API não oferece

**Não dá para enviar uma daily pela API pública.** Agentes de IA enviam dailies pelo [servidor MCP](/pt-BR/members/mcp) ou pela [skill do Claude Code](/pt-BR/members/claude-code), e scripts pela [CLI](/pt-BR/members/cli).

Por quê: o Standwise nunca envia uma daily em nome de alguém sem a confirmação explícita da pessoa. Essa regra mora num lugar só, o servidor MCP e a skill, que mostram a daily para a pessoa e só enviam depois que ela confirma. Uma API key pertence à organização, não a uma pessoa, então não tem como carregar essa confirmação. As rotas que a CLI usa para enviar dailies são internas, autenticadas com a sessão de uma pessoa, e não fazem parte do contrato público.

## Começo rápido

```bash
curl -H "Authorization: Bearer $STANDWISE_API_KEY" \
  https://api.standwise.dev/v1/org/teams
```

```json
{
  "data": [
    {
      "name": "Alpha",
      "timezone": "America/Sao_Paulo",
      "workdays": ["mon", "tue", "wed", "thu", "fri"],
      "remindAt": "09:00",
      "digestAt": "10:00",
      "memberLogins": ["alice", "bob"]
    }
  ],
  "next_cursor": null
}
```

## Autenticação

A API pública do Standwise autentica com uma **API key**. Mande a key como bearer token em toda requisição:

```http
GET /v1/{resource} HTTP/1.1
Host: your-standwise-host
Authorization: Bearer swk_xxxxxxxxxxxxxxxxxxxxxxxx
```

As API keys começam com `swk_`. Toda operação em `/v1/org` exige uma. Só keys `swk_` são aceitas ali: um token de sessão (`sw_`) mandado para `/v1/org` falha com `401 unauthorized`, e uma API key mandada para uma rota só de sessão falha do mesmo jeito.

### Criar uma key

Só um admin da organização cria keys. O admin entra com o GitHub, abre a página de setup da organização e usa a seção **API keys**: dá um nome, escolhe os escopos e cria. Numa conta pessoal, o dono da conta é o admin. Cada key pertence a uma organização e vê só os dados dela.

O segredo completo aparece uma vez, quando a key é criada. O Standwise guarda só um hash e não consegue mostrar de novo, então copie na hora. A lista mostra o prefixo de cada key (os 8 primeiros caracteres depois de `swk_`), os escopos, a data de criação e o último uso, atualizado no máximo uma vez por minuto.

### Escopos

Dê o menor escopo que funciona.

| Escopo | Permite |
| --- | --- |
| `teams:read` | `GET /v1/org/teams` |
| `dailies:read` | `GET /v1/org/dailies` e `GET /v1/org/dailies/{id}` |
| `digests:read` | `GET /v1/org/digests` |
| `blockers:read` | `GET /v1/org/blockers` |

Uma requisição que precisa de um escopo que a key não tem falha com `403 insufficient_scope`. O erro informa o escopo que falta em `required_scope`:

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "api key lacks the dailies:read scope",
    "required_scope": "dailies:read"
  }
}
```

Keys ausentes, malformadas, desconhecidas e revogadas falham com `401 unauthorized`. Cada key tem limite de 600 requisições por minuto (veja Limites de taxa).

### Revogar uma key

Um admin pode revogar uma key a qualquer momento. A revogação vale na hora, e as próximas requisições com essa key falham com `401 unauthorized`. Para trocar uma key, crie a nova primeiro, coloque em produção e depois revogue a antiga.

### Guardar as keys com segurança

- Guarde as keys num gerenciador de segredos ou em variáveis de ambiente, nunca no controle de versão nem em código do cliente.
- Use uma key por integração, para revogar uma sem quebrar as outras.
- Nunca registre o header `Authorization` em log.
- Se uma key pode ter vazado, revogue na hora.

### Tokens de sessão (`sw_`)

Os tokens que começam com `sw_` são tokens de sessão emitidos para a CLI, a skill e o servidor MCP do Standwise depois de um login no GitHub. Eles não são um meio de integração, e as operações que liberam não fazem parte desta referência.

## Erros

Toda resposta de erro usa o mesmo envelope:

```json
{ "error": { "code": "invalid_daily", "message": "invalid daily", "issues": [] } }
```

O `code` é o contrato estável: decida pelo `code`, não pela `message`. A `message` é sempre em inglês e pode mudar. `issues` só aparece em erros de validação e lista os campos com problema. `required_scope` só aparece em erros de escopo.

| Código | Status HTTP | O que fazer |
| --- | --- | --- |
| `unauthorized` | 401 | A credencial está ausente, inválida, expirada ou revogada. Autentique de novo ou use uma key válida. |
| `invalid_request` | 422 | A requisição está malformada. Confira `issues` e corrija os campos listados. |
| `invalid_daily` | 422 | O payload da daily falhou na validação. Confira `issues` contra o schema. |
| `org_not_found` | 404 | A organização não existe ou o app do Standwise não está instalado nela. Confira o nome e a instalação. |
| `org_not_configured` | 409 | A organização não tem um `standwise.yml` válido. Adicione ou corrija o arquivo no repositório `.github` e tente de novo. |
| `not_in_team` | 422 | A pessoa não está em nenhum time desta organização. Adicione a pessoa a um time no `standwise.yml`. |
| `forbidden` | 403 | A credencial é válida, mas a pessoa ou a organização não pode fazer esta ação. |
| `insufficient_scope` | 403 | Falta à API key o escopo de que esta operação precisa. O erro traz `required_scope`. Crie uma key com esse escopo. |
| `not_found` | 404 | O recurso não existe na organização da key. |
| `suggestion_already_decided` | 409 | O impedimento sugerido já foi decidido no sentido oposto. Busque o rascunho de novo; ele não o lista mais. |
| `invalid_state` | 400 | Um link de autorização expirou ou foi adulterado. Comece o fluxo de novo. |
| `installation_pending` | 409 | A instalação ainda está sendo processada. Tente de novo em alguns segundos. |
| `access_denied` | 403 | A pessoa negou a autorização. Nada mudou. |
| `slack_oauth_failed` | 502 | O Slack recusou a conexão. Tente conectar de novo. |
| `linear_oauth_failed` | 502 | O Linear recusou a conexão. Tente conectar de novo. |
| `rate_limited` | 429 | Requisições demais. Espere `Retry-After` segundos e tente de novo (veja Limites de taxa). |
| `internal` | 500 | Erro inesperado no servidor. Tente de novo com backoff e fale com o suporte se persistir. |

## Paginação

As operações de listagem usam cursores opacos.

| Parâmetro | Onde | Descrição |
| --- | --- | --- |
| `limit` | query | Tamanho da página, de 1 a 100. O padrão é 50. |
| `cursor` | query | O `next_cursor` da página anterior. Omita para pegar a primeira página. |

Uma resposta paginada traz os itens e um `next_cursor`:

```json
{ "data": [], "next_cursor": "eyJpZCI6MTIzfQ" }
```

Quando `next_cursor` é `null`, não há mais páginas. Trate o cursor como texto opaco: não interprete, não monte e não guarde por muito tempo. Mantenha os mesmos filtros durante a paginação.

Um `cursor` inválido ou um `limit` fora de 1 a 100 falha com `422 invalid_request`. Dailies e consolidados vêm do mais recente para o mais antigo. Nos impedimentos, `limit` conta impedimentos, não dailies.

## Limites de taxa

Os limites usam uma janela fixa de 60 segundos.

| Credencial | Limite |
| --- | --- |
| Token de sessão (`sw_`) | 120 requisições por minuto |
| API key (`swk_`) | 600 requisições por minuto |
| Requisições sem autenticação | Contadas por endereço IP |
| Início de uma sessão da CLI | 10 requisições por minuto por endereço IP |

Os limites valem por credencial, então uma integração barulhenta não gasta o limite de outra.

### Headers

As rotas com limite devolvem estes headers em toda resposta:

| Header | Significado |
| --- | --- |
| `RateLimit-Limit` | Requisições permitidas na janela. |
| `RateLimit-Remaining` | Requisições que sobram na janela atual. |
| `RateLimit-Reset` | Segundos até a janela reiniciar. |

### Quando você passa do limite

A resposta é `429` com o código `rate_limited` e um header `Retry-After` com os segundos de espera:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 23
RateLimit-Limit: 600
RateLimit-Remaining: 0
RateLimit-Reset: 23
```

Espere `Retry-After` segundos antes de tentar de novo e espalhe as novas tentativas com jitter.

## Versionamento

A API é versionada no caminho. `/v1` é a versão estável atual.

- Novos campos podem aparecer nas respostas a qualquer momento. Ignore os campos que você não conhece.
- Novos parâmetros opcionais e novas operações podem entrar na `/v1` sem aviso.
- Uma mudança que quebra clientes existentes só sai na `/v2`.
- Antes de remover ou mudar de forma incompatível um comportamento da `/v1`, a mudança é anunciada no changelog com pelo menos 90 dias de antecedência.

Veja o [changelog](/pt-BR/changelog) com todas as versões.
