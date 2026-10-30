# Referência do standwise.yml

O Standwise lê toda a configuração de um arquivo só: o `standwise.yml` na **raiz** do repositório `.github` da organização (ou da conta pessoal), na branch padrão. Não existe outro lugar para configurar os times.

Todo exemplo `yaml` desta página passa pelo parser de verdade quando a documentação é gerada.

## Exemplo mínimo

```yaml
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "10:00"
    language: pt-BR
    managers: [alice]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily-backend"
```

## Exemplo completo

```yaml
teams:
  - name: backend
    timezone: America/Boa_Vista
    workdays: [mon, tue, wed, thu, fri]
    remind_at: "09:30"
    digest_at: "10:00"
    language: pt-BR
    managers: [felipeoliveira]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily-backend"
    tracker:
      provider: linear
      team: BE
    signals:
      pr_review_hours: 48
      card_stale_days: 5
      direct_message: false
members:
  alice: { slack: U0123, linear: alice@acme.com }
```

## Nível de cima

| Chave | Tipo | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- | --- |
| `teams` | lista de times | sim | | Pelo menos um time. Os nomes dos times têm que ser únicos. |
| `members` | mapa de login do GitHub para identidades | não | `{}` | Mapeamento manual de identidades. Veja [Mapeamento de identidades](#mapeamento-de-identidades). |

Nenhuma outra chave é aceita. Uma chave desconhecida falha na validação com `Unrecognized key`.

## Chaves do time

| Chave | Tipo | Obrigatória | Padrão | Exemplo |
| --- | --- | --- | --- | --- |
| `name` | texto, não vazio | sim | | `backend` |
| `timezone` | fuso IANA | sim | | `America/Sao_Paulo` |
| `workdays` | lista de `mon` `tue` `wed` `thu` `fri` `sat` `sun`, pelo menos um | não | `[mon, tue, wed, thu, fri]` | `[mon, tue, wed, thu]` |
| `remind_at` | `HH:MM`, 24 horas | sim | | `"09:30"` |
| `digest_at` | `HH:MM`, 24 horas | sim | | `"10:00"` |
| `language` | `en` ou `pt-BR` | não | `en` | `pt-BR` |
| `managers` | lista de logins do GitHub, pelo menos um | sim | | `[felipeoliveira]` |
| `members` | lista de logins ou times do GitHub, pelo menos um | sim | | `[alice, "@acme/backend"]` |
| `chat.provider` | `slack` ou `google-chat` | sim | | `slack` |
| `chat.channel` | texto, não vazio | sim | | `"#daily-backend"` |
| `tracker.provider` | `linear` ou `jira` | não | | `linear` |
| `tracker.team` | texto, não vazio | com `tracker` | | `BE` |
| `signals.pr_review_hours` | número maior que 0 | não | `48` | `24` |
| `signals.card_stale_days` | número maior que 0 | não | `5` | `3` |
| `signals.direct_message` | `true` ou `false` | não | `false` | `true` |

### `name`

O nome do time, como aparece no título do consolidado, na API e nas tools do MCP. Tem que ser único no arquivo. Renomear um time começa um histórico novo com o novo nome.

### `timezone`

Um nome de fuso IANA, como `America/Sao_Paulo`, `Europe/Lisbon` ou `UTC`. Abreviações como `BRT` e nomes de cidade como `Brasilia` são recusados.

### `workdays`

Os dias em que o time tem daily, com os nomes em inglês. Os consolidados só saem nesses dias. Uma daily enviada em outro dia conta para o próximo dia útil.

### `remind_at`

O horário local do lembrete, enviado por mensagem direta no Slack, em dias úteis, para quem ainda não enviou a daily. No máximo um por pessoa por dia. Ele tem que ser antes do `digest_at`, senão o arquivo é inválido. Veja [Como funciona](/pt-BR/how-it-works).

### `digest_at`

O horário local em que o consolidado é publicado. Use aspas (`"10:00"`) para manter o valor como texto. Use dois dígitos na hora: `"09:00"`, não `"9:00"`.

### `language`

O idioma do consolidado e das dailies atrasadas publicadas na thread dele: `en` ou `pt-BR`. Sem essa chave, o time usa inglês. Ela não muda o que as pessoas escreveram: as dailies nunca são traduzidas.

### `managers`

Logins do GitHub dos gestores do time. Gestores leem os consolidados, as dailies e os impedimentos do time pelas [tools de gestor do MCP](/pt-BR/members/mcp#tools-de-gestor). Admins da organização leem todos os times sem precisar estar listados. Impedimentos sem outra pessoa para encaminhar vão para os gestores.

Cada item precisa ser um login simples. Nomes que começam com `@`, como `@acme/leads`, não são aceitos: o Standwise não expande times do GitHub, então liste os logins um a um. Um item de time é rejeitado com um erro.

### `members`

Quem escreve dailies neste time. Cada item é:

- um login do GitHub, como `alice`; ou
- um time do GitHub, escrito `"@org/slug-do-time"`, como `"@acme/backend"`. Use aspas, porque o YAML não aceita valor começando com `@`.

Os times do GitHub são resolvidos toda vez que o Standwise precisa do time, então as mudanças no GitHub valem sem editar o arquivo. O Standwise lê os 100 primeiros membros de cada time do GitHub. Os logins são comparados sem diferenciar maiúsculas e minúsculas.

Uma pessoa pode estar em vários times. A daily dela aparece no consolidado de cada time, e a data da daily usa o fuso e os dias úteis do **primeiro** time que a lista.

### `chat`

Para onde vai o consolidado.

- `provider`: `slack`. O parser aceita `google-chat`, mas ele ainda não é suportado: os consolidados desse time falham com `unsupported_provider`.
- `channel`: o canal do Slack, como `"#nome"` (com aspas, porque `#` começa um comentário no YAML) ou como id do canal, por exemplo `C0123456789`. Num canal privado, convide o bot do Standwise antes. Veja [Slack](/pt-BR/admin/slack).

### `tracker` <Badge type="info" text="em breve" />

O gerenciador de projetos do time: `provider` (`linear` ou `jira`) e `team` (a chave do time no Linear ou do projeto no Jira). O parser aceita para você já poder escrever, mas o Standwise ainda não se conecta ao Linear nem ao Jira.

### `signals`

Ajustes dos impedimentos sugeridos, que aparecem só para a pessoa a quem se referem:

- `pr_review_hours`: um pull request seu, aberto e que não é rascunho, sem revisão há esse número de horas desde que ficou pronto para revisão. Padrão `48`.
- `card_stale_days`: um card em andamento há mais desse número de dias. Padrão `5`. Passa a valer com as integrações com Linear e Jira, que vêm em breve.
- `direct_message`: com `true`, o impedimento sugerido também é enviado à pessoa por mensagem direta, uma vez por sugestão. Padrão `false`.

O CI falhando no commit head de um pull request conta depois de 24 horas, e não é configurável.

## Times do GitHub

Use um time do GitHub em vez de listar as pessoas uma a uma. O app precisa da permissão Members (read), que ele pede na instalação.

```yaml
teams:
  - name: platform
    timezone: Europe/Lisbon
    remind_at: "09:00"
    digest_at: "09:30"
    managers: [carol]
    members: ["@acme/platform", dave]
    chat:
      provider: slack
      channel: C0123456789
```

## Vários times

Cada time tem canal, fuso e horários próprios. A Erin está nos dois times, então a data da daily dela segue o `backend`, o primeiro time que a lista.

```yaml
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "10:00"
    language: pt-BR
    managers: [felipeoliveira]
    members: [alice, bob, erin]
    chat:
      provider: slack
      channel: "#daily-backend"
  - name: mobile
    timezone: America/New_York
    workdays: [mon, tue, wed, thu]
    remind_at: "08:45"
    digest_at: "09:15"
    managers: [frank]
    members: [erin, grace]
    chat:
      provider: slack
      channel: "#daily-mobile"
```

## Mapeamento de identidades

O Standwise menciona as pessoas no Slack comparando o e-mail principal verificado da conta do GitHub com o e-mail do usuário no Slack. Quando os e-mails são diferentes, mapeie a pessoa à mão na chave `members` do nível de cima, pelo login do GitHub:

```yaml
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily-backend"
members:
  bob: { slack: U0456 }
```

| Chave | Usada hoje | Valor |
| --- | --- | --- |
| `slack` | sim | Id de membro no Slack, como `U0456`. No Slack, abra o perfil da pessoa, clique nos três pontos e em **Copiar ID de membro**. |
| `google_chat` | em breve | Usuário do Google Chat |
| `linear` | em breve | E-mail do usuário no Linear |
| `jira` | em breve | Conta no Jira |

Um mapeamento `slack` vale a partir do próximo consolidado, mesmo para quem nunca entrou. Quem não tem mapeamento é ligado pelo e-mail ao entrar com `standwise login` ou na página de setup. Se você conectar outro workspace do Slack, as ligações por e-mail são apagadas e refeitas no próximo login.

## Erros de validação comuns

Estas são as mensagens que a página de setup mostra, no formato `caminho: mensagem`. As mensagens são em inglês. `teams.0` é o primeiro time, `teams.1` o segundo, e assim por diante.

| Mensagem | Causa | Como resolver |
| --- | --- | --- |
| `teams.0.digest_at: must be HH:MM (24h)` | Um horário como `"9:30"`, `"10h"` ou `"25:00"` | Use dois dígitos e 24 horas: `"09:30"` |
| `teams.0.digest_at: Invalid input: expected string, received undefined` | Falta o `digest_at` (o mesmo vale para `remind_at`, `timezone` e `name`) | Adicione a chave |
| `teams.0.timezone: unknown IANA timezone` | `Brasilia`, `BRT`, `GMT-3` | Use um nome como `America/Sao_Paulo` |
| `teams.0.workdays.0: Invalid option: expected one of "mon"\|"tue"\|"wed"\|"thu"\|"fri"\|"sat"\|"sun"` | `monday`, `Mon`, `seg` | Use as três letras minúsculas em inglês |
| `teams.0.workdays: Too small: expected array to have >=1 items` | `workdays: []` | Liste pelo menos um dia, ou remova a chave |
| `teams.0.language: Invalid option: expected one of "pt-BR"\|"en"` | `pt`, `pt_BR`, `portugues` | Use `pt-BR` ou `en` |
| `teams.0.chat.provider: Invalid option: expected one of "slack"\|"google-chat"` | `teams`, `Slack` | Use `slack` |
| `teams.0.members: Too small: expected array to have >=1 items` | `members: []` (o mesmo vale para `managers`) | Liste pelo menos uma pessoa |
| `teams.0.managers.0: managers must be GitHub logins, not teams or @-prefixed names` | `managers: ["@acme/leads"]` | Liste os logins, como `[alice, bob]` |
| `teams.0: Unrecognized key: "reminder"` | Uma chave escrita errado ou desconhecida | Confira a chave nas tabelas acima |
| `members.alice.slack: must be a Slack user id like U0123ABCD` | Um nome, um e-mail, um id de canal ou `<!channel>` | Use o id de membro, que começa com `U` ou `W` |
| `members.alice: Unrecognized key: "slak"` | Uma chave de identidade escrita errado | Use `slack`, `google_chat`, `linear` ou `jira` |
| `teams.1.name: duplicate team name "backend"` | Dois times com o mesmo nome | Renomeie um deles |
| `teams.0.signals.pr_review_hours: Too small: expected number to be >0` | `0` ou um número negativo | Use um número positivo |
| `teams: Too small: expected array to have >=1 items` | `teams: []` | Adicione um time |
| `: Invalid input: expected object, received null` | O arquivo está vazio | Adicione pelo menos um time |
| Uma mensagem de sintaxe do YAML com linha e coluna | Indentação quebrada, `[` ou aspas sem fechar | Corrija o YAML nessa linha |

Enquanto o arquivo estiver inválido, o Standwise continua usando a última versão válida até você corrigir. Veja [Estados da configuração](/pt-BR/admin/install#estados-da-configuracao).
