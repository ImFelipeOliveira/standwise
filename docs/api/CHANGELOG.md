# API changelog

Breaking changes are announced here at least 90 days before they take effect. See the versioning guide.

## 1.1.0

- API keys (`swk_`) created by an organization admin on the setup page, with the scopes `teams:read`, `dailies:read`, `digests:read` and `blockers:read`.
- Read-only organization operations: `GET /v1/org/teams`, `GET /v1/org/dailies`, `GET /v1/org/dailies/{id}`, `GET /v1/org/digests` and `GET /v1/org/blockers`, paginated by cursor.
- New error codes `insufficient_scope` (HTTP 403, with `required_scope`) and `not_found` (HTTP 404).

## 1.0.0

- OpenAPI 3.1 document at `/openapi.json` and interactive reference at `/docs/api`.
- `GET /health`.
- Rate limits with `RateLimit-*` and `Retry-After` headers; new error code `rate_limited` (HTTP 429).
