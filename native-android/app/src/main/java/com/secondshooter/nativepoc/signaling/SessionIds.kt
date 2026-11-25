package com.secondshooter.nativepoc.signaling

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
}
