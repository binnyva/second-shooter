// Stand-in for expo-file-system/legacy. The native module isn't available in
// the node test environment, so every call is a jest mock the test can drive.
export const EncodingType = {
  UTF8: 'utf8',
  Base64: 'base64',
} as const;

export const documentDirectory = 'file:///data/user/0/app/files/';

export const readAsStringAsync = jest.fn();
export const writeAsStringAsync = jest.fn();
export const copyAsync = jest.fn();
export const deleteAsync = jest.fn();
export const getInfoAsync = jest.fn();
export const makeDirectoryAsync = jest.fn();
export const readDirectoryAsync = jest.fn();

export const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: jest.fn(),
  readDirectoryAsync: jest.fn(),
  createFileAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
};
