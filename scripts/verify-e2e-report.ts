import { readFileSync } from 'node:fs';
import { readFixedE2eReport } from './e2e-report.ts';

function fail(): never {
  throw new Error('固定E2Eレポートの秘匿検査に失敗しました。');
}

const pathArgument = process.argv[2];
if (pathArgument !== '--path' || !process.argv[3]) fail();

const reportPath = process.argv[3];
let reportText: string;
try {
  reportText = readFileSync(reportPath, 'utf8');
  readFixedE2eReport(reportPath);
} catch {
  fail();
}

const forbiddenValues = [
  process.env.E2E_REPORT_CANARY,
  process.env.E2E_TEST_EMAIL,
  process.env.E2E_TEST_PASSWORD,
  process.env.DATABASE_URL,
  process.env.DIRECT_URL,
].filter((value): value is string => Boolean(value));
if (forbiddenValues.some((value) => reportText.includes(value))) fail();

if (
  /@|[0-9]{2,4}[-.][0-9]{2,4}[-.][0-9]{3,4}|password|secret|token|authorization|cookie|storage|http[ _-]?body|database_url|direct_url/i.test(
    reportText,
  )
)
  fail();

console.log('固定E2Eレポートを検証しました。');
