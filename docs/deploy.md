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

Railway passes service variables to the Docker build as build arguments. Set this on each app service:

| Variable | Value |
| --- | --- |
| `APP` | `api` on the api service, `worker` on the worker service |

The image no longer builds the documentation site. If the api and worker services still have the `STANDCAST_PUBLIC_URL` variable from earlier versions, delete it: only the Cloudflare Pages build reads it now. Keep `SUPPORT_EMAIL` as a runtime variable on the api.

## Runtime variables

Set these on the api service. The worker needs `DATABASE_URL`, `STANDCAST_ENCRYPTION_KEY`, the five `GITHUB_*` variables and the two `LINEAR_*` variables, plus `SUPPORT_EMAIL` and `BETA_EMAIL_FROM` when `RESEND_API_KEY` is set; setting all of them on both is harmless.

**Required since the Linear integration:** `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` must be set on both the api and the worker. Both services fail to start without them, so set them before you deploy this version. See [linear-app.md](linear-app.md).

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Reference the Postgres service |
| `PORT` | Set by Railway |
| `PUBLIC_URL` | Public address of the api, for example `https://api.standcast.app` |
| `SUPPORT_EMAIL` | Shown in the setup and error pages and the OpenAPI document |
| `DOCS_URL` | Address of the documentation site, `https` with no trailing slash, for example `https://docs-standcast.usefachada.dev`. Defaults to `https://docs.standcast.app`. The setup header links to it, and the api redirects `/docs` and `/docs/*` to it with a 301 |
| `LANDING_URL` | Address of the landing page, `https` with no trailing slash. Defaults to `https://standcast.usefachada.dev`. It is where the api sends the browser back when the beta request form is invalid |
| `TRUST_PROXY` | `true` behind Railway |
| `TRUSTED_PROXY_HOPS` | `1` behind Railway |
| `STANDCAST_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Keep it identical on api and worker |
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

Set these on the worker service, which emails beta requests and deletes them after 365 days:

| Variable | Notes |
| --- | --- |
| `SUPPORT_EMAIL` | Required only when `RESEND_API_KEY` is set. The inbox that receives each beta request |
| `RESEND_API_KEY` | Optional. Without it, requests are stored and a warning is logged, and no email is sent |
| `BETA_EMAIL_FROM` | Required when `RESEND_API_KEY` is set, for example `Standcast <beta@usefachada.dev>`. The domain must be verified in Resend |

To set up Resend, create an API key at resend.com and verify the sender domain (add the DNS records Resend shows) before setting `BETA_EMAIL_FROM`.

The landing page is a separate Cloudflare Worker, `standcast-landing`. See [cloudflare-pages.md](cloudflare-pages.md).

`TEST_DATABASE_URL` is only for the test suite.

## Documentation site (Cloudflare Pages)

The documentation site is a static VitePress build hosted on Cloudflare Pages, on its own domain. The api does not serve it: it keeps the API reference at `/reference`, `/openapi.json`, setup, OAuth, webhooks and `/install.sh`, and answers the old URLs with permanent redirects:

| Old URL | Redirects to |
| --- | --- |
| `/docs/api` | `/reference` |
| `/docs`, `/docs/`, `/docs/<path>` | `<DOCS_URL>/<path>`, keeping the query string |

The Pages project settings, variables and custom domain are in [cloudflare-pages.md](cloudflare-pages.md). Set `DOCS_URL` on the api to the Pages custom domain.

## Deploying without the final domain

You can deploy before the final domain exists, with an interim domain of your own (for example `api-standcast.usefachada.dev`) or the address Railway generates (`*.up.railway.app`). The interim domain points at the api service, which also serves setup, OAuth, webhooks, the API reference at `/reference` and `/install.sh`. The documentation site has its own interim domain on Cloudflare Pages, `docs-standcast.usefachada.dev`. Set `PUBLIC_URL` to that address, for example `https://api-standcast.usefachada.dev`, and point everything below at it:

- **GitHub App:** the callback URL, the webhook URL and the setup URL. See [github-app.md](github-app.md).
- **Slack app:** the redirect URLs.
- **Linear app:** the redirect URL. See [linear-app.md](linear-app.md).
- **`SUPPORT_EMAIL`:** set it to an address you read, on the api runtime variable and on the Cloudflare Pages project.
- **`STANDCAST_PUBLIC_URL`:** set it on the Cloudflare Pages project to the interim api address, so the docs examples and the API reference link show it.
- **`DOCS_URL`:** set it on the api to `https://docs-standcast.usefachada.dev`.
- **README.md and `packages/plugin/skills/daily/SKILL.md`:** they are read on GitHub and in the plugin, not built, so they name the interim address directly.
- **CLI:** the released binary points at `https://api.standcast.app` unless the release is built with `STANDCAST_DEFAULT_API_URL`. The release workflow sets it to the interim address. Without a release build, people run `standcast login --api-url <url>` or set `STANDCAST_API_URL`.

### External app settings checklist

These settings live outside the repository, so a domain change does not update them. Check every row after changing the api domain. The symptom column is what a person sees when the row is wrong.

| App | Setting | Value | Symptom when wrong |
| --- | --- | --- | --- |
| GitHub App | Setup URL | `<PUBLIC_URL>/setup` | After installing the app, the browser lands on a 404 page of another site |
| GitHub App | Callback URL | `<PUBLIC_URL>/auth/github/callback` | Signing in to the setup page fails with a redirect URI error on GitHub |
| GitHub App | Webhook URL | `<PUBLIC_URL>/webhooks/github` | Installs and `standcast.yml` pushes are never seen; the setup page stays unconfigured |
| GitHub App | Enable Device Flow | on | `standcast login` fails with `device_flow_disabled` |
| Slack app | Redirect URL | `<PUBLIC_URL>/oauth/slack/callback` | Connecting Slack fails with `redirect_uri did not match any configured URIs` |
| Linear app | Callback URL | `<PUBLIC_URL>/oauth/linear/callback` | Connecting Linear fails with a redirect URI error on Linear |

### When the final domain arrives

Change every place that names the interim address:

1. Add the final domain to the api service and set `PUBLIC_URL` to it.
2. Update `SUPPORT_EMAIL`, on the api and on the Cloudflare Pages project, if the support address changes.
3. Set `STANDCAST_PUBLIC_URL` on the Cloudflare Pages project to the final api domain and redeploy the site, so the docs show it.
4. Change `STANDCAST_DEFAULT_API_URL` in `.github/workflows/release-please.yml` and publish a new release, so new installs use the final domain.
5. Update the GitHub App callback, webhook and setup URLs to the final domain.
6. Update the Slack and Linear redirect URLs to the final domain.
7. Update the install command and API URLs in `README.md` and `packages/plugin/skills/daily/SKILL.md`. Change `PUBLISHED_INSTALL_URL` in `scripts/check-docs.ts` to match, or `check-docs` fails.
8. Add `docs.standcast.app` as a custom domain of the Cloudflare Pages project, set `DOCS_URL` on the api to `https://docs.standcast.app` and update the docs links in `README.md`. Keep `docs-standcast.usefachada.dev` on the Pages project so old links keep working.
9. Keep the interim domain pointing at the api. The CLI saves the `apiUrl` it signed in with in the user's credentials, and keeps using it until the person signs in again with `standcast login --api-url <url>`. Removing the old domain breaks every CLI that was installed before.
