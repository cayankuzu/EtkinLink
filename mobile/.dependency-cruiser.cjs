/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'shared-does-not-depend-on-features',
      severity: 'error',
      from: { path: '^src/shared' },
      to: { path: '^src/features' },
    },
    {
      name: 'features-do-not-depend-on-app',
      severity: 'error',
      from: { path: '^src/features' },
      to: { path: '^src/app' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'] },
  },
};
