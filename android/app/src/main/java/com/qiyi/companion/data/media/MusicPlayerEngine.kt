package com.qiyi.companion.data.media

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import com.qiyi.companion.data.db.MusicTrackEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.TimeUnit

data class MusicPlaybackState(
    val currentTrack: MusicTrackEntity? = null,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val loopSingle: Boolean = false,
    val error: String? = null
)

/**
 * Pure-Kotlin music request intent detector (only inspects user's pure query text, never attachments).
 */
object MusicIntentDetector {
    private val PLAY_PATTERNS = listOf(
        Regex("""(?:帮我放一首|给我放一首|帮我播一首|给我点一首|放一首|播一首|点一首|来一首|来首|听一首|帮我放|给我放|播放|想听)\s*[《「"']?([^《》「」"'，。！？\n]{1,40})[》」"']?"""),
        Regex("""(?:play\s+song|play\s+music)\s+([^\n,.;!?]{1,40})""", RegexOption.IGNORE_CASE)
    )

    fun extractSongQuery(userText: String): String? {
        val clean = userText.trim()
        if (clean.isEmpty() || clean.length > 160) return null
        for (regex in PLAY_PATTERNS) {
            val match = regex.find(clean) ?: continue
            val candidate = match.groupValues.getOrNull(1)?.trim()
                ?.removeSuffix("这首歌")
                ?.removeSuffix("的歌")
                ?.removeSuffix("吧")
                ?.removeSuffix("吗")
                ?.trim()
                .orEmpty()
            if (candidate.isNotEmpty()) return candidate
        }
        return null
    }

    fun matchLocalTracks(query: String, tracks: List<MusicTrackEntity>): List<MusicTrackEntity> {
        val norm = query.lowercase().replace(Regex("\\s+"), "")
        if (norm.isEmpty()) return tracks
        return tracks.filter { t ->
            val hay = "${t.title} ${t.artist}".lowercase().replace(Regex("\\s+"), "")
            hay.contains(norm) || norm.contains(t.title.lowercase().replace(Regex("\\s+"), ""))
        }
    }
}

/**
 * Optional compatible remote music service client matching PC `lib/music.mjs` (`/api/search`, `/api/stream`).
 */
class RemoteMusicClient(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun searchOnline(
        baseUrl: String,
        apiKey: String,
        query: String,
        source: String
    ): List<MusicTrackEntity> = withContext(Dispatchers.IO) {
        val cleanBase = baseUrl.trim().trimEnd('/')
        if (cleanBase.isEmpty()) return@withContext emptyList()
        val encoded = URLEncoder.encode(query.trim(), "UTF-8")
        val url = "$cleanBase/api/search?keyword=$encoded&source=$source&num=8&page=1"
        val reqBuilder = Request.Builder().url(url).get()
        if (apiKey.isNotBlank()) reqBuilder.header("X-API-Key", apiKey.trim())
        httpClient.newCall(reqBuilder.build()).execute().use { resp ->
            if (!resp.isSuccessful) throw IllegalStateException("音乐搜索返回 HTTP ${resp.code}")
            val body = resp.body?.string().orEmpty()
            val root = json.parseToJsonElement(body).jsonObject
            val rows = root["songs"]?.jsonArray ?: return@withContext emptyList()
            rows.mapNotNull { el ->
                val obj = el.jsonObject
                val songmid = obj["songmid"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val title = obj["title"]?.jsonPrimitive?.contentOrNull?.trim()
                    ?: obj["songname"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (songmid.isEmpty() || title.isEmpty()) return@mapNotNull null
                val artist = obj["singer"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val streamUrl = "$cleanBase/api/stream?source=$source&songmid=${URLEncoder.encode(songmid, "UTF-8")}"
                MusicTrackEntity(
                    id = "remote_${source}_$songmid",
                    title = title.take(160),
                    artist = artist.take(120),
                    source = source,
                    localPath = "",
                    remoteUrl = streamUrl
                )
            }
        }
    }
}

/**
 * Native Android MediaPlayer controller supporting offline local audio files + remote stream URLs.
 */
class MusicPlayerController(private val appContext: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var mediaPlayer: MediaPlayer? = null
    private var progressJob: Job? = null
    private var playlist: List<MusicTrackEntity> = emptyList()

    private val _state = MutableStateFlow(MusicPlaybackState())
    val state: StateFlow<MusicPlaybackState> = _state.asStateFlow()

    fun updatePlaylist(tracks: List<MusicTrackEntity>) {
        playlist = tracks
    }

    fun play(track: MusicTrackEntity, musicApiKey: String = "") {
        releasePlayer()
        val player = MediaPlayer()
        mediaPlayer = player
        try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build()
            )
            if (track.localPath.isNotBlank() && File(track.localPath).exists()) {
                player.setDataSource(track.localPath)
            } else if (track.remoteUrl.isNotBlank()) {
                val headers = if (musicApiKey.isNotBlank()) mapOf("X-API-Key" to musicApiKey) else emptyMap()
                player.setDataSource(appContext, android.net.Uri.parse(track.remoteUrl), headers)
            } else {
                _state.value = _state.value.copy(error = "音频文件不存在或链接无效。")
                return
            }

            player.isLooping = _state.value.loopSingle
            player.setOnPreparedListener { mp ->
                mp.start()
                _state.value = _state.value.copy(
                    currentTrack = track,
                    isPlaying = true,
                    positionMs = 0L,
                    durationMs = mp.duration.toLong().coerceAtLeast(0L),
                    error = null
                )
                startProgressTicker()
            }
            player.setOnCompletionListener {
                if (!_state.value.loopSingle) {
                    playNext(musicApiKey)
                }
            }
            player.setOnErrorListener { _, _, _ ->
                _state.value = _state.value.copy(isPlaying = false, error = "播放失败，请检查音频格式或网络。")
                true
            }
            player.prepareAsync()
            _state.value = _state.value.copy(currentTrack = track, isPlaying = false, error = null)
        } catch (err: Exception) {
            _state.value = _state.value.copy(isPlaying = false, error = err.message ?: "无法加载音频。")
        }
    }

    fun togglePlayPause() {
        val mp = mediaPlayer ?: return
        if (mp.isPlaying) {
            mp.pause()
            _state.value = _state.value.copy(isPlaying = false)
        } else {
            mp.start()
            _state.value = _state.value.copy(isPlaying = true)
            startProgressTicker()
        }
    }

    fun seekTo(positionMs: Long) {
        val mp = mediaPlayer ?: return
        runCatching {
            mp.seekTo(positionMs.toInt().coerceAtLeast(0))
            _state.value = _state.value.copy(positionMs = positionMs)
        }
    }

    fun toggleLoopSingle() {
        val next = !_state.value.loopSingle
        mediaPlayer?.isLooping = next
        _state.value = _state.value.copy(loopSingle = next)
    }

    fun playNext(musicApiKey: String = "") {
        if (playlist.isEmpty()) {
            _state.value = _state.value.copy(isPlaying = false)
            return
        }
        val currentId = _state.value.currentTrack?.id
        val idx = playlist.indexOfFirst { it.id == currentId }
        val nextTrack = playlist[(idx + 1).mod(playlist.size)]
        play(nextTrack, musicApiKey)
    }

    fun playPrevious(musicApiKey: String = "") {
        if (playlist.isEmpty()) return
        val currentId = _state.value.currentTrack?.id
        val idx = playlist.indexOfFirst { it.id == currentId }
        val prevTrack = playlist[(if (idx <= 0) playlist.lastIndex else idx - 1)]
        play(prevTrack, musicApiKey)
    }

    fun stop() {
        releasePlayer()
        _state.value = MusicPlaybackState(loopSingle = _state.value.loopSingle)
    }

    private fun startProgressTicker() {
        progressJob?.cancel()
        progressJob = scope.launch {
            while (true) {
                val mp = mediaPlayer ?: break
                if (mp.isPlaying) {
                    _state.value = _state.value.copy(
                        positionMs = mp.currentPosition.toLong().coerceAtLeast(0L),
                        durationMs = mp.duration.toLong().coerceAtLeast(0L)
                    )
                }
                delay(500L)
            }
        }
    }

    private fun releasePlayer() {
        progressJob?.cancel()
        progressJob = null
        runCatching {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        }
        mediaPlayer = null
    }

    fun copyAudioIntoAppStorage(displayName: String, inputBytes: ByteArray): MusicTrackEntity {
        val musicDir = File(appContext.filesDir, "music_library").apply { mkdirs() }
        val ext = displayName.substringAfterLast('.', "mp3").lowercase().take(8)
        val id = UUID.randomUUID().toString()
        val dest = File(musicDir, "$id.$ext")
        dest.writeBytes(inputBytes)
        val cleanTitle = displayName.substringBeforeLast('.').ifBlank { "本地音频" }.take(120)
        return MusicTrackEntity(
            id = id,
            title = cleanTitle,
            artist = "本地曲库",
            source = "local",
            localPath = dest.absolutePath
        )
    }
}
