package com.qiyi.companion.data.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import com.qiyi.companion.MainActivity
import com.qiyi.companion.QiYiApplication
import com.qiyi.companion.R
import com.qiyi.companion.data.db.MusicTrackEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Native Android MediaPlayback Foreground Service with MediaSession + Notification.MediaStyle.
 * Renders the standard system status-bar / Quick Settings / Lock Screen media control card with:
 * - Track title, artist, album art
 * - Interactive Previous / Play-Pause / Next buttons
 * - Live seekable progress bar synced with MediaPlayer
 * - Bluetooth / headset media button support
 */
class QiYiMusicPlaybackService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var mediaSession: MediaSession? = null
    private var stateCollectJob: Job? = null
    private var isForegroundStarted = false
    private var lastSyncedTrackId: String? = null
    private var lastSyncedPlaying: Boolean? = null
    private var lastSyncedBuffering: Boolean? = null
    private var lastSyncedDuration: Long = -1L

    private val player: MusicPlayerController
        get() = (application as QiYiApplication).musicPlayer

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        val session = MediaSession(this, "QiYiMusicSession").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = player.playOrResume()
                override fun onPause() = player.pause()
                override fun onSkipToNext() = player.playNext()
                override fun onSkipToPrevious() = player.playPrevious()
                override fun onSeekTo(pos: Long) = player.seekTo(pos)
                override fun onStop() = player.stop()
            })
            isActive = true
        }
        mediaSession = session

        stateCollectJob = serviceScope.launch {
            player.state.collect { st ->
                syncSystemMedia(st)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PREV -> player.playPrevious()
            ACTION_PLAY_PAUSE -> player.togglePlayPause()
            ACTION_NEXT -> player.playNext()
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                isForegroundStarted = false
                stopSelf()
                return START_NOT_STICKY
            }
            else -> syncSystemMedia(player.state.value, forceNotify = true)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stateCollectJob?.cancel()
        serviceScope.cancel()
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
        super.onDestroy()
    }

    private fun syncSystemMedia(st: MusicPlaybackState, forceNotify: Boolean = false) {
        val track = st.currentTrack
        if (track == null) {
            if (isForegroundStarted) {
                stopForeground(STOP_FOREGROUND_REMOVE)
                isForegroundStarted = false
            }
            return
        }

        val session = mediaSession ?: return
        val actions = PlaybackState.ACTION_PLAY or
            PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_SKIP_TO_NEXT or
            PlaybackState.ACTION_SKIP_TO_PREVIOUS or
            PlaybackState.ACTION_SEEK_TO or
            PlaybackState.ACTION_STOP

        val pbStateCode = when {
            st.isBuffering -> PlaybackState.STATE_BUFFERING
            st.isPlaying -> PlaybackState.STATE_PLAYING
            else -> PlaybackState.STATE_PAUSED
        }
        val speed = if (st.isPlaying) 1.0f else 0.0f

        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(pbStateCode, st.positionMs.coerceAtLeast(0L), speed)
                .build()
        )

        val structuralChanged = forceNotify ||
            lastSyncedTrackId != track.id ||
            lastSyncedPlaying != st.isPlaying ||
            lastSyncedBuffering != st.isBuffering ||
            lastSyncedDuration != st.durationMs

        if (!structuralChanged) return

        lastSyncedTrackId = track.id
        lastSyncedPlaying = st.isPlaying
        lastSyncedBuffering = st.isBuffering
        lastSyncedDuration = st.durationMs

        val artBitmap = runCatching {
            BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher)
        }.getOrNull()

        val metaBuilder = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, track.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, track.artist.ifBlank { "栖忆丝竹乐坊" })
            .putString(MediaMetadata.METADATA_KEY_ALBUM, track.album.ifBlank { "栖忆" })
            .putLong(MediaMetadata.METADATA_KEY_DURATION, st.durationMs.coerceAtLeast(0L))
        if (artBitmap != null) {
            metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artBitmap)
        }
        session.setMetadata(metaBuilder.build())

        val notification = buildMediaNotification(session, track, st)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (st.isPlaying || st.isBuffering || !isForegroundStarted) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                isForegroundStarted = true
            } catch (_: Exception) {
                runCatching { nm.notify(NOTIFICATION_ID, notification) }
            }
        } else {
            runCatching { nm.notify(NOTIFICATION_ID, notification) }
        }
    }

    private fun buildMediaNotification(
        session: MediaSession,
        track: MusicTrackEntity,
        st: MusicPlaybackState
    ): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPi = PendingIntent.getActivity(
            this,
            100,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevAction = Notification.Action.Builder(
            android.R.drawable.ic_media_previous,
            "上一首",
            servicePendingIntent(ACTION_PREV, 101)
        ).build()

        val playPauseAction = Notification.Action.Builder(
            if (st.isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            if (st.isPlaying) "暂停" else "播放",
            servicePendingIntent(ACTION_PLAY_PAUSE, 102)
        ).build()

        val nextAction = Notification.Action.Builder(
            android.R.drawable.ic_media_next,
            "下一首",
            servicePendingIntent(ACTION_NEXT, 103)
        ).build()

        val style = Notification.MediaStyle()
            .setMediaSession(session.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)

        val subtitle = when {
            st.isBuffering -> "正在缓冲音频…"
            st.error != null -> st.error
            else -> track.artist.ifBlank { "栖忆丝竹乐坊" }
        }

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(track.title)
            .setContentText(subtitle)
            .setContentIntent(contentPi)
            .setOngoing(st.isPlaying || st.isBuffering)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction)
            .setStyle(style)
            .build()
    }

    private fun servicePendingIntent(action: String, reqCode: Int): PendingIntent {
        val intent = Intent(this, QiYiMusicPlaybackService::class.java).apply {
            this.action = action
        }
        return PendingIntent.getService(
            this,
            reqCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                val ch = NotificationChannel(
                    CHANNEL_ID,
                    "丝竹乐坊媒体播放",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "在系统状态栏和锁屏展示音乐播放控制与进度条"
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
                nm.createNotificationChannel(ch)
            }
        }
    }

    companion object {
        private const val CHANNEL_ID = "qiyi_music_playback"
        private const val NOTIFICATION_ID = 4319
        private const val ACTION_SYNC = "com.qiyi.companion.action.MUSIC_SYNC"
        private const val ACTION_PREV = "com.qiyi.companion.action.MUSIC_PREV"
        private const val ACTION_PLAY_PAUSE = "com.qiyi.companion.action.MUSIC_PLAY_PAUSE"
        private const val ACTION_NEXT = "com.qiyi.companion.action.MUSIC_NEXT"
        private const val ACTION_STOP = "com.qiyi.companion.action.MUSIC_STOP"

        fun startOrUpdate(context: Context) {
            runCatching {
                val intent = Intent(context, QiYiMusicPlaybackService::class.java).apply {
                    action = ACTION_SYNC
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            }
        }

        fun stopService(context: Context) {
            runCatching {
                val intent = Intent(context, QiYiMusicPlaybackService::class.java).apply {
                    action = ACTION_STOP
                }
                context.startService(intent)
            }
        }
    }
}
