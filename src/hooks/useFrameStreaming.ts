import { useCallback, useRef } from 'react';
import { useFrameProcessor, runAtTargetFps } from 'react-native-vision-camera';
import { VisionCameraProxy } from 'react-native-vision-camera';
import { runOnJS } from 'react-native-worklets-core';

// Try to initialize the frameToJpeg plugin - may be null if not available
let frameToJpegPlugin: ReturnType<typeof VisionCameraProxy.initFrameProcessorPlugin> | null = null;
let pluginInitialized = false;
try {
  frameToJpegPlugin = VisionCameraProxy.initFrameProcessorPlugin('frameToJpeg', {
    quality: 80,
    maxWidth: 1280,
    maxHeight: 720,
  });
  pluginInitialized = frameToJpegPlugin != null;
  console.log('[useFrameStreaming] frameToJpeg plugin initialized:', pluginInitialized);
} catch (e) {
  console.warn('[useFrameStreaming] Failed to initialize frameToJpeg plugin:', e);
  pluginInitialized = false;
}

// Target FPS for frame streaming (10-15 FPS is acceptable for preview)
const TARGET_FPS = 12;

// Frame counter for unique IDs
let globalFrameId = 0;

interface UseFrameStreamingOptions {
  enabled: boolean;
  onFrame: (base64Data: string, frameId: number, timestamp: number) => void;
}

interface UseFrameStreamingReturn {
  frameProcessor: ReturnType<typeof useFrameProcessor> | undefined;
}

/**
 * Hook that creates a frame processor for streaming camera frames as JPEG images.
 *
 * This is used as a workaround for WebRTC's inability to respect vision-camera's
 * zoom settings on Android. When zoom is not 1x, we capture frames via vision-camera's
 * frame processor, encode them as JPEG, and send them over the WebRTC data channel.
 */
// Export plugin status so components can check if frame-based streaming is available
export function isFrameStreamingAvailable(): boolean {
  return pluginInitialized;
}

export function useFrameStreaming({
  enabled,
  onFrame,
}: UseFrameStreamingOptions): UseFrameStreamingReturn {
  // Keep a ref to the callback to avoid recreating the frame processor
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Callback that will be called from the worklet
  // We need this to be stable to avoid frame processor recreation
  const sendFrame = useCallback((base64Data: string) => {
    const frameId = globalFrameId++;
    const timestamp = Date.now();
    onFrameRef.current(base64Data, frameId, timestamp);
  }, []);

  // Create the frame processor - this hook must always be called (rules of hooks)
  // The processor does actual work only when the plugin is available
  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';

      // Skip processing if plugin not available - must check at runtime
      // since the plugin handle is captured at module load time
      if (!pluginInitialized || frameToJpegPlugin == null) {
        // Do nothing - frame processor must have a valid body
        // but we just skip the actual processing
        return;
      }

      // Throttle to target FPS using vision-camera's utility
      runAtTargetFps(TARGET_FPS, () => {
        'worklet';

        // Encode frame to JPEG using native plugin
        const result = frameToJpegPlugin!.call(frame, {
          orientation: frame.orientation,
        });

        if (result != null && typeof result === 'string') {
          // Send the encoded frame back to JS thread using runOnJS
          runOnJS(sendFrame)(result);
        }
      });
    },
    [sendFrame]
  );

  // Only return the frame processor if streaming is enabled AND plugin is available
  // If plugin isn't available, don't pass anything to the Camera to avoid worklet errors
  return {
    frameProcessor: enabled && pluginInitialized ? frameProcessor : undefined,
  };
}

export default useFrameStreaming;
