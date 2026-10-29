# API keys

API keys let other systems read your organization's data: teams, confirmed dailies, digests and confirmed blockers. They are read-only. They cannot send a daily.

Only admins manage keys: the owner of a personal account, or a member with the `admin` role in the GitHub organization.

## Create a key

1. Open the setup page of the organization and sign in with GitHub.
2. In **API keys**, enter a name for the integration, such as `data-warehouse`.
3. Pick the scopes it needs.
4. Click **Create key**.

The page shows the full key, starting with `swk_`, **once**. Copy it right away. Standwise stores only a hash of it and cannot show it again. If you could not copy it, revoke it and create another.

The list shows each key's name, prefix (the first 8 characters after `swk_`), scopes, creation date and last use. The last use is updated at most once per minute.

## Scopes

| Scope | Allows |
| --- | --- |
| `teams:read` | `GET /v1/org/teams` |
| `dailies:read` | `GET /v1/org/dailies` and `GET /v1/org/dailies/{id}` |
| `digests:read` | `GET /v1/org/digests` |
| `blockers:read` | `GET /v1/org/blockers` |

Grant only what the integration needs. A request without the right scope fails with `403 insufficient_scope`.

## Use a key

Send the key as a bearer token:

```bash
curl -H "Authorization: Bearer $STANDWISE_API_KEY" \
  "https://api.standwise.dev/v1/org/dailies?date=2026-10-28&team=backend"
```

Each key is limited to 600 requests per minute. See the [API overview](/api/overview).

## Rotate a key

Keys do not expire. To rotate one:

1. Create a new key with the same scopes.
2. Deploy it to the integration.
3. Revoke the old key.

## Revoke a key

Click **Revoke** next to the key. It stops working immediately: later requests fail with `401 unauthorized`. Revoked keys stay in the list, marked as revoked.

If a key may have leaked, revoke it right away.

## Good practice

- One key per integration, so you can revoke one without breaking the others.
- Keep keys in a secret manager or environment variables, never in source control or in browser code.
- Never log the `Authorization` header.
