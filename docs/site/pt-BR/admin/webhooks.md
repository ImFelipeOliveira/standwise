# Webhooks

Os webhooks mandam os eventos do Standwise para os seus sistemas na hora em que acontecem, como requisições `POST` HTTPS assinadas. Só admins gerenciam os webhooks.

Esta página cobre a página de setup. Para os payloads, os headers e como verificar a assinatura, veja o [guia de webhooks](/pt-BR/api/webhooks).

## Eventos

| Evento | Enviado quando |
| --- | --- |
| `daily.submitted` | Uma pessoa envia a daily. Um reenvio no mesmo dia é enviado de novo com `replaced: true`. |
| `blocker.opened` | Uma daily traz um impedimento novo naquele dia. |
| `digest.sent` | O consolidado do time é publicado no Slack. |

## Adicionar um endpoint

1. Abra a página de setup da organização e entre com o GitHub.
2. Em **Webhooks**, informe a URL do endpoint.
3. Escolha os eventos.
4. Clique em **Adicionar endpoint**.

A URL tem que usar `https://` na porta padrão, não ter usuário nem senha e apontar para um endereço público. O Standwise recusa endereços privados, de loopback, link-local e de metadados de nuvem, e confere de novo antes de cada entrega.

A página mostra o segredo de assinatura, começando com `whsec_`, **uma vez só**. Copie e guarde no seu receptor. O Standwise guarda o segredo criptografado e não consegue mostrá-lo de novo.

Uma organização pode ter até 10 endpoints ativos.

## Testar um endpoint

Clique em **Enviar evento de teste** ao lado do endpoint. O Standwise manda um evento `ping` assinado só para esse endpoint. A lista **Últimas 20 entregas** mostra cada entrega com o horário, o evento, o estado, as tentativas, o último código de resposta ou erro e a URL do endpoint.

## Novas tentativas e desativação automática

- Qualquer resposta `2xx` conta como entregue. Qualquer outra resposta, um redirecionamento, um erro de conexão ou nenhuma resposta em 10 segundos é falha.
- Uma entrega com falha é tentada de novo, até 8 tentativas no total, ao longo de umas 45 horas.
- Depois de 20 entregas seguidas com falha, o Standwise desativa o endpoint. A página mostra "Desativado após 20 entregas seguidas com falha".

## Trocar o segredo

O segredo não pode ser trocado no mesmo endpoint. Para trocar:

1. Adicione um endpoint novo com a mesma URL e os mesmos eventos e copie o segredo dele.
2. Faça o seu receptor aceitar os dois segredos por um tempo.
3. Desative o endpoint antigo.
4. Remova o segredo antigo do receptor.

Durante esse período, cada evento vai para os dois endpoints com o mesmo `id` de evento, então descarte as duplicatas pelo `id`.

## Desativar um endpoint

Clique em **Desativar**. O Standwise para de enviar para ele na hora. Um endpoint desativado não pode ser reativado: para voltar, adicione o endpoint de novo e use o novo segredo.
