# Concepts

The terms used across Standwise and these docs.

## Installation

One installation of the Standwise GitHub App on a GitHub organization or personal account. Everything in Standwise belongs to one installation: configuration, dailies, the Slack connection, API keys and webhooks. Data never crosses installations.

## Organization

The GitHub organization (or personal account) where the app is installed. The CLI and the MCP tools call it `org` and use its GitHub login, for example `acme`.

## Team

A group of people declared under `teams` in `standwise.yml`. Each team has its own time zone, workdays, digest time, language and Slack channel. See the [standwise.yml reference](/admin/configuration).

## Member

A person listed under `members` of a team, by GitHub login or through a GitHub team (`@acme/backend`). Members write dailies. A person can be in several teams.

## Manager

A GitHub login listed under `managers` of a team. Managers read their team's digests, dailies and blockers through the [manager tools](/members/mcp#manager-tools) of the MCP server. Coming soon: blockers with no one else to route to will go to the manager.

## Admin

The owner of a personal account, or a member with the `admin` role in the GitHub organization. Admins create [API keys](/admin/api-keys) and [webhooks](/admin/webhooks), and can read every team through the manager tools.

## Daily

One person's standup for one date, in one organization. It has three lists:

- **Yesterday:** what the person did since their last daily.
- **Today:** what they plan to do. At least one item.
- **Blockers:** what stops them. Can be empty.

Each item is a line of text, optionally linked to a pull request, issue, commit or card. Sending again on the same day replaces the previous daily. A single daily shows up in the digest of every team the person is in.

## Standup date

The date a daily counts for. It is today in the time zone of the person's first team (the first team in `standwise.yml` that lists them). On a day that is not a workday, the daily counts for the next workday: a daily sent on Saturday counts for Monday.

## Draft

The starting point for "yesterday", built by Standwise from the person's GitHub activity in the organization since their last daily: pull requests opened, pull requests merged, reviews and commits. The agent shows it, and the person keeps, edits or removes each item.

## Digest

One Slack message per team per workday, posted at the team's `digest_at`. Blockers come first, then each person's daily, then the list of people who did not send it.

## Late daily

A daily sent after the team's digest was posted. It goes as a reply in the digest thread, once per person per day.

## Confirmation

Standwise sends a daily only after the person confirms it. With MCP clients that support it, Standwise asks the person directly; otherwise the agent must ask. See [the confirmation rule](/members/mcp#the-confirmation-rule).

## Reminder <Badge type="info" text="coming soon" />

A direct message at the team's `remind_at` to people who have not sent the daily. At most one per person per day. The `remind_at` key is already required in `standwise.yml`.

## Suggested blocker <Badge type="info" text="coming soon" />

A blocker Standwise notices for you, such as your pull request waiting for review for more than `pr_review_hours`. It goes only to you, first. Your manager sees it only if you confirm it in your daily.

## Blocker routing <Badge type="info" text="coming soon" />

Sending each blocker to whoever can help: the reviewers of the linked pull request, the owner of the blocking card or, failing those, the team manager.

## Delivery

One attempt to post a message to Slack: a digest or a late daily. Each one is recorded once per team, date and kind, so a retry never posts twice. Failed deliveries show up on the setup page with the error.

## API key

A secret starting with `swk_` that an admin creates on the setup page, with read-only scopes, for other systems to read the organization's confirmed dailies, digests and blockers. See [API keys](/admin/api-keys).

## Webhook

An HTTPS endpoint an admin registers to receive signed events: `daily.submitted`, `blocker.opened` and `digest.sent`. See [Webhooks](/admin/webhooks).

## Session

What `standwise login` stores on your machine after you sign in with GitHub. It starts with `sw_`, is used by the CLI, the skill and the MCP server, and expires after 90 days without use.
