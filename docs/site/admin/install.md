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
| Checks | write | Create the `Standwise config` check run on `standwise.yml` |
| Commit statuses | read | Read the check results of pull requests, for suggested blockers |
| Members | read | Resolve GitHub teams (`@org/team`) and check membership and roles |
| Email addresses (account) | read | Match people to their Slack user by email |

## 2. Open the setup page

After the install, GitHub sends you to the Standwise setup page. Sign in with GitHub when asked. The page address is `/setup?installation_id=<id>` on the Standwise API.

Any member of the organization who signs in can open the setup page. Only admins can connect or reconnect Slack and Linear, and only admins see the **API keys** and **Webhooks** sections. An admin is a GitHub organization admin, or the account owner for a personal account.

The page is a checklist. A badge at the top counts the steps, for example **2 of 3 steps done**, and turns green when every step is done. Each step has a status icon (a check when done, its number while to do, an x when it needs attention) and a badge:

- **GitHub App**: installed on your organization, with a warning when Standwise lost access to `.github`;
- **Slack**: **Connect Slack**, or **Reconnect Slack** once connected, for admins;
- **Linear**: **Connect Linear**, or **Reconnect Linear** once connected, for admins. It counts as a step only when a team uses Linear, and then comes before the standwise.yml file. Otherwise it shows **Optional** and comes last;
- **standwise.yml file**: the state of the file. When it does not exist, a button to create it from a template, and the template itself. When it exists, **Edit on GitHub**, even while the file is invalid. A valid file adds one card per team, with its channel and times, and an invalid one adds a table of its errors.

The side column shows the latest failed deliveries and, for admins, API keys and webhooks, then the support address.

## 3. Connect Slack

An admin clicks **Connect Slack** and approves the app in the Slack workspace. The Slack step then shows a check, the **Connected** badge and "Connected to" the workspace name, and a **Reconnect Slack** button to connect again. Other members see the connection read-only. While Slack is not connected yet, they see "Only an admin can connect or reconnect Slack." See [Slack](/admin/slack) for the permissions and for private channels.

## 4. Create `standwise.yml`

In the **standwise.yml file** step, click **Create standwise.yml from the template**. GitHub opens its editor on the default branch of your `.github` repository, with the file already filled in. The template uses your login as manager and member:

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

Standwise reloads the file on every push to the default branch of `.github` that changes `standwise.yml`, and when the repositories of the installation change. Reload the setup page to see the new state. Once the file exists, the step shows **Edit on GitHub**, which opens `standwise.yml` on GitHub, even while the file is invalid.

## 5. Connect Linear (optional)

Skip this step if your teams do not use Linear. An admin clicks **Connect Linear** in the Linear step of the setup page and approves the app in the Linear workspace. The step then shows `Connected to the <workspace> workspace.` and a **Reconnect Linear** button.

- The connection is read-only (scope `read`) and the app acts as itself, not as the admin. There is one Linear workspace per installation. Tokens are encrypted and refreshed automatically.
- Only an admin can connect or reconnect Linear. While Linear is not connected, or stopped working, other members see "Only an admin can connect or reconnect Linear."
- If Linear access is revoked, the step shows the **Needs attention** badge, "Linear stopped working", `The connection to the <workspace> workspace stopped working. Reconnect Linear.` and **Reconnect Linear**. Until then, Linear features pause silently: drafts have no cards, card blockers go to the managers, and card suggestions are kept as they are.
- Reconnecting a different workspace clears the Linear links of the installation. People are linked again when they sign in and whenever `standwise.yml` changes.
- The page warns "This team uses Linear, but Linear is not connected to this installation yet." when a team has `tracker.provider: linear` and Linear is not connected. For `tracker.provider: jira` it shows "The Jira integration is not available yet."

Then set the tracker per team in `standwise.yml`. See [`tracker`](/admin/configuration#tracker) and [Identity mapping](/admin/configuration#identity-mapping). What Standwise reads is in [Privacy](/privacy#linear).

## Configuration states

The **standwise.yml file** step shows one of three states.

### Configured

The **Configured** badge. Standwise is running: people can send dailies and the digests go out.

### Not configured

The **To do** badge and "Not configured yet." Standwise could not find the file. Deleting the file, or deleting the `.github` repository, switches Standwise off for the organization: the previous configuration is dropped, so a later invalid file does not bring it back. The page shows the reason:

| Reason | Meaning | Fix |
| --- | --- | --- |
| `no_repo` | The `.github` repository does not exist. | Create it, add `standwise.yml`, and make sure the app can access it. |
| `no_file` | `standwise.yml` is not at the root of `.github`, on the default branch. | Create the file there. A file in a subfolder or on another branch is not read. |
| `no_access` | Standwise cannot access the `.github` repository, and there was no configuration yet. | In the app installation settings on GitHub, add `.github` to the selected repositories, or choose all repositories. |

`no_access` is a warning when a configuration is already in use. GitHub can deny access for a moment, for example under a rate limit, or because `.github` was removed from the selected repositories. Standwise then keeps the current configuration and state, and the setup page shows "Standwise has no access to the .github repository. Standwise keeps using the current configuration." next to any state. The warning goes away on the next successful read of `standwise.yml`, valid or invalid. Give the app access to `.github` again to clear it.

### Invalid

The **Needs attention** badge and "standwise.yml is invalid. Fix the errors below and commit." The page lists the errors in a table with a **Path** and an **Error** column, for example the path `teams.0.digest_at` with the error `must be HH:MM (24h)`. Use **Edit on GitHub** to open the file and fix it. See the [common errors](/admin/configuration#common-validation-errors).

If the file was valid right before the invalid push, the page also says "Standwise keeps using the last valid version until you fix it." Digests still go out and drafts and submissions still work, with the last valid version. Fix the file and commit to apply your changes. If there is no valid version in use (the file was never valid, or it was deleted before the invalid push), Standwise does not run for the organization: no digests are posted, and drafts and submissions fail with `org_not_configured`.

When a push to any branch of the `.github` repository touches `standwise.yml`, and on pull requests in `.github` that change it, Standwise creates the check run `Standwise config`, with success or failure. On failure there is one annotation per error, on its line, and the summary lists every error. If the file does not exist, there is no check. Any push to the default branch reloads the configuration, force pushes included.

## Next steps

- Ask each member to follow [Getting started](/members/getting-started). People are matched to their Slack user when they sign in, so they should sign in after Slack is connected.
- If you use Linear, ask each member to sign in after Linear is connected, so their Linear user is linked.
- Create [API keys](/admin/api-keys) or [webhooks](/admin/webhooks) if other systems need the data.
