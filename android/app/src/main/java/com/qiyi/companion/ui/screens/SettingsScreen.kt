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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.media.AvatarImageHelper
import com.qiyi.companion.data.prefs.GardenThemeMode
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenSealAvatar
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors

private val UserAvatarPresets = listOf("我", "🍵", "🌙", "🌿", "📚", "🖋️", "☁️", "✨")
private val SettingsWindowPresets = listOf(
    0 to "自动",
    32_000 to "32K",
    64_000 to "64K",
    128_000 to "128K",
    200_000 to "200K",
    1_000_000 to "1M"
)

@Composable
fun SettingsScreen(
    viewModel: QiYiViewModel,
    modifier: Modifier = Modifier
) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val availableModels by viewModel.availableModels.collectAsStateWithLifecycle()
    val isFetchingModels by viewModel.isFetchingModels.collectAsStateWithLifecycle()
    val isTestingConnection by viewModel.isTestingConnection.collectAsStateWithLifecycle()
    val personas by viewModel.personas.collectAsStateWithLifecycle()
    val conversations by viewModel.allConversations.collectAsStateWithLifecycle()
    val docs by viewModel.knowledgeDocuments.collectAsStateWithLifecycle()
    val memories by viewModel.memories.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val garden = LocalGardenColors.current

    // 0 = 我的 (Profile, Theme, Local Data & Backup), 1 = 设置 (Model, Music, Chat Preferences)
    var subTab by rememberSaveable { mutableIntStateOf(0) }

    var baseUrl by remember { mutableStateOf(settings.baseUrl) }
    var defaultModel by remember { mutableStateOf(settings.defaultModel) }
    var embeddingModel by remember { mutableStateOf(settings.embeddingModel) }
    var apiKeyInput by remember { mutableStateOf("") }
    var clearApiKey by remember { mutableStateOf(false) }
    var pendingBackupJson by remember { mutableStateOf<String?>(null) }

    var musicBaseUrl by remember(settings.musicBaseUrl) { mutableStateOf(settings.musicBaseUrl) }
    var musicSource by remember(settings.musicSource) { mutableStateOf(settings.musicSource) }
    var musicKeyInput by remember { mutableStateOf("") }
    var clearMusicKey by remember { mutableStateOf(false) }

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

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(garden.paper)
    ) {
        // Smooth Pill Segmented Control: 「我的」 vs 「设置」
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .height(42.dp),
            shape = RoundedCornerShape(999.dp),
            color = garden.paperDeep.copy(alpha = 0.78f),
            border = BorderStroke(0.6.dp, garden.lineSoft)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                SettingsSegmentPill(
                    label = "我的",
                    icon = Icons.Default.Person,
                    selected = subTab == 0,
                    onClick = { subTab = 0 },
                    modifier = Modifier.weight(1f)
                )
                SettingsSegmentPill(
                    label = "设置",
                    icon = Icons.Default.Tune,
                    selected = subTab == 1,
                    onClick = { subTab = 1 },
                    modifier = Modifier.weight(1f)
                )
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 14.dp, end = 14.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            if (subTab == 0) {
                // =========================================================
                // 「我的」: 个人主页、头像、园林外观与本地数据管理
                // =========================================================
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                    color = garden.paperCard,
                    shadowElevation = 1.dp,
                    border = BorderStroke(0.7.dp, garden.lineSoft)
                ) {
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            GardenSealAvatar(
                                label = settings.userAvatar.ifBlank { "我" },
                                size = 62.dp,
                                isUser = true
                            )
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        text = "我的栖忆",
                                        fontFamily = FontFamily.Serif,
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = garden.ink
                                    )
                                    GardenTagPill(
                                        text = "本地优先",
                                        accent = garden.bamboo,
                                        background = garden.bambooSoft
                                    )
                                }
                                Text(
                                    text = if (AvatarImageHelper.isImageAvatar(settings.userAvatar)) {
                                        "自定义相册头像 · 所有数据仅存本机"
                                    } else {
                                        "印章文字头像 · 所有数据仅存本机"
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = garden.muted
                                )
                            }
                        }

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

                        // Quick Avatar Presets
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            UserAvatarPresets.forEach { preset ->
                                val current = settings.userAvatar.ifBlank { "我" }
                                val selected = current == preset
                                Surface(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(999.dp))
                                        .clickable { viewModel.setUserAvatar(preset) },
                                    shape = RoundedCornerShape(999.dp),
                                    color = if (selected) garden.bambooSoft else garden.paper,
                                    border = BorderStroke(
                                        0.8.dp,
                                        if (selected) garden.bamboo else garden.lineSoft
                                    )
                                ) {
                                    Text(
                                        text = preset,
                                        style = MaterialTheme.typography.labelMedium,
                                        color = if (selected) garden.bamboo else garden.ink,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                    )
                                }
                            }
                        }

                        HorizontalDivider(color = garden.lineSoft)

                        // Local Personal Stats Grid
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            ProfileStatBubble("角色", personas.size.toString(), Modifier.weight(1f))
                            ProfileStatBubble("会话", conversations.size.toString(), Modifier.weight(1f))
                            ProfileStatBubble("书阁", docs.size.toString(), Modifier.weight(1f))
                            ProfileStatBubble("记忆", memories.size.toString(), Modifier.weight(1f))
                        }
                    }
                }

                // Classical Garden 3 Themes
                SettingsCard(
                    badge = "外观",
                    title = "古典园林主题",
                    subtitle = "柔和令牌驱动，夜雨模式护眼无刺眼白底"
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
                                    .clip(RoundedCornerShape(16.dp))
                                    .clickable { viewModel.setThemeMode(mode) },
                                shape = RoundedCornerShape(16.dp),
                                color = if (selected) garden.bambooSoft else garden.paper,
                                border = BorderStroke(
                                    if (selected) 1.3.dp else 0.7.dp,
                                    if (selected) garden.bamboo else garden.lineSoft
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
                                            fontWeight = FontWeight.SemiBold,
                                            color = garden.ink
                                        )
                                        Text(
                                            text = mode.subtitle,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = garden.muted
                                        )
                                    }
                                    if (selected) {
                                        GardenTagPill(
                                            text = "使用中",
                                            accent = garden.bamboo,
                                            background = garden.paperCard
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // Zero-Secret Full Backup & Restore
                SettingsCard(
                    badge = "数据",
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
            } else {
                // =========================================================
                // 「设置」: 模型连接、音乐服务、对话联动与上下文偏好
                // =========================================================
                SettingsCard(
                    badge = "01",
                    title = "模型连接与凭据安全",
                    subtitle = "直连 OpenAI 兼容接口，API Key 仅加密存于 Android Keystore"
                ) {
                    val fieldShape = RoundedCornerShape(14.dp)
                    OutlinedTextField(
                        value = baseUrl,
                        onValueChange = { baseUrl = it },
                        label = { Text("Base URL") },
                        placeholder = { Text("https://api.openai.com/v1") },
                        singleLine = true,
                        shape = fieldShape,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = defaultModel,
                        onValueChange = { defaultModel = it },
                        label = { Text("默认模型 ID") },
                        placeholder = { Text("例如 deepseek-chat / gpt-4o-mini / qwen-plus") },
                        singleLine = true,
                        shape = fieldShape,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = embeddingModel,
                        onValueChange = { embeddingModel = it },
                        label = { Text("向量检索模型 ID（可选，用于 RRF 混合检索）") },
                        placeholder = { Text("例如 text-embedding-3-small / bge-m3（留空则纯离线词法检索）") },
                        singleLine = true,
                        shape = fieldShape,
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
                            color = if (settings.hasApiKey) garden.bamboo else garden.muted
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
                                    shape = RoundedCornerShape(999.dp),
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
                        shape = fieldShape,
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
                                color = garden.muted
                            )
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        GardenWindowButton(
                            text = "保存设置",
                            primary = true,
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
                        )
                        GardenWindowButton(
                            text = if (isTestingConnection) "测试中…" else "测试连接",
                            enabled = !isTestingConnection,
                            onClick = {
                                viewModel.testModelConnection(
                                    baseUrl = baseUrl,
                                    apiKey = apiKeyInput.ifBlank { null },
                                    model = defaultModel
                                )
                            },
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                // Section 02: Optional Compatible Music Service
                SettingsCard(
                    badge = "02",
                    title = "音乐服务配置（可选）",
                    subtitle = "不填则纯离线播放本地曲库；填写兼容音乐 API 地址可在线搜歌"
                ) {
                    val fieldShape = RoundedCornerShape(14.dp)
                    OutlinedTextField(
                        value = musicBaseUrl,
                        onValueChange = { musicBaseUrl = it },
                        label = { Text("音乐服务 Base URL") },
                        placeholder = { Text("例如 https://123.60.216.193/qiyi-music") },
                        singleLine = true,
                        shape = fieldShape,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("local" to "仅本地", "netease" to "网易源", "qq" to "QQ源").forEach { (key, label) ->
                            val selected = musicSource == key
                            Surface(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .clickable { musicSource = key },
                                shape = RoundedCornerShape(999.dp),
                                color = if (selected) garden.bamboo else garden.paper,
                                border = BorderStroke(0.8.dp, if (selected) garden.bamboo else garden.lineSoft)
                            ) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (selected) garden.paperCard else garden.ink,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = musicKeyInput,
                        onValueChange = {
                            musicKeyInput = it
                            if (it.isNotBlank()) clearMusicKey = false
                        },
                        label = { Text(if (settings.hasMusicApiKey) "更换音乐服务 Key（留空保持不变）" else "音乐服务 API Key（可选）") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        shape = fieldShape,
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

                // Section 03: Conversation Linkage & Context Preferences
                SettingsCard(
                    badge = "03",
                    title = "对话与上下文偏好",
                    subtitle = "管理回复联动开关与默认上下文窗口上限"
                ) {
                    SettingsToggleRow(
                        title = "音乐点播联动",
                        subtitle = "说「放一首…」自动检索并播放曲库",
                        checked = settings.musicEnabled,
                        onCheckedChange = { viewModel.setLinkageFlags(musicEnabled = it) }
                    )
                    HorizontalDivider(color = garden.lineSoft, modifier = Modifier.padding(vertical = 6.dp))
                    SettingsToggleRow(
                        title = "「小叶」表情包联动",
                        subtitle = "按回复语气自然附带原创矢量表情",
                        checked = settings.stickerEnabled,
                        onCheckedChange = { viewModel.setLinkageFlags(stickerEnabled = it) }
                    )
                    HorizontalDivider(color = garden.lineSoft, modifier = Modifier.padding(vertical = 6.dp))
                    SettingsToggleRow(
                        title = "智能工具调用 (ReAct)",
                        subtitle = "自动启用计算器、统计、日期与知识深搜",
                        checked = settings.toolsEnabled,
                        onCheckedChange = { viewModel.setLinkageFlags(toolsEnabled = it) }
                    )
                    HorizontalDivider(color = garden.lineSoft, modifier = Modifier.padding(vertical = 10.dp))
                    Text(
                        text = "默认上下文窗口上限",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = garden.ink
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        SettingsWindowPresets.forEach { (limitVal, label) ->
                            val selected = settings.contextWindowOverride == limitVal
                            Surface(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .clickable { viewModel.setContextWindowOverride(limitVal) },
                                shape = RoundedCornerShape(999.dp),
                                color = if (selected) garden.bamboo else garden.paper,
                                border = BorderStroke(0.8.dp, if (selected) garden.bamboo else garden.lineSoft)
                            ) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (selected) garden.paperCard else garden.ink,
                                    modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsSegmentPill(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = modifier
            .fillMaxHeight()
            .clip(RoundedCornerShape(999.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(999.dp),
        color = if (selected) garden.bamboo else Color.Transparent,
        shadowElevation = if (selected) 1.5.dp else 0.dp
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (selected) garden.paperCard else garden.muted,
                modifier = Modifier.size(16.dp)
            )
            Spacer(Modifier.width(5.dp))
            Text(
                text = label,
                fontFamily = FontFamily.Serif,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                fontSize = 14.sp,
                color = if (selected) garden.paperCard else garden.muted
            )
        }
    }
}

@Composable
private fun ProfileStatBubble(
    label: String,
    value: String,
    modifier: Modifier = Modifier
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = garden.paper,
        border = BorderStroke(0.6.dp, garden.lineSoft)
    ) {
        Column(
            modifier = Modifier.padding(vertical = 8.dp, horizontal = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = value,
                fontFamily = FontFamily.Serif,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = garden.bamboo
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = garden.muted
            )
        }
    }
}

@Composable
private fun SettingsToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    val garden = LocalGardenColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = garden.ink, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = garden.muted)
        }
        Spacer(Modifier.width(10.dp))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun SettingsCard(
    badge: String,
    title: String,
    subtitle: String,
    content: @Composable () -> Unit
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = garden.paperCard,
        shadowElevation = 0.8.dp,
        border = BorderStroke(0.7.dp, garden.lineSoft)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = garden.bambooSoft
                ) {
                    Text(
                        text = badge,
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.bamboo,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.5.dp)
                    )
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = title,
                    fontFamily = FontFamily.Serif,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = garden.ink
                )
            }
            Spacer(Modifier.height(3.dp))
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = garden.muted
            )
            Spacer(Modifier.height(12.dp))
            content()
        }
    }
}
