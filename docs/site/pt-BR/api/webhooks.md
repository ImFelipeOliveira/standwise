---
title: Guia de webhooks
outline: [2, 3]
---

# Guia de webhooks

Como receber os eventos do Standcast: payloads, headers, verificação da assinatura, novas tentativas e testes. Para adicionar um endpoint na página de setup, veja [Webhooks para admins](/pt-BR/admin/webhooks).

O Standcast manda eventos para os seus sistemas na hora em que acontecem. Um admin da organização cadastra um endpoint HTTPS na página de setup, escolhe os eventos e recebe um segredo de assinatura. A partir daí, o Standcast manda um `POST` assinado com um corpo JSON para cada evento.

## Cadastrar um endpoint

Só um admin da organização gerencia webhooks. Na página de setup da organização, abra a seção **Webhooks**, informe a URL do endpoint, escolha os eventos e adicione.

A URL do endpoint tem que:

- usar `https://`;
- usar a porta padrão (443);
- não ter usuário nem senha;
- apontar para um endereço público. O Standcast resolve o nome do host antes de cada entrega e recusa endereços privados, de loopback, link-local, NAT de operadora, multicast, reservados e de metadados de nuvem, em IPv4 e IPv6. Depois ele conecta no endereço que conferiu, então uma mudança de DNS entre a checagem e a requisição não desvia a entrega.

O segredo de assinatura (`whsec_...`) aparece uma vez, quando o endpoint é criado. O Standcast guarda o segredo criptografado e não consegue mostrar de novo. Se você perder o segredo, desative o endpoint e crie outro. Uma organização pode ter até 10 endpoints ativos.

## Eventos

| Evento | Enviado quando |
| --- | --- |
| `daily.submitted` | Uma pessoa envia a daily. Um reenvio no mesmo dia é enviado de novo com `replaced: true`. |
| `blocker.opened` | Uma daily traz um impedimento novo naquele dia. Um impedimento cujo texto (ignorando maiúsculas e espaços extras) já estava na versão anterior da mesma daily não é enviado de novo. |
| `digest.sent` | O consolidado do time é publicado no chat. |
| `ping` | Um admin clica em **Enviar evento de teste**. Os endpoints não assinam esse evento; ele vai só para o endpoint testado. |

Todo corpo é um envelope com os mesmos campos:

| Campo | Significado |
| --- | --- |
| `id` | Id do evento (UUID). As novas tentativas do mesmo evento reaproveitam esse id. |
| `type` | O nome do evento. |
| `created_at` | Quando o evento aconteceu, em ISO 8601 no UTC. |
| `installation` | `{ "id": <id da instalação do GitHub App>, "login": "<login da organização>" }`. |
| `data` | O payload do evento, descrito abaixo. |

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

O `ref` só aparece quando o item aponta para um pull request, issue, commit ou card. Novos campos podem entrar em `data`; ignore os que você não conhece.

## Headers

| Header | Valor |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `Standcast-Webhooks/1` |
| `Standcast-Event` | O nome do evento, igual ao `type` do corpo. |
| `Standcast-Delivery` | Id da entrega (UUID). Um por endpoint e evento; continua o mesmo nas novas tentativas. |
| `Standcast-Signature` | `t=<segundos unix>,v1=<assinatura>` |

## Verificar a assinatura

Verifique toda requisição antes de agir sobre ela. A assinatura é o HMAC-SHA256 em hexadecimal de `<t>.<corpo bruto>`, com o segredo do endpoint como chave, onde `<t>` é o valor de `t` no header. Calcule sobre os bytes brutos que você recebeu, antes de interpretar o JSON. Compare em tempo constante e recuse requisições cujo `t` esteja a mais de 5 minutos do seu relógio, para uma requisição capturada não poder ser repetida depois.

TypeScript (Node.js ou Bun):

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

Com Node.js e Express, leia o corpo bruto com `express.raw({ type: 'application/json' })` e passe `request.body.toString('utf8')` como `rawBody`.

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

## Idempotência

Uma entrega pode chegar mais de uma vez, por exemplo quando o seu endpoint processou o evento mas a resposta se perdeu. Use o `id` do envelope para descartar duplicatas: guarde os ids já processados (uma tabela com chave única funciona) e pule um evento cujo id você já tem. Os exemplos acima guardam os ids só em memória para ficarem curtos.

## Respostas, novas tentativas e desativação

- Qualquer resposta `2xx` conta como entregue. O corpo da resposta é ignorado.
- Todo o resto conta como falha: outros códigos de status, redirecionamentos (nunca seguidos), erros de conexão e nenhuma resposta em **10 segundos**.
- Uma entrega com falha é tentada de novo, até 8 tentativas no total, esperando 1 minuto, 5 minutos, 30 minutos, 2 horas, 6 horas, 12 horas e 24 horas entre elas. Depois da 8ª falha, a entrega fica marcada como falha e não é tentada de novo.
- Depois de **20 entregas seguidas com falha**, o Standcast desativa o endpoint. A página de setup mostra o endpoint como desativado após falhas. Uma entrega com sucesso zera a contagem. Para voltar, crie o endpoint de novo.
- Responda rápido: confirme com `2xx` e faça o trabalho lento em segundo plano.

A ordem de chegada dos eventos não é garantida. Use o `created_at` quando a ordem importar.

## Testar um endpoint

Na página de setup, clique em **Enviar evento de teste** ao lado do endpoint. O Standcast manda um evento `ping` assinado só para esse endpoint. A tabela **Últimas 20 entregas** mostra cada entrega com o evento, o estado, as tentativas e o último status de resposta ou erro, para você confirmar que o endpoint respondeu com `2xx` e que a sua verificação de assinatura passa.
