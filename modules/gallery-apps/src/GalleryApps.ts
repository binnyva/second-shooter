import { requireOptionalNativeModule } from 'expo';

/** An installed app that can show the user their photos. */
export interface GalleryAppInfo {
  /** Android package name - the value persisted in settings. */
  packageName: string;
  /** The app's own display name, e.g. 'Photos'. */
  label: string;
}

interface GalleryAppsNativeModule {
  getGalleryApps(): Promise<GalleryAppInfo[]>;
  openGallery(packageName: string | null): Promise<boolean>;
}

/**
 * Null off Android, and also on an app binary built before this module existed
 * - a JS-only reload of a change that adds a native module doesn't ship the
 * native half. Callers must handle null rather than assume a rebuild happened.
 */
const GalleryApps = requireOptionalNativeModule<GalleryAppsNativeModule>('GalleryApps');

export default GalleryApps;
