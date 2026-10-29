# Slack

O Standwise publica o consolidado de cada time num canal do Slack. Cada instalação conecta um workspace do Slack.

## Conectar

Na página de setup, clique em **Conectar Slack** e aprove o app. Qualquer membro da organização que abre a página de setup pode conectar. A página passa a mostrar "Conectado ao workspace" e o nome do workspace.

Para conectar de novo, por exemplo depois que o app foi removido do Slack, abra `/connect/slack?installation_id=<id>` na API do Standwise, com o mesmo id de instalação da página de setup.

## Permissões do bot

| Escopo | Para quê |
| --- | --- |
| `chat:write` | Publicar o consolidado e as dailies atrasadas na thread dele |
| `chat:write.public` | Publicar em canais públicos sem ser convidado |
| `channels:read` | Transformar o nome de um `#canal` público no id dele |
| `groups:read` | Transformar o nome de um `#canal` privado no id dele, nos canais privados para os quais o bot foi convidado |
| `users:read` | Buscar usuários do Slack |
| `users:read.email` | Achar o usuário de uma pessoa no Slack pelo e-mail, para mencioná-la |
| `im:write` | Reservado para mensagens diretas: lembretes e encaminhamento de impedimentos, em breve |

O Standwise não lê mensagens.

## Canais

Defina o canal no `standwise.yml`, em `chat.channel`:

- `"#daily-backend"`: o nome do canal. Use aspas.
- `C0123456789`: o id do canal. No Slack, abra os detalhes do canal; o id fica no fim.

**Canais públicos** funcionam direto: o bot publica sem ser convidado.

**Canais privados** precisam do bot como membro. No canal, rode `/invite` e escolha o app do Standwise, ou adicione o app nos detalhes do canal, em **Integrações**. Até lá, o consolidado falha com `channel_not_found`.

Canais arquivados não são encontrados.

## Como as pessoas são mencionadas

O consolidado menciona cada pessoa pelo usuário dela no Slack quando o Standwise o conhece, e mostra `@` seguido do login do GitHub, em texto, quando não conhece. A pessoa é ligada ao usuário do Slack quando entra (com `standwise login` ou na página de setup), se o Slack já estiver conectado e o `standwise.yml` estiver válido:

1. Se o `standwise.yml` tiver `members.<login>.slack`, esse id é usado.
2. Senão, o Standwise busca o usuário do Slack pelo e-mail principal verificado da conta da pessoa no GitHub.

Se nada disso funcionar, o consolidado sai mesmo assim, com `@login`. Para resolver, veja [Meu nome aparece como @login](/pt-BR/troubleshooting#meu-nome-aparece-como-login).

## Erros de entrega

Quando uma publicação falha, a página de setup a lista em "Últimas entregas com falha", com o time, a data e o erro no formato `código: mensagem`. O Standwise tenta cada mensagem até 3 vezes no total. Um consolidado só é tentado de novo dentro de 120 minutos depois do `digest_at`.

| Código do erro | Significado | Como resolver |
| --- | --- | --- |
| `channel_not_found` | O canal não existe, está arquivado, ou é privado e o bot não está nele. | Confira o `chat.channel`. Num canal privado, convide o bot. |
| `not_in_channel` | O bot não é membro do canal. | Convide o bot para o canal. |
| `is_archived` | O canal está arquivado. | Desarquive o canal ou escolha outro. |
| `invalid_auth`, `token_revoked`, `account_inactive` | O token do Slack não funciona mais, em geral porque o app foi removido do workspace. | Conecte o Slack de novo. |
| `missing_scope` | Falta ao token uma permissão de que o Standwise precisa. | Conecte o Slack de novo e aprove todas as permissões. |
| `ratelimited` | O Slack pediu para o Standwise ir mais devagar. | Nada a fazer; a entrega é tentada de novo. |
| `no_chat_connection` | O Slack não está conectado nesta instalação. | Clique em **Conectar Slack** na página de setup. |
| `unsupported_provider` | O time usa `chat.provider: google-chat`, que vem em breve. | Use `slack`. |
| `worker_died` | O worker parou três vezes durante o envio. | Fale com o suporte se repetir. |
| `internal_error` | Erro inesperado. A mensagem traz os detalhes. | Fale com o suporte se repetir. |

Depois que você resolve a causa, o consolidado do dia seguinte sai normalmente. Um consolidado que já usou as 3 tentativas não é enviado de novo naquele dia.
