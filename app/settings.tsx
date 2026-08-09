import React, { useState } from 'react';
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Modal,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useSettings } from '../src/hooks/useSettings';
import {
  TimerDuration,
  AspectRatio,
  GridOverlay,
  SaveLocation,
  PreviewQuality,
  PreviewMode,
  FlashMode,
} from '../src/types';

// Option definitions
const TIMER_OPTIONS: { value: TimerDuration; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 2, label: '2s' },
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
];

const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 (Square)' },
  { value: '4:5', label: '4:5 (Portrait)' },
  { value: '9:16', label: '9:16 (Full)' },
];

const GRID_OPTIONS: { value: GridOverlay; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: '3x3', label: '3x3 (Rule of Thirds)' },
  { value: '4x4', label: '4x4' },
];

const QUALITY_OPTIONS: { value: PreviewQuality; label: string }[] = [
  { value: 'low', label: 'Low (480p)' },
  { value: 'medium', label: 'Medium (720p)' },
  { value: 'high', label: 'High (1080p)' },
];

// Named for what they do to the camera rather than for the transport - the
// user-visible difference is whether the lens gets handed back and forth
// mid-shoot, not which protocol carries the pixels.
const PREVIEW_MODE_OPTIONS: { value: PreviewMode; label: string }[] = [
  { value: 'frames', label: 'Steady (No Lens Switching)' },
  { value: 'auto', label: 'Auto (Smoother Video)' },
];

const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  frames: 'Steady',
  auto: 'Auto',
};

const FLASH_OPTIONS: { value: FlashMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
  { value: 'auto', label: 'Auto' },
];

const SAVE_LOCATION_OPTIONS: { value: SaveLocation; label: string }[] = [
  { value: 'camera-roll', label: 'Camera Roll' },
  { value: 'app-storage', label: 'App Storage' },
];

// Setting Row Component with Modal Picker
function SettingRow<T extends string | number>({
  label,
  value,
  displayValue,
  options,
  onSelect,
  disabled,
}: {
  label: string;
  value: T;
  displayValue?: string;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const selectedLabel =
    displayValue || options.find((o) => o.value === value)?.label || String(value);

  return (
    <>
      <TouchableOpacity
        style={styles.row}
        onPress={() => !disabled && setShowPicker(true)}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>
          {label}
        </Text>
        <View style={styles.rowValue}>
          <Text style={[styles.rowValueText, disabled && styles.rowValueDisabled]}>
            {selectedLabel}
          </Text>
          <Feather name="chevron-right" size={18} color="#666" />
        </View>
      </TouchableOpacity>

      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowPicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{label}</Text>
            {options.map((option) => (
              <TouchableOpacity
                key={String(option.value)}
                style={[
                  styles.modalOption,
                  option.value === value && styles.modalOptionSelected,
                ]}
                onPress={() => {
                  onSelect(option.value);
                  setShowPicker(false);
                }}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    option.value === value && styles.modalOptionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
                {option.value === value && (
                  <Feather name="check" size={20} color="#007AFF" />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setShowPicker(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, updateSetting, isLoaded } = useSettings();

  if (!isLoaded) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Feather name="chevron-left" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* Camera Section */}
        <Text style={styles.sectionTitle}>Camera</Text>
        <View style={styles.section}>
          <SettingRow
            label="Timer"
            value={settings.timer}
            displayValue={settings.timer === 0 ? 'Off' : `${settings.timer}s`}
            options={TIMER_OPTIONS}
            onSelect={(value) => updateSetting('timer', value)}
          />
          <SettingRow
            label="Aspect Ratio"
            value={settings.aspectRatio}
            options={ASPECT_RATIO_OPTIONS}
            onSelect={(value) => updateSetting('aspectRatio', value)}
          />
          <SettingRow
            label="Grid Overlay"
            value={settings.gridOverlay}
            displayValue={
              settings.gridOverlay === 'none' ? 'None' : settings.gridOverlay
            }
            options={GRID_OPTIONS}
            onSelect={(value) => updateSetting('gridOverlay', value)}
          />
          <SettingRow
            label="Default Flash"
            value={settings.flash}
            displayValue={
              settings.flash.charAt(0).toUpperCase() + settings.flash.slice(1)
            }
            options={FLASH_OPTIONS}
            onSelect={(value) => updateSetting('flash', value)}
          />
        </View>

        {/* Media Section */}
        <Text style={styles.sectionTitle}>Media</Text>
        <View style={styles.section}>
          <SettingRow
            label="Save Location"
            value={settings.saveLocation}
            displayValue={
              settings.saveLocation === 'camera-roll'
                ? 'Camera Roll'
                : 'App Storage'
            }
            options={SAVE_LOCATION_OPTIONS}
            onSelect={(value) => updateSetting('saveLocation', value)}
          />
          <TouchableOpacity style={styles.row} disabled activeOpacity={1}>
            <Text style={[styles.rowLabel, styles.rowLabelDisabled]}>
              Gallery App
            </Text>
            <View style={styles.rowValue}>
              <Text style={[styles.rowValueText, styles.rowValueDisabled]}>
                System Default
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Remote Section */}
        <Text style={styles.sectionTitle}>Remote Preview</Text>
        <View style={styles.section}>
          <SettingRow
            label="Preview Mode"
            value={settings.previewMode}
            displayValue={PREVIEW_MODE_LABELS[settings.previewMode]}
            options={PREVIEW_MODE_OPTIONS}
            onSelect={(value) => updateSetting('previewMode', value)}
          />
          <SettingRow
            label="Preview Quality"
            value={settings.previewQuality}
            displayValue={
              settings.previewQuality.charAt(0).toUpperCase() +
              settings.previewQuality.slice(1)
            }
            options={QUALITY_OPTIONS}
            onSelect={(value) => updateSetting('previewQuality', value)}
          />
        </View>

        {/* General Section */}
        <Text style={styles.sectionTitle}>General</Text>
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Keep Screen Awake</Text>
            <Switch
              value={settings.keepScreenAwake}
              onValueChange={(value) => updateSetting('keepScreenAwake', value)}
              trackColor={{ false: '#555', true: '#4cd964' }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Volume Button Shutter</Text>
            <Switch
              value={settings.volumeShutter}
              onValueChange={(value) => updateSetting('volumeShutter', value)}
              trackColor={{ false: '#555', true: '#4cd964' }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingText: {
    color: '#fff',
    textAlign: 'center',
    marginTop: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginTop: 24,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  rowLabel: {
    fontSize: 16,
    color: '#fff',
  },
  rowLabelDisabled: {
    color: '#666',
  },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowValueText: {
    fontSize: 16,
    color: '#888',
    marginRight: 4,
  },
  rowValueDisabled: {
    color: '#555',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#2c2c2e',
    borderRadius: 14,
    width: '80%',
    maxWidth: 320,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#444',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#444',
  },
  modalOptionSelected: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  modalOptionText: {
    color: '#fff',
    fontSize: 16,
  },
  modalOptionTextSelected: {
    color: '#007AFF',
  },
  modalCancel: {
    paddingVertical: 16,
    backgroundColor: '#1c1c1e',
  },
  modalCancelText: {
    color: '#ff453a',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
});
