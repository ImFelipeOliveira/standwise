# Install

Set up Standwise for your organization in four steps. You need to be an owner of the GitHub organization (or of the personal account) to install the app.

## 1. Install the GitHub App

On the Standwise GitHub App page, click **Install** and pick your organization or personal account.

Choose **All repositories**, or **Only select repositories** and include the `.github` repository. Standwise reads its configuration from that repository. If it does not exist yet, you can create it in step 4 and add it to the app afterwards.

The app asks for these permissions:

| Permission | Access | Why |
| --- | --- | --- |
| Metadata | read | Required by GitHub for every app |
| Contents | read | Read `standwise.yml` |
| Pull requests | read | Build the draft from pull requests and reviews |
| Checks | write | Reserved for the configuration check run, coming soon |
| Commit statuses | read | Reserved for suggested blockers, coming soon |
| Members | read | Resolve GitHub teams (`@org/team`) and check membership and roles |
| Email addresses (account) | read | Match people to their Slack user by email |

## 2. Open the setup page

After the install, GitHub sends you to the Standwise setup page. Sign in with GitHub when asked. The page address is `/setup?installation_id=<id>` on the Standwise API.

Any member of the organization who signs in can open the setup page. Only admins can connect or reconnect Slack, and only admins see the **API keys** and **Webhooks** sections. An admin is a GitHub organization admin, or the account owner for a personal account.

The page shows:

- the organization and the state of `standwise.yml`;
- a button to create the file from a template, and the template itself;
- the Slack connection, with **Connect Slack** or **Reconnect Slack** for admins;
- the last 5 failed deliveries, with the team, date and error;
- for admins, API keys and webhooks.

## 3. Connect Slack

An admin clicks **Connect Slack** and approves the app in the Slack workspace. The page then shows "Connected to workspace" and the workspace name, and a **Reconnect Slack** button to connect again. Other members see the connection read-only, with "Only an admin can connect or reconnect Slack." See [Slack](/admin/slack) for the permissions and for private channels.

## 4. Create `standwise.yml`

Click **Create standwise.yml from the template**. GitHub opens its editor on the default branch of your `.github` repository, with the file already filled in. The template uses your login as manager and member:

```text
teams:
  - name: Team
    language: en
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [your-login]
    members: [your-login]
    chat:
      provider: slack
      channel: "#daily"
```

Change the team name, time zone, times, people and channel, then commit. The file must be at the **root** of the `.github` repository, on the default branch. If the `.github` repository does not exist, the page shows **Create the .github repository** instead, which opens GitHub's new repository form with the name filled in.

Full reference: [standwise.yml](/admin/configuration).

Standwise reloads the file on every push to the default branch of `.github` that changes `standwise.yml`, and when the repositories of the installation change. Reload the setup page to see the new state.

## Configuration states

The setup page shows one of three states.

### Configured

"Configured." Standwise is running: people can send dailies and the digests go out.

### Not configured

"Not configured yet." Standwise could not find the file. Deleting the file, or deleting the `.github` repository, switches Standwise off for the organization: the previous configuration is dropped, so a later invalid file does not bring it back. The page shows the reason:

| Reason | Meaning | Fix |
| --- | --- | --- |
| `no_repo` | The `.github` repository does not exist. | Create it, add `standwise.yml`, and make sure the app can access it. |
| `no_file` | `standwise.yml` is not at the root of `.github`, on the default branch. | Create the file there. A file in a subfolder or on another branch is not read. |
| `no_access` | Standwise cannot access the `.github` repository, and there was no configuration yet. | In the app installation settings on GitHub, add `.github` to the selected repositories, or choose all repositories. |

`no_access` is a warning when a configuration is already in use. GitHub can deny access for a moment, for example under a rate limit, or because `.github` was removed from the selected repositories. Standwise then keeps the current configuration and state, and the setup page shows "Standwise has no access to the .github repository. Standwise keeps using the current configuration." next to any state. The warning goes away on the next successful read of `standwise.yml`, valid or invalid. Give the app access to `.github` again to clear it.

### Invalid

"standwise.yml is invalid. Fix the errors below and commit." The page lists each error as `path: message`, for example `teams.0.digest_at: must be HH:MM (24h)`. See the [common errors](/admin/configuration#common-validation-errors).

If the file was valid right before the invalid push, the page also says "Standwise keeps using the last valid version until you fix it." Digests still go out and drafts and submissions still work, with the last valid version. Fix the file and commit to apply your changes. If there is no valid version in use (the file was never valid, or it was deleted before the invalid push), Standwise does not run for the organization: no digests are posted, and drafts and submissions fail with `org_not_configured`.

Coming soon: a failing check run on the commit that breaks `standwise.yml`, and on pull requests that change it.

## Next steps

- Ask each member to follow [Getting started](/members/getting-started). People are matched to their Slack user when they sign in, so they should sign in after Slack is connected.
- Create [API keys](/admin/api-keys) or [webhooks](/admin/webhooks) if other systems need the data.
