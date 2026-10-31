import type { Child } from 'hono/jsx';

export type BadgeTone = 'neutral' | 'success' | 'danger';
export type CardTone = 'warning';
export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type IconName = 'check' | 'x' | 'alert' | 'external';

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

const ICON_PATHS: Record<IconName, string[]> = {
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  alert: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 8v4', 'M12 16h.01'],
  external: [
    'M15 3h6v6',
    'M10 14 21 3',
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  ],
};

export function Icon(props: { name: IconName }) {
  return (
    <svg
      class={`icon icon-${props.name}`}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[props.name].map((d) => (
        <path d={d} />
      ))}
    </svg>
  );
}

export function Card(props: {
  children?: Child;
  class?: string;
  tone?: CardTone;
  as?: 'section' | 'article' | 'aside';
  id?: string;
}) {
  const Tag = props.as ?? 'section';
  return (
    <Tag class={classes('card', props.tone && `card-${props.tone}`, props.class)} id={props.id}>
      {props.children}
    </Tag>
  );
}

export function Badge(props: { tone: BadgeTone; children?: Child }) {
  return <span class={`badge badge-${props.tone}`}>{props.children}</span>;
}

export function ButtonLink(props: { href: string; variant?: ButtonVariant; children?: Child }) {
  return (
    <a class={`btn btn-${props.variant ?? 'primary'}`} href={props.href}>
      {props.children}
    </a>
  );
}

export function SubmitButton(props: { variant?: ButtonVariant; size?: 'sm'; children?: Child }) {
  return (
    <button
      type="submit"
      class={classes('btn', `btn-${props.variant ?? 'primary'}`, props.size && `btn-${props.size}`)}
    >
      {props.children}
    </button>
  );
}

export function Alert(props: {
  tone: 'warning' | 'danger' | 'info';
  title: string;
  role?: 'alert' | 'status';
  children?: Child;
  action?: Child;
}) {
  const hasBody = props.children !== undefined && props.children !== null;
  return (
    <div
      class={`alert alert-${props.tone}`}
      role={props.role ?? (props.tone === 'info' ? 'status' : 'alert')}
    >
      <Icon name="alert" />
      <strong class="alert-title">{props.title}</strong>
      {hasBody ? <div class="alert-body">{props.children}</div> : null}
      {props.action ? <div class="alert-action">{props.action}</div> : null}
    </div>
  );
}

export function StepStatus(props: {
  state: 'done' | 'todo' | 'error';
  index: number;
  label: string;
}) {
  return (
    <span class={`step step-${props.state}`}>
      {props.state === 'done' ? <Icon name="check" /> : null}
      {props.state === 'error' ? <Icon name="x" /> : null}
      {props.state === 'todo' ? props.index : null}
      <span class="sr-only">{props.label}</span>
    </span>
  );
}

export function ScrollTable(props: { children?: Child }) {
  return <div class="table-scroll">{props.children}</div>;
}

export function Code(props: { children?: Child }) {
  return <code class="code">{props.children}</code>;
}
