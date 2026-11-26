package com.qiyi.companion.ui.screens

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.MusicTrackEntity
import com.qiyi.companion.data.media.StickerCard
import com.qiyi.companion.data.media.StickerCatalog
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors

@Composable
fun MusicAndStickerSheet(
    viewModel: QiYiViewModel
) {
    val context = LocalContext.current
    val garden = LocalGardenColors.current
    val playback by viewModel.musicState.collectAsStateWithLifecycle()
    val localTracks by viewModel.musicTracks.collectAsStateWithLifecycle()
    val onlineResults by viewModel.onlineMusicResults.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()

    var searchQuery by remember { mutableStateOf("") }

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

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("丝竹乐坊 · 音乐与表情", style = MaterialTheme.typography.titleMedium, color = garden.ink)
            GardenWindowButton(
                text = "导入本地音频",
                primary = true,
                onClick = { audioPicker.launch(arrayOf("audio/*")) }
            )
        }

        Spacer(Modifier.height(10.dp))

        // Now Playing Card
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(10.dp),
            color = garden.paper,
            border = BorderStroke(1.dp, garden.line)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.MusicNote, contentDescription = null, tint = garden.cinnabar)
                    Spacer(Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = playback.currentTrack?.title ?: "暂未播放曲目",
                            style = MaterialTheme.typography.titleSmall,
                            color = garden.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = playback.error ?: playback.currentTrack?.artist?.ifBlank { "离线音频" } ?: "导入本地 MP3/M4A/FLAC 或对话中说「放一首…」",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (playback.error != null) garden.cinnabar else garden.muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                if (playback.durationMs > 0L) {
                    Slider(
                        value = playback.positionMs.toFloat().coerceIn(0f, playback.durationMs.toFloat()),
                        onValueChange = { viewModel.seekMusic(it.toLong()) },
                        valueRange = 0f..playback.durationMs.toFloat()
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { viewModel.playPreviousTrack() }) {
                        Icon(Icons.Default.SkipPrevious, contentDescription = "上一首", tint = garden.ink)
                    }
                    IconButton(
                        onClick = {
                            if (playback.currentTrack == null && localTracks.isNotEmpty()) {
                                viewModel.playTrack(localTracks.first())
                            } else {
                                viewModel.togglePlayPause()
                            }
                        }
                    ) {
                        Icon(
                            imageVector = if (playback.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (playback.isPlaying) "暂停" else "播放",
                            tint = garden.cinnabar,
                            modifier = Modifier.size(30.dp)
                        )
                    }
                    IconButton(onClick = { viewModel.playNextTrack() }) {
                        Icon(Icons.Default.SkipNext, contentDescription = "下一首", tint = garden.ink)
                    }
                    IconButton(onClick = { viewModel.toggleLoopSingle() }) {
                        Icon(
                            imageVector = if (playback.loopSingle) Icons.Default.RepeatOne else Icons.Default.Repeat,
                            contentDescription = "循环模式",
                            tint = if (playback.loopSingle) garden.bamboo else garden.muted
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))

        // Search bar (local + optional remote music service)
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
                        if (settings.musicBaseUrl.isNotBlank()) "搜本地曲库或在线歌曲…" else "搜索本地曲库（可在设置配置在线乐库）",
                        maxLines = 1
                    )
                },
                singleLine = true,
                modifier = Modifier.weight(1f)
            )
            GardenWindowButton(
                text = "搜歌",
                onClick = { viewModel.searchMusic(searchQuery) }
            )
        }

        Spacer(Modifier.height(10.dp))

        // Track list
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .height(210.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (onlineResults.isNotEmpty()) {
                item(key = "online_hdr") {
                    Text("在线搜索结果", style = MaterialTheme.typography.labelSmall, color = garden.bamboo)
                }
                items(onlineResults, key = { it.id }) { track ->
                    TrackRow(
                        track = track,
                        isPlaying = playback.currentTrack?.id == track.id && playback.isPlaying,
                        onPlay = { viewModel.playTrack(track) },
                        onDelete = null
                    )
                }
            }

            item(key = "local_hdr") {
                Text("本地曲库（${localTracks.size} 首）", style = MaterialTheme.typography.labelSmall, color = garden.muted)
            }
            if (localTracks.isEmpty()) {
                item(key = "empty_tracks") {
                    Text(
                        text = "曲库为空，点击右上角「导入本地音频」添加手机里的音乐文件。",
                        style = MaterialTheme.typography.bodySmall,
                        color = garden.muted,
                        modifier = Modifier.padding(vertical = 8.dp)
                    )
                }
            } else {
                items(localTracks, key = { it.id }) { track ->
                    TrackRow(
                        track = track,
                        isPlaying = playback.currentTrack?.id == track.id && playback.isPlaying,
                        onPlay = { viewModel.playTrack(track) },
                        onDelete = { viewModel.deleteTrack(track) }
                    )
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = garden.lineSoft)
        Spacer(Modifier.height(8.dp))

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
                StickerCard(sticker = sticker, size = 60.dp)
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun TrackRow(
    track: MusicTrackEntity,
    isPlaying: Boolean,
    onPlay: () -> Unit,
    onDelete: (() -> Unit)?
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onPlay),
        shape = RoundedCornerShape(8.dp),
        color = if (isPlaying) garden.bambooSoft else garden.paper,
        border = BorderStroke(0.8.dp, if (isPlaying) garden.bamboo else garden.lineSoft)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = null,
                tint = if (isPlaying) garden.cinnabar else garden.bamboo,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (isPlaying) FontWeight.SemiBold else FontWeight.Normal,
                    color = garden.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${track.artist.ifBlank { "未知歌手" }} · ${track.source}",
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted
                )
            }
            if (onDelete != null) {
                IconButton(onClick = onDelete, modifier = Modifier.size(30.dp)) {
                    Icon(Icons.Default.DeleteOutline, contentDescription = "移除", tint = garden.cinnabar, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}
