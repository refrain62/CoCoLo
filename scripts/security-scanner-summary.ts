import { appendFile, readFile } from 'node:fs/promises';

import type { ScannerName } from './security-scanner-config.ts';
import {
  isScannerException,
  type ScannerException,
  type ScannerSeverity,
} from './security-scanner-exceptions.ts';

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
  exempted: number;
  verdict: 'PASS' | 'FAIL';
};

type ParsedReport = { counts: SeverityCounts; exempted: number };

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

const severityName = (value: unknown): ScannerSeverity | undefined => {
  if (typeof value !== 'string') return undefined;
  switch (value.toUpperCase()) {
    case 'CRITICAL':
      return 'CRITICAL';
    case 'HIGH':
    case 'ERROR':
      return 'HIGH';
    case 'MEDIUM':
    case 'WARNING':
      return 'MEDIUM';
    case 'LOW':
    case 'INFO':
      return 'LOW';
    default:
      return undefined;
  }
};

const severityKey = (
  value: ScannerSeverity | undefined,
): keyof SeverityCounts =>
  (value ? value.toLowerCase() : 'unknown') as keyof SeverityCounts;

function parseGitleaks(
  value: unknown,
  exceptions: readonly ScannerException[],
): ParsedReport {
  if (!Array.isArray(value)) throw new Error('invalid gitleaks report');
  const counts = createEmptyCounts();
  let exempted = 0;
  for (const finding of value) {
    if (!isRecord(finding) || typeof finding.RuleID !== 'string')
      throw new Error('invalid gitleaks finding');
    if (
      isScannerException(exceptions, 'gitleaks', finding.RuleID, 'CRITICAL')
    ) {
      exempted += 1;
      continue;
    }
    // Gitleaks findings are treated as Critical because they represent secret exposure.
    counts.critical += 1;
  }
  return { counts, exempted };
}

function parseSemgrep(
  value: unknown,
  exceptions: readonly ScannerException[],
): ParsedReport {
  if (
    !isRecord(value) ||
    !Array.isArray(value.results) ||
    !Array.isArray(value.errors)
  )
    throw new Error('invalid semgrep report');
  const counts = createEmptyCounts();
  let exempted = 0;
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
    const severity = severityName(entry.extra.severity);
    if (
      severity &&
      isScannerException(exceptions, 'semgrep', entry.check_id, severity)
    ) {
      exempted += 1;
      continue;
    }
    counts[severityKey(severity)] += 1;
  }
  for (const error of value.errors) {
    if (!isRecord(error) || typeof error.message !== 'string')
      throw new Error('invalid semgrep error');
  }
  counts.unknown += value.errors.length;
  return { counts, exempted };
}

function parseTrivy(
  value: unknown,
  exceptions: readonly ScannerException[],
): ParsedReport {
  if (!isRecord(value) || !Array.isArray(value.Results))
    throw new Error('invalid trivy report');
  const counts = createEmptyCounts();
  let exempted = 0;
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
        const severity = severityName(finding.Severity);
        if (
          severity &&
          isScannerException(exceptions, 'trivy', finding[idKey], severity)
        ) {
          exempted += 1;
          continue;
        }
        counts[severityKey(severity)] += 1;
      }
    }
  }
  return { counts, exempted };
}

function parseReport(
  tool: ScannerName,
  value: unknown,
  exceptions: readonly ScannerException[],
): ParsedReport {
  if (tool === 'gitleaks') return parseGitleaks(value, exceptions);
  if (tool === 'semgrep') return parseSemgrep(value, exceptions);
  return parseTrivy(value, exceptions);
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
  return `tool=${summary.tool} critical=${counts.critical} high=${counts.high} medium=${counts.medium} low=${counts.low} unknown=${counts.unknown} exempted=${summary.exempted} verdict=${summary.verdict} run_url=${safeRunUrl}`;
}

export async function summarizeScannerResult(
  tool: ScannerName,
  resultPath: string,
  scannerExitCode: number,
  runUrl: string,
  summaryPath?: string,
  exceptions: readonly ScannerException[] = [],
): Promise<boolean> {
  let parsed: ParsedReport = {
    counts: createEmptyCounts(),
    exempted: 0,
  };
  let reportValid = true;
  try {
    parsed = parseReport(
      tool,
      JSON.parse(await readFile(resultPath, 'utf8')),
      exceptions,
    );
  } catch {
    reportValid = false;
    parsed.counts.unknown = 1;
  }

  const passed =
    reportValid &&
    isClean(parsed.counts) &&
    (scannerExitCode === 0 || (scannerExitCode === 1 && parsed.exempted > 0));
  const summary: ScannerSummary = {
    tool,
    counts: parsed.counts,
    exempted: parsed.exempted,
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
      `- critical: ${parsed.counts.critical}`,
      `- high: ${parsed.counts.high}`,
      `- medium: ${parsed.counts.medium}`,
      `- low: ${parsed.counts.low}`,
      `- unknown: ${parsed.counts.unknown}`,
      `- exempted: ${parsed.exempted}`,
      `- verdict: ${summary.verdict}`,
      `- run: ${safeRunUrl}`,
      '',
    ].join('\n');
    await appendFile(summaryPath, markdown, { encoding: 'utf8', mode: 0o600 });
  }

  return passed;
}
