import { cameraService } from '../../services/CameraService';
import { Camera } from 'react-native-vision-camera';

// Create a fresh instance for each test
function createCameraService() {
  // We need to access the class directly
  // Since it's exported as singleton, we'll test the singleton but reset between tests
  cameraService.reset();
  cameraService.setCameraRef(null);
  return cameraService;
}

describe('CameraService', () => {
  let service: typeof cameraService;

  beforeEach(() => {
    service = createCameraService();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have default state values', () => {
      const state = service.getState();

      expect(state.zoom).toBe(1);
      expect(state.flash).toBe('off');
      expect(state.facing).toBe('back');
      expect(state.captureMode).toBe('photo');
      expect(state.isRecording).toBe(false);
    });

    it('should return a copy of state', () => {
      const state1 = service.getState();
      const state2 = service.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('camera ref management', () => {
    it('should set and get camera ref', () => {
      const mockRef = { takePhoto: jest.fn() } as unknown as Camera;

      service.setCameraRef(mockRef);

      expect(service.getCameraRef()).toBe(mockRef);
    });

    it('should allow setting ref to null', () => {
      const mockRef = { takePhoto: jest.fn() } as unknown as Camera;

      service.setCameraRef(mockRef);
      service.setCameraRef(null);

      expect(service.getCameraRef()).toBeNull();
    });
  });

  describe('setZoom', () => {
    it('should update zoom level', () => {
      service.setZoom(2);

      expect(service.getState().zoom).toBe(2);
    });

    it('should clamp zoom to minimum 0.5', () => {
      service.setZoom(0.1);

      expect(service.getState().zoom).toBe(0.5);
    });

    it('should clamp zoom to maximum 10', () => {
      service.setZoom(15);

      expect(service.getState().zoom).toBe(10);
    });

    it('should accept valid zoom values', () => {
      const validZooms = [0.5, 1, 2.5, 5, 10];

      for (const zoom of validZooms) {
        service.setZoom(zoom);
        expect(service.getState().zoom).toBe(zoom);
      }
    });

    it('should trigger state change callback', () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.setZoom(3);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ zoom: 3 })
      );
    });
  });

  describe('setFlash', () => {
    it('should update flash mode', () => {
      service.setFlash('on');
      expect(service.getState().flash).toBe('on');

      service.setFlash('auto');
      expect(service.getState().flash).toBe('auto');

      service.setFlash('off');
      expect(service.getState().flash).toBe('off');
    });

    it('should trigger state change callback', () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.setFlash('on');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ flash: 'on' })
      );
    });
  });

  describe('switchCamera', () => {
    it('should toggle from back to front', () => {
      expect(service.getState().facing).toBe('back');

      service.switchCamera();

      expect(service.getState().facing).toBe('front');
    });

    it('should toggle from front to back', () => {
      service.switchCamera(); // back -> front
      service.switchCamera(); // front -> back

      expect(service.getState().facing).toBe('back');
    });

    it('should trigger state change callback', () => {
      const callback = jest.fn();
      service.onStateChange(callback);

      service.switchCamera();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ facing: 'front' })
      );
    });
  });

  describe('setCaptureMode', () => {
    it('should update capture mode to video', () => {
      service.setCaptureMode('video');

      expect(service.getState().captureMode).toBe('video');
    });

    it('should update capture mode to photo', () => {
      service.setCaptureMode('video');
      service.setCaptureMode('photo');

      expect(service.getState().captureMode).toBe('photo');
    });
  });

  describe('reset', () => {
    it('should reset all state to defaults', () => {
      service.setZoom(5);
      service.setFlash('on');
      service.switchCamera();
      service.setCaptureMode('video');

      service.reset();

      const state = service.getState();
      expect(state.zoom).toBe(1);
      expect(state.flash).toBe('off');
      expect(state.facing).toBe('back');
      expect(state.captureMode).toBe('photo');
      expect(state.isRecording).toBe(false);
    });

    it('should trigger state change callback', () => {
      service.setZoom(5);
      const callback = jest.fn();
      service.onStateChange(callback);

      service.reset();

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('takePhoto', () => {
    it('should return null when camera not initialized', async () => {
      const result = await service.takePhoto();

      expect(result).toBeNull();
    });

    it('should call camera takePhoto with correct options', async () => {
      const mockTakePhoto = jest.fn().mockResolvedValue({ path: '/photo.jpg' });
      const mockRef = { takePhoto: mockTakePhoto } as unknown as Camera;

      service.setCameraRef(mockRef);
      service.setFlash('on');

      await service.takePhoto();

      expect(mockTakePhoto).toHaveBeenCalledWith({
        flash: 'on',
        enableShutterSound: false,
      });
    });

    it('should convert auto flash to on for takePhoto', async () => {
      const mockTakePhoto = jest.fn().mockResolvedValue({ path: '/photo.jpg' });
      const mockRef = { takePhoto: mockTakePhoto } as unknown as Camera;

      service.setCameraRef(mockRef);
      service.setFlash('auto');

      await service.takePhoto();

      expect(mockTakePhoto).toHaveBeenCalledWith(
        expect.objectContaining({ flash: 'on' })
      );
    });

    it('should throw error on camera failure', async () => {
      const mockError = new Error('Camera failed');
      const mockTakePhoto = jest.fn().mockRejectedValue(mockError);
      const mockRef = { takePhoto: mockTakePhoto } as unknown as Camera;

      service.setCameraRef(mockRef);

      await expect(service.takePhoto()).rejects.toThrow('Camera failed');
    });
  });

  describe('startRecording', () => {
    it('should not start when camera not initialized', async () => {
      const onFinished = jest.fn();
      const onError = jest.fn();

      await service.startRecording(onFinished, onError);

      expect(service.getState().isRecording).toBe(false);
    });

    it('should not start when already recording', async () => {
      const mockStartRecording = jest.fn();
      const mockRef = { startRecording: mockStartRecording } as unknown as Camera;

      service.setCameraRef(mockRef);

      // Start first recording
      await service.startRecording(jest.fn(), jest.fn());

      // Try to start second recording
      await service.startRecording(jest.fn(), jest.fn());

      // startRecording should only be called once
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    it('should set isRecording to true when starting', async () => {
      const mockStartRecording = jest.fn();
      const mockRef = { startRecording: mockStartRecording } as unknown as Camera;

      service.setCameraRef(mockRef);

      await service.startRecording(jest.fn(), jest.fn());

      expect(service.getState().isRecording).toBe(true);
    });

    it('should call camera startRecording with correct options', async () => {
      const mockStartRecording = jest.fn();
      const mockRef = { startRecording: mockStartRecording } as unknown as Camera;

      service.setCameraRef(mockRef);
      service.setFlash('on');

      await service.startRecording(jest.fn(), jest.fn());

      expect(mockStartRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          flash: 'on',
        })
      );
    });
  });

  describe('stopRecording', () => {
    it('should not stop when camera not initialized', async () => {
      await expect(service.stopRecording()).resolves.not.toThrow();
    });

    it('should not stop when not recording', async () => {
      const mockStopRecording = jest.fn();
      const mockRef = { stopRecording: mockStopRecording } as unknown as Camera;

      service.setCameraRef(mockRef);

      await service.stopRecording();

      expect(mockStopRecording).not.toHaveBeenCalled();
    });

    it('should call camera stopRecording when recording', async () => {
      const mockStartRecording = jest.fn();
      const mockStopRecording = jest.fn();
      const mockRef = {
        startRecording: mockStartRecording,
        stopRecording: mockStopRecording,
      } as unknown as Camera;

      service.setCameraRef(mockRef);

      await service.startRecording(jest.fn(), jest.fn());
      await service.stopRecording();

      expect(mockStopRecording).toHaveBeenCalled();
    });
  });

  describe('state change callback', () => {
    it('should allow setting callback', () => {
      const callback = jest.fn();

      service.onStateChange(callback);
      service.setZoom(2);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should replace previous callback', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      service.onStateChange(callback1);
      service.onStateChange(callback2);
      service.setZoom(2);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });
});
