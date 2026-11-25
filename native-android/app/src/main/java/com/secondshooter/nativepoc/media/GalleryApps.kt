package com.secondshooter.nativepoc.media

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.secondshooter.nativepoc.settings.SYSTEM_DEFAULT_GALLERY

data class GalleryApp(val packageName: String, val label: String)

/**
 * Lists the installed gallery apps and opens one. Moved from
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
     * Opens [choice] ([SYSTEM_DEFAULT_GALLERY] or a package name). A chosen
     * app that's gone falls back to the system default, as
     * MediaService.openGallery did.
     */
    fun open(context: Context, choice: String): Boolean {
        val pkg = choice.takeUnless { it == SYSTEM_DEFAULT_GALLERY }
        if (launch(context, pkg)) return true
        return pkg != null && launch(context, null)
    }

    private fun launch(context: Context, packageName: String?): Boolean {
        for (intent in launchCandidates(context, packageName)) {
            if (context !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return true
            } catch (e: Exception) {
                Log.w(TAG, "Gallery intent refused: $intent", e)
            }
        }
        return false
    }

    /**
     * Startable intents, best first. Without a package the system routes the
     * intent so the user's own default wins (only CATEGORY_DEFAULT matches
     * count). With a package we pin the component, since OEM galleries are
     * inconsistent about CATEGORY_DEFAULT.
     */
    private fun launchCandidates(context: Context, packageName: String?): List<Intent> {
        val packageManager = context.packageManager
        val candidates = mutableListOf<Intent>()
        for (template in launchIntents()) {
            if (packageName == null) {
                if (template.resolveActivity(packageManager) != null) candidates += template
                continue
            }
            val match = packageManager.queryIntentActivities(Intent(template).setPackage(packageName), 0)
                .firstOrNull() ?: continue
            candidates += Intent(template).setClassName(packageName, match.activityInfo.name)
        }
        // Some OEM galleries only advertise a launcher activity.
        if (packageName != null) packageManager.getLaunchIntentForPackage(packageName)?.let { candidates += it }
        return candidates
    }

    private fun queryIntents() = listOf(
        Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_GALLERY),
        Intent(Intent.ACTION_VIEW).setType("image/*"),
    )

    // The media-store URI is what a gallery browser handles; the other two
    // widen the net for apps that don't declare it.
    private fun launchIntents() = listOf(
        Intent(Intent.ACTION_VIEW, Uri.parse("content://media/internal/images/media")),
        Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_GALLERY),
        Intent(Intent.ACTION_VIEW).setType("image/*"),
    )
}
