# Deploy on Railway

Create one Railway project with three services: Postgres, the api and the worker. Both app services build the same `Dockerfile` from the repository root. Set the config file path of each service to its own file: `apps/api/railway.json` for the api and `apps/worker/railway.json` for the worker.

The image contains both apps. The start command in each `railway.json` decides what runs, so a wrong `APP` cannot make the worker run the api or the reverse:

| Service | Start command | Health check |
| --- | --- | --- |
| api | `sh -c 'bun run db:migrate && exec bun run apps/api/src/main.ts'` | `/health` |
| worker | `bun run apps/worker/src/main.ts` | none |

The api applies the database migrations on every start. Run a single api replica.

## Build variables

Railway passes service variables to the Docker build as build arguments. Set these on each app service:

| Variable | Value |
| --- | --- |
| `APP` | `api` on the api service, `worker` on the worker service |
| `SUPPORT_EMAIL` | `support@standwise.dev`. The docs site is built into the image and the build fails without it |

## Runtime variables

Set these on the api service. The worker needs only `DATABASE_URL`, `STANDWISE_ENCRYPTION_KEY` and the five `GITHUB_*` variables; setting all of them on both is harmless.

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

`TEST_DATABASE_URL` is only for the test suite.
