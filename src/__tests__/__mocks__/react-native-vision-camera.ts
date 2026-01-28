// Mock for react-native-vision-camera
export type PhysicalCameraDeviceType =
  | 'ultra-wide-angle-camera'
  | 'wide-angle-camera'
  | 'telephoto-camera';

export interface CameraDevice {
  id: string;
  name: string;
  position: 'front' | 'back';
  physicalDevices: PhysicalCameraDeviceType[];
  minZoom: number;
  maxZoom: number;
  neutralZoom: number;
  hasFlash: boolean;
  hasTorch: boolean;
}

export interface PhotoFile {
  path: string;
  width: number;
  height: number;
}

export interface VideoFile {
  path: string;
  duration: number;
}

export const Camera = {
  getAvailableCameraDevices: jest.fn(() => []),
};
