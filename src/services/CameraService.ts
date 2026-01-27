import { Camera, CameraDevice, PhotoFile, VideoFile } from 'react-native-vision-camera';
import { CameraState, FlashMode, CameraFacing } from '../types';

// Default camera state
const DEFAULT_STATE: CameraState = {
  zoom: 1,
  flash: 'off',
  facing: 'back',
  captureMode: 'photo',
  isRecording: false,
};

class CameraService {
  private cameraRef: Camera | null = null;
  private state: CameraState = { ...DEFAULT_STATE };
  private onStateChangeCallback: ((state: CameraState) => void) | null = null;

  // Set camera reference
  setCameraRef(ref: Camera | null): void {
    this.cameraRef = ref;
  }

  // Get camera reference
  getCameraRef(): Camera | null {
    return this.cameraRef;
  }

  // Get current state
  getState(): CameraState {
    return { ...this.state };
  }

  // Set state change callback
  onStateChange(callback: (state: CameraState) => void): void {
    this.onStateChangeCallback = callback;
  }

  // Update state and notify
  private updateState(updates: Partial<CameraState>): void {
    this.state = { ...this.state, ...updates };
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.state);
    }
  }

  // Take a photo
  async takePhoto(): Promise<PhotoFile | null> {
    if (!this.cameraRef) {
      console.error('Camera not initialized');
      return null;
    }

    try {
      const photo = await this.cameraRef.takePhoto({
        flash: this.state.flash === 'auto' ? 'on' : this.state.flash,
        enableShutterSound: true,
      });
      return photo;
    } catch (error) {
      console.error('Error taking photo:', error);
      throw error;
    }
  }

  // Start video recording
  async startRecording(
    onRecordingFinished: (video: VideoFile) => void,
    onRecordingError: (error: unknown) => void
  ): Promise<void> {
    if (!this.cameraRef) {
      console.error('Camera not initialized');
      return;
    }

    if (this.state.isRecording) {
      console.warn('Already recording');
      return;
    }

    try {
      this.updateState({ isRecording: true });

      this.cameraRef.startRecording({
        flash: this.state.flash === 'auto' ? 'on' : this.state.flash,
        onRecordingFinished: (video) => {
          this.updateState({ isRecording: false });
          onRecordingFinished(video);
        },
        onRecordingError: (error) => {
          this.updateState({ isRecording: false });
          onRecordingError(error);
        },
      });
    } catch (error) {
      this.updateState({ isRecording: false });
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  // Stop video recording
  async stopRecording(): Promise<void> {
    if (!this.cameraRef) {
      console.error('Camera not initialized');
      return;
    }

    if (!this.state.isRecording) {
      console.warn('Not recording');
      return;
    }

    try {
      await this.cameraRef.stopRecording();
    } catch (error) {
      console.error('Error stopping recording:', error);
      throw error;
    }
  }

  // Set zoom level (supports ultra-wide at 0.5x)
  setZoom(level: number): void {
    // Clamp zoom between 0.5 and 10 to support ultra-wide cameras
    const clampedZoom = Math.max(0.5, Math.min(10, level));
    this.updateState({ zoom: clampedZoom });
  }

  // Set flash mode
  setFlash(mode: FlashMode): void {
    this.updateState({ flash: mode });
  }

  // Switch camera (front/back)
  switchCamera(): void {
    const newFacing: CameraFacing =
      this.state.facing === 'back' ? 'front' : 'back';
    this.updateState({ facing: newFacing });
  }

  // Set capture mode
  setCaptureMode(mode: 'photo' | 'video'): void {
    this.updateState({ captureMode: mode });
  }

  // Reset state to defaults
  reset(): void {
    this.state = { ...DEFAULT_STATE };
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.state);
    }
  }

  // Get available devices
  static getAvailableDevices(): CameraDevice[] {
    return Camera.getAvailableCameraDevices();
  }

  // Get device for facing mode
  static getDeviceForFacing(facing: CameraFacing): CameraDevice | undefined {
    const devices = Camera.getAvailableCameraDevices();
    return devices.find((d) => d.position === facing);
  }
}

// Export singleton instance
export const cameraService = new CameraService();
export default cameraService;
