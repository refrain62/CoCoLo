type MemberOption = { id: string };

export function readSubjectMemberId<T extends MemberOption>(
  storageKey: string,
  options: readonly T[],
) {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored && options.some((option) => option.id === stored))
        return stored;
    } catch {
      // sessionStorageが使えない場合は、選択肢の先頭へ安全にフォールバックする。
    }
  }
  return options[0]?.id ?? '';
}

export function writeSubjectMemberId(storageKey: string, memberId: string) {
  if (typeof window === 'undefined' || !memberId) return;
  try {
    window.sessionStorage.setItem(storageKey, memberId);
  } catch {
    // 保存できない場合も、現在画面の選択状態は維持する。
  }
}
