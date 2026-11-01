## Authentication

The public Standcast API authenticates with an **API key**. Send it as a bearer token on every request:

```http
GET /v1/{resource} HTTP/1.1
Host: your-standcast-host
Authorization: Bearer sck_xxxxxxxxxxxxxxxxxxxxxxxx
```

API keys are prefixed with `sck_`. Every operation under `/v1/org` requires one. Only `sck_` keys are accepted there: a session token (`sc_`) sent to `/v1/org` fails with `401 unauthorized`, and an API key sent to a session-only route fails the same way.

### Creating a key

Only an organization admin can create keys. An admin signs in with GitHub, opens the Standcast setup page of the organization and uses the **API keys** section: name the key, pick its scopes and create it. For a personal account, the account owner is the admin. Each key belongs to one organization and sees only that organization's data.

The full secret is shown once, when the key is created. Standcast stores only a hash and cannot show it again, so copy it right away. The list shows each key's prefix (the first 8 characters after `sck_`), scopes, creation date and last use, which is updated at most once per minute.

### Scopes

Grant the narrowest scope that works.

| Scope | Allows |
| --- | --- |
| `teams:read` | `GET /v1/org/teams` |
| `dailies:read` | `GET /v1/org/dailies` and `GET /v1/org/dailies/{id}` |
| `digests:read` | `GET /v1/org/digests` |
| `blockers:read` | `GET /v1/org/blockers` |

A request that needs a scope the key does not have fails with `403 insufficient_scope`. The error names the missing scope in `required_scope`:

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "api key lacks the dailies:read scope",
    "required_scope": "dailies:read"
  }
}
```

Missing, malformed, unknown and revoked keys fail with `401 unauthorized`. Each key is limited to 600 requests per minute (see Rate limits).

### Revoking a key

An admin can revoke a key at any time. Revocation takes effect immediately and later requests with that key fail with `401 unauthorized`. Rotate a key by creating the new one first, deploying it, then revoking the old one.

### Storing keys safely

- Keep keys in a secret manager or in environment variables, never in source control or client-side code.
- Use one key per integration so a leak can be revoked without breaking the others.
- Never log the `Authorization` header.
- If a key may have leaked, revoke it immediately.

### Session tokens (`sc_`)

Tokens starting with `sc_` are session tokens issued to the Standcast CLI, skill and MCP server after a GitHub login. They are not an integration method and the operations they unlock are not part of this reference.
