// Imported by path, not as 'expo': the mapping in jest.config.js redirects the
// module under test at runtime, but TypeScript still types 'expo' from the real
// package, which has no test hooks.
import { __setNativeModule, __clearNativeModules } from '../__mocks__/expo';
import { SYSTEM_DEFAULT_GALLERY } from '../../types';

type GalleryAppsUtils = typeof import('../../utils/galleryApps');

// The util decides both of the things under test at import time - the platform
// and whether the native module exists - so every case builds its own copy of
// the module graph. `Platform` has to be set inside the isolated scope too: the
// util sees that scope's copy of the react-native mock, not the outer one.
function loadUtils(os: string = 'android'): GalleryAppsUtils {
  let utils!: GalleryAppsUtils;
  jest.isolateModules(() => {
    (require('react-native').Platform as { OS: string }).OS = os;
    utils = require('../../utils/galleryApps');
  });
  return utils;
}

function installNativeModule(overrides: {
  getGalleryApps?: jest.Mock;
  openGallery?: jest.Mock;
}) {
  const native = {
    getGalleryApps: overrides.getGalleryApps ?? jest.fn().mockResolvedValue([]),
    openGallery: overrides.openGallery ?? jest.fn().mockResolvedValue(true),
  };
  __setNativeModule('GalleryApps', native);
  return native;
}

describe('galleryApps', () => {
  beforeEach(() => {
    __clearNativeModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isGalleryAppChoiceSupported', () => {
    it('is true on Android with the native module present', () => {
      installNativeModule({});
      expect(loadUtils().isGalleryAppChoiceSupported()).toBe(true);
    });

    it('is false without the native module, as on a binary built before it', () => {
      expect(loadUtils().isGalleryAppChoiceSupported()).toBe(false);
    });

    it('is false off Android', () => {
      installNativeModule({});
      expect(loadUtils('ios').isGalleryAppChoiceSupported()).toBe(false);
    });
  });

  describe('listGalleryApps', () => {
    it('returns what the native module found', async () => {
      const apps = [{ packageName: 'com.google.android.apps.photos', label: 'Photos' }];
      installNativeModule({ getGalleryApps: jest.fn().mockResolvedValue(apps) });
      await expect(loadUtils().listGalleryApps()).resolves.toEqual(apps);
    });

    it('is empty rather than throwing when unsupported', async () => {
      await expect(loadUtils().listGalleryApps()).resolves.toEqual([]);
    });

    it('is empty when the native query fails', async () => {
      installNativeModule({
        getGalleryApps: jest.fn().mockRejectedValue(new Error('boom')),
      });
      await expect(loadUtils().listGalleryApps()).resolves.toEqual([]);
    });
  });

  describe('openGalleryApp', () => {
    it('passes a package name straight through', async () => {
      const openGallery = jest.fn().mockResolvedValue(true);
      installNativeModule({ openGallery });
      await expect(loadUtils().openGalleryApp('com.sec.android.gallery3d')).resolves.toBe(
        true
      );
      expect(openGallery).toHaveBeenCalledWith('com.sec.android.gallery3d');
    });

    it('turns the sentinel into null, which means "let the system pick"', async () => {
      const openGallery = jest.fn().mockResolvedValue(true);
      installNativeModule({ openGallery });
      await loadUtils().openGalleryApp(SYSTEM_DEFAULT_GALLERY);
      expect(openGallery).toHaveBeenCalledWith(null);
    });

    it('is false when nothing could be opened, so callers fall back', async () => {
      installNativeModule({ openGallery: jest.fn().mockResolvedValue(false) });
      await expect(loadUtils().openGalleryApp('com.uninstalled.gallery')).resolves.toBe(
        false
      );
    });

    it('is false when the launch throws', async () => {
      installNativeModule({ openGallery: jest.fn().mockRejectedValue(new Error('boom')) });
      await expect(loadUtils().openGalleryApp('com.some.gallery')).resolves.toBe(false);
    });

    it('is false when unsupported', async () => {
      await expect(loadUtils().openGalleryApp(SYSTEM_DEFAULT_GALLERY)).resolves.toBe(false);
    });
  });
});
