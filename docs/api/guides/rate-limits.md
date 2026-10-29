## Rate limits

Limits use a fixed 60-second window.

| Credential | Limit |
| --- | --- |
| Session token (`sw_`) | 120 requests per minute |
| API key (`swk_`) | 600 requests per minute |
| Unauthenticated requests | Counted per IP address |
| Starting a CLI session | 10 requests per minute per IP address |

Limits apply per credential, so one noisy integration does not use up another's budget.

### Headers

Rate-limited routes return these headers on every response:

| Header | Meaning |
| --- | --- |
| `RateLimit-Limit` | Requests allowed in the window. |
| `RateLimit-Remaining` | Requests left in the current window. |
| `RateLimit-Reset` | Seconds until the window resets. |

### When you exceed the limit

The response is `429` with code `rate_limited` and a `Retry-After` header holding the seconds to wait:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 23
RateLimit-Limit: 600
RateLimit-Remaining: 0
RateLimit-Reset: 23
```

Wait `Retry-After` seconds before retrying, and spread retries with jitter.
