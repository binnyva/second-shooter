// Stand-in for expo-media-library. Every call is a jest mock the test drives;
// the enums are the real string values the module exports.
export const MediaType = {
  photo: 'photo',
  video: 'video',
} as const;

export const SortBy = {
  creationTime: 'creationTime',
  default: 'default',
} as const;

export const createAssetAsync = jest.fn();
export const getAssetsAsync = jest.fn();
export const getPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
export const requestPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
export const getAlbumAsync = jest.fn();
export const createAlbumAsync = jest.fn();
export const addAssetsToAlbumAsync = jest.fn();

export type Asset = { uri: string };
