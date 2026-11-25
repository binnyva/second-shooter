package com.secondshooter.nativepoc.signaling

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.SecureRandom
import java.util.Random

/** Mirrors src/utils/sessionId.ts and the link format in shared/session-link.ts. */
object SessionIds {
    /** 32 characters, so `nextInt` is unbiased; no I, O, 0 or 1. */
    const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    const val LENGTH = 6
    private const val REMOTE_WEB_ORIGIN = "https://apps.binnyva.com/second-shooter"

    private val secureRandom = SecureRandom()

    fun generate(length: Int = LENGTH, random: Random = secureRandom): String =
        buildString(length) { repeat(length) { append(ALPHABET[random.nextInt(ALPHABET.length)]) } }

    fun isValid(sessionId: String): Boolean =
        sessionId.length == LENGTH && sessionId.all { it in ALPHABET }

    fun remoteUrl(sessionId: String) = "$REMOTE_WEB_ORIGIN/s/$sessionId"

    private val SESSION_PATH = Regex("/s/([^/]+)/?$")

    /**
     * A session ID from whatever a QR code or link holds, as
     * parseSessionIdFromInput in shared/session-link.ts: a bare ID, a link
     * ending in /s/{id} (any origin, so the web remote's deploy path doesn't
     * matter), a ?sessionId= link, or {"sessionId": ...} JSON.
     */
    fun parse(input: String): String? {
        val value = input.trim()
        if (value.isEmpty()) return null
        value.uppercase().takeIf(::isValid)?.let { return it }

        runCatching { java.net.URI(value) }.getOrNull()?.takeIf { it.scheme != null }?.let { uri ->
            uri.rawQuery?.split('&')
                ?.map { it.split('=', limit = 2) }
                ?.firstOrNull { it.size == 2 && it[0] == "sessionId" }
                ?.let { java.net.URLDecoder.decode(it[1], "UTF-8") }
                ?.takeIf(::isValid)
                ?.let { return it }
            // secondshooter://s/ABC123 parses with host "s", so look at the
            // whole thing after the scheme, not just the path.
            val tail = value.substringAfter("://", value).let { "/$it" }
            SESSION_PATH.find(tail.substringBefore('?'))?.let { match ->
                val id = java.net.URLDecoder.decode(match.groupValues[1], "UTF-8").uppercase()
                return id.takeIf(::isValid)
            }
            return null
        }

        val id = runCatching {
            Json.parseToJsonElement(value).jsonObject["sessionId"]?.jsonPrimitive?.contentOrNull
        }.getOrNull() ?: return null
        return id.uppercase().takeIf(::isValid)
    }
}
