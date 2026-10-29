# Contributing

## Commits

Use Conventional Commits: `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `ci:`, `chore:`. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.

## Releases

Releases are automatic. release-please watches `main` and keeps a release PR open with the next version and changelog. Merging that PR tags the release and uploads the CLI binaries and `SHA256SUMS` to it.

## Running tests locally

```sh
cp .env.example .env
docker compose up -d
bun install
bun test
```

Also run `bun run lint` and `bun run typecheck` before opening a PR.

## Code style

Do not write comments in code. Make names and structure carry the meaning.
