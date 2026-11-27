package com.secondshooter.app.media

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.secondshooter.app.settings.SYSTEM_DEFAULT_GALLERY

data class GalleryApp(val packageName: String, val label: String)

/**
 * Lists the installed gallery apps and hands a photo to one. Moved from
 * modules/gallery-apps (GalleryAppsModule.kt) without the Expo wrapper.
 *
 * The <queries> block in AndroidManifest.xml must stay in step with
 * [queryIntents]: Android 11+ hides packages we haven't declared an interest
 * in, and an undeclared query returns an empty list rather than failing.
 */
object GalleryApps {
    private const val TAG = "SSGallery"

    fun list(context: Context): List<GalleryApp> {
        val packageManager = context.packageManager
        val byPackage = LinkedHashMap<String, GalleryApp>()
        for (intent in queryIntents()) {
            // Flag 0, not MATCH_DEFAULT_ONLY: APP_GALLERY isn't a
            // CATEGORY_DEFAULT intent, and we launch explicitly anyway.
            val matches = runCatching { packageManager.queryIntentActivities(intent, 0) }.getOrDefault(emptyList())
            for (match in matches) {
                val packageName = match.activityInfo?.packageName ?: continue
                if (packageName == context.packageName || packageName in byPackage) continue
                // No launcher entry: an editor or a share target, not a gallery.
                if (packageManager.getLaunchIntentForPackage(packageName) == null) continue
                val label = match.loadLabel(packageManager)?.toString()?.takeIf { it.isNotBlank() } ?: packageName
                byPackage[packageName] = GalleryApp(packageName, label)
            }
        }
        return byPackage.values.sortedBy { it.label.lowercase() }
    }

    /** The app's name, or null if it isn't installed (any more). */
    fun label(context: Context, packageName: String): String? = runCatching {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    }.getOrNull()

    /**
     * Hands one photo to [choice] ([SYSTEM_DEFAULT_GALLERY] or a package
     * name), with a read grant for it. The system default goes out
     * implicitly, so Android uses the user's default viewer or asks; a
     * chosen app that can't view it falls back to that.
     */
    fun openPhoto(context: Context, choice: String, photo: Uri): Boolean {
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(photo, "image/jpeg")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (context !is android.app.Activity) view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pkg = choice.takeUnless { it == SYSTEM_DEFAULT_GALLERY }
        val candidates = buildList {
            if (pkg != null) {
                context.packageManager.queryIntentActivities(Intent(view).setPackage(pkg), 0).firstOrNull()?.let {
                    add(Intent(view).setClassName(pkg, it.activityInfo.name))
                }
            }
            add(view)
        }
        for (intent in candidates) {
            try {
                context.startActivity(intent)
                return true
            } catch (e: Exception) {
                Log.w(TAG, "Photo view intent refused: $intent", e)
            }
        }
        return false
    }

    private fun queryIntents() = listOf(
        Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_GALLERY),
        Intent(Intent.ACTION_VIEW).setType("image/*"),
    )
}
