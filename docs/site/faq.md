# FAQ

## Does my manager see my draft?

No. The draft is only for you. Your manager sees only what you confirmed and sent.

## Can Standwise send a daily for me?

No. Every daily needs your explicit confirmation. The skill and the MCP server ask you before sending, and the public API has no way to send a daily.

## Can I edit my daily after sending it?

Yes, send it again the same day. The new version replaces the old one. If the digest already went out, your first late daily is posted in the thread; later versions are stored and sent to webhooks, but not posted again.

## I sent my daily on Saturday. Where did it go?

It counts for the next workday of your first team, so it shows up in Monday's digest.

## I am in two teams. Do I write two dailies?

No. One daily per day per organization. It appears in the digest of every team you are in.

## I work for two organizations that use Standwise.

You write one daily for each. The CLI asks for `--org` and the MCP tools for `org` when you belong to more than one.

## Which agents can I use?

Claude Code through the [skill](/members/claude-code). Claude Desktop, Cursor, Codex, VS Code and any other MCP client through the [MCP server](/members/mcp). Without an agent, use the [CLI](/members/cli).

## Does Standwise use AI on my data?

No. No LLM processes your data on the Standwise servers. Your agent runs on your machine, with your own account. See [Privacy](/privacy).

## Does Standwise measure productivity?

No. There are no rankings, scores, commit counts per person or per-person aggregates anywhere.

## Does it work with Google Chat, Linear or Jira?

Not yet. They are coming soon. Today the digest goes to Slack and the draft comes from GitHub.

## Are there reminders for people who did not send the daily?

Coming soon. Today, the digest lists who did not send it.

## Can I configure Standwise without a `.github` repository?

No. The configuration lives only in `standwise.yml` at the root of the `.github` repository. A private `.github` repository works.

## Can I run Standwise on my own servers?

No. Standwise is a hosted service. The code is open source under the MIT license.

## How do I contact support?

Email <SupportEmail />.
