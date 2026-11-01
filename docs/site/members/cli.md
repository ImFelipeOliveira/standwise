# CLI

```text
standcast <command> [options]
```

Commands print their result as JSON on standard output and messages on standard error, so scripts and agents can read them. To install the CLI, see [Getting started](/members/getting-started#_1-install-the-cli).

## Commands

### `standcast login`

Signs in with GitHub using the device flow. The CLI shows a URL and a code, opens the browser when it can, and waits until you authorize. It then saves your session and the organizations where Standcast is installed and you are a member.

```bash
standcast login
```

Signing in also links your Slack user for mentions in the digest. Run it again when you join a new organization, when the app is installed in a new one, or when your admin connects Slack or changes your identity mapping.

### `standcast logout`

Revokes the session on the server and deletes the local credentials file. It prints "Credentials removed." even when you were not signed in.

### `standcast whoami`

Prints your login and organizations from the saved credentials, without calling the API.

```json
{"login":"alice","orgs":[{"installationId":12345678,"login":"acme"}]}
```

### `standcast draft`

Prints the draft of your daily for the organization:

```json
{
  "org": "acme",
  "date": "2026-10-28",
  "since": "2026-10-27T03:00:00.000Z",
  "teams": ["backend"],
  "activity": [
    {
      "kind": "pr_merged",
      "title": "Add rate limiting",
      "url": "https://github.com/acme/api/pull/42",
      "repo": "acme/api",
      "at": "2026-10-27T18:20:00.000Z"
    },
    {
      "kind": "commits",
      "title": "Fix retry backoff",
      "url": "https://github.com/acme/worker/commit/9f2c1e0",
      "repo": "acme/worker",
      "at": "2026-10-27T15:02:00.000Z",
      "count": 3
    }
  ],
  "suggestions": [
    {
      "id": "6f1c2b8e-3a4d-4c55-9d0e-1a2b3c4d5e6f",
      "kind": "pr_no_review",
      "ref": { "kind": "pull_request", "url": "https://github.com/acme/api/pull/57", "title": "Retry webhooks" },
      "since": "2026-10-26T14:00:00.000Z"
    }
  ]
}
```

- `date`: the standup date this daily will count for.
- `since`: the start of the activity window.
- `teams`: your teams in this organization.
- `activity`: up to 50 items, newest first. `kind` is `pr_opened`, `pr_merged`, `review`, `commits`, `card_started` or `card_done`. Commits are grouped per repository, with `count`. For cards, `repo` is the Linear team key and `url` is the card link, which you can use as the link of a blocker.
- `suggestions`: possible blockers Standcast noticed for you, each `{ id, kind, ref, since }`. `kind` is `pr_no_review` (your pull request without review), `ci_failing` (checks failing on it for 24 hours) or `card_stale` (one of your Linear cards in progress for `card_stale_days`). Only you see them. See [`standcast suggestion`](#standcast-suggestion).

### `standcast submit`

Sends your daily. It reads the JSON from `--file`, or from standard input when `--file` is missing.

```bash
standcast submit --file daily.json
```

```json
{
  "org": "acme",
  "yesterday": [
    {
      "text": "Shipped rate limiting",
      "ref": { "kind": "pull_request", "url": "https://github.com/acme/api/pull/42", "title": "Add rate limiting" }
    }
  ],
  "today": [{ "text": "Write the integrator guides" }],
  "blockers": [{ "text": "Waiting for the staging database" }]
}
```

| Field | Rules |
| --- | --- |
| `org` | Optional in the file. When missing, `--org` is used, or your only organization. |
| `yesterday` | Up to 30 items. Can be empty. |
| `today` | 1 to 30 items. |
| `blockers` | Up to 10 items. Can be empty. |
| `text` | 1 to 500 characters, on one line. |
| `ref` | Optional. `kind` is `pull_request`, `issue`, `commit` or `card`; `url` uses `http` or `https`; `title` has up to 200 characters. |

Text, URLs and titles cannot contain control characters (newlines and tabs included), bidirectional controls or line separators.

The result:

```json
{"date":"2026-10-28","teams":["backend"],"late":false}
```

`late: true` means the digest had already been posted, so your daily went as a reply in its thread.

`standcast submit` sends what you give it. When an agent calls it for you, the agent must show you the daily and get your confirmation first. The [Claude Code skill](/members/claude-code) and the [MCP server](/members/mcp) enforce that.

### `standcast suggestion`

Answers a suggested blocker from the draft:

```bash
standcast suggestion confirm <id>
standcast suggestion ignore <id>
```

- `confirm` marks it as a real blocker. Add it to `blockers` in your daily, with its `ref`; submitting the daily confirms it too.
- `ignore` hides it. It comes back only if the signal changes: a new head commit that is still failing, or the pull request going back to no review.
- Use `--org <login>` when you belong to more than one organization.
- An unknown id, or one that is not yours, gives `error not_found`. The opposite decision to the one already made gives `error suggestion_already_decided`. Repeating the same decision works.

### `standcast mcp`

Starts the local MCP server over standard input and output, for AI clients. See [MCP server](/members/mcp).

## Options

| Option | Description |
| --- | --- |
| `--org <login>` | The organization, when you belong to more than one. |
| `--file <path>` | The daily JSON file for `submit`. |
| `--api-url <url>` | The Standcast API. Without it, the CLI uses `STANDCAST_API_URL`, and without that, the Standcast API at `https://api.standcast.app`. |
| `--help` | Shows the usage. |
| `--version` | Shows the version. |

## Environment

| Variable | Description |
| --- | --- |
| `STANDCAST_API_URL` | The Standcast API, when `--api-url` is not given. |
| `STANDCAST_LANG` | Language of the CLI messages, `en` or `pt-BR`. Falls back to `LC_ALL`, then `LANG`, then English. |
| `XDG_CONFIG_HOME` | Where the credentials file goes. Defaults to `~/.config`. |

The API URL must use `https`. `http` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. A saved session works only with the API it was created for: using it with another URL fails with exit code 2 and asks you to sign in again with `--api-url`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Error: network failure, API error, unreadable file, invalid arguments or an unknown command. The message says which. |
| `2` | Not signed in, the session expired or was revoked, or the saved session belongs to another API. Run `standcast login`. |
| `3` | More than one organization and no `--org`, or no organization with Standcast installed. |
| `4` | The daily JSON is invalid or failed validation. The message lists each issue. |

API errors are printed as `error <code>: <message>`, plus the wait time when you hit a rate limit.

## Credentials

`standcast login` saves your session in `~/.config/standcast/credentials.json`, or `$XDG_CONFIG_HOME/standcast/credentials.json` when that variable is set. The folder is created with mode `700` and the file with mode `600`, readable only by you. The file holds the API URL, the session token (`sc_...`), your login and your organizations.

The session expires after 90 days without use. `standcast logout` revokes it and deletes the file.
