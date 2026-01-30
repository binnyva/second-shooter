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
  // Double buffering: two frame slots that alternate
  const [frameA, setFrameA] = useState<string | null>(null);
  const [frameB, setFrameB] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A'); // Which slot is currently displayed
  const lastFrameIdRef = useRef<number>(-1);
  const pendingSlotRef = useRef<'A' | 'B'>('B'); // Which slot is loading the next frame

  // For backward compatibility with hasContent check
  const frameUri = activeSlot === 'A' ? frameA : frameB;

  // Update the inactive slot when we receive new frame data
  useEffect(() => {
    if (latestFrame && latestFrame.frameId > lastFrameIdRef.current) {
      const dataSize = latestFrame.data?.length || 0;
      console.log(`[HybridPreview] New frame ${latestFrame.frameId} received, size=${dataSize}, activeSlot=${activeSlot}`);
      lastFrameIdRef.current = latestFrame.frameId;
      const newUri = `data:image/jpeg;base64,${latestFrame.data}`;

      // Load into the inactive slot
      if (activeSlot === 'A') {
        pendingSlotRef.current = 'B';
        console.log(`[HybridPreview] Setting frameB (inactive slot)`);
        setFrameB(newUri);
      } else {
        pendingSlotRef.current = 'A';
        console.log(`[HybridPreview] Setting frameA (inactive slot)`);
        setFrameA(newUri);
      }
    }
  }, [latestFrame, activeSlot]);

  // Called when the pending frame finishes loading - swap to show it
  const handleFrameLoaded = (slot: 'A' | 'B') => {
    console.log(`[HybridPreview] Image ${slot} loaded! pendingSlot=${pendingSlotRef.current}, will swap=${slot === pendingSlotRef.current}`);
    if (slot === pendingSlotRef.current) {
      setActiveSlot(slot);
    }
  };

  // Called when image fails to load
  const handleFrameError = (slot: 'A' | 'B', error: any) => {
    console.log(`[HybridPreview] Image ${slot} LOAD ERROR:`, error?.nativeEvent?.error || error);
  };

  // Clear frames when switching back to WebRTC mode
  useEffect(() => {
    if (streamMode === 'webrtc') {
      setFrameA(null);
      setFrameB(null);
      setActiveSlot('A');
      lastFrameIdRef.current = -1;
    }
  }, [streamMode]);

  // Has content if either frame slot has data (for double buffering)
  const hasFrameContent = frameA || frameB;
  const hasContent =
    (streamMode === 'webrtc' && stream) ||
    (streamMode === 'frame-based' && hasFrameContent);

  const getStatusMessage = (): string => {
    switch (connectionState) {
      case 'connecting':
        return 'Connecting to camera...';
      case 'connected':
        if (streamMode === 'webrtc') {
          return stream ? '' : 'Waiting for video stream...';
        } else {
          return hasFrameContent ? '' : 'Waiting for frames...';
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
        (streamMode === 'frame-based' && !hasFrameContent)));

  // Debug logging (only log on significant changes, not every frame)
  // IMPORTANT: Never log frame data URIs - they contain base64 content that floods logs
  const prevStreamModeRef = useRef(streamMode);
  const prevHasContentRef = useRef(hasContent);
  const prevStreamRef = useRef(stream);
  useEffect(() => {
    const streamChanged = stream !== prevStreamRef.current;
    // Use !! to convert to boolean - NEVER log actual frame data/URIs (per CLAUDE.md guidelines)
    const prevHasContentBool = !!prevHasContentRef.current;
    const hasContentBool = !!hasContent;
    if (streamMode !== prevStreamModeRef.current || hasContentBool !== prevHasContentBool || streamChanged) {
      console.log(`[HybridPreview] === State Change ===`);
      console.log(`[HybridPreview] streamMode: ${prevStreamModeRef.current} -> ${streamMode}`);
      console.log(`[HybridPreview] hasContent: ${prevHasContentBool} -> ${hasContentBool}`);
      console.log(`[HybridPreview] stream exists: ${!!prevStreamRef.current} -> ${!!stream}`);
      if (stream) {
        const tracks = stream.getTracks();
        const videoTracks = stream.getVideoTracks();
        console.log(`[HybridPreview] stream tracks: total=${tracks.length}, video=${videoTracks.length}`);
        videoTracks.forEach((t, i) => {
          console.log(`[HybridPreview] video track ${i}: id=${t.id}, readyState=${t.readyState}, enabled=${t.enabled}`);
        });
      }
      // Log presence of frames (boolean only), never log actual frame content/URIs
      console.log(`[HybridPreview] hasFrameContent=${!!hasFrameContent}, frameA=${!!frameA}, frameB=${!!frameB}`);
      console.log(`[HybridPreview] connectionState=${connectionState}`);
      prevStreamModeRef.current = streamMode;
      prevHasContentRef.current = hasContent;
      prevStreamRef.current = stream;
    }
  }, [streamMode, hasFrameContent, stream, hasContent, frameA, frameB, connectionState]);

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

          {/* Frame-based image preview with double buffering */}
          {/* Both frames rendered, active one on top via render order */}
          {streamMode === 'frame-based' && (
            <View style={StyleSheet.absoluteFill}>
              {/* Render both frames - inactive behind, active on top */}
              {activeSlot === 'A' ? (
                <>
                  {/* B behind (loading next frame) */}
                  {frameB && (
                    <Image
                      source={{ uri: frameB }}
                      style={[
                        StyleSheet.absoluteFill,
                        facing === 'front' && { transform: [{ scaleX: -1 }] },
                      ]}
                      resizeMode="cover"
                      fadeDuration={0}
                      onLoad={() => handleFrameLoaded('B')}
                      onError={(e) => handleFrameError('B', e)}
                    />
                  )}
                  {/* A on top (currently displayed) */}
                  {frameA && (
                    <Image
                      source={{ uri: frameA }}
                      style={[
                        StyleSheet.absoluteFill,
                        facing === 'front' && { transform: [{ scaleX: -1 }] },
                      ]}
                      resizeMode="cover"
                      fadeDuration={0}
                    />
                  )}
                </>
              ) : (
                <>
                  {/* A behind (loading next frame) */}
                  {frameA && (
                    <Image
                      source={{ uri: frameA }}
                      style={[
                        StyleSheet.absoluteFill,
                        facing === 'front' && { transform: [{ scaleX: -1 }] },
                      ]}
                      resizeMode="cover"
                      fadeDuration={0}
                      onLoad={() => handleFrameLoaded('A')}
                      onError={(e) => handleFrameError('A', e)}
                    />
                  )}
                  {/* B on top (currently displayed) */}
                  {frameB && (
                    <Image
                      source={{ uri: frameB }}
                      style={[
                        StyleSheet.absoluteFill,
                        facing === 'front' && { transform: [{ scaleX: -1 }] },
                      ]}
                      resizeMode="cover"
                      fadeDuration={0}
                    />
                  )}
                </>
              )}
            </View>
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
