export function standwiseYmlTemplate(login: string): string {
  return `teams:
  - name: Time
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [${login}]
    members: [${login}]
    chat:
      provider: slack
      channel: "#daily"
`;
}

export function newConfigFileUrl(owner: string, branch: string, template: string): string {
  return `https://github.com/${encodeURIComponent(owner)}/.github/new/${encodeURIComponent(branch)}?filename=standwise.yml&value=${encodeURIComponent(template)}`;
}

export function newConfigRepoUrl(): string {
  return 'https://github.com/new?name=.github&visibility=private';
}
