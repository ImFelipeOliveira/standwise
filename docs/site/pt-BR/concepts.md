# Conceitos

Os termos usados no Standcast e nesta documentação.

## Instalação

Uma instalação do GitHub App do Standcast numa organização ou conta pessoal do GitHub. Tudo no Standcast pertence a uma instalação: configuração, dailies, conexão com o Slack, API keys e webhooks. Os dados nunca passam de uma instalação para outra.

## Organização

A organização do GitHub (ou conta pessoal) onde o app está instalado. A CLI e as tools do MCP chamam de `org` e usam o login dela no GitHub, por exemplo `acme`.

## Time

Um grupo de pessoas declarado em `teams` no `standcast.yml`. Cada time tem fuso, dias úteis, horário do consolidado, idioma e canal do Slack próprios. Veja a [referência do standcast.yml](/pt-BR/admin/configuration).

## Membro

Uma pessoa listada em `members` de um time, pelo login do GitHub ou por um time do GitHub (`@acme/backend`). Membros escrevem dailies. Uma pessoa pode estar em vários times.

## Gestor

Um login do GitHub listado em `managers` de um time. Gestores leem os consolidados, as dailies e os impedimentos do time pelas [tools de gestor](/pt-BR/members/mcp#tools-de-gestor) do servidor MCP. Impedimentos sem outra pessoa para encaminhar vão para os gestores.

## Admin

O dono de uma conta pessoal, ou um membro com o papel `admin` na organização do GitHub. Admins conectam o Slack, criam [API keys](/pt-BR/admin/api-keys) e [webhooks](/pt-BR/admin/webhooks) e podem ler todos os times pelas tools de gestor.

## Daily

A daily de uma pessoa para uma data, numa organização. Ela tem três listas:

- **Ontem:** o que a pessoa fez desde a última daily.
- **Hoje:** o que ela planeja fazer. Pelo menos um item.
- **Impedimentos:** o que a trava. Pode ficar vazia.

Cada item é uma linha de texto, com link opcional para um pull request, issue, commit ou card. Enviar de novo no mesmo dia substitui a daily anterior. Uma única daily aparece no consolidado de todos os times da pessoa.

## Data da daily

A data a que uma daily pertence. É o dia de hoje no fuso do primeiro time da pessoa (o primeiro time do `standcast.yml` que a lista). Num dia que não é útil, a daily conta para o próximo dia útil: uma daily enviada no sábado conta para segunda.

## Rascunho

O ponto de partida do "ontem", montado pelo Standcast a partir da atividade da pessoa no GitHub da organização desde a última daily: pull requests abertos, pull requests mergeados, revisões e commits, mais os seus cards do Linear que começaram ou terminaram, quando o Linear está conectado. O agente mostra o rascunho, e a pessoa mantém, edita ou remove cada item.

## Consolidado

Uma mensagem no Slack por time por dia útil, publicada no `digest_at` do time. Primeiro os impedimentos, depois a daily de cada pessoa e, no fim, a lista de quem não enviou.

## Daily atrasada

Uma daily enviada depois que o consolidado do time foi publicado. Ela vai como resposta na thread do consolidado, uma vez por pessoa por dia.

## Confirmação

O Standcast só envia uma daily depois que a pessoa confirma. Nos clientes MCP que suportam, o próprio Standcast pergunta à pessoa; nos outros, o agente tem que perguntar. Veja [a regra de confirmação](/pt-BR/members/mcp#a-regra-de-confirmacao).

## Lembrete

Uma mensagem direta no `remind_at` do time para quem ainda não enviou a daily. No máximo uma por pessoa por dia, e só antes do consolidado.

## Impedimento sugerido

Um impedimento que o Standcast percebe por você: um pull request seu sem revisão há `pr_review_hours`, o CI falhando nele há 24 horas, ou um card seu no Linear em andamento há `card_stale_days`. Ele vai só para você, no seu rascunho. O gestor só vê se você confirmar na sua daily.

## Encaminhamento de impedimentos

Enviar cada impedimento novo uma vez para quem pode ajudar: os revisores do pull request ligado, depois os CODEOWNERS dele, depois os gestores do time. Para um card do Linear: os responsáveis pelos cards que o travam, depois o responsável por ele, depois quem o criou, depois os gestores.

## Conexão com o Linear

Uma conexão por instalação, feita por um admin na página de setup. Ela deixa o Standcast ler os cards de um workspace do Linear, só leitura. Veja [Instalar](/pt-BR/admin/install#5-conecte-o-linear-opcional).

## Entrega

Uma tentativa de enviar uma mensagem no Slack: um consolidado, uma daily atrasada, um lembrete ou um impedimento encaminhado por mensagem direta. Cada uma é registrada uma vez por time, data e tipo, então uma nova tentativa nunca publica duas vezes. As entregas com falha aparecem na página de setup com o erro.

## API key

Um segredo que começa com `sck_`, criado por um admin na página de setup, com escopos somente leitura, para outros sistemas lerem as dailies confirmadas, os consolidados e os impedimentos da organização. Veja [API keys](/pt-BR/admin/api-keys).

## Webhook

Um endpoint HTTPS que um admin cadastra para receber eventos assinados: `daily.submitted`, `blocker.opened` e `digest.sent`. Veja [Webhooks](/pt-BR/admin/webhooks).

## Sessão

O que o `standcast login` guarda na sua máquina depois que você entra com o GitHub. Começa com `sc_`, é usada pela CLI, pela skill e pelo servidor MCP e expira depois de 90 dias sem uso.
