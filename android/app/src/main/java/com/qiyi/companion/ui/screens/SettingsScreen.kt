package com.qiyi.companion.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.media.AvatarImageHelper
import com.qiyi.companion.data.prefs.GardenThemeMode
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenSealAvatar
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors

private val UserAvatarPresets = listOf("我", "🍵", "🌙", "🌿", "📚", "🖋️", "☁️", "✨")

@Composable
fun SettingsScreen(
    viewModel: QiYiViewModel,
    modifier: Modifier = Modifier
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val availableModels by viewModel.availableModels.collectAsStateWithLifecycle()
    val isFetchingModels by viewModel.isFetchingModels.collectAsStateWithLifecycle()
    val isTestingConnection by viewModel.isTestingConnection.collectAsStateWithLifecycle()

    val context = LocalContext.current
    var baseUrl by remember { mutableStateOf(settings.baseUrl) }
    var defaultModel by remember { mutableStateOf(settings.defaultModel) }
    var embeddingModel by remember { mutableStateOf(settings.embeddingModel) }
    var apiKeyInput by remember { mutableStateOf("") }
    var clearApiKey by remember { mutableStateOf(false) }
    var pendingBackupJson by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(settings.baseUrl, settings.defaultModel, settings.embeddingModel) {
        if (baseUrl.isBlank()) baseUrl = settings.baseUrl
        if (defaultModel.isBlank()) defaultModel = settings.defaultModel
        if (embeddingModel.isBlank()) embeddingModel = settings.embeddingModel
    }

    val exportBackupLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val json = pendingBackupJson
        pendingBackupJson = null
        if (uri == null || json == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { it.write(json) }
                ?: throw IllegalStateException("无法写入备份文件。")
        }.onSuccess {
            viewModel.notify("整库备份已导出（不含 API Key）。")
        }.onFailure {
            viewModel.notify(it.message ?: "导出备份失败。")
        }
    }

    val importBackupLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: throw IllegalStateException("无法读取备份文件。")
        }.onSuccess { raw ->
            viewModel.importFullBackup(raw)
        }.onFailure {
            viewModel.notify(it.message ?: "读取备份文件失败。")
        }
    }

    val userAvatarPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching { AvatarImageHelper.saveSquareAvatar(context, uri, "user_avatar") }
            .onSuccess { path -> viewModel.setUserAvatar(path) }
            .onFailure { viewModel.notify(it.message ?: "上传头像失败。") }
    }

    LaunchedEffect(settings.baseUrl, settings.defaultModel) {
        if (baseUrl.isBlank()) baseUrl = settings.baseUrl
        if (defaultModel.isBlank()) defaultModel = settings.defaultModel
    }

    val garden = LocalGardenColors.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Section 01: Model Connection
        SettingsCard(
            badge = "01",
            title = "模型连接与凭据安全",
            subtitle = "直连 OpenAI 兼容接口，API Key 仅加密存于 Android Keystore"
        ) {
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("Base URL") },
                placeholder = { Text("https://api.openai.com/v1") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = defaultModel,
                onValueChange = { defaultModel = it },
                label = { Text("默认模型 ID") },
                placeholder = { Text("例如 deepseek-chat / gpt-4o-mini / qwen-plus") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = embeddingModel,
                onValueChange = { embeddingModel = it },
                label = { Text("向量检索模型 ID（可选，用于 RRF 混合检索）") },
                placeholder = { Text("例如 text-embedding-3-small / bge-m3（留空则纯离线词法检索）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(
                    onClick = { viewModel.fetchModels(baseUrl, apiKeyInput.ifBlank { null }) },
                    enabled = !isFetchingModels
                ) {
                    Text(if (isFetchingModels) "正在获取模型列表…" else "获取可用模型")
                }
                Text(
                    text = if (settings.hasApiKey) "Keystore：已保存密钥" else "Keystore：未设置密钥",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (settings.hasApiKey) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (availableModels.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    availableModels.take(15).forEach { candidate ->
                        FilterChip(
                            selected = defaultModel == candidate,
                            onClick = { defaultModel = candidate },
                            label = { Text(candidate, maxLines = 1) }
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
            OutlinedTextField(
                value = apiKeyInput,
                onValueChange = {
                    apiKeyInput = it
                    if (it.isNotBlank()) clearApiKey = false
                },
                label = { Text(if (settings.hasApiKey) "更换 API Key（留空保持不变）" else "API Key") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            if (settings.hasApiKey) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 4.dp)
                ) {
                    Checkbox(
                        checked = clearApiKey,
                        onCheckedChange = {
                            clearApiKey = it
                            if (it) apiKeyInput = ""
                        }
                    )
                    Text(
                        text = "保存时清除已存储的 API Key",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Button(
                    onClick = {
                        viewModel.saveModelSettings(
                            baseUrl = baseUrl,
                            defaultModel = defaultModel,
                            newApiKey = apiKeyInput.ifBlank { null },
                            clearApiKey = clearApiKey,
                            embeddingModel = embeddingModel
                        )
                        apiKeyInput = ""
                        clearApiKey = false
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("保存设置")
                }
                OutlinedButton(
                    onClick = {
                        viewModel.testModelConnection(
                            baseUrl = baseUrl,
                            apiKey = apiKeyInput.ifBlank { null },
                            model = defaultModel
                        )
                    },
                    enabled = !isTestingConnection,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(if (isTestingConnection) "测试中…" else "测试连接")
                }
            }
        }

        // Section 02: Classical Garden 3 Themes
        SettingsCard(
            badge = "02",
            title = "古典园林主题",
            subtitle = "全量主题令牌驱动，夜雨模式无刺眼白底"
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                GardenThemeMode.entries.forEach { mode ->
                    val selected = settings.themeMode == mode
                    val (bgSwatch, accentSwatch) = when (mode) {
                        GardenThemeMode.SPRING -> Color(0xFFF4EFE4) to Color(0xFF2E5E4E)
                        GardenThemeMode.AUTUMN -> Color(0xFFF5E9D6) to Color(0xFF8C462B)
                        GardenThemeMode.NIGHT -> Color(0xFF161D1E) to Color(0xFF69B8AE)
                    }
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.setThemeMode(mode) },
                        shape = RoundedCornerShape(12.dp),
                        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.background,
                        border = BorderStroke(
                            if (selected) 1.5.dp else 0.8.dp,
                            if (selected) MaterialTheme.colorScheme.primary else garden.subtleBorder
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(28.dp)
                                    .clip(CircleShape)
                                    .background(bgSwatch)
                                    .border(2.dp, accentSwatch, CircleShape)
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = mode.label,
                                    style = MaterialTheme.typography.titleSmall,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    text = mode.subtitle,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (selected) {
                                Text(
                                    text = "使用中",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    }
                }
            }
        }

        // Section 03: User Avatar (Local Image Upload + Emoji / Custom Text)
        SettingsCard(
            badge = "03",
            title = "我的头像",
            subtitle = "支持从手机相册上传自定义图片，或选择印章文字/图标"
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                GardenSealAvatar(
                    label = settings.userAvatar.ifBlank { "我" },
                    size = 52.dp,
                    isUser = true
                )
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GardenWindowButton(
                            text = "上传本地头像",
                            primary = true,
                            onClick = { userAvatarPicker.launch("image/*") }
                        )
                        if (AvatarImageHelper.isImageAvatar(settings.userAvatar)) {
                            GardenWindowButton(
                                text = "改回文字",
                                onClick = { viewModel.setUserAvatar("我") }
                            )
                        }
                    }
                    Text(
                        text = if (AvatarImageHelper.isImageAvatar(settings.userAvatar)) "已使用自定义相册图片" else "当前为印章文字头像",
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                UserAvatarPresets.forEach { preset ->
                    val current = settings.userAvatar.ifBlank { "我" }
                    FilterChip(
                        selected = current == preset,
                        onClick = { viewModel.setUserAvatar(preset) },
                        label = { Text(preset) }
                    )
                }
            }
        }

        // Section 04: Zero-Secret Full Backup & Restore
        SettingsCard(
            badge = "04",
            title = "本地整库备份与恢复",
            subtitle = "换机迁移必备 · 严禁包含任何 API Key"
        ) {
            Text(
                text = "导出或恢复本地所有角色、单聊/群聊记录、知识库文档与长期记忆。API Key 仅保留在系统 Keystore 中，绝不写入任何备份文件。",
                style = MaterialTheme.typography.bodySmall,
                color = garden.muted
            )
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                GardenWindowButton(
                    text = "导出整库备份",
                    primary = true,
                    onClick = {
                        viewModel.exportFullBackup { fileName, json ->
                            pendingBackupJson = json
                            exportBackupLauncher.launch(fileName)
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
                GardenWindowButton(
                    text = "导入备份恢复",
                    onClick = { importBackupLauncher.launch(arrayOf("application/json", "text/plain", "*/*")) },
                    modifier = Modifier.weight(1f)
                )
            }
        }
        // Section 05: Optional Compatible Music Service
        var musicBaseUrl by remember(settings.musicBaseUrl) { mutableStateOf(settings.musicBaseUrl) }
        var musicSource by remember(settings.musicSource) { mutableStateOf(settings.musicSource) }
        var musicKeyInput by remember { mutableStateOf("") }
        var clearMusicKey by remember { mutableStateOf(false) }

        SettingsCard(
            badge = "05",
            title = "音乐服务配置（可选）",
            subtitle = "不填则纯离线播放本地曲库；填写兼容音乐 API 地址可在线搜歌"
        ) {
            OutlinedTextField(
                value = musicBaseUrl,
                onValueChange = { musicBaseUrl = it },
                label = { Text("音乐服务 Base URL") },
                placeholder = { Text("例如 http://192.168.1.10:3000") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("local" to "仅本地", "netease" to "网易源", "qq" to "QQ源").forEach { (key, label) ->
                    FilterChip(
                        selected = musicSource == key,
                        onClick = { musicSource = key },
                        label = { Text(label) }
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = musicKeyInput,
                onValueChange = {
                    musicKeyInput = it
                    if (it.isNotBlank()) clearMusicKey = false
                },
                label = { Text(if (settings.hasMusicApiKey) "更换音乐服务 Key（留空保持不变）" else "音乐服务 API Key（可选）") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            if (settings.hasMusicApiKey) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = clearMusicKey,
                        onCheckedChange = {
                            clearMusicKey = it
                            if (it) musicKeyInput = ""
                        }
                    )
                    Text("保存时清除音乐服务 Key", style = MaterialTheme.typography.bodySmall, color = garden.muted)
                }
            }
            Spacer(Modifier.height(10.dp))
            GardenWindowButton(
                text = "保存音乐服务配置",
                primary = true,
                onClick = {
                    viewModel.saveMusicServiceSettings(musicBaseUrl, musicSource, musicKeyInput.ifBlank { null }, clearMusicKey)
                    musicKeyInput = ""
                    clearMusicKey = false
                },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun SettingsCard(
    badge: String,
    title: String,
    subtitle: String,
    content: @Composable () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(0.8.dp, LocalGardenColors.current.subtleBorder)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Text(
                        text = badge,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(2.dp))
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(12.dp))
            content()
        }
    }
}
