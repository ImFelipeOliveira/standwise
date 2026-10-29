# API changelog

Breaking changes are announced here at least 90 days before they take effect. See the versioning guide.

## Unreleased

- Default language is now English when none is specified.
- `standwise mcp`: local MCP server over stdio with the tools `standwise_whoami`, `standwise_get_draft` and `standwise_submit_daily` (requires `confirmed: true`), plus the manager tools `standwise_list_teams`, `standwise_get_digest`, `standwise_list_dailies` and `standwise_list_blockers`. See the MCP guide.
- Internal session routes `GET /v1/manage/teams`, `/v1/manage/digests`, `/v1/manage/dailies` and `/v1/manage/blockers` back the manager tools. They are readable by team managers and organization admins, limited to the last 90 days, and listed only in `/openapi.internal.json`.

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
