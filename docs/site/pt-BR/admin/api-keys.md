# API keys

As API keys permitem que outros sistemas leiam os dados da sua organização: times, dailies confirmadas, consolidados e impedimentos confirmados. Elas são somente leitura. Elas não enviam daily.

Só admins gerenciam as keys: o dono de uma conta pessoal, ou um membro com o papel `admin` na organização do GitHub.

## Criar uma key

1. Abra a página de setup da organização e entre com o GitHub.
2. Em **API keys**, dê um nome para a integração, como `data-warehouse`.
3. Escolha os escopos de que ela precisa.
4. Clique em **Criar chave**.

A página mostra a key completa, começando com `swk_`, **uma vez só**. Copie na hora. O Standwise guarda só um hash dela e não consegue mostrá-la de novo. Se não conseguiu copiar, revogue e crie outra.

A lista mostra o nome, o prefixo (os 8 primeiros caracteres depois de `swk_`), os escopos, a data de criação e o último uso de cada key. O último uso é atualizado no máximo uma vez por minuto.

## Escopos

| Escopo | Permite |
| --- | --- |
| `teams:read` | `GET /v1/org/teams` |
| `dailies:read` | `GET /v1/org/dailies` e `GET /v1/org/dailies/{id}` |
| `digests:read` | `GET /v1/org/digests` |
| `blockers:read` | `GET /v1/org/blockers` |

Dê só o que a integração precisa. Uma requisição sem o escopo certo falha com `403 insufficient_scope`.

## Usar uma key

Mande a key como bearer token:

```bash
curl -H "Authorization: Bearer $STANDWISE_API_KEY" \
  "https://api.standwise.dev/v1/org/dailies?date=2026-10-28&team=backend"
```

Cada key tem limite de 600 requisições por minuto. Veja a [visão geral da API](/pt-BR/api/overview).

## Trocar uma key

As keys não expiram. Para trocar uma:

1. Crie uma key nova com os mesmos escopos.
2. Coloque a nova na integração.
3. Revogue a antiga.

## Revogar uma key

Clique em **Revogar** ao lado da key. Ela para de funcionar na hora: as próximas requisições falham com `401 unauthorized`. As keys revogadas continuam na lista, marcadas como revogadas.

Se uma key pode ter vazado, revogue na hora.

## Boas práticas

- Uma key por integração, para revogar uma sem quebrar as outras.
- Guarde as keys num gerenciador de segredos ou em variáveis de ambiente, nunca no controle de versão nem em código do navegador.
- Nunca registre o header `Authorization` em log.
