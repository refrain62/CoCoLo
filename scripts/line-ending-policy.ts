export type LineEndingFile = Readonly<{
  path: string;
  content: Uint8Array;
  isText?: boolean;
}>;

export type LineEndingViolation = Readonly<{
  path: string;
  kind: 'carriage-return' | 'utf8-bom' | 'invalid-utf8' | 'missing-final-lf';
}>;

export function findLineEndingViolations(
  files: readonly LineEndingFile[],
): LineEndingViolation[] {
  const violations: LineEndingViolation[] = [];
  for (const { path, content, isText = true } of files) {
    if (!isText) continue;
    if (content.some((byte) => byte === 0x0d))
      violations.push({ path, kind: 'carriage-return' });
    if (
      content.length >= 3 &&
      content[0] === 0xef &&
      content[1] === 0xbb &&
      content[2] === 0xbf
    )
      violations.push({ path, kind: 'utf8-bom' });
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      violations.push({ path, kind: 'invalid-utf8' });
    }
    if (content.length > 0 && content.at(-1) !== 0x0a)
      violations.push({ path, kind: 'missing-final-lf' });
  }
  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.kind.localeCompare(right.kind),
  );
}
