import type { Language } from './config';

const ptBR = {
  digestTitle: 'Daily — {team} — {date}',
  blockers: 'Impedimentos',
  yesterday: 'Ontem',
  today: 'Hoje',
  missing: 'Não enviaram a daily:',
  lateDaily: 'Daily enviada depois do consolidado:',
  'web.setup.title': 'Configuração do Standwise',
  'web.setup.heading': 'Configuração',
  'web.setup.organization': 'Organização',
  'web.setup.configTitle': 'Arquivo standwise.yml',
  'web.setup.configOk': 'Configurado.',
  'web.setup.configInvalid': 'O standwise.yml é inválido. Corrija os erros abaixo e faça o commit.',
  'web.setup.configMissing': 'Ainda não configurado.',
  'web.setup.reason': 'Motivo',
  'web.setup.reason.no_repo': 'O repositório .github não existe.',
  'web.setup.reason.no_file': 'O arquivo standwise.yml não existe na raiz do repositório .github.',
  'web.setup.reason.no_access': 'O Standwise não tem acesso ao repositório .github.',
  'web.setup.instruction':
    'Crie o arquivo standwise.yml na raiz do repositório .github da organização, na branch padrão.',
  'web.setup.createFile': 'Criar standwise.yml com o modelo',
  'web.setup.createRepo': 'Criar o repositório .github',
  'web.setup.template': 'Modelo do standwise.yml',
  'web.setup.failedTitle': 'Últimas entregas com falha',
  'web.setup.noFailed': 'Nenhuma entrega com falha.',
  'web.setup.team': 'Time',
  'web.setup.date': 'Data',
  'web.setup.error': 'Erro',
  'web.setup.support': 'Suporte',
  'web.slack.title': 'Slack',
  'web.slack.connect': 'Conectar Slack',
  'web.slack.connected': 'Conectado ao workspace',
  'web.template.teamName': 'Time',
  'web.error.signIn': 'Entrar com o GitHub',
  'web.error.refresh': 'Atualizar a página',
  'web.error.generic.title': 'Algo deu errado',
  'web.error.generic.body': 'Não foi possível concluir esta ação. Tente novamente em instantes.',
  'web.error.unauthorized.title': 'Login necessário',
  'web.error.unauthorized.body': 'Entre com o GitHub para continuar.',
  'web.error.forbidden.title': 'Acesso negado',
  'web.error.forbidden.body': 'Você não tem acesso a esta instalação do Standwise.',
  'web.error.invalid_state.title': 'Link expirado ou inválido',
  'web.error.invalid_state.body': 'O link de autorização expirou ou é inválido. Entre novamente.',
  'web.error.access_denied.title': 'Autorização negada',
  'web.error.access_denied.body': 'O acesso foi negado. Nada foi alterado.',
  'web.error.installation_pending.title': 'Instalação em processamento',
  'web.error.installation_pending.body':
    'Esta instalação ainda está sendo processada. Atualize a página em alguns segundos.',
  'web.error.slack_oauth_failed.title': 'Falha ao conectar o Slack',
  'web.error.slack_oauth_failed.body':
    'Não foi possível concluir a conexão com o Slack. Tente conectar novamente.',
} as const;

const en = {
  digestTitle: 'Daily — {team} — {date}',
  blockers: 'Blockers',
  yesterday: 'Yesterday',
  today: 'Today',
  missing: 'Did not send the daily:',
  lateDaily: 'Daily sent after the digest:',
  'web.setup.title': 'Standwise setup',
  'web.setup.heading': 'Setup',
  'web.setup.organization': 'Organization',
  'web.setup.configTitle': 'standwise.yml file',
  'web.setup.configOk': 'Configured.',
  'web.setup.configInvalid': 'standwise.yml is invalid. Fix the errors below and commit.',
  'web.setup.configMissing': 'Not configured yet.',
  'web.setup.reason': 'Reason',
  'web.setup.reason.no_repo': 'The .github repository does not exist.',
  'web.setup.reason.no_file': 'standwise.yml does not exist at the root of the .github repository.',
  'web.setup.reason.no_access': 'Standwise has no access to the .github repository.',
  'web.setup.instruction':
    "Create standwise.yml at the root of the organization's .github repository, on the default branch.",
  'web.setup.createFile': 'Create standwise.yml from the template',
  'web.setup.createRepo': 'Create the .github repository',
  'web.setup.template': 'standwise.yml template',
  'web.setup.failedTitle': 'Latest failed deliveries',
  'web.setup.noFailed': 'No failed deliveries.',
  'web.setup.team': 'Team',
  'web.setup.date': 'Date',
  'web.setup.error': 'Error',
  'web.setup.support': 'Support',
  'web.slack.title': 'Slack',
  'web.slack.connect': 'Connect Slack',
  'web.slack.connected': 'Connected to workspace',
  'web.template.teamName': 'Team',
  'web.error.signIn': 'Sign in with GitHub',
  'web.error.refresh': 'Refresh the page',
  'web.error.generic.title': 'Something went wrong',
  'web.error.generic.body': 'We could not complete this action. Please try again shortly.',
  'web.error.unauthorized.title': 'Login required',
  'web.error.unauthorized.body': 'Sign in with GitHub to continue.',
  'web.error.forbidden.title': 'Access denied',
  'web.error.forbidden.body': 'You do not have access to this Standwise installation.',
  'web.error.invalid_state.title': 'Link expired or invalid',
  'web.error.invalid_state.body': 'The authorization link expired or is invalid. Sign in again.',
  'web.error.access_denied.title': 'Authorization denied',
  'web.error.access_denied.body': 'Access was denied. Nothing was changed.',
  'web.error.installation_pending.title': 'Installation in progress',
  'web.error.installation_pending.body':
    'This installation is still being processed. Refresh the page in a few seconds.',
  'web.error.slack_oauth_failed.title': 'Slack connection failed',
  'web.error.slack_oauth_failed.body':
    'We could not complete the Slack connection. Please try connecting again.',
} as const satisfies Record<keyof typeof ptBR, string>;

const messages: {
  'pt-BR': Record<keyof typeof en, string>;
  en: Record<keyof typeof ptBR, string>;
} = { 'pt-BR': ptBR, en };

export type MessageKey = keyof typeof ptBR;

export function t(
  lang: Language,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  const template = messages[lang][key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export function formatDate(lang: Language, isoDate: string): string {
  if (lang !== 'pt-BR') return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}
