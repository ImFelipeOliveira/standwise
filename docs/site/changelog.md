---
outline: [2, 3]
---

# Changelog

What changed in Standwise. The API section follows the [versioning policy](/api/overview#versioning): breaking changes are announced at least 90 days in advance.

## Product

### Unreleased

- Documentation site in English and Portuguese, with the product overview, guides for admins and members, the `standwise.yml` reference and the API guides.
- Claude Code plugin with the `/daily` skill and the bundled MCP server.
- `standwise mcp`: local MCP server with draft and confirmed submit tools, plus read tools for managers and admins.
- `standwise` CLI: `login`, `logout`, `whoami`, `draft`, `submit` and `suggestion`.
- Team digest in Slack at `digest_at`, with late dailies in the thread.
- Setup page: configuration state, Slack connection, failed deliveries, API keys and webhooks.
- Reminders by direct message at `remind_at`, once per person per day.
- Blocker routing by direct message: reviewers, then CODEOWNERS, then managers.
- Suggested blockers for pull requests without review and failing CI, visible only to the person, with `signals.direct_message` to also get them by direct message.
- `Standwise config` check run on changes to `standwise.yml`.
- Retention: webhook delivery logs after 30 days, resolved suggestions after 90 days, expired sessions removed.
- English is the default language when none is set.

## API

<!--@include: ../api/CHANGELOG.md{3,}-->
