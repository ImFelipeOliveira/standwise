# Privacy

What Standwise reads, what it stores, what it never does and who sees what. This page describes the service as it runs today.

## No AI on our side

No LLM processes your data on the Standwise servers. The draft is built with plain GitHub searches, and the digest is assembled from what people confirmed. When you write your daily with an AI agent, that agent runs on your machine, under your own account with its provider. Standwise does not see that conversation.

## What Standwise reads

### GitHub

Standwise uses the permissions of its GitHub App: Metadata (read), Contents (read), Pull requests (read), Checks (write), Commit statuses (read), Members (read) and the account permission Email addresses (read). With them it reads:

- `standwise.yml` from the `.github` repository of the installation owner;
- the members of the GitHub teams you reference in `standwise.yml` (`@org/team`);
- organization membership and role, to check who belongs to the organization and who is an admin;
- for the person asking for a draft: titles, links, repositories and dates of the pull requests they opened, merged and reviewed, and of the commits they authored, in the organization;
- when you sign in: your GitHub user id, your login, your primary verified email and the installations you can access.

It does not read the contents of your code or your files other than `standwise.yml`. Checks (write) is reserved for the configuration check run, which is coming soon. Standwise does not write to your repositories.

### Slack

The bot token of the Slack app lets Standwise:

- look up a Slack user by email, to mention people in the digest;
- list channels, to turn `#channel` into a channel id;
- post the digest and the replies in its thread.

It does not read messages in any channel or conversation.

### Linear and Jira <Badge type="info" text="coming soon" />

Standwise does not connect to Linear or Jira yet, so it reads nothing from them.

## What Standwise stores

| Data | What is kept | Protection |
| --- | --- | --- |
| Installation | GitHub installation id, account login, type and id, configuration status, the parsed `standwise.yml` and its validation errors | |
| Person | GitHub user id, login and primary verified email | |
| Organization membership | Which installations each person belongs to | |
| Slack identity | The Slack user id of each person, per installation | |
| Slack connection | Workspace id and name, and the bot token | Bot token encrypted with AES-256-GCM |
| Sessions | A SHA-256 hash of each CLI and web session token, its kind and when it was created and last used | Only the hash; the token itself is never stored |
| Dailies | Date, submission time, the yesterday, today and blocker items with their links, and whether the person (`human`) or the agent (`agent`) confirmed it | |
| Deliveries | For each digest and late daily: team, date, status, attempts, the Slack channel and message id, and the error if it failed | |
| API keys | Name, the first 8 characters after `swk_`, scopes, who created it, creation, last use and revocation times | Only a SHA-256 hash of the secret |
| Webhook endpoints | URL, events, status and failure count | Signing secret encrypted with AES-256-GCM |
| Webhook deliveries | The event payload sent (which can contain daily text), status, attempts, last response code or error | |
| Rate limits | A counter per credential or IP address per minute | Rows are deleted after about 10 minutes |

The GitHub token from your login is used once to identify you and is not stored. Encryption keys live in the server environment, not in the database.

## What Standwise never does

- Sends a daily without the person's explicit confirmation.
- Shows anyone a draft or a suggestion that the person did not confirm.
- Computes rankings, scores, productivity metrics or per-person aggregates.
- Reads your code, your Slack messages or your direct messages.
- Writes to your repositories.
- Sends your data to an AI model.
- Sells or shares your data with third parties.

## Who sees what

| Who | Sees |
| --- | --- |
| You | Your draft and your own dailies, through your agent |
| Members of the team's Slack channel | The digest and the late dailies in its thread |
| Team managers | The team's digests, dailies and confirmed blockers for the last 90 days, through the MCP manager tools |
| Organization admins | Everything managers see, for every team; on the setup page, the Slack connect and reconnect controls, API keys and webhooks |
| Organization members who sign in to the setup page | Configuration status, the Slack workspace name, read-only, and the last failed deliveries. They cannot connect or replace the Slack workspace |
| Systems with an API key | Teams, confirmed dailies, digests and blockers, limited by the key's scopes |
| Webhook endpoints | The events they subscribed to |

## Retention

Standwise does not delete dailies on a schedule today. Dailies, deliveries and webhook deliveries stay while the app is installed. Rate limit counters are deleted after about 10 minutes. CLI sessions stop working after 90 days without use, and web sessions after 7 days.

## Removing your data

- **Uninstall the GitHub App.** Standwise deletes the installation and everything that belongs to it: configuration, dailies, deliveries, Slack connection and identities, API keys, webhook endpoints and their deliveries.
- **Sign out.** `standwise logout` revokes your CLI session on the server and deletes the local credentials file.
- **Your person record.** Your GitHub user id, login and email are not tied to one installation, so uninstalling does not remove them. To delete them, email support.

## Contact

Questions or deletion requests: <SupportEmail />.
