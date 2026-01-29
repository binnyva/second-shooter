import React from 'react';
import { View, StyleSheet } from 'react-native';
import { GridOverlay as GridType } from '../types';

interface GridOverlayProps {
  type: GridType;
}

export function GridOverlay({ type }: GridOverlayProps) {
  if (type === 'none') return null;

  const divisions = type === '3x3' ? 3 : 4;
  const lines = divisions - 1;

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Horizontal lines */}
      {Array.from({ length: lines }).map((_, i) => (
        <View
          key={`h-${i}`}
          style={[
            styles.line,
            styles.horizontal,
            { top: `${((i + 1) / divisions) * 100}%` },
          ]}
        />
      ))}
      {/* Vertical lines */}
      {Array.from({ length: lines }).map((_, i) => (
        <View
          key={`v-${i}`}
          style={[
            styles.line,
            styles.vertical,
            { left: `${((i + 1) / divisions) * 100}%` },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  line: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  horizontal: {
    left: 0,
    right: 0,
    height: 1,
  },
  vertical: {
    top: 0,
    bottom: 0,
    width: 1,
  },
});

export default GridOverlay;
