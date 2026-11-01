import { type DefaultTheme, defineConfigWithTheme } from 'vitepress';
import llmstxt from 'vitepress-plugin-llms';
import { writeSiteHeaders } from '../../../scripts/docs-headers';
import { writeLocaleLlms } from '../../../scripts/docs-llms';
import { publicUrlPlugin, resolvePublicUrl } from '../../../scripts/docs-public-url';

const supportEmail = process.env.SUPPORT_EMAIL?.trim();
if (!supportEmail) {
  throw new Error('SUPPORT_EMAIL must be set to build the documentation site');
}

const publicUrl = resolvePublicUrl(process.env.STANDCAST_PUBLIC_URL?.trim());

type ThemeConfig = DefaultTheme.Config & { supportEmail: string };

const DOCS_DOMAIN = 'https://docs-standcast.usefachada.dev';

const API_REFERENCE = { link: `${publicUrl}/reference`, target: '_self' };

function sidebar(prefix: string, labels: Record<string, string>): DefaultTheme.SidebarItem[] {
  return [
    {
      text: labels.introduction,
      items: [
        { text: labels.overview, link: `${prefix}/` },
        { text: labels.concepts, link: `${prefix}/concepts` },
        { text: labels.howItWorks, link: `${prefix}/how-it-works` },
        { text: labels.privacy, link: `${prefix}/privacy` },
      ],
    },
    {
      text: labels.admins,
      items: [
        { text: labels.install, link: `${prefix}/admin/install` },
        { text: labels.configuration, link: `${prefix}/admin/configuration` },
        { text: 'Slack', link: `${prefix}/admin/slack` },
        { text: labels.apiKeys, link: `${prefix}/admin/api-keys` },
        { text: 'Webhooks', link: `${prefix}/admin/webhooks` },
      ],
    },
    {
      text: labels.members,
      items: [
        { text: labels.gettingStarted, link: `${prefix}/members/getting-started` },
        { text: 'CLI', link: `${prefix}/members/cli` },
        { text: labels.claudeCode, link: `${prefix}/members/claude-code` },
        { text: labels.mcp, link: `${prefix}/members/mcp` },
      ],
    },
    {
      text: 'API',
      items: [
        { text: labels.apiOverview, link: `${prefix}/api/overview` },
        { text: 'Webhooks', link: `${prefix}/api/webhooks` },
        { text: labels.apiReference, ...API_REFERENCE },
      ],
    },
    {
      text: labels.more,
      items: [
        { text: 'FAQ', link: `${prefix}/faq` },
        { text: labels.troubleshooting, link: `${prefix}/troubleshooting` },
        { text: 'Changelog', link: `${prefix}/changelog` },
      ],
    },
  ];
}

const en = {
  introduction: 'Introduction',
  overview: 'Overview',
  concepts: 'Concepts',
  howItWorks: 'How it works',
  privacy: 'Privacy',
  admins: 'For admins',
  install: 'Install',
  configuration: 'standcast.yml reference',
  apiKeys: 'API keys',
  members: 'For members',
  gettingStarted: 'Getting started',
  claudeCode: 'Claude Code skill',
  mcp: 'MCP server',
  apiOverview: 'Overview',
  apiReference: 'API reference',
  more: 'More',
  troubleshooting: 'Troubleshooting',
};

const ptBR = {
  introduction: 'Introdução',
  overview: 'Visão geral',
  concepts: 'Conceitos',
  howItWorks: 'Como funciona',
  privacy: 'Privacidade',
  admins: 'Para admins',
  install: 'Instalação',
  configuration: 'Referência do standcast.yml',
  apiKeys: 'API keys',
  members: 'Para membros',
  gettingStarted: 'Primeiros passos',
  claudeCode: 'Skill do Claude Code',
  mcp: 'Servidor MCP',
  apiOverview: 'Visão geral',
  apiReference: 'Referência da API',
  more: 'Mais',
  troubleshooting: 'Solução de problemas',
};

export default defineConfigWithTheme<ThemeConfig>({
  title: 'Standcast',
  base: '/',
  srcExclude: ['README.md'],
  lastUpdated: false,
  ignoreDeadLinks: false,
  buildEnd: async (siteConfig) => {
    await writeLocaleLlms(siteConfig.outDir, DOCS_DOMAIN);
    await writeSiteHeaders(siteConfig.outDir);
  },
  vite: {
    plugins: [
      llmstxt({
        domain: DOCS_DOMAIN,
        injectLLMHint: false,
        ignoreFiles: ['pt-BR/index.md'],
        ignoreFilesPerOutput: { llmsTxt: ['pt-BR/**'], llmsFullTxt: ['pt-BR/**'] },
        customLLMsTxtTemplate: `# {title}\n\n> {description}\n\n## Table of Contents\n\n{toc}\n\n## Optional\n\n- [Português (Brasil)](${DOCS_DOMAIN}/pt-BR/llms.txt): the documentation in Portuguese\n`,
      }),
    ],
  },
  markdown: {
    config: (md) => {
      publicUrlPlugin(publicUrl)(md);
    },
  },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]],
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      description: 'Standcast orchestrates your team daily standup from GitHub to Slack.',
      themeConfig: {
        nav: [
          { text: 'Docs', link: '/' },
          { text: en.apiReference, ...API_REFERENCE },
        ],
        sidebar: sidebar('', en),
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
      },
    },
    'pt-BR': {
      label: 'Português (Brasil)',
      lang: 'pt-BR',
      link: '/pt-BR/',
      description: 'O Standcast orquestra a daily do seu time, do GitHub ao Slack.',
      themeConfig: {
        nav: [
          { text: 'Docs', link: '/pt-BR/' },
          { text: ptBR.apiReference, ...API_REFERENCE },
        ],
        sidebar: sidebar('/pt-BR', ptBR),
        outline: { label: 'Nesta página' },
        docFooter: { prev: 'Anterior', next: 'Próxima' },
        darkModeSwitchLabel: 'Aparência',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Voltar ao topo',
        langMenuLabel: 'Idioma',
        notFound: {
          title: 'PÁGINA NÃO ENCONTRADA',
          quote: 'Esta página não existe.',
          linkLabel: 'Ir para o início',
          linkText: 'Voltar ao início',
        },
      },
    },
  },
  themeConfig: {
    supportEmail,
    logo: '/logo.svg',
    siteTitle: 'Standcast',
    socialLinks: [{ icon: 'github', link: 'https://github.com/ImFelipeOliveira/standcast' }],
    search: {
      provider: 'local',
      options: {
        locales: {
          'pt-BR': {
            translations: {
              button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
              modal: {
                displayDetails: 'Mostrar detalhes',
                resetButtonTitle: 'Limpar busca',
                backButtonTitle: 'Fechar busca',
                noResultsText: 'Nenhum resultado para',
                footer: {
                  selectText: 'selecionar',
                  navigateText: 'navegar',
                  closeText: 'fechar',
                },
              },
            },
          },
        },
      },
    },
  },
});
