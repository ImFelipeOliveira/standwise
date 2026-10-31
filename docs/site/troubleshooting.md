# Troubleshooting

The most common problems and how to fix them. If none of these helps, email <SupportEmail />.

## I did not get a reminder

Reminders go only to people who have not sent the daily, at most once per day, at `remind_at` and before `digest_at`. If the worker was down, a reminder can be up to 60 minutes late, but it is never sent at or after `digest_at`. Check that you did not send the daily already, that today is a workday in the team's `workdays`, and that the setup page has no `no_chat_identity` delivery for you.

## `no_chat_identity`

Standwise has no Slack user for you, so it cannot send you a reminder or a routed blocker. The failed delivery shows on the setup page. Sign in again with `standwise login` after Slack was connected, or ask your admin to add `members.<your-login>.slack` to `standwise.yml`. See [My name shows as @login](#my-name-shows-as-login).

## `no_route_target`

A blocker was reported but there was nobody to send it to at all. This happens, for example, when the author is the team's only manager: the author never receives their own blocker, so the list of recipients is empty. Ask your admin to add another manager to the team, then tell the right people by hand. A manager who exists but has no Slack identity shows as `no_chat_identity` with their login instead.

## Nobody received my blocker

1. **Blockers are routed once.** A blocker with a link is identified by the link: rewording it, or sending the daily again, does not send it again. A blocker without a link is identified by its text. At most 10 different blockers per daily are routed.
2. **The link decides.** A pull request in your own organization goes to its requested reviewers, then its CODEOWNERS. A link to another organization, a malformed link or a missing pull request goes to the managers. Without a link, it goes to the managers.
3. **You are never a recipient** of your own blocker.
4. **People need a Slack identity.** If none of the people found has one, the blocker goes to the managers. A manager without one shows on the setup page as `no_chat_identity` with their login. If there is no manager to send it to at all, the setup page shows `no_route_target`.

## My name shows as @login

The digest shows `@` and your GitHub login, as plain text, when Standwise does not know your Slack user. Your Slack user is linked when you sign in, so check:

1. **You signed in after Slack was connected.** Run `standwise login` again.
2. **`standwise.yml` had a valid version when you signed in.** If it was missing or had never been valid, run `standwise login` again after it is fixed.
3. **Your emails match.** Standwise looks up your Slack user by the primary verified email of your GitHub account. If your Slack account uses another email, ask your admin to add `members.<your-login>.slack` with your Slack member id to `standwise.yml` (see [Identity mapping](/admin/configuration#identity-mapping)). The mapping is used from the next digest on.

## The setup page shows "Reconnect Linear"

Linear stopped accepting the connection, usually because access was revoked in the Linear workspace. Ask an admin to click **Reconnect Linear** on the setup page. Until then Linear features pause silently: drafts have no cards, card blockers go to the managers, and card suggestions are kept as they are. If the admin reconnects a different workspace, the Linear links are cleared and made again when people sign in.

## My cards do not show in the draft

1. **Linear is connected.** Check the setup page. If it says "Reconnect Linear", reconnect.
2. **The team uses Linear.** Check `tracker: { provider: linear, team: <KEY> }` in `standwise.yml`. The team key limits the cards to that Linear team.
3. **You are linked to your Linear user.** Standwise uses `members.<your-login>.linear` (an email) or, without it, your primary verified GitHub email. If your Linear email is different, ask your admin to set `members.<your-login>.linear`. Links are made when you sign in after Linear is connected, so run `standwise login` again.
4. **The card moved in the window.** Only cards you own that moved to in progress, or were completed, since your last daily show up. Cards from another Linear workspace are never read.

## The digest did not arrive

Open the setup page and check, in order:

1. **The configuration state.** If it is not configured, or invalid with no valid version in use, Standwise does not run. If it is invalid after a valid version, Standwise keeps using the last valid version, so a change you just pushed is not applied yet. See [Configuration states](/admin/install#configuration-states).
2. **Slack is connected.** Otherwise the delivery fails with `no_chat_connection`. Only an admin can connect Slack.
3. **"Latest failed deliveries"** for the team and date. The error code tells what happened; see [Delivery errors](/admin/slack#delivery-errors). A private channel needs the bot invited, or the error is `channel_not_found`.
4. **Today is a workday** in the team's `workdays`, and `digest_at` is in the team's `timezone`. A digest is not sent more than 120 minutes after `digest_at`.
5. **The team uses `chat.provider: slack`.** Google Chat is coming soon.

## "More than one organization" or exit code 3

You belong to more than one organization with Standwise. Pass `--org` to the CLI (for example `standwise draft --org acme`) or tell your agent which organization to use. If the message says no organization has Standwise installed, see the next problem.

## My organization is missing, or `org_not_found`

Your saved session lists the organizations from when you signed in. If the app was installed in your organization after that, or you just joined it, run `standwise login` again. If it still fails, check that you are a member of the organization on GitHub.

## `org_not_configured`

The organization has no valid `standwise.yml` in use: the file is missing, or it has been invalid since it was created or since it was deleted. An invalid push right after a valid version does not cause this error, because Standwise keeps using the last valid version. Ask your admin to check the setup page.

## `not_in_team`

You are not in any team of `standwise.yml`. Ask your admin to add your GitHub login, or a GitHub team you belong to, to `members`.

## My token expired, or exit code 2

The CLI session expired (after 90 days without use) or was revoked. Run:

```bash
standwise login
```

If the message says the stored credentials belong to another API, you are using a different API URL than the one you signed in with. Sign in again with that URL: `standwise login --api-url <url>`.

## The daily is invalid, or exit code 4

Each item must be one line of 1 to 500 characters, with no tabs or control characters, and `today` needs at least one item. Link URLs must use `http` or `https`. The message lists each issue by field, such as `today: Too small: expected array to have >=1 items`.

## `rate_limited`

You sent too many requests in a minute. Wait the number of seconds in the message and try again.

## My API key gets 401 or 403

- `401 unauthorized`: the key is missing, mistyped or revoked. API keys work only under `/v1/org`.
- `403 insufficient_scope`: the key lacks the scope named in `required_scope`. Create a key with that scope.

## My webhook endpoint was disabled

It failed 20 deliveries in a row. Fix the receiver, add the endpoint again on the setup page and use the new secret. Use **Send test event** to check it. See [Webhooks](/admin/webhooks).

## The `Standwise config` check failed

A push or pull request in the `.github` repository changed `standwise.yml` and it has errors. Open the check: each error is an annotation on its line, and the summary lists all of them. Fix them and push again. The last valid version stays in effect meanwhile. If the file does not exist, there is no check.
