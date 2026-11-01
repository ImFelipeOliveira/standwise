# API changelog

Versions match the GitHub releases. During the public beta (0.x), incompatible changes are listed here before they ship; from 1.0 they are announced at least 90 days in advance. See the versioning guide.

## Unreleased

## 0.3.0 — 2026-11-01

### Breaking: the rename to Standcast

- Base URL: `https://api-standcast.usefachada.dev`.
- API keys start with `sck_` and session tokens with `sc_`. Keys and sessions created before 0.3.0 stop working; create new keys on the setup page.
- Webhook headers are `Standcast-Signature`, `Standcast-Event` and `Standcast-Delivery`, with `User-Agent: Standcast-Webhooks/1`. Update your signature verification to read `Standcast-Signature`.
- The internal confirmation header is `X-Standcast-Confirmation`, and the MCP tools are named `standcast_*`.
- The configuration file is `standcast.yml`, and the check run is named "Standcast config".

### New

- `GET /llms.txt`: a plain-text index for AI agents, linking the OpenAPI document, the interactive reference and the documentation's `llms.txt`.
- `POST /beta` receives the landing page's beta form. It is not part of the public API and is not in the OpenAPI document.
- **Deploy requirement:** the api accepts `LANDING_URL` (https, no trailing slash, default `https://standcast.usefachada.dev`). The worker accepts `RESEND_API_KEY`, and needs `BETA_EMAIL_FROM` and `SUPPORT_EMAIL` when the key is set.

## 0.2.1 — 2026-10-31

- No API changes.

## 0.2.0 — 2026-10-31

First public beta.

### Agents, CLI and configuration

- The interactive API reference moved from `/docs/api` to `/reference`. `/docs/api` answers with a permanent redirect. The documentation site moved to its own domain (`DOCS_URL`); `/docs` and `/docs/*` on the api redirect there. Deploy requirement: the api accepts `DOCS_URL` (https, no trailing slash, default `https://docs.standwise.dev`).
- Linear integration. The draft `activity` can include `card_started` and `card_done` items for your own Linear cards (`repo` is the Linear team key, `url` the card link), and `suggestions` can have `kind: "card_stale"`. Both are additive: clients must ignore kinds they do not know. Blocker `ref` accepts a Linear card URL.
- `standwise.yml`: `tracker: { provider: linear, team: <KEY> }`, `members.<login>.linear` (an email) and `signals.card_stale_days` (default 5) now take effect.
- Deploy requirement: the api and the worker need `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` and fail to start without them.
- Setup page: **Connect Linear** and **Reconnect Linear** for admins. A failed connection returns `linear_oauth_failed` (HTTP 502).
- Default language is now English when none is specified.
- `standwise mcp`: local MCP server over stdio with the tools `standwise_whoami`, `standwise_get_draft` and `standwise_submit_daily` (confirmed by the person through elicitation, or `confirmed: true` as a fallback), plus the manager tools `standwise_list_teams`, `standwise_get_digest`, `standwise_list_dailies` and `standwise_list_blockers`. See the MCP guide.
- Suggested blockers: `standwise.yml` accepts `signals.direct_message` (default `false`). Suggestions are visible only to the person, in their draft, and never in the organization API, the manager tools, the webhooks or the setup page.
- `standwise suggestion confirm|ignore <id>` and the MCP tool `standwise_decide_suggestion`. The `suggestions` field of the draft is now a list of `{ id, kind, ref, since }`. A repeated decision is accepted; the opposite decision returns `suggestion_already_decided` (HTTP 409).
- `managers` entries must be GitHub logins; `@org/team` is rejected as a validation error.
- Internal session routes `GET /v1/manage/teams`, `/v1/manage/digests`, `/v1/manage/dailies` and `/v1/manage/blockers` back the manager tools. They are readable by team managers and organization admins, limited to the last 90 days, and listed only in `/openapi.internal.json`.
- Daily item text and link titles may no longer contain control characters (newlines and tabs included), bidirectional controls or line separators, and link titles are limited to 200 characters. Link URLs follow the same character rules and must use `http` or `https`. Invalid dailies get `invalid_daily`.
- `GET /health` also checks the database and returns `503` with `{ "ok": false }` when it does not answer.
- Internal: `org` is required on `GET /v1/draft` and `GET /v1/today`; the documentation said it was optional.
- Internal: the GitHub webhook receiver answers a signed body that is not JSON with `422 invalid_request` instead of `400`, and rejects bodies over 1 MB with `413 payload_too_large`.
- Internal: `GET /v1/today` returns the standup date for an organization, and `POST /v1/dailies` accepts an optional `X-Standwise-Confirmation: human|agent` header that is stored with the daily. Neither changes the public API.

### Webhooks

- Outbound webhooks: an organization admin registers HTTPS endpoints on the setup page and picks the events `daily.submitted`, `blocker.opened` and `digest.sent`. A `ping` test event can be sent from the setup page.
- Every delivery is a signed `POST` with the headers `Standwise-Signature` (`t=<unix seconds>,v1=<hex HMAC-SHA256>`), `Standwise-Event`, `Standwise-Delivery` and `User-Agent: Standwise-Webhooks/1`. Failed deliveries are retried up to 8 attempts; an endpoint with 20 failed deliveries in a row is disabled.
- The OpenAPI document has a `webhooks` section with the payload of each event. See the webhooks guide.

### Organization API

- API keys (`swk_`) created by an organization admin on the setup page, with the scopes `teams:read`, `dailies:read`, `digests:read` and `blockers:read`.
- Read-only organization operations: `GET /v1/org/teams`, `GET /v1/org/dailies`, `GET /v1/org/dailies/{id}`, `GET /v1/org/digests` and `GET /v1/org/blockers`, paginated by cursor.
- New error codes `insufficient_scope` (HTTP 403, with `required_scope`) and `not_found` (HTTP 404).

### Foundation

- OpenAPI 3.1 document at `/openapi.json` and interactive reference at `/reference`.
- `GET /health`.
- Rate limits with `RateLimit-*` and `Retry-After` headers; new error code `rate_limited` (HTTP 429).
