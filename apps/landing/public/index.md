# Standcast: your daily standup, written in your AI agent

> Open source (MIT), free during the public beta. Works with GitHub and Slack today. Google Chat and Jira are next.

Run `/daily` in Claude Code, Cursor or the terminal. Standcast drafts yesterday from your GitHub and Linear activity, you confirm, and your team gets one digest in Slack.

```sh
curl -fsSL https://api-standcast.usefachada.dev/install.sh | sh
```

- [Join the beta](https://standcast.usefachada.dev/#beta)
- [Install for your org](https://docs-standcast.usefachada.dev/admin/install)
- [Documentation](https://docs-standcast.usefachada.dev/)
- [GitHub](https://github.com/ImFelipeOliveira/standcast)
- [Versão em português](https://standcast.usefachada.dev/pt-BR/index.md)

Write your daily where you already work: Claude Code, Cursor, Codex, Claude Desktop, VS Code and the terminal.

## A day with Standcast

Set two times in standcast.yml. Standcast runs the rest. This team has `remind_at: "09:30"` and `digest_at: "10:00"` in São Paulo time, Monday to Friday.

- **08:50, draft.** Ana runs /daily. She edits the draft, adds a blocker that links a pull request and confirms. The reviewer gets a direct message.
- **09:30, remind_at.** Davi hasn't written yet, so he gets one reminder. Never more than one a day.
- **10:00, digest_at.** One digest per team in #daily-backend: blockers first, then updates, then who hasn't sent.
- **10:40, late.** Davi sends late. His daily goes in the digest thread, so nobody misses it.

## What it does

Collects, consolidates and delivers. You only write.

- **A draft from real work.** Pull requests opened, merged and reviewed, commits by repository, and Linear cards that started or finished. Monday covers the weekend.
- **Blockers reach who can help.** A blocker that links a pull request goes to its reviewers, then CODEOWNERS, then the team managers. A Linear card goes to the owner of the blocking card.
- **Nothing sent without you.** The MCP submit tool needs `confirmed: true`, which the agent passes only after you approve the text.
- **Several teams, one daily.** Write once and appear in every team digest you belong to, each in its own time zone and workdays.
- **Managers read from their agent.** Team digests, dailies and blockers for the last 90 days, through MCP read tools. Confirmed content only.
- **API and webhooks.** Read-only API keys with scopes, an OpenAPI reference, and signed `daily.submitted` and `blocker.opened` webhooks.

## Privacy

Built for teams, not for watching people. Standcast suggests blockers from your own signals. Those suggestions belong to you. A test in CI checks that they never leave your draft.

Your team sees:

- Dailies you confirmed, in the team digest
- Blockers you confirmed, routed to who can help
- Who hasn't sent today's daily

Only you see:

- A pull request waiting days for review
- CI failing on your branch for a day
- A Linear card stuck in progress

No productivity metrics. No rankings. No commit counts. Nothing sent on anyone's behalf.

## Configuration as code

One file in your .github repository. Teams, times, Slack channels and managers live in `standcast.yml`. Every change is reviewed like code.

- **Checked on every push.** A `Standcast config` check run points to the line with the error.
- **Never breaks the team.** An invalid push keeps the last valid config in effect.
- **Teams from GitHub.** Members can be logins or `@org/team`.

```yaml
# .github/standcast.yml
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

See the [standcast.yml reference](https://docs-standcast.usefachada.dev/admin/configuration).

## Three ways to write

### Claude Code plugin

The `/daily` skill drafts, asks for today and blockers, and confirms with you.

```text
/plugin marketplace add \
  ImFelipeOliveira/standcast
/plugin install standcast@standcast
/daily
```

### Any MCP client

Cursor, Codex, Claude Desktop and VS Code run the local [MCP server](https://docs-standcast.usefachada.dev/members/mcp).

```json
{
  "mcpServers": {
    "standcast": {
      "command": "standcast",
      "args": ["mcp"]
    }
  }
}
```

### Terminal

One binary for macOS, Linux and Windows, checked against SHA256SUMS.

```sh
standcast login
standcast draft
standcast submit
```

## FAQ

### Is it free?

Yes, during the public beta.

### Does Standcast read our code?

No. The GitHub App reads pull requests, reviews, checks, commit metadata, standcast.yml and CODEOWNERS. It never reads source files.

### What do I need?

A GitHub organization or personal account and a Slack workspace. Linear is optional. Google Chat and Jira are in development.

### Can my manager see my suggested blockers?

No. Suggestions are visible only to you, in your own draft. They never reach the digest, the API, webhooks or managers.

### Can we self-host?

Yes. Standcast is MIT licensed. The [self-hosting section of the README](https://github.com/ImFelipeOliveira/standcast#self-hosting) covers the API, the worker and Postgres.

## Public beta

Try it with your team. We're looking for teams of 3 to 15 people on GitHub and Slack. We'll help you set it up. Request access with the form at [standcast.usefachada.dev/#beta](https://standcast.usefachada.dev/#beta).

Support: support.standcast@usefachada.dev
