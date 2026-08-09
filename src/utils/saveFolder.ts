import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const { StorageAccessFramework: SAF } = FileSystem;

/**
 * A folder the user browsed to, addressed by a Storage Access Framework tree
 * URI. Android grants that URI persistably (expo-file-system calls
 * `takePersistableUriPermission`), so it keeps working across app restarts -
 * unlike an ordinary path, which scoped storage wouldn't let us write to.
 */
export interface PickedFolder {
  uri: string;
  name: string;
}

/**
 * SAF is an Android API and expo-file-system throws `UnavailabilityError`
 * elsewhere. iOS has no equivalent that survives a restart without
 * security-scoped bookmarks, which expo-file-system doesn't persist, so the
 * setting is hidden there rather than offered and quietly broken - saves go to
 * the camera roll.
 */
export function isSaveFolderSupported(): boolean {
  return Platform.OS === 'android';
}

/**
 * Turn a SAF tree URI into something worth showing in Settings.
 *
 * Tree URIs look like
 * `content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FShoots`
 * and sometimes carry a `/document/...` suffix. Decoded, the interesting part
 * is `<volume>:<path>`.
 */
export function describeFolderUri(uri: string): string {
  const treeMarker = '/tree/';
  const treeIndex = uri.indexOf(treeMarker);
  if (treeIndex === -1) {
    return uri;
  }

  let tree = uri.slice(treeIndex + treeMarker.length);
  const documentIndex = tree.indexOf('/document/');
  if (documentIndex !== -1) {
    tree = tree.slice(0, documentIndex);
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(tree);
  } catch {
    // Malformed percent-encoding - better to show the raw URI than to throw
    // from a render path.
    return uri;
  }

  const separator = decoded.indexOf(':');
  const volume = separator === -1 ? '' : decoded.slice(0, separator);
  const path = separator === -1 ? decoded : decoded.slice(separator + 1);

  // 'primary' is internal storage; anything else is a removable volume named
  // by its UUID, which means nothing to the user.
  const rootLabel = volume === 'primary' || volume === '' ? 'Internal storage' : 'SD card';

  if (!path) {
    return rootLabel;
  }
  return volume === 'primary' || volume === '' ? path : `${rootLabel}/${path}`;
}

/**
 * What came of asking for a folder.
 *
 * 'cancelled' and 'stuck' both leave the setting alone but mean opposite
 * things to the user - one is a decision, the other is a picker that never
 * appeared - so they must not collapse into the same "no folder" answer.
 */
export type FolderPickResult =
  | { status: 'picked'; folder: PickedFolder }
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'already-open' }
  | { status: 'stuck' }
  | { status: 'failed'; message: string };

// expo-file-system keeps one pending-request slot for the directory picker and
// clears it only when the activity result arrives. If that result is lost -
// classically, a dev-client reload or an activity recreation while the picker
// is in front - the slot stays occupied and every later request is rejected
// for the life of the process. There's no API to clear it; only a restart
// helps, so the case is worth naming rather than reporting as a generic error.
const PENDING_REQUEST_MESSAGE = 'unfinished permission request';

// Guards our own side of the same rule: a second request while the picker is
// already up would be rejected by the native module, which looks identical to
// the wedged state above.
let pickInFlight = false;

/**
 * Open the system folder browser.
 *
 * Deliberately opened with no starting location. Passing the current folder as
 * `EXTRA_INITIAL_URI` makes DocumentsUI resolve and enumerate that directory
 * before it can draw anything: on a folder of ~2700 photos that was over five
 * seconds of blank screen after the tap, and the stale listing kept showing
 * through the next directory the user browsed to. Reopening where you left off
 * is not worth that.
 */
export async function pickSaveFolder(): Promise<FolderPickResult> {
  if (!isSaveFolderSupported()) {
    return { status: 'unsupported' };
  }
  if (pickInFlight) {
    return { status: 'already-open' };
  }

  pickInFlight = true;
  try {
    const permission = await SAF.requestDirectoryPermissionsAsync(null);
    if (!permission.granted) {
      return { status: 'cancelled' };
    }
    return {
      status: 'picked',
      folder: {
        uri: permission.directoryUri,
        name: describeFolderUri(permission.directoryUri),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error picking save folder:', message);
    return message.includes(PENDING_REQUEST_MESSAGE)
      ? { status: 'stuck' }
      : { status: 'failed', message };
  } finally {
    pickInFlight = false;
  }
}

// There is deliberately no writability probe here. The obvious one - list the
// directory and see whether it throws - is the same `DocumentFile.listFiles()`
// that costs over a second on a large folder, and it ran on entry to Settings,
// against the very provider the folder picker was about to need. Whether the
// folder still works is now answered by the last real save instead
// (MediaService.getBrokenSaveFolder), which costs nothing and reports what
// actually happened rather than what a probe predicted.

export default {
  isSaveFolderSupported,
  describeFolderUri,
  pickSaveFolder,
};
