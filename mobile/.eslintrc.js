module.exports = {
  root: true,
  extends: '@react-native',
  plugins: ['simple-import-sort'],
  rules: {
    // Release builds still forward console output to logcat/os_log, so a raw
    // provider error logged here leaks push tokens and signed URLs. Only the
    // redacting telemetry helper may write to the console (override below).
    'no-console': 'error',
    'no-void': 'off',
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    'react-native/no-inline-styles': 'error',
    'react-hooks/exhaustive-deps': [
      'error',
      {
        additionalHooks: '(useAnimatedStyle|useDerivedValue|useAnimatedProps)',
      },
    ],
  },
  overrides: [
    {
      files: ['src/shared/lib/telemetry.ts'],
      rules: {
        'no-console': ['error', { allow: ['warn'] }],
      },
    },
  ],
};
