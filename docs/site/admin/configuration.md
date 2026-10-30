# standwise.yml reference

Standwise reads its whole configuration from one file: `standwise.yml` at the **root** of the `.github` repository of the organization (or personal account), on the default branch. There is no other place to configure teams.

Every `yaml` example on this page is checked against the real parser when the docs are built.

## Minimal example

```yaml
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily-backend"
```

## Full example

```yaml
teams:
  - name: backend
    timezone: America/Boa_Vista
    workdays: [mon, tue, wed, thu, fri]
    remind_at: "09:30"
    digest_at: "10:00"
    language: pt-BR
    managers: [felipeoliveira]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily-backend"
    tracker:
      provider: linear
      team: BE
    signals:
      pr_review_hours: 48
      card_stale_days: 5
members:
  alice: { slack: U0123, linear: alice@acme.com }
```

## Top level

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `teams` | list of teams | yes | | At least one team. Team names must be unique. |
| `members` | map of GitHub login to identities | no | `{}` | Manual identity mapping. See [Identity mapping](#identity-mapping). |

No other keys are accepted. An unknown key fails validation with `Unrecognized key`.

## Team keys

| Key | Type | Required | Default | Example |
| --- | --- | --- | --- | --- |
| `name` | text, not empty | yes | | `backend` |
| `timezone` | IANA time zone | yes | | `America/Sao_Paulo` |
| `workdays` | list of `mon` `tue` `wed` `thu` `fri` `sat` `sun`, at least one | no | `[mon, tue, wed, thu, fri]` | `[mon, tue, wed, thu]` |
| `remind_at` | `HH:MM`, 24 hours | yes | | `"09:30"` |
| `digest_at` | `HH:MM`, 24 hours | yes | | `"10:00"` |
| `language` | `en` or `pt-BR` | no | `en` | `pt-BR` |
| `managers` | list of GitHub logins, at least one | yes | | `[felipeoliveira]` |
| `members` | list of GitHub logins or GitHub teams, at least one | yes | | `[alice, "@acme/backend"]` |
| `chat.provider` | `slack` or `google-chat` | yes | | `slack` |
| `chat.channel` | text, not empty | yes | | `"#daily-backend"` |
| `tracker.provider` | `linear` or `jira` | no | | `linear` |
| `tracker.team` | text, not empty | with `tracker` | | `BE` |
| `signals.pr_review_hours` | number greater than 0 | no | `48` | `24` |
| `signals.card_stale_days` | number greater than 0 | no | `5` | `3` |

### `name`

The team name, as it appears in the digest title, in the API and in the MCP tools. It must be unique in the file. Renaming a team starts a new history under the new name.

### `timezone`

An IANA time zone name, such as `America/Sao_Paulo`, `Europe/Lisbon` or `UTC`. Abbreviations like `BRT` or city names like `Brasilia` are rejected.

### `workdays`

The days the team has a standup. Digests go out only on these days. A daily sent on another day counts for the next workday.

### `remind_at`

The local time of the reminder. It is required and validated today, but reminders are coming soon: nothing is sent at this time yet.

### `digest_at`

The local time the digest is posted. Quote the value (`"10:00"`) to keep it a string. Use two digits for the hour: `"09:00"`, not `"9:00"`.

### `language`

The language of the digest and of the late dailies posted in its thread: `en` or `pt-BR`. When you leave it out, the team uses English. It does not change what people wrote: dailies are never translated.

### `managers`

GitHub logins of the team managers. Managers can read the team's digests, dailies and blockers through the [MCP manager tools](/members/mcp#manager-tools). Organization admins can read every team without being listed. Coming soon: blockers with no one else to route to will go to the managers.

Each entry must be a plain login. Names starting with `@`, such as `@acme/leads`, are not accepted: Standwise does not expand GitHub teams, so list the logins one by one.

### `members`

Who writes dailies in this team. Each entry is either:

- a GitHub login, such as `alice`; or
- a GitHub team, written `"@org/team-slug"`, such as `"@acme/backend"`. Quote it, because YAML does not allow a value to start with `@`.

GitHub teams are resolved every time Standwise needs the team, so changes on GitHub apply without editing the file. Standwise reads the first 100 members of each GitHub team. Logins are matched without case.

A person can be in several teams. Their daily appears in every team's digest, and their standup date uses the time zone and workdays of the **first** team that lists them.

### `chat`

Where the digest goes.

- `provider`: `slack`. `google-chat` is accepted by the parser but not supported yet: digests for such a team fail with `unsupported_provider`.
- `channel`: the Slack channel, as `"#name"` (quoted, because `#` starts a comment in YAML) or as a channel id such as `C0123456789`. For a private channel, invite the Standwise bot first. See [Slack](/admin/slack).

### `tracker` <Badge type="info" text="coming soon" />

The project tracker of the team: `provider` (`linear` or `jira`) and `team` (the Linear team key or the Jira project key). The parser accepts it so that you can write it now, but Standwise does not connect to Linear or Jira yet.

### `signals` <Badge type="info" text="coming soon" />

Thresholds for suggested blockers, which are coming soon:

- `pr_review_hours`: a pull request with no review for more than this many hours. Default `48`.
- `card_stale_days`: a card in progress for more than this many days. Default `5`.

## GitHub teams

Use a GitHub team instead of listing people one by one. The app needs the Members (read) permission, which it asks for on install.

```yaml
teams:
  - name: platform
    timezone: Europe/Lisbon
    remind_at: "09:00"
    digest_at: "09:30"
    managers: [carol]
    members: ["@acme/platform", dave]
    chat:
      provider: slack
      channel: C0123456789
```

## Several teams

Each team has its own channel, time zone and times. Erin is in both teams, so her standup date follows `backend`, the first team that lists her.

```yaml
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "10:00"
    language: pt-BR
    managers: [felipeoliveira]
    members: [alice, bob, erin]
    chat:
      provider: slack
      channel: "#daily-backend"
  - name: mobile
    timezone: America/New_York
    workdays: [mon, tue, wed, thu]
    remind_at: "08:45"
    digest_at: "09:15"
    managers: [frank]
    members: [erin, grace]
    chat:
      provider: slack
      channel: "#daily-mobile"
```

## Identity mapping

Standwise mentions people in Slack by matching the primary verified email of their GitHub account with the email of their Slack user. When the emails differ, map the person by hand under the top-level `members` key, using their GitHub login:

```yaml
teams:
  - name: backend
    timezone: America/Sao_Paulo
    remind_at: "09:30"
    digest_at: "10:00"
    managers: [alice]
    members: [alice, bob]
    chat:
      provider: slack
      channel: "#daily-backend"
members:
  bob: { slack: U0456 }
```

| Key | Used today | Value |
| --- | --- | --- |
| `slack` | yes | Slack member id, such as `U0456`. In Slack, open the person's profile, click the three dots and **Copy member ID**. |
| `google_chat` | coming soon | Google Chat user |
| `linear` | coming soon | Linear user email |
| `jira` | coming soon | Jira account |

A `slack` mapping is used from the next digest on, even for people who have never signed in. People without a mapping are linked by email when they sign in with `standwise login` or on the setup page. If you connect a different Slack workspace, the email links are cleared and made again at the next sign-in.

## Common validation errors

These are the messages the setup page shows, as `path: message`. `teams.0` is the first team, `teams.1` the second, and so on.

| Message | Cause | Fix |
| --- | --- | --- |
| `teams.0.digest_at: must be HH:MM (24h)` | A time like `"9:30"`, `"10h"` or `"25:00"` | Use two digits and 24 hours: `"09:30"` |
| `teams.0.digest_at: Invalid input: expected string, received undefined` | `digest_at` is missing (same for `remind_at`, `timezone`, `name`) | Add the key |
| `teams.0.timezone: unknown IANA timezone` | `Brasilia`, `BRT`, `GMT-3` | Use a name like `America/Sao_Paulo` |
| `teams.0.workdays.0: Invalid option: expected one of "mon"\|"tue"\|"wed"\|"thu"\|"fri"\|"sat"\|"sun"` | `monday`, `Mon`, `seg` | Use the three-letter lowercase English names |
| `teams.0.workdays: Too small: expected array to have >=1 items` | `workdays: []` | List at least one day, or remove the key |
| `teams.0.language: Invalid option: expected one of "pt-BR"\|"en"` | `pt`, `pt_BR`, `english` | Use `pt-BR` or `en` |
| `teams.0.chat.provider: Invalid option: expected one of "slack"\|"google-chat"` | `teams`, `Slack` | Use `slack` |
| `teams.0.members: Too small: expected array to have >=1 items` | `members: []` (same for `managers`) | List at least one person |
| `teams.0.managers.0: managers must be GitHub logins, not teams or @-prefixed names` | `managers: ["@acme/leads"]` | List the logins, such as `[alice, bob]` |
| `teams.0: Unrecognized key: "reminder"` | A misspelled or unknown key | Check the key against the tables above |
| `members.alice.slack: must be a Slack user id like U0123ABCD` | A name, an email, a channel id or `<!channel>` | Use the member id, which starts with `U` or `W` |
| `members.alice: Unrecognized key: "slak"` | A misspelled identity key | Use `slack`, `google_chat`, `linear` or `jira` |
| `teams.1.name: duplicate team name "backend"` | Two teams with the same name | Rename one of them |
| `teams.0.signals.pr_review_hours: Too small: expected number to be >0` | `0` or a negative number | Use a positive number |
| `teams: Too small: expected array to have >=1 items` | `teams: []` | Add a team |
| `: Invalid input: expected object, received null` | The file is empty | Add at least one team |
| A YAML syntax message with a line and column | Broken indentation, an unclosed `[` or quote | Fix the YAML at that line |

While the file is invalid, Standwise keeps using the last valid version until you fix it. See [Configuration states](/admin/install#configuration-states).
