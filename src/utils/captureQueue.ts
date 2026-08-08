/**
 * Serialises photo captures on the camera device.
 *
 * Captures arrive from three places - the remote's TAKE_PHOTO command, the
 * volume shutter and the on-screen shutter - and they all drive the same
 * physical camera. Overlapping cycles unbind vision-camera's ImageCapture
 * mid-capture, which surfaces on Android as "Failure to submit capture
 * request", so every request goes through one queue.
 *
 * The queue also coalesces the WebRTC camera lock: a burst acquires the camera
 * once, takes every queued photo, then releases it once, instead of paying a
 * pause/getUserMedia round trip per shot.
 */

export interface CaptureRequest {
  /** Send PHOTO_TAKEN / PHOTO_DATA back over the data channel. */
  notifyRemote: boolean;
}

export interface CaptureQueueDeps {
  /** Take the camera from WebRTC if it holds it. Resolves true if it did. */
  acquireCamera: () => Promise<boolean>;
  /** Give the camera back to WebRTC. `wasHeld` is what acquireCamera returned. */
  releaseCamera: (wasHeld: boolean) => Promise<void>;
  /** Capture one photo. Must not touch the WebRTC lock. */
  captureOne: (request: CaptureRequest) => Promise<void>;
}

interface QueueItem {
  request: CaptureRequest;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export class CaptureQueue {
  private queue: QueueItem[] = [];
  private draining = false;

  constructor(private readonly deps: CaptureQueueDeps) {}

  /** True while a capture cycle is running. */
  get isBusy(): boolean {
    return this.draining;
  }

  /** Requests still waiting to be captured. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Queue a capture. The promise settles when *this* photo is done. */
  enqueue(request: CaptureRequest): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ request, resolve, reject });

      // Set synchronously: a second enqueue in the same tick must see it.
      if (!this.draining) {
        this.draining = true;
        void this.drain();
      }
    });
  }

  private async drain(): Promise<void> {
    try {
      // Outer loop: a request that arrives while the camera is being released
      // gets a fresh acquire/release cycle rather than being stranded.
      while (this.queue.length > 0) {
        let wasHeld = false;

        try {
          wasHeld = await this.deps.acquireCamera();
        } catch (error) {
          // Nothing can be captured without the camera.
          this.failAll(error);
          await this.release(wasHeld);
          continue;
        }

        try {
          while (this.queue.length > 0) {
            const item = this.queue.shift()!;
            try {
              await this.deps.captureOne(item.request);
              item.resolve();
            } catch (error) {
              // One failed shot must not strand the rest of the burst.
              item.reject(error);
            }
          }
        } finally {
          await this.release(wasHeld);
        }
      }
    } finally {
      // No await between the final queue check and here, so an enqueue racing
      // this cannot see draining === true and then find no drain running.
      this.draining = false;
    }
  }

  private async release(wasHeld: boolean): Promise<void> {
    try {
      await this.deps.releaseCamera(wasHeld);
    } catch (error) {
      console.error('[CAMERA] Failed to hand the camera back to WebRTC:', error);
    }
  }

  private failAll(error: unknown): void {
    const stranded = this.queue;
    this.queue = [];
    stranded.forEach((item) => item.reject(error));
  }
}

export default CaptureQueue;
