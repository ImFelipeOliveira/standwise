# Instalação

Configure o Standwise na sua organização em quatro passos. Você precisa ser dono da organização do GitHub (ou da conta pessoal) para instalar o app.

## 1. Instale o GitHub App

Na [página do GitHub App do Standwise](https://github.com/apps/standwise-daily/installations/new), clique em **Install** e escolha a organização ou a conta pessoal.

Escolha **All repositories**, ou **Only select repositories** incluindo o repositório `.github`. O Standwise lê a configuração desse repositório. Se ele ainda não existe, você pode criá-lo no passo 4 e liberá-lo para o app depois.

O app pede estas permissões:

| Permissão | Acesso | Para quê |
| --- | --- | --- |
| Metadata | read | Exigida pelo GitHub para todo app |
| Contents | read | Ler o `standwise.yml` |
| Pull requests | read | Montar o rascunho a partir de pull requests e revisões |
| Checks | write | Criar o check run `Standwise config` no `standwise.yml` |
| Commit statuses | read | Ler os resultados dos checks dos pull requests, para os impedimentos sugeridos |
| Members | read | Resolver times do GitHub (`@org/time`) e conferir participação e papel |
| Email addresses (conta) | read | Ligar cada pessoa ao usuário dela no Slack pelo e-mail |

## 2. Abra a página de setup

Depois da instalação, o GitHub leva você para a página de setup do Standwise. Entre com o GitHub quando pedir. O endereço da página é `/setup?installation_id=<id>` na API do Standwise.

Qualquer membro da organização que entrar pode abrir a página de setup. Só admins podem conectar ou reconectar o Slack e o Linear, e só admins veem as seções **API keys** e **Webhooks**. Admin é quem é admin da organização no GitHub, ou o dono da conta, numa conta pessoal.

A página é uma lista de etapas. Um selo no topo conta as etapas, por exemplo **2 de 3 etapas concluídas**, e fica verde quando todas estão concluídas. Cada etapa tem um ícone de estado (um visto quando concluída, o número dela enquanto pendente, um x quando requer atenção) e um selo:

- **GitHub App**: instalado na sua organização, com um aviso quando o Standwise perdeu o acesso ao `.github`;
- **Slack**: **Conectar Slack**, ou **Reconectar Slack** depois de conectado, para admins;
- **Linear**: **Conectar o Linear**, ou **Reconectar o Linear** depois de conectado, para admins. Só conta como etapa quando algum time usa o Linear, e aí vem antes do arquivo standwise.yml. Nos outros casos, mostra **Opcional** e vem por último;
- **Arquivo standwise.yml**: o estado do arquivo. Quando ele não existe, um botão para criá-lo a partir de um modelo, e o próprio modelo. Quando existe, **Editar no GitHub**, mesmo com o arquivo inválido. Um arquivo válido mostra também um cartão por time, com o canal e os horários, e um inválido, uma tabela com os erros.

A coluna lateral mostra as últimas entregas com falha e, para admins, as API keys e os webhooks, e depois o endereço de suporte.

## 3. Conecte o Slack

Um admin clica em **Conectar Slack** e aprova o app no workspace do Slack. A etapa do Slack passa a mostrar um visto, o selo **Conectado** e "Conectado a" com o nome do workspace, e um botão **Reconectar Slack** para conectar de novo. Os outros membros veem a conexão só para leitura. Enquanto o Slack ainda não está conectado, eles veem "Só um admin pode conectar ou reconectar o Slack." Veja [Slack](/pt-BR/admin/slack) para as permissões e os canais privados.

## 4. Crie o `standwise.yml`

Na etapa **Arquivo standwise.yml**, clique em **Criar standwise.yml com o modelo**. O GitHub abre o editor na branch padrão do repositório `.github`, com o arquivo já preenchido. O modelo usa o seu login como gestor e membro:

```text
teams:
  - name: Time
    language: pt-BR
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [seu-login]
    members: [seu-login]
    chat:
      provider: slack
      channel: "#daily"
```

Troque o nome do time, o fuso, os horários, as pessoas e o canal e faça o commit. O arquivo tem que ficar na **raiz** do repositório `.github`, na branch padrão. Se o repositório `.github` não existir, a página mostra **Criar o repositório .github**, que abre o formulário de novo repositório do GitHub com o nome preenchido.

Referência completa: [standwise.yml](/pt-BR/admin/configuration).

O Standwise recarrega o arquivo a cada push na branch padrão do `.github` que altera o `standwise.yml`, e quando os repositórios da instalação mudam. Atualize a página de setup para ver o novo estado. Quando o arquivo existe, a etapa mostra **Editar no GitHub**, que abre o `standwise.yml` no GitHub, mesmo com o arquivo inválido.

## 5. Conecte o Linear (opcional)

Pule este passo se os seus times não usam o Linear. Um admin clica em **Conectar o Linear** na etapa do Linear da página de setup e aprova o app no workspace do Linear. A etapa passa a mostrar `Conectado ao workspace <workspace>.` e um botão **Reconectar o Linear**.

- A conexão é só leitura (escopo `read`) e o app age como ele mesmo, não como o admin. Há um workspace do Linear por instalação. Os tokens são criptografados e renovados automaticamente.
- Só um admin pode conectar ou reconectar o Linear. Enquanto o Linear não está conectado, ou parou de funcionar, os outros membros veem "Só um admin pode conectar ou reconectar o Linear."
- Se o acesso ao Linear for revogado, a etapa mostra o selo **Requer atenção**, "O Linear parou de funcionar", `A conexão com o workspace <workspace> parou de funcionar. Reconecte o Linear.` e **Reconectar o Linear**. Até lá, os recursos do Linear pausam em silêncio: os rascunhos ficam sem cards, os impedimentos de card vão para os gestores e as sugestões de card ficam como estão.
- Reconectar um workspace diferente apaga as ligações com o Linear da instalação. As pessoas são ligadas de novo quando entram e sempre que o `standwise.yml` muda.
- A página avisa "Este time usa o Linear, mas o Linear ainda não está conectado a esta instalação." quando um time tem `tracker.provider: linear` e o Linear não está conectado. Para `tracker.provider: jira`, mostra "A integração com o Jira ainda não está disponível."

Depois, defina o tracker de cada time no `standwise.yml`. Veja [`tracker`](/pt-BR/admin/configuration#tracker) e [Mapeamento de identidades](/pt-BR/admin/configuration#mapeamento-de-identidades). O que o Standwise lê está em [Privacidade](/pt-BR/privacy#linear).

## Estados da configuração

A etapa **Arquivo standwise.yml** mostra um de três estados.

### Configurado

O selo **Configurado**. O Standwise está funcionando: as pessoas podem enviar dailies e os consolidados saem.

### Não configurado

O selo **Pendente** e "Ainda não configurado." O Standwise não encontrou o arquivo. Apagar o arquivo, ou apagar o repositório `.github`, desliga o Standwise para a organização: a configuração anterior é descartada, então um arquivo inválido depois não a traz de volta. A página mostra o motivo:

| Motivo | Significado | Como resolver |
| --- | --- | --- |
| `no_repo` | O repositório `.github` não existe. | Crie o repositório, adicione o `standwise.yml` e confira se o app tem acesso a ele. |
| `no_file` | O `standwise.yml` não está na raiz do `.github`, na branch padrão. | Crie o arquivo lá. Um arquivo numa subpasta ou em outra branch não é lido. |
| `no_access` | O Standwise não tem acesso ao repositório `.github`, e ainda não havia configuração. | Nas configurações da instalação do app no GitHub, adicione o `.github` aos repositórios selecionados, ou escolha todos os repositórios. |

`no_access` é um aviso quando já há uma configuração em uso. O GitHub pode negar o acesso por um momento, por exemplo por limite de requisições, ou porque o `.github` saiu dos repositórios selecionados. O Standwise então mantém a configuração e o estado atuais, e a página de setup mostra "O Standwise não tem acesso ao repositório .github. O Standwise continua usando a configuração atual." junto de qualquer estado. O aviso some na próxima leitura bem-sucedida do `standwise.yml`, válida ou inválida. Dê de novo ao app acesso ao `.github` para limpar o aviso.

### Inválido

O selo **Requer atenção** e "O standwise.yml é inválido. Corrija os erros abaixo e faça o commit." A página lista os erros numa tabela com as colunas **Caminho** e **Erro**, por exemplo o caminho `teams.0.digest_at` com o erro `must be HH:MM (24h)`. Use **Editar no GitHub** para abrir o arquivo e corrigi-lo. Veja os [erros comuns](/pt-BR/admin/configuration#erros-de-validacao-comuns).

Se o arquivo estava válido logo antes do push inválido, a página também diz "O Standwise continua usando a última versão válida até você corrigir." O consolidado sai e o rascunho e o envio continuam funcionando, com a última versão válida. Corrija o arquivo e faça o commit para aplicar as suas mudanças. Se não há uma versão válida em uso (o arquivo nunca foi válido, ou foi apagado antes do push inválido), o Standwise não roda para a organização: nenhum consolidado é publicado, e o rascunho e o envio falham com `org_not_configured`.

Quando um push em qualquer branch do repositório `.github` altera o `standwise.yml`, e nos pull requests do `.github` que o alteram, o Standwise cria o check run `Standwise config`, com sucesso ou falha. Na falha há uma anotação por erro, na linha dele, e o resumo lista todos os erros. Se o arquivo não existe, não há check. Qualquer push na branch padrão recarrega a configuração, inclusive force push.

## Próximos passos

- Peça a cada membro para seguir os [Primeiros passos](/pt-BR/members/getting-started). As pessoas são ligadas ao usuário do Slack quando entram, então elas devem entrar depois que o Slack estiver conectado.
- Se você usa o Linear, peça a cada membro para entrar depois que o Linear estiver conectado, para o usuário dele no Linear ser ligado.
- Crie [API keys](/pt-BR/admin/api-keys) ou [webhooks](/pt-BR/admin/webhooks) se outros sistemas precisarem dos dados.
