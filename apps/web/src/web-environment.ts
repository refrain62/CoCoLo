const environmentLabels: Record<string, string> = {
  development: '開発',
  staging: '検証',
  production: '本番',
};

export function currentEnvironment() {
  return environmentLabels[import.meta.env.MODE] ?? import.meta.env.MODE;
}
