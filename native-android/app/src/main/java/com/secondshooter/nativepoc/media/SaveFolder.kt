package com.secondshooter.nativepoc.media

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URLDecoder

object SaveFolder {
    /**
     * Turns a SAF tree URI into something worth showing, as
     * describeFolderUri in src/utils/saveFolder.ts does:
     * `.../tree/primary%3ADCIM%2FShoots` → "DCIM/Shoots".
     */
    fun describe(uri: String): String {
        val treeMarker = "/tree/"
        val treeIndex = uri.indexOf(treeMarker)
        if (treeIndex == -1) return uri

        var tree = uri.substring(treeIndex + treeMarker.length)
        tree.indexOf("/document/").takeIf { it != -1 }?.let { tree = tree.substring(0, it) }

        val decoded = try {
            URLDecoder.decode(tree.replace("+", "%2B"), "UTF-8")
        } catch (e: IllegalArgumentException) {
            return uri
        }

        val separator = decoded.indexOf(':')
        val volume = if (separator == -1) "" else decoded.substring(0, separator)
        val path = if (separator == -1) decoded else decoded.substring(separator + 1)
        // "primary" is internal storage; anything else is a removable volume
        // named by its UUID, which means nothing to the user.
        val internal = volume == "primary" || volume.isEmpty()
        val root = if (internal) "Internal storage" else "SD card"
        return when {
            path.isEmpty() -> root
            internal -> path
            else -> "$root/$path"
        }
    }

    /** Keep the picker's grant across restarts. */
    fun persistGrant(context: Context, uri: Uri) {
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
    }

    fun releaseGrant(context: Context, uri: Uri) {
        runCatching {
            context.contentResolver.releasePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
    }

    /**
     * Whether we still hold write access, checked against the grants the
     * system keeps for us. This is the cheap check AGENTS.md asks for: it
     * doesn't touch the folder or its provider. A deleted folder still has a
     * grant; the failed-save marker catches that.
     */
    fun hasWriteGrant(context: Context, uri: String): Boolean =
        context.contentResolver.persistedUriPermissions.any { it.uri.toString() == uri && it.isWritePermission }
}
