# Conceitos

Os termos usados no Standwise e nesta documentação.

## Instalação

Uma instalação do GitHub App do Standwise numa organização ou conta pessoal do GitHub. Tudo no Standwise pertence a uma instalação: configuração, dailies, conexão com o Slack, API keys e webhooks. Os dados nunca passam de uma instalação para outra.

## Organização

A organização do GitHub (ou conta pessoal) onde o app está instalado. A CLI e as tools do MCP chamam de `org` e usam o login dela no GitHub, por exemplo `acme`.

## Time

Um grupo de pessoas declarado em `teams` no `standwise.yml`. Cada time tem fuso, dias úteis, horário do consolidado, idioma e canal do Slack próprios. Veja a [referência do standwise.yml](/pt-BR/admin/configuration).

## Membro

Uma pessoa listada em `members` de um time, pelo login do GitHub ou por um time do GitHub (`@acme/backend`). Membros escrevem dailies. Uma pessoa pode estar em vários times.

## Gestor

Um login do GitHub listado em `managers` de um time. Gestores leem os consolidados, as dailies e os impedimentos do time pelas [tools de gestor](/pt-BR/members/mcp#tools-de-gestor) do servidor MCP. Em breve: impedimentos sem outra pessoa para encaminhar vão para o gestor.

## Admin

O dono de uma conta pessoal, ou um membro com o papel `admin` na organização do GitHub. Admins conectam o Slack, criam [API keys](/pt-BR/admin/api-keys) e [webhooks](/pt-BR/admin/webhooks) e podem ler todos os times pelas tools de gestor.

## Daily

A daily de uma pessoa para uma data, numa organização. Ela tem três listas:

- **Ontem:** o que a pessoa fez desde a última daily.
- **Hoje:** o que ela planeja fazer. Pelo menos um item.
- **Impedimentos:** o que a trava. Pode ficar vazia.

Cada item é uma linha de texto, com link opcional para um pull request, issue, commit ou card. Enviar de novo no mesmo dia substitui a daily anterior. Uma única daily aparece no consolidado de todos os times da pessoa.

## Data da daily

A data a que uma daily pertence. É o dia de hoje no fuso do primeiro time da pessoa (o primeiro time do `standwise.yml` que a lista). Num dia que não é útil, a daily conta para o próximo dia útil: uma daily enviada no sábado conta para segunda.

## Rascunho

O ponto de partida do "ontem", montado pelo Standwise a partir da atividade da pessoa no GitHub da organização desde a última daily: pull requests abertos, pull requests mergeados, revisões e commits. O agente mostra o rascunho, e a pessoa mantém, edita ou remove cada item.

## Consolidado

Uma mensagem no Slack por time por dia útil, publicada no `digest_at` do time. Primeiro os impedimentos, depois a daily de cada pessoa e, no fim, a lista de quem não enviou.

## Daily atrasada

Uma daily enviada depois que o consolidado do time foi publicado. Ela vai como resposta na thread do consolidado, uma vez por pessoa por dia.

## Confirmação

O Standwise só envia uma daily depois que a pessoa confirma. Nos clientes MCP que suportam, o próprio Standwise pergunta à pessoa; nos outros, o agente tem que perguntar. Veja [a regra de confirmação](/pt-BR/members/mcp#a-regra-de-confirmacao).

## Lembrete <Badge type="info" text="em breve" />

Uma mensagem direta no `remind_at` do time para quem ainda não enviou a daily. No máximo uma por pessoa por dia. A chave `remind_at` já é obrigatória no `standwise.yml`.

## Impedimento sugerido <Badge type="info" text="em breve" />

Um impedimento que o Standwise percebe por você, como um pull request seu esperando revisão há mais de `pr_review_hours`. Ele vai primeiro e só para você. O gestor só vê se você confirmar na sua daily.

## Encaminhamento de impedimentos <Badge type="info" text="em breve" />

Enviar cada impedimento para quem pode ajudar: os revisores do pull request ligado, o responsável pelo card que trava ou, se não houver, o gestor do time.

## Entrega

Uma tentativa de publicar uma mensagem no Slack: um consolidado ou uma daily atrasada. Cada uma é registrada uma vez por time, data e tipo, então uma nova tentativa nunca publica duas vezes. As entregas com falha aparecem na página de setup com o erro.

## API key

Um segredo que começa com `swk_`, criado por um admin na página de setup, com escopos somente leitura, para outros sistemas lerem as dailies confirmadas, os consolidados e os impedimentos da organização. Veja [API keys](/pt-BR/admin/api-keys).

## Webhook

Um endpoint HTTPS que um admin cadastra para receber eventos assinados: `daily.submitted`, `blocker.opened` e `digest.sent`. Veja [Webhooks](/pt-BR/admin/webhooks).

## Sessão

O que o `standwise login` guarda na sua máquina depois que você entra com o GitHub. Começa com `sw_`, é usada pela CLI, pela skill e pelo servidor MCP e expira depois de 90 dias sem uso.
