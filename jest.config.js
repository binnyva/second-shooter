/** @type {import('ts-jest').JestConfigWithTsJest} */
// Tests for the code shared by the Android app and the web remote. The
// Android app's own tests are JUnit: `cd android && ./gradlew test`.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/shared'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  verbose: true,
};
