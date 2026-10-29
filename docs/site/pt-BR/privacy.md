# Privacidade

O que o Standwise lê, o que guarda, o que nunca faz e quem vê o quê. Esta página descreve o serviço como ele funciona hoje.

## Sem IA do nosso lado

Nenhum LLM processa os seus dados nos servidores do Standwise. O rascunho é montado com buscas simples no GitHub, e o consolidado é montado com o que as pessoas confirmaram. Quando você escreve a daily com um agente de IA, esse agente roda na sua máquina, com a sua conta no provedor dele. O Standwise não vê essa conversa.

## O que o Standwise lê

### GitHub

O Standwise usa as permissões do GitHub App dele: Metadata (read), Contents (read), Pull requests (read), Checks (write), Commit statuses (read), Members (read) e a permissão de conta Email addresses (read). Com elas, ele lê:

- o `standwise.yml` do repositório `.github` do dono da instalação;
- os membros dos times do GitHub citados no `standwise.yml` (`@org/time`);
- a participação e o papel na organização, para saber quem é membro e quem é admin;
- para a pessoa que pede o rascunho: títulos, links, repositórios e datas dos pull requests que ela abriu, mergeou e revisou, e dos commits de autoria dela, na organização;
- quando você entra: o seu id de usuário no GitHub, o seu login, o seu e-mail principal verificado e as instalações que você acessa.

Ele não lê o conteúdo do seu código nem outros arquivos além do `standwise.yml`. A permissão Checks (write) está reservada para o check run da configuração, que vem em breve. O Standwise não escreve nos seus repositórios.

### Slack

O token do bot do app do Slack permite que o Standwise:

- busque um usuário do Slack pelo e-mail, para mencionar as pessoas no consolidado;
- liste canais, para transformar `#canal` no id do canal;
- publique o consolidado e as respostas na thread dele.

Ele não lê mensagens de nenhum canal ou conversa.

### Linear e Jira <Badge type="info" text="em breve" />

O Standwise ainda não se conecta ao Linear nem ao Jira, então não lê nada deles.

## O que o Standwise guarda

| Dado | O que fica guardado | Proteção |
| --- | --- | --- |
| Instalação | Id da instalação no GitHub, login, tipo e id da conta, estado da configuração, o `standwise.yml` interpretado e os erros de validação | |
| Pessoa | Id de usuário no GitHub, login e e-mail principal verificado | |
| Participação em organizações | A quais instalações cada pessoa pertence | |
| Identidade no Slack | O id de usuário do Slack de cada pessoa, por instalação | |
| Conexão com o Slack | Id e nome do workspace e o token do bot | Token do bot criptografado com AES-256-GCM |
| Sessões | Um hash SHA-256 de cada token de sessão da CLI e da web, o tipo e quando foi criada e usada pela última vez | Só o hash; o token em si nunca é guardado |
| Dailies | Data, horário do envio, os itens de ontem, hoje e impedimentos com os links, e se quem confirmou foi a pessoa (`human`) ou o agente (`agent`) | |
| Entregas | Para cada consolidado e daily atrasada: time, data, estado, tentativas, o canal e o id da mensagem no Slack e o erro, se falhou | |
| API keys | Nome, os 8 primeiros caracteres depois de `swk_`, escopos, quem criou, datas de criação, último uso e revogação | Só um hash SHA-256 do segredo |
| Endpoints de webhook | URL, eventos, estado e número de falhas | Segredo de assinatura criptografado com AES-256-GCM |
| Entregas de webhook | O payload do evento enviado (que pode conter o texto da daily), estado, tentativas, último código de resposta ou erro | |
| Limites de taxa | Um contador por credencial ou endereço IP por minuto | Linhas apagadas depois de uns 10 minutos |

O token do GitHub do seu login é usado uma vez para identificar você e não é guardado. As chaves de criptografia ficam no ambiente do servidor, não no banco.

## O que o Standwise nunca faz

- Enviar uma daily sem a confirmação explícita da pessoa.
- Mostrar a alguém um rascunho ou uma sugestão que a pessoa não confirmou.
- Calcular ranking, nota, métrica de produtividade ou agregado por pessoa.
- Ler o seu código, as suas mensagens no Slack ou as suas mensagens diretas.
- Escrever nos seus repositórios.
- Mandar os seus dados para um modelo de IA.
- Vender ou compartilhar os seus dados com terceiros.

## Quem vê o quê

| Quem | Vê |
| --- | --- |
| Você | O seu rascunho e as suas dailies, pelo seu agente |
| Membros do canal do time no Slack | O consolidado e as dailies atrasadas na thread dele |
| Gestores do time | Os consolidados, as dailies e os impedimentos confirmados do time nos últimos 90 dias, pelas tools de gestor do MCP |
| Admins da organização | Tudo o que os gestores veem, de todos os times; API keys e webhooks na página de setup |
| Membros da organização que entram na página de setup | O estado da configuração, o nome do workspace do Slack e as últimas entregas com falha |
| Sistemas com uma API key | Times, dailies confirmadas, consolidados e impedimentos, limitados pelos escopos da key |
| Endpoints de webhook | Os eventos que assinaram |

## Retenção

Hoje o Standwise não apaga dailies de forma programada. Dailies, entregas e entregas de webhook ficam guardadas enquanto o app estiver instalado. Os contadores de limite de taxa são apagados depois de uns 10 minutos. As sessões da CLI param de funcionar depois de 90 dias sem uso, e as sessões da web depois de 7 dias.

## Remoção dos dados

- **Desinstale o GitHub App.** O Standwise apaga a instalação e tudo o que pertence a ela: configuração, dailies, entregas, conexão com o Slack e identidades, API keys, endpoints de webhook e as entregas deles.
- **Saia.** O `standwise logout` revoga a sua sessão da CLI no servidor e apaga o arquivo local de credenciais.
- **O seu cadastro de pessoa.** O seu id de usuário no GitHub, o login e o e-mail não pertencem a uma instalação só, então desinstalar não os remove. Para apagá-los, mande um e-mail ao suporte.

## Contato

Dúvidas ou pedidos de remoção: <SupportEmail />.
