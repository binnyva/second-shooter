import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { HistoryPhoto } from '../utils/photoHistory';

interface PhotoViewerProps {
  visible: boolean;
  /** Photos to page through, oldest first. */
  photos: HistoryPhoto[];
  /** Photo to open on. Defaults to the newest. */
  initialIndex?: number;
  onClose: () => void;
}

export function PhotoViewer({ visible, photos, initialIndex, onClose }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();
  // Not a module constant: the paging offsets have to follow rotation.
  const { width, height } = useWindowDimensions();

  const openIndex = Math.min(
    Math.max(initialIndex ?? photos.length - 1, 0),
    Math.max(photos.length - 1, 0)
  );
  const [currentIndex, setCurrentIndex] = useState(openIndex);

  // Open on the newest photo each time the viewer is shown. Deliberately keyed
  // on `visible` alone: a photo arriving while the viewer is open must not yank
  // the list away from what the user is looking at.
  const openIndexRef = useRef(openIndex);
  openIndexRef.current = openIndex;
  useEffect(() => {
    if (visible) {
      setCurrentIndex(openIndexRef.current);
    }
  }, [visible]);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(event.nativeEvent.contentOffset.x / width);
      setCurrentIndex(Math.min(Math.max(index, 0), photos.length - 1));
    },
    [width, photos.length]
  );

  const getItemLayout = useCallback(
    (_data: ArrayLike<HistoryPhoto> | null | undefined, index: number) => ({
      length: width,
      offset: width * index,
      index,
    }),
    [width]
  );

  const renderItem = useCallback(
    ({ item }: { item: HistoryPhoto }) => (
      <View style={{ width, height }}>
        <Image
          source={{ uri: item.uri }}
          style={{ width, height }}
          resizeMode="contain"
        />
      </View>
    ),
    [width, height]
  );

  if (photos.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <FlatList
          data={photos}
          keyExtractor={(item) => item.uri}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={getItemLayout}
          // The Modal unmounts its children while hidden, so this re-applies
          // on every open.
          initialScrollIndex={openIndex}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          // Only keep the neighbouring pages decoded.
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
        />

        {/* Position counter */}
        {photos.length > 1 && (
          <View style={[styles.counter, { top: insets.top + 16 }]}>
            <Text style={styles.counterText}>
              {currentIndex + 1} / {photos.length}
            </Text>
          </View>
        )}

        {/* Close button */}
        <TouchableOpacity
          style={[styles.closeButton, { top: insets.top + 16 }]}
          onPress={onClose}
        >
          <MaterialIcons name="close" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  counterText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default PhotoViewer;
