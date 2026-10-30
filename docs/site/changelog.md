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
- `standwise` CLI: `login`, `logout`, `whoami`, `draft` and `submit`.
- Team digest in Slack at `digest_at`, with late dailies in the thread.
- Setup page: configuration state, Slack connection, failed deliveries, API keys and webhooks.
- English is the default language when none is set.

## API

<!--@include: ../api/CHANGELOG.md{3,}-->
