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
