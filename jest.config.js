module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Anchor .claude to <rootDir> so this ignore only matches worktrees viewed
  // from the main repo (where rootDir is the repo root, and worktrees live at
  // <rootDir>/.claude/worktrees). When jest runs INSIDE a worktree, rootDir
  // is the worktree itself and the worktree's tests stay in scope.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/\\.claude/', '/expo-libsignal\\.bak'],
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
