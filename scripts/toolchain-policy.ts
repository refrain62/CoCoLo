export const expectedToolchain = {
  node: '24.12.0',
  pnpm: '10.26.0',
} as const;

export type RuntimeToolchain = Readonly<{
  nodeVersion: string;
  pnpmVersion: string;
}>;

export function validateRuntimeToolchain(actual: RuntimeToolchain): void {
  if (actual.nodeVersion !== expectedToolchain.node)
    throw new Error(
      `Node.jsは${expectedToolchain.node}を使用してください（実行値: ${actual.nodeVersion}）。`,
    );
  if (actual.pnpmVersion !== expectedToolchain.pnpm)
    throw new Error(
      `pnpmは${expectedToolchain.pnpm}を使用してください（実行値: ${actual.pnpmVersion}）。`,
    );
}

export type RepositoryToolchainFiles = Readonly<{
  miseToml: string;
  packageManager: string;
  workflows: ReadonlyMap<string, string>;
}>;

function assertExactMatch(
  value: string | undefined,
  expected: string,
  label: string,
): void {
  if (value !== expected)
    throw new Error(`${label}は${expected}に固定してください。`);
}

export function validateRepositoryToolchain(
  files: RepositoryToolchainFiles,
): void {
  const miseNode = /^node\s*=\s*["']([^"']+)["']/m.exec(files.miseToml)?.[1];
  const misePnpm = /^pnpm\s*=\s*["']([^"']+)["']/m.exec(files.miseToml)?.[1];
  assertExactMatch(miseNode, expectedToolchain.node, 'mise.tomlのNode.js');
  assertExactMatch(misePnpm, expectedToolchain.pnpm, 'mise.tomlのpnpm');
  assertExactMatch(
    files.packageManager,
    `pnpm@${expectedToolchain.pnpm}`,
    'package.jsonのpackageManager',
  );

  let setupNodeCount = 0;
  let nodeVersionCount = 0;
  let pnpmSetupCount = 0;
  for (const [file, content] of files.workflows) {
    setupNodeCount += (content.match(/uses:\s*actions\/setup-node@/g) ?? [])
      .length;
    for (const match of content.matchAll(
      /^\s*node-version:\s*["']?([^"'\s#]+)["']?/gm,
    )) {
      nodeVersionCount += 1;
      assertExactMatch(
        match[1],
        expectedToolchain.node,
        `${file}のnode-version`,
      );
    }

    for (const match of content.matchAll(
      /uses:\s*pnpm\/action-setup@[^\r\n]*[\s\S]{0,240}?^\s*version:\s*["']?([^"'\s#]+)["']?/gm,
    )) {
      pnpmSetupCount += 1;
      assertExactMatch(
        match[1],
        expectedToolchain.pnpm,
        `${file}のpnpm/action-setup version`,
      );
    }
  }
  if (setupNodeCount !== nodeVersionCount)
    throw new Error(
      'actions/setup-nodeのすべてのjobへnode-versionを明示してください。',
    );
  if (pnpmSetupCount === 0)
    throw new Error('pnpm/action-setupが見つかりません。');
}
