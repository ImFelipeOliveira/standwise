const PARAMS_MARKER = '\nparams:';

function safeMessage(message: unknown): string {
  const text = String(message);
  const at = text.indexOf(PARAMS_MARKER);
  return at === -1 ? text : text.slice(0, at);
}

export function errorFields(error: unknown): { name: string; code: string; message: string } {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
  return { name: String(e.name), code: String(e.code), message: safeMessage(e.message) };
}
