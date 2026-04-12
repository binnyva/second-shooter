import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Dimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildRemoteSessionUrl } from '../../shared/session-link';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const QR_SIZE = Math.min(SCREEN_WIDTH * 0.6, 250);

interface QRCodeDisplayProps {
  sessionId: string;
  onClose: () => void;
}

export function QRCodeDisplay({ sessionId, onClose }: QRCodeDisplayProps) {
  const qrData = buildRemoteSessionUrl(sessionId);

  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        <Text style={styles.title}>Scan to Connect</Text>
        <Text style={styles.subtitle}>
          Scan this code to open the app or web remote on another device
        </Text>

        <View style={styles.qrContainer}>
          <QRCode
            value={qrData}
            size={QR_SIZE}
            backgroundColor="#fff"
            color="#000"
          />
        </View>

        <Text style={styles.sessionId}>Session: {sessionId}</Text>

        <Text style={styles.instructions}>
          If Second Shooter is installed it will open in the app. Otherwise the web remote will load in the browser.
        </Text>

        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    marginHorizontal: 20,
    maxWidth: 400,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  qrContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
  },
  sessionId: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
    fontFamily: 'monospace',
  },
  instructions: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  closeButton: {
    backgroundColor: '#333',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default QRCodeDisplay;
