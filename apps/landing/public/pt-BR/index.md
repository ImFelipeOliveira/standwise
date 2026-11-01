# Standwise: a sua daily, escrita no seu agente de IA

> Código aberto (MIT), grátis durante o beta público. Funciona hoje com GitHub e Slack. Google Chat e Jira vêm a seguir.

Rode `/daily` no Claude Code, no Cursor ou no terminal. O Standwise rascunha o seu ontem a partir da sua atividade no GitHub e no Linear, você confirma e o seu time recebe um consolidado no Slack.

```sh
curl -fsSL https://api-standwise.usefachada.dev/install.sh | sh
```

- [Entrar no beta](https://standwise.usefachada.dev/pt-BR/#beta)
- [Instalar na sua organização](https://docs-standwise.usefachada.dev/pt-BR/admin/install)
- [Documentação](https://docs-standwise.usefachada.dev/pt-BR/)
- [GitHub](https://github.com/ImFelipeOliveira/standwise)
- [English version](https://standwise.usefachada.dev/index.md)

Escreva a sua daily onde você já trabalha: Claude Code, Cursor, Codex, Claude Desktop, VS Code e o terminal.

## Um dia com o Standwise

Defina dois horários no standwise.yml. O Standwise cuida do resto. Este time tem `remind_at: "09:30"` e `digest_at: "10:00"` no horário de São Paulo, de segunda a sexta.

- **08:50, rascunho.** Ana roda /daily. Ela edita o rascunho, adiciona um impedimento com link para um pull request e confirma. Quem revisa recebe uma mensagem direta.
- **09:30, remind_at.** Davi ainda não escreveu, então recebe um lembrete. Nunca mais de um por dia.
- **10:00, digest_at.** Um consolidado por time no #daily-backend: primeiro os impedimentos, depois as atualizações, depois quem não enviou.
- **10:40, atrasada.** Davi envia atrasado. A daily dele vai para a thread do consolidado, e ninguém perde nada.

## O que ele faz

Coleta, consolida e entrega. Você só escreve.

- **Um rascunho do trabalho real.** Pull requests abertos, mergeados e revisados, commits por repositório e cards do Linear que começaram ou terminaram. Na segunda, o rascunho cobre o fim de semana.
- **Impedimentos chegam a quem pode ajudar.** Um impedimento com link para um pull request vai para os reviewers, depois para o CODEOWNERS, depois para os gestores do time. Um card do Linear vai para o responsável pelo card que está bloqueando.
- **Nada sai sem você.** A tool de envio do MCP exige `confirmed: true`, que o agente só passa depois que você aprova o texto.
- **Vários times, uma daily.** Escreva uma vez e apareça no consolidado de todos os seus times, cada um no próprio fuso horário e nos próprios dias úteis.
- **Gestores leem pelo próprio agente.** Consolidados, dailies e impedimentos dos últimos 90 dias, pelas tools de leitura do MCP. Só conteúdo confirmado.
- **API e webhooks.** API keys somente leitura com escopos, uma referência OpenAPI e webhooks assinados `daily.submitted` e `blocker.opened`.

## Privacidade

Feito para times, não para vigiar pessoas. O Standwise sugere impedimentos a partir dos seus próprios sinais. Essas sugestões são suas. Um teste na CI garante que elas nunca saem do seu rascunho.

O seu time vê:

- As dailies que você confirmou, no consolidado do time
- Os impedimentos que você confirmou, encaminhados para quem pode ajudar
- Quem ainda não enviou a daily de hoje

Só você vê:

- Um pull request esperando review há dias
- A CI falhando na sua branch há um dia
- Um card do Linear parado em andamento

Sem métricas de produtividade. Sem rankings. Sem contagem de commits. Nada enviado em nome de ninguém.

## Configuração como código

Um arquivo no seu repositório .github. Times, horários, canais do Slack e gestores ficam no `standwise.yml`. Toda mudança passa por review, como código.

- **Validado a cada push.** Um check run `Standwise config` aponta a linha com erro.
- **Nunca quebra o time.** Um push inválido mantém a última configuração válida em vigor.
- **Times do GitHub.** Os membros podem ser logins ou `@org/team`.

```yaml
# .github/standwise.yml
teams:
  - name: Backend
    timezone: America/Sao_Paulo
    workdays: [mon, tue, wed, thu, fri]
    remind_at: "09:30"
    digest_at: "10:00"
    chat:
      provider: slack
      channel: "#daily-backend"
    tracker:
      provider: linear
      team: BE
    managers: [bruno]
    members: ["@acme/backend"]
```

Veja a [referência do standwise.yml](https://docs-standwise.usefachada.dev/pt-BR/admin/configuration).

## Três jeitos de escrever

### Plugin do Claude Code

A skill `/daily` rascunha, pergunta o plano de hoje e os impedimentos e confirma com você.

```text
/plugin marketplace add \
  ImFelipeOliveira/standwise
/plugin install standwise@standwise
/daily
```

### Qualquer cliente MCP

Cursor, Codex, Claude Desktop e VS Code rodam o [servidor MCP](https://docs-standwise.usefachada.dev/pt-BR/members/mcp) local.

```json
{
  "mcpServers": {
    "standwise": {
      "command": "standwise",
      "args": ["mcp"]
    }
  }
}
```

### Terminal

Um binário para macOS, Linux e Windows, conferido contra o SHA256SUMS.

```sh
standwise login
standwise draft
standwise submit
```

## FAQ

### É grátis?

Sim, durante o beta público.

### O Standwise lê o nosso código?

Não. O GitHub App lê pull requests, reviews, checks, metadados de commits, o standwise.yml e o CODEOWNERS. Ele nunca lê arquivos de código.

### Do que eu preciso?

Uma organização ou conta pessoal no GitHub e um workspace no Slack. O Linear é opcional. Google Chat e Jira estão em desenvolvimento.

### O meu gestor vê os impedimentos sugeridos para mim?

Não. As sugestões aparecem só para você, no seu rascunho. Elas nunca chegam ao consolidado, à API, aos webhooks nem aos gestores.

### Dá para hospedar por conta própria?

Sim. O Standwise tem licença MIT. A [seção de self-hosting do README](https://github.com/ImFelipeOliveira/standwise#self-hosting) cobre a API, o worker e o Postgres.

## Beta público

Teste com o seu time. Procuramos times de 3 a 15 pessoas que usam GitHub e Slack. Ajudamos você a configurar. Peça acesso pelo formulário em [standwise.usefachada.dev/pt-BR/#beta](https://standwise.usefachada.dev/pt-BR/#beta).

Suporte: support.standwise@usefachada.dev
