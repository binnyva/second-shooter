import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface TimerCountdownProps {
  seconds: number;
  onComplete: () => void;
}

export function TimerCountdown({ seconds, onComplete }: TimerCountdownProps) {
  const [count, setCount] = useState(seconds);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (count === 0) {
      onComplete();
      return;
    }

    // Animate number entrance
    scaleAnim.setValue(1.5);
    opacityAnim.setValue(0);

    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      setCount(count - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [count, onComplete, scaleAnim, opacityAnim]);

  if (count === 0) return null;

  return (
    <View style={styles.container}>
      <Animated.Text
        style={[
          styles.countText,
          {
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        {count}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  countText: {
    fontSize: 120,
    fontWeight: 'bold',
    color: '#fff',
  },
});

export default TimerCountdown;
