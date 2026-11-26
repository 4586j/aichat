package com.qiyi.companion.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.qiyi.companion.data.db.PersonaEntity
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.LocalGardenColors

private val AvatarPresets = listOf("🌿", "🏮", "🎋", "🌙", "🍵", "📖", "🦊", "✨")

@Composable
fun PersonasScreen(
    viewModel: QiYiViewModel,
    onOpenChat: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val personas by viewModel.personas.collectAsStateWithLifecycle()
    val activePersonaId by viewModel.activePersonaId.collectAsStateWithLifecycle()
    val availableModels by viewModel.availableModels.collectAsStateWithLifecycle()
    val isFetchingModels by viewModel.isFetchingModels.collectAsStateWithLifecycle()

    var editingPersona by remember { mutableStateOf<PersonaEntity?>(null) }
    var showEditorDialog by remember { mutableStateOf(false) }
    var deletingPersona by remember { mutableStateOf<PersonaEntity?>(null) }
    var pendingExportJson by remember { mutableStateOf<String?>(null) }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: throw IllegalStateException("无法读取所选文件。")
        }.onSuccess { raw ->
            viewModel.importPersonaCard(raw)
        }.onFailure {
            viewModel.notify(it.message ?: "读取角色卡文件失败。")
        }
    }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val json = pendingExportJson
        pendingExportJson = null
        if (uri == null || json == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { it.write(json) }
                ?: throw IllegalStateException("无法写入目标文件。")
        }.onSuccess {
            viewModel.notify("角色卡已导出（与 PC 端栖忆 100% 互通）。")
        }.onFailure {
            viewModel.notify(it.message ?: "导出角色卡失败。")
        }
    }

    val garden = LocalGardenColors.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(0.5.dp, garden.subtleBorder)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text("角色人设", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        text = "支持专属模型与 PC 端 JSON 角色卡互通",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { importLauncher.launch(arrayOf("application/json", "text/plain", "*/*")) },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                    ) {
                        Icon(Icons.Default.FileUpload, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("导入")
                    }
                    Button(
                        onClick = {
                            editingPersona = null
                            showEditorDialog = true
                        },
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("新建")
                    }
                }
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(personas, key = { it.id }) { role ->
                val isCurrent = role.id == activePersonaId
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(
                        width = if (isCurrent) 1.4.dp else 0.8.dp,
                        color = if (isCurrent) MaterialTheme.colorScheme.primary else garden.subtleBorder
                    )
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AvatarBadge(avatar = role.avatar.ifBlank { "🌿" }, size = 44)
                            Spacer(Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = role.name,
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    if (isCurrent) {
                                        Spacer(Modifier.width(6.dp))
                                        Text(
                                            text = "当前",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                }
                                Text(
                                    text = role.description.ifBlank { role.tone.ifBlank { "未填写简介" } },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        Spacer(Modifier.height(10.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = MaterialTheme.colorScheme.secondaryContainer
                            ) {
                                Text(
                                    text = if (role.model.isNotBlank()) "专属模型：${role.model}" else "跟随全局默认模型",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                            if (role.tone.isNotBlank()) {
                                Text(
                                    text = role.tone,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        Spacer(Modifier.height(10.dp))
                        HorizontalDivider(color = garden.subtleBorder)
                        Spacer(Modifier.height(6.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            TextButton(
                                onClick = {
                                    viewModel.selectPersona(role.id)
                                    onOpenChat()
                                }
                            ) {
                                Icon(Icons.Default.ChatBubbleOutline, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("对话")
                            }
                            TextButton(
                                onClick = {
                                    editingPersona = role
                                    showEditorDialog = true
                                }
                            ) {
                                Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("编辑")
                            }
                            TextButton(
                                onClick = {
                                    viewModel.exportPersonaCard(role.id) { fileName, jsonText ->
                                        pendingExportJson = jsonText
                                        exportLauncher.launch(fileName)
                                    }
                                }
                            ) {
                                Icon(Icons.Default.FileDownload, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("导出")
                            }
                            TextButton(
                                onClick = { deletingPersona = role }
                            ) {
                                Icon(
                                    Icons.Default.DeleteOutline,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                    tint = MaterialTheme.colorScheme.error
                                )
                                Spacer(Modifier.width(2.dp))
                                Text("删除", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showEditorDialog) {
        PersonaEditorDialog(
            initial = editingPersona,
            availableModels = availableModels,
            isFetchingModels = isFetchingModels,
            onFetchModels = { viewModel.fetchModels() },
            onDismiss = { showEditorDialog = false },
            onSave = { name, desc, tone, greeting, prompt, avatar, model ->
                viewModel.savePersona(
                    existingId = editingPersona?.id,
                    name = name,
                    description = desc,
                    tone = tone,
                    greeting = greeting,
                    systemPrompt = prompt,
                    avatar = avatar,
                    model = model
                ) {
                    showEditorDialog = false
                }
            }
        )
    }

    deletingPersona?.let { target ->
        AlertDialog(
            onDismissRequest = { deletingPersona = null },
            title = { Text("删除角色「${target.name}」？") },
            text = { Text("该角色及其本地对话记录将被一并移除，此操作无法撤销。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.deletePersona(target)
                        deletingPersona = null
                    }
                ) {
                    Text("确认删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deletingPersona = null }) {
                    Text("取消")
                }
            }
        )
    }
}

@Composable
private fun PersonaEditorDialog(
    initial: PersonaEntity?,
    availableModels: List<String>,
    isFetchingModels: Boolean,
    onFetchModels: () -> Unit,
    onDismiss: () -> Unit,
    onSave: (name: String, desc: String, tone: String, greeting: String, prompt: String, avatar: String, model: String) -> Unit
) {
    var name by remember(initial) { mutableStateOf(initial?.name.orEmpty()) }
    var description by remember(initial) { mutableStateOf(initial?.description.orEmpty()) }
    var tone by remember(initial) { mutableStateOf(initial?.tone.orEmpty()) }
    var greeting by remember(initial) { mutableStateOf(initial?.greeting.orEmpty()) }
    var systemPrompt by remember(initial) { mutableStateOf(initial?.systemPrompt.orEmpty()) }
    var avatar by remember(initial) { mutableStateOf(initial?.avatar.orEmpty().ifBlank { "🌿" }) }
    var model by remember(initial) { mutableStateOf(initial?.model.orEmpty()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "新建角色人设" else "编辑角色「${initial.name}」") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("头像图标", style = MaterialTheme.typography.labelMedium)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    AvatarPresets.forEach { preset ->
                        FilterChip(
                            selected = avatar == preset,
                            onClick = { avatar = preset },
                            label = { Text(preset) }
                        )
                    }
                }
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("角色名称 *") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("一句话简介") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = tone,
                    onValueChange = { tone = it },
                    label = { Text("说话语气") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = greeting,
                    onValueChange = { greeting = it },
                    label = { Text("开场白") },
                    maxLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = systemPrompt,
                    onValueChange = { systemPrompt = it },
                    label = { Text("人设提示词 (System Prompt) *") },
                    minLines = 3,
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("专属模型（留空则跟随默认模型）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = onFetchModels, enabled = !isFetchingModels) {
                        Text(if (isFetchingModels) "正在拉取模型…" else "获取可用模型")
                    }
                    if (model.isNotBlank()) {
                        TextButton(onClick = { model = "" }) {
                            Text("改回默认")
                        }
                    }
                }
                if (availableModels.isNotEmpty()) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        availableModels.take(12).forEach { candidate ->
                            FilterChip(
                                selected = model == candidate,
                                onClick = { model = candidate },
                                label = { Text(candidate, maxLines = 1) }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(name, description, tone, greeting, systemPrompt, avatar, model) },
                enabled = name.isNotBlank() && systemPrompt.isNotBlank()
            ) {
                Text("保存")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
