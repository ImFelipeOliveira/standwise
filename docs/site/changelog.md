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
- Linear integration: an admin connects one Linear workspace per installation on the setup page (OAuth app acting as itself, read-only scope `read`, encrypted tokens refreshed automatically). **Deploy requirement:** the api and the worker now need `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET`, and fail to start without them.
- `tracker: { provider: linear, team: <KEY> }` per team and `members.<login>.linear` (email); people are also linked by their GitHub email. `tracker.provider: jira` is accepted with a setup notice.
- Your own Linear cards (`card_started`, `card_done`) in the draft, and card blockers routed to the assignees of the blocking cards, then the card's assignee, its creator or the managers.
- Suggested blocker `card_stale` for cards in progress for `signals.card_stale_days` (default 5), visible only to the person.

## API

<!--@include: ../api/CHANGELOG.md{3,}-->
