package com.secondshooter.nativepoc.session

import org.junit.Assert.assertEquals
import org.junit.Test

/** The cases from src/__tests__/utils/photoHistory.test.ts. */
class PhotoHistoryTest {
    private fun photo(t: Long) = HistoryPhoto("/p/$t.jpg", t)

    @Test
    fun appendsInTimestampOrderEvenWhenWritesLandLate() {
        val result = appendPhoto(listOf(photo(1), photo(3)), photo(2), max = 5)
        assertEquals(listOf(1L, 2L, 3L), result.list.map { it.timestamp })
        assertEquals(emptyList<HistoryPhoto>(), result.evicted)
    }

    @Test
    fun capsTheHistoryAndReportsWhatFellOff() {
        val result = appendPhoto(listOf(photo(1), photo(2), photo(3)), photo(4), max = 3)
        assertEquals(listOf(2L, 3L, 4L), result.list.map { it.timestamp })
        assertEquals(listOf(1L), result.evicted.map { it.timestamp })
    }

    @Test
    fun zeroCapacityKeepsNothing() {
        val result = appendPhoto(listOf(photo(1)), photo(2), max = 0)
        assertEquals(emptyList<HistoryPhoto>(), result.list)
        assertEquals(2, result.evicted.size)
    }
}
