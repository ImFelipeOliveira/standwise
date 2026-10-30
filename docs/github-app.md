# Register the GitHub App

Standwise is hosted by one operator, who registers one public GitHub App. Organizations install that app. Replace `<PUBLIC_URL>` below with the public address of your API, for example `https://standwise.example.com`. It must be the same value as the `PUBLIC_URL` environment variable.

## Values you need

| Field | Value |
| --- | --- |
| Homepage URL | `<PUBLIC_URL>` |
| Callback URL | `<PUBLIC_URL>/auth/github/callback` |
| Setup URL | `<PUBLIC_URL>/setup` |
| Webhook URL | `<PUBLIC_URL>/webhooks/github` |
| Webhook secret | A random string. Keep it: it becomes `GITHUB_WEBHOOK_SECRET` |

## Option 1: register by hand

1. Open **Settings > Developer settings > GitHub Apps > New GitHub App** on the account that will own the app.
2. Set **GitHub App name** and **Homepage URL**.
3. Under **Identifying and authorizing users**, set **Callback URL** to `<PUBLIC_URL>/auth/github/callback`. Turn **Request user authorization (OAuth) during installation** off. Turn **Enable Device Flow** on. The CLI sign-in uses the device flow.
4. Under **Post installation**, set **Setup URL** to `<PUBLIC_URL>/setup`. Turn **Redirect on update** on.
5. Under **Webhook**, keep **Active** on, set **Webhook URL** to `<PUBLIC_URL>/webhooks/github` and set the **Secret**.
6. Under **Repository permissions**, set exactly:

   | Permission | Access |
   | --- | --- |
   | Metadata | Read-only |
   | Contents | Read-only |
   | Pull requests | Read-only |
   | Checks | Read and write |
   | Commit statuses | Read-only |

7. Under **Organization permissions**, set **Members** to Read-only.
8. Under **Account permissions**, set **Email addresses** to Read-only.
9. Under **Subscribe to events**, select exactly: `Installation`, `Installation repositories`, `Push`, `Pull request`, `Pull request review`, `Check suite`, `Check run`. The event boxes appear once the matching permissions are set.
10. Under **Where can this GitHub App be installed?**, choose **Any account**.
11. Click **Create GitHub App**.

## Option 2: register with the manifest

[`github-app-manifest.json`](github-app-manifest.json) holds the same configuration: webhook, setup URL, callback URL, `public: true`, permissions and events. The manifest flow creates the app in one click and returns the credentials.

1. Copy the manifest and replace every `https://standwise.example.com` with your `<PUBLIC_URL>`. Keep `redirect_url` pointing at a page you can open: GitHub sends the browser there with a temporary `code` in the query string.
2. Save this page locally as `register.html`, pasting the edited manifest as the `value` of the hidden field (escape the double quotes as `&quot;`), and open it in your browser:

   ```html
   <form action="https://github.com/settings/apps/new" method="post">
     <input type="hidden" name="manifest" value="PASTE-THE-MANIFEST-HERE">
     <button type="submit">Register Standwise</button>
   </form>
   ```

   To create the app under an organization, use `https://github.com/organizations/<ORG>/settings/apps/new` as the action.
3. GitHub shows the app name for confirmation. Click **Create GitHub App**.
4. GitHub redirects to `redirect_url?code=<CODE>`. Within one hour, exchange the code for the credentials:

   ```sh
   curl -s -X POST -H "Accept: application/vnd.github+json" \
     https://api.github.com/app-manifests/<CODE>/conversions
   ```

   The JSON response contains `id`, `client_id`, `client_secret`, `webhook_secret` and `pem`.
5. The manifest cannot turn on **Enable Device Flow**. Open the app settings, and under **Identifying and authorizing users** turn **Enable Device Flow** on. Confirm that **Request user authorization (OAuth) during installation** is off.

## After the app exists

Map the values to the environment variables of the api and worker services:

| GitHub | Environment variable |
| --- | --- |
| App ID | `GITHUB_APP_ID` |
| Client ID | `GITHUB_CLIENT_ID` |
| Client secret (generate one) | `GITHUB_CLIENT_SECRET` |
| Webhook secret | `GITHUB_WEBHOOK_SECRET` |
| Private key (generate one, `.pem` file) | `GITHUB_APP_PRIVATE_KEY` |

For `GITHUB_APP_PRIVATE_KEY`, paste the whole PEM contents. In a single-line variable editor, replace the line breaks with `\n`.

Then install the app on a test organization. GitHub redirects the installer to `<PUBLIC_URL>/setup?installation_id=<id>`.

## Slack

[`slack-app-manifest.yml`](slack-app-manifest.yml) creates the Slack app. In Slack, open **api.slack.com/apps > Create New App > From an app manifest**, paste it and replace `https://standwise.example.com` with your `<PUBLIC_URL>`. The redirect URL is `<PUBLIC_URL>/oauth/slack/callback`. Copy the Client ID and Client Secret into `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.
