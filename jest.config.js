/** @type {import('jest').Config} */
const TSCONFIG = '<rootDir>/tests/tsconfig.json';

const tsJestConfig = {
  tsconfig: TSCONFIG,
};

const TRANSFORM = {
  '^.+\\.[jt]sx?$': ['ts-jest', tsJestConfig],
};

const TRANSFORM_IGNORE = ['node_modules/(?!(@firebase|firebase|jose|jwks-rsa|@panva|oidc-token-hash)/)'];

module.exports = {
  testEnvironment: 'node',
  testTimeout:     60_000,    // top-level; applies to all projects
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/functions/lib/'],

  projects: [
    {
      displayName:             'unit',
      testMatch:               ['<rootDir>/tests/unit/**/*.test.ts'],
      testEnvironment:         'node',
      transform:               TRANSFORM,
      transformIgnorePatterns: TRANSFORM_IGNORE,
    },
    {
      displayName:             'rules',
      testMatch:               ['<rootDir>/tests/rules/**/*.test.ts'],
      testEnvironment:         'node',
      transform:               TRANSFORM,
      transformIgnorePatterns: TRANSFORM_IGNORE,
    },
    {
      displayName:             'functions',
      testMatch:               ['<rootDir>/tests/functions/**/*.test.ts'],
      testEnvironment:         'node',
      transform:               TRANSFORM,
      transformIgnorePatterns: TRANSFORM_IGNORE,
    },
  ],
};
