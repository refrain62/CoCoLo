export * from './auth-invitation.ts';
export * from './feature-contract.ts';
export * from './line-delivery-contract.ts';
export * from './subject-member.ts';
export * from './system-admin-contract.ts';
export * from './upload-contract.ts';

export const apiVersion = 'v1';
// 全APIが共有するエラー形式の例。実際のrequestIdはAPI middlewareで発行する。
export const errorResponseExample = {
  error: {
    code: 'VALIDATION_ERROR',
    message: '入力値が不正です。',
    details: {},
    requestId: '00000000-0000-7000-8000-000000000000',
  },
};
