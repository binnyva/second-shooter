import { useState, useCallback, useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { appendPhoto, HistoryPhoto } from '../utils/photoHistory';

const PREVIEW_DIR = `${FileSystem.cacheDirectory}remote-previews/`;
const DEFAULT_MAX = 20;

interface UseRemotePhotoHistoryOptions {
  /** How many photos to keep before dropping the oldest. */
  max?: number;
}

/**
 * Keeps the photos received from the camera device this session, so the remote
 * can page back through a burst instead of only seeing the latest shot.
 *
 * Each preview is written to the cache directory and tracked as a file URI -
 * holding twenty base64 data URIs in React state would be needlessly heavy.
 * Files are deleted when they fall off the end of the history and when the
 * history is cleared (disconnect or unmount).
 */
export function useRemotePhotoHistory({ max = DEFAULT_MAX }: UseRemotePhotoHistoryOptions = {}) {
  const [photos, setPhotos] = useState<HistoryPhoto[]>([]);

  // Serialises the writes so a burst can't interleave directory creation, and
  // so clear() can't race a write that is still in flight.
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isMountedRef = useRef(true);
  // Timestamps come from the camera device and two shots could share a
  // millisecond - the counter keeps file names (and list keys) unique.
  const sequenceRef = useRef(0);

  const deleteFiles = useCallback(async (entries: HistoryPhoto[]) => {
    await Promise.all(
      entries.map((entry) =>
        FileSystem.deleteAsync(entry.uri, { idempotent: true }).catch((error) => {
          console.warn('[REMOTE] Failed to delete cached preview:', error);
        })
      )
    );
  }, []);

  const addPhoto = useCallback(
    (base64: string, timestamp: number = Date.now()) => {
      const run = writeQueueRef.current.then(async () => {
        try {
          await FileSystem.makeDirectoryAsync(PREVIEW_DIR, { intermediates: true });

          const uri = `${PREVIEW_DIR}photo-${timestamp}-${sequenceRef.current++}.jpg`;
          await FileSystem.writeAsStringAsync(uri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });

          if (!isMountedRef.current) {
            await deleteFiles([{ uri, timestamp }]);
            return;
          }

          let evicted: HistoryPhoto[] = [];
          setPhotos((current) => {
            const result = appendPhoto(current, { uri, timestamp }, max);
            evicted = result.evicted;
            return result.list;
          });

          if (evicted.length > 0) {
            await deleteFiles(evicted);
          }
        } catch (error) {
          console.error('[REMOTE] Failed to store captured photo:', error);
        }
      });

      writeQueueRef.current = run;
      return run;
    },
    [max, deleteFiles]
  );

  const clear = useCallback(() => {
    const run = writeQueueRef.current.then(async () => {
      if (isMountedRef.current) {
        setPhotos([]);
      }
      await FileSystem.deleteAsync(PREVIEW_DIR, { idempotent: true }).catch((error) => {
        console.warn('[REMOTE] Failed to clear cached previews:', error);
      });
    });

    writeQueueRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return { photos, addPhoto, clear };
}

export default useRemotePhotoHistory;
