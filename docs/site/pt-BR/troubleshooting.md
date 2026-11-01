# Solução de problemas

Os problemas mais comuns e como resolver. Se nada disto ajudar, mande um e-mail para <SupportEmail />.

## Não recebi lembrete

Os lembretes vão só para quem ainda não enviou a daily, no máximo uma vez por dia, no `remind_at` e antes do `digest_at`. Se o worker estava fora do ar, um lembrete pode atrasar até 60 minutos, mas nunca sai no `digest_at` ou depois. Confira se você já não enviou a daily, se hoje é dia útil nos `workdays` do time e se a página de setup não tem uma entrega `no_chat_identity` para você.

## `no_chat_identity`

O Standcast não conhece o seu usuário no Slack, então não consegue mandar um lembrete nem um impedimento encaminhado. A entrega com falha aparece na página de setup. Rode `standcast login` de novo depois que o Slack foi conectado, ou peça ao admin para adicionar `members.<seu-login>.slack` no `standcast.yml`. Veja [Meu nome aparece como @login](#meu-nome-aparece-como-login).

## `no_route_target`

Um impedimento foi reportado, mas não havia ninguém para recebê-lo. Isso acontece, por exemplo, quando o autor é o único gestor do time: o autor nunca recebe o próprio impedimento, então a lista de destinatários fica vazia. Peça ao admin para adicionar outro gestor ao time e avise as pessoas certas manualmente. Um gestor que existe mas não tem identidade no Slack aparece como `no_chat_identity` com o login dele.

## Ninguém recebeu o meu impedimento

1. **Cada impedimento é encaminhado uma vez.** Um impedimento com link é identificado pelo link: reescrever o texto ou enviar a daily de novo não envia outra vez. Um impedimento sem link é identificado pelo texto. No máximo 10 impedimentos diferentes por daily são encaminhados.
2. **O link decide.** Um pull request da sua própria organização vai para os revisores solicitados, depois para os CODEOWNERS. Um link de outra organização, um link malformado ou um pull request que não existe vai para os gestores. Sem link, vai para os gestores.
3. **Você nunca é destinatário** do seu próprio impedimento.
4. **As pessoas precisam de identidade no Slack.** Se nenhuma das pessoas encontradas tem, o impedimento vai para os gestores. Um gestor sem identidade aparece na página de setup como `no_chat_identity` com o login dele. Se não há nenhum gestor para receber, a página de setup mostra `no_route_target`.

## Meu nome aparece como @login

O consolidado mostra `@` e o seu login do GitHub, em texto, quando o Standcast não conhece o seu usuário no Slack. O seu usuário do Slack é ligado quando você entra, então confira:

1. **Você entrou depois que o Slack foi conectado.** Rode `standcast login` de novo.
2. **O `standcast.yml` tinha uma versão válida quando você entrou.** Se não existia ou nunca tinha sido válido, rode `standcast login` de novo depois de corrigido.
3. **Os seus e-mails batem.** O Standcast busca o seu usuário do Slack pelo e-mail principal verificado da sua conta do GitHub. Se a sua conta do Slack usa outro e-mail, peça ao admin para adicionar `members.<seu-login>.slack` com o seu id de membro do Slack no `standcast.yml` (veja [Mapeamento de identidades](/pt-BR/admin/configuration#mapeamento-de-identidades)). O mapeamento vale a partir do próximo consolidado.

## A página de setup mostra um aviso sobre um time do GitHub

O aviso diz que um time do GitHub citado no `standcast.yml` não foi encontrado ou é grande demais. Se não foi encontrado, confira o nome em `members` e se o GitHub App tem a permissão **Members** da organização, que um dono da organização precisa aprovar. Se é grande demais, só os primeiros 5.000 membros são usados; liste os demais pelo login. O aviso some quando a próxima leitura da configuração não encontra mais o problema.

## Como saio da página de setup?

Use **Sair** no topo da página de setup. Isso encerra a sessão web no servidor. A sessão da CLI é separada: rode `standcast logout`.

## O Slack parou de me encontrar

Quando o Slack responde `user_not_found` ou `user_disabled` para uma pessoa, o Standcast remove a identidade do Slack guardada automaticamente, para não continuar enviando mensagens para o lugar errado. Entre de novo com `standcast login` para vincular o seu usuário atual do Slack.

## A página de setup diz que a conexão com o Linear parou de funcionar

A página de setup diz que a conexão com o seu workspace do Linear "parou de funcionar". O Linear parou de aceitar a conexão, em geral porque o acesso foi revogado no workspace do Linear. Peça a um admin para clicar em **Reconectar o Linear** na página de setup. Até lá, os recursos do Linear pausam em silêncio: os rascunhos ficam sem cards, os impedimentos de card vão para os gestores e as sugestões de card ficam como estão. Se o admin reconectar um workspace diferente, as ligações com o Linear são apagadas e refeitas quando as pessoas entram.

## Os meus cards não aparecem no rascunho

1. **O Linear está conectado.** Veja a página de setup. Se ela diz que a conexão com o workspace "parou de funcionar", peça a um admin para reconectar. O botão **Reconectar o Linear** aparece sempre para admins, então ele sozinho não quer dizer que há algo errado.
2. **O seu primeiro time usa o Linear.** Os cards vêm do tracker do seu primeiro time no `standcast.yml`, o primeiro que lista você. Confira `tracker: { provider: linear, team: <CHAVE> }` nesse time. A chave do time limita os cards a esse time do Linear.
3. **Você está ligado ao seu usuário no Linear.** O Standcast usa `members.<seu-login>.linear` (um e-mail) ou, sem ele, o seu e-mail principal verificado do GitHub. Se o seu e-mail no Linear é outro, peça ao admin para definir `members.<seu-login>.linear`. As ligações são feitas quando você entra depois que o Linear foi conectado, então rode `standcast login` de novo.
4. **O card mudou na janela.** Só aparecem os cards seus que foram para em andamento, ou foram concluídos, desde a sua última daily. Cards de outro workspace do Linear nunca são lidos.

## O consolidado não chegou

Abra a página de setup e confira, nesta ordem:

1. **O estado da configuração.** Se não estiver configurado, ou estiver inválido sem uma versão válida em uso, o Standcast não roda. Se estiver inválido depois de uma versão válida, o Standcast continua usando a última versão válida, então uma mudança que você acabou de enviar ainda não vale. Veja [Estados da configuração](/pt-BR/admin/install#estados-da-configuracao).
2. **O Slack está conectado.** Senão, a entrega falha com `no_chat_connection`. Só um admin pode conectar o Slack.
3. **"Últimas entregas com falha"** para o time e a data. O código do erro diz o que aconteceu; veja [Erros de entrega](/pt-BR/admin/slack#erros-de-entrega). Um canal privado precisa do bot convidado, senão o erro é `channel_not_found`.
4. **Hoje é dia útil** nos `workdays` do time, e o `digest_at` está no `timezone` do time. O consolidado não é enviado mais de 120 minutos depois do `digest_at`.
5. **O time usa `chat.provider: slack`.** O Google Chat vem em breve.

## "Mais de uma organização" ou código de saída 3

Você está em mais de uma organização com o Standcast. Passe `--org` para a CLI (por exemplo `standcast draft --org acme`) ou diga ao seu agente qual organização usar. Se a mensagem disser que nenhuma organização tem o Standcast instalado, veja o próximo problema.

## A minha organização não aparece, ou `org_not_found`

A sua sessão guardada lista as organizações do momento em que você entrou. Se o app foi instalado na sua organização depois disso, ou se você acabou de entrar nela, rode `standcast login` de novo. Se continuar falhando, confira se você é membro da organização no GitHub.

## `org_not_configured`

A organização não tem um `standcast.yml` válido em uso: o arquivo não existe, ou está inválido desde que foi criado ou desde que foi apagado. Um push inválido logo depois de uma versão válida não causa este erro, porque o Standcast continua usando a última versão válida. Peça ao admin para olhar a página de setup.

## `not_in_team`

Você não está em nenhum time do `standcast.yml`. Peça ao admin para adicionar o seu login do GitHub, ou um time do GitHub do qual você faz parte, em `members`.

## Meu token expirou, ou código de saída 2

A sessão da CLI expirou (depois de 90 dias sem uso) ou foi revogada. Rode:

```bash
standcast login
```

Se a mensagem disser que as credenciais guardadas pertencem a outra API, você está usando uma URL de API diferente daquela em que entrou. Entre de novo com essa URL: `standcast login --api-url <url>`.

## A daily é inválida, ou código de saída 4

Cada item tem que ser uma linha de 1 a 500 caracteres, sem tabs nem caracteres de controle, e o `today` precisa de pelo menos um item. As URLs dos links têm que usar `http` ou `https`. A mensagem lista cada problema por campo, como `today: Too small: expected array to have >=1 items`.

## `rate_limited`

Você mandou requisições demais em um minuto. Espere os segundos indicados na mensagem e tente de novo.

## A minha API key recebe 401 ou 403

- `401 unauthorized`: a key está ausente, digitada errado ou revogada. As API keys só funcionam em `/v1/org`.
- `403 insufficient_scope`: falta à key o escopo indicado em `required_scope`. Crie uma key com esse escopo.

## O meu endpoint de webhook foi desativado

Ele falhou 20 entregas seguidas. Corrija o receptor, adicione o endpoint de novo na página de setup e use o novo segredo. Use **Enviar evento de teste** para conferir. Veja [Webhooks](/pt-BR/admin/webhooks).

## O check `Standcast config` falhou

Um push ou pull request no repositório `.github` alterou o `standcast.yml` e ele tem erros. Abra o check: cada erro é uma anotação na linha dele, e o resumo lista todos. Corrija e faça push de novo. Enquanto isso, a última versão válida continua valendo. Se o arquivo não existe, não há check.
