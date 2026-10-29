## Authentication

The public Standwise API authenticates with an **API key**. Send it as a bearer token on every request:

```http
GET /v1/{resource} HTTP/1.1
Host: your-standwise-host
Authorization: Bearer swk_xxxxxxxxxxxxxxxxxxxxxxxx
```

API keys are prefixed with `swk_`. They are available once an admin creates a key; until then the `apiKey` security scheme is declared but no operation requires it.

### Creating a key

Only an organization admin can create keys. Each key belongs to one organization and carries a set of scopes, so an integration receives only the access it needs. The full secret is shown once, at creation. Standwise stores only a hash and cannot show it again.

### Scopes

Grant the narrowest scope that works. A request that needs a scope the key does not have fails with `403 forbidden`.

### Revoking a key

An admin can revoke a key at any time. Revocation takes effect immediately and later requests with that key fail with `401 unauthorized`. Rotate a key by creating the new one first, deploying it, then revoking the old one.

### Storing keys safely

- Keep keys in a secret manager or in environment variables, never in source control or client-side code.
- Use one key per integration so a leak can be revoked without breaking the others.
- Never log the `Authorization` header.
- If a key may have leaked, revoke it immediately.

### Session tokens (`sw_`)

Tokens starting with `sw_` are session tokens issued to the Standwise CLI, skill and MCP server after a GitHub login. They are not an integration method and the operations they unlock are not part of this reference.
