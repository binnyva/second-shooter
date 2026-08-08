import { CaptureQueue, CaptureRequest } from '../../utils/captureQueue';

/** A promise whose resolution the test controls. */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending microtasks run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Harness {
  queue: CaptureQueue;
  events: string[];
  captures: CaptureRequest[];
  /** Blocks the next captureOne call until released. */
  blockNextCapture: () => { release: () => void; fail: (error: unknown) => void };
}

function createHarness(): Harness {
  const events: string[] = [];
  const captures: CaptureRequest[] = [];
  let blocker: ReturnType<typeof deferred<void>> | null = null;

  const queue = new CaptureQueue({
    acquireCamera: async () => {
      events.push('acquire');
      return true;
    },
    releaseCamera: async (wasHeld) => {
      events.push(`release:${wasHeld}`);
    },
    captureOne: async (request) => {
      events.push('capture');
      captures.push(request);
      if (blocker) {
        const pending = blocker;
        blocker = null;
        await pending.promise;
      }
    },
  });

  return {
    queue,
    events,
    captures,
    blockNextCapture: () => {
      const pending = deferred();
      blocker = pending;
      return { release: () => pending.resolve(), fail: (error) => pending.reject(error) };
    },
  };
}

const photo: CaptureRequest = { notifyRemote: false };
const remotePhoto: CaptureRequest = { notifyRemote: true };

describe('CaptureQueue', () => {
  it('acquires the camera, captures, then releases it', async () => {
    const { queue, events } = createHarness();

    await queue.enqueue(photo);
    await flush();

    expect(events).toEqual(['acquire', 'capture', 'release:true']);
    expect(queue.isBusy).toBe(false);
  });

  it('never runs two captures concurrently', async () => {
    const { queue, events, blockNextCapture } = createHarness();
    const blocked = blockNextCapture();

    const first = queue.enqueue(photo);
    await flush();
    const second = queue.enqueue(photo);
    await flush();

    // The second capture must not have started while the first is in flight.
    expect(events).toEqual(['acquire', 'capture']);

    blocked.release();
    await Promise.all([first, second]);
    await flush();

    expect(events).toEqual(['acquire', 'capture', 'capture', 'release:true']);
  });

  it('takes the camera once for a whole burst', async () => {
    const { queue, events, blockNextCapture } = createHarness();
    const blocked = blockNextCapture();

    const shots = [queue.enqueue(photo), queue.enqueue(photo), queue.enqueue(photo)];
    await flush();
    blocked.release();
    await Promise.all(shots);
    await flush();

    expect(events.filter((event) => event === 'acquire')).toHaveLength(1);
    expect(events.filter((event) => event === 'capture')).toHaveLength(3);
    expect(events.filter((event) => event.startsWith('release'))).toHaveLength(1);
  });

  it('starts a fresh cycle for a request that arrives during release', async () => {
    const events: string[] = [];
    const releaseStarted = deferred();
    const holdRelease = deferred();
    let releases = 0;

    const queue = new CaptureQueue({
      acquireCamera: async () => {
        events.push('acquire');
        return true;
      },
      releaseCamera: async () => {
        events.push('release');
        if (releases++ === 0) {
          releaseStarted.resolve();
          await holdRelease.promise;
        }
      },
      captureOne: async () => {
        events.push('capture');
      },
    });

    const first = queue.enqueue(photo);
    await releaseStarted.promise;

    // Arrives while the camera is being handed back to WebRTC.
    const second = queue.enqueue(photo);
    holdRelease.resolve();

    await Promise.all([first, second]);
    await flush();

    expect(events).toEqual(['acquire', 'capture', 'release', 'acquire', 'capture', 'release']);
    expect(queue.isBusy).toBe(false);
  });

  it('rejects only the failed shot and captures the rest of the burst', async () => {
    const { queue, events, blockNextCapture } = createHarness();
    const blocked = blockNextCapture();

    const first = queue.enqueue(photo);
    const second = queue.enqueue(photo);
    await flush();
    blocked.fail(new Error('Failure to submit capture request'));

    await expect(first).rejects.toThrow('Failure to submit capture request');
    await expect(second).resolves.toBeUndefined();
    await flush();

    expect(events).toEqual(['acquire', 'capture', 'capture', 'release:true']);
    expect(queue.isBusy).toBe(false);
  });

  it('rejects every queued shot when the camera cannot be acquired', async () => {
    const events: string[] = [];
    const queue = new CaptureQueue({
      acquireCamera: async () => {
        events.push('acquire');
        throw new Error('camera busy');
      },
      releaseCamera: async () => {
        events.push('release');
      },
      captureOne: async () => {
        events.push('capture');
      },
    });

    const shots = [queue.enqueue(photo), queue.enqueue(photo)];

    await expect(Promise.all(shots)).rejects.toThrow('camera busy');
    await flush();

    expect(events).toEqual(['acquire', 'release']);
    expect(queue.isBusy).toBe(false);
  });

  it('stays usable after the camera fails to release', async () => {
    const events: string[] = [];
    let releases = 0;
    const queue = new CaptureQueue({
      acquireCamera: async () => {
        events.push('acquire');
        return true;
      },
      releaseCamera: async () => {
        events.push('release');
        if (releases++ === 0) throw new Error('resume failed');
      },
      captureOne: async () => {
        events.push('capture');
      },
    });

    await expect(queue.enqueue(photo)).resolves.toBeUndefined();
    await flush();
    await expect(queue.enqueue(photo)).resolves.toBeUndefined();
    await flush();

    expect(events).toEqual([
      'acquire', 'capture', 'release',
      'acquire', 'capture', 'release',
    ]);
  });

  it('passes each request through to the capture', async () => {
    const { queue, captures } = createHarness();

    await queue.enqueue(remotePhoto);
    await queue.enqueue(photo);
    await flush();

    expect(captures).toEqual([remotePhoto, photo]);
  });
});
