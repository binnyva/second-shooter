package com.secondshooter.app.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

enum class PermissionStatus { GRANTED, ASKABLE, BLOCKED }

/**
 * Whether a runtime permission is granted, can still be asked for, or has
 * been refused for good (Android stops showing the prompt after the second
 * refusal; only the app's system settings can grant it then).
 *
 * Android reports "never asked", "turned off in system settings" and "blocked
 * after two refusals" the same way until a request has been answered, so a
 * permission only counts as blocked once we've asked in this run and the
 * prompt didn't come back. Before that, the right move is to try the prompt.
 */
fun permissionStatus(context: Context, permission: String, asked: Boolean = permission in askedThisRun): PermissionStatus {
    if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) {
        return PermissionStatus.GRANTED
    }
    val activity = context.findActivity() ?: return PermissionStatus.ASKABLE
    val canAsk = !asked || ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)
    return if (canAsk) PermissionStatus.ASKABLE else PermissionStatus.BLOCKED
}

fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private fun prefs(context: Context) = context.getSharedPreferences("permissions", Context.MODE_PRIVATE)

private val askedThisRun = mutableSetOf<String>()

fun markAsked(context: Context, permission: String) {
    askedThisRun += permission
    prefs(context).edit().putBoolean(permission, true).apply()
}

/** Whether we've ever asked, across runs: decides whether to prompt unprompted. */
fun wasAsked(context: Context, permission: String): Boolean = prefs(context).getBoolean(permission, false)
