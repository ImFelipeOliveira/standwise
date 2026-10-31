# API changelog

Breaking changes are announced here at least 90 days before they take effect. See the versioning guide.

## Unreleased

- Linear integration. The draft `activity` can include `card_started` and `card_done` items for your own Linear cards (`repo` is the Linear team key, `url` the card link), and `suggestions` can have `kind: "card_stale"`. Both are additive: clients must ignore kinds they do not know. Blocker `ref` accepts a Linear card URL.
- `standwise.yml`: `tracker: { provider: linear, team: <KEY> }`, `members.<login>.linear` (an email) and `signals.card_stale_days` (default 5) now take effect.
- Deploy requirement: the api and the worker need `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` and fail to start without them.
- Setup page: **Connect Linear** and **Reconnect Linear** for admins. A failed connection returns `linear_oauth_failed` (HTTP 502).
- Default language is now English when none is specified.
- `standwise mcp`: local MCP server over stdio with the tools `standwise_whoami`, `standwise_get_draft` and `standwise_submit_daily` (confirmed by the person through elicitation, or `confirmed: true` as a fallback), plus the manager tools `standwise_list_teams`, `standwise_get_digest`, `standwise_list_dailies` and `standwise_list_blockers`. See the MCP guide.
- Reminders: at `remind_at` on workdays, people who have not sent the daily get a Slack direct message, at most once per day and only before the team digest. `remind_at` must now be before `digest_at`, otherwise `standwise.yml` is invalid.
- Blocker routing: each new blocker in a submitted daily is sent once by direct message to the reviewers or CODEOWNERS of a linked pull request in the organization, or to the team managers. The `blocker.opened` webhook and the organization API are unchanged.
- Suggested blockers: `standwise.yml` accepts `signals.direct_message` (default `false`). Suggestions are visible only to the person, in their draft, and never in the organization API, the manager tools, the webhooks or the setup page.
- `standwise suggestion confirm|ignore <id>` and the MCP tool `standwise_decide_suggestion`. The `suggestions` field of the draft is now a list of `{ id, kind, ref, since }`. A repeated decision is accepted; the opposite decision returns `suggestion_already_decided` (HTTP 409).
- Standwise creates the check run `Standwise config` on pushes and pull requests that change `standwise.yml` in the `.github` repository. Any push to the default branch of `.github` reloads the configuration, force pushes included.
- `managers` entries must be GitHub logins; `@org/team` is rejected as a validation error.
- Outgoing webhook delivery logs are deleted after 30 days, expired sessions are removed and resolved suggestions are deleted after 90 days.
- Internal session routes `GET /v1/manage/teams`, `/v1/manage/digests`, `/v1/manage/dailies` and `/v1/manage/blockers` back the manager tools. They are readable by team managers and organization admins, limited to the last 90 days, and listed only in `/openapi.internal.json`.
- Daily item text and link titles may no longer contain control characters (newlines and tabs included), bidirectional controls or line separators, and link titles are limited to 200 characters. Link URLs follow the same character rules and must use `http` or `https`. Invalid dailies get `invalid_daily`.
- `GET /health` also checks the database and returns `503` with `{ "ok": false }` when it does not answer.
- Internal: `org` is required on `GET /v1/draft` and `GET /v1/today`; the documentation said it was optional.
- Internal: the GitHub webhook receiver answers a signed body that is not JSON with `422 invalid_request` instead of `400`, and rejects bodies over 1 MB with `413 payload_too_large`.
- Internal: `GET /v1/today` returns the standup date for an organization, and `POST /v1/dailies` accepts an optional `X-Standwise-Confirmation: human|agent` header that is stored with the daily. Neither changes the public API.

## 1.2.0

- Outbound webhooks: an organization admin registers HTTPS endpoints on the setup page and picks the events `daily.submitted`, `blocker.opened` and `digest.sent`. A `ping` test event can be sent from the setup page.
- Every delivery is a signed `POST` with the headers `Standwise-Signature` (`t=<unix seconds>,v1=<hex HMAC-SHA256>`), `Standwise-Event`, `Standwise-Delivery` and `User-Agent: Standwise-Webhooks/1`. Failed deliveries are retried up to 8 attempts; an endpoint with 20 failed deliveries in a row is disabled.
- The OpenAPI document has a `webhooks` section with the payload of each event. See the webhooks guide.

## 1.1.0

- API keys (`swk_`) created by an organization admin on the setup page, with the scopes `teams:read`, `dailies:read`, `digests:read` and `blockers:read`.
- Read-only organization operations: `GET /v1/org/teams`, `GET /v1/org/dailies`, `GET /v1/org/dailies/{id}`, `GET /v1/org/digests` and `GET /v1/org/blockers`, paginated by cursor.
- New error codes `insufficient_scope` (HTTP 403, with `required_scope`) and `not_found` (HTTP 404).

## 1.0.0

- OpenAPI 3.1 document at `/openapi.json` and interactive reference at `/docs/api`.
- `GET /health`.
- Rate limits with `RateLimit-*` and `Retry-After` headers; new error code `rate_limited` (HTTP 429).
