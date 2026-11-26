package com.qiyi.companion.ui.screens

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.KnowledgeDocumentEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val MemoryCategories = listOf(
    "fact" to "事实",
    "preference" to "偏好",
    "event" to "经历",
    "relationship" to "关系"
)

@Composable
fun LibraryScreen(
    viewModel: QiYiViewModel,
    modifier: Modifier = Modifier
) {
    var subTab by rememberSaveable { mutableIntStateOf(0) }
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
            Column {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Text("书阁 · 知识与记忆", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        text = "纯离线本地分块检索与长期记忆召回，对话时自动注入上下文",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                TabRow(
                    selectedTabIndex = subTab,
                    containerColor = MaterialTheme.colorScheme.surface
                ) {
                    Tab(
                        selected = subTab == 0,
                        onClick = { subTab = 0 },
                        text = { Text("本地知识库") }
                    )
                    Tab(
                        selected = subTab == 1,
                        onClick = { subTab = 1 },
                        text = { Text("长期记忆") }
                    )
                }
            }
        }

        if (subTab == 0) {
            KnowledgeTabContent(viewModel = viewModel)
        } else {
            MemoryTabContent(viewModel = viewModel)
        }
    }
}

@Composable
private fun KnowledgeTabContent(viewModel: QiYiViewModel) {
    val context = LocalContext.current
    val documents by viewModel.knowledgeDocuments.collectAsStateWithLifecycle()
    val searchResults by viewModel.knowledgeSearchResults.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current
    val formatter = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }

    var searchQuery by rememberSaveable { mutableStateOf("") }
    var showPasteDialog by remember { mutableStateOf(false) }

    val fileLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            var displayName = "导入文档.txt"
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) displayName = cursor.getString(idx) ?: displayName
                }
            }
            val text = context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: throw IllegalStateException("无法读取所选文档。")
            val title = displayName.substringBeforeLast('.').ifBlank { displayName }
            Triple(title, text, displayName)
        }.onSuccess { (title, text, sourceName) ->
            viewModel.importKnowledgeDocument(title = title, rawContent = text, sourceName = sourceName)
        }.onFailure {
            viewModel.notify(it.message ?: "导入知识库文件失败。")
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item(key = "actions") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Button(
                    onClick = { fileLauncher.launch(arrayOf("text/markdown", "text/plain", "*/*")) },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.FileUpload, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("导入 MD/TXT")
                }
                OutlinedButton(
                    onClick = { showPasteDialog = true },
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("手动录入笔记")
                }
            }
        }

        item(key = "search_box") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = {
                        searchQuery = it
                        if (it.isBlank()) viewModel.searchKnowledge("")
                    },
                    placeholder = { Text("测试本地离线检索关键词…") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                Button(onClick = { viewModel.searchKnowledge(searchQuery) }) {
                    Icon(Icons.Default.Search, contentDescription = "检索", modifier = Modifier.size(18.dp))
                }
            }
        }

        if (searchResults.isNotEmpty()) {
            item(key = "search_header") {
                Text(
                    text = "命中片段（${searchResults.size} 条）",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold
                )
            }
            items(searchResults, key = { "hit_${it.chunk.id}" }) { hit ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f),
                    border = BorderStroke(0.8.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.4f))
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "《${hit.chunk.documentTitle}》 · 片段 #${hit.chunk.chunkIndex + 1}",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = hit.chunk.content,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 4,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }

        item(key = "docs_header") {
            Text(
                text = "已藏文档（${documents.size} 篇）",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (documents.isEmpty()) {
            item(key = "empty_docs") {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(0.8.dp, garden.subtleBorder)
                ) {
                    Text(
                        text = "书阁尚空。导入本地 Markdown 或文本笔记后，你在对话中提问时会自动离线检索最相关片段作为参考。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        } else {
            items(documents, key = { it.id }) { doc: KnowledgeDocumentEntity ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(0.8.dp, garden.subtleBorder)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Description,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = doc.title,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "${doc.chunkCount} 个片段 · ${doc.charCount} 字 · ${formatter.format(Date(doc.createdAt))}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        IconButton(onClick = { viewModel.deleteKnowledgeDocument(doc) }) {
                            Icon(
                                imageVector = Icons.Default.DeleteOutline,
                                contentDescription = "删除文档",
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }
        }
    }

    if (showPasteDialog) {
        var title by remember { mutableStateOf("") }
        var body by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showPasteDialog = false },
            title = { Text("手动录入知识笔记") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        label = { Text("文档标题") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = body,
                        onValueChange = { body = it },
                        label = { Text("正文内容（支持 Markdown）") },
                        minLines = 5,
                        maxLines = 10,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.importKnowledgeDocument(title = title.ifBlank { "随手笔记" }, rawContent = body) {
                            showPasteDialog = false
                        }
                    },
                    enabled = body.isNotBlank()
                ) {
                    Text("保存并分块")
                }
            },
            dismissButton = {
                TextButton(onClick = { showPasteDialog = false }) {
                    Text("取消")
                }
            }
        )
    }
}

@Composable
private fun MemoryTabContent(viewModel: QiYiViewModel) {
    val memories by viewModel.memories.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current

    var editingMemory by remember { mutableStateOf<MemoryEntity?>(null) }
    var showMemoryDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item(key = "add_memory_btn") {
            Button(
                onClick = {
                    editingMemory = null
                    showMemoryDialog = true
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("新增长期记忆")
            }
        }

        if (memories.isEmpty()) {
            item(key = "empty_memories") {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(0.8.dp, garden.subtleBorder)
                ) {
                    Text(
                        text = "尚未记录长期记忆。你可以手动添加自己的偏好与背景，或在对话气泡下方点击「记住」一键收录。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        } else {
            items(memories, key = { it.id }) { mem ->
                val catLabel = MemoryCategories.firstOrNull { it.first == mem.category }?.second ?: mem.category
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(0.8.dp, garden.subtleBorder)
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = MaterialTheme.colorScheme.secondaryContainer
                                ) {
                                    Text(
                                        text = catLabel,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                    )
                                }
                                Text(
                                    text = "重要度 ${"★".repeat(mem.importance.coerceIn(1, 5))}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = garden.goldAccent
                                )
                            }
                            Row {
                                IconButton(
                                    onClick = {
                                        editingMemory = mem
                                        showMemoryDialog = true
                                    },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(Icons.Default.Edit, contentDescription = "编辑", modifier = Modifier.size(16.dp))
                                }
                                IconButton(
                                    onClick = { viewModel.deleteMemory(mem) },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        Icons.Default.DeleteOutline,
                                        contentDescription = "删除",
                                        modifier = Modifier.size(16.dp),
                                        tint = MaterialTheme.colorScheme.error
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        HorizontalDivider(color = garden.subtleBorder)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = mem.content,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        }
    }

    if (showMemoryDialog) {
        MemoryEditorDialog(
            initial = editingMemory,
            onDismiss = { showMemoryDialog = false },
            onSave = { category, content, importance ->
                viewModel.saveMemory(
                    existingId = editingMemory?.id,
                    personaId = editingMemory?.personaId,
                    category = category,
                    content = content,
                    importance = importance
                ) {
                    showMemoryDialog = false
                }
            }
        )
    }
}

@Composable
private fun MemoryEditorDialog(
    initial: MemoryEntity?,
    onDismiss: () -> Unit,
    onSave: (category: String, content: String, importance: Int) -> Unit
) {
    var category by remember(initial) { mutableStateOf(initial?.category ?: "fact") }
    var content by remember(initial) { mutableStateOf(initial?.content.orEmpty()) }
    var importance by remember(initial) { mutableStateOf((initial?.importance ?: 3).toFloat()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "新增长期记忆" else "编辑长期记忆") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    MemoryCategories.forEach { (key, label) ->
                        FilterChip(
                            selected = category == key,
                            onClick = { category = key },
                            label = { Text(label) }
                        )
                    }
                }
                OutlinedTextField(
                    value = content,
                    onValueChange = { content = it },
                    label = { Text("记忆内容 *") },
                    placeholder = { Text("例如：我习惯晚上 11 点后专注写代码，偏爱简洁直接的回答。") },
                    minLines = 3,
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth()
                )
                Column {
                    Text(
                        text = "重要度：${importance.toInt()} / 5",
                        style = MaterialTheme.typography.labelMedium
                    )
                    Slider(
                        value = importance,
                        onValueChange = { importance = it },
                        valueRange = 1f..5f,
                        steps = 3
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(category, content, importance.toInt()) },
                enabled = content.isNotBlank()
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
