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

## 09:30 · Reminder <Badge type="info" text="coming soon" />

Coming soon: at `remind_at`, people who have not sent the daily get a direct message in Slack, at most once per day. Today, `remind_at` is validated but nothing is sent.

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

## Blocker routing <Badge type="info" text="coming soon" />

Coming soon: when a daily has a blocker, Standwise will send a direct message to whoever can help, in this order:

1. a blocker linked to a pull request goes to the requested reviewers, or to the CODEOWNERS of the changed files when there are no reviewers;
2. a blocker linked to a card goes to the owner of the card it depends on ("blocked by"), or to the card's owner or creator;
3. otherwise, to the team managers.

Today, blockers appear at the top of the digest, in the `blocker.opened` webhook and in the manager tools.

## Suggested blockers <Badge type="info" text="coming soon" />

Coming soon: Standwise will suggest blockers you may have missed, such as a pull request with no review for more than `pr_review_hours` or a card in progress for more than `card_stale_days`. Suggestions go only to you. Today the draft always returns an empty `suggestions` list.

## Time zones, workdays and several teams

- **All times are in the team's time zone.** `remind_at` and `digest_at` are local times, `HH:MM`, 24 hours.
- **Digests run only on workdays.** With `workdays: [mon, tue, wed, thu, fri]`, there is no digest on Saturday or Sunday.
- **The standup date follows your first team.** "Today" and "previous workday" use the time zone and workdays of the first team in `standwise.yml` that lists you. A daily sent on a day off counts for the next workday.
- **One daily, every team.** If you are in two teams, your daily appears in both digests. You write it once.
- **One daily per organization.** If you belong to two organizations that use Standwise, you write one daily for each. The CLI and the MCP tools ask which one, or take `--org` / `org`.
- **Changing the file.** Standwise reloads `standwise.yml` when a push to the default branch of the `.github` repository changes it. If a push makes the file invalid, Standwise keeps using the last valid version until you fix it: digests still go out, and drafts and submissions still work. Deleting the file switches Standwise off for the organization. Without a valid version in use, drafts and submissions get `org_not_configured`. See [Install](/admin/install#configuration-states).
