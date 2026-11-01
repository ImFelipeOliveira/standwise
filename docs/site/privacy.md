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
- for suggested blockers and blocker routing, on pull requests of the organization: title, url, draft state, the time it was ready for review, review states (only counted), the conclusions of check runs on the head commit, the paths of changed files (only to find code owners) and the `CODEOWNERS` file;
- when you sign in: your GitHub user id, your login, your primary verified email and the installations you can access.

It does not read the contents of your code or your files other than `standwise.yml` and `CODEOWNERS`. Checks (write) is used only to create the `Standwise config` check run on `standwise.yml`. Standwise does not write to your repositories.

### Slack

The bot token of the Slack app lets Standwise:

- look up a Slack user by email, to mention people in the digest;
- list channels, to turn `#channel` into a channel id;
- post the digest and the replies in its thread;
- send direct messages: reminders, routed blockers and, if the team enables `signals.direct_message`, suggested blockers.

It does not read messages in any channel or conversation.

### Linear

If an admin connects Linear, Standwise uses an OAuth app that acts as itself (`actor=app`) with the read-only scope `read`, for one Linear workspace per installation. It reads:

- for the person asking for the draft and for the card signals: the issue identifier, title, url, state type, started and completed dates, assignee, creator, the "blocks" relations and the team key;
- to route a card blocker: the assignee and the creator of the referenced card, and the assignees of the cards blocking it, only to find who to notify;
- the email of Linear users, only to link people to their Linear user.

It never reads descriptions or comments, and it never writes to Linear. Cards from another workspace are never read. A person's own cards show only in their own draft and are never used to measure people.

### Jira <Badge type="info" text="coming soon" />

Standwise does not connect to Jira yet, so it reads nothing from it.

## What Standwise stores

| Data | What is kept | Protection |
| --- | --- | --- |
| Installation | GitHub installation id, account login, type and id, configuration status, the parsed `standwise.yml` and its validation errors | |
| Person | GitHub user id, login and primary verified email | |
| Organization membership | Which installations each person belongs to | |
| Slack identity | The Slack user id of each person, per installation | |
| Slack connection | Workspace id and name, and the bot token | Bot token encrypted with AES-256-GCM |
| Linear connection | Workspace id, name and URL key, and the access and refresh tokens | Tokens encrypted with AES-256-GCM |
| Linear identity | The Linear user id of each person, per installation. The email is never stored | |
| Sessions | A SHA-256 hash of each CLI and web session token, its kind and when it was created and last used | Only the hash; the token itself is never stored |
| Dailies | Date, submission time, the yesterday, today and blocker items with their links, and whether the person (`human`) or the agent (`agent`) confirmed it | |
| Suggestions | For each suggested blocker: the pull request link and title (or the card link and title), the kind, when it was noticed and your decision | Visible only to you |
| Deliveries | For each digest, late daily, reminder and routed blocker: team, date, status, attempts, the Slack channel and message id, and the error if it failed | |
| API keys | Name, the first 8 characters after `swk_`, scopes, who created it, creation, last use and revocation times | Only a SHA-256 hash of the secret |
| Webhook endpoints | URL, events, status and failure count | Signing secret encrypted with AES-256-GCM |
| Webhook deliveries | The event payload sent (which can contain daily text), status, attempts, last response code or error | |
| Rate limits | A counter per credential or IP address per minute | Rows are deleted after about 10 minutes |

The GitHub token from your login is used once to identify you and is not stored. Encryption keys live in the server environment, not in the database.

## Beta requests

When someone asks for beta access on the Standwise landing page, the form collects a name, a work email, the team size, the chat and the tracker the team uses, and the language of the page. This is separate from installing the app and from the data above.

- **Why:** to contact the team after they install, and to check it is going well.
- **Where it goes:** it is stored by Standwise and emailed to the Standwise support inbox through Resend, an email provider. It is never shared otherwise.
- **How long:** it is deleted 12 months after the request.
- **Earlier deletion:** email <SupportEmail /> and the request is deleted sooner.

## What Standwise never does

- Sends a daily without the person's explicit confirmation.
- Shows anyone a draft or a suggestion that the person did not confirm.
- Shows a suggested blocker to anyone but the person, in the digest, the organization or manager tools, webhooks or the setup page.
- Computes rankings, scores, productivity metrics or per-person aggregates.
- Reads your code, your Slack messages or your direct messages.
- Writes to your repositories.
- Sends your data to an AI model.
- Sells your data, or shares it with anyone other than the providers that run the service (such as Resend, for beta request emails).

## Who sees what

| Who | Sees |
| --- | --- |
| You | Your draft, your suggested blockers and your own dailies, through your agent |
| Members of the team's Slack channel | The digest and the late dailies in its thread |
| Team managers | The team's digests, dailies and confirmed blockers for the last 90 days, through the MCP manager tools |
| Organization admins | Everything managers see, for every team; on the setup page, the Slack connect and reconnect controls, API keys and webhooks |
| Organization members who sign in to the setup page | Configuration status, the Slack workspace name, read-only, and the last failed deliveries: team messages one by one, and direct messages grouped by kind and error, with the recipient's login only when they have no Slack identity. Never blocker text or suggestions. They cannot connect or replace the Slack workspace |
| Systems with an API key | Teams, confirmed dailies, digests and blockers, limited by the key's scopes |
| Webhook endpoints | The events they subscribed to |

## Retention

Standwise does not delete dailies on a schedule today. Dailies and digest deliveries stay while the app is installed. Some data is removed automatically:

- outgoing webhook delivery logs: after 30 days;
- expired sessions: removed;
- resolved suggestions, those whose signal went away: after 90 days;
- delivery records about one person (reminders, routed blockers, suggestion DMs and scan markers): after 90 days;
- ignored and confirmed suggestions are kept, so they do not come back;
- rate limit counters: after about 10 minutes.

CLI sessions stop working after 90 days without use, and web sessions after 7 days.

## Removing your data

- **Uninstall the GitHub App.** Standwise deletes the installation and everything that belongs to it: configuration, dailies, deliveries, Slack connection and identities, API keys, webhook endpoints and their deliveries.
- **Sign out.** `standwise logout` revokes your CLI session on the server and deletes the local credentials file.
- **Your person record.** Your GitHub user id, login and email are not tied to one installation, so uninstalling does not remove them. To delete them, email support.

## Contact

Questions or deletion requests: <SupportEmail />.
