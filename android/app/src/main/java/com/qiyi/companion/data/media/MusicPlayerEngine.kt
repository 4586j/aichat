package com.qiyi.companion.data.media

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
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
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit

enum class MusicPlayMode(val label: String) {
    SEQUENCE("列表循环"),
    REPEAT_ONE("单曲循环"),
    SHUFFLE("随机播放")
}

enum class MusicSearchSource(val key: String, val label: String) {
    ALL("all", "全部"),
    SERVER("server", "服务器"),
    QQ("qq", "QQ音乐"),
    NETEASE("netease", "网易云");

    companion object {
        fun fromKey(key: String?): MusicSearchSource =
            entries.firstOrNull { it.key == key } ?: ALL
    }
}

data class MusicPlaybackState(
    val currentTrack: MusicTrackEntity? = null,
    val queue: List<MusicTrackEntity> = emptyList(),
    val currentIndex: Int = -1,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val playMode: MusicPlayMode = MusicPlayMode.SEQUENCE,
    val error: String? = null
) {
    val loopSingle: Boolean get() = playMode == MusicPlayMode.REPEAT_ONE
}

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
            val hay = "${t.title} ${t.artist} ${t.album}".lowercase().replace(Regex("\\s+"), "")
            hay.contains(norm) || norm.contains(t.title.lowercase().replace(Regex("\\s+"), ""))
        }
    }
}

/**
 * Compatible remote music service client supporting:
 * - Server local library (`/api/library` + `/api/local_play`)
 * - Multi-source online search (`all` / `server` / `qq` / `netease` via `/api/search` + `/api/stream`)
 * - Pre-checked OkHttp disk-cached audio streaming with clear error messages (404/401/JSON)
 */
class RemoteMusicClient(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun searchServerLibrary(
        baseUrl: String,
        apiKey: String,
        query: String
    ): List<MusicTrackEntity> = withContext(Dispatchers.IO) {
        val cleanBase = baseUrl.trim().trimEnd('/')
        if (cleanBase.isEmpty()) return@withContext emptyList()
        val reqBuilder = Request.Builder().url("$cleanBase/api/library").get()
        if (apiKey.isNotBlank()) reqBuilder.header("X-API-Key", apiKey.trim())
        httpClient.newCall(reqBuilder.build()).execute().use { resp ->
            if (!resp.isSuccessful) {
                if (resp.code == 401 || resp.code == 403) throw IllegalStateException("音乐服务鉴权失败，请检查音乐 API Key。")
                return@withContext emptyList()
            }
            val body = resp.body?.string().orEmpty()
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return@withContext emptyList()
            val files = root["files"]?.jsonArray ?: return@withContext emptyList()
            val allTracks = files.mapNotNull { el ->
                val obj = el.jsonObject
                val name = obj["name"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (name.isEmpty()) return@mapNotNull null
                val title = obj["title"]?.jsonPrimitive?.contentOrNull?.trim()?.ifEmpty { null }
                    ?: name.substringBeforeLast('.')
                val artist = obj["singer"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val album = obj["album"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val durSec = obj["duration"]?.jsonPrimitive?.intOrNull ?: 0
                val encodedName = URLEncoder.encode(name, "UTF-8")
                MusicTrackEntity(
                    id = "server_${sha256Short(name)}",
                    title = title.take(160),
                    artist = artist.take(120),
                    album = album.take(120),
                    source = "server",
                    localPath = "",
                    remoteUrl = "$cleanBase/api/local_play?name=$encodedName",
                    durationMs = durSec * 1000L
                )
            }
            if (query.isBlank()) allTracks.take(40)
            else MusicIntentDetector.matchLocalTracks(query, allTracks).take(20)
        }
    }

    suspend fun searchOnline(
        baseUrl: String,
        apiKey: String,
        query: String,
        source: String
    ): List<MusicTrackEntity> = withContext(Dispatchers.IO) {
        val cleanBase = baseUrl.trim().trimEnd('/')
        if (cleanBase.isEmpty()) return@withContext emptyList()
        val cleanQuery = query.trim()

        when (source) {
            "server" -> searchServerLibrary(cleanBase, apiKey, cleanQuery)
            "all" -> {
                val results = mutableListOf<MusicTrackEntity>()
                runCatching { searchServerLibrary(cleanBase, apiKey, cleanQuery) }
                    .getOrNull()?.let { results.addAll(it.take(6)) }
                if (cleanQuery.isNotEmpty()) {
                    val qq = runCatching { searchSingleOnlineSource(cleanBase, apiKey, cleanQuery, "qq", 6) }.getOrDefault(emptyList())
                    val ne = runCatching { searchSingleOnlineSource(cleanBase, apiKey, cleanQuery, "netease", 6) }.getOrDefault(emptyList())
                    val maxLen = maxOf(qq.size, ne.size)
                    for (i in 0 until maxLen) {
                        if (i < qq.size) results.add(qq[i])
                        if (i < ne.size) results.add(ne[i])
                    }
                }
                results.distinctBy { it.id }
            }
            "qq", "netease" -> {
                if (cleanQuery.isEmpty()) emptyList()
                else searchSingleOnlineSource(cleanBase, apiKey, cleanQuery, source, 10)
            }
            else -> emptyList()
        }
    }

    private fun searchSingleOnlineSource(
        cleanBase: String,
        apiKey: String,
        query: String,
        source: String,
        limit: Int
    ): List<MusicTrackEntity> {
        val encoded = URLEncoder.encode(query, "UTF-8")
        val url = "$cleanBase/api/search?keyword=$encoded&source=$source&num=$limit&page=1"
        val reqBuilder = Request.Builder().url(url).get()
        if (apiKey.isNotBlank()) reqBuilder.header("X-API-Key", apiKey.trim())
        httpClient.newCall(reqBuilder.build()).execute().use { resp ->
            if (resp.code == 401 || resp.code == 403) throw IllegalStateException("音乐服务鉴权失败，请检查音乐 API Key。")
            if (!resp.isSuccessful) throw IllegalStateException("音乐搜索返回 HTTP ${resp.code}")
            val body = resp.body?.string().orEmpty()
            val root = json.parseToJsonElement(body).jsonObject
            val rows = root["songs"]?.jsonArray ?: return emptyList()
            return rows.mapNotNull { el ->
                val obj = el.jsonObject
                val songmid = obj["songmid"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val title = obj["title"]?.jsonPrimitive?.contentOrNull?.trim()?.ifEmpty { null }
                    ?: obj["songname"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (songmid.isEmpty() || title.isEmpty()) return@mapNotNull null
                val artist = obj["singer"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val album = obj["album"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val cover = obj["cover"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val durSec = obj["duration"]?.jsonPrimitive?.intOrNull ?: 0
                val streamUrl = "$cleanBase/api/stream?source=$source&songmid=${URLEncoder.encode(songmid, "UTF-8")}"
                MusicTrackEntity(
                    id = "remote_${source}_$songmid",
                    title = title.take(160),
                    artist = artist.take(120),
                    album = album.take(120),
                    source = source,
                    localPath = "",
                    remoteUrl = streamUrl,
                    coverUrl = cover.take(400),
                    durationMs = durSec * 1000L
                )
            }
        }
    }

    /**
     * Downloads and caches remote audio locally with OkHttp so MediaPlayer plays MP3/M4A/FLAC reliably
     * with instant seeking and accurate HTTP 404/401 error messages.
     */
    suspend fun fetchToLocalCache(
        cacheDir: File,
        track: MusicTrackEntity,
        apiKey: String
    ): File = withContext(Dispatchers.IO) {
        val streamCacheDir = File(cacheDir, "music_stream_cache").apply { mkdirs() }
        val targetFile = File(streamCacheDir, "${sha256Short(track.id)}.audio")
        if (targetFile.exists() && targetFile.length() > 2048L) {
            targetFile.setLastModified(System.currentTimeMillis())
            return@withContext targetFile
        }

        val urlsToTry = buildList {
            add(track.remoteUrl)
            if (track.remoteUrl.contains("/api/stream") && !track.remoteUrl.contains("quality=")) {
                add("${track.remoteUrl}&quality=128")
            }
        }

        var lastError = "该曲目暂无可用音源，请尝试换一首或切换其他音源。"
        for (url in urlsToTry) {
            val reqBuilder = Request.Builder().url(url).get()
            if (apiKey.isNotBlank()) reqBuilder.header("X-API-Key", apiKey.trim())
            httpClient.newCall(reqBuilder.build()).execute().use { resp ->
                if (resp.code == 401 || resp.code == 403) {
                    throw IllegalStateException("音乐服务鉴权失败，请检查音乐 API Key。")
                }
                if (resp.code == 404) {
                    lastError = "该歌曲暂无可用音源（可能为 VIP/版权受限，可换版本或切换音源）。"
                    return@use
                }
                if (!resp.isSuccessful) {
                    lastError = "音频获取失败（HTTP ${resp.code}），请稍后重试。"
                    return@use
                }
                val contentType = resp.header("Content-Type").orEmpty().lowercase()
                if (contentType.contains("application/json") || contentType.contains("text/html")) {
                    lastError = "该歌曲暂无可用音源，请切换音源或重试。"
                    return@use
                }
                val body = resp.body ?: return@use
                val partFile = File(streamCacheDir, "${targetFile.name}.${UUID.randomUUID()}.part")
                try {
                    body.byteStream().use { input ->
                        partFile.outputStream().use { output ->
                            input.copyTo(output, bufferSize = 16 * 1024)
                        }
                    }
                    if (partFile.length() > 1024L) {
                        if (targetFile.exists()) targetFile.delete()
                        partFile.renameTo(targetFile)
                        pruneCache(streamCacheDir, maxBytes = 150L * 1024L * 1024L)
                        return@withContext targetFile
                    } else {
                        partFile.delete()
                        lastError = "音频流为空，请换一首重试。"
                    }
                } catch (err: Exception) {
                    partFile.delete()
                    throw err
                }
            }
        }
        throw IllegalStateException(lastError)
    }

    private fun pruneCache(dir: File, maxBytes: Long) {
        val files = dir.listFiles()?.filter { it.isFile && it.name.endsWith(".audio") }.orEmpty()
        var total = files.sumOf { it.length() }
        if (total <= maxBytes) return
        val sorted = files.sortedBy { it.lastModified() }
        for (f in sorted) {
            if (total <= maxBytes * 8 / 10) break
            val len = f.length()
            if (f.delete()) total -= len
        }
    }

    private fun sha256Short(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.take(12).joinToString("") { "%02x".format(it) }
    }
}

/**
 * Full-featured Android music controller with Play Queue, Play Modes (Sequence/RepeatOne/Shuffle),
 * OkHttp cached streaming, AudioFocus handling, noisy-headset pause, and system MediaSession sync.
 */
class MusicPlayerController(
    private val appContext: Context,
    private val remoteClient: RemoteMusicClient = RemoteMusicClient()
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var mediaPlayer: MediaPlayer? = null
    private var progressJob: Job? = null
    private var loadJob: Job? = null
    private var lastApiKey: String = ""
    private var libraryFallback: List<MusicTrackEntity> = emptyList()
    private var audioFocusRequest: AudioFocusRequest? = null
    private var noisyReceiverRegistered = false

    private val _state = MutableStateFlow(MusicPlaybackState())
    val state: StateFlow<MusicPlaybackState> = _state.asStateFlow()

    var onTrackStarted: ((MusicTrackEntity) -> Unit)? = null

    private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                if (_state.value.isPlaying) pause()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                runCatching { mediaPlayer?.setVolume(0.25f, 0.25f) }
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                runCatching { mediaPlayer?.setVolume(1.0f, 1.0f) }
            }
        }
    }

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && _state.value.isPlaying) {
                pause()
            }
        }
    }

    fun updatePlaylist(tracks: List<MusicTrackEntity>) {
        libraryFallback = tracks
        // Sync updated favorite flags into active queue & currentTrack without resetting queue
        val mapById = tracks.associateBy { it.id }
        val prev = _state.value
        val updatedQueue = if (prev.queue.isEmpty() && tracks.isNotEmpty()) {
            tracks
        } else {
            prev.queue.map { q -> mapById[q.id]?.let { q.copy(isFavorite = it.isFavorite) } ?: q }
        }
        val updatedCurrent = prev.currentTrack?.let { cur ->
            mapById[cur.id]?.let { cur.copy(isFavorite = it.isFavorite) } ?: cur
        }
        _state.value = prev.copy(queue = updatedQueue, currentTrack = updatedCurrent)
    }

    fun play(track: MusicTrackEntity, musicApiKey: String = lastApiKey) {
        if (musicApiKey.isNotBlank()) lastApiKey = musicApiKey
        val prev = _state.value
        val existingIdx = prev.queue.indexOfFirst { it.id == track.id }
        val nextQueue: List<MusicTrackEntity>
        val nextIdx: Int
        if (existingIdx >= 0) {
            nextQueue = prev.queue.toMutableList().apply { this[existingIdx] = track }
            nextIdx = existingIdx
        } else {
            val insertAt = if (prev.currentIndex in prev.queue.indices) prev.currentIndex + 1 else prev.queue.size
            nextQueue = prev.queue.toMutableList().apply { add(insertAt, track) }
            nextIdx = insertAt
        }
        _state.value = prev.copy(queue = nextQueue, currentIndex = nextIdx)
        playTrackInternal(track, lastApiKey)
    }

    fun playQueueIndex(index: Int, musicApiKey: String = lastApiKey) {
        if (musicApiKey.isNotBlank()) lastApiKey = musicApiKey
        val q = _state.value.queue
        if (index !in q.indices) return
        _state.value = _state.value.copy(currentIndex = index)
        playTrackInternal(q[index], lastApiKey)
    }

    fun replaceQueueAndPlay(tracks: List<MusicTrackEntity>, startIndex: Int = 0, musicApiKey: String = lastApiKey) {
        if (tracks.isEmpty()) return
        if (musicApiKey.isNotBlank()) lastApiKey = musicApiKey
        val safeIdx = startIndex.coerceIn(tracks.indices)
        _state.value = _state.value.copy(queue = tracks, currentIndex = safeIdx)
        playTrackInternal(tracks[safeIdx], lastApiKey)
    }

    fun enqueueNext(track: MusicTrackEntity) {
        val prev = _state.value
        val list = prev.queue.toMutableList()
        val existing = list.indexOfFirst { it.id == track.id }
        var curIdx = prev.currentIndex
        if (existing >= 0) {
            if (existing == curIdx) return
            list.removeAt(existing)
            if (existing < curIdx) curIdx--
        }
        val insertAt = if (curIdx in list.indices) curIdx + 1 else 0
        list.add(insertAt, track)
        _state.value = prev.copy(queue = list, currentIndex = curIdx)
    }

    fun enqueueEnd(track: MusicTrackEntity) {
        val prev = _state.value
        if (prev.queue.any { it.id == track.id }) return
        _state.value = prev.copy(queue = prev.queue + track)
    }

    fun removeFromQueue(index: Int) {
        val prev = _state.value
        if (index !in prev.queue.indices) return
        val removed = prev.queue[index]
        val list = prev.queue.toMutableList().apply { removeAt(index) }
        val newCurIdx = when {
            list.isEmpty() -> -1
            index < prev.currentIndex -> prev.currentIndex - 1
            index == prev.currentIndex -> prev.currentIndex.coerceAtMost(list.lastIndex)
            else -> prev.currentIndex
        }
        _state.value = prev.copy(queue = list, currentIndex = newCurIdx)
        if (prev.currentTrack?.id == removed.id) {
            if (list.isEmpty()) {
                stop()
            } else {
                playQueueIndex(newCurIdx, lastApiKey)
            }
        }
    }

    fun clearQueue() {
        stop()
        _state.value = MusicPlaybackState(playMode = _state.value.playMode)
    }

    private fun playTrackInternal(track: MusicTrackEntity, apiKey: String) {
        loadJob?.cancel()
        releasePlayer()
        _state.value = _state.value.copy(
            currentTrack = track,
            isPlaying = false,
            isBuffering = true,
            positionMs = 0L,
            durationMs = track.durationMs.coerceAtLeast(0L),
            error = null
        )
        QiYiMusicPlaybackService.startOrUpdate(appContext)

        loadJob = scope.launch {
            try {
                val playablePath: String = when {
                    track.localPath.isNotBlank() && File(track.localPath).exists() -> track.localPath
                    track.remoteUrl.isNotBlank() -> {
                        remoteClient.fetchToLocalCache(appContext.cacheDir, track, apiKey).absolutePath
                    }
                    else -> throw IllegalStateException("音频文件不存在或链接无效。")
                }
                startLocalFilePlayback(track, playablePath)
            } catch (cancel: kotlinx.coroutines.CancellationException) {
                throw cancel
            } catch (err: Exception) {
                _state.value = _state.value.copy(
                    isPlaying = false,
                    isBuffering = false,
                    error = err.message ?: "无法加载音频。"
                )
                QiYiMusicPlaybackService.startOrUpdate(appContext)
            }
        }
    }

    private fun startLocalFilePlayback(track: MusicTrackEntity, filePath: String) {
        requestAudioFocus()
        registerNoisyReceiver()
        val player = MediaPlayer()
        mediaPlayer = player
        try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build()
            )
            player.setDataSource(filePath)
            player.isLooping = _state.value.playMode == MusicPlayMode.REPEAT_ONE
            player.setOnPreparedListener { mp ->
                mp.start()
                val realDuration = mp.duration.toLong().coerceAtLeast(track.durationMs)
                _state.value = _state.value.copy(
                    currentTrack = track.copy(durationMs = realDuration),
                    isPlaying = true,
                    isBuffering = false,
                    positionMs = 0L,
                    durationMs = realDuration,
                    error = null
                )
                onTrackStarted?.invoke(track)
                startProgressTicker()
                QiYiMusicPlaybackService.startOrUpdate(appContext)
            }
            player.setOnCompletionListener {
                if (_state.value.playMode != MusicPlayMode.REPEAT_ONE) {
                    playNext(lastApiKey)
                }
            }
            player.setOnErrorListener { _, _, _ ->
                _state.value = _state.value.copy(
                    isPlaying = false,
                    isBuffering = false,
                    error = "音频解码失败，请换一首或切换音源。"
                )
                QiYiMusicPlaybackService.startOrUpdate(appContext)
                true
            }
            player.prepareAsync()
        } catch (err: Exception) {
            _state.value = _state.value.copy(
                isPlaying = false,
                isBuffering = false,
                error = err.message ?: "无法加载音频。"
            )
            QiYiMusicPlaybackService.startOrUpdate(appContext)
        }
    }

    fun playOrResume() {
        val mp = mediaPlayer
        if (mp != null && !mp.isPlaying) {
            requestAudioFocus()
            mp.start()
            _state.value = _state.value.copy(isPlaying = true, isBuffering = false)
            startProgressTicker()
            QiYiMusicPlaybackService.startOrUpdate(appContext)
        } else if (mp == null) {
            val cur = _state.value.currentTrack ?: _state.value.queue.firstOrNull() ?: libraryFallback.firstOrNull()
            if (cur != null) play(cur, lastApiKey)
        }
    }

    fun pause() {
        val mp = mediaPlayer ?: return
        if (mp.isPlaying) {
            mp.pause()
            _state.value = _state.value.copy(isPlaying = false)
            QiYiMusicPlaybackService.startOrUpdate(appContext)
        }
    }

    fun togglePlayPause() {
        val mp = mediaPlayer
        if (mp != null && mp.isPlaying) {
            pause()
        } else {
            playOrResume()
        }
    }

    fun seekTo(positionMs: Long) {
        val mp = mediaPlayer ?: return
        runCatching {
            val clamped = positionMs.coerceIn(0L, _state.value.durationMs.coerceAtLeast(0L))
            mp.seekTo(clamped.toInt())
            _state.value = _state.value.copy(positionMs = clamped)
            QiYiMusicPlaybackService.startOrUpdate(appContext)
        }
    }

    fun cyclePlayMode(): MusicPlayMode {
        val next = when (_state.value.playMode) {
            MusicPlayMode.SEQUENCE -> MusicPlayMode.REPEAT_ONE
            MusicPlayMode.REPEAT_ONE -> MusicPlayMode.SHUFFLE
            MusicPlayMode.SHUFFLE -> MusicPlayMode.SEQUENCE
        }
        mediaPlayer?.isLooping = (next == MusicPlayMode.REPEAT_ONE)
        _state.value = _state.value.copy(playMode = next)
        return next
    }

    fun toggleLoopSingle() {
        cyclePlayMode()
    }

    fun playNext(musicApiKey: String = lastApiKey) {
        if (musicApiKey.isNotBlank()) lastApiKey = musicApiKey
        val q = _state.value.queue.ifEmpty { libraryFallback }
        if (q.isEmpty()) {
            _state.value = _state.value.copy(isPlaying = false)
            QiYiMusicPlaybackService.startOrUpdate(appContext)
            return
        }
        val curIdx = _state.value.currentIndex.takeIf { it in q.indices }
            ?: q.indexOfFirst { it.id == _state.value.currentTrack?.id }
        val nextIdx = if (_state.value.playMode == MusicPlayMode.SHUFFLE && q.size > 1) {
            var pick = (q.indices).random()
            if (pick == curIdx) pick = (curIdx + 1) % q.size
            pick
        } else {
            (curIdx + 1).mod(q.size)
        }
        _state.value = _state.value.copy(queue = q, currentIndex = nextIdx)
        playTrackInternal(q[nextIdx], lastApiKey)
    }

    fun playPrevious(musicApiKey: String = lastApiKey) {
        if (musicApiKey.isNotBlank()) lastApiKey = musicApiKey
        val q = _state.value.queue.ifEmpty { libraryFallback }
        if (q.isEmpty()) return
        val curIdx = _state.value.currentIndex.takeIf { it in q.indices }
            ?: q.indexOfFirst { it.id == _state.value.currentTrack?.id }
        val prevIdx = if (curIdx <= 0) q.lastIndex else curIdx - 1
        _state.value = _state.value.copy(queue = q, currentIndex = prevIdx)
        playTrackInternal(q[prevIdx], lastApiKey)
    }

    fun stop() {
        loadJob?.cancel()
        releasePlayer()
        abandonAudioFocus()
        unregisterNoisyReceiver()
        _state.value = _state.value.copy(
            isPlaying = false,
            isBuffering = false,
            positionMs = 0L
        )
        QiYiMusicPlaybackService.stopService(appContext)
    }

    private fun startProgressTicker() {
        progressJob?.cancel()
        progressJob = scope.launch {
            while (true) {
                val mp = mediaPlayer ?: break
                if (mp.isPlaying) {
                    _state.value = _state.value.copy(
                        positionMs = mp.currentPosition.toLong().coerceAtLeast(0L),
                        durationMs = mp.duration.toLong().coerceAtLeast(_state.value.durationMs)
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

    private fun requestAudioFocus() {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
                    )
                    .setOnAudioFocusChangeListener(audioFocusChangeListener)
                    .build()
                audioFocusRequest = req
                audioManager.requestAudioFocus(req)
            } else {
                @Suppress("DEPRECATION")
                audioManager.requestAudioFocus(
                    audioFocusChangeListener,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                )
            }
        }
    }

    private fun abandonAudioFocus() {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
                audioFocusRequest = null
            } else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(audioFocusChangeListener)
            }
        }
    }

    private fun registerNoisyReceiver() {
        if (!noisyReceiverRegistered) {
            runCatching {
                appContext.registerReceiver(noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
                noisyReceiverRegistered = true
            }
        }
    }

    private fun unregisterNoisyReceiver() {
        if (noisyReceiverRegistered) {
            runCatching { appContext.unregisterReceiver(noisyReceiver) }
            noisyReceiverRegistered = false
        }
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
