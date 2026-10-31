# CLI

```text
standwise <comando> [opções]
```

Os comandos imprimem o resultado em JSON na saída padrão e as mensagens na saída de erro, para scripts e agentes conseguirem ler. Para instalar a CLI, veja [Primeiros passos](/pt-BR/members/getting-started#_1-instale-a-cli).

## Comandos

### `standwise login`

Entra com o GitHub pelo device flow. A CLI mostra uma URL e um código, abre o navegador quando consegue e espera você autorizar. Depois, guarda a sua sessão e as organizações onde o Standwise está instalado e você é membro.

```bash
standwise login
```

Entrar também liga o seu usuário do Slack para as menções no consolidado. Rode de novo quando entrar numa organização nova, quando o app for instalado em outra organização, ou quando o admin conectar o Slack ou mudar o seu mapeamento de identidade.

### `standwise logout`

Revoga a sessão no servidor e apaga o arquivo local de credenciais. Ele mostra "Credenciais removidas." mesmo se você não tinha entrado.

### `standwise whoami`

Mostra o seu login e as suas organizações a partir das credenciais guardadas, sem chamar a API.

```json
{"login":"alice","orgs":[{"installationId":12345678,"login":"acme"}]}
```

### `standwise draft`

Mostra o rascunho da sua daily na organização:

```json
{
  "org": "acme",
  "date": "2026-10-28",
  "since": "2026-10-27T03:00:00.000Z",
  "teams": ["backend"],
  "activity": [
    {
      "kind": "pr_merged",
      "title": "Add rate limiting",
      "url": "https://github.com/acme/api/pull/42",
      "repo": "acme/api",
      "at": "2026-10-27T18:20:00.000Z"
    },
    {
      "kind": "commits",
      "title": "Fix retry backoff",
      "url": "https://github.com/acme/worker/commit/9f2c1e0",
      "repo": "acme/worker",
      "at": "2026-10-27T15:02:00.000Z",
      "count": 3
    }
  ],
  "suggestions": [
    {
      "id": "6f1c2b8e-3a4d-4c55-9d0e-1a2b3c4d5e6f",
      "kind": "pr_no_review",
      "ref": { "kind": "pull_request", "url": "https://github.com/acme/api/pull/57", "title": "Retry webhooks" },
      "since": "2026-10-26T14:00:00.000Z"
    }
  ]
}
```

- `date`: a data a que esta daily vai pertencer.
- `since`: o início da janela de atividade.
- `teams`: os seus times nesta organização.
- `activity`: até 50 itens, do mais recente para o mais antigo. `kind` é `pr_opened`, `pr_merged`, `review`, `commits`, `card_started` ou `card_done`. Os commits vêm agrupados por repositório, com `count`. Nos cards, `repo` é a chave do time no Linear e `url` é o link do card, que você pode usar como link de um impedimento.
- `suggestions`: possíveis impedimentos que o Standwise percebeu por você, cada um `{ id, kind, ref, since }`. `kind` é `pr_no_review` (pull request seu sem revisão) `ci_failing` (checks falhando nele há 24 horas) ou `card_stale` (um card seu no Linear em andamento há `card_stale_days`). Só você vê. Veja [`standwise suggestion`](#standwise-suggestion).

### `standwise submit`

Envia a sua daily. Lê o JSON do `--file`, ou da entrada padrão quando não há `--file`.

```bash
standwise submit --file daily.json
```

```json
{
  "org": "acme",
  "yesterday": [
    {
      "text": "Entreguei o rate limiting",
      "ref": { "kind": "pull_request", "url": "https://github.com/acme/api/pull/42", "title": "Add rate limiting" }
    }
  ],
  "today": [{ "text": "Escrever os guias para integradores" }],
  "blockers": [{ "text": "Esperando o banco de staging" }]
}
```

| Campo | Regras |
| --- | --- |
| `org` | Opcional no arquivo. Quando falta, vale o `--org`, ou a sua única organização. |
| `yesterday` | Até 30 itens. Pode ficar vazio. |
| `today` | De 1 a 30 itens. |
| `blockers` | Até 10 itens. Pode ficar vazio. |
| `text` | De 1 a 500 caracteres, numa linha. |
| `ref` | Opcional. `kind` é `pull_request`, `issue`, `commit` ou `card`; `url` usa `http` ou `https`; `title` tem até 200 caracteres. |

Textos, URLs e títulos não podem ter caracteres de controle (incluindo quebras de linha e tabs), controles bidirecionais nem separadores de linha.

O resultado:

```json
{"date":"2026-10-28","teams":["backend"],"late":false}
```

`late: true` quer dizer que o consolidado já tinha sido publicado, então a sua daily foi como resposta na thread dele.

O `standwise submit` envia o que você passar. Quando um agente o chama por você, o agente tem que mostrar a daily e pedir a sua confirmação antes. A [skill do Claude Code](/pt-BR/members/claude-code) e o [servidor MCP](/pt-BR/members/mcp) garantem isso.

### `standwise suggestion`

Responde a um impedimento sugerido do rascunho:

```bash
standwise suggestion confirm <id>
standwise suggestion ignore <id>
```

- `confirm` marca como um impedimento de verdade. Adicione aos `blockers` da sua daily, com o `ref` dele; enviar a daily também confirma.
- `ignore` esconde a sugestão. Ela só volta se o sinal mudar: um novo commit head que ainda falha, ou o pull request voltar a ficar sem revisão.
- Use `--org <login>` quando você está em mais de uma organização.
- Um id desconhecido, ou que não é seu, dá `error not_found`. A decisão oposta à já tomada dá `error suggestion_already_decided`. Repetir a mesma decisão funciona.

### `standwise mcp`

Inicia o servidor MCP local pela entrada e saída padrão, para clientes de IA. Veja [Servidor MCP](/pt-BR/members/mcp).

## Opções

| Opção | Descrição |
| --- | --- |
| `--org <login>` | A organização, quando você está em mais de uma. |
| `--file <caminho>` | O arquivo JSON da daily para o `submit`. |
| `--api-url <url>` | A API do Standwise. O padrão é `STANDWISE_API_URL` e, depois, `https://api.standwise.dev`. |
| `--help` | Mostra o uso. |
| `--version` | Mostra a versão. |

## Ambiente

| Variável | Descrição |
| --- | --- |
| `STANDWISE_API_URL` | A API do Standwise, quando não há `--api-url`. |
| `STANDWISE_LANG` | Idioma das mensagens da CLI, `en` ou `pt-BR`. Se não houver, usa `LC_ALL`, depois `LANG` e, por fim, inglês. |
| `XDG_CONFIG_HOME` | Onde fica o arquivo de credenciais. O padrão é `~/.config`. |

A URL da API tem que usar `https`. `http` só é aceito para `localhost`, `127.0.0.1` e `[::1]`. Uma sessão guardada só funciona com a API em que foi criada: usá-la com outra URL falha com o código de saída 2 e pede para você entrar de novo com `--api-url`.

## Códigos de saída

| Código | Significado |
| --- | --- |
| `0` | Sucesso. |
| `1` | Erro: falha de rede, erro da API, arquivo ilegível, argumentos inválidos ou comando desconhecido. A mensagem diz qual. |
| `2` | Você não entrou, a sessão expirou ou foi revogada, ou a sessão guardada é de outra API. Rode `standwise login`. |
| `3` | Mais de uma organização sem `--org`, ou nenhuma organização com o Standwise instalado. |
| `4` | O JSON da daily é inválido ou falhou na validação. A mensagem lista cada problema. |

Os erros da API aparecem como `error <código>: <mensagem>`, mais o tempo de espera quando você atinge o limite de taxa.

## Credenciais

O `standwise login` guarda a sua sessão em `~/.config/standwise/credentials.json`, ou em `$XDG_CONFIG_HOME/standwise/credentials.json` quando essa variável existe. A pasta é criada com modo `700` e o arquivo com modo `600`, legível só por você. O arquivo guarda a URL da API, o token da sessão (`sw_...`), o seu login e as suas organizações.

A sessão expira depois de 90 dias sem uso. O `standwise logout` revoga a sessão e apaga o arquivo.
