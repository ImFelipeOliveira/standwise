# Deploy on Railway

Create one Railway project with three services: Postgres, the api and the worker. Both app services build the same `Dockerfile` from the repository root. Set the config file path of each service to its own file: `apps/api/railway.json` for the api and `apps/worker/railway.json` for the worker.

The image contains both apps. The start command in each `railway.json` decides what runs, so a wrong `APP` cannot make the worker run the api or the reverse:

| Service | Start command | Health check |
| --- | --- | --- |
| api | `sh -c 'bun run db:migrate && exec bun run apps/api/src/main.ts'` | `/health` |
| worker | `bun run apps/worker/src/main.ts` | none |

The api applies the database migrations on every start.

## Replicas

Run exactly one api replica. Installations that are waiting for a GitHub App approval are cached in the memory of the api process, and migrations run on every start, so two replicas would disagree about pending installations and race on migrations. The worker can scale to more replicas.

## Build variables

Railway passes service variables to the Docker build as build arguments. Set these on each app service:

| Variable | Value |
| --- | --- |
| `APP` | `api` on the api service, `worker` on the worker service |
| `SUPPORT_EMAIL` | `support@standwise.dev`. The docs site is built into the image and the build fails without it |

## Runtime variables

Set these on the api service. The worker needs `DATABASE_URL`, `STANDWISE_ENCRYPTION_KEY`, the five `GITHUB_*` variables and the two `LINEAR_*` variables; setting all of them on both is harmless.

**Required since the Linear integration:** `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` must be set on both the api and the worker. Both services fail to start without them, so set them before you deploy this version. See [linear-app.md](linear-app.md).

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Reference the Postgres service |
| `PORT` | Set by Railway |
| `PUBLIC_URL` | Public address of the api, for example `https://api.standwise.dev` |
| `SUPPORT_EMAIL` | Shown in the docs and the OpenAPI document |
| `TRUST_PROXY` | `true` behind Railway |
| `TRUSTED_PROXY_HOPS` | `1` behind Railway |
| `STANDWISE_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Keep it identical on api and worker |
| `SESSION_SECRET` | At least 16 random characters |
| `GITHUB_APP_ID` | See [github-app.md](github-app.md) |
| `GITHUB_APP_PRIVATE_KEY` | The whole PEM; `\n` for line breaks |
| `GITHUB_WEBHOOK_SECRET` | |
| `GITHUB_CLIENT_ID` | |
| `GITHUB_CLIENT_SECRET` | |
| `SLACK_CLIENT_ID` | See [slack-app-manifest.yml](slack-app-manifest.yml) |
| `SLACK_CLIENT_SECRET` | |
| `LINEAR_CLIENT_ID` | Required on api and worker. See [linear-app.md](linear-app.md) |
| `LINEAR_CLIENT_SECRET` | Required on api and worker |

`TEST_DATABASE_URL` is only for the test suite.

## Deploying without the final domain

You can deploy before the final domain exists, with an interim domain of your own (for example `standwise.usefachada.dev`) or the address Railway generates (`*.up.railway.app`). Set `PUBLIC_URL` to that address, and point everything below at it:

- **GitHub App:** the callback URL, the webhook URL and the setup URL. See [github-app.md](github-app.md).
- **Slack app:** the redirect URLs.
- **Linear app:** the redirect URL. See [linear-app.md](linear-app.md).
- **`SUPPORT_EMAIL`:** set it to an address you read, on both the build variable and the runtime variable.
- **CLI:** the released binary points at `https://api.standwise.dev` unless the release is built with `STANDWISE_DEFAULT_API_URL`. The release workflow sets it to the interim address. Without a release build, people run `standwise login --api-url <url>` or set `STANDWISE_API_URL`.

### When the final domain arrives

1. Add the final domain to the api service and set `PUBLIC_URL` to it.
2. Update the GitHub App callback, webhook and setup URLs, and the Slack and Linear redirect URLs, to the final domain.
3. Update `SUPPORT_EMAIL` if the support address changes.
4. Change `STANDWISE_DEFAULT_API_URL` in the release workflow and publish a new release, so new installs use the final domain.
5. Keep the interim domain pointing at the api. The CLI saves the `apiUrl` it signed in with in the user's credentials, and keeps using it until the person signs in again with `standwise login --api-url <url>`. Removing the old domain breaks every CLI that was installed before.
