# Primeiros passos

Envie a sua primeira daily em poucos minutos. Antes de começar, o admin precisa ter [instalado o Standwise](/pt-BR/admin/install) e colocado você num time do `standwise.yml`.

## 1. Instale a CLI

A CLI `standwise` é um binário único. Ela também roda o servidor MCP e é o que a skill do Claude Code chama.

Baixe o binário do seu sistema na [última release](https://github.com/ImFelipeOliveira/standwise/releases/latest):

| Sistema | Arquivo |
| --- | --- |
| macOS, Apple silicon | `standwise-bun-darwin-arm64` |
| macOS, Intel | `standwise-bun-darwin-x64` |
| Linux, x64 | `standwise-bun-linux-x64` |
| Linux, ARM64 | `standwise-bun-linux-arm64` |
| Windows, x64 | `standwise-bun-windows-x64.exe` |

No macOS ou no Linux, coloque o binário no `PATH` com o nome `standwise`. Por exemplo, num Mac com Apple silicon:

```bash
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/standwise \
  https://github.com/ImFelipeOliveira/standwise/releases/latest/download/standwise-bun-darwin-arm64
chmod +x ~/.local/bin/standwise
standwise --version
```

Cada release também traz um arquivo `SHA256SUMS` para conferir o download. Ou use o script de instalação, que baixa o binário certo, confere com o `SHA256SUMS` e instala em `~/.local/bin/standwise`:

```bash
curl -fsSL https://api.standwise.dev/install.sh | sh
```

## 2. Entre

```bash
standwise login
```

A CLI mostra um código e abre o GitHub no navegador. Digite o código e autorize o Standwise. A CLI então mostra "Autenticado como" e o seu login.

Entrar também liga você ao seu usuário do Slack, para o consolidado poder mencionar você. Se o admin conectar o Slack ou mudar o `standwise.yml` depois que você entrou, rode `standwise login` de novo.

Confira quem você é e para quais organizações pode escrever dailies:

```bash
standwise whoami
```

```json
{"login":"alice","orgs":[{"installationId":12345678,"login":"acme"}]}
```

## 3. Escreva a daily

Escolha o jeito que combina com as suas ferramentas:

- **Claude Code:** instale o plugin e rode `/daily`. Veja [Skill do Claude Code](/pt-BR/members/claude-code).
- **Cursor, Codex, Claude Desktop, VS Code ou outro cliente MCP:** adicione o `standwise mcp` ao cliente e peça a sua daily. Veja [Servidor MCP](/pt-BR/members/mcp).
- **Só o terminal:** use `standwise draft` e `standwise submit`. Veja [CLI](/pt-BR/members/cli).

Em todos os casos, o fluxo é o mesmo:

1. O Standwise monta um rascunho do ontem a partir da sua atividade no GitHub desde a última daily, mais os seus cards do Linear se a sua organização conectou o Linear.
2. Você corrige o ontem e escreve o hoje e os impedimentos.
3. Você vê a daily final e confirma. Nada é enviado antes disso.

## 4. Depois de enviar

- A sua daily fica guardada na data de hoje. Se você reenviar no mesmo dia, a nova versão substitui a anterior.
- No `digest_at` do time, a sua daily aparece no consolidado de todos os seus times.
- Se o consolidado já saiu, a sua daily é publicada como resposta na thread dele, e o resultado traz `late: true`.
- Os webhooks cadastrados pelo admin recebem um evento `daily.submitted`, e um `blocker.opened` para cada impedimento novo.

Deu algo errado? Veja [Solução de problemas](/pt-BR/troubleshooting).
