# Security Policy

## Supported versions

Standwise is in public beta. Only the latest release of the CLI and the hosted service at `https://api-standwise.usefachada.dev` receive security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's private vulnerability reporting:

https://github.com/ImFelipeOliveira/standwise/security/advisories/new

or email support.standwise@usefachada.dev. You should get a response within a week. Include reproduction steps and, if relevant, the CLI version (`standwise --version`).

## Scope

Reports about these are especially welcome:

- access to another organization's data (tenant isolation);
- suggestions, card activity or daily text reaching managers, the organization API, webhooks, the digest or the setup page;
- OAuth flows (GitHub, Slack, Linear), session and CSRF handling, open redirects;
- token storage and logging;
- the GitHub, Slack and Linear webhooks and the outgoing webhooks;
- the CLI installer and release integrity (`SHA256SUMS`).

Standwise never reads repository code, and the GitHub App asks only for the permissions listed in [docs/github-app.md](docs/github-app.md).
