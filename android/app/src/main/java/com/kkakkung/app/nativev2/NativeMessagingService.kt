package com.kkakkung.app.nativev2

import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.kkakkung.app.R

internal object NativePushForeground {
    @Volatile var active = false
    @Volatile var chatVisible = false
    fun suppress(data: Map<String, String>) = active && chatVisible && data["chat"] in setOf("1", "true")
}

/** Background notification messages are handled by FCM itself. Foreground messages
 * reach this service; suppress only chat while that actual screen is visible. */
class NativeMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.onNewToken(token)
        // NativeHome refreshes registration on resume; no stale user JWT in this service.
    }
    override fun onMessageReceived(message: RemoteMessage) {
        if (NativePushForeground.suppress(message.data)) return
        val title = message.notification?.title ?: message.data["title"] ?: return
        val body = message.notification?.body ?: message.data["body"].orEmpty()
        val intent = Intent(this, NativeLoginActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("url", message.data["url"] ?: "/")
        val id = (message.messageId ?: message.data["url"] ?: title).hashCode()
        val pending = PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val note = NotificationCompat.Builder(this, getString(R.string.notify_channel_id))
            .setSmallIcon(R.drawable.ic_stat_kkakkung).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(pending)
            .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        try { NotificationManagerCompat.from(this).notify(id, note) } catch (_: SecurityException) { }
    }
}
