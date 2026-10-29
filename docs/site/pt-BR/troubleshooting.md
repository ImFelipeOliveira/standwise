# Solução de problemas

Os problemas mais comuns e como resolver. Se nada disto ajudar, mande um e-mail para <SupportEmail />.

## Não recebi lembrete

Os lembretes vêm em breve. Hoje o Standwise não os envia, mesmo com o `remind_at` obrigatório no `standwise.yml`. O consolidado lista quem não enviou a daily.

## Meu nome aparece como @login

O consolidado mostra `@` e o seu login do GitHub, em texto, quando o Standwise não conhece o seu usuário no Slack. O seu usuário do Slack é ligado quando você entra, então confira:

1. **Você entrou depois que o Slack foi conectado.** Rode `standwise login` de novo.
2. **O `standwise.yml` tinha uma versão válida quando você entrou.** Se não existia ou nunca tinha sido válido, rode `standwise login` de novo depois de corrigido.
3. **Os seus e-mails batem.** O Standwise busca o seu usuário do Slack pelo e-mail principal verificado da sua conta do GitHub. Se a sua conta do Slack usa outro e-mail, peça ao admin para adicionar `members.<seu-login>.slack` com o seu id de membro do Slack no `standwise.yml` (veja [Mapeamento de identidades](/pt-BR/admin/configuration#mapeamento-de-identidades)) e rode `standwise login` de novo.

## O consolidado não chegou

Abra a página de setup e confira, nesta ordem:

1. **O estado da configuração.** Se não estiver configurado, ou estiver inválido sem uma versão válida em uso, o Standwise não roda. Se estiver inválido depois de uma versão válida, o Standwise continua usando a última versão válida, então uma mudança que você acabou de enviar ainda não vale. Veja [Estados da configuração](/pt-BR/admin/install#estados-da-configuracao).
2. **O Slack está conectado.** Senão, a entrega falha com `no_chat_connection`. Só um admin pode conectar o Slack.
3. **"Últimas entregas com falha"** para o time e a data. O código do erro diz o que aconteceu; veja [Erros de entrega](/pt-BR/admin/slack#erros-de-entrega). Um canal privado precisa do bot convidado, senão o erro é `channel_not_found`.
4. **Hoje é dia útil** nos `workdays` do time, e o `digest_at` está no `timezone` do time. O consolidado não é enviado mais de 120 minutos depois do `digest_at`.
5. **O time usa `chat.provider: slack`.** O Google Chat vem em breve.

## "Mais de uma organização" ou código de saída 3

Você está em mais de uma organização com o Standwise. Passe `--org` para a CLI (por exemplo `standwise draft --org acme`) ou diga ao seu agente qual organização usar. Se a mensagem disser que nenhuma organização tem o Standwise instalado, veja o próximo problema.

## A minha organização não aparece, ou `org_not_found`

A sua sessão guardada lista as organizações do momento em que você entrou. Se o app foi instalado na sua organização depois disso, ou se você acabou de entrar nela, rode `standwise login` de novo. Se continuar falhando, confira se você é membro da organização no GitHub.

## `org_not_configured`

A organização não tem um `standwise.yml` válido em uso: o arquivo não existe, ou está inválido desde que foi criado ou desde que foi apagado. Um push inválido logo depois de uma versão válida não causa este erro, porque o Standwise continua usando a última versão válida. Peça ao admin para olhar a página de setup.

## `not_in_team`

Você não está em nenhum time do `standwise.yml`. Peça ao admin para adicionar o seu login do GitHub, ou um time do GitHub do qual você faz parte, em `members`.

## Meu token expirou, ou código de saída 2

A sessão da CLI expirou (depois de 90 dias sem uso) ou foi revogada. Rode:

```bash
standwise login
```

Se a mensagem disser que as credenciais guardadas pertencem a outra API, você está usando uma URL de API diferente daquela em que entrou. Entre de novo com essa URL: `standwise login --api-url <url>`.

## A daily é inválida, ou código de saída 4

Cada item tem que ser uma linha de 1 a 500 caracteres, sem tabs nem caracteres de controle, e o `today` precisa de pelo menos um item. As URLs dos links têm que usar `http` ou `https`. A mensagem lista cada problema por campo, como `today: Too small: expected array to have >=1 items`.

## `rate_limited`

Você mandou requisições demais em um minuto. Espere os segundos indicados na mensagem e tente de novo.

## A minha API key recebe 401 ou 403

- `401 unauthorized`: a key está ausente, digitada errado ou revogada. As API keys só funcionam em `/v1/org`.
- `403 insufficient_scope`: falta à key o escopo indicado em `required_scope`. Crie uma key com esse escopo.

## O meu endpoint de webhook foi desativado

Ele falhou 20 entregas seguidas. Corrija o receptor, adicione o endpoint de novo na página de setup e use o novo segredo. Use **Enviar evento de teste** para conferir. Veja [Webhooks](/pt-BR/admin/webhooks).
