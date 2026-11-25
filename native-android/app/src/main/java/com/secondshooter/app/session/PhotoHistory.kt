package com.secondshooter.app.session

/**
 * The remote's captured-photo history, as src/utils/photoHistory.ts: oldest
 * first, so the viewer pages back in time to the left. Entries are files,
 * never base64.
 */
data class HistoryPhoto(val path: String, val timestamp: Long)

data class AppendResult(val list: List<HistoryPhoto>, val evicted: List<HistoryPhoto>)

/** Appends, keeps timestamp order (writes can land out of order) and caps at [max]. */
fun appendPhoto(list: List<HistoryPhoto>, photo: HistoryPhoto, max: Int): AppendResult {
    if (max <= 0) return AppendResult(emptyList(), list + photo)
    val combined = (list + photo).sortedBy { it.timestamp }
    val overflow = maxOf(0, combined.size - max)
    return AppendResult(combined.drop(overflow), combined.take(overflow))
}
