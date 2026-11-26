package com.secondshooter.app.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * The data-channel protocol, mirrored from shared/protocol.ts, which stays the
 * source of truth. shared/protocol-fixtures.json holds an example of every
 * message; ProtocolFixturesTest decodes and re-encodes each one, so a change
 * on the TypeScript side that isn't made here fails `./gradlew test`.
 */

@Serializable
enum class FlashMode(val wire: String) {
    @SerialName("off") OFF("off"),
    @SerialName("on") ON("on"),
    @SerialName("auto") AUTO("auto"),
}

@Serializable
enum class CameraFacing {
    @SerialName("front") FRONT,
    @SerialName("back") BACK,
}

@Serializable
enum class CaptureMode {
    @SerialName("photo") PHOTO,
    @SerialName("video") VIDEO,
}

@Serializable
enum class StreamMode {
    @SerialName("webrtc") WEBRTC,
    @SerialName("frame-based") FRAME_BASED,
}

@Serializable
data class CameraState(
    val zoom: Double,
    val flash: FlashMode,
    val facing: CameraFacing,
    val captureMode: CaptureMode,
    val isRecording: Boolean,
    val streamMode: StreamMode? = null,
)

@Serializable
data class LensInfo(
    val id: String,
    val label: String,
    val zoom: Double,
    val isActive: Boolean,
)

/** Exposure compensation in EV; the camera rounds to its nearest step. */
@Serializable
data class ExposureInfo(
    val ev: Double,
    val min: Double,
    val max: Double,
    val step: Double,
)

/** Remote → camera. */
@Serializable
sealed interface Command {
    @Serializable @SerialName("TAKE_PHOTO")
    data object TakePhoto : Command

    @Serializable @SerialName("START_RECORDING")
    data object StartRecording : Command

    @Serializable @SerialName("STOP_RECORDING")
    data object StopRecording : Command

    @Serializable @SerialName("SET_ZOOM")
    data class SetZoom(val level: Double) : Command

    @Serializable @SerialName("SET_FLASH")
    data class SetFlash(val mode: FlashMode) : Command

    @Serializable @SerialName("SET_EXPOSURE")
    data class SetExposure(val ev: Double) : Command

    @Serializable @SerialName("SWITCH_CAMERA")
    data object SwitchCamera : Command

    @Serializable @SerialName("GET_STATE")
    data object GetState : Command
}

/** Camera → remote. */
@Serializable
sealed interface Response {
    @Serializable @SerialName("PHOTO_TAKEN")
    data class PhotoTaken(val success: Boolean, val error: String? = null) : Response

    @Serializable @SerialName("RECORDING_STARTED")
    data object RecordingStarted : Response

    @Serializable @SerialName("RECORDING_STOPPED")
    data class RecordingStopped(val success: Boolean, val error: String? = null) : Response

    @Serializable @SerialName("STATE_UPDATE")
    data class StateUpdate(
        val state: CameraState,
        val lenses: List<LensInfo>? = null,
        val videoNeedsRotation: Boolean? = null,
        val previewZoomLimited: Boolean? = null,
        val streamMode: StreamMode? = null,
        /** The current camera's zoom range, for clamping a pinch on the remote. */
        val minZoom: Double? = null,
        val maxZoom: Double? = null,
        /** Absent when the camera can't adjust exposure. */
        val exposure: ExposureInfo? = null,
    ) : Response

    @Serializable @SerialName("ERROR")
    data class ErrorMessage(val message: String) : Response

    @Serializable @SerialName("CAPTURE_STATE")
    data class CaptureState(val capturing: Boolean) : Response

    /** Never sent by this app: the preview is always a WebRTC track. */
    @Serializable @SerialName("FRAME_DATA")
    data class FrameData(val frameId: Long, val data: String, val timestamp: Long) : Response

    /** Base64 JPEG. Never log `data`. */
    @Serializable @SerialName("PHOTO_DATA")
    data class PhotoData(val data: String, val timestamp: Long) : Response
}

sealed interface DecodedCommand {
    data class Known(val command: Command) : DecodedCommand

    /** Valid JSON with a `type` this app doesn't understand. */
    data class Unknown(val type: String) : DecodedCommand
}

object Protocol {
    val json = Json {
        classDiscriminator = "type"
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    fun encode(response: Response): String = json.encodeToString(Response.serializer(), response)

    /** Null for anything that isn't a JSON object with a string `type`. */
    fun decodeCommand(text: String): DecodedCommand? {
        val type = try {
            json.parseToJsonElement(text).jsonObject["type"]?.jsonPrimitive?.content
        } catch (e: IllegalArgumentException) {
            null
        } ?: return null

        return try {
            DecodedCommand.Known(json.decodeFromString(Command.serializer(), text))
        } catch (e: SerializationException) {
            DecodedCommand.Unknown(type)
        } catch (e: IllegalArgumentException) {
            DecodedCommand.Unknown(type)
        }
    }
}
