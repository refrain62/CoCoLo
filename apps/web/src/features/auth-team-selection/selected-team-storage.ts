const selectedTeamStorageKey = 'cocolo.selectedTeamId';

// Vitestはworkspace packageのbuild前に実行されるため、ブラウザ側の固定header名をここで持つ。
export const selectedTeamHeaderName = 'X-CoCoLo-Team-Id';

// tenantIdだけを保存し、再読み込み後もサーバー側でactive所属を再検証できるようにする。
export function getStoredSelectedTeamId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(selectedTeamStorageKey);
  } catch {
    return null;
  }
}

export function setStoredSelectedTeamId(tenantId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(selectedTeamStorageKey, tenantId);
  } catch {
    // 保存できない環境でも現在のタブの状態はReact側で保持する。
  }
}

export function clearStoredSelectedTeamId() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(selectedTeamStorageKey);
  } catch {
    // 次回アクセス時にサーバー側で所属を再評価するため、保存先の例外は画面へ返さない。
  }
}
