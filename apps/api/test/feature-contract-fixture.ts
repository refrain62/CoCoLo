const featureKeys = [
  ['members', 'free', 'メンバー管理'],
  ['events-attendance', 'free', '予定・出欠'],
  ['board-contacts', 'free', '役員・連絡先'],
  ['bulletin-board', 'free', '回覧板'],
  ['attachments', 'free', '添付ファイル'],
  ['line-notifications', 'paid', 'LINE通知'],
  ['ride-operations', 'paid', '送迎管理'],
  ['orders-payments', 'paid', '注文・決済'],
] as const;

export function createFeatureContractFeatures() {
  const snapshot = {
    planKey: 'test',
    planStatus: 'active' as const,
    features: featureKeys.map(([key, billingType, displayName]) => ({
      key,
      billingType,
      displayName,
      defaultEnabled: true,
      enabled: true,
      reason: 'default' as const,
    })),
  };
  return {
    featureContract: {
      repository: {
        get: async () => snapshot,
        setFreeFlag: async () => snapshot,
        syncPlan: async () => undefined,
        grantPaidFeature: async () => undefined,
      },
    },
  };
}
