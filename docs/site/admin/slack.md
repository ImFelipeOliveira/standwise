# Slack

Standcast posts each team's digest to a Slack channel. One Slack workspace is connected per installation.

## Connect

Only an organization admin can connect or reconnect Slack: a GitHub organization admin, or the account owner for a personal account. Standcast checks the role with GitHub when the connection starts and again when Slack sends the admin back. Other members see the connection on the setup page read-only.

On the setup page, click **Connect Slack** and approve the app. The Slack step then shows "Connected to" and the workspace name.

To connect again, for example after the app was removed from Slack or to move the digests to another workspace, click **Reconnect Slack** on the setup page. It goes through the same approval and replaces the previous connection.

## Bot permissions

| Scope | Why |
| --- | --- |
| `chat:write` | Post the digest and the late dailies in its thread |
| `chat:write.public` | Post in public channels without being invited |
| `channels:read` | Turn a public `#channel` name into its id |
| `groups:read` | Turn a private `#channel` name into its id, for private channels the bot was invited to |
| `users:read` | Look up Slack users |
| `users:read.email` | Find a person's Slack user by their email, to mention them |
| `im:write` | Send direct messages: reminders, routed blockers and suggested blockers |

Standcast does not read messages.

## Channels

Set the channel in `standcast.yml` under `chat.channel`:

- `"#daily-backend"`: a channel name. Quote it.
- `C0123456789`: a channel id. In Slack, open the channel details; the id is at the bottom.

**Public channels** work right away: the bot posts without being invited.

**Private channels** need the bot as a member. In the channel, run `/invite` and pick the Standcast app, or add it from the channel details under **Integrations**. Until then, the digest fails with `channel_not_found`.

Archived channels are not found.

When Slack is connected, the setup page checks each team's channel and warns on the team's card when the channel is not found or the bot is not in a private channel, so you can fix it before `digest_at`.

## How people are mentioned

The digest mentions each person with their Slack user when Standcast knows it, and shows `@` followed by their GitHub login as plain text otherwise. A person is linked to their Slack user when they sign in (with `standcast login` or on the setup page), if Slack is already connected and `standcast.yml` has a valid version:

1. If `standcast.yml` has `members.<login>.slack`, that id is used.
2. Otherwise, Standcast looks up the Slack user with the primary verified email of the person's GitHub account.

If neither works, the digest still goes out with `@login`. To fix it, see [My name shows as @login](/troubleshooting#my-name-shows-as-login).

## Delivery errors

When a post fails, the setup page lists it under "Latest failed deliveries" with the team, the date and the error as `code: message`. Standcast tries each message up to 3 times in total. A digest is retried only within 120 minutes after `digest_at`. A reminder is sent at most 60 minutes late and never at or after `digest_at`.

| Error code | Meaning | Fix |
| --- | --- | --- |
| `channel_not_found` | The channel name does not exist, is archived, or is private and the bot is not in it. | Check `chat.channel`. For a private channel, invite the bot. |
| `not_in_channel` | The bot is not a member of the channel. | Invite the bot to the channel. |
| `is_archived` | The channel is archived. | Unarchive it or pick another channel. |
| `invalid_auth`, `token_revoked`, `account_inactive` | The Slack token no longer works, usually because the app was removed from the workspace. | An admin clicks **Reconnect Slack**. |
| `missing_scope` | The token lacks a permission Standcast needs. | An admin clicks **Reconnect Slack** and approves all permissions. |
| `ratelimited` | Slack asked Standcast to slow down. | Nothing to do; it is retried. |
| `no_chat_connection` | Slack is not connected for this installation. | An admin clicks **Connect Slack** on the setup page. |
| `no_chat_identity` | A reminder or routed blocker could not be sent because the person, or the manager it fell back to, has no Slack user. The setup page shows their login. | Ask the person to run `standcast login` after Slack is connected, or add `members.<login>.slack` to `standcast.yml`. |
| `no_route_target` | A blocker was reported but there was no recipient at all, for example because the author is the team's only manager. | Add another manager to the team. |
| `unsupported_provider` | The team uses `chat.provider: google-chat`, which is coming soon. | Use `slack`. |
| `worker_died` | The worker stopped three times while sending. | Contact support if it repeats. |
| `internal_error` | Unexpected error. The message has the details. | Contact support if it repeats. |

After you fix the cause, the next day's digest goes out normally. A digest that already used its 3 attempts is not sent again for that day.
