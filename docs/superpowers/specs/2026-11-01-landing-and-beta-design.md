# Landing page, beta requests and docs for agents

Approved by Felipe on 2026-11-01. The approved visual design is the artifact https://claude.ai/artifact/MGfAqeBiDDqUgzRhBq9dND (version 2, with animation).

## Why

Standwise is in public beta and needs beta testers. Today there is no page that explains the product to someone who has never heard of it, and no way to ask for access. The landing gives the launch posts (LinkedIn, TabNews, Reddit, MCP directories) one place to point to. Felipe wants to contact each team after they install, to check it is going well.

## Goals

1. A public landing page at `https://standwise.usefachada.dev`. It follows the approved artifact: hero with the install command and the animated terminal → Slack digest, the supported clients strip, "A day with Standwise" timeline, six features, the privacy band, `standwise.yml` with the check run, three ways to write, FAQ, the beta form and the footer.
2. A beta request form. The browser posts it straight to the API. The API stores the request in Postgres, a worker job emails it to support through Resend, and the person is redirected (303) to the install guide at `DOCS_URL/admin/install`.
3. Lighthouse SEO score of at least 99 on the landing (mobile and desktop). Lighthouse accessibility and best practices should also reach 95.
4. AI tools can find and understand Standwise easily:
   - The landing, the docs site (en and pt-BR), the API host and the repository root each serve an `llms.txt`. The landing also serves a markdown version of the page at `/index.md`, JSON-LD (`SoftwareApplication`, `FAQPage`), a `robots.txt` that allows AI crawlers and a `sitemap.xml`.
   - The docs site serves `/llms.txt`, `/llms-full.txt` and a `.md` copy of every page, so an agent can configure `standwise.yml` or integrate the API by reading the docs.
5. The landing exists in English (`/`) and Brazilian Portuguese (`/pt-BR/`), linked with `hreflang`. This follows the project rule that web pages and docs are bilingual.

## Non-goals

- No CRM, admin page or listing UI for beta requests. Felipe reads the email; the rows stay in Postgres.
- No analytics or tracking scripts on the landing.
- No changes to the GitHub, Slack or Linear integrations.

## Anti-goals

- A form that loses requests silently. Storing must succeed before the redirect; email failures are retried by the queue and never lose the row.
- A page that needs JavaScript to read or submit. The only scripts are the copy button and the hero animation, and the page is complete without them. With `prefers-reduced-motion: reduce` there is no animation.
- Personal data in logs. Names and emails from the form are never logged.

## Constraints

- No comments in code (TS, TSX, CSS, shell, YAML, HTML included).
- Repository text in English; the pt-BR landing copy is product copy.
- Business rules in a use case in `packages/orchestrator/src/use-cases` throwing `DomainError`; the route stays thin.
- Every HTTP call has a timeout. Resend is called from a worker job, never during the request.
- The landing is static files served by a Cloudflare Worker (assets only), like the docs. Strict CSP: no inline scripts, no `style` attributes, `form-action` limited to the API origin.
- Redirect targets come only from configured URLs (`DOCS_URL`, new `LANDING_URL`).
- New external dependency allowed: `vitepress-plugin-llms` (docs build only). Resend is called with `fetch`; no SDK.

## Decisions

- **Beta form transport (Claude's call):** a plain HTML form `POST`ed to `https://api-standwise.usefachada.dev/beta` as `application/x-www-form-urlencoded`. No CORS, works without JavaScript.
- **Fields:** name, work email, team size (`3-5`, `6-15`, `16+`), chat (`slack`, `google_chat`, `other`), tracker (`linear`, `jira`, `github`, `other`), locale (`en` or `pt-BR`, hidden field) and a honeypot field `company_website` that must stay empty.
- **Outcomes:** valid → stored, email job enqueued, `303` to `${DOCS_URL}/admin/install` (or `${DOCS_URL}/pt-BR/admin/install` for `pt-BR`). The same email asking again within 24 hours does not create a second row or a second email and still redirects. Honeypot filled → nothing stored, same redirect. Invalid input → `303` to `${LANDING_URL}/#beta-invalid` (or `/pt-BR/#beta-invalid`), where a `:target` rule shows the error message. More than 5 requests a minute from one IP → the existing `429 rate_limited`.
- **Email (Felipe's call):** Resend, from the worker. `RESEND_API_KEY` is optional: without it the job records nothing and logs one warning, so deploys work before Felipe sets it up. Sender from `BETA_EMAIL_FROM`, recipient `SUPPORT_EMAIL`.
- **Retention (Claude's call):** beta requests are deleted 12 months after creation by the daily prune job, and the privacy page says so.

## Left to the builder

The exact markdown wording of `llms.txt` and `index.md` (they must match the page), the pt-BR translation of the landing copy, and the email body layout (plain text is fine).
