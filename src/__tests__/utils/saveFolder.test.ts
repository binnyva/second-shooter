import { describeFolderUri, pickSaveFolder } from '../../utils/saveFolder';
import { StorageAccessFramework } from 'expo-file-system/legacy';

const SAF = StorageAccessFramework as unknown as {
  requestDirectoryPermissionsAsync: jest.Mock;
  readDirectoryAsync: jest.Mock;
};

describe('describeFolderUri', () => {
  it('turns a tree URI into a readable path', () => {
    expect(
      describeFolderUri(
        'content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FShoots'
      )
    ).toBe('DCIM/Shoots');
  });

  it('ignores a trailing document segment', () => {
    expect(
      describeFolderUri(
        'content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FShoots/document/primary%3ADCIM%2FShoots'
      )
    ).toBe('DCIM/Shoots');
  });

  it('names the storage root when the folder is the volume itself', () => {
    expect(
      describeFolderUri('content://com.android.externalstorage.documents/tree/primary%3A')
    ).toBe('Internal storage');
  });

  it('marks folders on a removable volume', () => {
    expect(
      describeFolderUri(
        'content://com.android.externalstorage.documents/tree/1AEF-2B01%3APhotos'
      )
    ).toBe('SD card/Photos');
  });

  it('falls back to the raw URI when it is not a tree URI', () => {
    expect(describeFolderUri('file:///storage/emulated/0/DCIM')).toBe(
      'file:///storage/emulated/0/DCIM'
    );
  });
});

describe('pickSaveFolder', () => {
  beforeEach(() => {
    SAF.requestDirectoryPermissionsAsync.mockReset();
  });

  it('returns the picked folder with a display name', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({
      granted: true,
      directoryUri:
        'content://com.android.externalstorage.documents/tree/primary%3APictures%2FShoots',
    });

    await expect(pickSaveFolder()).resolves.toEqual({
      status: 'picked',
      folder: {
        uri: 'content://com.android.externalstorage.documents/tree/primary%3APictures%2FShoots',
        name: 'Pictures/Shoots',
      },
    });
  });

  it('reports a back-out as a cancel, so the setting is left alone', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(pickSaveFolder()).resolves.toEqual({ status: 'cancelled' });
  });

  // An initial location makes DocumentsUI enumerate that folder before it can
  // draw - five seconds of blank screen on a folder of a few thousand photos.
  it('opens the picker with no starting location', async () => {
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

    await pickSaveFolder();

    expect(SAF.requestDirectoryPermissionsAsync).toHaveBeenCalledWith(null);
  });

  // A wedged pending-request slot is indistinguishable from a cancel unless
  // it's called out - the picker simply never appears.
  it('distinguishes a wedged pending request from a cancel', async () => {
    SAF.requestDirectoryPermissionsAsync.mockRejectedValue(
      new Error(
        "Call to function 'ExponentFileSystem.requestDirectoryPermissionsAsync' has been rejected.\n→ Caused by: You have an unfinished permission request"
      )
    );

    await expect(pickSaveFolder()).resolves.toEqual({ status: 'stuck' });
  });

  it('reports any other failure with its message', async () => {
    SAF.requestDirectoryPermissionsAsync.mockRejectedValue(new Error('no activity'));

    await expect(pickSaveFolder()).resolves.toEqual({
      status: 'failed',
      message: 'no activity',
    });
  });

  // Two requests at once is the one way our own code can cause the rejection
  // that wedges the picker.
  it('refuses to open a second picker while one is up', async () => {
    let releasePicker: (result: unknown) => void = () => {};
    SAF.requestDirectoryPermissionsAsync.mockReturnValue(
      new Promise((resolve) => {
        releasePicker = resolve;
      })
    );

    const first = pickSaveFolder();
    const second = await pickSaveFolder();

    expect(second).toEqual({ status: 'already-open' });
    expect(SAF.requestDirectoryPermissionsAsync).toHaveBeenCalledTimes(1);

    releasePicker({ granted: false });
    await first;

    // ...and the guard lifts once it closes.
    SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickSaveFolder()).resolves.toEqual({ status: 'cancelled' });
  });
});

// Nothing here lists a directory. That's the point: every SAF listing this
// module used to do cost over a second on the user's folder, against the same
// provider the picker needs.
it('never lists a directory', async () => {
  SAF.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

  await pickSaveFolder();

  expect(SAF.readDirectoryAsync).not.toHaveBeenCalled();
});
