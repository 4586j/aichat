package com.qiyi.companion.data.chat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.qiyi.companion.MainActivity
import com.qiyi.companion.R

/**
 * Lightweight foreground keep-alive service active ONLY while an AI reply is streaming,
 * preventing Android / OEM background network freezes when the user switches apps or locks screen.
 * Stops itself automatically the instant all active generations finish.
 */
class ChatGenerationService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                val activeCount = intent?.getIntExtra(EXTRA_ACTIVE_COUNT, 1)?.coerceAtLeast(1) ?: 1
                val speaker = intent?.getStringExtra(EXTRA_SPEAKER_NAME).orEmpty().ifBlank { "栖忆" }
                ensureChannel()
                val notification = buildNotification(speaker, activeCount)
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(
                            NOTIFICATION_ID,
                            notification,
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, notification)
                    }
                } catch (_: Exception) {
                    // Gracefully degrade if OS denies foreground start (generation still continues in app scope)
                    stopSelf()
                }
                return START_NOT_STICKY
            }
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    CHANNEL_ID,
                    "对话后台生成",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "回复生成期间保持网络连接不断流，答完后自动关闭"
                    setShowBadge(false)
                }
                nm.createNotificationChannel(ch)
            }
        }
    }

    private fun buildNotification(speaker: String, activeCount: Int): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val title = if (activeCount > 1) {
            "栖忆正在后台整理 $activeCount 段回复…"
        } else {
            "「$speaker」正在整理回复…"
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText("可自由切换界面或切后台，答完后自动保存")
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "qiyi_chat_generation"
        private const val NOTIFICATION_ID = 4318
        private const val ACTION_START = "com.qiyi.companion.action.GEN_START"
        private const val ACTION_STOP = "com.qiyi.companion.action.GEN_STOP"
        private const val EXTRA_ACTIVE_COUNT = "active_count"
        private const val EXTRA_SPEAKER_NAME = "speaker_name"

        fun update(context: Context, speakerName: String, activeCount: Int) {
            runCatching {
                val intent = Intent(context, ChatGenerationService::class.java).apply {
                    action = if (activeCount > 0) ACTION_START else ACTION_STOP
                    putExtra(EXTRA_ACTIVE_COUNT, activeCount)
                    putExtra(EXTRA_SPEAKER_NAME, speakerName)
                }
                if (activeCount > 0) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(intent)
                    } else {
                        context.startService(intent)
                    }
                } else {
                    context.startService(intent)
                }
            }
        }
    }
}
