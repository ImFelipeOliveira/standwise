# Standwise

::: warning Public beta
Standwise is in public beta. Expect rough edges and changes to behaviour, configuration and the API before 1.0. Report problems in [GitHub issues](https://github.com/ImFelipeOliveira/standwise/issues) or by email (see [Privacy](/privacy)).
:::

Standwise runs your team's daily standup. Each person writes their daily with their AI agent, starting from a draft of what they did on GitHub. Standwise collects the dailies and posts one digest per team to Slack at the time you choose.

## What it is

Standwise is two things that work together:

- **A GitHub App** that your organization admin installs. It reads the team setup from a `standwise.yml` file, receives the dailies and posts the team digest to Slack.
- **A skill, a CLI and an MCP server** that each person uses with their AI agent (Claude Code, Cursor, Codex, Claude Desktop, VS Code). The agent fetches a draft of yesterday's work, the person fixes it, writes today's plan and blockers, and confirms before anything is sent.

It solves three problems that show up once a team writes dailies with AI:

- **Loose dailies.** Every message comes in a different format, in a different place.
- **No consolidated view.** The manager reads scattered messages and has no single picture of the team.
- **Nobody orchestrates.** No one tracks who sent the daily, and blockers sit until someone notices.

## Who it is for

- **Members** write their own daily through their AI agent. Start with [Getting started](/members/getting-started).
- **Managers** get the team digest in Slack and can read their team's dailies, digests and blockers from their own AI agent. Start with [MCP server](/members/mcp).
- **Admins** install the GitHub App, connect Slack and write `standwise.yml`. Start with [Install](/admin/install).
- **Integrators** read organization data with an API key and receive webhooks. Start with the [API overview](/api/overview).

## How it works

```text
  Member's AI agent                    Standwise                         Slack
 ┌──────────────────────┐   draft   ┌────────────────────────┐      ┌───────────────────┐
 │ /daily skill         │ ◀──────── │ API                    │      │ #daily-backend    │
 │ standwise CLI        │           │  · reads GitHub        │      │                   │
 │ standwise mcp        │ ────────▶ │  · stores the daily    │ ───▶ │ one digest per    │
 │ (person confirms)    │  submit   │ Worker                 │      │ team per day,     │
 └──────────────────────┘           │  · digest at digest_at │      │ late dailies in   │
                                    │  · late daily → thread │      │ the thread        │
                                    └────────────────────────┘      └───────────────────┘
                                                 │
                                                 └──▶ API keys and webhooks for your systems
```

1. The person runs `/daily` in Claude Code, or asks any MCP client for their daily.
2. Standwise builds a draft of "yesterday" from the person's GitHub activity since their last daily: pull requests opened and merged, reviews and commits.
3. The person edits yesterday, writes today and any blockers, and confirms. Nothing is sent before that.
4. At `digest_at`, in the team's time zone, Standwise posts one message to the team channel: blockers on top, then each person's daily, then who did not send it.
5. A daily sent after the digest goes as a reply in the digest thread.

Around it, Standwise orchestrates the day:

- at `remind_at`, people who have not sent the daily get one direct message;
- each new blocker goes by direct message to whoever can help: the pull request's reviewers, its CODEOWNERS, or the team managers;
- suggested blockers, such as a pull request waiting for review or with failing CI, appear only to you, in your own draft;
- every change to `standwise.yml` is validated by a GitHub check run.

Linear cards show up in the draft and in blocker routing. Coming soon: Google Chat and Jira.

Read [How it works](/how-it-works) for the full cycle of a day.

## What Standwise does not do

- **It is not a surveillance tool.** The person always has the final word on their own daily. Nothing is sent on someone's behalf without their explicit confirmation.
- **It does not measure productivity.** There are no rankings, scores, commit counts per person or per-person aggregates, in the digest, the API or the MCP tools.
- **It does not write the daily for you.** The draft is a starting point. Today's plan and the blockers are written by the person.
- **It does not read your code or your Slack messages.** See [Privacy](/privacy).
- **It does not send your data to an AI model.** No LLM processes your data on the Standwise servers. Your own agent runs on your machine, with your own account.

## Start here

| You are | Read |
| --- | --- |
| An admin setting up your organization | [Install](/admin/install), then the [standwise.yml reference](/admin/configuration) |
| A member writing your first daily | [Getting started](/members/getting-started) |
| A Claude Code user | [Claude Code skill](/members/claude-code) |
| A Cursor, Codex, Claude Desktop or VS Code user | [MCP server](/members/mcp) |
| A manager | [MCP server](/members/mcp#manager-tools) and [How it works](/how-it-works) |
| An integrator | [API overview](/api/overview) and [Webhooks](/api/webhooks) |

New to the terms? See [Concepts](/concepts).
