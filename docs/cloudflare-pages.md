# Documentation site on Cloudflare Pages

The documentation site (`docs/site`, VitePress, en and pt-BR) is a static site hosted on Cloudflare Pages. It is served at the root of its own domain: `https://docs-standwise.usefachada.dev` for now, `https://docs.standwise.dev` later. The api does not build or serve it; it only redirects the old `/docs` URLs to it (see [deploy.md](deploy.md)).

## Create the project

In the Cloudflare dashboard, open **Workers & Pages > Create > Pages > Connect to Git** and pick the `standwise` repository.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | `bun install --frozen-lockfile && bun run docs:build` |
| Build output directory | `docs/site/.vitepress/dist` |
| Root directory | `/` |
| Build system version | The latest (v3). It ships Node, which VitePress needs, and installs Bun from `BUN_VERSION` |

## Environment variables

Set these for both **Production** and **Preview** under **Settings > Variables and Secrets**:

| Variable | Value |
| --- | --- |
| `BUN_VERSION` | `1.4.4`, the same Bun as the Docker image |
| `SUPPORT_EMAIL` | The support address shown on the privacy pages. The build fails without it |
| `STANDWISE_PUBLIC_URL` | The api's public URL, for example `https://api-standwise.usefachada.dev`. It must use `https` and have no trailing slash, or the build fails. The docs examples (install command, base URL, `curl` calls) and the **API reference** link (`<STANDWISE_PUBLIC_URL>/reference`) use it. When it is not set, they show `https://api.standwise.dev` |

## Branches

Under **Settings > Builds & deployments > Branch control**:

- Production branch: `main`.
- Preview branches: **Custom branches**, include `dev`. Pull request previews are optional.

## Custom domain

Under **Custom domains**, add `docs-standwise.usefachada.dev`. Then set `DOCS_URL=https://docs-standwise.usefachada.dev` on the api service on Railway, so the setup header and the `/docs` redirects point at it.

When the final domain arrives, add `docs.standwise.dev` as a second custom domain, set `DOCS_URL=https://docs.standwise.dev` on the api and keep the interim domain attached.

## Headers and redirects

The build writes two files Cloudflare Pages reads from the output directory:

- `_headers`, generated at the end of the build by `scripts/docs-headers.ts`: HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` and a self-only Content-Security-Policy with `frame-ancestors 'none'`. The policy allows the inline scripts VitePress writes by their `sha256` hashes, computed from the built pages, so it never needs `'unsafe-inline'` for scripts. Hashed files under `/assets/` are cached for a year.
- `_redirects`, from `docs/site/public/_redirects`: `/pt-BR` to `/pt-BR/`.

## Check a build locally

```sh
SUPPORT_EMAIL=x@y.z STANDWISE_PUBLIC_URL=https://api-standwise.usefachada.dev bun run docs:build
```

`docs/site/.vitepress/dist/index.html` must exist, asset URLs start with `/assets/`, and the API reference link points at `https://api-standwise.usefachada.dev/reference`.

## Keep Cloudflare script injection off

The generated `_headers` allows only the site's own scripts. Leave **Web Analytics** (the JavaScript beacon) and **Rocket Loader** off for this project, or the browser blocks them. If you turn Web Analytics on later, add `https://static.cloudflareinsights.com` to `script-src` and `connect-src` in `scripts/docs-headers.ts`.

## Created as a Worker instead of Pages

If the project was created through **Workers & Pages > Create > Worker > Import a repository** (Workers Builds), Cloudflare runs `npx wrangler deploy` after the build. The repository root has a `wrangler.jsonc` for that case: it publishes `docs/site/.vitepress/dist` as static assets, and Workers static assets read the same `_headers` and `_redirects` files.

- The Worker name in Cloudflare must be `standwise-docs`, the `name` in `wrangler.jsonc`. Rename one of them if they differ.
- Build command: `bun install --frozen-lockfile && bun run docs:build`. Deploy command: `npx wrangler deploy`.
- Set the same build variables (`BUN_VERSION`, `SUPPORT_EMAIL`, `STANDWISE_PUBLIC_URL`) under the Worker's **Settings > Build > Variables and secrets**.
- Add the custom domain under the Worker's **Settings > Domains & Routes**.

## Landing page Worker

The landing page (`apps/landing`) is a second Worker, `standwise-landing`, served at `https://standwise.usefachada.dev`. It has no build step: `apps/landing/public` is published as static assets, with its own `_headers` already in that folder. The config is `apps/landing/wrangler.jsonc`. Agents find `llms.txt` at its root.

Create it through **Workers & Pages > Create > Worker > Import a repository** (Workers Builds) and pick the `standwise` repository.

| Setting | Value |
| --- | --- |
| Worker name | `standwise-landing`, the `name` in `apps/landing/wrangler.jsonc` |
| Production branch | `main` |
| Build command | None |
| Deploy command | `npx wrangler deploy -c apps/landing/wrangler.jsonc` |
| Root directory | `/` |

Add the custom domain `standwise.usefachada.dev` under the Worker's **Settings > Domains & Routes**. The form posts to the api, which sends the browser back to `LANDING_URL` when the form is invalid (see [deploy.md](deploy.md)). The landing's `_headers` CSP `form-action` lists the api, docs and landing hosts, so update it if `DOCS_URL`, `LANDING_URL` or the api host change. When `standwise.dev` arrives, add it as a second custom domain and keep the interim one.
