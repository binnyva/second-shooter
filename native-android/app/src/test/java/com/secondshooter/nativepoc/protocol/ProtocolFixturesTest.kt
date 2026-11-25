package com.secondshooter.nativepoc.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Decodes and re-encodes every example in shared/protocol-fixtures.json. The
 * web remote's Jest test makes sure that file covers every type in
 * shared/protocol.ts, so a protocol change that isn't mirrored in Protocol.kt
 * fails here.
 */
class ProtocolFixturesTest {
    private val fixtures: JsonObject = run {
        val path = System.getProperty("protocolFixtures")
            ?: error("protocolFixtures system property not set (see app/build.gradle.kts)")
        Json.parseToJsonElement(File(path).readText()).jsonObject
    }

    private fun examples(key: String): List<JsonElement> = fixtures.getValue(key).jsonArray

    @Test
    fun everyCommandRoundTrips() {
        for (example in examples("commands")) {
            val command = Protocol.json.decodeFromJsonElement(Command.serializer(), example)
            val back = Protocol.json.encodeToJsonElement(Command.serializer(), command)
            assertEquals("round trip of $example", normalize(example), normalize(back))
        }
    }

    @Test
    fun everyResponseRoundTrips() {
        for (example in examples("responses")) {
            val response = Protocol.json.decodeFromJsonElement(Response.serializer(), example)
            val back = Protocol.json.encodeToJsonElement(Response.serializer(), response)
            assertEquals("round trip of $example", normalize(example), normalize(back))
        }
    }

    @Test
    fun everyCommandDecodesThroughTheDataChannelPath() {
        for (example in examples("commands")) {
            val decoded = Protocol.decodeCommand(example.toString())
            assertTrue("$example decoded as $decoded", decoded is DecodedCommand.Known)
        }
    }

    @Test
    fun unknownAndMalformedCommands() {
        assertEquals(DecodedCommand.Unknown("SELF_DESTRUCT"), Protocol.decodeCommand("""{"type":"SELF_DESTRUCT"}"""))
        assertEquals(DecodedCommand.Unknown("SET_ZOOM"), Protocol.decodeCommand("""{"type":"SET_ZOOM"}"""))
        assertEquals(null, Protocol.decodeCommand("not json"))
        assertEquals(null, Protocol.decodeCommand("""{"level":2}"""))
    }

    @Test
    fun encodedResponsesCarryTheirType() {
        val json = Json.parseToJsonElement(Protocol.encode(Response.PhotoTaken(success = true))).jsonObject
        assertEquals("PHOTO_TAKEN", json.getValue("type").jsonPrimitive.content)
        assertEquals(false, json.containsKey("error"))
    }

    /** 2 and 2.0 are the same JSON number; compare them as such. */
    private fun normalize(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> JsonObject(element.mapValues { normalize(it.value) })
        is JsonArray -> JsonArray(element.map(::normalize))
        JsonNull -> JsonNull
        is JsonPrimitive -> when {
            element.isString -> element
            element.booleanOrNull != null -> element
            else -> JsonPrimitive(element.doubleOrNull)
        }
    }
}
