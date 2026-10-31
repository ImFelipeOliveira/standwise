const LIGHT = `
:root {
  color-scheme: light dark;
  --font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --radius: 12px;
  --radius-sm: 8px;
  --background: #F8FAFC;
  --foreground: #0F172A;
  --card: #FFFFFF;
  --card-foreground: #0F172A;
  --muted: #F1F5F9;
  --muted-foreground: #475569;
  --border: #E2E8F0;
  --input: #CBD5E1;
  --primary: #3B4BC8;
  --primary-hover: #2A3796;
  --primary-foreground: #FFFFFF;
  --ring: #3B4BC8;
  --secondary-hover: #F1F5F9;
  --success: #16A34A;
  --success-foreground: #FFFFFF;
  --success-bg: #DCFCE7;
  --success-border: #BBF7D0;
  --success-text: #166534;
  --warning: #D97706;
  --warning-bg: #FFFBEB;
  --warning-border: #FDE68A;
  --warning-text: #92400E;
  --danger: #B91C1C;
  --danger-hover: #991B1B;
  --danger-foreground: #FFFFFF;
  --danger-bg: #FEF2F2;
  --danger-border: #FECACA;
  --danger-text: #7F1D1D;
  --info-bg: #EEF0FB;
  --info-border: #C7CDF3;
  --info-text: #2A3796;
  --neutral-bg: #F1F5F9;
  --neutral-text: #334155;
  --step-todo: #64748B;
}`;

const DARK = `
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0B1120;
    --foreground: #E2E8F0;
    --card: #111827;
    --card-foreground: #E2E8F0;
    --muted: #1E293B;
    --muted-foreground: #94A3B8;
    --border: #1E293B;
    --input: #475569;
    --primary: #8B96F2;
    --primary-hover: #A5AEF6;
    --primary-foreground: #0B1120;
    --ring: #8B96F2;
    --secondary-hover: #1E293B;
    --success: #22C55E;
    --success-foreground: #052E16;
    --success-bg: #052E16;
    --success-border: #14532D;
    --success-text: #86EFAC;
    --warning: #F59E0B;
    --warning-bg: #422006;
    --warning-border: #854D0E;
    --warning-text: #FDE68A;
    --danger: #DC2626;
    --danger-hover: #B91C1C;
    --danger-foreground: #FFFFFF;
    --danger-bg: #450A0A;
    --danger-border: #7F1D1D;
    --danger-text: #FECACA;
    --info-bg: #1E1B4B;
    --info-border: #3730A3;
    --info-text: #C7D2FE;
    --neutral-bg: #1E293B;
    --neutral-text: #CBD5E1;
    --step-todo: #64748B;
  }
}`;

const BASE = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
h1, h2, h3, p, li, td, th, dd, dt, label, legend, pre, code, a, strong, span { overflow-wrap: anywhere; }
h1 { font-size: 30px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 8px; }
h2 { font-size: 16px; font-weight: 600; line-height: 1.4; margin: 0 0 8px; }
h3 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; }
p { margin: 0 0 12px; }
ul, ol { margin: 0 0 12px; padding-left: 20px; }
a { color: var(--primary); text-underline-offset: 2px; }
a:hover { color: var(--primary-hover); }
code, pre, kbd { font-family: var(--font-mono); font-size: 13px; }
code { color: var(--foreground); }
pre { background: var(--muted); color: var(--foreground); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px; margin: 0 0 12px; overflow-x: auto; white-space: pre-wrap; }
table { width: 100%; border-collapse: collapse; margin: 0 0 16px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--border); }
th { color: var(--muted-foreground); font-size: 13px; font-weight: 500; }
td { color: var(--foreground); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 36px; padding: 8px 16px; border: 1px solid var(--primary); border-radius: var(--radius-sm); background: var(--primary); color: var(--primary-foreground); font: inherit; font-weight: 600; line-height: 1.2; text-decoration: none; cursor: pointer; }
.btn:hover { background: var(--primary-hover); border-color: var(--primary-hover); color: var(--primary-foreground); }
input, select, textarea { min-height: 36px; padding: 6px 10px; border: 1px solid var(--input); border-radius: var(--radius-sm); background: var(--card); color: var(--foreground); font: inherit; max-width: 100%; }
input[type=checkbox], input[type=radio] { min-height: 0; width: 16px; height: 16px; padding: 0; accent-color: var(--primary); vertical-align: middle; }
fieldset { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px 12px; margin: 0 0 12px; min-width: 0; }
legend { padding: 0 4px; color: var(--muted-foreground); font-size: 13px; font-weight: 500; }
label { color: var(--foreground); }
label.choice { display: flex; align-items: center; gap: 8px; min-height: 32px; flex-wrap: wrap; }
a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, .table-scroll:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.logo { fill: var(--primary); flex: none; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
`;

const LAYOUT = `
.page { max-width: 1120px; margin: 0 auto; padding: 24px 24px 64px; }
.topbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 32px; font-size: 18px; font-weight: 700; }
.topbar-brand { display: inline-flex; align-items: center; gap: 10px; }
.topbar-sep { color: var(--muted-foreground); font-weight: 400; }
.topbar-org { font-size: 15px; }
.topbar-switch { display: flex; align-items: center; gap: 8px; margin: 0; }
.topbar-switch select { font-size: 14px; font-weight: 500; }
.topbar-actions { display: flex; align-items: center; gap: 12px; margin-left: auto; font-size: 14px; font-weight: 500; }
.topbar-actions form { margin: 0; }
.topbar-link { display: inline-flex; align-items: center; min-height: 36px; padding: 0 4px; color: var(--muted-foreground); text-decoration: none; }
.topbar-link:hover { color: var(--foreground); text-decoration: underline; }
.page > section:not([class]) { background: var(--card); color: var(--card-foreground); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 24px; margin-bottom: 16px; }
.page > section:not([class]) p { color: var(--muted-foreground); }
.stack { display: flex; flex-direction: column; gap: 16px; }
.stack > * { margin: 0; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; align-items: start; }
.muted, .small { color: var(--muted-foreground); }
.small { font-size: 13px; }
.page-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px 16px; margin-bottom: 24px; }
.page-head h1 { margin: 0 0 4px; }
.page-head p { margin: 0; }
.layout-main, .layout-aside { min-width: 0; }
.layout-aside > p { margin: 0; }
`;

const COMPONENTS = `
.card { background: var(--card); color: var(--card-foreground); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 24px; min-width: 0; }
.card > h2:first-child { font-size: 16px; font-weight: 600; }
.card-success { border-color: var(--success-border); }
.card-warning { background: var(--warning-bg); border-color: var(--warning-border); color: var(--warning-text); }
.card-danger { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-text); }
.card-info { background: var(--info-bg); border-color: var(--info-border); color: var(--info-text); }
.card-neutral { background: var(--muted); }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; border: 1px solid transparent; font-size: 12px; font-weight: 600; line-height: 1.5; white-space: nowrap; }
.badge-neutral { background: var(--neutral-bg); color: var(--neutral-text); }
.badge-success { background: var(--success-bg); color: var(--success-text); border-color: var(--success-border); }
.badge-warning { background: var(--warning-bg); color: var(--warning-text); border-color: var(--warning-border); }
.badge-danger { background: var(--danger-bg); color: var(--danger-text); border-color: var(--danger-border); }
.badge-info { background: var(--info-bg); color: var(--info-text); border-color: var(--info-border); }
.btn-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.btn-secondary { background: var(--card); border-color: var(--border); color: var(--foreground); }
.btn-secondary:hover { background: var(--secondary-hover); border-color: var(--input); color: var(--foreground); }
.btn-danger { background: var(--danger); border-color: var(--danger); color: var(--danger-foreground); }
.btn-danger:hover { background: var(--danger-hover); border-color: var(--danger-hover); color: var(--danger-foreground); }
.button { display: inline-flex; align-items: center; min-height: 36px; padding: 8px 16px; border-radius: var(--radius-sm); background: var(--primary); color: var(--primary-foreground); font-weight: 600; text-decoration: none; }
.button:hover { background: var(--primary-hover); color: var(--primary-foreground); }
.alert { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 12px; row-gap: 4px; padding: 12px 16px; border: 1px solid; border-radius: var(--radius-sm); margin: 0 0 12px; }
.alert > .icon { margin-top: 2px; }
.alert-title, .alert-body, .alert-action { grid-column: 2; }
.alert-title { font-weight: 600; }
.alert-body { font-size: 13px; }
.alert-action { margin-top: 8px; }
.alert-warning { background: var(--warning-bg); border-color: var(--warning-border); color: var(--warning-text); }
.alert-danger { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-text); }
.alert-info { background: var(--info-bg); border-color: var(--info-border); color: var(--info-text); }
.alert a:not(.btn), .card-warning a:not(.btn), .card-danger a:not(.btn), .card-info a:not(.btn) { color: inherit; font-weight: 600; }
.step { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; border-radius: 999px; border: 2px solid transparent; font-size: 13px; font-weight: 600; }
.step-done { background: var(--success); border-color: var(--success); color: var(--success-foreground); }
.step-todo { border: 2px dashed var(--step-todo); color: var(--muted-foreground); }
.step-error { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-text); }
.icon { width: 16px; height: 16px; flex: none; }
.table-scroll { width: 100%; overflow-x: auto; margin: 0 0 16px; }
.table-scroll > table { margin: 0; min-width: 560px; }
.table-scroll > .table-fit { min-width: 0; }
.table-compact th, .table-compact td { padding: 6px 8px; font-size: 13px; }
.table-compact form { margin: 0; }
.step-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 16px; row-gap: 12px; align-items: start; }
.step-body { min-width: 0; }
.step-body > p { margin: 0; }
.step-title { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 2px; }
.step-title h2 { margin: 0; }
.step-action { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.step-extra { grid-column: 2 / -1; min-width: 0; }
.step-extra > :last-child { margin-bottom: 0; }
.step-extra > h3:first-child { margin-top: 0; }
.team-card { padding: 12px 16px; }
.team-card h3 { margin: 0 0 4px; }
.team-card p { margin: 0; }
.team-notice { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; color: inherit; }
.team-notice > .icon { margin-top: 2px; }
.card-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 8px; margin-bottom: 8px; }
.card-head h2 { margin: 0; }
.field { display: flex; flex-direction: column; gap: 4px; }
.alert-body > p { margin: 0 0 4px; }
.alert-body > p:last-child { margin: 0; }
.code { font-family: var(--font-mono); font-size: 13px; background: var(--muted); border-radius: 4px; padding: 1px 6px; }
`;

const RESPONSIVE = `
@media (max-width: 899px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 639px) {
  .page { padding: 16px 16px 48px; }
  .grid-2 { grid-template-columns: minmax(0, 1fr); }
  h1 { font-size: 24px; }
  button, .btn, .button, input, select, textarea { min-height: 44px; }
  .topbar-link { min-height: 44px; padding: 0 8px; }
  .topbar-actions { margin-left: 0; width: 100%; justify-content: space-between; }
  input[type=checkbox], input[type=radio] { min-height: 0; width: 20px; height: 20px; }
  label.choice { min-height: 44px; }
  .badge { white-space: normal; }
  .card, .page > section:not([class]) { padding: 16px; }
  .step-card { grid-template-columns: auto minmax(0, 1fr); }
  .step-action, .step-extra { grid-column: 1 / -1; }
  .step-action .btn, .alert-action .btn { width: 100%; }
}
`;

export const PAGE_CSS = `${LIGHT}${DARK}${BASE}${LAYOUT}${COMPONENTS}${RESPONSIVE}`;
