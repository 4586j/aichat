package com.qiyi.companion.ui.screens

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.prefs.GardenThemeMode
import com.qiyi.companion.ui.QiYiViewModel
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

    var baseUrl by remember { mutableStateOf(settings.baseUrl) }
    var defaultModel by remember { mutableStateOf(settings.defaultModel) }
    var apiKeyInput by remember { mutableStateOf("") }
    var clearApiKey by remember { mutableStateOf(false) }

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
                            clearApiKey = clearApiKey
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

        // Section 03: User Avatar
        SettingsCard(
            badge = "03",
            title = "我的头像",
            subtitle = "显示在对话气泡右侧"
        ) {
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

        // Section 04: Offline & Security Guarantee
        SettingsCard(
            badge = "04",
            title = "纯离线数据主权",
            subtitle = "本地 Room SQLite + Android Keystore"
        ) {
            Text(
                text = "你的所有角色设定、聊天记录与分支历史均持久化保存在手机本地 SQLite 数据库中，不经过任何第三方中转服务器；API Key 仅保存在系统级加密 Keystore 中，绝不写入数据库或导出文件。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
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
