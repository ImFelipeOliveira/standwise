---
outline: [2, 3]
---

# Changelog

What changed in Standcast. Versions match the [GitHub releases](https://github.com/ImFelipeOliveira/standcast/releases). The API section follows the [versioning policy](/api/overview#versioning).

## Product

### Unreleased

- The setup page warns when a team's Slack channel is missing or the bot is not in it; digest links no longer unfold into previews and show a short label (repo#123, FEL-12); a pull request opened and merged in the same window appears once in the draft.

### 0.3.1 — 2026-11-01

- The documentation site publishes `robots.txt` and a `sitemap.xml`, and the landing page serves its own fonts.

### 0.3.0 — 2026-11-01

- Standwise is now **Standcast**: new name, CLI binary `standcast`, config file `standcast.yml`, `STANDCAST_*` environment variables, `Standcast-*` webhook headers, `sc_`/`sck_` token prefixes and new URLs (`api-standcast.usefachada.dev`, `docs-standcast.usefachada.dev`). Existing sessions and API keys stop working: sign in again and create new keys.
- Landing page at [standcast.usefachada.dev](https://standcast.usefachada.dev), in English and Portuguese, with a form to join the public beta. After sending it you land on the install guide.
- Documentation for AI agents: `llms.txt`, `llms-full.txt` and a Markdown copy of every page, in English and Portuguese. The api serves its own `llms.txt` with links to the OpenAPI document and the API guides.
- The privacy page explains what the beta form stores and for how long.
- CODEOWNERS files are parsed in linear time.

### 0.2.1 — 2026-10-31

- Release tooling only: versions match the GitHub releases everywhere. No product changes.

### 0.2.0 — 2026-10-31

First public beta.

- Hardening:
  - The setup page shows a notice when a GitHub team in `standwise.yml` cannot be found or is too large (only the first 5,000 members are used).
  - **Sign out** on the setup page ends the web session.
  - Pull request links are matched without regard to letter case, so a blocker is not routed twice for the same pull request.
  - Reviews, timeline events and check runs are read page by page from GitHub, so large pull requests are no longer cut short.
  - The health check is bounded and does not pile up queries when the database is slow.
  - The installer works with BusyBox shells.
  - A stale Slack identity is removed automatically when Slack answers `user_not_found` or `user_disabled`. The person signs in again to relink.

- Documentation site in English and Portuguese, with the product overview, guides for admins and members, the `standwise.yml` reference and the API guides.
- Claude Code plugin with the `/daily` skill and the bundled MCP server.
- `standwise mcp`: local MCP server with draft and confirmed submit tools, plus read tools for managers and admins.
- `standwise` CLI: `login`, `logout`, `whoami`, `draft`, `submit` and `suggestion`.
- Team digest in Slack at `digest_at`, with late dailies in the thread.
- Setup page: configuration state, Slack connection, failed deliveries, API keys and webhooks.
- Reminders by direct message at `remind_at`, once per person per day. `remind_at` must be before `digest_at`.
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
