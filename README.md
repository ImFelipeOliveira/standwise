# Standwise

Standwise runs your team's daily standup. Each person writes their daily with their AI agent (Claude Code, Cursor, Codex, Claude Desktop, VS Code), starting from a draft of their GitHub activity, and confirms it before anything is sent. Standwise collects the dailies and posts one digest per team to Slack at the time set in `standwise.yml`.

It is not a surveillance tool: there are no productivity metrics or rankings, and nothing is sent on someone's behalf without their confirmation.

## Documentation

The documentation site is served at `/docs/` by the Standwise API, in English and Portuguese (`/docs/pt-BR/`). It covers the product overview, installation, the `standwise.yml` reference, the CLI, the Claude Code skill, the MCP server, the API and webhooks. The interactive API reference is at `/docs/api`.

The sources live in [`docs/site`](docs/site). To work on them:

```sh
SUPPORT_EMAIL=you@example.com bun run docs:dev
SUPPORT_EMAIL=you@example.com bun run docs:build
bun run check-docs
```

`SUPPORT_EMAIL` is required: the build fails without it.

## Install

### Admin

You need to own the GitHub organization (or personal account).

1. Install the Standwise GitHub App on your organization.
2. Open the setup page that GitHub sends you to, sign in, and click **Connect Slack**.
3. Create `standwise.yml` at the root of your `.github` repository, from the template on the setup page.

Step by step: [Install](docs/site/admin/install.md).

### Members

Install the CLI (macOS and Linux):

```sh
curl -fsSL https://api.standwise.dev/install.sh | sh
standwise login
```

The script downloads the binary of the latest release for your system, checks it against `SHA256SUMS` and installs it to `~/.local/bin/standwise`. Windows binaries are on the [releases page](https://github.com/ImFelipeOliveira/standwise/releases/latest).

Then pick how you use it:

- **Claude Code.** The plugin bundles the `/daily` skill and the MCP server:

  ```text
  /plugin marketplace add ImFelipeOliveira/standwise
  /plugin install standwise@standwise
  ```

- **Other clients** (Cursor, Codex, Claude Desktop, VS Code). Add the MCP server, which is the CLI running `standwise mcp`: [MCP](docs/site/members/mcp.md).
- **Terminal.** `standwise draft` and `standwise submit`: [CLI](docs/site/members/cli.md).

## standwise.yml

All configuration lives in `standwise.yml` at the root of the `.github` repository, on the default branch.

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
```

The full reference is in [docs/site/admin/configuration.md](docs/site/admin/configuration.md) and on the documentation site at `/docs/admin/configuration`.

## Privacy

- It reads `standwise.yml`, team and organization membership, and the titles, links and dates of your own pull requests, reviews and commits to build your draft. It does not read your code.
- Nothing is sent without your explicit confirmation.
- There are no rankings, scores or productivity metrics.
- No AI model processes your data on the Standwise servers.
- Tokens and signing secrets are encrypted at rest with AES-256-GCM.

Details: [docs/site/privacy.md](docs/site/privacy.md).

## Self-hosting

Standwise ships as one Docker image that contains both the api and the worker. `APP` (`api` or `worker`) only selects the default command; each Railway service sets its own start command in `railway.json`. The image also builds the documentation site, so `SUPPORT_EMAIL` is required at build time:

```sh
docker build --build-arg APP=api --build-arg SUPPORT_EMAIL=you@example.com -t standwise-api .
docker build --build-arg APP=worker --build-arg SUPPORT_EMAIL=you@example.com -t standwise-worker .
```

The api runs the migrations when it starts, so run a single api replica. Both services need Postgres. Every variable is listed in [`.env.example`](.env.example). The full Railway setup is in [docs/deploy.md](docs/deploy.md). Register the apps with [docs/github-app.md](docs/github-app.md) (or [the manifest](docs/github-app-manifest.json)) and [docs/slack-app-manifest.yml](docs/slack-app-manifest.yml).

## Support

Questions and problems: support@standwise.dev.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
