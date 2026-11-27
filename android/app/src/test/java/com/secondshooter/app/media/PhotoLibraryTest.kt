package com.secondshooter.app.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Locale

class PhotoLibraryTest {
    private fun photo(n: Int) = LibraryPhoto("content://photo/$n", "SecondShooter_IMG_$n.jpg", n.toLong())

    @Test
    fun appendAddsTheNewestLast() {
        val list = PhotoLibraryList.append(listOf(photo(1), photo(2)), photo(3), max = 10)
        assertEquals(listOf(photo(1), photo(2), photo(3)), list)
    }

    @Test
    fun appendMovesARepeatToTheEnd() {
        val list = PhotoLibraryList.append(listOf(photo(1), photo(2)), photo(1), max = 10)
        assertEquals(listOf(photo(2), photo(1)), list)
    }

    @Test
    fun appendKeepsTheNewestWithinTheCap() {
        val list = PhotoLibraryList.append(listOf(photo(1), photo(2), photo(3)), photo(4), max = 3)
        assertEquals(listOf(photo(2), photo(3), photo(4)), list)
    }

    @Test
    fun decodeRoundTripsAndSkipsBrokenLines() {
        val lines = listOf(
            PhotoLibraryList.encode(photo(1)),
            "",
            "{\"uri\":\"content://photo/2\",\"na", // cut short
            PhotoLibraryList.encode(photo(3)),
        )
        assertEquals(listOf(photo(1), photo(3)), PhotoLibraryList.decode(lines))
    }

    @Test
    fun decodeKeepsTheLastPlaceOfARepeatedUri() {
        val lines = listOf(photo(1), photo(2), photo(1)).map(PhotoLibraryList::encode)
        assertEquals(listOf(photo(2), photo(1)), PhotoLibraryList.decode(lines))
    }

    @Test
    fun decodeIgnoresUnknownFields() {
        val line = "{\"uri\":\"u\",\"name\":\"n\",\"savedAt\":5,\"folder\":\"\",\"later\":true}"
        assertEquals(listOf(LibraryPhoto("u", "n", 5)), PhotoLibraryList.decode(listOf(line)))
    }

    @Test
    fun captureNamesParseTheirOwnTimestamp() {
        val name = "SecondShooter_IMG_20261127_155412_345.jpg"
        val expected = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).parse("2026-11-27 15:54:12.345")!!.time
        assertEquals(expected, CaptureNames.parse(name))
        assertEquals(CaptureNames.parse(CaptureNames.photo(java.util.Date(expected)) + ".jpg"), expected)
    }

    @Test
    fun captureNamesIgnoreOtherNames() {
        assertNull(CaptureNames.parse("PXL_20261127_155412345.jpg"))
    }
}
