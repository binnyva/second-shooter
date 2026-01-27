import React from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { RTCView, MediaStream } from 'react-native-webrtc';
import { ConnectionState } from '../types';

interface RemotePreviewProps {
  stream: MediaStream | null;
  connectionState: ConnectionState;
  facing?: 'front' | 'back';
  videoNeedsRotation?: boolean;
}

export function RemotePreview({ stream, connectionState, facing = 'back', videoNeedsRotation = false }: RemotePreviewProps) {
  const getStatusMessage = (): string => {
    switch (connectionState) {
      case 'connecting':
        return 'Connecting to camera...';
      case 'connected':
        return stream ? '' : 'Waiting for video stream...';
      case 'failed':
        return 'Connection failed. Please try again.';
      default:
        return 'Not connected';
    }
  };

  const showLoading = connectionState === 'connecting' ||
    (connectionState === 'connected' && !stream);

  return (
    <View style={styles.container}>
      {stream ? (
        <View style={[
          StyleSheet.absoluteFill,
          videoNeedsRotation && { transform: [{ rotate: '180deg' }] }
        ]}>
          <RTCView
            key={`rtc-${facing}-${videoNeedsRotation}`}
            streamURL={stream.toURL()}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            mirror={facing === 'front'}
          />
        </View>
      ) : (
        <View style={styles.placeholder}>
          {showLoading && (
            <ActivityIndicator size="large" color="#fff" style={styles.loader} />
          )}
          <Text style={styles.statusText}>{getStatusMessage()}</Text>

          {connectionState === 'failed' && (
            <Text style={styles.hintText}>
              Go back and scan the QR code again
            </Text>
          )}
        </View>
      )}

      {/* Connection indicator */}
      {stream && (
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
            {connectionState === 'connected' ? 'Live' : 'Reconnecting...'}
          </Text>
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
  video: {
    flex: 1,
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
});

export default RemotePreview;
