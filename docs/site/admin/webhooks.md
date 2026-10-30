# Webhooks

Webhooks send Standwise events to your systems as they happen, as signed HTTPS `POST` requests. Only admins manage them.

This page covers the setup page. For the payloads, the headers and how to verify the signature, see the [webhooks guide](/api/webhooks).

## Events

| Event | Sent when |
| --- | --- |
| `daily.submitted` | A person sends their daily. A resend on the same day is sent again with `replaced: true`. |
| `blocker.opened` | A daily reports a blocker that is new for that day. |
| `digest.sent` | The team digest is posted to Slack. |

## Add an endpoint

1. Open the setup page of the organization and sign in with GitHub.
2. In **Webhooks**, enter the endpoint URL.
3. Pick the events.
4. Click **Add endpoint**.

The URL must use `https://` on the default port, have no user name or password, and point to a public address. Standwise refuses private, loopback, link-local and cloud metadata addresses, and checks again before every delivery.

The page shows the signing secret, starting with `whsec_`, **once**. Copy it and store it in your receiver. Standwise keeps it encrypted and cannot show it again.

An organization can have up to 10 active endpoints.

## Test an endpoint

Click **Send test event** next to the endpoint. Standwise sends a signed `ping` event to that endpoint only. The **Latest 20 deliveries** table shows each delivery with its event, status, attempts and the last response code or error.

## Retries and automatic disabling

- Any `2xx` response counts as delivered. Anything else, a redirect, a connection error or no answer within 10 seconds is a failure.
- A failed delivery is retried up to 8 attempts in total, over about 45 hours.
- After 20 failed deliveries in a row, Standwise disables the endpoint. The page shows "Disabled after 20 failed deliveries in a row".

## Rotate the secret

Secrets cannot be changed in place. To rotate:

1. Add a new endpoint with the same URL and events, and copy its secret.
2. Make your receiver accept both secrets for a while.
3. Disable the old endpoint.
4. Remove the old secret from your receiver.

During the overlap, each event is sent to both endpoints with the same event `id`, so drop duplicates by `id`.

## Disable an endpoint

Click **Disable**. Standwise stops sending to it right away. Disabled endpoints cannot be enabled again: to resume, add the endpoint again and use its new secret.
