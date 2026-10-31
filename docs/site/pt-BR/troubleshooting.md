# Solução de problemas

Os problemas mais comuns e como resolver. Se nada disto ajudar, mande um e-mail para <SupportEmail />.

## Não recebi lembrete

Os lembretes vão só para quem ainda não enviou a daily, no máximo uma vez por dia, no `remind_at` e antes do `digest_at`. Se o worker estava fora do ar, um lembrete pode atrasar até 60 minutos, mas nunca sai no `digest_at` ou depois. Confira se você já não enviou a daily, se hoje é dia útil nos `workdays` do time e se a página de setup não tem uma entrega `no_chat_identity` para você.

## `no_chat_identity`

O Standwise não conhece o seu usuário no Slack, então não consegue mandar um lembrete nem um impedimento encaminhado. A entrega com falha aparece na página de setup. Rode `standwise login` de novo depois que o Slack foi conectado, ou peça ao admin para adicionar `members.<seu-login>.slack` no `standwise.yml`. Veja [Meu nome aparece como @login](#meu-nome-aparece-como-login).

## `no_route_target`

Um impedimento foi reportado, mas não havia ninguém para recebê-lo. Isso acontece, por exemplo, quando o autor é o único gestor do time: o autor nunca recebe o próprio impedimento, então a lista de destinatários fica vazia. Peça ao admin para adicionar outro gestor ao time e avise as pessoas certas manualmente. Um gestor que existe mas não tem identidade no Slack aparece como `no_chat_identity` com o login dele.

## Ninguém recebeu o meu impedimento

1. **Cada impedimento é encaminhado uma vez.** Um impedimento com link é identificado pelo link: reescrever o texto ou enviar a daily de novo não envia outra vez. Um impedimento sem link é identificado pelo texto. No máximo 10 impedimentos diferentes por daily são encaminhados.
2. **O link decide.** Um pull request da sua própria organização vai para os revisores solicitados, depois para os CODEOWNERS. Um link de outra organização, um link malformado ou um pull request que não existe vai para os gestores. Sem link, vai para os gestores.
3. **Você nunca é destinatário** do seu próprio impedimento.
4. **As pessoas precisam de identidade no Slack.** Se nenhuma das pessoas encontradas tem, o impedimento vai para os gestores. Um gestor sem identidade aparece na página de setup como `no_chat_identity` com o login dele. Se não há nenhum gestor para receber, a página de setup mostra `no_route_target`.

## Meu nome aparece como @login

O consolidado mostra `@` e o seu login do GitHub, em texto, quando o Standwise não conhece o seu usuário no Slack. O seu usuário do Slack é ligado quando você entra, então confira:

1. **Você entrou depois que o Slack foi conectado.** Rode `standwise login` de novo.
2. **O `standwise.yml` tinha uma versão válida quando você entrou.** Se não existia ou nunca tinha sido válido, rode `standwise login` de novo depois de corrigido.
3. **Os seus e-mails batem.** O Standwise busca o seu usuário do Slack pelo e-mail principal verificado da sua conta do GitHub. Se a sua conta do Slack usa outro e-mail, peça ao admin para adicionar `members.<seu-login>.slack` com o seu id de membro do Slack no `standwise.yml` (veja [Mapeamento de identidades](/pt-BR/admin/configuration#mapeamento-de-identidades)). O mapeamento vale a partir do próximo consolidado.

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

## O check `Standwise config` falhou

Um push ou pull request no repositório `.github` alterou o `standwise.yml` e ele tem erros. Abra o check: cada erro é uma anotação na linha dele, e o resumo lista todos. Corrija e faça push de novo. Enquanto isso, a última versão válida continua valendo. Se o arquivo não existe, não há check.
