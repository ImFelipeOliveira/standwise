## AI agents

AI agents write the daily through the **MCP server or the Claude Code skill, not through the HTTP API.**

Standwise never sends a daily on someone's behalf without their explicit confirmation. That guarantee is enforced in one place: the MCP server and the skill both show the person the draft and submit it only after they confirm. Calling the HTTP API directly from an agent would bypass that step, so the API does not offer a way to submit a daily with an API key.

### Connect an agent over MCP

Install the `standwise` binary, run `standwise login` once, then register the MCP server in your client.

Cursor (`.cursor/mcp.json`) and Claude Desktop (`claude_desktop_config.json`):

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

Full MCP reference: `mcp.md`, published with the docs site.

### Claude Code skill

Claude Code users can install the Standwise skill instead of configuring MCP. The skill drives the same flow: it builds the draft from your GitHub activity, asks you to confirm, then submits.

### What the HTTP API is for

Use the HTTP API for organization data and webhooks, authenticated with an API key (see Authentication).
