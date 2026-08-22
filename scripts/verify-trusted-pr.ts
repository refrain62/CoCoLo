import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type PullRequestFile = { filename?: string };
type ContentsResponse = { content?: string; encoding?: string };

const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
assert.ok(
  eventPath && token && repository,
  '信頼境界検査のGitHub contextが不足しています',
);

const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
  pull_request?: {
    number?: number;
    base?: { sha?: string };
    head?: { sha?: string };
  };
};
const pullRequest = event.pull_request;
const pullRequestNumber = pullRequest?.number;
const baseSha = pullRequest?.base?.sha;
const headSha = pullRequest?.head?.sha;
assert.ok(pullRequestNumber && baseSha && headSha);

const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'x-github-api-version': '2022-11-28',
};

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers });
  assert.ok(response.ok, `GitHub APIが失敗しました: ${response.status} ${url}`);
  return (await response.json()) as T;
}

const apiRoot = `https://api.github.com/repos/${repository}`;
const files = await githubJson<PullRequestFile[]>(
  `${apiRoot}/pulls/${pullRequestNumber}/files?per_page=100`,
);
const changed = files
  .map((file) => file.filename)
  .filter((filename): filename is string => Boolean(filename));
const trustedPaths = changed.filter(
  (filename) =>
    filename.startsWith('.github/workflows/') ||
    filename === 'package.json' ||
    filename === 'pnpm-lock.yaml' ||
    filename === 'scripts/verify-workflows.ts' ||
    filename === 'scripts/verify-workflows.test.ts',
);

async function headFile(filename: string) {
  const encoded = encodeURIComponent(filename).replaceAll('%2F', '/');
  const response = await githubJson<ContentsResponse>(
    `${apiRoot}/contents/${encoded}?ref=${headSha}`,
  );
  assert.equal(
    response.encoding,
    'base64',
    `${filename}: base64以外の応答です`,
  );
  assert.ok(response.content, `${filename}: PR headの内容が取得できません`);
  return Buffer.from(response.content.replaceAll('\n', ''), 'base64').toString(
    'utf8',
  );
}

for (const filename of trustedPaths) {
  const content = await headFile(filename);
  if (filename.startsWith('.github/workflows/')) {
    assert.doesNotMatch(
      content,
      /actions:\s*\n\s+write\b/i,
      `${filename}: actions writeは禁止です`,
    );
    assert.doesNotMatch(
      content,
      /workflow_run:/,
      `${filename}: workflow_runは禁止です`,
    );
    for (const match of content.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g))
      assert.match(
        match[2] ?? '',
        /^[0-9a-f]{40}$/,
        `${filename}: Action SHAが不正です`,
      );
    if (filename !== '.github/workflows/pr-trust-gate.yml')
      assert.doesNotMatch(
        content,
        /pull_request_target:/,
        `${filename}: untrusted Workflowでpull_request_targetは禁止です`,
      );
  }
  if (filename === 'package.json') {
    const packageJson = JSON.parse(content) as {
      scripts?: Record<string, string>;
    };
    assert.equal(
      packageJson.scripts?.['test:workflows'],
      'node --test scripts/verify-workflows.test.ts',
      'package.jsonのtest:workflowsを変更できません',
    );
    assert.ok(packageJson.scripts?.test, 'package.jsonのtest scriptが必要です');
    assert.ok(
      packageJson.scripts?.build,
      'package.jsonのbuild scriptが必要です',
    );
  }
  if (filename === 'scripts/verify-workflows.ts') {
    assert.match(content, /validateWorkflow/);
    assert.match(content, /assertNoUntrustedExpressions/);
    assert.match(content, /actionAllowlist/);
  }
}

console.log(
  `baseブランチの信頼済みvalidatorでPR変更 ${changed.length}件を検査しました。信頼境界変更 ${trustedPaths.length}件を検出しました。`,
);
