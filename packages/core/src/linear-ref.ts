export type LinearIssueRef = { workspace: string; identifier: string };

const ISSUE_URL =
  /^https:\/\/linear\.app\/([A-Za-z0-9][\w-]*)\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/[^?#]*)?(?:[?#].*)?$/;

export function parseLinearIssueUrl(url: string): LinearIssueRef | null {
  const match = ISSUE_URL.exec(url.trim());
  if (!match) return null;
  return { workspace: match[1] as string, identifier: (match[2] as string).toUpperCase() };
}
