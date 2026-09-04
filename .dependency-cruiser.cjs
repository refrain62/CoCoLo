module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'web-cannot-import-server',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: '^(apps/api|packages/(db|auth))' },
    },
    {
      name: 'domain-must-stay-pure',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: { path: '(^|/)(hono|react|@prisma/client)(/|$)' },
    },
    {
      name: 'contracts-cannot-import-domain-or-db',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: { path: '^packages/(domain|db)' },
    },
    {
      name: 'production-cannot-import-fixtures',
      severity: 'error',
      from: { path: '^(apps|packages)/(?!test-fixtures)' },
      to: { path: '^packages/test-fixtures' },
    },
  ],
  options: {
    doNotFollow: ['node_modules', 'dist'],
    moduleSystems: ['es6', 'cjs'],
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
