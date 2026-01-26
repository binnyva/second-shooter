import * as MediaLibrary from 'expo-media-library';
import { PhotoFile, VideoFile } from 'react-native-vision-camera';

class MediaService {
  // Save photo to gallery
  async savePhotoToGallery(photo: PhotoFile): Promise<MediaLibrary.Asset | null> {
    try {
      const asset = await MediaLibrary.createAssetAsync(`file://${photo.path}`);
      console.log('Photo saved to gallery:', asset.uri);
      return asset;
    } catch (error) {
      console.error('Error saving photo to gallery:', error);
      throw error;
    }
  }

  // Save video to gallery
  async saveVideoToGallery(video: VideoFile): Promise<MediaLibrary.Asset | null> {
    try {
      const asset = await MediaLibrary.createAssetAsync(`file://${video.path}`);
      console.log('Video saved to gallery:', asset.uri);
      return asset;
    } catch (error) {
      console.error('Error saving video to gallery:', error);
      throw error;
    }
  }

  // Save file by path to gallery
  async saveToGallery(filePath: string): Promise<MediaLibrary.Asset | null> {
    try {
      // Ensure file:// prefix
      const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
      const asset = await MediaLibrary.createAssetAsync(uri);
      console.log('File saved to gallery:', asset.uri);
      return asset;
    } catch (error) {
      console.error('Error saving file to gallery:', error);
      throw error;
    }
  }

  // Create album and move asset to it
  async saveToAlbum(
    asset: MediaLibrary.Asset,
    albumName: string = 'Second Shooter'
  ): Promise<void> {
    try {
      // Get or create album
      let album = await MediaLibrary.getAlbumAsync(albumName);

      if (!album) {
        album = await MediaLibrary.createAlbumAsync(albumName, asset, false);
      } else {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      }

      console.log('Asset added to album:', albumName);
    } catch (error) {
      console.error('Error adding asset to album:', error);
      // Don't throw - the file is already saved to camera roll
    }
  }

  // Check if we have media library permissions
  async checkPermissions(): Promise<boolean> {
    const { status } = await MediaLibrary.getPermissionsAsync();
    return status === 'granted';
  }

  // Request media library permissions
  async requestPermissions(): Promise<boolean> {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  }
}

// Export singleton instance
export const mediaService = new MediaService();
export default mediaService;
