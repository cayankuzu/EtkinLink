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
    'src/features/auth/authSchemas.ts',
    'src/features/onboarding/onboardingSchemas.ts',
    'src/features/rooms/roomRules.ts',
    'src/shared/lib/chatOutbox.ts',
  ],
};
