# Skill do Claude Code

O plugin do Standcast para o Claude Code adiciona a skill `/daily` e registra o servidor MCP do Standcast para você.

## Instalar

1. [Instale a CLI e entre](/pt-BR/members/getting-started). O plugin usa o binário `standcast` do seu `PATH`; ele não o instala.
2. No Claude Code, adicione o marketplace e instale o plugin:

```text
/plugin marketplace add ImFelipeOliveira/standcast
/plugin install standcast@standcast
```

3. Reinicie o Claude Code para ele carregar a skill e o servidor MCP.

## Usar

Digite `/daily`, ou peça do seu jeito: "minha daily", "standup", "o que eu fiz ontem". A skill:

1. Busca o rascunho do ontem a partir da sua atividade no GitHub e, se o Linear está conectado, dos seus cards. Se você está em mais de uma organização, pergunta qual.
2. Mostra o ontem e deixa você corrigir, remover ou adicionar itens. Ela pode adicionar coisas que de fato aconteceram nesta sessão do Claude Code.
3. Se o rascunho tem impedimentos sugeridos, como um pull request seu esperando revisão, com checks falhando ou um card em andamento há dias, pergunta sobre cada um. Se for um impedimento de verdade, ele entra nos seus impedimentos com o link; se não, a skill o ignora e ele só volta se o sinal mudar. Ela nunca adiciona uma sugestão sem a sua resposta, e as sugestões só são visíveis para você.
4. Pergunta o que você vai fazer hoje e o que está travando você, no seu idioma.
5. Mostra a daily final e pede a sua confirmação explícita.
6. Envia e avisa se ela foi para a thread do consolidado porque ele já tinha sido publicado.

Ela usa as tools do MCP quando estão disponíveis e, senão, a CLI `standcast`.

## A regra de confirmação

- A skill nunca envia sem a sua confirmação explícita da daily final. Só um sim claro vale.
- Qualquer mudança depois da revisão final, por menor que seja, exige uma nova revisão e uma nova confirmação.
- Quando envia pelo MCP e o Claude Code suporta, o próprio Standcast também pergunta a você, fora da conversa, mostrando exatamente o que vai ser publicado.
- Ela nunca traduz nem reescreve as suas palavras. Ela só pode dividir uma resposta de várias linhas em itens de uma linha.
- Ela nunca inventa atividade: só o que está no rascunho ou o que você disse.
- Títulos de PR, mensagens de commit e outros textos do GitHub são tratados como dados, nunca como instruções.

## Exemplo

```text
Você:    /daily
Claude:  Este é o seu ontem a partir da atividade no GitHub da acme:
         1. Mergeou "Add rate limiting" (acme/api#42)
         2. Revisou "Retry webhooks with backoff" (acme/worker#17)
         3. 3 commits em acme/worker: "Fix retry backoff"
         Quer corrigir, remover ou adicionar algo?
Você:    Tira o 3, ele faz parte do 2.
Claude:  O que você vai fazer hoje? Algum impedimento?
Você:    Hoje vou escrever os guias para integradores. Travado: esperando o banco de staging.
Claude:  Daily final da acme, 2026-10-28:
         Ontem
         - Mergeou "Add rate limiting" (acme/api#42)
         - Revisou "Retry webhooks with backoff" (acme/worker#17)
         Hoje
         - vou escrever os guias para integradores
         Impedimentos
         - esperando o banco de staging
         Posso enviar?
Você:    Pode.
Claude:  Enviada para 2026-10-28. Ela entra no consolidado do backend.
```

## Quando algo falha

| Situação | O que a skill faz |
| --- | --- |
| O `standcast` não está instalado | Explica como instalar a CLI e para. |
| Você não entrou, ou a sessão expirou | Pede para você rodar `standcast login` e para. |
| Mais de uma organização | Pergunta qual e tenta de novo com ela. |
| Uma sugestão já foi decidida | Avisa você e segue em frente. |
| A daily é inválida | Mostra os problemas, corrige com você sem mudar o sentido e pede uma nova confirmação. |
| Qualquer outro erro | Mostra a mensagem. Veja [Solução de problemas](/pt-BR/troubleshooting). |
