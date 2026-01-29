/**
 * Expo Config Plugin to add the FrameToJpeg vision-camera frame processor plugin
 * This injects the native Kotlin code needed for JPEG frame encoding during prebuild.
 */

const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Native Kotlin code for the frame processor plugin
const FRAME_TO_JPEG_PLUGIN_KT = `package com.secondshooter.app

import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import java.io.ByteArrayOutputStream

class FrameToJpegPlugin(
    private val quality: Int = DEFAULT_QUALITY,
    private val maxWidth: Int = MAX_WIDTH,
    private val maxHeight: Int = MAX_HEIGHT
) : FrameProcessorPlugin() {

    companion object {
        private const val DEFAULT_QUALITY = 80
        private const val MAX_WIDTH = 1280
        private const val MAX_HEIGHT = 720
    }

    override fun callback(frame: Frame, params: Map<String, Any>?): Any? {
        try {
            val width = frame.width
            val height = frame.height
            val image = frame.image ?: return null

            val orientation = (params?.get("orientation") as? String) ?: "portrait"

            val jpegData = when (image.format) {
                ImageFormat.YUV_420_888 -> convertYuv420ToJpeg(image, width, height, orientation)
                else -> null
            } ?: return null

            return Base64.encodeToString(jpegData, Base64.NO_WRAP)
        } catch (e: Exception) {
            android.util.Log.e("FrameToJpegPlugin", "Error encoding frame", e)
            return null
        }
    }

    private fun convertYuv420ToJpeg(
        image: android.media.Image,
        width: Int,
        height: Int,
        orientation: String
    ): ByteArray? {
        try {
            val planes = image.planes
            val yBuffer = planes[0].buffer
            val uBuffer = planes[1].buffer
            val vBuffer = planes[2].buffer

            val ySize = yBuffer.remaining()
            val uSize = uBuffer.remaining()
            val vSize = vBuffer.remaining()

            val nv21 = ByteArray(ySize + uSize + vSize)

            yBuffer.get(nv21, 0, ySize)

            val vPixelStride = planes[2].pixelStride
            val uPixelStride = planes[1].pixelStride

            if (vPixelStride == 2 && uPixelStride == 2) {
                vBuffer.get(nv21, ySize, vSize)
            } else {
                val uvSize = width * height / 4
                var uvIndex = ySize
                for (i in 0 until uvSize) {
                    nv21[uvIndex++] = vBuffer.get(i * vPixelStride)
                    nv21[uvIndex++] = uBuffer.get(i * uPixelStride)
                }
            }

            val yuvImage = YuvImage(nv21, ImageFormat.NV21, width, height, null)

            val (scaledWidth, scaledHeight) = calculateScaledDimensions(width, height)

            val outputStream = ByteArrayOutputStream()
            yuvImage.compressToJpeg(Rect(0, 0, width, height), quality, outputStream)
            var jpegData = outputStream.toByteArray()

            if (scaledWidth != width || scaledHeight != height) {
                jpegData = scaleJpeg(jpegData, scaledWidth, scaledHeight, orientation)
            } else if (orientation != "portrait" && orientation != "landscape-left") {
                jpegData = rotateJpeg(jpegData, orientation)
            }

            return jpegData
        } catch (e: Exception) {
            android.util.Log.e("FrameToJpegPlugin", "Error converting YUV to JPEG", e)
            return null
        }
    }

    private fun calculateScaledDimensions(width: Int, height: Int): Pair<Int, Int> {
        if (width <= maxWidth && height <= maxHeight) {
            return Pair(width, height)
        }

        val widthRatio = maxWidth.toFloat() / width
        val heightRatio = maxHeight.toFloat() / height
        val ratio = minOf(widthRatio, heightRatio)

        val scaledWidth = (width * ratio).toInt()
        val scaledHeight = (height * ratio).toInt()

        return Pair(scaledWidth, scaledHeight)
    }

    private fun scaleJpeg(jpegData: ByteArray, targetWidth: Int, targetHeight: Int, orientation: String): ByteArray {
        try {
            val originalBitmap = android.graphics.BitmapFactory.decodeByteArray(jpegData, 0, jpegData.size)
                ?: return jpegData

            val matrix = Matrix()

            val scaleX = targetWidth.toFloat() / originalBitmap.width
            val scaleY = targetHeight.toFloat() / originalBitmap.height
            matrix.postScale(scaleX, scaleY)

            when (orientation) {
                "portrait-upside-down" -> matrix.postRotate(180f)
                "landscape-right" -> matrix.postRotate(90f)
            }

            val scaledBitmap = Bitmap.createBitmap(
                originalBitmap, 0, 0,
                originalBitmap.width, originalBitmap.height,
                matrix, true
            )

            val outputStream = ByteArrayOutputStream()
            scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)

            if (scaledBitmap != originalBitmap) {
                scaledBitmap.recycle()
            }
            originalBitmap.recycle()

            return outputStream.toByteArray()
        } catch (e: Exception) {
            android.util.Log.e("FrameToJpegPlugin", "Error scaling JPEG", e)
            return jpegData
        }
    }

    private fun rotateJpeg(jpegData: ByteArray, orientation: String): ByteArray {
        try {
            val originalBitmap = android.graphics.BitmapFactory.decodeByteArray(jpegData, 0, jpegData.size)
                ?: return jpegData

            val matrix = Matrix()
            when (orientation) {
                "portrait-upside-down" -> matrix.postRotate(180f)
                "landscape-right" -> matrix.postRotate(90f)
            }

            val rotatedBitmap = Bitmap.createBitmap(
                originalBitmap, 0, 0,
                originalBitmap.width, originalBitmap.height,
                matrix, true
            )

            val outputStream = ByteArrayOutputStream()
            rotatedBitmap.compress(Bitmap.CompressFormat.JPEG, quality, outputStream)

            if (rotatedBitmap != originalBitmap) {
                rotatedBitmap.recycle()
            }
            originalBitmap.recycle()

            return outputStream.toByteArray()
        } catch (e: Exception) {
            return jpegData
        }
    }
}
`;

const FRAME_TO_JPEG_PROVIDER_KT = `package com.secondshooter.app

import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import com.mrousavy.camera.frameprocessors.VisionCameraProxy

object FrameToJpegPackageProvider {
    init {
        FrameProcessorPluginRegistry.addFrameProcessorPlugin("frameToJpeg") { proxy, options ->
            val quality = (options?.get("quality") as? Number)?.toInt() ?: 80
            val maxWidth = (options?.get("maxWidth") as? Number)?.toInt() ?: 1280
            val maxHeight = (options?.get("maxHeight") as? Number)?.toInt() ?: 720
            FrameToJpegPlugin(quality, maxWidth, maxHeight)
        }
    }
}
`;

function withFrameToJpegNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const packageName = config.android?.package || 'com.secondshooter.app';
      const packagePath = packageName.replace(/\./g, '/');

      const javaDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        packagePath
      );

      // Ensure directory exists
      if (!fs.existsSync(javaDir)) {
        fs.mkdirSync(javaDir, { recursive: true });
      }

      // Write the plugin file
      const pluginPath = path.join(javaDir, 'FrameToJpegPlugin.kt');
      fs.writeFileSync(pluginPath, FRAME_TO_JPEG_PLUGIN_KT.replace(/com\.secondshooter\.app/g, packageName));
      console.log('[withFrameToJpegPlugin] Created FrameToJpegPlugin.kt');

      // Write the provider file
      const providerPath = path.join(javaDir, 'FrameToJpegPackageProvider.kt');
      fs.writeFileSync(providerPath, FRAME_TO_JPEG_PROVIDER_KT.replace(/com\.secondshooter\.app/g, packageName));
      console.log('[withFrameToJpegPlugin] Created FrameToJpegPackageProvider.kt');

      return config;
    },
  ]);
}

function withFrameToJpegMainApplication(config) {
  return withMainApplication(config, (config) => {
    const contents = config.modResults.contents;

    // Check if already modified
    if (contents.includes('FrameToJpegPackageProvider')) {
      return config;
    }

    // Add import and provider initialization after the package imports
    const lastImportMatch = contents.match(/^import\s+[^\n]+\n(?=\s*(?:\/\/|class|private|public))/m);

    if (lastImportMatch) {
      const insertPosition = lastImportMatch.index + lastImportMatch[0].length;
      const prefix = contents.slice(0, insertPosition);
      const suffix = contents.slice(insertPosition);

      config.modResults.contents =
        prefix +
        '\n// Initialize frame processor plugin provider\nprivate val frameToJpegProvider = FrameToJpegPackageProvider\n' +
        suffix;
    }

    console.log('[withFrameToJpegPlugin] Modified MainApplication.kt');
    return config;
  });
}

module.exports = function withFrameToJpegPlugin(config) {
  config = withFrameToJpegNativeFiles(config);
  config = withFrameToJpegMainApplication(config);
  return config;
};
