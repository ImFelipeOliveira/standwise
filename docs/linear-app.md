# Register the Linear app

Standcast is hosted by one operator, who registers one Linear OAuth application. Each organization that uses Linear then connects its own Linear workspace to it from the setup page. Replace `<PUBLIC_URL>` below with the public address of your API. It must be the same value as the `PUBLIC_URL` environment variable. For the hosted service it is `https://api.standcast.app`.

## Values you need

| Field | Value |
| --- | --- |
| Name | Any name your users will recognize, for example `Standcast` |
| Callback URL | `<PUBLIC_URL>/oauth/linear/callback`, for example `https://api.standcast.app/oauth/linear/callback` |
| Scope | `read` (the only scope Standcast asks for) |
| Actor | `app`. Standcast sends `actor=app` when an admin connects, so the app acts as itself and not as the admin |

## Register by hand

1. In Linear, open the workspace settings, go to the API section and choose to create a new OAuth application. The menu path is **Settings > API > OAuth applications**. Linear can rename its labels, so look for the OAuth applications list if the names differ.
2. Fill in the application name, a short description and the developer details Linear asks for.
3. Set the callback URL to `<PUBLIC_URL>/oauth/linear/callback`.
4. Make the application available to other workspaces if Linear offers that choice, because organizations connect their own workspaces and not the one that owns the app.
5. Save. Linear shows the client id and the client secret.

Standcast requests only the `read` scope: it reads cards and users and never writes to Linear. The actor is chosen in the authorization request, not in the application form, so there is nothing to set for it in Linear.

## Credentials

Set the two values as environment variables on both the api and the worker:

| Variable | Value |
| --- | --- |
| `LINEAR_CLIENT_ID` | The client id of the OAuth application |
| `LINEAR_CLIENT_SECRET` | The client secret of the OAuth application |

For local development, put them in `.env` (see `.env.example`). On Railway, see [deploy.md](deploy.md).

Both services fail to start when either variable is missing or empty, even if no organization uses Linear. Set them before deploying a version that includes the Linear integration.

## What happens when an admin connects

1. An admin of the installation clicks **Connect Linear** on the setup page.
2. Linear asks them to approve the application for their workspace.
3. Linear sends them back to `/oauth/linear/callback`. Standcast stores the workspace id and name and the tokens, encrypted with AES-256-GCM, and refreshes the tokens automatically.
4. If access is revoked, the setup page shows **Reconnect Linear** and Linear features pause silently until an admin reconnects.

One Linear workspace per installation. Reconnecting a different workspace clears the Linear links of that installation.

## What Standcast reads

The issue identifier, title, url, state type, started and completed dates, assignee, creator, the "blocks" relations and the team key, plus user emails to link people to their Linear user. It never reads descriptions or comments. See the [Privacy](site/privacy.md) page.
