# Instalação

Configure o Standwise na sua organização em quatro passos. Você precisa ser dono da organização do GitHub (ou da conta pessoal) para instalar o app.

## 1. Instale o GitHub App

Na página do GitHub App do Standwise, clique em **Install** e escolha a organização ou a conta pessoal.

Escolha **All repositories**, ou **Only select repositories** incluindo o repositório `.github`. O Standwise lê a configuração desse repositório. Se ele ainda não existe, você pode criá-lo no passo 4 e liberá-lo para o app depois.

O app pede estas permissões:

| Permissão | Acesso | Para quê |
| --- | --- | --- |
| Metadata | read | Exigida pelo GitHub para todo app |
| Contents | read | Ler o `standwise.yml` |
| Pull requests | read | Montar o rascunho a partir de pull requests e revisões |
| Checks | write | Reservada para o check run da configuração, em breve |
| Commit statuses | read | Reservada para os impedimentos sugeridos, em breve |
| Members | read | Resolver times do GitHub (`@org/time`) e conferir participação e papel |
| Email addresses (conta) | read | Ligar cada pessoa ao usuário dela no Slack pelo e-mail |

## 2. Abra a página de setup

Depois da instalação, o GitHub leva você para a página de setup do Standwise. Entre com o GitHub quando pedir. O endereço da página é `/setup?installation_id=<id>` na API do Standwise.

Qualquer membro da organização que entrar pode abrir a página de setup. Só admins podem conectar ou reconectar o Slack, e só admins veem as seções **API keys** e **Webhooks**. Admin é quem é admin da organização no GitHub, ou o dono da conta, numa conta pessoal.

A página mostra:

- a organização e o estado do `standwise.yml`;
- um botão para criar o arquivo a partir de um modelo, e o próprio modelo;
- a conexão com o Slack, com **Conectar Slack** ou **Reconectar Slack** para admins;
- as 5 últimas entregas com falha, com time, data e erro;
- para admins, as API keys e os webhooks.

## 3. Conecte o Slack

Um admin clica em **Conectar Slack** e aprova o app no workspace do Slack. A página passa a mostrar "Conectado ao workspace" e o nome do workspace, e um botão **Reconectar Slack** para conectar de novo. Os outros membros veem a conexão só para leitura, com "Peça a um admin para conectar o Slack." enquanto não estiver conectado. Veja [Slack](/pt-BR/admin/slack) para as permissões e os canais privados.

## 4. Crie o `standwise.yml`

Clique em **Criar standwise.yml com o modelo**. O GitHub abre o editor na branch padrão do repositório `.github`, com o arquivo já preenchido. O modelo usa o seu login como gestor e membro:

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

O Standwise recarrega o arquivo a cada push na branch padrão do `.github` que altera o `standwise.yml`, e quando os repositórios da instalação mudam. Atualize a página de setup para ver o novo estado.

## Estados da configuração

A página de setup mostra um de três estados.

### Configurado

"Configurado." O Standwise está funcionando: as pessoas podem enviar dailies e os consolidados saem.

### Não configurado

"Ainda não configurado." O Standwise não encontrou o arquivo. Apagar o arquivo desliga o Standwise para a organização: a configuração anterior é descartada, então um arquivo inválido depois não a traz de volta. A página mostra o motivo:

| Motivo | Significado | Como resolver |
| --- | --- | --- |
| `no_repo` | O repositório `.github` não existe. | Crie o repositório, adicione o `standwise.yml` e confira se o app tem acesso a ele. |
| `no_file` | O `standwise.yml` não está na raiz do `.github`, na branch padrão. | Crie o arquivo lá. Um arquivo numa subpasta ou em outra branch não é lido. |
| `no_access` | O Standwise não tem acesso ao repositório `.github`. | Nas configurações da instalação do app no GitHub, adicione o `.github` aos repositórios selecionados, ou escolha todos os repositórios. |

### Inválido

"O standwise.yml é inválido. Corrija os erros abaixo e faça o commit." A página lista cada erro como `caminho: mensagem`, por exemplo `teams.0.digest_at: must be HH:MM (24h)`. Veja os [erros comuns](/pt-BR/admin/configuration#erros-de-validacao-comuns).

Se o arquivo estava válido logo antes do push inválido, a página também diz "O Standwise continua usando a última versão válida até você corrigir." O consolidado sai e o rascunho e o envio continuam funcionando, com a última versão válida. Corrija o arquivo e faça o commit para aplicar as suas mudanças. Se não há uma versão válida em uso (o arquivo nunca foi válido, ou foi apagado antes do push inválido), o Standwise não roda para a organização: nenhum consolidado é publicado, e o rascunho e o envio falham com `org_not_configured`.

Em breve: um check run com falha no commit que quebra o `standwise.yml` e nos pull requests que o alteram.

## Próximos passos

- Peça a cada membro para seguir os [Primeiros passos](/pt-BR/members/getting-started). As pessoas são ligadas ao usuário do Slack quando entram, então elas devem entrar depois que o Slack estiver conectado.
- Crie [API keys](/pt-BR/admin/api-keys) ou [webhooks](/pt-BR/admin/webhooks) se outros sistemas precisarem dos dados.
