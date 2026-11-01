## Webhooks

Standcast can send events to your systems as they happen. An organization admin registers an HTTPS endpoint on the setup page, picks the events it receives and gets a signing secret. Standcast then sends a signed `POST` with a JSON body for every event.

### Registering an endpoint

Only an organization admin can manage webhooks. On the Standcast setup page of the organization, open the **Webhooks** section, enter the endpoint URL, pick the events and add it.

The endpoint URL must:

- use `https://`;
- use the default port (443);
- not contain a user name or password;
- point to a public address. Standcast resolves the host name before every delivery and refuses private, loopback, link-local, carrier-grade NAT, multicast, reserved and cloud metadata addresses, in IPv4 and IPv6. It then connects to the address it checked, so a DNS change between the check and the request cannot redirect the delivery.

The signing secret (`whsec_...`) is shown once, when the endpoint is created. Standcast stores it encrypted and cannot show it again. If you lose it, disable the endpoint and create another. An organization can have up to 10 active endpoints.

### Events

| Event | Sent when |
| --- | --- |
| `daily.submitted` | A person submits the daily. A resend on the same day is sent again with `replaced: true`. |
| `blocker.opened` | A daily reports a blocker that is new for that day. A blocker whose text (ignoring case and extra spaces) was already in the previous version of the same daily is not sent again. |
| `digest.sent` | The team digest is posted to chat. |
| `ping` | An admin clicks **Send test event**. Endpoints cannot subscribe to it; it goes only to the endpoint being tested. |

Every body is an envelope with the same fields:

| Field | Meaning |
| --- | --- |
| `id` | Event id (UUID). Retries of the same event reuse it. |
| `type` | The event name. |
| `created_at` | When the event happened, ISO 8601 in UTC. |
| `installation` | `{ "id": <GitHub App installation id>, "login": "<organization login>" }`. |
| `data` | The event payload, described below. |

`daily.submitted`:

```json
{
  "id": "5f0c3a8e-0f4e-4d1a-9b51-6a4d0f2c9e11",
  "type": "daily.submitted",
  "created_at": "2026-10-28T12:03:00.000Z",
  "installation": { "id": 12345678, "login": "acme" },
  "data": {
    "id": "7b1c2f0e-5a0b-4a63-9a43-0d2a1f0f9d11",
    "login": "alice",
    "date": "2026-10-28",
    "teams": ["Alpha"],
    "yesterday": [
      {
        "text": "Shipped rate limiting",
        "ref": { "kind": "pull_request", "url": "https://github.com/acme/api/pull/42" }
      }
    ],
    "today": [{ "text": "Write the integrator guides" }],
    "blockers": [
      {
        "text": "Waiting for the staging database",
        "ref": { "kind": "issue", "url": "https://github.com/acme/infra/issues/7" }
      }
    ],
    "replaced": false
  }
}
```

`blocker.opened`:

```json
{
  "id": "9a3e7c51-2d4b-4f0a-8e6d-1b2c3d4e5f60",
  "type": "blocker.opened",
  "created_at": "2026-10-28T12:03:00.000Z",
  "installation": { "id": 12345678, "login": "acme" },
  "data": {
    "dailyId": "7b1c2f0e-5a0b-4a63-9a43-0d2a1f0f9d11",
    "login": "alice",
    "date": "2026-10-28",
    "text": "Waiting for the staging database",
    "ref": { "kind": "issue", "url": "https://github.com/acme/infra/issues/7" },
    "teams": ["Alpha"]
  }
}
```

`digest.sent`:

```json
{
  "id": "c41d2e8f-6b7a-4c3d-9e0f-a1b2c3d4e5f6",
  "type": "digest.sent",
  "created_at": "2026-10-28T13:00:04.000Z",
  "installation": { "id": 12345678, "login": "acme" },
  "data": { "team": "Alpha", "date": "2026-10-28", "submitted": ["alice"], "missing": ["bob"] }
}
```

`ping`:

```json
{
  "id": "e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b",
  "type": "ping",
  "created_at": "2026-10-28T12:03:00.000Z",
  "installation": { "id": 12345678, "login": "acme" },
  "data": { "endpoint_id": "0d9c8b7a-6f5e-4d3c-8b2a-19f8e7d6c5b4" }
}
```

`ref` is present only when the item points to a pull request, issue, commit or card. New fields may be added to `data`; ignore the ones you do not know.

### Headers

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `Standcast-Webhooks/1` |
| `Standcast-Event` | The event name, same as `type` in the body. |
| `Standcast-Delivery` | Delivery id (UUID). One per endpoint and event; it stays the same across retries. |
| `Standcast-Signature` | `t=<unix seconds>,v1=<signature>` |

### Verifying the signature

Verify every request before you act on it. The signature is the hex HMAC-SHA256 of `<t>.<raw body>`, keyed with the endpoint secret, where `<t>` is the `t` value of the header. Compute it over the raw bytes you received, before parsing the JSON. Compare in constant time, and reject requests whose `t` is more than 5 minutes away from your clock, so a captured request cannot be replayed later.

TypeScript (Node.js or Bun):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;

export function verifyStandcastSignature(
  secret: string,
  rawBody: string,
  header: string,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  let timestamp: number | undefined;
  const signatures: Buffer[] = [];
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    const key = part.slice(0, index);
    const value = part.slice(index + 1);
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && /^[0-9a-f]{64}$/.test(value)) signatures.push(Buffer.from(value, 'hex'));
  }
  if (timestamp === undefined || Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((signature) => timingSafeEqual(expected, signature));
}

const secret = process.env.STANDCAST_WEBHOOK_SECRET ?? '';
const seen = new Set<string>();

Bun.serve({
  port: 3000,
  async fetch(request) {
    const rawBody = await request.text();
    const header = request.headers.get('standcast-signature') ?? '';
    if (!verifyStandcastSignature(secret, rawBody, header)) {
      return new Response('invalid signature', { status: 401 });
    }
    const event = JSON.parse(rawBody) as { id: string; type: string; data: unknown };
    if (seen.has(event.id)) return new Response(null, { status: 204 });
    seen.add(event.id);
    console.log(event.type, event.data);
    return new Response(null, { status: 204 });
  },
});
```

With Node.js and Express, read the raw body with `express.raw({ type: 'application/json' })` and pass `request.body.toString('utf8')` as `rawBody`.

Python:

```python
import hashlib
import hmac
import json
import os
import re
import time
from typing import Optional

from flask import Flask, request

TOLERANCE_SECONDS = 300


def verify_standcast_signature(
    secret: str, raw_body: bytes, header: str, now: Optional[int] = None
) -> bool:
    timestamp = None
    signatures = []
    for part in header.split(","):
        key, _, value = part.partition("=")
        if key == "t" and value.isdigit():
            timestamp = int(value)
        elif key == "v1" and re.fullmatch(r"[0-9a-f]{64}", value):
            signatures.append(value)
    if timestamp is None:
        return False
    current = int(time.time()) if now is None else now
    if abs(current - timestamp) > TOLERANCE_SECONDS:
        return False
    signed = str(timestamp).encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


app = Flask(__name__)
secret = os.environ["STANDCAST_WEBHOOK_SECRET"]
seen = set()


@app.post("/standcast")
def standcast_webhook():
    raw_body = request.get_data()
    header = request.headers.get("Standcast-Signature", "")
    if not verify_standcast_signature(secret, raw_body, header):
        return "invalid signature", 401
    event = json.loads(raw_body)
    if event["id"] in seen:
        return "", 204
    seen.add(event["id"])
    print(event["type"], event["data"])
    return "", 204
```

### Idempotency

A delivery can arrive more than once, for example when your endpoint processed it but the response was lost. Use the envelope `id` to drop duplicates: store the ids you have processed (a table with a unique key works) and skip an event whose id you already have. The examples above keep the ids in memory only to stay short.

### Responses, retries and disabling

- Any `2xx` response counts as delivered. The response body is ignored.
- Anything else counts as a failure: other status codes, redirects (they are never followed), connection errors and no response within **10 seconds**.
- A failed delivery is retried up to 8 attempts in total, waiting 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours and 24 hours between attempts. After the 8th failed attempt the delivery is marked as failed and is not retried.
- After **20 failed deliveries in a row**, Standcast disables the endpoint. The setup page shows it as disabled after failures. A successful delivery resets the count. To resume, create the endpoint again.
- Respond quickly: acknowledge with `2xx` and do the slow work in the background.

Events are not guaranteed to arrive in order. Use `created_at` when the order matters.

### Testing an endpoint

On the setup page, click **Send test event** next to the endpoint. Standcast sends a signed `ping` event to that endpoint only. The **Latest 20 deliveries** table shows every delivery with its event, status, attempts and the last response status or error, so you can confirm the endpoint answered with `2xx` and that your signature check passes.
