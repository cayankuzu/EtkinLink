module.exports = {
  preset: 'react-native',
  setupFiles: [
    '<rootDir>/node_modules/react-native-gesture-handler/jestSetup.js',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '\\.(ttf|otf)$': '<rootDir>/src/test/fileMock.js',
    '^expo-file-system/legacy$': '<rootDir>/src/test/expoFileSystemMock.js',
    '^expo-media-library$': '<rootDir>/src/test/expoMediaLibraryMock.js',
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@shopify|react-native-reanimated|react-native-safe-area-context|react-native-worklets|uuid)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/test/**',
    '!src/assets/**',
    '!src/shared/types/database.ts',
    '!src/**/index.ts',
  ],
  coverageReporters: ['text', 'lcov', 'clover', 'json', 'json-summary'],
  coverageThreshold: {
    global: {
      statements: 36,
      branches: 27,
      functions: 26,
      lines: 37,
    },
    'src/shared/lib/chatOutbox.ts': {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },
    'src/features/matching/compatibility.ts': {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
    'src/features/rooms/roomRules.ts': {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
  },
};
