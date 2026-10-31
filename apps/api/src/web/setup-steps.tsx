import type { Language } from '@standwise/core';
import type { SetupStatus } from '@standwise/orchestrator';
import type { Child } from 'hono/jsx';
import { newConfigFileUrl, newConfigRepoUrl, standwiseYmlTemplate } from './config-template';
import { reasonText, TEAM_NOTICES, TRACKER_NOTICES, type Translate } from './setup-labels';
import { Alert, Badge, ButtonLink, Code, Icon, ScrollTable, StepStatus } from './ui';

type StepState = 'done' | 'todo' | 'error';

const STEP_LABELS = {
  done: 'web.step.done',
  todo: 'web.step.todo',
  error: 'web.step.error',
} as const;

const usesLinear = (status: SetupStatus) => status.teams.some((team) => team.tracker === 'linear');

const linearState = (status: SetupStatus): StepState => {
  if (!status.linear.connected) return 'todo';
  return status.linear.invalid ? 'error' : 'done';
};

export function setupProgress(status: SetupStatus): { done: number; total: number } {
  const linear = usesLinear(status);
  const steps = [
    true,
    status.slack.connected,
    status.config.status === 'configured',
    ...(linear ? [linearState(status) === 'done'] : []),
  ];
  return { done: steps.filter(Boolean).length, total: steps.length };
}

const present = (child: unknown): boolean =>
  Array.isArray(child)
    ? child.some(present)
    : child !== null && child !== undefined && child !== false && child !== '';

function StepCard(props: {
  t: Translate;
  id: string;
  index: number;
  state: StepState;
  title: string;
  badge: Child;
  description: Child;
  action?: Child;
  children?: Child;
}) {
  const hasExtra = present(props.children);
  return (
    <section class="card step-card" id={props.id}>
      <StepStatus
        state={props.state}
        index={props.index}
        label={props.t(STEP_LABELS[props.state])}
      />
      <div class="step-body">
        <div class="step-title">
          <h2>{props.title}</h2>
          {props.badge}
        </div>
        <p class="muted">{props.description}</p>
      </div>
      {props.action ? <div class="step-action">{props.action}</div> : null}
      {hasExtra ? <div class="step-extra">{props.children}</div> : null}
    </section>
  );
}

type StepProps = { t: Translate; status: SetupStatus };

function GithubStep(props: StepProps) {
  const { t, status } = props;
  return (
    <StepCard
      t={t}
      id="step-github"
      index={1}
      state="done"
      title={t('web.github.title')}
      badge={<Badge tone="success">{t('web.badge.installed')}</Badge>}
      description={t('web.github.installed', { owner: status.owner })}
    >
      {status.accessWarning ? (
        <Alert tone="warning" title={reasonText(t, status.accessWarning)}>
          {t('web.setup.accessWarning')}
        </Alert>
      ) : null}
    </StepCard>
  );
}

function SlackStep(props: StepProps) {
  const { t, status } = props;
  const href = `/connect/slack?installation_id=${status.installationId}`;
  return (
    <StepCard
      t={t}
      id="step-slack"
      index={2}
      state={status.slack.connected ? 'done' : 'todo'}
      title={t('web.slack.title')}
      badge={
        status.slack.connected ? (
          <Badge tone="success">{t('web.badge.connected')}</Badge>
        ) : (
          <Badge tone="neutral">{t('web.step.todo')}</Badge>
        )
      }
      description={
        status.slack.connected
          ? t('web.slack.connectedTo', { workspace: status.slack.workspace })
          : t('web.slack.description')
      }
      action={
        status.admin ? (
          status.slack.connected ? (
            <ButtonLink href={href} variant="secondary">
              {t('web.slack.reconnect')}
            </ButtonLink>
          ) : (
            <ButtonLink href={href}>{t('web.slack.connect')}</ButtonLink>
          )
        ) : null
      }
    >
      {status.admin || status.slack.connected ? null : (
        <p class="small muted">{t('web.slack.adminOnly')}</p>
      )}
    </StepCard>
  );
}

function LinearStep(props: StepProps) {
  const { t, status } = props;
  const { linear } = status;
  const state = linearState(status);
  const href = `/connect/linear?installation_id=${status.installationId}`;
  const badge =
    state === 'error' ? (
      <Badge tone="danger">{t('web.badge.needsAttention')}</Badge>
    ) : !usesLinear(status) ? (
      <Badge tone="neutral">{t('web.badge.optional')}</Badge>
    ) : state === 'done' ? (
      <Badge tone="success">{t('web.badge.connected')}</Badge>
    ) : (
      <Badge tone="neutral">{t('web.step.todo')}</Badge>
    );
  const action = !status.admin ? null : state === 'done' ? (
    <ButtonLink href={href} variant="secondary">
      {t('setup.linear.reconnect')}
    </ButtonLink>
  ) : state === 'todo' ? (
    <ButtonLink href={href}>{t('setup.linear.connect')}</ButtonLink>
  ) : null;
  return (
    <StepCard
      t={t}
      id="step-linear"
      index={3}
      state={state}
      title={t('setup.linear.title')}
      badge={badge}
      description={
        linear.connected
          ? t('setup.linear.connected', { workspace: linear.workspace })
          : t('web.linear.description')
      }
      action={action}
    >
      {linear.connected && linear.invalid ? (
        <Alert
          tone="danger"
          title={t('web.linear.stopped')}
          action={
            status.admin ? (
              <ButtonLink href={href} variant="danger">
                {t('setup.linear.reconnect')}
              </ButtonLink>
            ) : undefined
          }
        >
          {t('setup.linear.invalid', { workspace: linear.workspace })}
        </Alert>
      ) : null}
      {status.trackerNotices.map((notice) => (
        <Alert tone="warning" title={t(TRACKER_NOTICES[notice])} />
      ))}
      {status.admin || state === 'done' ? null : (
        <p class="small muted">{t('setup.linear.adminOnly')}</p>
      )}
    </StepCard>
  );
}

type Notice = SetupStatus['teamNotices'][number];

const noticeText = (t: Translate, notice: Notice) =>
  t(TEAM_NOTICES[notice.kind], { team: notice.team, reference: notice.reference });

function TeamCard(props: { t: Translate; team: SetupStatus['teams'][number]; notices: Notice[] }) {
  const { t, team, notices } = props;
  return (
    <article class={notices.length > 0 ? 'card team-card card-warning' : 'card team-card'}>
      <h3>{team.name}</h3>
      {team.channel ? (
        <p class="small">
          <Code>{team.channel}</Code>
        </p>
      ) : null}
      <p class="small muted">
        {t('web.config.teamTimes', { remindAt: team.remindAt, digestAt: team.digestAt })}
      </p>
      {notices.map((notice) => (
        <p class="small team-notice" role="status">
          <Icon name="alert" />
          <span>{noticeText(t, notice)}</span>
        </p>
      ))}
    </article>
  );
}

function ConfigStep(props: StepProps & { lang: Language }) {
  const { t, status } = props;
  const { config } = status;
  const template = standwiseYmlTemplate(status.login, t('web.template.teamName'), props.lang);
  const configured = config.status === 'configured';
  const names = new Set(configured ? status.teams.map((team) => team.name) : []);
  const looseNotices = status.teamNotices.filter((notice) => !names.has(notice.team));
  const edit = status.configFileUrl ? (
    <ButtonLink href={status.configFileUrl} variant="secondary">
      {t('web.config.editOnGithub')}
    </ButtonLink>
  ) : null;
  const create = status.configRepo.exists ? (
    <ButtonLink href={newConfigFileUrl(status.owner, status.configRepo.defaultBranch, template)}>
      {t('web.setup.createFile')}
    </ButtonLink>
  ) : (
    <ButtonLink href={newConfigRepoUrl()}>{t('web.setup.createRepo')}</ButtonLink>
  );
  return (
    <StepCard
      t={t}
      id="step-config"
      index={4}
      state={configured ? 'done' : config.status === 'invalid' ? 'error' : 'todo'}
      title={t('web.setup.configTitle')}
      badge={
        configured ? (
          <Badge tone="success">{t('web.badge.configured')}</Badge>
        ) : config.status === 'invalid' ? (
          <Badge tone="danger">{t('web.badge.needsAttention')}</Badge>
        ) : (
          <Badge tone="neutral">{t('web.step.todo')}</Badge>
        )
      }
      description={
        configured
          ? t('web.config.description')
          : config.status === 'invalid'
            ? t('web.setup.configInvalid')
            : t('web.setup.configMissing')
      }
      action={config.status === 'unconfigured' ? create : edit}
    >
      {looseNotices.map((notice) => (
        <Alert tone="warning" title={noticeText(t, notice)} />
      ))}
      {configured && status.teams.length > 0 ? (
        <>
          <p class="small muted">{t('web.config.teams')}</p>
          <div class="grid-2">
            {status.teams.map((team) => (
              <TeamCard
                t={t}
                team={team}
                notices={status.teamNotices.filter((notice) => notice.team === team.name)}
              />
            ))}
          </div>
        </>
      ) : null}
      {config.status === 'invalid' ? (
        <>
          {config.lastValid ? <p class="small">{t('web.setup.configKeepsLastValid')}</p> : null}
          <ScrollTable>
            <table class="table-compact table-fit">
              <thead>
                <tr>
                  <th>{t('web.config.path')}</th>
                  <th>{t('web.setup.error')}</th>
                </tr>
              </thead>
              <tbody>
                {config.errors.map((e) => (
                  <tr>
                    <td>
                      <code>{e.path}</code>
                    </td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        </>
      ) : null}
      {config.status === 'unconfigured' ? (
        <>
          <p class="small">
            {t('web.setup.reason')}: <code>{config.reason}</code> {reasonText(t, config.reason)}
          </p>
          <p class="small">{t('web.setup.instruction')}</p>
          <h3>{t('web.setup.template')}</h3>
          <pre>{template}</pre>
        </>
      ) : null}
    </StepCard>
  );
}

export function SetupSteps(props: { t: Translate; lang: Language; status: SetupStatus }) {
  return (
    <>
      <GithubStep t={props.t} status={props.status} />
      <SlackStep t={props.t} status={props.status} />
      <LinearStep t={props.t} status={props.status} />
      <ConfigStep t={props.t} status={props.status} lang={props.lang} />
    </>
  );
}
