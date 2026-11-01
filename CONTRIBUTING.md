# Contributing

## Commits

Use Conventional Commits: `feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `ci:`, `chore:`. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.

## Releases

Releases are automatic. release-please watches `main` and keeps a release PR open with the next version and changelog. Merging that PR tags the release and uploads the CLI binaries and `SHA256SUMS` to it.

Release PRs are opened with the default `GITHUB_TOKEN`, so CI does not run on them automatically. To run the checks, close and reopen the PR, or push an empty commit to it.

The repository setting "Allow GitHub Actions to create and approve pull requests" must be enabled for release-please to open its PR.

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

## Review guide

The patterns, code smells and past bugs reviewers look for are in [docs/engineering/review-guide.md](docs/engineering/review-guide.md). CodeRabbit reads it too (see `.coderabbit.yaml`).
