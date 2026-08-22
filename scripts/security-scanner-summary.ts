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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPosition = (value: unknown): boolean =>
  isRecord(value) &&
  Number.isInteger(value.line) &&
  Number.isInteger(value.col) &&
  (value.line as number) > 0 &&
  (value.col as number) > 0;

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
    !isRecord(value) ||
    !Array.isArray(value.results) ||
    !Array.isArray(value.errors)
  )
    throw new Error('invalid semgrep report');
  const counts = createEmptyCounts();
  for (const entry of value.results) {
    if (
      !isRecord(entry) ||
      typeof entry.check_id !== 'string' ||
      typeof entry.path !== 'string' ||
      !isPosition(entry.start) ||
      !isPosition(entry.end) ||
      !isRecord(entry.extra) ||
      typeof entry.extra.severity !== 'string'
    )
      throw new Error('invalid semgrep finding');
  }
  for (const error of value.errors) {
    if (!isRecord(error) || typeof error.message !== 'string')
      throw new Error('invalid semgrep error');
  }
  countArray(
    counts,
    value.results,
    (entry) => (entry as { extra: { severity: unknown } }).extra.severity,
  );
  counts.unknown += value.errors.length;
  return counts;
}

function parseTrivy(value: unknown): SeverityCounts {
  if (!isRecord(value) || !Array.isArray(value.Results))
    throw new Error('invalid trivy report');
  const counts = createEmptyCounts();
  for (const result of value.Results) {
    if (
      !isRecord(result) ||
      typeof result.Target !== 'string' ||
      typeof result.Class !== 'string' ||
      typeof result.Type !== 'string'
    )
      throw new Error('invalid trivy result');

    for (const [field, idKey] of [
      ['Vulnerabilities', 'VulnerabilityID'],
      ['Misconfigurations', 'ID'],
      ['Secrets', 'RuleID'],
    ] as const) {
      const findings = result[field];
      if (findings === undefined || findings === null) continue;
      if (!Array.isArray(findings)) throw new Error(`invalid trivy ${field}`);
      for (const finding of findings) {
        if (
          !isRecord(finding) ||
          typeof finding[idKey] !== 'string' ||
          typeof finding.Severity !== 'string'
        )
          throw new Error(`invalid trivy ${field} finding`);
      }
      countArray(
        counts,
        findings,
        (entry) => (entry as { Severity: unknown }).Severity,
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
