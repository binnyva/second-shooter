package com.secondshooter.nativepoc

import org.json.JSONArray
import org.json.JSONObject

/** The subset of shared/protocol.ts this test app speaks. */
sealed interface Command {
    data object TakePhoto : Command
    data object GetState : Command
    data class SetZoom(val level: Float) : Command
    data class Unsupported(val type: String) : Command
}

data class Lens(val id: String, val label: String, val zoom: Float)

object Protocol {
    fun parseCommand(text: String): Command? {
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
        return when (val type = json.optString("type")) {
            "TAKE_PHOTO" -> Command.TakePhoto
            "GET_STATE" -> Command.GetState
            "SET_ZOOM" -> Command.SetZoom(json.optDouble("level", 1.0).toFloat())
            "" -> null
            else -> Command.Unsupported(type)
        }
    }

    fun stateUpdate(zoom: Float, lenses: List<Lens>): String {
        val state = JSONObject()
            .put("zoom", zoom.toDouble())
            .put("flash", "off")
            .put("facing", "back")
            .put("captureMode", "photo")
            .put("isRecording", false)
            .put("streamMode", "webrtc")
        val lensArray = JSONArray()
        lenses.forEach { lens ->
            lensArray.put(
                JSONObject()
                    .put("id", lens.id)
                    .put("label", lens.label)
                    .put("zoom", lens.zoom.toDouble())
                    .put("isActive", isActive(zoom, lens.zoom))
            )
        }
        return JSONObject()
            .put("type", "STATE_UPDATE")
            .put("state", state)
            .put("lenses", lensArray)
            .put("videoNeedsRotation", false)
            .put("previewZoomLimited", false)
            .put("streamMode", "webrtc")
            .toString()
    }

    fun photoTaken(success: Boolean, error: String? = null): String =
        JSONObject().put("type", "PHOTO_TAKEN").put("success", success)
            .apply { if (error != null) put("error", error) }
            .toString()

    fun photoData(base64Jpeg: String): String =
        JSONObject().put("type", "PHOTO_DATA").put("data", base64Jpeg)
            .put("timestamp", System.currentTimeMillis())
            .toString()

    fun error(message: String): String =
        JSONObject().put("type", "ERROR").put("message", message).toString()

    fun isActive(current: Float, lensZoom: Float) = kotlin.math.abs(current - lensZoom) < 0.05f
}
