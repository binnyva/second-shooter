import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, Image, Platform } from 'react-native';
import { RTCView, MediaStream } from 'react-native-webrtc';
import { ConnectionState, StreamMode, FrameDataMessage } from '../types';

interface HybridPreviewProps {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  streamMode: StreamMode;
  latestFrame: FrameDataMessage | null;
  facing?: 'front' | 'back';
  videoNeedsRotation?: boolean;
}

/**
 * A hybrid preview component that displays either:
 * - WebRTC video stream (when streamMode is 'webrtc')
 * - Frame-based image preview (when streamMode is 'frame-based')
 *
 * This is used to work around WebRTC's inability to respect vision-camera's
 * zoom settings on Android.
 */
export function HybridPreview({
  stream,
  connectionState,
  streamMode,
  latestFrame,
  facing = 'back',
  videoNeedsRotation = false,
}: HybridPreviewProps) {
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const lastFrameIdRef = useRef<number>(-1);

  // Update frame URI when we receive new frame data
  useEffect(() => {
    if (latestFrame && latestFrame.frameId > lastFrameIdRef.current) {
      lastFrameIdRef.current = latestFrame.frameId;
      // Convert base64 to data URI
      setFrameUri(`data:image/jpeg;base64,${latestFrame.data}`);
    }
  }, [latestFrame]);

  // Clear frame URI when switching back to WebRTC mode
  useEffect(() => {
    if (streamMode === 'webrtc') {
      setFrameUri(null);
      lastFrameIdRef.current = -1;
    }
  }, [streamMode]);

  const getStatusMessage = (): string => {
    switch (connectionState) {
      case 'connecting':
        return 'Connecting to camera...';
      case 'connected':
        if (streamMode === 'webrtc') {
          return stream ? '' : 'Waiting for video stream...';
        } else {
          return frameUri ? '' : 'Waiting for frames...';
        }
      case 'failed':
        return 'Connection failed. Please try again.';
      default:
        return 'Not connected';
    }
  };

  const showLoading =
    connectionState === 'connecting' ||
    (connectionState === 'connected' &&
      ((streamMode === 'webrtc' && !stream) ||
        (streamMode === 'frame-based' && !frameUri)));

  const hasContent =
    (streamMode === 'webrtc' && stream) ||
    (streamMode === 'frame-based' && frameUri);

  // Debug logging
  useEffect(() => {
    console.log(`[HybridPreview] streamMode=${streamMode}, hasFrameUri=${!!frameUri}, hasStream=${!!stream}, hasContent=${hasContent}`);
  }, [streamMode, frameUri, stream, hasContent]);

  return (
    <View style={styles.container}>
      {hasContent ? (
        <>
          {/* WebRTC video stream */}
          {streamMode === 'webrtc' && stream && (
            <View
              style={[
                StyleSheet.absoluteFill,
                videoNeedsRotation && { transform: [{ rotate: '180deg' }] },
              ]}
            >
              <RTCView
                key={`rtc-${facing}-${videoNeedsRotation}`}
                streamURL={stream.toURL()}
                style={StyleSheet.absoluteFill}
                objectFit="cover"
                mirror={facing === 'front'}
              />
            </View>
          )}

          {/* Frame-based image preview */}
          {streamMode === 'frame-based' && frameUri && (
            <Image
              source={{ uri: frameUri }}
              style={[
                StyleSheet.absoluteFill,
                facing === 'front' && { transform: [{ scaleX: -1 }] },
              ]}
              resizeMode="cover"
              // Disable fade animation to prevent black flash between frames
              fadeDuration={0}
            />
          )}
        </>
      ) : (
        <View style={styles.placeholder}>
          {showLoading && (
            <ActivityIndicator
              size="large"
              color="#fff"
              style={styles.loader}
            />
          )}
          <Text style={styles.statusText}>{getStatusMessage()}</Text>

          {connectionState === 'failed' && (
            <Text style={styles.hintText}>
              Go back and scan the QR code again
            </Text>
          )}
        </View>
      )}

      {/* Connection and mode indicator */}
      {hasContent && (
        <View style={styles.connectionIndicator}>
          <View
            style={[
              styles.connectionDot,
              connectionState === 'connected'
                ? styles.connectedDot
                : styles.disconnectedDot,
            ]}
          />
          <Text style={styles.connectionText}>
            {connectionState === 'connected'
              ? streamMode === 'webrtc'
                ? 'Live'
                : 'Zoomed'
              : 'Reconnecting...'}
          </Text>
        </View>
      )}

      {/* Stream mode indicator (only shown when in frame-based mode) */}
      {streamMode === 'frame-based' && hasContent && (
        <View style={styles.modeIndicator}>
          <Text style={styles.modeText}>Frame Preview</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  loader: {
    marginBottom: 20,
  },
  statusText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  hintText: {
    color: '#888',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  connectionIndicator: {
    position: 'absolute',
    top: 60,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  connectedDot: {
    backgroundColor: '#4cd964',
  },
  disconnectedDot: {
    backgroundColor: '#ff9500',
  },
  connectionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  modeIndicator: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(0, 122, 255, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  modeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
});

export default HybridPreview;
