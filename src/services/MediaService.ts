import * as MediaLibrary from 'expo-media-library';
import { PhotoFile, VideoFile } from 'react-native-vision-camera';
import { Linking, Platform } from 'react-native';

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

  // Get the most recent photo from the gallery
  async getLastPhoto(): Promise<MediaLibrary.Asset | null> {
    try {
      const hasPermission = await this.checkPermissions();
      if (!hasPermission) {
        console.log('No permission to access media library');
        return null;
      }

      const { assets } = await MediaLibrary.getAssetsAsync({
        first: 1,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [MediaLibrary.SortBy.creationTime],
      });

      return assets.length > 0 ? assets[0] : null;
    } catch (error) {
      console.error('Error getting last photo:', error);
      return null;
    }
  }

  // Open the device's gallery/photos app
  async openGallery(): Promise<void> {
    try {
      if (Platform.OS === 'ios') {
        // Open iOS Photos app
        await Linking.openURL('photos-redirect://');
      } else {
        // Open Android Gallery/Photos
        await Linking.openURL('content://media/internal/images/media');
      }
    } catch (error) {
      console.error('Error opening gallery:', error);
      // Fallback: try to open the Photos app directly
      try {
        if (Platform.OS === 'ios') {
          await Linking.openURL('photos://');
        }
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
      }
    }
  }
}

// Export singleton instance
export const mediaService = new MediaService();
export default mediaService;
