package com.secondshooter.app.signaling

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionIdsTest {
    @Test
    fun generatesSixCharactersFromTheAlphabet() {
        repeat(200) {
            val id = SessionIds.generate()
            assertEquals(6, id.length)
            assertTrue(id, id.all { it in SessionIds.ALPHABET })
        }
    }

    @Test
    fun neverUsesLookAlikeCharacters() {
        val seen = (1..500).flatMap { SessionIds.generate().toList() }.toSet()
        assertTrue(seen.none { it in "IO01" })
    }

    @Test
    fun alphabetMatchesTheFirestoreRule() {
        // firestore.rules: sessionId.matches('[A-HJ-NP-Z2-9]{6}')
        assertTrue(Regex("[A-HJ-NP-Z2-9]{32}").matches(SessionIds.ALPHABET))
        assertEquals(32, SessionIds.ALPHABET.toSet().size)
    }

    @Test
    fun generatesDistinctIds() {
        assertEquals(100, (1..100).map { SessionIds.generate() }.toSet().size)
    }

    @Test
    fun validatesIds() {
        assertTrue(SessionIds.isValid("WT56V9"))
        assertFalse(SessionIds.isValid("WT56V"))
        assertFalse(SessionIds.isValid("WT56V9X"))
        assertFalse(SessionIds.isValid("WT56VO"))
        assertFalse(SessionIds.isValid("wt56v9"))
    }

    @Test
    fun buildsTheWebRemoteLink() {
        assertEquals("https://apps.binnyva.com/second-shooter/s/WT56V9", SessionIds.remoteUrl("WT56V9"))
    }

    // parseSessionIdFromInput in shared/session-link.ts

    @Test
    fun parsesABareIdInAnyCase() {
        assertEquals("WT56V9", SessionIds.parse("  wt56v9 "))
    }

    @Test
    fun parsesTheWebRemoteLinkWhateverItsBasePath() {
        assertEquals("WT56V9", SessionIds.parse("https://apps.binnyva.com/second-shooter/s/WT56V9"))
        assertEquals("WT56V9", SessionIds.parse("https://example.com/s/wt56v9/"))
        assertEquals("WT56V9", SessionIds.parse("http://apps.binnyva.com/second-shooter/s/WT56V9"))
    }

    @Test
    fun parsesTheAppScheme() {
        assertEquals("WT56V9", SessionIds.parse("secondshooter://s/WT56V9"))
    }

    @Test
    fun parsesAQueryParameterAndJson() {
        assertEquals("WT56V9", SessionIds.parse("https://example.com/remote?sessionId=WT56V9"))
        assertEquals("WT56V9", SessionIds.parse("""{"sessionId":"wt56v9"}"""))
    }

    @Test
    fun rejectsAnythingElse() {
        assertEquals(null, SessionIds.parse(""))
        assertEquals(null, SessionIds.parse("https://example.com/"))
        assertEquals(null, SessionIds.parse("https://example.com/s/WT56VO"))
        assertEquals(null, SessionIds.parse("hello there"))
        assertEquals(null, SessionIds.parse("""{"sessionId":"nope"}"""))
    }
}
