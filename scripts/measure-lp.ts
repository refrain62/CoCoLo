import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from '@playwright/test';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webRoot = path.join(root, 'apps', 'web');
const viewport = { width: 390, height: 844 } as const;
const cpuThrottleRate = 4;
const network = {
  connectionType: 'cellular3g',
  downloadThroughput: 1_600_000 / 8,
  latency: 150,
  uploadThroughput: 750_000 / 8,
} as const;

export type LpPerformanceSample = {
  iteration: number;
  lcpMs: number;
  inpMs: number;
  interactionCount: number;
};

export type LpPerformanceSummary = {
  lcpP75Ms: number;
  inpP75Ms: number;
};

export function percentile(values: readonly number[], ratio: number): number {
  assert(values.length > 0, 'パーセンタイルには値が必要です。');
  assert(ratio > 0 && ratio <= 1, 'パーセンタイルの割合が不正です。');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] as number;
}

export function summarizePerformance(
  samples: readonly LpPerformanceSample[],
): LpPerformanceSummary {
  assert(samples.length > 0, '計測サンプルがありません。');
  return {
    inpP75Ms: percentile(
      samples.map((sample) => sample.inpMs),
      0.75,
    ),
    lcpP75Ms: percentile(
      samples.map((sample) => sample.lcpMs),
      0.75,
    ),
  };
}

function positiveInteger(value: string, name: string): number {
  assert(/^[1-9][0-9]*$/u.test(value), `${name}が不正です。`);
  return Number(value);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert(
    address && typeof address !== 'string',
    '計測用portを取得できません。',
  );
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      // Vite previewが起動するまで再試行する。
    }
    await sleep(100);
  }
  throw new Error(`計測用Webサーバーへ接続できません: ${url}`);
}

function startPreview(port: number): ChildProcess {
  const vitePath = path.join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(
    process.execPath,
    [vitePath, 'preview', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: webRoot, stdio: 'ignore' },
  );
}

async function configurePage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      interactionDurations: [],
      lcpMs: null,
    } as {
      interactionDurations: number[];
      lcpMs: number | null;
    };
    (
      window as typeof window & { __cocoloLpMetrics?: typeof state }
    ).__cocoloLpMetrics = state;

    if (
      PerformanceObserver.supportedEntryTypes.includes(
        'largest-contentful-paint',
      )
    ) {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) state.lcpMs = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    }

    if (PerformanceObserver.supportedEntryTypes.includes('event')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const event = entry as PerformanceEntry & {
            interactionId?: number;
          };
          if (event.interactionId && event.interactionId > 0)
            state.interactionDurations.push(event.duration);
        }
      }).observe({
        type: 'event',
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    }
  });
}

async function measureIteration(
  browser: Browser,
  baseUrl: string,
  iteration: number,
): Promise<LpPerformanceSample> {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      ...network,
      offline: false,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', {
      rate: cpuThrottleRate,
    });
    await configurePage(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    await page.locator('main#lp-main').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'メニュー' }).click();
    await page.getByRole('button', { name: 'メニュー' }).click();
    await page.locator('.faq-item button').nth(1).click();
    await page.waitForTimeout(500);
    const metrics = await page.evaluate(() => {
      const state = (
        window as typeof window & {
          __cocoloLpMetrics?: {
            interactionDurations: number[];
            lcpMs: number | null;
          };
        }
      ).__cocoloLpMetrics;
      const inpMs =
        state && state.interactionDurations.length > 0
          ? Math.max(...state.interactionDurations)
          : Number.NaN;
      return {
        inpMs,
        interactionCount: state?.interactionDurations.length ?? 0,
        lcpMs: state?.lcpMs ?? Number.NaN,
      };
    });
    assert(
      Number.isFinite(metrics.lcpMs),
      `LCPを計測できません（${iteration}回目）。`,
    );
    assert(
      Number.isFinite(metrics.inpMs),
      `INPを計測できません（${iteration}回目）。`,
    );
    assert(
      metrics.interactionCount > 0,
      `INPイベントがありません（${iteration}回目）。`,
    );
    return { iteration, ...metrics };
  } finally {
    await context.close();
  }
}

export async function main(): Promise<void> {
  assert(
    process.env.APP_ENV !== 'production',
    'productionではLP計測を実行できません。',
  );
  const iterations = positiveInteger(
    process.env.LP_MEASURE_ITERATIONS ?? '10',
    'LP_MEASURE_ITERATIONS',
  );
  assert(iterations >= 10, 'LP計測は10回以上実行してください。');
  const externalBaseUrl = process.env.LP_MEASURE_BASE_URL;
  let preview: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const port = externalBaseUrl ? null : await findFreePort();
    const baseUrl = externalBaseUrl ?? `http://127.0.0.1:${port}`;
    if (!externalBaseUrl) {
      preview = startPreview(port as number);
      await waitForServer(`${baseUrl}/`);
    }

    browser = await chromium.launch({
      channel: 'chromium',
      headless: true,
    });
    const samples: LpPerformanceSample[] = [];
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const sample = await measureIteration(browser, baseUrl, iteration);
      samples.push(sample);
      console.log(
        `LP計測 ${iteration}/${iterations}: LCP ${sample.lcpMs.toFixed(1)}ms, INP ${sample.inpMs.toFixed(1)}ms`,
      );
    }
    const summary = summarizePerformance(samples);
    const { execFileSync } = await import('node:child_process');
    const commit = execFileSync(
      process.platform === 'win32' ? 'git.exe' : 'git',
      ['rev-parse', 'HEAD'],
      { cwd: root, encoding: 'utf8' },
    ).trim();
    const outputPath = path.resolve(
      process.env.LP_MEASURE_OUTPUT ??
        path.join(root, '.ci-reports', 'lp-performance.json'),
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          commit,
          cpuThrottleRate,
          measuredAt: new Date().toISOString(),
          network,
          samples,
          summary,
          version: 1,
          viewport,
          url: baseUrl,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(`LP計測結果を保存しました: ${outputPath}`);
    console.log(
      `LCP p75: ${summary.lcpP75Ms.toFixed(1)}ms / INP p75: ${summary.inpP75Ms.toFixed(1)}ms`,
    );
  } finally {
    await browser?.close();
    preview?.kill();
  }
}

if (process.argv[1]?.endsWith('measure-lp.ts')) await main();
