import { Platform } from 'react-native';
import GalleryApps, { GalleryAppInfo } from '../../modules/gallery-apps';
import { SYSTEM_DEFAULT_GALLERY, GalleryApp } from '../types';

export type { GalleryAppInfo };

/**
 * Whether the user can be offered a choice of gallery app.
 *
 * Android only. Picking one means enumerating installed packages and then
 * launching an explicit intent, and iOS has neither - there is exactly one
 * Photos app and no way to see what else is installed. The setting stays on
 * 'system-default' there and Settings hides the row.
 *
 * False on Android too if the native module is missing, which happens on a
 * binary built before it existed - a JS reload can't add native code.
 */
export function isGalleryAppChoiceSupported(): boolean {
  return Platform.OS === 'android' && GalleryApps != null;
}

/**
 * Installed apps that can show the user their photos, sorted by name.
 *
 * Empty rather than throwing when unsupported, so callers can render the list
 * they get without branching first.
 */
export async function listGalleryApps(): Promise<GalleryAppInfo[]> {
  if (!isGalleryAppChoiceSupported()) {
    return [];
  }
  try {
    return await GalleryApps!.getGalleryApps();
  } catch (error) {
    console.error('Error listing gallery apps:', error);
    return [];
  }
}

/**
 * Open the chosen gallery app, or the system default for
 * `SYSTEM_DEFAULT_GALLERY`.
 *
 * Resolves false when nothing could be opened - including when the chosen app
 * has since been uninstalled, which the setting has no way of noticing on its
 * own. Callers should fall back rather than leave the tap doing nothing.
 */
export async function openGalleryApp(galleryApp: GalleryApp): Promise<boolean> {
  if (!isGalleryAppChoiceSupported()) {
    return false;
  }
  const packageName = galleryApp === SYSTEM_DEFAULT_GALLERY ? null : galleryApp;
  try {
    return await GalleryApps!.openGallery(packageName);
  } catch (error) {
    console.error('Error opening gallery app:', error);
    return false;
  }
}

export default {
  isGalleryAppChoiceSupported,
  listGalleryApps,
  openGalleryApp,
};
