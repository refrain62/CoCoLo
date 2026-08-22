import { appendFile, readFile } from 'node:fs/promises';

import type { ScannerName } from './security-scanner-config.ts';

export type SeverityCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
};

export type ScannerSummary = {
  tool: ScannerName;
  counts: SeverityCounts;
  verdict: 'PASS' | 'FAIL';
};

const createEmptyCounts = (): SeverityCounts => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
});

const severityKey = (value: unknown): keyof SeverityCounts => {
  if (typeof value !== 'string') return 'unknown';
  switch (value.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
    case 'ERROR':
      return 'high';
    case 'MEDIUM':
    case 'WARNING':
      return 'medium';
    case 'LOW':
    case 'INFO':
      return 'low';
    default:
      return 'unknown';
  }
};

const countArray = (
  counts: SeverityCounts,
  entries: unknown[],
  severity: (entry: unknown) => unknown,
): void => {
  for (const entry of entries) counts[severityKey(severity(entry))] += 1;
};

function parseGitleaks(value: unknown): SeverityCounts {
  if (!Array.isArray(value)) throw new Error('invalid gitleaks report');
  const counts = createEmptyCounts();
  // Gitleaks findings are treated as Critical because they represent secret exposure.
  counts.critical = value.length;
  return counts;
}

function parseSemgrep(value: unknown): SeverityCounts {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { results?: unknown }).results)
  )
    throw new Error('invalid semgrep report');
  const counts = createEmptyCounts();
  countArray(
    counts,
    (value as { results: unknown[] }).results,
    (entry) => (entry as { extra?: { severity?: unknown } }).extra?.severity,
  );
  return counts;
}

function parseTrivy(value: unknown): SeverityCounts {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { Results?: unknown }).Results)
  )
    throw new Error('invalid trivy report');
  const counts = createEmptyCounts();
  for (const result of (value as { Results: unknown[] }).Results) {
    if (typeof result !== 'object' || result === null) {
      counts.unknown += 1;
      continue;
    }
    const record = result as {
      Vulnerabilities?: unknown;
      Misconfigurations?: unknown;
      Secrets?: unknown;
    };
    for (const field of [
      record.Vulnerabilities,
      record.Misconfigurations,
      record.Secrets,
    ]) {
      if (Array.isArray(field))
        countArray(
          counts,
          field,
          (entry) => (entry as { Severity?: unknown }).Severity,
        );
    }
  }
  return counts;
}

function parseReport(tool: ScannerName, value: unknown): SeverityCounts {
  if (tool === 'gitleaks') return parseGitleaks(value);
  if (tool === 'semgrep') return parseSemgrep(value);
  return parseTrivy(value);
}

function isClean(counts: SeverityCounts): boolean {
  return Object.values(counts).every((count) => count === 0);
}

export function formatScannerSummary(
  summary: ScannerSummary,
  runUrl: string,
): string {
  const safeRunUrl = /^[^\r\n\s]{1,512}$/.test(runUrl) ? runUrl : 'local';
  const { counts } = summary;
  return `tool=${summary.tool} critical=${counts.critical} high=${counts.high} medium=${counts.medium} low=${counts.low} unknown=${counts.unknown} verdict=${summary.verdict} run_url=${safeRunUrl}`;
}

export async function summarizeScannerResult(
  tool: ScannerName,
  resultPath: string,
  scannerExitCode: number,
  runUrl: string,
  summaryPath?: string,
): Promise<boolean> {
  let counts = createEmptyCounts();
  let reportValid = true;
  try {
    counts = parseReport(tool, JSON.parse(await readFile(resultPath, 'utf8')));
  } catch {
    reportValid = false;
    counts.unknown = 1;
  }

  const passed = reportValid && scannerExitCode === 0 && isClean(counts);
  const summary: ScannerSummary = {
    tool,
    counts,
    verdict: passed ? 'PASS' : 'FAIL',
  };
  const line = formatScannerSummary(summary, runUrl);
  console.log(line);

  if (summaryPath) {
    const safeRunUrl = /^[^\r\n\s]{1,512}$/.test(runUrl) ? runUrl : 'local';
    const markdown = [
      '### Security scanner',
      '',
      `- tool: ${tool}`,
      `- critical: ${counts.critical}`,
      `- high: ${counts.high}`,
      `- medium: ${counts.medium}`,
      `- low: ${counts.low}`,
      `- unknown: ${counts.unknown}`,
      `- verdict: ${summary.verdict}`,
      `- run: ${safeRunUrl}`,
      '',
    ].join('\n');
    await appendFile(summaryPath, markdown, { encoding: 'utf8', mode: 0o600 });
  }

  return passed;
}
