## MCP server

`standwise mcp` starts a local [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. AI clients such as Claude Desktop, Cursor, Codex and VS Code use it to write your daily with you and, if you manage a team, to read your team's dailies, digests and blockers.

The server uses the credentials saved by `standwise login`. Run it once before connecting a client. Without a login, every tool answers with an error that tells you to run `standwise login`. The stored session only talks to the API it was created for: `https` only, `http` only on localhost, and no redirects.

### Configure your client

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```json
{"mcpServers":{"standwise":{"command":"standwise","args":["mcp"]}}}
```

VS Code (`.vscode/mcp.json`):

```json
{"servers":{"standwise":{"type":"stdio","command":"standwise","args":["mcp"]}}}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.standwise]
command = "standwise"
args = ["mcp"]
```

Any other client: `{"command": "standwise", "args": ["mcp"]}`.

### The confirmation rule

Standwise never sends a daily on your behalf without your explicit confirmation. `standwise_submit_daily` requires `confirmed: true`. The tool description tells the agent to show you the final daily and ask you first. Any other value is refused with the `confirmation_required` error, and nothing is sent.

The agent talks to you in your language. It never translates or rewrites the text of your daily: each item goes exactly as you said it or approved it.

### Tools

Every tool that takes `org` accepts it as optional. When you belong to a single organization, that one is used. When you belong to more than one, the tool answers with `ambiguous_org` and lists them.

| Tool | Input | Returns |
| --- | --- | --- |
| `standwise_whoami` | none | `{ login, orgs }` |
| `standwise_get_draft` | `org?` | The draft of yesterday's work, built from your GitHub activity |
| `standwise_submit_daily` | `org?`, `yesterday`, `today`, `blockers`, `confirmed: true` | `{ date, teams, late }` |
| `standwise_list_teams` | `org?` | The teams you can read |
| `standwise_get_digest` | `org?`, `team`, `date` | `{ digest }`: the team digest on that date, or `null` |
| `standwise_list_dailies` | `org?`, `team`, `from`, `to`, `cursor?` | A page of the team's confirmed dailies |
| `standwise_list_blockers` | `org?`, `team`, `from?`, `to?`, `cursor?` | A page of the team's confirmed blockers |

Every tool declares an input schema and an output schema, and returns its result as `structuredContent`. Dates are `YYYY-MM-DD`.

### Manager tools

The last four tools are for the managers listed under `managers` of a team in `standwise.yml`, and for organization admins, who can read every team. Anyone else gets `forbidden`. Unknown teams get the same answer, so team names don't leak.

- History covers the last 90 days, today included, in the team's time zone. A `from` or `to` outside that window gets `invalid_request`.
- They return only what people confirmed: no suggestions and no per-person aggregates.
- The data is there to unblock the team: blockers, context and summaries of what the team is doing. Standwise does not offer or encourage comparing, ranking or evaluating individual people.

### Prompt

Clients that support MCP prompts get a `daily` prompt (optional argument `org`). It runs the same flow as the Claude Code skill: get the draft, ask what you will do today and what blocks you, show the final daily, ask for explicit confirmation, then submit.

### Errors

Errors come back as tool results with `isError: true`. The text starts with a stable code, followed by an English message:

| Code | Meaning |
| --- | --- |
| `not_logged_in` | No saved login, or the login belongs to another API. Run `standwise login`. |
| `ambiguous_org` | More than one organization. Pass `org`. |
| `confirmation_required` | `confirmed` was not `true`. Nothing was sent. |
| `network_error` | The API could not be reached. |
| Any API code | For example `forbidden`, `invalid_request` or `org_not_found`. See the errors guide. |
