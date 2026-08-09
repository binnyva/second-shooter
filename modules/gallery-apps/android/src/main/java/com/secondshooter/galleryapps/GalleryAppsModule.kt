package com.secondshooter.galleryapps

import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lists the gallery apps installed on the device and opens one of them.
 *
 * Android has no JS-reachable API for either: enumerating apps needs
 * PackageManager, and launching a *specific* one needs an explicit intent,
 * which `Linking.openURL` can't express.
 */
class GalleryAppsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GalleryApps")

    AsyncFunction("getGalleryApps") {
      return@AsyncFunction listGalleryApps()
    }

    // `packageName` null means "whatever the system picks".
    AsyncFunction("openGallery") { packageName: String? ->
      return@AsyncFunction openGallery(packageName)
    }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No react context")

  private fun listGalleryApps(): List<Map<String, String>> {
    val packageManager = context.packageManager
    val byPackage = LinkedHashMap<String, Map<String, String>>()

    for (intent in galleryQueryIntents()) {
      // Flag 0 rather than MATCH_DEFAULT_ONLY: the APP_GALLERY query isn't a
      // CATEGORY_DEFAULT intent, and we always launch explicitly anyway.
      val matches = try {
        packageManager.queryIntentActivities(intent, 0)
      } catch (error: Exception) {
        emptyList()
      }

      for (match in matches) {
        val packageName = match.activityInfo?.packageName ?: continue
        // Listing ourselves would be an odd place to send the user.
        if (packageName == context.packageName || byPackage.containsKey(packageName)) {
          continue
        }
        // No launcher entry means there's nothing to open standing alone -
        // that's an editor or a share target, not a gallery.
        if (packageManager.getLaunchIntentForPackage(packageName) == null) {
          continue
        }
        val label = match.loadLabel(packageManager)?.toString()?.takeIf { it.isNotBlank() }
          ?: packageName
        byPackage[packageName] = mapOf("packageName" to packageName, "label" to label)
      }
    }

    return byPackage.values.sortedBy { it["label"]?.lowercase() ?: "" }
  }

  private fun openGallery(packageName: String?): Boolean {
    for (intent in launchCandidates(packageName)) {
      // The module can be called while no activity is current, so the launch
      // needs its own task either way.
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        (appContext.currentActivity ?: context).startActivity(intent)
        return true
      } catch (error: Exception) {
        // Resolved but refused to start - keep trying the rest.
      }
    }
    return false
  }

  /**
   * Startable intents for the requested app, best first.
   *
   * The two cases resolve differently on purpose. Without a package we let the
   * system route the intent, so the user's own default gallery wins - which
   * means only CATEGORY_DEFAULT matches are usable. With a package we pin the
   * component ourselves, so any activity that matches will do.
   */
  private fun launchCandidates(packageName: String?): List<Intent> {
    val packageManager = context.packageManager
    val candidates = mutableListOf<Intent>()

    for (template in galleryLaunchIntents()) {
      if (packageName == null) {
        if (template.resolveActivity(packageManager) != null) {
          candidates.add(template)
        }
        continue
      }

      val match = packageManager
        .queryIntentActivities(Intent(template).setPackage(packageName), 0)
        .firstOrNull() ?: continue
      candidates.add(
        Intent(template).setClassName(packageName, match.activityInfo.name)
      )
    }

    // Last resort for a named app whose gallery intents don't resolve (some OEM
    // galleries only advertise a launcher activity).
    if (packageName != null) {
      packageManager.getLaunchIntentForPackage(packageName)?.let { candidates.add(it) }
    }

    return candidates
  }

  // Must match the <queries> block in AndroidManifest.xml, or these come back
  // empty on Android 11+. See the comment there.
  private fun galleryQueryIntents(): List<Intent> = listOf(
    Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_GALLERY),
    Intent(Intent.ACTION_VIEW).setType("image/*")
  )

  // Tried in order. The media-store URI is what an actual gallery browser
  // handles; the other two widen the net for apps that don't declare it.
  private fun galleryLaunchIntents(): List<Intent> = listOf(
    Intent(Intent.ACTION_VIEW, Uri.parse("content://media/internal/images/media")),
    Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_GALLERY),
    Intent(Intent.ACTION_VIEW).setType("image/*")
  )
}
