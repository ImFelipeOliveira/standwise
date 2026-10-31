export const FALLBACK_API_URL = 'https://api.standwise.dev';

export function resolveDefaultApiUrl(value: string | undefined): string {
  const candidate = value || FALLBACK_API_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`STANDWISE_DEFAULT_API_URL is not a valid URL: ${candidate}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`STANDWISE_DEFAULT_API_URL must use https: ${candidate}`);
  }
  return candidate.replace(/\/+$/, '');
}
