import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import {
  createInitialFixedE2eReport,
  type FixedE2eReport,
  type FixedE2eTestResult,
  getFixedE2eReportPath,
  safeE2eTestName,
  writeFixedE2eReport,
} from './e2e-report.ts';

export default class FixedE2eReporter implements Reporter {
  private readonly reportPath = getFixedE2eReportPath();
  private readonly initialReport = createInitialFixedE2eReport();
  private readonly tests = new Map<string, FixedE2eTestResult>();

  constructor() {
    writeFixedE2eReport(this.reportPath, this.initialReport);
  }

  onTestBegin(test: TestCase): void {
    this.tests.set(test.id, {
      testName: safeE2eTestName(test.location.file, test.title),
      status: 'failure',
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.tests.set(test.id, {
      testName: safeE2eTestName(test.location.file, test.title),
      status: result.status === 'passed' ? 'success' : 'failure',
    });
  }

  onEnd(result: FullResult): void {
    const tests = [...this.tests.values()].sort((left, right) =>
      left.testName.localeCompare(right.testName),
    );
    const passed =
      result.status === 'passed' &&
      tests.length > 0 &&
      tests.every((test) => test.status === 'success');
    const report: FixedE2eReport = {
      ...this.initialReport,
      status: passed ? 'success' : 'failure',
      tests,
    };
    writeFixedE2eReport(this.reportPath, report);
  }
}
