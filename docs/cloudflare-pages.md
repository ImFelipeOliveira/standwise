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
