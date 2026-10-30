---
title: API overview
outline: [2, 3]
---

# API overview

The Standwise API lets your systems read your organization's data and receive events. It is versioned under `/v1` and described by an OpenAPI 3.1 document.

- Base URL: `https://api.standwise.dev`
- OpenAPI document: `https://api.standwise.dev/openapi.json`
- Interactive reference, with every operation, parameter, example and error: <a href="/docs/api" target="_self">API reference</a>

## What the API offers

- **Read organization data** with an [API key](/admin/api-keys):

  | Operation | Scope | Returns |
  | --- | --- | --- |
  | `GET /v1/org/teams` | `teams:read` | The teams in `standwise.yml`: name, time zone, workdays, times and members |
  | `GET /v1/org/dailies` | `dailies:read` | Confirmed dailies, filtered by `date` and `team` |
  | `GET /v1/org/dailies/{id}` | `dailies:read` | One daily |
  | `GET /v1/org/digests` | `digests:read` | Digest deliveries, with who did not send the daily, filtered by `team`, `from` and `to` |
  | `GET /v1/org/blockers` | `blockers:read` | Confirmed blockers, filtered by `date` and `team` |
  | `GET /health` | none | Service health |

- **Receive events** with [webhooks](/api/webhooks): `daily.submitted`, `blocker.opened` and `digest.sent`.

The API returns only what people confirmed and what already appears in the digest. It never returns drafts, suggestions, per-person metrics, rankings or aggregates.

## What the API does not offer

**You cannot send a daily through the public API.** AI agents send dailies through the [MCP server](/members/mcp) or the [Claude Code skill](/members/claude-code), and scripts through the [CLI](/members/cli).

Why: Standwise never sends a daily on someone's behalf without their explicit confirmation. That rule lives in one place, the MCP server and the skill, which show the person the daily and send it only after they confirm. An API key belongs to the organization, not to a person, so it cannot carry that confirmation. The routes the CLI uses to send dailies are internal, authenticated with a person's session, and not part of the public contract.

## Quick start

```bash
curl -H "Authorization: Bearer $STANDWISE_API_KEY" \
  https://api.standwise.dev/v1/org/teams
```

```json
{
  "data": [
    {
      "name": "Alpha",
      "timezone": "America/Sao_Paulo",
      "workdays": ["mon", "tue", "wed", "thu", "fri"],
      "remindAt": "09:00",
      "digestAt": "10:00",
      "memberLogins": ["alice", "bob"]
    }
  ],
  "next_cursor": null
}
```

<!--@include: ../../api/guides/authentication.md-->

<!--@include: ../../api/guides/errors.md-->

<!--@include: ../../api/guides/pagination.md-->

<!--@include: ../../api/guides/rate-limits.md-->

<!--@include: ../../api/guides/versioning.md-->

See the [changelog](/changelog) for every release.
