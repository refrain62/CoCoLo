export type LineEndingFile = Readonly<{
  path: string;
  content: Uint8Array;
}>;

export type LineEndingViolation = Readonly<{
  path: string;
  kind: 'carriage-return';
}>;

export function findLineEndingViolations(
  files: readonly LineEndingFile[],
): LineEndingViolation[] {
  return files
    .filter(({ content }) => content.some((byte) => byte === 0x0d))
    .map(({ path }) => ({ path, kind: 'carriage-return' as const }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
