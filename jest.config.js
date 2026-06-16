module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/\\.claude/',
    '/expo-libsignal\\.bak',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/\\.claude/',
    '<rootDir>/example/node_modules/expo-libsignal\\.bak',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  moduleNameMapper: {
    '^expo$': '<rootDir>/__mocks__/expo.js',
    '^expo-libsignal$': '<rootDir>/src/index.ts',
    '^expo-libsignal/stores$': '<rootDir>/src/stores/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
}
