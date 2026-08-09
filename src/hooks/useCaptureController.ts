import { useCallback, useRef } from 'react';
import { PhotoFile } from 'react-native-vision-camera';
import { CaptureQueue, CaptureRequest } from '../utils/captureQueue';
import { SavedMedia } from '../services/MediaService';

export interface CaptureControllerOptions {
  /** Capture a full-resolution photo. Resolves once the shot is taken. */
  takePhoto: (
    onPhotoSaved?: (saved: SavedMedia | null) => void
  ) => Promise<PhotoFile | null>;
  /** Capture a low-quality preview of the current framing. */
  takeSnapshot: () => Promise<string | null>;
  /** Take the camera back from WebRTC. Resolves true if WebRTC held it. */
  acquireCamera: () => Promise<boolean>;
  /** Hand the camera back to WebRTC. */
  releaseCamera: (wasHeld: boolean) => Promise<void>;
  /** The shot is on disk - use it for the local thumbnail. */
  onPhotoCaptured: (photo: PhotoFile) => void;
  /** The save finished (later than onPhotoCaptured). */
  onPhotoSaved?: (saved: SavedMedia | null) => void;
  /** A preview snapshot is ready to send to the remote. */
  onPreviewReady: (path: string, timestamp: number) => void;
  /** A remote-requested capture finished. */
  onRemoteCaptureComplete: (success: boolean, error?: string) => void;
}

/**
 * One serialised path for every photo capture on the camera device.
 *
 * All three shutters (remote command, volume button, on-screen) go through
 * here, so they can't overlap and fight over the camera, and a burst pays the
 * WebRTC pause/resume cost once instead of per shot.
 */
export function useCaptureController(options: CaptureControllerOptions) {
  // The queue outlives renders; read options through a ref so it always calls
  // the current callbacks without being rebuilt.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const queueRef = useRef<CaptureQueue | null>(null);

  // True for the whole cycle, not just the shutter. The frame-based preview
  // loop reads this to stay off the camera while a photo is being taken.
  const isCapturingRef = useRef(false);

  if (queueRef.current === null) {
    queueRef.current = new CaptureQueue({
      acquireCamera: async () => {
        isCapturingRef.current = true;
        try {
          return await optionsRef.current.acquireCamera();
        } catch (error) {
          isCapturingRef.current = false;
          throw error;
        }
      },
      releaseCamera: async (wasHeld) => {
        try {
          await optionsRef.current.releaseCamera(wasHeld);
        } finally {
          isCapturingRef.current = false;
        }
      },
      captureOne: async (request: CaptureRequest) => {
        const {
          takePhoto,
          takeSnapshot,
          onPhotoCaptured,
          onPhotoSaved,
          onPreviewReady,
          onRemoteCaptureComplete,
        } = optionsRef.current;

        // Timestamped here so a burst keeps capture order on the remote even
        // if the previews are read off disk out of order.
        const timestamp = Date.now();

        // Snapshot first: it has to show the framing about to be photographed.
        let snapshotPath: string | null = null;
        if (request.notifyRemote) {
          try {
            snapshotPath = await takeSnapshot();
          } catch (error) {
            console.error('Error taking preview snapshot:', error);
          }
        }

        // Handed off here, not after the photo, and deliberately not awaited:
        // the remote's live preview is dark for the whole cycle, so it needs
        // this image early enough to show instead of a frozen frame. The
        // base64 read runs alongside the capture rather than delaying it.
        if (snapshotPath) {
          onPreviewReady(snapshotPath, timestamp);
        }

        try {
          const photo = await takePhoto(onPhotoSaved);
          if (photo) {
            onPhotoCaptured(photo);
          }
          if (request.notifyRemote) {
            onRemoteCaptureComplete(true);
          }
        } catch (error) {
          if (request.notifyRemote) {
            onRemoteCaptureComplete(false, String(error));
          }
          throw error;
        }
      },
    });
  }

  const requestCapture = useCallback((request: CaptureRequest = { notifyRemote: false }) => {
    return queueRef.current!.enqueue(request);
  }, []);

  return { requestCapture, isCapturingRef };
}

export default useCaptureController;
