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

## 09:30 · Lembrete <Badge type="info" text="em breve" />

Em breve: no `remind_at`, quem ainda não enviou a daily recebe uma mensagem direta no Slack, no máximo uma vez por dia. Hoje, o `remind_at` é validado, mas nada é enviado.

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

## Encaminhamento de impedimentos <Badge type="info" text="em breve" />

Em breve: quando uma daily tiver um impedimento, o Standwise vai mandar uma mensagem direta para quem pode ajudar, nesta ordem:

1. impedimento ligado a um pull request vai para os revisores solicitados, ou para os CODEOWNERS dos arquivos alterados quando não houver revisor;
2. impedimento ligado a um card vai para o responsável pelo card do qual ele depende ("blocked by"), ou para o responsável ou criador do próprio card;
3. senão, para os gestores do time.

Hoje, os impedimentos aparecem no topo do consolidado, no webhook `blocker.opened` e nas tools de gestor.

## Impedimentos sugeridos <Badge type="info" text="em breve" />

Em breve: o Standwise vai sugerir impedimentos que você pode não ter percebido, como um pull request sem revisão há mais de `pr_review_hours` ou um card em andamento há mais de `card_stale_days`. As sugestões vão só para você. Hoje o rascunho sempre devolve a lista `suggestions` vazia.

## Fuso, dias úteis e vários times

- **Todos os horários são no fuso do time.** `remind_at` e `digest_at` são horários locais, `HH:MM`, 24 horas.
- **Consolidados só em dias úteis.** Com `workdays: [mon, tue, wed, thu, fri]`, não há consolidado no sábado nem no domingo.
- **A data da daily segue o seu primeiro time.** "Hoje" e "dia útil anterior" usam o fuso e os dias úteis do primeiro time do `standwise.yml` que lista você. Uma daily enviada num dia de folga conta para o próximo dia útil.
- **Uma daily, todos os times.** Se você está em dois times, a sua daily aparece nos dois consolidados. Você escreve uma vez.
- **Uma daily por organização.** Se você está em duas organizações que usam o Standwise, escreve uma daily para cada. A CLI e as tools do MCP perguntam qual, ou recebem `--org` / `org`.
- **Mudanças no arquivo.** O Standwise recarrega o `standwise.yml` quando um push na branch padrão do repositório `.github` altera o arquivo. Se um push deixar o arquivo inválido, o Standwise continua usando a última versão válida até você corrigir: o consolidado sai, e o rascunho e o envio continuam funcionando. Apagar o arquivo desliga o Standwise para a organização. Sem uma versão válida em uso, o rascunho e o envio recebem `org_not_configured`. Veja [Instalação](/pt-BR/admin/install#estados-da-configuracao).
