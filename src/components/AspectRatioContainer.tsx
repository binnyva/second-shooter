import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { AspectRatio } from '../types';

interface AspectRatioContainerProps {
  ratio: AspectRatio;
  children: React.ReactNode;
}

const ASPECT_RATIOS: Record<AspectRatio, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
};

export function AspectRatioContainer({
  ratio,
  children,
}: AspectRatioContainerProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // For 9:16, use full screen (no masking)
  if (ratio === '9:16') {
    return <View style={StyleSheet.absoluteFill}>{children}</View>;
  }

  const aspectValue = ASPECT_RATIOS[ratio];
  const containerWidth = screenWidth;
  const containerHeight = containerWidth / aspectValue;

  // Center vertically
  const topOffset = (screenHeight - containerHeight) / 2;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Full camera underneath (for proper capture) */}
      <View style={StyleSheet.absoluteFill}>{children}</View>

      {/* Mask overlays - dark bars on top and bottom */}
      <View
        style={[styles.mask, { height: topOffset, top: 0 }]}
        pointerEvents="none"
      />
      <View
        style={[styles.mask, { height: topOffset, bottom: 0 }]}
        pointerEvents="none"
      />

      {/* Frame border indicator */}
      <View
        style={[
          styles.frame,
          {
            width: containerWidth,
            height: containerHeight,
            top: topOffset,
          },
        ]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  frame: {
    position: 'absolute',
    left: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
});

export default AspectRatioContainer;
