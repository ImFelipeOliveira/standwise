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

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
