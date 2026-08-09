/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^react-native-vision-camera$': '<rootDir>/src/__tests__/__mocks__/react-native-vision-camera.ts',
    '^expo-crypto$': '<rootDir>/src/__tests__/__mocks__/expo-crypto.ts',
    '^expo$': '<rootDir>/src/__tests__/__mocks__/expo.ts',
    '^react-native-webrtc$': '<rootDir>/src/__tests__/__mocks__/react-native-webrtc.ts',
    '^firebase/firestore$': '<rootDir>/src/__tests__/__mocks__/firebase-firestore.ts',
    '^react-native$': '<rootDir>/src/__tests__/__mocks__/react-native.ts',
    '^expo-file-system/legacy$': '<rootDir>/src/__tests__/__mocks__/expo-file-system.ts',
    '^expo-media-library$': '<rootDir>/src/__tests__/__mocks__/expo-media-library.ts',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/src/__tests__/__mocks__/async-storage.ts',
    '^../config/firebase$': '<rootDir>/src/__tests__/__mocks__/firebase-config.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
};
