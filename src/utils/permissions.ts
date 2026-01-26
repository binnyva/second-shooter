import { Camera } from 'react-native-vision-camera';
import * as MediaLibrary from 'expo-media-library';
import { Platform, Alert, Linking } from 'react-native';

export interface PermissionStatus {
  camera: boolean;
  microphone: boolean;
  mediaLibrary: boolean;
}

// Request camera permission
export async function requestCameraPermission(): Promise<boolean> {
  const status = await Camera.requestCameraPermission();
  return status === 'granted';
}

// Request microphone permission
export async function requestMicrophonePermission(): Promise<boolean> {
  const status = await Camera.requestMicrophonePermission();
  return status === 'granted';
}

// Request media library permission
export async function requestMediaLibraryPermission(): Promise<boolean> {
  const { status } = await MediaLibrary.requestPermissionsAsync();
  return status === 'granted';
}

// Request all permissions needed for camera device
export async function requestAllPermissions(): Promise<PermissionStatus> {
  const [camera, microphone, mediaLibrary] = await Promise.all([
    requestCameraPermission(),
    requestMicrophonePermission(),
    requestMediaLibraryPermission(),
  ]);

  return { camera, microphone, mediaLibrary };
}

// Check if camera permission is granted
export async function checkCameraPermission(): Promise<boolean> {
  const status = await Camera.getCameraPermissionStatus();
  return status === 'granted';
}

// Check if microphone permission is granted
export async function checkMicrophonePermission(): Promise<boolean> {
  const status = await Camera.getMicrophonePermissionStatus();
  return status === 'granted';
}

// Check if media library permission is granted
export async function checkMediaLibraryPermission(): Promise<boolean> {
  const { status } = await MediaLibrary.getPermissionsAsync();
  return status === 'granted';
}

// Check all permissions
export async function checkAllPermissions(): Promise<PermissionStatus> {
  const [camera, microphone, mediaLibrary] = await Promise.all([
    checkCameraPermission(),
    checkMicrophonePermission(),
    checkMediaLibraryPermission(),
  ]);

  return { camera, microphone, mediaLibrary };
}

// Show alert when permission is denied with option to open settings
export function showPermissionDeniedAlert(permissionName: string): void {
  Alert.alert(
    'Permission Required',
    `${permissionName} permission is required for this feature. Please enable it in Settings.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => {
          if (Platform.OS === 'ios') {
            Linking.openURL('app-settings:');
          } else {
            Linking.openSettings();
          }
        },
      },
    ]
  );
}
