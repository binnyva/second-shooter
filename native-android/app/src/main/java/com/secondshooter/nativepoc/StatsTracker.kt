package com.secondshooter.nativepoc

import org.webrtc.RTCStatsReport

/**
 * Turns getStats() into one line for the overlay and logcat: what is really
 * leaving the phone, and whether the encoder is the bottleneck.
 */
class StatsTracker {
    private var lastBytes: Long? = null
    private var lastTimestampUs: Double? = null

    fun reset() {
        lastBytes = null
        lastTimestampUs = null
    }

    fun summarize(report: RTCStatsReport): String? {
        val stats = report.statsMap.values
        val outbound = stats.firstOrNull {
            it.type == "outbound-rtp" && it.members["kind"] == "video"
        } ?: return null
        val m = outbound.members

        val bytes = (m["bytesSent"] as? Number)?.toLong()
        val kbps = if (bytes != null && lastBytes != null && lastTimestampUs != null) {
            val seconds = (outbound.timestampUs - lastTimestampUs!!) / 1_000_000.0
            if (seconds > 0) ((bytes - lastBytes!!) * 8 / 1000.0 / seconds).toInt() else null
        } else null
        lastBytes = bytes
        lastTimestampUs = outbound.timestampUs

        val codec = (m["codecId"] as? String)?.let { report.statsMap[it] }
            ?.members?.get("mimeType") as? String

        val path = stats.firstOrNull { it.type == "transport" }
            ?.members?.get("selectedCandidatePairId")
            ?.let { report.statsMap[it as String] }
            ?.members?.get("localCandidateId")
            ?.let { report.statsMap[it as String] }
            ?.members?.get("candidateType") as? String

        return buildString {
            append("Sent ${m["frameWidth"] ?: "?"}x${m["frameHeight"] ?: "?"}")
            append(" @ ${(m["framesPerSecond"] as? Number)?.toInt() ?: "?"}fps")
            if (kbps != null) append(" · ${kbps}kbps")
            append("\n${codec ?: "?"} · ${m["encoderImplementation"] ?: "?"}")
            append(" · limit ${m["qualityLimitationReason"] ?: "?"}")
            if (path != null) append(" · $path")
        }
    }
}
