# API changelog

Breaking changes are announced here at least 90 days before they take effect. See the versioning guide.

## 1.0.0

- OpenAPI 3.1 document at `/openapi.json` and interactive reference at `/docs/api`.
- `GET /health`.
- Rate limits with `RateLimit-*` and `Retry-After` headers; new error code `rate_limited` (HTTP 429).
