import { describe, expect, test } from 'bun:test';
import type { Language } from '@standwise/core';
import type { SetupStatus } from '@standwise/orchestrator';
import { ErrorPage } from '../src/web/error';
import { PAGE_CSS } from '../src/web/layout';
import { SetupPage } from '../src/web/setup';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  Code,
  Icon,
  ScrollTable,
  StepStatus,
  SubmitButton,
} from '../src/web/ui';

const render = async (node: unknown) => String(await (node as { toString(): unknown }).toString());

const TOKENS = ['--background', '--foreground', '--primary', '--border', '--muted-foreground'];

function block(css: string, pattern: RegExp): Record<string, string> {
  const body = pattern.exec(css)?.[1] ?? '';
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1] as string] = (match[2] as string).trim();
  }
  return tokens;
}

const light = () => block(PAGE_CSS, /^:root\s*\{([^}]*)\}/m);
const dark = () =>
  block(PAGE_CSS, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/);

function luminance(hex: string): number {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) throw new Error(`not a hex color: ${hex}`);
  const channels = [0, 2, 4].map((i) => {
    const c = Number.parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['--foreground', '--background'],
  ['--foreground', '--card'],
  ['--muted-foreground', '--card'],
  ['--muted-foreground', '--background'],
  ['--primary', '--card'],
  ['--primary-foreground', '--primary'],
  ['--primary-foreground', '--primary-hover'],
  ['--danger-foreground', '--danger'],
  ['--success-text', '--success-bg'],
  ['--warning-text', '--warning-bg'],
  ['--danger-text', '--danger-bg'],
  ['--info-text', '--info-bg'],
  ['--neutral-text', '--neutral-bg'],
  ['--muted-foreground', '--muted'],
];

describe('design tokens', () => {
  test('the light palette defines the core tokens with the global constraint colors', () => {
    const tokens = light();
    for (const name of TOKENS) expect(tokens[name]).toBeDefined();
    expect(tokens['--background']).toBe('#F8FAFC');
    expect(tokens['--card']).toBe('#FFFFFF');
    expect(tokens['--foreground']).toBe('#0F172A');
    expect(tokens['--muted-foreground']).toBe('#475569');
    expect(tokens['--border']).toBe('#E2E8F0');
    expect(tokens['--primary']).toBe('#3B4BC8');
    expect(tokens['--primary-hover']).toBe('#2A3796');
    expect(tokens['--success']).toBe('#16A34A');
    expect(tokens['--danger']).toBe('#B91C1C');
    expect(tokens['--step-todo']).toBe('#64748B');
  });

  test('a dark block redefines every core token', () => {
    expect(PAGE_CSS).toContain('prefers-color-scheme: dark');
    const tokens = dark();
    for (const name of TOKENS) expect(tokens[name]).toBeDefined();
    expect(tokens['--background']).toBe('#0B1120');
    expect(tokens['--card']).toBe('#111827');
    expect(tokens['--foreground']).toBe('#E2E8F0');
    const colors = Object.entries(light()).filter(([, value]) => value.startsWith('#'));
    for (const [name] of colors) expect(tokens[name]).toMatch(/^#[0-9A-F]{6}$/);
  });

  for (const [mode, read] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    test(`the ${mode} palette meets 4.5:1 for every text pair`, () => {
      const tokens = read();
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrast(tokens[fg] ?? '', tokens[bg] ?? '');
        if (ratio < 4.5) throw new Error(`${mode} ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
      }
    });
  }

  test('components and rules use tokens, and the css loads nothing external', () => {
    const rules = PAGE_CSS.replace(/:root\s*\{[^}]*\}/g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(PAGE_CSS).not.toMatch(/url\(|@import|https?:/);
    expect(PAGE_CSS).not.toContain('/*');
  });

  test('the layout utilities, focus ring and touch targets exist', () => {
    for (const selector of ['.stack', '.row', '.grid-2', '.page', '.layout']) {
      expect(PAGE_CSS).toContain(`${selector} {`);
    }
    expect(PAGE_CSS).toContain('max-width: 1120px');
    expect(PAGE_CSS).toContain('overflow-wrap: anywhere');
    expect(PAGE_CSS).toContain('outline: 2px solid var(--ring)');
    expect(PAGE_CSS).toContain('min-height: 36px');
    expect(PAGE_CSS).toContain('min-height: 44px');
    expect(PAGE_CSS).toContain('@media (max-width: 639px)');
    expect(PAGE_CSS).toContain('@media (max-width: 899px)');
  });
});

describe('component kit', () => {
  test('Card renders a section with its class and tone', async () => {
    expect(await render(<Card>x</Card>)).toBe('<section class="card">x</section>');
    const html = await render(
      <Card tone="warning" class="extra" as="aside">
        y
      </Card>,
    );
    expect(html).toBe('<aside class="card card-warning extra">y</aside>');
    expect(await render(<Card as="article">z</Card>)).toBe('<article class="card">z</article>');
  });

  test('Badge carries its tone', async () => {
    for (const tone of ['neutral', 'success', 'warning', 'danger', 'info'] as const) {
      expect(await render(<Badge tone={tone}>ok</Badge>)).toBe(
        `<span class="badge badge-${tone}">ok</span>`,
      );
    }
  });

  test('ButtonLink and SubmitButton default to primary and accept a variant', async () => {
    expect(await render(<ButtonLink href="/go">Go</ButtonLink>)).toBe(
      '<a class="btn btn-primary" href="/go">Go</a>',
    );
    expect(
      await render(
        <ButtonLink href="/x" variant="secondary">
          X
        </ButtonLink>,
      ),
    ).toContain('class="btn btn-secondary"');
    expect(await render(<SubmitButton>Save</SubmitButton>)).toBe(
      '<button type="submit" class="btn btn-primary">Save</button>',
    );
    expect(await render(<SubmitButton variant="danger">Del</SubmitButton>)).toContain(
      'class="btn btn-danger"',
    );
  });

  test('Alert renders its tone, title, body and action', async () => {
    const html = await render(
      <Alert tone="danger" title="Broken" action={<a href="/fix">Fix</a>}>
        Details
      </Alert>,
    );
    expect(html).toContain('class="alert alert-danger"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('<strong class="alert-title">Broken</strong>');
    expect(html).toContain('<div class="alert-body">Details</div>');
    expect(html).toContain('<div class="alert-action"><a href="/fix">Fix</a></div>');
    expect(html).toContain('<svg');
    const info = await render(<Alert tone="info" title="FYI" />);
    expect(info).toContain('class="alert alert-info"');
    expect(info).toContain('role="status"');
    expect(info).not.toContain('alert-body');
    expect(info).not.toContain('alert-action');
    expect(await render(<Alert tone="warning" title="W" />)).toContain('alert-warning');
  });

  test('StepStatus shows a check, the index or an x, with a screen reader label', async () => {
    const done = await render(<StepStatus state="done" index={1} label="Done" />);
    expect(done).toContain('class="step step-done"');
    expect(done).toContain('icon-check');
    expect(done).toContain('aria-hidden="true"');
    expect(done).toContain('<span class="sr-only">Done</span>');
    const todo = await render(<StepStatus state="todo" index={2} label="To do" />);
    expect(todo).toBe('<span class="step step-todo">2<span class="sr-only">To do</span></span>');
    const error = await render(<StepStatus state="error" index={3} label="Error" />);
    expect(error).toContain('class="step step-error"');
    expect(error).toContain('icon-x');
    expect(error).toContain('<span class="sr-only">Error</span>');
  });

  test('Icon is a hidden inline svg drawn with currentColor', async () => {
    for (const name of ['check', 'x', 'alert', 'external'] as const) {
      const html = await render(<Icon name={name} />);
      expect(html).toStartWith('<svg');
      expect(html).toContain(`class="icon icon-${name}"`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).not.toContain('style=');
    }
  });

  test('ScrollTable wraps its table and Code renders code', async () => {
    expect(
      await render(
        <ScrollTable>
          <table />
        </ScrollTable>,
      ),
    ).toBe('<div class="table-scroll"><table></table></div>');
    expect(await render(<Code>a.b</Code>)).toBe('<code class="code">a.b</code>');
  });

  test('a ButtonLink inside an Alert action keeps the button colors', async () => {
    const html = await render(
      <Alert tone="warning" title="Reconnect" action={<ButtonLink href="/go">Go</ButtonLink>} />,
    );
    expect(html).toContain('<div class="alert-action"><a class="btn btn-primary" href="/go">');
    expect(PAGE_CSS).toContain(
      '.btn-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }',
    );
    const inheriting = [...PAGE_CSS.matchAll(/([^{}]+)\{[^}]*color: inherit/g)].map((m) =>
      (m[1] as string).trim(),
    );
    for (const selector of inheriting.flatMap((s) => s.split(',').map((x) => x.trim()))) {
      if (/\ba\b/.test(selector)) expect(selector).toContain(':not(.btn)');
    }
    for (const scope of ['.alert', '.card-warning', '.card-danger', '.card-info']) {
      expect(inheriting.join(',')).toContain(`${scope} a:not(.btn)`);
    }
  });

  test('sr-only hides text visually and badges wrap on a phone', () => {
    expect(PAGE_CSS).toMatch(
      /\.sr-only \{[^}]*position: absolute;[^}]*width: 1px;[^}]*height: 1px;[^}]*overflow: hidden;[^}]*clip: rect\(0, 0, 0, 0\);[^}]*white-space: nowrap;/,
    );
    const phone = PAGE_CSS.slice(PAGE_CSS.indexOf('@media (max-width: 639px)'));
    expect(phone).toMatch(/\.badge \{[^}]*white-space: normal;/);
  });

  test('every component class has a rule in the css', () => {
    for (const selector of [
      '.card',
      '.card-warning',
      '.card-danger',
      '.card-success',
      '.card-info',
      '.badge',
      '.badge-neutral',
      '.badge-success',
      '.badge-warning',
      '.badge-danger',
      '.badge-info',
      '.btn',
      '.btn-primary',
      '.btn-secondary',
      '.btn-danger',
      '.alert',
      '.alert-warning',
      '.alert-danger',
      '.alert-info',
      '.alert-title',
      '.step',
      '.step-done',
      '.step-todo',
      '.step-error',
      '.icon',
      '.table-scroll',
      '.code',
      '.sr-only',
    ]) {
      expect(PAGE_CSS).toMatch(new RegExp(`${selector.replace('.', '\\.')}[ ,:{>]`));
    }
  });
});

const NOW = new Date('2026-10-28T15:00:00Z');

function status(overrides: Partial<SetupStatus> = {}): SetupStatus {
  return {
    installationId: 11,
    owner: 'acme',
    installations: [{ id: 11, owner: 'acme' }],
    login: 'alice',
    admin: true,
    config: { status: 'configured' },
    accessWarning: null,
    configRepo: { exists: true, defaultBranch: 'main' },
    slack: { connected: true, workspace: 'Acme' },
    linear: { connected: true, workspace: 'Acme', urlKey: 'acme', invalid: false },
    trackerNotices: [],
    teamNotices: [],
    teams: [
      { name: 'Alpha', channel: '#alpha', remindAt: '09:00', digestAt: '10:00', tracker: null },
      { name: 'Beta', channel: '#beta', remindAt: '08:30', digestAt: '11:00', tracker: null },
    ],
    configFileUrl: 'https://github.com/acme/.github/blob/main/standwise.yml',
    teamFailures: [{ kind: 'digest', team: 'Alpha', date: '2026-10-28', at: NOW, error: 'boom' }],
    personFailures: [{ kind: 'reminder', error: 'nope', count: 2, lastAt: NOW }],
    apiKeys: {
      manage: true,
      keys: [
        {
          id: 'k1',
          name: 'ci',
          prefix: 'abcd',
          scopes: ['teams:read'],
          createdAt: NOW,
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
    },
    webhooks: {
      manage: true,
      endpoints: [
        {
          id: 'w1',
          url: 'https://hooks.example.com/a',
          events: ['daily.submitted'],
          active: true,
          disabledReason: null,
          consecutiveFailures: 0,
          createdAt: NOW,
        },
      ],
      deliveries: [
        {
          id: 'd1',
          endpointId: 'w1',
          endpointUrl: 'https://hooks.example.com/a',
          event: 'daily.submitted',
          status: 'failed',
          attempts: 3,
          lastStatusCode: 500,
          lastError: 'server error',
          createdAt: NOW,
        },
      ],
    },
    supportEmail: 'help@example.com',
    ...overrides,
  };
}

const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'invalid_state',
  'access_denied',
  'installation_pending',
  'slack_oauth_failed',
  'linear_oauth_failed',
  'not_found',
  'rate_limited',
  'generic',
];

describe('no inline styles or scripts', () => {
  const setupCases: [string, SetupStatus, { newKey?: boolean; newWebhook?: boolean }][] = [
    ['admin with keys and webhooks', status(), { newKey: true, newWebhook: true }],
    [
      'non-admin',
      status({
        admin: false,
        apiKeys: { manage: false },
        webhooks: { manage: false },
        slack: { connected: false },
        linear: { connected: false },
        configRepo: { exists: false },
      }),
      {},
    ],
    [
      'invalid config',
      status({
        config: {
          status: 'invalid',
          errors: [{ path: 'teams.0', message: 'bad' }],
          lastValid: true,
        },
        accessWarning: 'no_access',
      }),
      {},
    ],
    ['unconfigured', status({ config: { status: 'unconfigured', reason: 'no_file' } }), {}],
    [
      'linear invalid',
      status({
        linear: { connected: true, workspace: 'Acme', urlKey: 'acme', invalid: true },
        trackerNotices: ['jira_coming_soon'],
      }),
      {},
    ],
    [
      'team notice',
      status({ teamNotices: [{ team: 'Alpha', reference: 'acme/alpha', kind: 'missing' }] }),
      {},
    ],
  ];

  for (const lang of ['en', 'pt-BR'] as Language[]) {
    for (const [name, value, extra] of setupCases) {
      test(`setup page, ${name}, ${lang}`, async () => {
        const html = await render(
          <SetupPage
            lang={lang}
            status={value}
            csrf="token"
            newKey={extra.newKey ? { name: 'ci', key: 'swk_secret' } : undefined}
            newWebhook={
              extra.newWebhook
                ? { url: 'https://hooks.example.com/a', secret: 'whsec_x' }
                : undefined
            }
          />,
        );
        expect(html).toContain('<style>');
        expect(html).not.toContain('style="');
        expect(html).not.toContain('<script');
      });
    }

    for (const code of ERROR_CODES) {
      test(`error page ${code}, ${lang}`, async () => {
        for (const action of [undefined, { kind: 'signIn' as const, href: '/auth/github' }]) {
          const html = await render(<ErrorPage lang={lang} code={code} action={action} />);
          expect(html).not.toContain('style="');
          expect(html).not.toContain('<script');
        }
      });
    }
  }
});

const page = (
  value: SetupStatus,
  lang: Language = 'en',
  extra: {
    newKey?: { name: string; key: string };
    newWebhook?: { url: string; secret: string };
  } = {},
) => render(<SetupPage lang={lang} status={value} csrf="token" {...extra} />);

const section = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  if (start < 0) throw new Error(`missing ${id}`);
  return html.slice(start, html.indexOf('</section>', start));
};

const teamCard = (html: string, name: string) => {
  const start = html.indexOf(`<h3>${name}</h3>`);
  if (start < 0) throw new Error(`missing team ${name}`);
  return html.slice(html.lastIndexOf('<article', start), html.indexOf('</article>', start));
};

const structure = (html: string) =>
  [
    ...html.matchAll(
      /<(section|article|aside|div|h1|h2|h3|form|table|a|button|span)\b[^>]*?(?:\sclass="([^"]*)")?[^>]*>/g,
    ),
  ]
    .map((m) => `${m[1]}.${m[2] ?? ''}`)
    .join('\n');

describe('setup checklist', () => {
  test('the progress badge counts the steps, with linear only when a team uses it', async () => {
    expect(await page(status())).toContain('3 of 3 steps done');
    const linearTeam = status({
      linear: { connected: false },
      trackerNotices: ['linear_not_connected'],
      teams: [
        {
          name: 'Alpha',
          channel: '#alpha',
          remindAt: '09:00',
          digestAt: '10:00',
          tracker: 'linear',
        },
      ],
    });
    expect(await page(linearTeam)).toContain('3 of 4 steps done');
  });

  test('a connected slack is done; a member gets no reconnect and no admin form', async () => {
    const admin = section(await page(status()), 'step-slack');
    expect(admin).toContain('step step-done');
    expect(admin).toContain('Connected to Acme');
    expect(admin).toContain('Reconnect Slack');
    const html = await page(
      status({ admin: false, apiKeys: { manage: false }, webhooks: { manage: false } }),
    );
    const member = section(html, 'step-slack');
    expect(member).toContain('step step-done');
    expect(member).toContain('Connected to Acme');
    expect(html).not.toContain('Reconnect');
    expect(html).not.toContain('action="/setup/');
  });

  test('an invalid linear shows the danger alert and, for the admin, reconnect', async () => {
    const value = status({
      linear: { connected: true, workspace: 'Acme', urlKey: 'acme', invalid: true },
    });
    const card = section(await page(value), 'step-linear');
    expect(card).toContain('step step-error');
    expect(card).toContain('class="alert alert-danger"');
    expect(card).toContain('Linear stopped working');
    expect(card).toContain('Reconnect Linear');
    const member = section(await page({ ...value, admin: false }), 'step-linear');
    expect(member).toContain('Linear stopped working');
    expect(member).not.toContain('/connect/linear');
  });

  test('linear is optional when no team uses it', async () => {
    expect(section(await page(status()), 'step-linear')).toContain('Optional');
  });

  test('a configured file shows one card per team and an edit link', async () => {
    const card = section(await page(status()), 'step-config');
    expect(card).toContain('step step-done');
    expect(card.match(/<article class="card team-card/g)?.length).toBe(2);
    expect(teamCard(card, 'Alpha')).toContain('#alpha');
    expect(teamCard(card, 'Alpha')).toContain('reminder 09:00 · digest 10:00');
    expect(teamCard(card, 'Beta')).toContain('reminder 08:30 · digest 11:00');
    expect(card).toContain(
      '<a class="btn btn-secondary" href="https://github.com/acme/.github/blob/main/standwise.yml">',
    );
    expect(card).toContain('Edit on GitHub');
  });

  test('a team notice renders inside its team card with the warning tone', async () => {
    const html = await page(
      status({ teamNotices: [{ team: 'Beta', reference: '@acme/gone', kind: 'missing' }] }),
    );
    const beta = teamCard(html, 'Beta');
    expect(beta).toContain('card-warning');
    expect(beta).toContain('the GitHub team @acme/gone was not found');
    expect(teamCard(html, 'Alpha')).not.toContain('@acme/gone');
    expect(teamCard(html, 'Alpha')).not.toContain('card-warning');
  });

  test('an invalid file lists every error path in a scroll table', async () => {
    const card = section(
      await page(
        status({
          config: {
            status: 'invalid',
            errors: [
              { path: 'teams.0.digest_at', message: 'must be HH:MM (24h)' },
              { path: 'teams.1.chat', message: 'required' },
            ],
            lastValid: true,
          },
        }),
      ),
      'step-config',
    );
    expect(card).toContain('step step-error');
    expect(card).toContain('class="table-scroll"');
    expect(card).toContain('teams.0.digest_at');
    expect(card).toContain('teams.1.chat');
    expect(card).toContain('keeps using the last valid version');
  });

  test('an unconfigured file is a todo with the template and the create action', async () => {
    const card = section(
      await page(
        status({
          config: { status: 'unconfigured', reason: 'no_file' },
          teams: [],
          configFileUrl: null,
        }),
      ),
      'step-config',
    );
    expect(card).toContain('step step-todo');
    expect(card).toContain('no_file');
    expect(card).toContain('Create standwise.yml from the template');
    expect(card).toContain('<pre>');
    expect(card).not.toContain('Edit on GitHub');
  });

  test('long values wrap and wide tables scroll', async () => {
    const url = `https://hooks.example.com/${'a'.repeat(274)}`;
    const owner = 'o'.repeat(120);
    const base = status();
    if (!base.webhooks.manage) throw new Error('expected webhooks');
    const html = await page({
      ...base,
      owner,
      installations: [{ id: 11, owner }],
      webhooks: {
        ...base.webhooks,
        endpoints: base.webhooks.endpoints.map((e) => ({ ...e, url })),
      },
    });
    const webhooks = section(html, 'webhooks');
    const scroll = webhooks.indexOf('class="table-scroll"');
    expect(scroll).toBeGreaterThan(-1);
    expect(webhooks.indexOf(url)).toBeGreaterThan(scroll);
    expect(html).toContain(`<strong class="topbar-org">${owner}</strong>`);
    expect(section(html, 'step-github')).toContain(`<p class="muted">Installed on ${owner}</p>`);
    expect(PAGE_CSS).toMatch(/[ ,]strong[ ,][^{]*\{[^}]*overflow-wrap: anywhere/);
    expect(PAGE_CSS).toMatch(/[ ,]p[ ,][^{]*\{[^}]*overflow-wrap: anywhere/);
    expect(PAGE_CSS).toMatch(/[ ,]code[ ,][^{]*\{[^}]*overflow-wrap: anywhere/);
  });

  test('the aside holds failed deliveries, api keys, webhooks and support, in order', async () => {
    const html = await page(status());
    const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    const order = ['id="failed"', 'id="api-keys"', 'id="webhooks"', 'mailto:help@example.com'].map(
      (needle) => aside.indexOf(needle),
    );
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(section(html, 'failed')).toContain('class="table-scroll"');
    const empty = await page(status({ teamFailures: [], personFailures: [] }));
    expect(section(empty, 'failed')).toContain('No failed deliveries.');
  });

  test('one-time secrets render first in the main column as an info alert', async () => {
    const html = await page(status(), 'en', {
      newKey: { name: 'ci', key: 'swk_secret' },
      newWebhook: { url: 'https://hooks.example.com/a', secret: 'whsec_x' },
    });
    const main = html.slice(html.indexOf('class="layout-main'), html.indexOf('id="step-github"'));
    expect(main).toContain('class="alert alert-info"');
    expect(main).toContain('<code class="code">swk_secret</code>');
    expect(main).toContain('<code class="code">whsec_x</code>');
    expect(main).toContain('Copy it now');
  });

  test('every step status has a translated label', async () => {
    const en = await page(status({ slack: { connected: false } }));
    expect(en).toContain('<span class="sr-only">Done</span>');
    expect(en).toContain('<span class="sr-only">To do</span>');
    const pt = await page(status({ slack: { connected: false } }), 'pt-BR');
    expect(pt).toContain('<span class="sr-only">Concluída</span>');
    expect(pt).toContain('<span class="sr-only">Pendente</span>');
  });

  test('pt-BR renders the same structure with translated labels', async () => {
    const en = await page(status());
    const pt = await page(status(), 'pt-BR');
    expect(structure(pt)).toBe(structure(en));
    expect(pt).toContain('3 de 3 etapas concluídas');
    expect(pt).toContain('Editar no GitHub');
    expect(pt).toContain('lembrete 09:00 · consolidado 10:00');
    expect(pt).toContain('Opcional');
  });
});
