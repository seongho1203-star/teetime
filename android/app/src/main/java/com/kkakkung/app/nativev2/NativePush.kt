package com.kkakkung.app.nativev2

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Native V2의 FCM 토큰. WebView/Capacitor 이벤트를 거치지 않는다. */
object NativePush {
    fun permissionGranted(activity: Activity): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun requestIfNeeded(activity: Activity, launcher: ActivityResultLauncher<String>): Boolean {
        if (permissionGranted(activity)) return true
        if (Build.VERSION.SDK_INT >= 33) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        return false
    }

    suspend fun token(): String = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!cont.isActive) return@addOnCompleteListener
            if (task.isSuccessful && !task.result.isNullOrBlank()) cont.resume(task.result)
            else cont.resumeWithException(task.exception ?: NativeApiError("알림 토큰을 받지 못했습니다."))
        }
    }
}
