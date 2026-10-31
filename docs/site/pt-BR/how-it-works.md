# Como funciona

Um dia na vida de um time, com esta configuração:

```text
time backend · timezone America/Sao_Paulo · workdays seg–sex
remind_at 09:30 · digest_at 10:00 · canal #daily-backend
```

## 08:50 · Alice monta a daily

Alice roda `/daily` no Claude Code. A skill pede um rascunho ao Standwise. O Standwise olha a atividade da Alice no GitHub da organização desde a última daily dela:

- pull requests que ela abriu;
- pull requests que ela mergeou;
- pull requests que ela revisou (não os dela);
- commits de autoria dela, agrupados por repositório.

A janela começa no envio da última daily, se ela foi no dia útil anterior ou depois. Senão, começa à meia-noite do dia útil anterior. Na segunda, o dia útil anterior é sexta, então o fim de semana entra. O rascunho tem até 50 itens, do mais recente para o mais antigo.

Alice ajusta o ontem, escreve o hoje e um impedimento e confirma. O Standwise guarda a daily na data de hoje. Ela pode reenviar até o consolidado sair: vale a última versão.

## 09:30 · Lembrete

No `remind_at`, no fuso do time e só em dias úteis, quem ainda não enviou a daily recebe uma mensagem direta no Slack. A mensagem diz a que horas sai o consolidado. Se a pessoa está em vários times, vale o consolidado pendente mais próximo.

- No máximo um lembrete por pessoa por dia, mesmo em vários times.
- Ele só sai enquanto o `remind_at` já passou e o `digest_at` ainda não. Se o worker estava fora do ar, ele ainda pode sair até 60 minutos depois do `remind_at`, mas nunca no `digest_at` ou depois, e nunca depois que o consolidado do time foi publicado.
- Quem não tem identidade no Slack gera a entrega com falha `no_chat_identity` na página de setup. Veja [Slack](/pt-BR/admin/slack#erros-de-entrega).
- O `remind_at` tem que ser antes do `digest_at`, senão o arquivo é inválido.

## 10:00 · O consolidado

No `digest_at`, no fuso do time e só em dias úteis, o Standwise publica uma mensagem no `#daily-backend`:

1. o título, com o time e a data;
2. **Impedimentos**, com quem reportou cada um;
3. o ontem e o hoje de cada pessoa, na ordem de `members` no `standwise.yml`;
4. quem não enviou a daily.

As pessoas são mencionadas no Slack quando o Standwise conhece o usuário delas lá. Senão, aparecem como `@` seguido do login do GitHub, em texto. Veja [Slack](/pt-BR/admin/slack#como-as-pessoas-sao-mencionadas).

Existe exatamente um consolidado por time por dia. Se o worker estiver fora do ar às 10:00, o consolidado sai quando ele voltar, desde que dentro de 120 minutos. Depois das 12:00, ele não sai naquele dia. Uma publicação com falha é tentada até 3 vezes no total, e o erro aparece na página de setup.

## 10:40 · Bob manda uma daily atrasada

Bob envia a daily depois do consolidado. O Standwise responde na thread do consolidado com a daily dele. A CLI e as tools do MCP devolvem `late: true`.

Só a primeira daily atrasada do dia vai para a thread. Se o Bob reenviar, o Standwise guarda a nova versão e dispara o webhook, mas não publica uma segunda resposta.

## Encaminhamento de impedimentos

Cada impedimento novo de uma daily enviada vai uma vez, por mensagem direta, para quem pode ajudar, nesta ordem:

1. Um link de pull request da sua própria organização vai para os revisores solicitados e os membros dos times solicitados. Sem nenhum deles, vai para os CODEOWNERS dos arquivos alterados no pull request, na branch base, com os times expandidos nos membros.
2. Um link de card vai para o responsável pelo card que trava. Isso depende da integração com o Linear, que vem em breve, então hoje segue para o próximo passo.
3. Senão, para os gestores do primeiro time do autor.

Regras:

- O autor nunca recebe o próprio impedimento, e no máximo 5 pessoas recebem.
- Se nenhuma das pessoas encontradas tem identidade no Slack, ou o GitHub não pôde ser lido, o impedimento vai para os gestores.
- Pull requests de outras organizações não são lidos e vão para os gestores.
- Um impedimento com link é identificado pelo link, então reescrever o texto ou enviar a daily de novo não envia outra vez. Sem link, o texto o identifica. No máximo 10 impedimentos diferentes por daily são encaminhados.
- A mensagem diz por que a pessoa a recebeu: revisor solicitado, dono de código, responsável pelo card ou gestor do time.
- A mensagem traz só quem reportou, o texto do impedimento, o link e a data. Nunca o resto da daily.
- Se não há nenhum destinatário, por exemplo quando o autor é o único gestor do time, a entrega com falha `no_route_target` aparece na página de setup. Um gestor sem identidade no Slack aparece como `no_chat_identity`.

Os impedimentos também aparecem no topo do consolidado, no webhook `blocker.opened` e nas tools de gestor.

## Impedimentos sugeridos

O Standwise pode perceber impedimentos que você deixou passar. São dois sinais:

- um pull request seu, aberto e que não é rascunho, sem revisão há `pr_review_hours` (padrão 48) desde que ficou pronto para revisão;
- o CI falhando no commit head do seu pull request há 24 horas.

Eles são verificados cerca de uma hora antes do `remind_at`, e em tempo real quando um pull request, uma revisão ou um check suite muda. Só quem já entrou pelo menos uma vez recebe sugestões.

Uma sugestão aparece só para você, no seu rascunho. Ela nunca aparece no consolidado, nas tools de organização ou de gestor, nos webhooks nem na página de setup. O gestor só vê um impedimento depois que você o coloca na sua daily. Com `signals.direct_message: true` (padrão `false`) você também recebe uma mensagem direta, uma vez por sugestão.

Para responder:

- **Confirmar:** adicione aos seus impedimentos com o link. Enviar a daily confirma. Pelo terminal, `standwise suggestion confirm <id>`.
- **Ignorar:** `standwise suggestion ignore <id>`, a tool MCP `standwise_decide_suggestion`, ou responda quando a skill `/daily` perguntar.

Uma sugestão ignorada só volta se o sinal mudar: um novo commit head que ainda falha, ou um novo período sem revisão, depois que uma revisão é descartada ou o pull request volta a ficar pronto para revisão. O agente nunca adiciona uma sugestão sem a sua resposta. Veja [CLI](/pt-BR/members/cli#standwise-suggestion).

## Fuso, dias úteis e vários times

- **Todos os horários são no fuso do time.** `remind_at` e `digest_at` são horários locais, `HH:MM`, 24 horas.
- **Consolidados só em dias úteis.** Com `workdays: [mon, tue, wed, thu, fri]`, não há consolidado no sábado nem no domingo.
- **A data da daily segue o seu primeiro time.** "Hoje" e "dia útil anterior" usam o fuso e os dias úteis do primeiro time do `standwise.yml` que lista você. Uma daily enviada num dia de folga conta para o próximo dia útil.
- **Uma daily, todos os times.** Se você está em dois times, a sua daily aparece nos dois consolidados. Você escreve uma vez.
- **Uma daily por organização.** Se você está em duas organizações que usam o Standwise, escreve uma daily para cada. A CLI e as tools do MCP perguntam qual, ou recebem `--org` / `org`.
- **Mudanças no arquivo.** O Standwise recarrega o `standwise.yml` a cada push na branch padrão do repositório `.github`, inclusive force push. Se um push deixar o arquivo inválido, o Standwise continua usando a última versão válida até você corrigir: o consolidado sai, e o rascunho e o envio continuam funcionando. Apagar o arquivo desliga o Standwise para a organização. Sem uma versão válida em uso, o rascunho e o envio recebem `org_not_configured`. Veja [Instalação](/pt-BR/admin/install#estados-da-configuracao).
- **Conferindo o arquivo antes de ele valer.** Quando um push em qualquer branch do `.github` altera o `standwise.yml`, ou um pull request no `.github` o altera, o Standwise cria um check run chamado `Standwise config`. Veja [Instalação](/pt-BR/admin/install#estados-da-configuracao).
