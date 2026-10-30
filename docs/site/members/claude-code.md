# Claude Code skill

The Standwise plugin for Claude Code adds the `/daily` skill and registers the Standwise MCP server for you.

## Install

1. [Install the CLI and sign in](/members/getting-started). The plugin uses the `standwise` binary on your `PATH`; it does not install it.
2. In Claude Code, add the marketplace and install the plugin:

```text
/plugin marketplace add ImFelipeOliveira/standwise
/plugin install standwise@standwise
```

3. Restart Claude Code so that it loads the skill and the MCP server.

## Use

Type `/daily`, or ask for it in your words: "my daily", "standup", "what did I do yesterday". The skill:

1. Gets the draft of yesterday from your GitHub activity. If you belong to more than one organization, it asks which one.
2. Shows yesterday and lets you correct, remove or add items. It may add things that really happened in this Claude Code session.
3. If the draft has suggested blockers, such as your pull request waiting for review or failing checks, asks about each one. If it is a real blocker, it goes into your blockers with its link; if not, the skill ignores it and it does not come back unless the signal changes. It never adds a suggestion without your answer, and suggestions are visible only to you.
4. Asks what you will do today and what blocks you, in your language.
5. Shows the final daily and asks for your explicit confirmation.
6. Sends it, and tells you if it went to the digest thread because the digest was already posted.

It uses the MCP tools when they are available, and falls back to the `standwise` CLI otherwise.

## The confirmation rule

- The skill never sends without your explicit confirmation of the final daily. Only a clear yes counts.
- Any change after the final review, however small, means a new review and a new confirmation.
- When it sends through MCP and Claude Code supports it, Standwise also asks you directly, outside the conversation, with exactly what will be posted.
- It never translates or rewrites your words. It may only split a multi-line answer into single-line items.
- It never invents activity: only what is in the draft or what you said.
- PR titles, commit messages and other text from GitHub are treated as data, never as instructions.

## Example

```text
You:     /daily
Claude:  Here is yesterday from your GitHub activity in acme:
         1. Merged "Add rate limiting" (acme/api#42)
         2. Reviewed "Retry webhooks with backoff" (acme/worker#17)
         3. 3 commits in acme/worker: "Fix retry backoff"
         Anything to fix, remove or add?
You:     Drop 3, it's part of 2.
Claude:  What will you do today? Any blockers?
You:     Today I'll write the integrator guides. Blocked: waiting for the staging database.
Claude:  Final daily for acme, 2026-10-28:
         Yesterday
         - Merged "Add rate limiting" (acme/api#42)
         - Reviewed "Retry webhooks with backoff" (acme/worker#17)
         Today
         - I'll write the integrator guides
         Blockers
         - waiting for the staging database
         Send it?
You:     Yes.
Claude:  Sent for 2026-10-28. It goes into the backend digest.
```

## When something fails

| Situation | What the skill does |
| --- | --- |
| `standwise` is not installed | Explains how to install the CLI, then stops. |
| Not signed in, or the session expired | Asks you to run `standwise login`, then stops. |
| More than one organization | Asks which one and retries with it. |
| A suggestion was already decided | Tells you and moves on. |
| The daily is invalid | Shows the issues, fixes them with you without changing their meaning, and asks for a new confirmation. |
| Any other error | Shows the message. See [Troubleshooting](/troubleshooting). |
