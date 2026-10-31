# How it works

A day in the life of a team, with this configuration:

```text
team backend · timezone America/Sao_Paulo · workdays mon–fri
remind_at 09:30 · digest_at 10:00 · channel #daily-backend
```

## 08:50 · Alice drafts her daily

Alice runs `/daily` in Claude Code. The skill asks Standwise for a draft. Standwise looks at Alice's GitHub activity in the organization since her last daily:

- pull requests she opened;
- pull requests she merged;
- pull requests she reviewed (not her own);
- commits she authored, grouped by repository.

The window starts when she sent her last daily, if that was on or after the previous workday. Otherwise it starts at midnight of the previous workday. On Monday, the previous workday is Friday, so the weekend is covered. The draft has up to 50 items, newest first.

Alice edits yesterday, writes today and one blocker, and confirms. Standwise stores the daily for today's date. She can send it again until the digest goes out: the last version wins.

## 09:30 · Reminder

At `remind_at`, in the team's time zone and only on workdays, people who have not sent the daily get a direct message in Slack. The message says when their digest goes out. It is the earliest pending digest if the person is in several teams.

- At most one reminder per person per day, even across several teams.
- It is sent only while `remind_at` has passed and `digest_at` has not. If the worker was down, it can still go out up to 60 minutes after `remind_at`, but never at or after `digest_at`, and never once the team's digest has been posted.
- People without a Slack identity get the failed delivery `no_chat_identity` on the setup page. See [Slack](/admin/slack#delivery-errors).
- `remind_at` must be before `digest_at`, otherwise the file is invalid.

## 10:00 · The digest

At `digest_at`, in the team's time zone and only on workdays, Standwise posts one message to `#daily-backend`:

1. the title, with the team and the date;
2. **Blockers**, with who reported each one;
3. each person's yesterday and today, in the order of `members` in `standwise.yml`;
4. the people who did not send the daily.

People are mentioned in Slack when Standwise knows their Slack user. Otherwise they appear as `@` followed by their GitHub login, as plain text. See [Slack](/admin/slack#how-people-are-mentioned).

There is exactly one digest per team per day. If the worker is down at 10:00, the digest goes out when it comes back, as long as that is within 120 minutes. After 12:00 it is skipped for that day. A failed post is retried up to 3 attempts in total, and the error shows up on the setup page.

## 10:40 · Bob sends a late daily

Bob sends his daily after the digest. Standwise replies in the digest thread with his daily. The CLI and the MCP tools tell him `late: true`.

Only the first late daily of the day goes to the thread. If Bob sends again, Standwise stores the new version and sends the webhook, but does not post a second reply.

## Blocker routing

Each new blocker in a submitted daily is sent once by direct message to whoever can help, in this order:

1. A pull request link in your own organization goes to the requested reviewers and the members of requested teams. With none of those, it goes to the CODEOWNERS of the files changed in the pull request, at its base branch, with teams expanded to their members.
2. A card link will go to whoever owns the blocking card. This needs the Linear integration, which is coming soon, so today it falls through to the next step.
3. Otherwise, the managers of the author's first team.

Rules:

- The author never receives their own blocker, and at most 5 people get it.
- If none of the people found has a Slack identity, or GitHub could not be read, the blocker goes to the managers.
- Pull requests from other organizations are not read, and go to the managers.
- A blocker with a link is identified by the link, so rewording it or sending the daily again does not send it again. Without a link, the text identifies it. At most 10 different blockers per daily are routed.
- The message says why the person got it: requested reviewer, code owner, card owner or team manager.
- The message has only who reported it, the blocker text, the link and the date. It never includes the rest of the daily.
- If there is no recipient at all, for example when the author is the team's only manager, the failed delivery `no_route_target` shows on the setup page. A manager without a Slack identity shows as `no_chat_identity`.

Blockers also appear at the top of the digest, in the `blocker.opened` webhook and in the manager tools.

## Suggested blockers

Standwise can notice blockers you may have missed. There are two signals:

- your own open pull request, not a draft, with no review for `pr_review_hours` (default 48) since it was ready for review;
- failing CI on the head commit of your pull request for 24 hours.

They are checked about an hour before `remind_at`, and in real time when a pull request, review or check suite changes. Only people who have signed in at least once get them.

A suggestion shows only to you, in your draft. It never appears in the digest, the organization or manager tools, webhooks or the setup page. Your manager sees a blocker only after you put it in your daily. With `signals.direct_message: true` (default `false`) you also get a direct message, once per suggestion.

To answer:

- **Confirm:** add it to your blockers with its link. Submitting the daily confirms it. From a terminal, `standwise suggestion confirm <id>`.
- **Ignore:** `standwise suggestion ignore <id>`, the MCP tool `standwise_decide_suggestion`, or answer when the `/daily` skill asks you.

An ignored suggestion comes back only if the signal changes: a new head commit that is still failing, or a new period without review, after a review is dismissed or the pull request is marked ready for review again. The agent never adds a suggestion without your answer. See [CLI](/members/cli#standwise-suggestion).

## Time zones, workdays and several teams

- **All times are in the team's time zone.** `remind_at` and `digest_at` are local times, `HH:MM`, 24 hours.
- **Digests run only on workdays.** With `workdays: [mon, tue, wed, thu, fri]`, there is no digest on Saturday or Sunday.
- **The standup date follows your first team.** "Today" and "previous workday" use the time zone and workdays of the first team in `standwise.yml` that lists you. A daily sent on a day off counts for the next workday.
- **One daily, every team.** If you are in two teams, your daily appears in both digests. You write it once.
- **One daily per organization.** If you belong to two organizations that use Standwise, you write one daily for each. The CLI and the MCP tools ask which one, or take `--org` / `org`.
- **Changing the file.** Standwise reloads `standwise.yml` on every push to the default branch of the `.github` repository, force pushes included. If a push makes the file invalid, Standwise keeps using the last valid version until you fix it: digests still go out, and drafts and submissions still work. Deleting the file switches Standwise off for the organization. Without a valid version in use, drafts and submissions get `org_not_configured`. See [Install](/admin/install#configuration-states).
- **Checking the file before it lands.** When a push to any branch of `.github` touches `standwise.yml`, or a pull request in `.github` changes it, Standwise creates a check run named `Standwise config`. See [Install](/admin/install#configuration-states).
