## Errors

Every error response uses the same envelope:

```json
{ "error": { "code": "invalid_daily", "message": "invalid daily", "issues": [] } }
```

`code` is the stable contract: branch on it, not on `message`. `message` is always English and may change. `issues` is present only on validation errors and lists the failing fields. `required_scope` is present only on scope errors.

| Code | HTTP status | What to do |
| --- | --- | --- |
| `unauthorized` | 401 | The credential is missing, invalid, expired or revoked. Authenticate again or use a valid key. |
| `invalid_signature` | 401 | Only on the GitHub webhook receiver: the `X-Hub-Signature-256` header is missing or does not match the body. Nothing was processed. |
| `invalid_request` | 422 | The request is malformed. Check `issues` and fix the listed fields. A signed GitHub webhook body that is not JSON also returns this code. |
| `invalid_daily` | 422 | The daily payload failed validation. Check `issues` against the schema. |
| `org_not_found` | 404 | The organization does not exist or the Standwise app is not installed on it. Check the name and the installation. |
| `org_not_configured` | 409 | The organization has no valid `standwise.yml`. Add or fix the file in the `.github` repository, then retry. |
| `not_in_team` | 422 | The person is not listed in any team of this organization. Add them to a team in `standwise.yml`. |
| `forbidden` | 403 | The credential is valid but the person or organization is not allowed to perform this action. |
| `insufficient_scope` | 403 | The API key lacks the scope this operation needs. The error carries `required_scope`. Create a key with that scope. |
| `not_found` | 404 | The resource does not exist in the key's organization. |
| `invalid_state` | 400 | An authorization link expired or was tampered with. Start the flow again. |
| `installation_pending` | 409 | The installation is still being processed. Retry in a few seconds. |
| `access_denied` | 403 | The person denied the authorization. Nothing was changed. |
| `slack_oauth_failed` | 502 | Slack rejected the connection. Try connecting again. |
| `payload_too_large` | 413 | Only on the GitHub webhook receiver: the body is larger than 1 MB. Nothing was processed. |
| `rate_limited` | 429 | Too many requests. Wait `Retry-After` seconds, then retry (see Rate limits). |
| `internal` | 500 | Unexpected server error. Retry with backoff and contact support if it persists. |
