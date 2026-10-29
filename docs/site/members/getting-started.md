# Getting started

Send your first daily in a few minutes. Before you start, your admin must have [installed Standwise](/admin/install) and listed you in a team in `standwise.yml`.

## 1. Install the CLI

The `standwise` CLI is a single binary. It also runs the MCP server and is what the Claude Code skill calls.

Download the binary for your system from the [latest release](https://github.com/ImFelipeOliveira/standwise/releases/latest):

| System | File |
| --- | --- |
| macOS, Apple silicon | `standwise-bun-darwin-arm64` |
| macOS, Intel | `standwise-bun-darwin-x64` |
| Linux, x64 | `standwise-bun-linux-x64` |
| Linux, ARM64 | `standwise-bun-linux-arm64` |
| Windows, x64 | `standwise-bun-windows-x64.exe` |

On macOS or Linux, put it on your `PATH` as `standwise`. For example, on a Mac with Apple silicon:

```bash
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/standwise \
  https://github.com/ImFelipeOliveira/standwise/releases/latest/download/standwise-bun-darwin-arm64
chmod +x ~/.local/bin/standwise
standwise --version
```

Each release also has a `SHA256SUMS` file to check the download. A one-line install script is coming soon.

## 2. Sign in

```bash
standwise login
```

The CLI shows a code and opens GitHub in your browser. Enter the code and authorize Standwise. The CLI then prints "Signed in as" and your login.

Signing in also links you to your Slack user, so that the digest can mention you. If your admin connects Slack or changes `standwise.yml` after you sign in, run `standwise login` again.

Check who you are and which organizations you can write dailies for:

```bash
standwise whoami
```

```json
{"login":"alice","orgs":[{"installationId":12345678,"login":"acme"}]}
```

## 3. Write your daily

Pick the way that fits your tools:

- **Claude Code:** install the plugin and run `/daily`. See [Claude Code skill](/members/claude-code).
- **Cursor, Codex, Claude Desktop, VS Code or another MCP client:** add `standwise mcp` to your client and ask for your daily. See [MCP server](/members/mcp).
- **Only the terminal:** use `standwise draft` and `standwise submit`. See [CLI](/members/cli).

In every case, the flow is the same:

1. Standwise builds a draft of yesterday from your GitHub activity since your last daily.
2. You fix yesterday, then write today and any blockers.
3. You see the final daily and confirm it. Nothing is sent before that.

## 4. After you send it

- Your daily is stored for today's standup date. If you send again the same day, the new version replaces the old one.
- At the team's `digest_at`, your daily appears in the digest of every team you are in.
- If the digest already went out, your daily is posted as a reply in the digest thread, and the result says `late: true`.
- Webhooks registered by your admin receive a `daily.submitted` event, and a `blocker.opened` event for each new blocker.

Something went wrong? See [Troubleshooting](/troubleshooting).
