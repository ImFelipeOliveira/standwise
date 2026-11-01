# Concepts

The terms used across Standcast and these docs.

## Installation

One installation of the Standcast GitHub App on a GitHub organization or personal account. Everything in Standcast belongs to one installation: configuration, dailies, the Slack connection, API keys and webhooks. Data never crosses installations.

## Organization

The GitHub organization (or personal account) where the app is installed. The CLI and the MCP tools call it `org` and use its GitHub login, for example `acme`.

## Team

A group of people declared under `teams` in `standcast.yml`. Each team has its own time zone, workdays, digest time, language and Slack channel. See the [standcast.yml reference](/admin/configuration).

## Member

A person listed under `members` of a team, by GitHub login or through a GitHub team (`@acme/backend`). Members write dailies. A person can be in several teams.

## Manager

A GitHub login listed under `managers` of a team. Managers read their team's digests, dailies and blockers through the [manager tools](/members/mcp#manager-tools) of the MCP server. Blockers with no one else to route to go to the managers.

## Admin

The owner of a personal account, or a member with the `admin` role in the GitHub organization. Admins connect Slack and create [API keys](/admin/api-keys) and [webhooks](/admin/webhooks), and can read every team through the manager tools.

## Daily

One person's standup for one date, in one organization. It has three lists:

- **Yesterday:** what the person did since their last daily.
- **Today:** what they plan to do. At least one item.
- **Blockers:** what stops them. Can be empty.

Each item is a line of text, optionally linked to a pull request, issue, commit or card. Sending again on the same day replaces the previous daily. A single daily shows up in the digest of every team the person is in.

## Standup date

The date a daily counts for. It is today in the time zone of the person's first team (the first team in `standcast.yml` that lists them). On a day that is not a workday, the daily counts for the next workday: a daily sent on Saturday counts for Monday.

## Draft

The starting point for "yesterday", built by Standcast from the person's GitHub activity in the organization since their last daily: pull requests opened, pull requests merged, reviews and commits, plus your own Linear cards that started or finished, when Linear is connected. The agent shows it, and the person keeps, edits or removes each item.

## Digest

One Slack message per team per workday, posted at the team's `digest_at`. Blockers come first, then each person's daily, then the list of people who did not send it.

## Late daily

A daily sent after the team's digest was posted. It goes as a reply in the digest thread, once per person per day.

## Confirmation

Standcast sends a daily only after the person confirms it. With MCP clients that support it, Standcast asks the person directly; otherwise the agent must ask. See [the confirmation rule](/members/mcp#the-confirmation-rule).

## Reminder

A direct message at the team's `remind_at` to people who have not sent the daily. At most one per person per day, and only before the digest.

## Suggested blocker

A blocker Standcast notices for you: your pull request with no review for `pr_review_hours`, failing CI on it for 24 hours, or one of your Linear cards in progress for `card_stale_days`. It goes only to you, in your draft. Your manager sees it only if you confirm it in your daily.

## Blocker routing

Sending each new blocker once to whoever can help: the reviewers of the linked pull request, then its CODEOWNERS, then the team managers. For a Linear card: the assignees of the cards that block it, then its assignee, then its creator, then the managers.

## Linear connection

One connection per installation, made by an admin on the setup page. It lets Standcast read cards of one Linear workspace, read-only. See [Install](/admin/install#5-connect-linear-optional).

## Delivery

One attempt to send a message to Slack: a digest, a late daily, a reminder or a blocker routed by direct message. Each one is recorded once per team, date and kind, so a retry never posts twice. Failed deliveries show up on the setup page with the error.

## API key

A secret starting with `sck_` that an admin creates on the setup page, with read-only scopes, for other systems to read the organization's confirmed dailies, digests and blockers. See [API keys](/admin/api-keys).

## Webhook

An HTTPS endpoint an admin registers to receive signed events: `daily.submitted`, `blocker.opened` and `digest.sent`. See [Webhooks](/admin/webhooks).

## Session

What `standcast login` stores on your machine after you sign in with GitHub. It starts with `sc_`, is used by the CLI, the skill and the MCP server, and expires after 90 days without use.
