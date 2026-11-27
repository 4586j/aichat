package com.qiyi.companion.ui.screens

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.QueuePlayNext
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.MusicTrackEntity
import com.qiyi.companion.data.media.MusicPlayMode
import com.qiyi.companion.data.media.MusicSearchSource
import com.qiyi.companion.data.media.StickerCard
import com.qiyi.companion.data.media.StickerCatalog
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.IosSquircleShape
import com.qiyi.companion.ui.theme.LiquidGlassSegmentedControl
import com.qiyi.companion.ui.theme.LiquidGlassSurface
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.util.Locale

@Composable
fun MusicAndStickerSheet(
    viewModel: QiYiViewModel
) {
    val context = LocalContext.current
    val garden = LocalGardenColors.current
    val playback by viewModel.musicState.collectAsStateWithLifecycle()
    val libraryTracks by viewModel.musicTracks.collectAsStateWithLifecycle()
    val onlineResults by viewModel.onlineMusicResults.collectAsStateWithLifecycle()
    val searchSource by viewModel.musicSearchSource.collectAsStateWithLifecycle()
    val isSearching by viewModel.isSearchingMusic.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()

    val favoriteTracks = remember(libraryTracks) { libraryTracks.filter { it.isFavorite } }
    val favoriteIds = remember(favoriteTracks) { favoriteTracks.map { it.id }.toSet() }
    val localImportedTracks = remember(libraryTracks) { libraryTracks.filter { it.localPath.isNotBlank() } }

    // 0 = 搜歌, 1 = 播放队列, 2 = 我喜欢, 3 = 本地曲库
    var activeTab by rememberSaveable { mutableIntStateOf(0) }
    var searchQuery by rememberSaveable { mutableStateOf("") }

    val audioPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            var displayName = "本地音乐.mp3"
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) displayName = cursor.getString(idx) ?: displayName
                }
            }
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw IllegalStateException("无法读取音频文件。")
            displayName to bytes
        }.onSuccess { (name, bytes) ->
            viewModel.importLocalAudio(name, bytes)
        }.onFailure {
            viewModel.notify(it.message ?: "导入音频失败。")
        }
    }

    val currentTrack = playback.currentTrack
    val currentIsFav = currentTrack != null && (currentTrack.isFavorite || currentTrack.id in favoriteIds)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "丝竹乐坊 · 音乐与表情",
                    fontFamily = FontFamily.Serif,
                    fontWeight = FontWeight.Bold,
                    fontSize = 17.sp,
                    color = garden.ink
                )
                Text(
                    text = "支持队列 · 喜欢收藏 · 系统状态栏播控",
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted
                )
            }
            GardenWindowButton(
                text = "导入音频",
                primary = true,
                onClick = { audioPicker.launch(arrayOf("audio/*")) }
            )
        }

        Spacer(Modifier.height(10.dp))

        // 1. Now Playing iOS-Squircle Card
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = IosSquircleShape(22.dp),
            color = garden.paper,
            border = BorderStroke(0.75.dp, garden.lineSoft)
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(IosSquircleShape(12.dp))
                            .background(garden.cinnabarSoft),
                        contentAlignment = Alignment.Center
                    ) {
                        if (playback.isBuffering) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = garden.cinnabar
                            )
                        } else {
                            Icon(
                                Icons.Default.MusicNote,
                                contentDescription = null,
                                tint = garden.cinnabar,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = currentTrack?.title ?: "暂未播放曲目",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = garden.ink,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false)
                            )
                            if (currentTrack != null) {
                                GardenTagPill(
                                    text = sourceDisplayLabel(currentTrack.source),
                                    accent = garden.bamboo,
                                    background = garden.bambooSoft
                                )
                            }
                        }
                        Text(
                            text = when {
                                playback.error != null -> playback.error!!
                                playback.isBuffering -> "正在缓冲音频流…"
                                currentTrack != null -> currentTrack.artist.ifBlank { "未知歌手" }
                                else -> "搜歌点播、导入本地音频或在对话中说「放一首…」"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (playback.error != null) garden.cinnabar else garden.muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    if (currentTrack != null) {
                        IconButton(
                            onClick = { viewModel.toggleFavoriteTrack(currentTrack) },
                            modifier = Modifier.size(34.dp)
                        ) {
                            Icon(
                                imageVector = if (currentIsFav) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                contentDescription = if (currentIsFav) "取消喜欢" else "喜欢",
                                tint = if (currentIsFav) garden.cinnabar else garden.muted,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }

                if (playback.durationMs > 0L) {
                    Spacer(Modifier.height(4.dp))
                    Slider(
                        value = playback.positionMs.toFloat().coerceIn(0f, playback.durationMs.toFloat()),
                        onValueChange = { viewModel.seekMusic(it.toLong()) },
                        valueRange = 0f..playback.durationMs.toFloat(),
                        modifier = Modifier.height(26.dp)
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = formatMusicTime(playback.positionMs),
                            fontSize = 10.5.sp,
                            color = garden.muted
                        )
                        Text(
                            text = formatMusicTime(playback.durationMs),
                            fontSize = 10.5.sp,
                            color = garden.muted
                        )
                    }
                }

                Spacer(Modifier.height(4.dp))

                // Transport Controls Row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { viewModel.cyclePlayMode() }) {
                        Icon(
                            imageVector = when (playback.playMode) {
                                MusicPlayMode.SEQUENCE -> Icons.Default.Repeat
                                MusicPlayMode.REPEAT_ONE -> Icons.Default.RepeatOne
                                MusicPlayMode.SHUFFLE -> Icons.Default.Shuffle
                            },
                            contentDescription = playback.playMode.label,
                            tint = if (playback.playMode == MusicPlayMode.SEQUENCE) garden.muted else garden.bamboo
                        )
                    }
                    IconButton(onClick = { viewModel.playPreviousTrack() }) {
                        Icon(Icons.Default.SkipPrevious, contentDescription = "上一首", tint = garden.ink)
                    }
                    LiquidGlassSurface(
                        modifier = Modifier.size(44.dp),
                        shape = CircleShape,
                        tinted = true,
                        accentColor = garden.cinnabar,
                        elevation = 3.dp,
                        onClick = {
                            if (currentTrack == null && libraryTracks.isNotEmpty()) {
                                viewModel.playTrack(libraryTracks.first())
                            } else {
                                viewModel.togglePlayPause()
                            }
                        }
                    ) {
                        Icon(
                            imageVector = if (playback.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (playback.isPlaying) "暂停" else "播放",
                            tint = garden.paperCard,
                            modifier = Modifier.size(26.dp)
                        )
                    }
                    IconButton(onClick = { viewModel.playNextTrack() }) {
                        Icon(Icons.Default.SkipNext, contentDescription = "下一首", tint = garden.ink)
                    }
                    TextButton(
                        onClick = { activeTab = 1 },
                        modifier = Modifier.height(32.dp)
                    ) {
                        Text(
                            text = "队列 ${playback.queue.size}",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.bamboo,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))

        // 2. Liquid Glass 4-Tab Selector (搜歌 | 队列 | 喜欢 | 曲库)
        LiquidGlassSegmentedControl(
            labels = listOf("搜歌", "队列(${playback.queue.size})", "喜欢(${favoriteTracks.size})", "本地(${localImportedTracks.size})"),
            selectedIndex = activeTab,
            onSelect = { activeTab = it },
            height = 36.dp,
            fontSize = 11.5.sp,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(Modifier.height(10.dp))

        // 3. Tab Body
        when (activeTab) {
            0 -> {
                // Direct Source Switcher right inside Search UI (no need to go to Settings!)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("音源：", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                    MusicSearchSource.entries.forEach { src ->
                        val selected = searchSource == src
                        Surface(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .clickable { viewModel.selectMusicSearchSource(src, searchQuery) },
                            shape = RoundedCornerShape(999.dp),
                            color = if (selected) garden.bamboo else garden.paper,
                            border = BorderStroke(0.8.dp, if (selected) garden.bamboo else garden.lineSoft)
                        ) {
                            Text(
                                text = src.label,
                                fontSize = 11.5.sp,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (selected) garden.paperCard else garden.ink,
                                modifier = Modifier.padding(horizontal = 11.dp, vertical = 5.dp)
                            )
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        placeholder = {
                            Text(
                                if (settings.musicBaseUrl.isNotBlank()) "输入歌名/歌手（当前：${searchSource.label}）" else "请先在「设置」填写音乐服务地址",
                                maxLines = 1
                            )
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.weight(1f)
                    )
                    GardenWindowButton(
                        text = if (isSearching) "搜索中" else "搜歌",
                        primary = true,
                        enabled = !isSearching,
                        onClick = { viewModel.searchMusic(searchQuery) }
                    )
                }

                Spacer(Modifier.height(8.dp))

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(230.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (isSearching) {
                        item(key = "searching") {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 16.dp),
                                horizontalArrangement = Arrangement.Center,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = garden.bamboo)
                                Spacer(Modifier.width(8.dp))
                                Text("正在检索「${searchSource.label}」…", style = MaterialTheme.typography.bodySmall, color = garden.muted)
                            }
                        }
                    } else if (onlineResults.isEmpty()) {
                        item(key = "search_empty") {
                            Text(
                                text = if (settings.musicBaseUrl.isBlank()) {
                                    "尚未配置在线音乐服务地址，可先到「设置」填写，或切到「本地」导入音频。"
                                } else {
                                    "输入歌名点击「搜歌」，或直接点上方「服务器」浏览服务器已有曲库。"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = garden.muted,
                                modifier = Modifier.padding(vertical = 12.dp)
                            )
                        }
                    } else {
                        items(onlineResults, key = { it.id }) { track ->
                            TrackRow(
                                track = track,
                                isPlaying = currentTrack?.id == track.id && playback.isPlaying,
                                isFavorite = track.isFavorite || track.id in favoriteIds,
                                onPlay = { viewModel.playTrack(track) },
                                onToggleFavorite = { viewModel.toggleFavoriteTrack(track) },
                                onPlayNext = { viewModel.enqueueNext(track) },
                                onAddToQueue = { viewModel.enqueueEnd(track) },
                                onRemove = null
                            )
                        }
                    }
                }
            }

            1 -> {
                // Play Queue Tab
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "当前播放队列（${playback.playMode.label}）",
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted
                    )
                    if (playback.queue.isNotEmpty()) {
                        TextButton(onClick = { viewModel.clearPlayQueue() }, modifier = Modifier.height(28.dp)) {
                            Text("清空队列", style = MaterialTheme.typography.labelSmall, color = garden.cinnabar)
                        }
                    }
                }
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(250.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (playback.queue.isEmpty()) {
                        item(key = "queue_empty") {
                            Text(
                                text = "播放队列为空，去「搜歌」或「喜欢」点击任意歌曲即可加入队列。",
                                style = MaterialTheme.typography.bodySmall,
                                color = garden.muted,
                                modifier = Modifier.padding(vertical = 14.dp)
                            )
                        }
                    } else {
                        itemsIndexed(playback.queue, key = { idx, t -> "${t.id}_$idx" }) { idx, track ->
                            TrackRow(
                                track = track,
                                isPlaying = idx == playback.currentIndex && playback.isPlaying,
                                isActiveInQueue = idx == playback.currentIndex,
                                isFavorite = track.isFavorite || track.id in favoriteIds,
                                onPlay = { viewModel.playQueueIndex(idx) },
                                onToggleFavorite = { viewModel.toggleFavoriteTrack(track) },
                                onPlayNext = null,
                                onAddToQueue = null,
                                onRemove = { viewModel.removeFromQueue(idx) }
                            )
                        }
                    }
                }
            }

            2 -> {
                // Favorites Tab
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("我喜欢的歌曲（${favoriteTracks.size} 首）", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                    if (favoriteTracks.isNotEmpty()) {
                        TextButton(
                            onClick = { viewModel.replaceQueueAndPlay(favoriteTracks, 0) },
                            modifier = Modifier.height(28.dp)
                        ) {
                            Text("播放全部", style = MaterialTheme.typography.labelSmall, color = garden.bamboo)
                        }
                    }
                }
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(250.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (favoriteTracks.isEmpty()) {
                        item(key = "fav_empty") {
                            Text(
                                text = "还没有喜欢的歌曲，点击歌曲右侧的 ♥ 即可收藏到这里随时重听。",
                                style = MaterialTheme.typography.bodySmall,
                                color = garden.muted,
                                modifier = Modifier.padding(vertical = 14.dp)
                            )
                        }
                    } else {
                        items(favoriteTracks, key = { it.id }) { track ->
                            TrackRow(
                                track = track,
                                isPlaying = currentTrack?.id == track.id && playback.isPlaying,
                                isFavorite = true,
                                onPlay = { viewModel.playTrack(track) },
                                onToggleFavorite = { viewModel.toggleFavoriteTrack(track) },
                                onPlayNext = { viewModel.enqueueNext(track) },
                                onAddToQueue = { viewModel.enqueueEnd(track) },
                                onRemove = null
                            )
                        }
                    }
                }
            }

            else -> {
                // Local Imported Library Tab
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("手机本地导入曲库（${localImportedTracks.size} 首）", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                    if (localImportedTracks.isNotEmpty()) {
                        TextButton(
                            onClick = { viewModel.replaceQueueAndPlay(localImportedTracks, 0) },
                            modifier = Modifier.height(28.dp)
                        ) {
                            Text("播放全部", style = MaterialTheme.typography.labelSmall, color = garden.bamboo)
                        }
                    }
                }
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(250.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (localImportedTracks.isEmpty()) {
                        item(key = "local_empty") {
                            Text(
                                text = "本地曲库为空，点击右上角「导入音频」添加手机里的 MP3/M4A/FLAC 文件。",
                                style = MaterialTheme.typography.bodySmall,
                                color = garden.muted,
                                modifier = Modifier.padding(vertical = 14.dp)
                            )
                        }
                    } else {
                        items(localImportedTracks, key = { it.id }) { track ->
                            TrackRow(
                                track = track,
                                isPlaying = currentTrack?.id == track.id && playback.isPlaying,
                                isFavorite = track.isFavorite || track.id in favoriteIds,
                                onPlay = { viewModel.playTrack(track) },
                                onToggleFavorite = { viewModel.toggleFavoriteTrack(track) },
                                onPlayNext = { viewModel.enqueueNext(track) },
                                onAddToQueue = { viewModel.enqueueEnd(track) },
                                onRemove = { viewModel.deleteTrack(track) }
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        HorizontalDivider(color = garden.lineSoft)
        Spacer(Modifier.height(6.dp))

        // Built-in 6 Xiaoye Stickers Preview
        Text("内置表情包 · 小叶（回复联动自动匹配）", style = MaterialTheme.typography.labelSmall, color = garden.muted)
        Spacer(Modifier.height(6.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            StickerCatalog.all.forEach { sticker ->
                StickerCard(sticker = sticker, size = 54.dp)
            }
        }
        Spacer(Modifier.height(14.dp))
    }
}

@Composable
private fun TrackRow(
    track: MusicTrackEntity,
    isPlaying: Boolean,
    isFavorite: Boolean,
    onPlay: () -> Unit,
    onToggleFavorite: () -> Unit,
    onPlayNext: (() -> Unit)?,
    onAddToQueue: (() -> Unit)?,
    onRemove: (() -> Unit)?,
    isActiveInQueue: Boolean = isPlaying
) {
    val garden = LocalGardenColors.current
    val shape = remember { IosSquircleShape(14.dp) }
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .clickable(onClick = onPlay),
        shape = shape,
        color = if (isActiveInQueue) garden.bambooSoft else garden.paper,
        border = BorderStroke(0.75.dp, if (isActiveInQueue) garden.bamboo else garden.lineSoft)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = null,
                tint = if (isActiveInQueue) garden.cinnabar else garden.bamboo,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (isActiveInQueue) FontWeight.SemiBold else FontWeight.Normal,
                    color = garden.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${track.artist.ifBlank { "未知歌手" }} · ${sourceDisplayLabel(track.source)}",
                    fontSize = 10.5.sp,
                    color = garden.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (onPlayNext != null) {
                IconButton(onClick = onPlayNext, modifier = Modifier.size(28.dp)) {
                    Icon(
                        Icons.Default.QueuePlayNext,
                        contentDescription = "下一首播放",
                        tint = garden.bamboo,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
            if (onAddToQueue != null) {
                IconButton(onClick = onAddToQueue, modifier = Modifier.size(28.dp)) {
                    Icon(
                        Icons.AutoMirrored.Filled.PlaylistAdd,
                        contentDescription = "加入队列",
                        tint = garden.muted,
                        modifier = Modifier.size(17.dp)
                    )
                }
            }
            IconButton(onClick = onToggleFavorite, modifier = Modifier.size(28.dp)) {
                Icon(
                    imageVector = if (isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                    contentDescription = if (isFavorite) "取消喜欢" else "喜欢",
                    tint = if (isFavorite) garden.cinnabar else garden.muted,
                    modifier = Modifier.size(16.dp)
                )
            }
            if (onRemove != null) {
                IconButton(onClick = onRemove, modifier = Modifier.size(28.dp)) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "移除",
                        tint = garden.cinnabar.copy(alpha = 0.85f),
                        modifier = Modifier.size(15.dp)
                    )
                }
            }
        }
    }
}

private fun sourceDisplayLabel(source: String): String = when (source.lowercase(Locale.US)) {
    "qq" -> "QQ音乐"
    "netease" -> "网易云"
    "server" -> "服务器"
    else -> "本地"
}

private fun formatMusicTime(ms: Long): String {
    val totalSec = (ms / 1000L).coerceAtLeast(0L)
    val min = totalSec / 60L
    val sec = totalSec % 60L
    return String.format(Locale.US, "%02d:%02d", min, sec)
}
